/**
 * Direct-podman container orchestrator for integration tests.
 *
 * We deliberately do NOT use Testcontainers here — on macOS with podman, the
 * socket/port-forwarding bridge between the Mac host and the podman VM is
 * fragile and adds failure modes we don't need. Instead, we shell out to
 * `podman run` directly with a port we pick, wait for readiness via log tail,
 * and tear down explicitly.
 *
 * This works identically on:
 *   - macOS + podman (with podman-machine running)
 *   - Linux + podman
 *   - Linux + Docker (via PODMAN_CMD=docker)
 *   - GitHub Actions (via PODMAN_CMD=docker)
 *
 * Controlled by:
 *   - `TEST_DB_IMAGE` — which image to spin (default `mysql:8.0`)
 *   - `PODMAN_CMD`    — which CLI to invoke (default auto-detect)
 */

import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_IMAGE = 'mysql:8.0';

export interface TestDb {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly image: string;
  stop(): Promise<void>;
}

// Auto-detect docker vs podman once per process.
const CLI: string = detectCli();
function detectCli(): string {
  if (process.env['PODMAN_CMD'] !== undefined && process.env['PODMAN_CMD'] !== '') {
    return process.env['PODMAN_CMD'];
  }
  try {
    execSync('docker --version', { stdio: 'pipe' });
    return 'docker';
  } catch {
    // fall through
  }
  try {
    execSync('podman --version', { stdio: 'pipe' });
    return 'podman';
  } catch {
    throw new Error(
      'Neither docker nor podman is installed. Integration tests require one of them.',
    );
  }
}

/**
 * No-op — kept for API compatibility with the prior Testcontainers-based
 * helper. We now support every environment this library ships on, so there's
 * nothing to gate.
 */
export function shouldSkipIntegration(): string | null {
  return null;
}

/**
 * Pick a random high port to avoid collisions. We don't test against a
 * specific port; the only contract is that we return the connection URL.
 */
function pickPort(): number {
  return 20_000 + Math.floor(Math.random() * 40_000);
}

/**
 * Start a fresh DB container, wait for readiness, push the schema, and return
 * the connection URL + teardown handle.
 */
export async function startTestDb(options?: { image?: string }): Promise<TestDb> {
  const image = options?.image ?? process.env['TEST_DB_IMAGE'] ?? DEFAULT_IMAGE;
  const isMariaDb = image.startsWith('mariadb');
  const password = 'test-pw';
  const database = 'test';
  const port = pickPort();
  const containerName = `pebu-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const env = isMariaDb
    ? ['-e', `MARIADB_ROOT_PASSWORD=${password}`, '-e', `MARIADB_DATABASE=${database}`]
    : ['-e', `MYSQL_ROOT_PASSWORD=${password}`, '-e', `MYSQL_DATABASE=${database}`];

  // We deliberately don't pass --default-authentication-plugin: MySQL 8.4
  // removed it (use authentication_policy). MySQL 8.0 + the mariadb npm
  // driver negotiate caching_sha2_password via allowPublicKeyRetrieval=true
  // (set on the connection URL below).
  const platform = process.env['TEST_DB_PLATFORM'];
  const platformFlag = platform !== undefined && platform !== '' ? `--platform ${platform}` : '';
  execSync(
    `${CLI} run -d --rm ${platformFlag} --name ${containerName} ${env.join(' ')} -p ${port}:3306 ${image}`,
    { stdio: 'pipe' },
  );

  // Poll logs for the "ready for connections" line on port 3306 (the network
  // one, not the internal init one). MySQL 8+ logs it with "port: 3306"; so
  // does MariaDB 10.6+ in its own format.
  await waitForReadyLog(containerName, 180_000);

  // Actually connect via the wire protocol to confirm. Belt + suspenders.
  const host = 'localhost';
  await waitForWireProtocol(host, port, password, database, 60_000);

  // `allowPublicKeyRetrieval=true` is required for the mariadb npm driver to
  // negotiate caching_sha2_password (MySQL 8+ default). Safe in test/CI
  // because we control the password and the network.
  const url = `mysql://root:${password}@${host}:${port}/${database}?allowPublicKeyRetrieval=true`;

  // Push schema via prisma db push.
  const schemaDir = mkdtempSync(join(tmpdir(), 'pebu-test-'));
  const schemaPath = join(schemaDir, 'schema.prisma');
  writeFileSync(schemaPath, readSchema(), 'utf8');

  // Write a tiny prisma.config.ts in the temp dir so prisma db push (Prisma 7)
  // can resolve a datasource URL without us injecting it via env.
  const configPath = join(schemaDir, 'prisma.config.ts');
  writeFileSync(
    configPath,
    `export default { schema: "${schemaPath}", datasource: { url: "${url}" } };\n`,
    'utf8',
  );

  execSync(
    `npx prisma db push --config="${configPath}" --schema="${schemaPath}" --accept-data-loss`,
    {
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: url,
        PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'automated-test',
      },
    },
  );

  return {
    url,
    host,
    port,
    image,
    stop: async () => {
      try {
        execSync(`${CLI} rm -f ${containerName}`, { stdio: 'pipe' });
      } catch {
        // already gone — fine
      }
    },
  };
}

function readSchema(): string {
  return readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
}

/**
 * Tail container logs until we see "ready for connections" on the network
 * port, or time out.
 */
async function waitForReadyLog(containerName: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // MySQL: "/usr/sbin/mysqld: ready for connections. Version: '8.0.x' ... port: 3306"
  // MariaDB: "mariadbd: ready for connections."
  const mysqlReady = /mysqld: ready for connections\./i;
  const mariaReady = /mariadbd: ready for connections\./i;

  while (Date.now() < deadline) {
    try {
      const logs = execSync(`${CLI} logs ${containerName} 2>&1`, {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      if (mariaReady.test(logs)) return; // MariaDB — network-ready on first match
      const matches = logs.match(new RegExp(mysqlReady, 'g'));
      if (matches !== null && matches.length >= 2) return;
      if (matches !== null && matches.length >= 1) return; // single-emit images
      // (waitForWireProtocol below catches false positives)
    } catch {
      // logs not ready yet
    }
    await sleep(500);
  }
  throw new Error(
    `Container ${containerName} never logged "ready for connections" within ${timeoutMs}ms`,
  );
}

/**
 * Connect via mariadb driver until success. Handles the gap between log-line
 * and real accept() availability.
 */
async function waitForWireProtocol(
  host: string,
  port: number,
  password: string,
  database: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const mariadb = (await import('mariadb')) as typeof import('mariadb');
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const conn = await mariadb.createConnection({
        host,
        port,
        user: 'root',
        password,
        database,
        connectTimeout: 5_000,
        // Same reasoning as the URL: required for caching_sha2_password
        // negotiation against MySQL 8+ images.
        allowPublicKeyRetrieval: true,
      });
      await conn.query('SELECT 1');
      await conn.end();
      return;
    } catch (err) {
      lastErr = err;
      await sleep(500);
    }
  }
  throw new Error(
    `Could not connect via wire protocol to ${host}:${port} within ${timeoutMs}ms: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Used by the matrix runner to sanity-check that the CLI works before we try
 * anything else.
 */
export function assertContainerRuntimeAvailable(): void {
  try {
    execSync(`${CLI} ps`, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(
      `Container runtime "${CLI}" is installed but not responsive: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// Exported so matrix.ts can coordinate with a known CLI name.
export const CONTAINER_CLI = CLI;
// Exported for legacy callers that imported the spawn helper.
export { spawn };
