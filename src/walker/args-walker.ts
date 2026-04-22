/**
 * Write-side walker: transforms Prisma query arguments before they reach the
 * database. For every key that corresponds to a UUID field in the current
 * model scope, converts string values to 16-byte Uint8Array.
 *
 * The walker is driven by the normalized config. It pivots model scope when
 * it encounters relation operators (`some`/`is`/etc.) or nested writes
 * (`create`/`connect`/etc.).
 *
 * Design invariants:
 *   - Pure: returns a new object tree. Input args are never mutated.
 *   - Idempotent: a Uint8Array in input position is passed through unchanged.
 *   - Fail-loud: malformed UUIDs throw immediately with field-level context.
 *   - Allocation-minimal: only clones objects that contain transformed values.
 */

import type { NormalizedConfig } from '../config/types.js';
import { uidToBin } from '../conversion/uuid-binary.js';
import { isUuidBytes } from '../conversion/validation.js';
import { TypeMismatchError } from '../errors.js';

import {
  ARRAY_SCALAR_OPERATORS,
  LOGICAL_COMBINATORS,
  RELATION_FILTER_OPERATORS,
  SCALAR_OPERATORS,
  UPDATE_SCALAR_OPERATORS,
  WRITE_NESTED_OPERATORS,
} from './operators.js';

/**
 * Mutable counter threaded through the walker for metrics. One instance per
 * operation so we can report "argsConverted" to the optional metrics hook.
 */
interface ConversionCounter {
  count: number;
}

/**
 * Entry point. Walks a top-level Prisma args object for a given model +
 * operation and returns the transformed version.
 */
export function walkArgs(
  config: NormalizedConfig,
  model: string | undefined,
  operation: string,
  args: unknown,
): { args: unknown; converted: number } {
  const counter: ConversionCounter = { count: 0 };
  if (args === null || args === undefined || typeof args !== 'object') {
    return { args, converted: 0 };
  }
  const out = walkOperationArgs(config, model, operation, args as Record<string, unknown>, counter);
  return { args: out, converted: counter.count };
}

/**
 * Walk the top-level shape of an operation: `{ where, data, include, select,
 * orderBy, cursor, take, skip, ... }`.
 */
function walkOperationArgs(
  config: NormalizedConfig,
  model: string | undefined,
  operation: string,
  args: Record<string, unknown>,
  counter: ConversionCounter,
): Record<string, unknown> {
  // If we don't know the model (e.g., `$executeRaw`), nothing to transform.
  if (model === undefined) {
    return args;
  }

  let out: Record<string, unknown> | undefined;

  for (const key of Object.keys(args)) {
    const value = args[key];
    let transformed: unknown = value;

    switch (key) {
      case 'where':
        transformed = walkWhere(config, model, value, counter);
        break;
      case 'data':
        transformed = walkData(config, model, operation, value, counter);
        break;
      case 'cursor':
        transformed = walkCursor(config, model, value, counter);
        break;
      case 'create':
        // Top-level `create` shape on upsert: { where, create, update }.
        // `create` value is a data block for the current model.
        transformed = walkData(config, model, 'create', value, counter);
        break;
      case 'update':
        transformed = walkData(config, model, 'update', value, counter);
        break;
      case 'include':
      case 'select':
        transformed = walkSelectOrInclude(config, model, value, counter);
        break;
      case 'orderBy':
      case 'distinct':
      case 'take':
      case 'skip':
      case 'by':
        // These reference field names but not field values — nothing to convert.
        transformed = value;
        break;
      default:
        // Unknown top-level key: pass through untouched.
        transformed = value;
        break;
    }

    if (transformed !== value) {
      out ??= { ...args };
      out[key] = transformed;
    }
  }

  return out ?? args;
}

/**
 * Walk a `where` clause. The current model is fixed; we recurse into
 * relation filters and logical combinators while updating model scope.
 */
function walkWhere(
  config: NormalizedConfig,
  model: string,
  where: unknown,
  counter: ConversionCounter,
): unknown {
  if (where === null || where === undefined || typeof where !== 'object') {
    return where;
  }
  if (Array.isArray(where)) {
    return walkArray(where, (v) => walkWhere(config, model, v, counter));
  }

  const obj = where as Record<string, unknown>;
  const uuidFields = config.fields.get(model);
  const modelRelations = config.relations.get(model);
  let out: Record<string, unknown> | undefined;

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    let transformed: unknown = value;

    if (LOGICAL_COMBINATORS.has(key)) {
      transformed = walkLogicalCombinator(config, model, value, counter);
    } else if (uuidFields?.has(key) === true) {
      transformed = walkUuidFieldValue(config, model, key, value, counter);
    } else if (modelRelations?.has(key) === true) {
      transformed = walkRelationFilter(config, modelRelations.get(key)!, value, counter);
    }

    if (transformed !== value) {
      out ??= { ...obj };
      out[key] = transformed;
    }
  }

  return out ?? obj;
}

/**
 * AND / OR / NOT — each preserves the current model scope. Value is either
 * an array of where clauses or a single where clause.
 */
function walkLogicalCombinator(
  config: NormalizedConfig,
  model: string,
  value: unknown,
  counter: ConversionCounter,
): unknown {
  if (Array.isArray(value)) {
    return walkArray(value, (v) => walkWhere(config, model, v, counter));
  }
  if (typeof value === 'object' && value !== null) {
    return walkWhere(config, model, value, counter);
  }
  return value;
}

/**
 * Value at a UUID field inside `where`. Can be:
 *   - A direct scalar ('abc-...'),
 *   - A scalar-operator object ({ equals, in, not, ... }),
 *   - null.
 */
function walkUuidFieldValue(
  config: NormalizedConfig,
  model: string,
  field: string,
  value: unknown,
  counter: ConversionCounter,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    counter.count++;
    return uidToBin(value);
  }
  if (isUuidBytes(value)) {
    // Idempotent pass-through.
    return value;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    // Scalar-operator object.
    const obj = value as Record<string, unknown>;
    let out: Record<string, unknown> | undefined;
    for (const op of Object.keys(obj)) {
      const inner = obj[op];
      let transformed: unknown = inner;
      if (ARRAY_SCALAR_OPERATORS.has(op) && Array.isArray(inner)) {
        transformed = walkArray(inner, (v) =>
          convertScalarUuidValue(v, config, model, field, counter),
        );
      } else if (op === 'not') {
        // `not` can be a scalar, an array (deprecated but present), or a nested operator object.
        transformed = walkUuidFieldValue(config, model, field, inner, counter);
      } else if (SCALAR_OPERATORS.has(op)) {
        transformed = convertScalarUuidValue(inner, config, model, field, counter);
      }
      if (transformed !== inner) {
        out ??= { ...obj };
        out[op] = transformed;
      }
    }
    return out ?? obj;
  }
  // Unexpected type (number, boolean, etc.) for a UUID field.
  if (config.strictValidation) {
    throw new TypeMismatchError(typeof value, { model, field });
  }
  return value;
}

/**
 * Convert a single scalar value in UUID field position. Strings → binary;
 * buffers pass through; null/undefined pass through; other types throw in
 * strict mode.
 */
function convertScalarUuidValue(
  value: unknown,
  config: NormalizedConfig,
  model: string,
  field: string,
  counter: ConversionCounter,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    counter.count++;
    return uidToBin(value);
  }
  if (isUuidBytes(value)) return value;
  if (config.strictValidation) {
    throw new TypeMismatchError(typeof value, { model, field });
  }
  return value;
}

/**
 * Relation filter: pivots model scope to the related model.
 * Value is `{ some: {...}, every: {...}, none: {...}, is: {...}, isNot: {...} }`.
 */
function walkRelationFilter(
  config: NormalizedConfig,
  targetModel: string,
  value: unknown,
  counter: ConversionCounter,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object' || Array.isArray(value)) return value;

  const obj = value as Record<string, unknown>;
  let out: Record<string, unknown> | undefined;
  for (const op of Object.keys(obj)) {
    const inner = obj[op];
    if (RELATION_FILTER_OPERATORS.has(op)) {
      const transformed = walkWhere(config, targetModel, inner, counter);
      if (transformed !== inner) {
        out ??= { ...obj };
        out[op] = transformed;
      }
    }
  }
  return out ?? obj;
}

/**
 * Walk `data` for create/update/upsert operations. Recurses through relation
 * writes (connect, create, upsert, etc.) pivoting model scope.
 */
function walkData(
  config: NormalizedConfig,
  model: string,
  operation: string,
  data: unknown,
  counter: ConversionCounter,
): unknown {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    // createMany passes an array of data rows.
    return walkArray(data, (row) => walkData(config, model, operation, row, counter));
  }
  if (typeof data !== 'object') return data;

  const obj = data as Record<string, unknown>;
  const uuidFields = config.fields.get(model);
  const modelRelations = config.relations.get(model);
  const autoGen = config.autoGenerate.get(model);

  // Clone-on-write. Start tracking if we need to inject auto-gen fields.
  let out: Record<string, unknown> | undefined;

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    let transformed: unknown = value;

    if (uuidFields?.has(key) === true) {
      // UUID field in data. Supports `'value'`, `{ set: 'value' }`, or null.
      transformed = walkUuidDataFieldValue(config, model, key, value, counter);
    } else if (modelRelations?.has(key) === true) {
      transformed = walkNestedWrite(config, modelRelations.get(key)!, value, counter);
    }

    if (transformed !== value) {
      out ??= { ...obj };
      out[key] = transformed;
    }
  }

  // Auto-generate missing UUIDs for create-like operations.
  const isCreateLike =
    operation === 'create' || operation === 'createMany' || operation === 'upsert';
  if (isCreateLike && autoGen !== undefined && autoGen.size > 0) {
    for (const field of autoGen) {
      const haveValue = (out ?? obj)[field];
      if (haveValue === undefined) {
        out ??= { ...obj };
        out[field] = config.generate();
        counter.count++;
      }
    }
  }

  return out ?? obj;
}

/**
 * UUID field value in a data clause. Shapes:
 *   - direct: `{ id: 'abc' }` (on create)
 *   - update: `{ id: { set: 'abc' } }`
 *   - null / undefined (update to null, or absence)
 */
function walkUuidDataFieldValue(
  config: NormalizedConfig,
  model: string,
  field: string,
  value: unknown,
  counter: ConversionCounter,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    counter.count++;
    return uidToBin(value);
  }
  if (isUuidBytes(value)) return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    let out: Record<string, unknown> | undefined;
    for (const op of Object.keys(obj)) {
      if (UPDATE_SCALAR_OPERATORS.has(op) && op === 'set') {
        const inner = obj[op];
        const converted = convertScalarUuidValue(inner, config, model, field, counter);
        if (converted !== inner) {
          out ??= { ...obj };
          out[op] = converted;
        }
      }
    }
    return out ?? obj;
  }
  if (config.strictValidation) {
    throw new TypeMismatchError(typeof value, { model, field });
  }
  return value;
}

/**
 * Nested write block: `{ create, createMany, connect, connectOrCreate, update,
 * updateMany, upsert, delete, deleteMany, set, disconnect }`.
 *
 * Each operator can be either:
 *   - A where-shape (connect, delete, deleteMany, disconnect)
 *   - A data-shape (create, update)
 *   - A compound shape (upsert with where + create + update, connectOrCreate)
 *   - An array of any of the above
 */
function walkNestedWrite(
  config: NormalizedConfig,
  targetModel: string,
  value: unknown,
  counter: ConversionCounter,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object' || Array.isArray(value)) return value;

  const obj = value as Record<string, unknown>;
  let out: Record<string, unknown> | undefined;
  let sawNestedOp = false;

  for (const key of Object.keys(obj)) {
    const inner = obj[key];
    if (!WRITE_NESTED_OPERATORS.has(key)) continue;
    sawNestedOp = true;
    let transformed: unknown = inner;

    switch (key) {
      case 'create':
        transformed = walkData(config, targetModel, 'create', inner, counter);
        break;
      case 'createMany':
        // createMany-in-nested: { data: [...], skipDuplicates? }
        if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
          const cm = inner as Record<string, unknown>;
          const data = cm['data'];
          const newData = walkData(config, targetModel, 'createMany', data, counter);
          if (newData !== data) {
            transformed = { ...cm, data: newData };
          }
        }
        break;
      case 'update':
        // { where, data } or array of same
        if (Array.isArray(inner)) {
          transformed = walkArray(inner, (i) => walkNestedUpdate(config, targetModel, i, counter));
        } else if (typeof inner === 'object' && inner !== null) {
          transformed = walkNestedUpdate(config, targetModel, inner, counter);
        }
        break;
      case 'updateMany':
        if (Array.isArray(inner)) {
          transformed = walkArray(inner, (i) => walkNestedUpdate(config, targetModel, i, counter));
        } else if (typeof inner === 'object' && inner !== null) {
          transformed = walkNestedUpdate(config, targetModel, inner, counter);
        }
        break;
      case 'upsert':
        if (Array.isArray(inner)) {
          transformed = walkArray(inner, (i) => walkNestedUpsert(config, targetModel, i, counter));
        } else if (typeof inner === 'object' && inner !== null) {
          transformed = walkNestedUpsert(config, targetModel, inner, counter);
        }
        break;
      case 'connect':
      case 'delete':
      case 'deleteMany':
      case 'disconnect':
      case 'set': {
        // Where-shape (or array of where-shapes).
        if (Array.isArray(inner)) {
          transformed = walkArray(inner, (i) => walkWhere(config, targetModel, i, counter));
        } else if (typeof inner === 'object' && inner !== null) {
          transformed = walkWhere(config, targetModel, inner, counter);
        } else if (typeof inner === 'boolean') {
          // disconnect: true — nothing to convert.
          transformed = inner;
        }
        break;
      }
      case 'connectOrCreate':
        if (Array.isArray(inner)) {
          transformed = walkArray(inner, (i) =>
            walkConnectOrCreate(config, targetModel, i, counter),
          );
        } else if (typeof inner === 'object' && inner !== null) {
          transformed = walkConnectOrCreate(config, targetModel, inner, counter);
        }
        break;
    }

    if (transformed !== inner) {
      out ??= { ...obj };
      out[key] = transformed;
    }
  }

  // If nothing in the value matched nested-op keys, treat it as a direct
  // data/where block for the target. This handles implicit shapes.
  if (!sawNestedOp) {
    return walkData(config, targetModel, 'create', obj, counter);
  }

  return out ?? obj;
}

/**
 * { where, data } update block.
 */
function walkNestedUpdate(
  config: NormalizedConfig,
  model: string,
  value: Record<string, unknown> | unknown,
  counter: ConversionCounter,
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as Record<string, unknown>;
  let out: Record<string, unknown> | undefined;
  if ('where' in obj) {
    const transformed = walkWhere(config, model, obj['where'], counter);
    if (transformed !== obj['where']) {
      out = { ...obj };
      out['where'] = transformed;
    }
  }
  if ('data' in obj) {
    const transformed = walkData(config, model, 'update', obj['data'], counter);
    if (transformed !== obj['data']) {
      out ??= { ...obj };
      out['data'] = transformed;
    }
  }
  return out ?? obj;
}

/**
 * { where, create, update } upsert block.
 */
function walkNestedUpsert(
  config: NormalizedConfig,
  model: string,
  value: Record<string, unknown> | unknown,
  counter: ConversionCounter,
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as Record<string, unknown>;
  let out: Record<string, unknown> | undefined;
  if ('where' in obj) {
    const transformed = walkWhere(config, model, obj['where'], counter);
    if (transformed !== obj['where']) {
      out = { ...obj };
      out['where'] = transformed;
    }
  }
  if ('create' in obj) {
    const transformed = walkData(config, model, 'create', obj['create'], counter);
    if (transformed !== obj['create']) {
      out ??= { ...obj };
      out['create'] = transformed;
    }
  }
  if ('update' in obj) {
    const transformed = walkData(config, model, 'update', obj['update'], counter);
    if (transformed !== obj['update']) {
      out ??= { ...obj };
      out['update'] = transformed;
    }
  }
  return out ?? obj;
}

/**
 * { where, create } connectOrCreate block.
 */
function walkConnectOrCreate(
  config: NormalizedConfig,
  model: string,
  value: Record<string, unknown> | unknown,
  counter: ConversionCounter,
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as Record<string, unknown>;
  let out: Record<string, unknown> | undefined;
  if ('where' in obj) {
    const transformed = walkWhere(config, model, obj['where'], counter);
    if (transformed !== obj['where']) {
      out = { ...obj };
      out['where'] = transformed;
    }
  }
  if ('create' in obj) {
    const transformed = walkData(config, model, 'create', obj['create'], counter);
    if (transformed !== obj['create']) {
      out ??= { ...obj };
      out['create'] = transformed;
    }
  }
  return out ?? obj;
}

/**
 * Cursor clause. Structurally a subset of `where` with only direct field-value
 * pairs and unique-composite keys. Reuse walkWhere because it handles both.
 */
function walkCursor(
  config: NormalizedConfig,
  model: string,
  cursor: unknown,
  counter: ConversionCounter,
): unknown {
  return walkWhere(config, model, cursor, counter);
}

/**
 * `include` / `select` can contain nested `where` clauses on included relations.
 * Structure: `{ relationName: { where: {...}, include: {...}, select: {...} } }`.
 */
function walkSelectOrInclude(
  config: NormalizedConfig,
  model: string,
  value: unknown,
  counter: ConversionCounter,
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as Record<string, unknown>;
  const modelRelations = config.relations.get(model);
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(obj)) {
    const inner = obj[key];
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) continue;
    const targetModel = modelRelations?.get(key);
    if (targetModel === undefined) continue;
    const transformed = walkOperationArgs(
      config,
      targetModel,
      'findMany',
      inner as Record<string, unknown>,
      counter,
    );
    if (transformed !== inner) {
      out ??= { ...obj };
      out[key] = transformed;
    }
  }
  return out ?? obj;
}

/**
 * Array helper: maps each element through the transformer, cloning only if
 * at least one element changed.
 */
function walkArray<T>(arr: readonly T[], fn: (v: T) => unknown): unknown {
  let out: unknown[] | undefined;
  for (let i = 0; i < arr.length; i++) {
    const transformed = fn(arr[i]!);
    if (transformed !== arr[i]) {
      out ??= arr.slice();
      out[i] = transformed;
    }
  }
  return out ?? arr;
}
