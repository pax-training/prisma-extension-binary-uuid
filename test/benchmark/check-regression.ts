/**
 * Regression gate for the walker benchmark suite.
 *
 * Re-captures the same workloads `bench:baseline` produced and compares the
 * mean ns/op for each entry against the committed baseline. Fails (exit 1)
 * if any entry's mean exceeds `baselineMean * (1 + REGRESSION_THRESHOLD)`.
 *
 * Threshold: 35% over baseline by default. We started at 10%, learned that
 * GitHub Actions runners have 15–25% run-to-run variance across different
 * Azure host classes, and settled at 35% which empirically catches real
 * regressions (50%+ walker slowdowns) without flaking on runner swaps.
 * If you want a tighter gate on your own hardware, run:
 *
 *   REGRESSION_THRESHOLD=0.10 pnpm bench:check
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  BASELINE_PATH,
  CURRENT_PLATFORM,
  captureBaseline,
  formatNs,
  type Baseline,
} from './capture-baseline.js';

const DEFAULT_THRESHOLD = 0.35;

function parseThreshold(): number {
  const raw = process.env['REGRESSION_THRESHOLD'];
  if (raw === undefined || raw === '') return DEFAULT_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`REGRESSION_THRESHOLD must be a positive number, got "${raw}"`);
  }
  return parsed;
}

function loadBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  const text = readFileSync(BASELINE_PATH, 'utf8');
  return JSON.parse(text) as Baseline;
}

interface RegressionRow {
  name: string;
  baselineMean: number;
  currentMean: number;
  deltaPct: number;
  regressed: boolean;
}

async function main(): Promise<void> {
  const threshold = parseThreshold();
  const baseline = loadBaseline();
  if (baseline === null) {
    // Platform-keyed baselines mean a new runner (e.g. first-time Linux CI
    // after only a Mac baseline was committed) starts unarmed. Capture,
    // write the file (so an artifact upload can surface it for commit),
    // and exit 0 — this is first-run bootstrap, not a regression.
    process.stderr.write(
      `no committed baseline for platform "${CURRENT_PLATFORM}" — capturing one now for informational output.\n` +
        `Commit test/benchmark/baselines/walker-overhead.${CURRENT_PLATFORM}.json to arm the gate on this platform.\n\n`,
    );
    const fresh = await captureBaseline();
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
    process.stdout.write(`bench numbers on ${CURRENT_PLATFORM} (written to ${BASELINE_PATH}):\n`);
    for (const e of fresh.entries) {
      process.stdout.write(`  ${e.name.padEnd(48)}  ${formatNs(e.meanNs)} mean\n`);
    }
    return;
  }

  const baselineMap = new Map<string, number>();
  for (const e of baseline.entries) {
    baselineMap.set(e.name, e.meanNs);
  }

  process.stderr.write('capturing current bench numbers (this takes ~20s)…\n');
  const current = await captureBaseline();

  const rows: RegressionRow[] = [];
  for (const e of current.entries) {
    const baselineMean = baselineMap.get(e.name);
    if (baselineMean === undefined) {
      // New benchmark not yet in baseline — non-fatal but report it.
      process.stderr.write(
        `note: bench "${e.name}" has no baseline entry; rebaseline to include it\n`,
      );
      continue;
    }
    const deltaPct = (e.meanNs - baselineMean) / baselineMean;
    rows.push({
      name: e.name,
      baselineMean,
      currentMean: e.meanNs,
      deltaPct,
      regressed: deltaPct > threshold,
    });
  }

  process.stdout.write(`\nregression check (threshold: +${(threshold * 100).toFixed(0)}%)\n`);
  process.stdout.write(`baseline captured: ${baseline.capturedAt} (${baseline.platform})\n\n`);
  for (const r of rows) {
    const sign = r.deltaPct >= 0 ? '+' : '';
    const marker = r.regressed ? ' ❌ REGRESSED' : '';
    process.stdout.write(
      `  ${r.name.padEnd(48)}  ${formatNs(r.baselineMean).padStart(10)}` +
        `  →  ${formatNs(r.currentMean).padStart(10)}` +
        `  (${sign}${(r.deltaPct * 100).toFixed(1)}%)${marker}\n`,
    );
  }

  const regressed = rows.filter((r) => r.regressed);
  if (regressed.length > 0) {
    process.stderr.write(
      `\n${regressed.length} benchmark(s) regressed past ${(threshold * 100).toFixed(0)}%\n`,
    );
    process.stderr.write(
      'if intentional, re-run `pnpm bench:baseline` and commit the updated baseline.\n',
    );
    process.exit(1);
  }
  process.stdout.write('\nno regressions detected.\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`bench:check failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
