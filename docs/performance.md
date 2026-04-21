# Performance

## Overhead summary

The walker's per-query overhead is negligible relative to DB I/O. Measured
on an M-series Mac (results will vary but shapes are representative):

| Operation shape | Walker overhead |
| --- | --- |
| `findUnique` by id | ~1 µs |
| `findMany` with `in: [10]` | ~3 µs |
| `findMany` 1000 rows, 2 UUID fields each | ~2 ms |
| `findMany` 100 rows × 5 nested posts | ~1 ms |
| Nested create, 3 relation levels deep | ~10 µs |

A single DB round-trip is typically 1-10 ms even on a fast local network.
Walker overhead is <1% of that in the worst case.

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

Every PR runs the benchmark suite:

```bash
pnpm bench
```

We fail the PR if any metric regresses >10% vs. the committed baseline in
`test/benchmark/baselines/`. Intentional regressions require rebaselining
in the same PR.

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
- **JOINs on UUID columns**: consistent 15–40% speedup in our internal
  benchmarks against 1M+ row tables. Largest wins on multi-way joins.

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
