/**
 * Regression gate for the walker benchmark suite.
 *
 * Re-captures the same workloads `bench:baseline` produced and compares the
 * mean ns/op for each entry against the committed baseline. Fails (exit 1)
 * if any entry's mean exceeds `baselineMean * (1 + REGRESSION_THRESHOLD)`.
 *
 * Threshold: 25% over baseline. We picked 25% (not 10% as we'd ideally like)
 * because microbench variance on shared CI runners is noisy — a 10% gate
 * produces flakes. If you want a tighter gate locally, run:
 *
 *   REGRESSION_THRESHOLD=0.10 pnpm bench:check
 */

import { existsSync, readFileSync } from 'node:fs';

import { BASELINE_PATH, captureBaseline, formatNs, type Baseline } from './capture-baseline.js';

const DEFAULT_THRESHOLD = 0.25;

function parseThreshold(): number {
  const raw = process.env['REGRESSION_THRESHOLD'];
  if (raw === undefined || raw === '') return DEFAULT_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`REGRESSION_THRESHOLD must be a positive number, got "${raw}"`);
  }
  return parsed;
}

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) {
    throw new Error(
      `baseline file not found at ${BASELINE_PATH} — run "pnpm bench:baseline" and commit the result first`,
    );
  }
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
