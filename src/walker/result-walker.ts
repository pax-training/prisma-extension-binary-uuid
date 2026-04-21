/**
 * Read-side walker: transforms Prisma query results after they come back from
 * the database. For every field in UUID field position whose value is a
 * Uint8Array, converts to a lowercase dashed UUID string.
 *
 * Mirrors the args walker's model-scope-pivot logic but operates on result
 * trees rather than query args.
 */

import { uidFromBin } from '../conversion/uuid-binary.js';
import { isUuidBytes } from '../conversion/validation.js';
import type { NormalizedConfig } from '../config/types.js';

import { AGGREGATION_RESULT_KEYS } from './operators.js';

interface ConversionCounter {
  count: number;
}

export function walkResult(
  config: NormalizedConfig,
  model: string | undefined,
  operation: string,
  result: unknown,
): { result: unknown; converted: number } {
  const counter: ConversionCounter = { count: 0 };
  if (result === null || result === undefined) {
    return { result, converted: 0 };
  }
  const out = walkForModel(config, model, operation, result, counter);
  return { result: out, converted: counter.count };
}

/**
 * Walk a result tree in the scope of a given model. The caller is responsible
 * for knowing the model; we pivot scope when we descend into relations that
 * the config maps to other models.
 */
function walkForModel(
  config: NormalizedConfig,
  model: string | undefined,
  operation: string,
  value: unknown,
  counter: ConversionCounter,
): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return walkArray(value, (v) => walkForModel(config, model, operation, v, counter));
  }
  if (isUuidBytes(value)) {
    // Standalone Uint8Array at operation root (e.g., aggregate `_max` result
    // returned bare). Without field context we can't decide to convert.
    return value;
  }
  if (typeof value !== 'object') return value;

  if (model === undefined) return value;

  const obj = value as Record<string, unknown>;
  const uuidFields = config.fields.get(model);
  const modelRelations = config.relations.get(model);
  let out: Record<string, unknown> | undefined;

  for (const key of Object.keys(obj)) {
    const inner = obj[key];
    let transformed: unknown = inner;

    if (AGGREGATION_RESULT_KEYS.has(key)) {
      // `_max`, `_min`, `_avg`, `_sum`, `_count` — nested object keyed by field
      // names in the same model scope.
      transformed = walkAggregationResult(config, model, inner, counter);
    } else if (uuidFields?.has(key) === true) {
      transformed = convertUuidResultValue(inner, counter);
    } else if (modelRelations?.has(key) === true) {
      const targetModel = modelRelations.get(key)!;
      transformed = walkForModel(config, targetModel, 'findMany', inner, counter);
    } else if (typeof inner === 'object' && inner !== null && !isUuidBytes(inner)) {
      // Could be a nested relation object Prisma returned even though we
      // didn't declare it. Leave as-is — we only know about declared relations.
      transformed = inner;
    }

    if (transformed !== inner) {
      if (out === undefined) {
        out = { ...obj };
      }
      out[key] = transformed;
    }
  }

  return out ?? obj;
}

/**
 * Convert a value in UUID result position: Uint8Array → string, else pass through.
 */
function convertUuidResultValue(value: unknown, counter: ConversionCounter): unknown {
  if (value === null || value === undefined) return value;
  if (isUuidBytes(value)) {
    counter.count++;
    return uidFromBin(value);
  }
  if (Array.isArray(value)) {
    // Scalar-list UUID field.
    return walkArray(value, (v) => convertUuidResultValue(v, counter));
  }
  // Unexpected scalar: leave it.
  return value;
}

/**
 * Aggregation result object. Keys are field names in the current model scope.
 */
function walkAggregationResult(
  config: NormalizedConfig,
  model: string,
  value: unknown,
  counter: ConversionCounter,
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as Record<string, unknown>;
  const uuidFields = config.fields.get(model);
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(obj)) {
    const inner = obj[key];
    if (uuidFields?.has(key) === true) {
      const transformed = convertUuidResultValue(inner, counter);
      if (transformed !== inner) {
        if (out === undefined) {
          out = { ...obj };
        }
        out[key] = transformed;
      }
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
      if (out === undefined) {
        out = arr.slice();
      }
      out[i] = transformed;
    }
  }
  return out ?? arr;
}
