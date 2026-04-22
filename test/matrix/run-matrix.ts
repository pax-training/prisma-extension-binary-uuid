#!/usr/bin/env tsx
/**
 * Matrix orchestrator: runs the integration suite against every DB version
 * in `db-versions.ts`, sequentially. Aggregates results and exits non-zero
 * if any target failed.
 *
 * Usage:
 *   pnpm test:matrix                       # run every target
 *   pnpm test:matrix mysql-8.0 mariadb-11  # run only named targets
 */

import { spawnSync } from 'node:child_process';

import { assertContainerRuntimeAvailable, CONTAINER_CLI } from '../integration/_fixtures/container.js';

import { DB_TARGETS, type DbTarget } from './db-versions.js';

assertContainerRuntimeAvailable();

interface TargetResult {
  readonly target: DbTarget;
  readonly durationMs: number;
  readonly passed: boolean;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

function resolveTargets(argv: readonly string[]): readonly DbTarget[] {
  const requested = argv.slice(2);
  if (requested.length === 0) return DB_TARGETS;
  const byLabel = new Map(DB_TARGETS.map((t) => [t.label, t]));
  const out: DbTarget[] = [];
  for (const label of requested) {
    const t = byLabel.get(label);
    if (t === undefined) {
      process.stderr.write(`Unknown target: ${label}\nKnown: ${DB_TARGETS.map((x) => x.label).join(', ')}\n`);
      process.exit(2);
    }
    out.push(t);
  }
  return out;
}

async function runOne(target: DbTarget): Promise<TargetResult> {
  const started = Date.now();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TEST_DB_IMAGE: target.image,
  };
  if (target.platform !== undefined) {
    env['TEST_DB_PLATFORM'] = target.platform;
  }
  const proc = spawnSync(
    'pnpm',
    ['vitest', 'run', 'test/integration', '--config', 'vitest.integration.config.ts'],
    {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  const durationMs = Date.now() - started;
  const stdoutTail = tail(proc.stdout ?? '', 40);
  const stderrTail = tail(proc.stderr ?? '', 20);
  return {
    target,
    durationMs,
    passed: proc.status === 0,
    stdoutTail,
    stderrTail,
  };
}

function tail(text: string, lines: number): string {
  return text.split(/\r?\n/).slice(-lines).join('\n');
}

async function main(): Promise<void> {
  const targets = resolveTargets(process.argv);
  process.stdout.write(`\n=== Integration matrix (${CONTAINER_CLI}) ===\n`);
  process.stdout.write(`Targets: ${targets.map((t) => t.label).join(', ')}\n\n`);

  const results: TargetResult[] = [];
  for (const target of targets) {
    process.stdout.write(`▶ ${target.label} (${target.image}) ... `);
    const r = await runOne(target);
    results.push(r);
    process.stdout.write(
      `${r.passed ? '✅ pass' : '❌ fail'}  (${(r.durationMs / 1000).toFixed(1)}s)\n`,
    );
    if (!r.passed) {
      process.stdout.write('--- stdout tail ---\n');
      process.stdout.write(r.stdoutTail);
      process.stdout.write('\n--- stderr tail ---\n');
      process.stdout.write(r.stderrTail);
      process.stdout.write('\n');
    }
  }

  // Summary table
  process.stdout.write('\n=== Summary ===\n');
  process.stdout.write('| target          | result | duration |\n');
  process.stdout.write('|-----------------|--------|----------|\n');
  for (const r of results) {
    const pad = (s: string, n: number): string => (s + ' '.repeat(n)).slice(0, n);
    process.stdout.write(
      `| ${pad(r.target.label, 15)} | ${r.passed ? ' ✅ ok ' : ' ❌ bad'} | ${pad(
        (r.durationMs / 1000).toFixed(1) + 's',
        8,
      )} |\n`,
    );
  }

  const anyFailed = results.some((r) => !r.passed);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err: unknown) => {
  process.stderr.write(`Matrix runner crashed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
