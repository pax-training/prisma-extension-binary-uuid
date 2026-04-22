/**
 * Branded types for TypeScript-level UUID handling.
 *
 * The core problem: when Prisma's schema says a field is `Bytes @db.Binary(16)`,
 * Prisma generates input types like `{ where: { id: Uint8Array } }`. But our
 * extension lets users pass strings at runtime. We need a way for TypeScript
 * to accept strings in those positions without drowning users in `as any`.
 *
 * Approach: an intersection type `string & Uint8Array` produced by the
 * `uuidString()` helper. At the type level this satisfies both string and
 * Uint8Array constraints. At runtime it's still just a string — the extension
 * converts it before it hits the driver.
 */

/**
 * Nominal brand marker. The unique symbol prevents accidental structural
 * matching against plain strings. Only `uuidString()` can produce a value
 * with this brand.
 */
declare const BinaryUuidBrand: unique symbol;

/**
 * A branded string that also satisfies `Uint8Array<ArrayBuffer>` at the type
 * level. Intended as a drop-in for Prisma's generated `Bytes` input type, so
 * consumers can write `{ id: uuidString(x) }` in `where` / `data` clauses.
 *
 * At runtime this is a plain string. The extension's arg walker converts it
 * to a real `Uint8Array` before the query reaches the database driver.
 */
export type UuidString = string & Uint8Array<ArrayBuffer> & { readonly [BinaryUuidBrand]: true };

/**
 * Wrap a UUID string so TypeScript accepts it where Prisma expects `Uint8Array`.
 *
 * Runtime behavior: returns the input unchanged (after validation in strict
 * mode). The extension handles conversion.
 *
 * @example
 * ```ts
 * const user = await prisma.user.findUnique({
 *   where: { id: uuidString(userIdFromSession) }
 * });
 * ```
 *
 * @param value - A UUID string, with or without dashes, any case.
 * @returns The same string, typed as `UuidString`.
 */
export function uuidString(value: string): UuidString {
  // We deliberately do NOT validate here. Validation runs inside the extension
  // walker where it has full context (model, field, operation) for good error
  // messages. Validating twice would double the cost on the hot path.
  return value as UuidString;
}

/**
 * Opposite direction: treat a `UuidString` or `Uint8Array` as a plain string.
 * Useful in places where you've already processed a UUID through the extension
 * and want to pass it elsewhere as a string.
 *
 * Runtime: returns the input unchanged (the extension ensures read-side values
 * are always strings).
 */
export function asString(value: UuidString | string): string {
  return value as string;
}
