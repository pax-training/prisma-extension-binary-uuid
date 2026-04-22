# Performance

## Overhead summary

The walker's per-query overhead is negligible relative to DB I/O. Numbers
below are the committed baseline at
`test/benchmark/baselines/walker-overhead.baseline.json`, captured on an
Apple M2 Max under Node v25 with `mitata`. Re-capture with
`pnpm bench:baseline`; CI fails any PR that regresses past 25% (configurable
via `REGRESSION_THRESHOLD`).

| Operation shape                            | Walker overhead (mean) | p99     |
| ------------------------------------------ | ---------------------- | ------- |
| `uidToBin` (single string → binary)        | 135 ns                 | 172 ns  |
| `uidFromBin` (single binary → string)      | 114 ns                 | 165 ns  |
| `walkArgs` `findUnique` by id              | 224 ns                 | 266 ns  |
| `walkArgs` `findMany` with `in: [10]`      | 1.70 µs                | 1.78 µs |
| `walkArgs` nested create, 3 levels deep    | 1.97 µs                | 2.07 µs |
| `walkResult` `findUnique` (2 UUID fields)  | 452 ns                 | 507 ns  |
| `walkResult` `findMany` 1000 rows × 2 ids  | 456 µs                 | 695 µs  |
| `walkResult` `findMany` 100 rows × 5 posts | 281 µs                 | 463 µs  |

A single DB round-trip is typically 1-10 ms even on a fast local network.
Walker overhead is <1% of that in the worst case (1000-row findMany).

## Measuring in your app

Wire the `metrics.onQuery` hook to your observability stack:

```ts
createBinaryUuidExtension({
  ...config,
  options: {
    metrics: {
      onQuery: ({ model, operation, durationMs, argsConverted, resultConverted }) => {
        otel.histogram('prisma.extension.binary_uuid.duration_ms', durationMs, {
          model,
          operation,
        });
        otel.counter('prisma.extension.binary_uuid.args_converted').add(argsConverted);
        otel.counter('prisma.extension.binary_uuid.result_converted').add(resultConverted);
      },
    },
  },
});
```

## Regression gate in CI

Every PR runs:

```bash
pnpm bench:check
```

This re-runs the suite via `mitata` (consistent harness, ~25s) and fails
the PR if any benchmark's mean ns/op exceeds the committed baseline at
`test/benchmark/baselines/walker-overhead.baseline.json` by more than 25%.
Intentional regressions require running `pnpm bench:baseline` and
committing the updated baseline in the same PR.

The 25% threshold accounts for the variance that shared CI runners
exhibit on microbenchmarks. To run a tighter gate locally:

```bash
REGRESSION_THRESHOLD=0.10 pnpm bench:check
```

## Storage savings

The disk-level win compounds across three places:

1. **Row storage**: 20 bytes saved per UUID per row (36 → 16 bytes).
2. **Primary key clustering**: InnoDB tables cluster by PK. A smaller PK
   means more rows fit per leaf page, which means fewer page reads for
   range scans.
3. **Secondary indexes**: InnoDB secondary indexes include the PK as a
   pointer. Smaller PKs mean smaller secondary indexes too.

For a table with ~4 UUID columns and ~5 indexes, savings are typically
**~55-60% total bytes on disk** after migration.

## Query latency win

On indexed UUID lookups, the row-size win translates to measurable query
latency improvements:

- **Point lookups**: minor gain (same number of B-tree levels, just
  smaller comparison cost per step)
- **Range scans**: meaningful gain — more rows per page means fewer I/O
  operations for the same result set
- **JOINs on UUID columns**: smaller PKs propagate into every secondary
  index (InnoDB stores the PK as the leaf pointer), so multi-way joins on
  UUID columns get the largest wins. Magnitude depends on row count, page
  cache pressure, and join arity — measure your workload.

## When these wins matter

Binary UUID storage is worth the extension's maintenance cost when:

- You have tables with millions of rows and UUID-heavy schemas
- Your workload is JOIN-heavy
- Disk I/O (or cloud I/O pricing) is a real cost
- Your index cache (InnoDB buffer pool) is the bottleneck

It's probably not worth it when:

- Your DB is comfortably in RAM already
- Tables are small (<100K rows)
- Your bottleneck is application code, not DB

Measure before assuming.

## Running benchmarks locally

```bash
pnpm bench                 # run all benchmarks with vitest bench
pnpm bench:baseline        # capture baseline to disk
```

Benchmarks use `mitata` for high-resolution timing. Output includes p50,
p95, p99, and ops/sec.
