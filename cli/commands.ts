/**
 * CLI command handlers. Each returns a number (process exit code).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildRegistry } from './build-registry.js';
import { emitConfig } from './emit-config.js';
import { emitMigrationSql } from './emit-migration-sql.js';
import { parseSchema } from './parse-schema.js';

export interface InitOptions {
  readonly schema: string;
  readonly out: string;
  readonly force?: boolean;
}

export function runInit(options: InitOptions): number {
  const schemaPath = resolve(options.schema);
  const outPath = resolve(options.out);

  if (!existsSync(schemaPath)) {
    process.stderr.write(`Error: schema file not found at ${schemaPath}\n`);
    return 1;
  }
  if (existsSync(outPath) && options.force !== true) {
    process.stderr.write(
      `Error: ${outPath} already exists. Re-run with --force to overwrite, or remove the file first.\n`,
    );
    return 1;
  }

  const source = readFileSync(schemaPath, 'utf8');
  const parsed = parseSchema(source);
  const built = buildRegistry(parsed);
  const emitted = emitConfig(built.config);

  const outDir = dirname(outPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(outPath, emitted, 'utf8');

  process.stdout.write(
    `Wrote ${outPath}\n` +
      `  models with UUID fields: ${built.stats.models}\n` +
      `  UUID fields total:       ${built.stats.uuidFields}\n` +
      `  auto-generated fields:   ${built.stats.autoGenFields}\n` +
      `  relations tracked:       ${built.stats.relations}\n`,
  );
  return 0;
}

export interface ValidateOptions {
  readonly schema: string;
  readonly config: string;
}

export function runValidate(options: ValidateOptions): number {
  const schemaPath = resolve(options.schema);
  const configPath = resolve(options.config);

  if (!existsSync(schemaPath)) {
    process.stderr.write(`Error: schema file not found at ${schemaPath}\n`);
    return 1;
  }
  if (!existsSync(configPath)) {
    process.stderr.write(`Error: config file not found at ${configPath}\n`);
    return 1;
  }

  const source = readFileSync(schemaPath, 'utf8');
  const parsed = parseSchema(source);
  const built = buildRegistry(parsed);
  const expected = emitConfig(built.config);
  const actual = readFileSync(configPath, 'utf8');

  if (expected.trim() === actual.trim()) {
    process.stdout.write('ok: config is in sync with schema\n');
    return 0;
  }

  process.stderr.write(
    `drift detected: config at ${configPath} does not match schema at ${schemaPath}\n`,
  );
  process.stderr.write(`Re-run \`prisma-extension-binary-uuid init --force\` to regenerate.\n`);
  return 1;
}

export interface MigrateSqlOptions {
  readonly schema: string;
  readonly output: string | undefined;
  readonly swapFlag?: 0 | 1;
}

export function runMigrateSql(options: MigrateSqlOptions): number {
  const schemaPath = resolve(options.schema);
  if (!existsSync(schemaPath)) {
    process.stderr.write(`Error: schema file not found at ${schemaPath}\n`);
    return 1;
  }

  const source = readFileSync(schemaPath, 'utf8');
  const parsed = parseSchema(source);
  const sql = emitMigrationSql(
    parsed,
    options.swapFlag !== undefined ? { swapFlag: options.swapFlag } : {},
  );

  if (options.output !== undefined) {
    const outPath = resolve(options.output);
    const outDir = dirname(outPath);
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }
    writeFileSync(outPath, sql, 'utf8');
    process.stdout.write(`Wrote ${outPath}\n`);
  } else {
    process.stdout.write(sql);
  }
  return 0;
}
