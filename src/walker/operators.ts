/**
 * Prisma query-operator taxonomy.
 *
 * The args walker needs to know which object keys are Prisma operators vs.
 * field names vs. relation names. This module exports typed sets for each
 * category. They're frozen at module load so the walker can use `has()` in
 * O(1) without allocation.
 */

/**
 * Scalar operators: their value is the same shape as the parent field
 * (single value or array of values). These DON'T change the model scope.
 *
 * Example: `{ id: { in: [...] } }` — `in` is a scalar operator under `id`.
 */
export const SCALAR_OPERATORS: ReadonlySet<string> = new Set([
  'equals',
  'not',
  'in',
  'notIn',
  'lt',
  'lte',
  'gt',
  'gte',
  // String-only, but harmless in a general set.
  'contains',
  'startsWith',
  'endsWith',
  'search',
  'mode',
]);

/**
 * Operators whose value is an array of the same parent shape. Callers can
 * safely iterate the array and re-apply conversion.
 */
export const ARRAY_SCALAR_OPERATORS: ReadonlySet<string> = new Set([
  'in',
  'notIn',
  'hasSome',
  'hasEvery',
]);

/**
 * Relation filter operators: their value is a nested where-clause in the
 * SCOPE OF THE RELATED MODEL. The walker must pivot to that model.
 *
 * Example: `{ posts: { some: { authorId: 'x' } } }` — `some` operates in
 * the scope of the relation target.
 */
export const RELATION_FILTER_OPERATORS: ReadonlySet<string> = new Set([
  'some',
  'every',
  'none',
  'is',
  'isNot',
]);

/**
 * Logical combinators: their value is an array (or single object) of the
 * same shape as the parent clause. Model scope is preserved.
 *
 * Example: `{ AND: [{ id: 'x' }, { name: 'y' }] }`.
 */
export const LOGICAL_COMBINATORS: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT']);

/**
 * Nested-write operations (inside `data`). Each value contains a sub-object
 * keyed by the RELATED MODEL's fields. The walker pivots model scope.
 *
 * Example: `{ author: { connect: { id: 'x' } } }`.
 */
export const WRITE_NESTED_OPERATORS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'connect',
  'connectOrCreate',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'set',
  'disconnect',
]);

/**
 * Operators that appear in update expressions on scalar fields. Their value
 * is the scalar (or something structured like `{ increment: n }`).
 *
 * Example: `{ id: { set: 'x' } }` during update.
 */
export const UPDATE_SCALAR_OPERATORS: ReadonlySet<string> = new Set([
  'set',
  'increment',
  'decrement',
  'multiply',
  'divide',
]);

/**
 * Aggregation result keys. When the walker hits a result object with these
 * keys, it needs to recurse into their nested objects using the SAME model
 * scope as the aggregation root.
 *
 * Example: `{ _max: { id: Buffer(16) }, _count: { _all: 10 } }`.
 */
export const AGGREGATION_RESULT_KEYS: ReadonlySet<string> = new Set([
  '_count',
  '_avg',
  '_sum',
  '_min',
  '_max',
]);

/**
 * Operations that include a `data` field with input to transform.
 */
export const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);

/**
 * Operations that accept a `where` field at the top level.
 */
export const OPERATIONS_WITH_WHERE: ReadonlySet<string> = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Operations that accept a `cursor` field. The cursor's value contains
 * field names → scalars; UUID fields need conversion.
 */
export const OPERATIONS_WITH_CURSOR: ReadonlySet<string> = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
]);
