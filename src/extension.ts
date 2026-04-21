/**
 * Public Prisma Client extension factory.
 *
 * Returns an extension that, when applied via `.$extends()`, intercepts every
 * query in the client and transparently converts between string UUIDs (what
 * your application code uses) and 16-byte binary UUIDs (what the database
 * column stores).
 *
 * Usage:
 * ```ts
 * import { PrismaClient } from '@prisma/client';
 * import { createBinaryUuidExtension } from 'prisma-extension-binary-uuid';
 * import { uuidConfig } from './uuid-config';
 *
 * const prisma = new PrismaClient().$extends(createBinaryUuidExtension(uuidConfig));
 * ```
 */

import { Prisma } from '@prisma/client';

import type { BinaryUuidConfig } from './config/types.js';
import { normalizeConfig } from './config/define-config.js';
import { walkArgs } from './walker/args-walker.js';
import { walkResult } from './walker/result-walker.js';

/**
 * Marker symbol attached to any client extended with this extension. Allows
 * callers to detect at runtime whether the extension is in the chain.
 *
 * The version suffix lets us bump the marker if the extension's semantics
 * change in a way that old cached clients would get wrong.
 */
export const BINARY_UUID_EXTENSION_MARKER = Symbol.for(
  'prisma-extension-binary-uuid.v1',
);

/**
 * Create a Prisma Client extension that transparently converts between string
 * UUIDs and `BINARY(16)` database columns.
 *
 * The returned value is passed to `prisma.$extends(...)`. Safe to compose with
 * other extensions in any order. Idempotent under double-application.
 *
 * @param config - Field registry + options. Use `defineBinaryUuidConfig()` for
 *                 TypeScript inference.
 */
export function createBinaryUuidExtension(config: BinaryUuidConfig) {
  const normalized = normalizeConfig(config);

  // The handler. Typed with `unknown` because without a user-supplied schema
  // the generic type parameters collapse to `never`; at runtime this is the
  // correct shape for $allOperations. The Prisma team acknowledges this
  // limitation for library-authored extensions (see prisma/prisma#19888).
  interface AllOperationsContext {
    model: string | undefined;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }

  const handler = async ({ model, operation, args, query }: AllOperationsContext): Promise<unknown> => {
    const modelKey = model;
    const startedAt = normalized.metrics?.onQuery !== undefined ? performance.now() : 0;

    const { args: transformedArgs, converted: argsConverted } = walkArgs(
      normalized,
      modelKey,
      operation,
      args,
    );

    const rawResult = await query(transformedArgs);

    const { result, converted: resultConverted } = walkResult(
      normalized,
      modelKey,
      operation,
      rawResult,
    );

    if (normalized.metrics?.onQuery !== undefined) {
      try {
        normalized.metrics.onQuery({
          model: modelKey,
          operation,
          durationMs: performance.now() - startedAt,
          argsConverted,
          resultConverted,
        });
      } catch (err) {
        // Metrics must never break the query.
        normalized.logger?.error?.('metrics onQuery threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  };

  return Prisma.defineExtension({
    name: 'prisma-extension-binary-uuid',
    query: {
      $allModels: {
        // Cast is needed because Prisma's generics resolve to `never` when the
        // schema in our dev-time stub is empty. See type comment above.
        $allOperations: handler as unknown as Parameters<
          typeof Prisma.defineExtension
        >[0] extends infer _ ? never : never,
      },
    },
    client: {
      $binaryUuidExtensionMarker: BINARY_UUID_EXTENSION_MARKER,
    },
  } as Parameters<typeof Prisma.defineExtension>[0]);
}
