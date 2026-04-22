/**
 * Capture a benchmark baseline.
 *
 * Runs the same workloads as `walker-overhead.bench.ts` but in-process via
 * `mitata`'s harness so we get consistent, reproducible numbers — vitest's
 * bench harness has too much variance for a CI regression gate.
 *
 * Output: `test/benchmark/baselines/walker-overhead.baseline.json`. Commit
 * the file. `pnpm bench:check` re-runs the same suite and fails if any
 * metric regresses past the configured threshold.
 *
 * Usage:
 *   pnpm bench:baseline              # capture and write
 *   pnpm bench:baseline -- --print   # print to stdout, don't write
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bench, group, run } from 'mitata';

import { normalizeConfig } from '../../src/config/define-config.js';
import { uidFromBin, uidToBin } from '../../src/conversion/index.js';
import { walkArgs } from '../../src/walker/args-walker.js';
import { walkResult } from '../../src/walker/result-walker.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const BYTES = uidToBin(UUID);

const config = normalizeConfig({
  fields: {
    User: ['id', 'companyId'],
    Post: ['id', 'authorId'],
  },
  relations: {
    User: { posts: 'Post' },
    Post: { author: 'User' },
  },
});

const FINDMANY_IN_10_INPUT = { where: { id: { in: new Array(10).fill(UUID) } } };
const NESTED_CREATE_INPUT = {
  data: {
    email: 'a@b.c',
    posts: {
      create: [{ title: 'A', author: { connect: { id: UUID } } }, { title: 'B' }],
    },
  },
};
const FINDUNIQUE_RESULT = { id: BYTES, companyId: BYTES, name: 'a' };
const FINDMANY_1000_RESULT = new Array(1000).fill(FINDUNIQUE_RESULT);
const POSTS_5 = new Array(5).fill({ id: BYTES, authorId: BYTES, title: 't' });
const FINDMANY_100_NESTED_RESULT = new Array(100).fill({
  id: BYTES,
  companyId: BYTES,
  name: 'a',
  posts: POSTS_5,
});

group('conversion', () => {
  bench('uidToBin (dashed)', () => uidToBin(UUID));
  bench('uidFromBin', () => uidFromBin(BYTES));
});

group('walkArgs', () => {
  bench('findUnique by id', () => walkArgs(config, 'User', 'findUnique', { where: { id: UUID } }));
  bench('findMany with in [10]', () => walkArgs(config, 'User', 'findMany', FINDMANY_IN_10_INPUT));
  bench('nested create 3 levels deep', () =>
    walkArgs(config, 'User', 'create', NESTED_CREATE_INPUT),
  );
});

group('walkResult', () => {
  bench('findUnique (single row, 2 UUID fields)', () =>
    walkResult(config, 'User', 'findUnique', FINDUNIQUE_RESULT),
  );
  bench('findMany 1000 rows, 2 UUID fields each', () =>
    walkResult(config, 'User', 'findMany', FINDMANY_1000_RESULT),
  );
  bench('findMany 100 rows with 5 nested posts each', () =>
    walkResult(config, 'User', 'findMany', FINDMANY_100_NESTED_RESULT),
  );
});

interface MitataStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p75: number;
  p99: number;
}

interface MitataRun {
  name: string;
  stats: MitataStats | undefined;
  error: unknown;
}

interface MitataTrial {
  runs: MitataRun[];
  alias: string;
}

interface BaselineEntry {
  name: string;
  meanNs: number;
  p99Ns: number;
}

export interface Baseline {
  capturedAt: string;
  nodeVersion: string;
  platform: string;
  entries: BaselineEntry[];
}

export async function captureBaseline(): Promise<Baseline> {
  // Warm V8 a bit before measuring so the JIT has settled.
  for (let i = 0; i < 5_000; i++) {
    uidToBin(UUID);
    uidFromBin(BYTES);
  }

  // We want the structured trial data, but don't want mitata's TTY-formatted
  // (or json-formatted) output flooding stdout. Override `print` to a no-op.
  const { benchmarks } = (await run({
    format: 'json',
    colors: false,
    print: () => undefined,
  })) as { benchmarks: MitataTrial[] };

  const entries: BaselineEntry[] = [];
  for (const trial of benchmarks) {
    // For our suite each trial runs once (no args matrix), so runs[0] is the
    // single measurement set.
    const stats = trial.runs[0]?.stats;
    if (stats === undefined) {
      throw new Error(`bench "${trial.alias}" produced no stats`);
    }
    entries.push({
      name: trial.alias,
      meanNs: stats.avg,
      p99Ns: stats.p99,
    });
  }

  return {
    capturedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    entries,
  };
}

export function formatNs(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(2)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
  return `${(ns / 1_000_000).toFixed(2)} ms`;
}

export function baselinePathForPlatform(platform: string): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    'baselines',
    `walker-overhead.${platform}.json`,
  );
}

export const CURRENT_PLATFORM = `${process.platform}-${process.arch}`;
export const BASELINE_PATH = baselinePathForPlatform(CURRENT_PLATFORM);

async function main(): Promise<void> {
  const baseline = await captureBaseline();

  if (process.argv.includes('--print')) {
    process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
    return;
  }

  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  process.stdout.write(`baseline written: ${BASELINE_PATH}\n`);
  for (const e of baseline.entries) {
    process.stdout.write(`  ${e.name}: ${formatNs(e.meanNs)} mean, ${formatNs(e.p99Ns)} p99\n`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `bench:baseline failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
