/**
 * Build a `BinaryUuidConfig` from a parsed Prisma schema.
 *
 * Responsibilities:
 *   - Collect every UUID field (`Bytes @db.Binary(16)` or `String @db.Char(36)`).
 *   - Collect relation-to-target-model mapping for nested-write walking.
 *   - Identify which fields need auto-generation (`@default(uuid())` or `id` field).
 */

import type { BinaryUuidConfig, RelationTargetMap, UuidFieldMap } from '../src/config/types.js';

import type { ParsedSchema } from './parse-schema.js';

export interface BuildRegistryResult {
  readonly config: BinaryUuidConfig;
  readonly stats: {
    readonly models: number;
    readonly uuidFields: number;
    readonly relations: number;
    readonly autoGenFields: number;
  };
}

export function buildRegistry(schema: ParsedSchema): BuildRegistryResult {
  const fields: Record<string, string[]> = {};
  const autoGenerate: Record<string, string[]> = {};
  const relations: Record<string, Record<string, string>> = {};

  let uuidFieldCount = 0;
  let relationCount = 0;
  let autoGenCount = 0;

  for (const model of schema.models) {
    const modelUuidFields: string[] = [];
    const modelAutoGen: string[] = [];
    const modelRelations: Record<string, string> = {};

    for (const field of model.fields) {
      if (field.isUuidCandidate) {
        modelUuidFields.push(field.name);
        uuidFieldCount++;
        if (field.hasUuidDefault || field.name === 'id') {
          modelAutoGen.push(field.name);
          autoGenCount++;
        }
      } else if (field.isRelation && field.relationTargetModel !== undefined) {
        modelRelations[field.name] = field.relationTargetModel;
        relationCount++;
      }
    }

    if (modelUuidFields.length > 0) {
      fields[model.name] = modelUuidFields;
    }
    if (modelAutoGen.length > 0) {
      autoGenerate[model.name] = modelAutoGen;
    }
    if (Object.keys(modelRelations).length > 0) {
      relations[model.name] = modelRelations;
    }
  }

  const config: BinaryUuidConfig = {
    fields: fields as UuidFieldMap,
    autoGenerate: autoGenerate as UuidFieldMap,
    relations: relations as RelationTargetMap,
  };

  return {
    config,
    stats: {
      models: Object.keys(fields).length,
      uuidFields: uuidFieldCount,
      relations: relationCount,
      autoGenFields: autoGenCount,
    },
  };
}
