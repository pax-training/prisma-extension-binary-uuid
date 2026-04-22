/**
 * Unit tests for the CLI command handlers. Each test uses a fresh tmpdir
 * so we never touch repo state.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { runInit, runMigrateSql, runValidate } from '../../cli/commands.js';

const SCHEMA = `
generator client { provider = "prisma-client-js" }
datasource db { provider = "mysql" }

model User {
  id        String   @id @default(uuid()) @db.Char(36)
  email     String   @unique
  companyId String?  @db.Char(36)
  company   Company? @relation(fields: [companyId], references: [id])
}

model Company {
  id    String @id @default(uuid()) @db.Char(36)
  name  String
  users User[]
}
`;

let workDir: string;
let schemaPath: string;
let configPath: string;
// `process.stdout.write` has overloaded signatures, so the spy's generic
// resolves to a union that vitest's MockInstance cannot represent cleanly.
// Hold the spies as `unknown` and restore via the same handle.
let stdoutSpy: { mockRestore: () => void };
let stderrSpy: { mockRestore: () => void };
let stdoutBuf: string;
let stderrBuf: string;

type WriteFn = (
  chunk: string | Uint8Array,
  encoding?: BufferEncoding | ((err?: Error | null) => void),
  cb?: (err?: Error | null) => void,
) => boolean;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'pebu-cli-test-'));
  schemaPath = join(workDir, 'schema.prisma');
  configPath = join(workDir, 'uuid-config.ts');
  writeFileSync(schemaPath, SCHEMA, 'utf8');

  stdoutBuf = '';
  stderrBuf = '';
  const stdoutImpl: WriteFn = (chunk) => {
    stdoutBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  };
  const stderrImpl: WriteFn = (chunk) => {
    stderrBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  };
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(stdoutImpl as never);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(stderrImpl as never);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

describe('runInit', () => {
  test('generates a config file from a schema', () => {
    const code = runInit({ schema: schemaPath, out: configPath });
    expect(code).toBe(0);
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain('defineBinaryUuidConfig');
    expect(content).toContain("User: ['companyId', 'id']");
    expect(content).toContain("Company: ['id']");
    expect(stdoutBuf).toContain('models with UUID fields: 2');
    expect(stdoutBuf).toContain('UUID fields total:       3');
  });

  test('refuses to overwrite an existing output file without --force', () => {
    writeFileSync(configPath, '// existing', 'utf8');
    const code = runInit({ schema: schemaPath, out: configPath });
    expect(code).toBe(1);
    expect(stderrBuf).toContain('already exists');
    expect(readFileSync(configPath, 'utf8')).toBe('// existing');
  });

  test('overwrites with --force', () => {
    writeFileSync(configPath, '// existing', 'utf8');
    const code = runInit({ schema: schemaPath, out: configPath, force: true });
    expect(code).toBe(0);
    expect(readFileSync(configPath, 'utf8')).toContain('defineBinaryUuidConfig');
  });

  test('exits non-zero when the schema file is missing', () => {
    const code = runInit({ schema: join(workDir, 'nope.prisma'), out: configPath });
    expect(code).toBe(1);
    expect(stderrBuf).toContain('schema file not found');
    expect(existsSync(configPath)).toBe(false);
  });

  test('creates intermediate directories for the output path', () => {
    const nested = join(workDir, 'deep', 'nested', 'uuid-config.ts');
    const code = runInit({ schema: schemaPath, out: nested });
    expect(code).toBe(0);
    expect(existsSync(nested)).toBe(true);
  });
});

describe('runValidate', () => {
  test('passes when the config matches the schema', () => {
    runInit({ schema: schemaPath, out: configPath });
    stdoutBuf = '';
    stderrBuf = '';
    const code = runValidate({ schema: schemaPath, config: configPath });
    expect(code).toBe(0);
    expect(stdoutBuf).toContain('ok: config is in sync');
  });

  test('reports drift when the schema adds a new UUID field', () => {
    runInit({ schema: schemaPath, out: configPath });
    writeFileSync(
      schemaPath,
      SCHEMA.replace(
        'email     String   @unique',
        'email  String @unique\n  altId Bytes @db.Binary(16)',
      ),
      'utf8',
    );
    stdoutBuf = '';
    stderrBuf = '';
    const code = runValidate({ schema: schemaPath, config: configPath });
    expect(code).toBe(1);
    expect(stderrBuf).toContain('drift detected');
  });

  test('exits 1 when the config file is missing', () => {
    const code = runValidate({ schema: schemaPath, config: join(workDir, 'missing.ts') });
    expect(code).toBe(1);
    expect(stderrBuf).toContain('config file not found');
  });

  test('exits 1 when the schema is missing', () => {
    writeFileSync(configPath, 'placeholder', 'utf8');
    const code = runValidate({
      schema: join(workDir, 'missing-schema.prisma'),
      config: configPath,
    });
    expect(code).toBe(1);
    expect(stderrBuf).toContain('schema file not found');
  });
});

describe('runMigrateSql', () => {
  test('prints SQL to stdout when no --output is given', () => {
    const code = runMigrateSql({ schema: schemaPath, output: undefined });
    expect(code).toBe(0);
    expect(stdoutBuf).toContain('Phase 0: preflight');
    expect(stdoutBuf).toContain('ALTER TABLE `User`');
    expect(stdoutBuf).toContain('UUID_TO_BIN(`id`, 1)');
  });

  test('writes SQL to file when --output is given', () => {
    const out = join(workDir, 'migrate.sql');
    const code = runMigrateSql({ schema: schemaPath, output: out });
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const content = readFileSync(out, 'utf8');
    expect(content).toContain('ALTER TABLE `User`');
  });

  test('respects --swap-flag 0', () => {
    const out = join(workDir, 'migrate.sql');
    runMigrateSql({ schema: schemaPath, output: out, swapFlag: 0 });
    const content = readFileSync(out, 'utf8');
    expect(content).toContain('UUID_TO_BIN(`id`, 0)');
    expect(content).not.toContain('UUID_TO_BIN(`id`, 1)');
  });

  test('emits MariaDB-portable SQL when --dialect mariadb', () => {
    const out = join(workDir, 'migrate-mariadb.sql');
    runMigrateSql({ schema: schemaPath, output: out, dialect: 'mariadb' });
    const content = readFileSync(out, 'utf8');
    expect(content).toContain("UNHEX(REPLACE(`id`, '-', ''))");
    expect(content).not.toContain('UUID_TO_BIN');
    expect(content).toContain('-- Dialect: mariadb');
  });

  test('emits MySQL SQL by default (backwards compat)', () => {
    const out = join(workDir, 'migrate-default.sql');
    runMigrateSql({ schema: schemaPath, output: out });
    const content = readFileSync(out, 'utf8');
    expect(content).toContain('UUID_TO_BIN(`id`, 1)');
    expect(content).toContain('-- Dialect: mysql');
  });

  test('exits 1 when the schema is missing', () => {
    const code = runMigrateSql({ schema: join(workDir, 'nope.prisma'), output: undefined });
    expect(code).toBe(1);
    expect(stderrBuf).toContain('schema file not found');
  });

  test('creates intermediate dirs for the output path', () => {
    const out = join(workDir, 'deep', 'dir', 'migrate.sql');
    const code = runMigrateSql({ schema: schemaPath, output: out });
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
  });
});
