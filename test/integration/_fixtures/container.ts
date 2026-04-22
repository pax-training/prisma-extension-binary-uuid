/**
 * Testcontainers helpers for spinning up ephemeral MySQL/MariaDB instances
 * per test suite.
 *
 * The container image is controlled by the `TEST_DB_IMAGE` env var, which
 * lets the matrix orchestrator fan tests out across multiple DB versions.
 * Defaults to `mysql:8.0` for local runs.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const DEFAULT_IMAGE = 'mysql:8.0';

export interface TestDb {
  readonly url: string;
  readonly container: StartedTestContainer;
  stop(): Promise<void>;
}

/**
 * Check for pre-flight gating via env var. Tests call this in a suite-level
 * `beforeAll` and gracefully skip if Testcontainers can't find a runtime.
 *
 * Set `TESTCONTAINERS_SKIP=1` to skip entirely (useful for Mac podman setups
 * where the socket bridge is fragile, or when dependencies are missing).
 */
export function shouldSkipIntegration(): string | null {
  if (process.env['TESTCONTAINERS_SKIP'] === '1') {
    return 'TESTCONTAINERS_SKIP=1 — integration tests explicitly skipped';
  }
  return null;
}

/**
 * Start a fresh DB container, create the schema, and return the connection
 * URL. The schema is pushed via `prisma db push` which requires a real schema
 * on disk — we write a temp copy if the caller didn't provide one.
 */
export async function startTestDb(options?: { image?: string }): Promise<TestDb> {
  const image = options?.image ?? process.env['TEST_DB_IMAGE'] ?? DEFAULT_IMAGE;
  const isMariaDb = image.startsWith('mariadb');
  const password = 'test-pw';
  const database = 'test';

  const envVars: Record<string, string> = isMariaDb
    ? { MARIADB_ROOT_PASSWORD: password, MARIADB_DATABASE: database }
    : { MYSQL_ROOT_PASSWORD: password, MYSQL_DATABASE: database };

  // MySQL/MariaDB images log "ready for connections" once when the DB engine
  // boots and again when it's actually listening on the network. We need the
  // second one. Wait for it, then still poll the wire protocol to be safe —
  // on GitHub Actions runners there's occasionally a gap between the log line
  // and accept().
  const container = await new GenericContainer(image)
    .withEnvironment(envVars)
    // MySQL 8+ defaults to caching_sha2_password; the mariadb driver
    // (both npm and @prisma/adapter-mariadb) negotiates it correctly on
    // recent versions, but forcing native_password avoids edge cases with
    // older clients that might be active in CI.
    .withCommand(
      isMariaDb
        ? []
        : ['--default-authentication-plugin=mysql_native_password'],
    )
    .withExposedPorts(3306)
    .withStartupTimeout(300_000)
    .withWaitStrategy(
      Wait.forLogMessage(/ready for connections.+port: 3306/, 2).withStartupTimeout(300_000),
    )
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(3306);
  const url = `mysql://root:${password}@${host}:${port}/${database}`;

  // Poll until the server accepts connections.
  await waitForDb(url, 60_000);

  // Push schema.
  const schemaDir = mkdtempSync(join(tmpdir(), 'pebu-test-'));
  const schemaPath = join(schemaDir, 'schema.prisma');
  writeFileSync(schemaPath, resolveTestSchema(), 'utf8');

  execSync(`npx prisma db push --schema="${schemaPath}" --skip-generate --accept-data-loss`, {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'automated-test' },
  });

  return {
    url,
    container,
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * Poll mysql until it accepts connections. Testcontainers reports ready
 * before mysqld is actually listening, so we need our own readiness probe.
 */
async function waitForDb(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Dynamic import to keep mariadb client optional for unit tests.
  const mariadb = (await import('mariadb')) as typeof import('mariadb');
  while (Date.now() < deadline) {
    try {
      const conn = await mariadb.createConnection(url);
      await conn.query('SELECT 1');
      await conn.end();
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Database at ${url} did not accept connections within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Inline the integration-test schema so we don't have file-system dependencies
 * on paths that differ between dev and CI.
 */
function resolveTestSchema(): string {
  // Read the repo schema at test time. Located via process.cwd() because the
  // test runner sets it to the repo root.
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  return readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
}
