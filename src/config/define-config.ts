/**
 * Config definition and normalization.
 *
 * `defineBinaryUuidConfig` is the public helper; it returns its input unchanged
 * at runtime but anchors the TypeScript type for later inference. The internal
 * `normalizeConfig` function converts a user-supplied config to the shape the
 * walker consumes.
 */

import { newUidV4 } from '../conversion/uuid-v4.js';
import { newUidV7 } from '../conversion/uuid-v7.js';
import { InvalidConfigError } from '../errors.js';

import type { BinaryUuidConfig, NormalizedConfig } from './types.js';

/**
 * Identity helper for config objects. Exists to give TypeScript an explicit
 * anchor for inference and to make config files self-documenting.
 */
export function defineBinaryUuidConfig<T extends BinaryUuidConfig>(config: T): T {
  return config;
}

/**
 * Normalize a user-supplied config into the internal shape. Runs once at
 * extension init; never on the hot path.
 *
 * Throws `InvalidConfigError` on structural problems.
 *
 * @internal
 */
export function normalizeConfig(config: BinaryUuidConfig): NormalizedConfig {
  if (typeof config !== 'object' || config === null) {
    throw new InvalidConfigError('config must be an object');
  }
  if (typeof config.fields !== 'object' || config.fields === null) {
    throw new InvalidConfigError(
      'config.fields is required and must be a Record<string, string[]>',
    );
  }

  // Build the fields map (PascalCase model → Set<fieldName>).
  const fields = new Map<string, ReadonlySet<string>>();
  const allFieldNames = new Set<string>();
  for (const [model, fieldList] of Object.entries(config.fields)) {
    if (!Array.isArray(fieldList)) {
      throw new InvalidConfigError(`config.fields.${model} must be an array of field names`);
    }
    if (fieldList.length === 0) {
      throw new InvalidConfigError(
        `config.fields.${model} is empty — omit the entry if the model has no UUID fields`,
      );
    }
    const seen = new Set<string>();
    for (const field of fieldList) {
      if (typeof field !== 'string' || field.length === 0) {
        throw new InvalidConfigError(
          `config.fields.${model} contains a non-string field name: ${String(field)}`,
        );
      }
      if (seen.has(field)) {
        throw new InvalidConfigError(`config.fields.${model} has duplicate field "${field}"`);
      }
      seen.add(field);
      allFieldNames.add(field);
    }
    fields.set(model, seen);
  }

  // Build the autoGenerate map. If the user didn't supply one, default to
  // every field named 'id' that's in the fields map.
  const autoGenerate = new Map<string, ReadonlySet<string>>();
  if (config.autoGenerate !== undefined) {
    if (typeof config.autoGenerate !== 'object' || config.autoGenerate === null) {
      throw new InvalidConfigError('config.autoGenerate must be a Record<string, string[]>');
    }
    for (const [model, fieldList] of Object.entries(config.autoGenerate)) {
      if (!Array.isArray(fieldList)) {
        throw new InvalidConfigError(`config.autoGenerate.${model} must be an array`);
      }
      const modelFields = fields.get(model);
      if (modelFields === undefined) {
        throw new InvalidConfigError(
          `config.autoGenerate.${model} references a model not present in config.fields`,
        );
      }
      const seen = new Set<string>();
      for (const field of fieldList) {
        if (typeof field !== 'string' || field.length === 0) {
          throw new InvalidConfigError(
            `config.autoGenerate.${model} contains a non-string field name: ${String(field)}`,
          );
        }
        if (!modelFields.has(field)) {
          throw new InvalidConfigError(
            `config.autoGenerate.${model}.${field} is not in config.fields.${model}`,
          );
        }
        seen.add(field);
      }
      autoGenerate.set(model, seen);
    }
  } else {
    for (const [model, modelFields] of fields.entries()) {
      if (modelFields.has('id')) {
        autoGenerate.set(model, new Set(['id']));
      }
    }
  }

  // Build the relations map.
  const relations = new Map<string, Map<string, string>>();
  if (config.relations !== undefined) {
    if (typeof config.relations !== 'object' || config.relations === null) {
      throw new InvalidConfigError('config.relations must be a nested Record');
    }
    for (const [model, relationMap] of Object.entries(config.relations)) {
      if (typeof relationMap !== 'object' || relationMap === null) {
        throw new InvalidConfigError(`config.relations.${model} must be a Record<string, string>`);
      }
      const inner = new Map<string, string>();
      for (const [relation, target] of Object.entries(relationMap)) {
        if (typeof target !== 'string' || target.length === 0) {
          throw new InvalidConfigError(
            `config.relations.${model}.${relation} target must be a non-empty string`,
          );
        }
        // Target model doesn't have to be in `fields` — it could be a model
        // without any UUID fields. That's valid.
        inner.set(relation, target);
      }
      relations.set(model, inner);
    }
  }

  // Resolve generator.
  const version = config.version ?? 'v4';
  const generate = (() => {
    if (config.generate !== undefined) {
      if (typeof config.generate !== 'function') {
        throw new InvalidConfigError('config.generate must be a function that returns Uint8Array');
      }
      return config.generate;
    }
    return version === 'v7' ? newUidV7 : newUidV4;
  })();

  // Options.
  const options = config.options ?? {};
  if (typeof options !== 'object' || options === null) {
    throw new InvalidConfigError('config.options must be an object');
  }

  return {
    fields,
    autoGenerate,
    relations,
    allUuidFieldNames: allFieldNames,
    generate,
    strictValidation: options.strictValidation ?? true,
    allowBufferInput: options.allowBufferInput ?? true,
    logger: options.logger,
    metrics: options.metrics,
  };
}
