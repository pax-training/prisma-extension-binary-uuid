/**
 * Lightweight schema.prisma parser.
 *
 * This is not a full Prisma schema parser — we only extract what we need to
 * build the UUID field registry:
 *   - Model names (PascalCase, as Prisma emits them)
 *   - Fields declared as `Bytes @db.Binary(16)` OR `String @db.Char(36)`
 *   - Relation fields with their target models
 *
 * We deliberately don't shell out to `prisma-internals` because:
 *   1) It's a heavy dependency for a build-time CLI
 *   2) Its API has churned across major versions
 *   3) Our needs are narrow enough that a 200-line parser is sufficient
 *
 * If this parser ever can't handle something (e.g., preview features that
 * change the syntax), the error message tells the user to file an issue.
 */

export interface ParsedField {
  readonly name: string;
  readonly type: string;
  readonly isList: boolean;
  readonly isNullable: boolean;
  readonly attributes: string; // everything after the type+modifier, raw
  readonly dbType: string | undefined; // @db.Char(36), @db.Binary(16), etc.
  readonly isUuidCandidate: boolean; // Bytes @db.Binary(16) OR String @db.Char(36)
  readonly isRelation: boolean;
  readonly relationTargetModel: string | undefined;
  readonly hasUuidDefault: boolean;
  // Database column name from `@map("...")`. Undefined when the field is not
  // remapped; callers that emit SQL must fall back to `name` in that case.
  readonly dbName: string | undefined;
}

export interface ParsedModel {
  readonly name: string;
  readonly fields: readonly ParsedField[];
  // Database table name from `@@map("...")`. Undefined when the model is not
  // remapped; callers that emit SQL must fall back to `name` in that case.
  readonly dbName: string | undefined;
}

export interface ParsedSchema {
  readonly models: readonly ParsedModel[];
  readonly modelByName: ReadonlyMap<string, ParsedModel>;
}

const MODEL_OPEN_RE = /^model\s+(\w+)\s*\{/;
const FIELD_RE = /^\s*(?<name>\w+)\s+(?<type>\w+)(?<modifier>\?|\[\])?\s*(?<attrs>.*)$/;
const DB_TYPE_RE = /@db\.(\w+(?:\([^)]+\))?)/;
const RELATION_RE = /@relation\b/;
// `@@map("table_name")` at model scope and `@map("col_name")` at field scope
// rename the underlying database identifiers. Prisma's runtime continues to
// use the schema-side names — but raw SQL emitted by `migrate-sql` must use
// the database-side names or it will target identifiers that don't exist.
const MODEL_MAP_RE = /^@@map\s*\(\s*"([^"]+)"\s*\)/;
const FIELD_MAP_RE = /@map\s*\(\s*"([^"]+)"\s*\)/;

export function parseSchema(source: string): ParsedSchema {
  const lines = source.split(/\r?\n/);

  // Two-pass parse: first collect every model name so we can recognise
  // back-reference relation fields (to-many lists or single-side fields that
  // have no `@relation` attribute because the FK is on the other side).
  // Without this, a field like `permissions UsersRolePermissions[]` on
  // `UsersRoles` would never be registered as a relation, and nested writes
  // (`{ permissions: { create: [...] } }`) would slip past the walker with
  // their UUID strings unconverted.
  const modelNames = new Set<string>();
  for (const line of lines) {
    const stripped = stripComments(line).trim();
    const m = MODEL_OPEN_RE.exec(stripped);
    if (m !== null) {
      modelNames.add(m[1]!);
    }
  }

  const models: ParsedModel[] = [];

  let currentModel: string | null = null;
  let currentModelDbName: string | undefined = undefined;
  let currentFields: ParsedField[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const stripped = stripComments(line).trim();
    if (stripped.length === 0) continue;

    if (currentModel === null) {
      const m = MODEL_OPEN_RE.exec(stripped);
      if (m !== null) {
        currentModel = m[1]!;
        currentModelDbName = undefined;
        currentFields = [];
      }
      continue;
    }

    // Inside a model block.
    if (stripped === '}') {
      models.push({ name: currentModel, fields: currentFields, dbName: currentModelDbName });
      currentModel = null;
      currentModelDbName = undefined;
      currentFields = [];
      continue;
    }

    // `@@`-prefixed lines are model-level attributes, not fields. We only need
    // `@@map("...")` (the database table name); other `@@`-attrs are skipped.
    if (stripped.startsWith('@@')) {
      const mm = MODEL_MAP_RE.exec(stripped);
      if (mm !== null) {
        currentModelDbName = mm[1]!;
      }
      continue;
    }

    const fm = FIELD_RE.exec(stripped);
    if (fm?.groups === undefined) continue;

    const name = fm.groups['name']!;
    const type = fm.groups['type']!;
    const modifier = fm.groups['modifier'] ?? '';
    const attrs = (fm.groups['attrs'] ?? '').trim();

    const isList = modifier === '[]';
    const isNullable = modifier === '?';
    const dbMatch = DB_TYPE_RE.exec(attrs);
    const dbType = dbMatch?.[1];
    const isBinary16 = dbType === 'Binary(16)';
    const isChar36 = dbType === 'Char(36)';
    const hasRelationAttr = RELATION_RE.test(attrs);
    const isUuidCandidate = (type === 'Bytes' && isBinary16) || (type === 'String' && isChar36);

    // Detect @default(uuid()) / @default(uuid(7))
    const hasUuidDefault = /@default\s*\(\s*uuid\s*\(\s*\d*\s*\)\s*\)/.test(attrs);

    // Extract `@map("col_name")` so SQL emission can target the real column.
    const fieldMapMatch = FIELD_MAP_RE.exec(attrs);
    const dbName = fieldMapMatch?.[1];

    // A field is a relation when (a) it has the explicit `@relation` attribute
    // — the owning side, with the FK declared in `fields:` — OR (b) its type
    // is the name of another model declared in this schema and it has no
    // `@db.*` scalar mapping. Case (b) covers virtual back-references
    // (typically `Model[]` lists, occasionally optional `Model?` singles)
    // where Prisma infers the relation purely from the type. UUID candidates
    // are scalar `Bytes`/`String` fields and never count as relations even if
    // their column type happens to be `Binary(16)` / `Char(36)`.
    const typeIsModel = modelNames.has(type);
    const isRelation =
      !isUuidCandidate && (hasRelationAttr || (typeIsModel && dbType === undefined));
    const relationTargetModel = isRelation ? type : undefined;

    currentFields.push({
      name,
      type,
      isList,
      isNullable,
      attributes: attrs,
      dbType,
      isUuidCandidate,
      isRelation,
      relationTargetModel,
      hasUuidDefault,
      dbName,
    });
  }

  const modelByName = new Map(models.map((m) => [m.name, m]));
  return { models, modelByName };
}

/**
 * Strip single-line comments (`//`). Prisma's schema language doesn't
 * support block comments, so we don't need to handle them.
 */
function stripComments(line: string): string {
  const idx = line.indexOf('//');
  if (idx === -1) return line;
  return line.substring(0, idx);
}
