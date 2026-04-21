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
}

export interface ParsedModel {
  readonly name: string;
  readonly fields: readonly ParsedField[];
}

export interface ParsedSchema {
  readonly models: readonly ParsedModel[];
  readonly modelByName: ReadonlyMap<string, ParsedModel>;
}

const MODEL_OPEN_RE = /^model\s+(\w+)\s*\{/;
const FIELD_RE =
  /^\s*(?<name>\w+)\s+(?<type>\w+)(?<modifier>\?|\[\])?\s*(?<attrs>.*)$/;
const DB_TYPE_RE = /@db\.(\w+(?:\([^)]+\))?)/;
const RELATION_RE = /@relation\b/;

export function parseSchema(source: string): ParsedSchema {
  const lines = source.split(/\r?\n/);
  const models: ParsedModel[] = [];

  let currentModel: string | null = null;
  let currentFields: ParsedField[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const stripped = stripComments(line).trim();
    if (stripped.length === 0) continue;

    if (currentModel === null) {
      const m = MODEL_OPEN_RE.exec(stripped);
      if (m !== null) {
        currentModel = m[1]!;
        currentFields = [];
      }
      continue;
    }

    // Inside a model block.
    if (stripped === '}') {
      models.push({ name: currentModel, fields: currentFields });
      currentModel = null;
      currentFields = [];
      continue;
    }

    // Skip `@@` model-level attributes.
    if (stripped.startsWith('@@')) continue;

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
    const isRelation = RELATION_RE.test(attrs);
    const isUuidCandidate = (type === 'Bytes' && isBinary16) || (type === 'String' && isChar36);

    // Detect @default(uuid()) / @default(uuid(7))
    const hasUuidDefault = /@default\s*\(\s*uuid\s*\(\s*\d*\s*\)\s*\)/.test(attrs);

    // If it's a relation scalar field (e.g., `authorId String`), its `type` is
    // scalar and `attrs` doesn't contain @relation. If it's the *relation*
    // field itself (e.g., `author User @relation(...)`), its type is a model
    // name and attrs contains @relation.
    let relationTargetModel: string | undefined;
    if (isRelation) {
      relationTargetModel = type;
    }

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
