/**
 * Cross-Prisma-version smoke test.
 *
 * Runs in CI under `prisma-compat` to verify that the extension factory and
 * the `$allOperations` query handler produce correct output against whatever
 * Prisma version is currently installed. Catches API drift between minors —
 * `Prisma.defineExtension` and `query.$allModels.$allOperations` are public
 * extension surfaces that our extension depends on.
 *
 * If anything in this script throws or the assertions fail, exit 1 so CI
 * fails the matrix cell loudly.
 */

import { Prisma } from '@prisma/client';

import { uidFromBin, uidToBin } from '../../src/conversion/index.js';
import { createBinaryUuidExtension } from '../../src/extension.js';

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174000';

interface SpecShape {
  name: string;
  query: {
    $allModels: {
      $allOperations: (ctx: {
        model: string | undefined;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    };
  };
  client: { $binaryUuidExtensionMarker: symbol };
}

function captureSpec(): SpecShape {
  const factory = createBinaryUuidExtension({
    fields: { User: ['id'], Post: ['id', 'authorId'] },
    relations: { User: { posts: 'Post' }, Post: { author: 'User' } },
  }) as unknown as (client: { $extends: (ext: unknown) => unknown }) => unknown;

  let captured: unknown;
  const stub = {
    $extends: (ext: unknown) => {
      captured = ext;
      return stub;
    },
  };
  factory(stub);

  if (captured === undefined) {
    throw new Error(
      'extension factory did not call client.$extends — Prisma.defineExtension API drift?',
    );
  }
  return captured as SpecShape;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (cond === false || cond === undefined || cond === null || cond === 0 || cond === '') {
    throw new Error(`assertion failed: ${msg}`);
  }
}

async function main(): Promise<void> {
  const prismaVersion = (Prisma as { prismaVersion?: { client?: string } }).prismaVersion?.client;
  process.stdout.write(`Prisma client version: ${prismaVersion ?? '<unknown>'}\n`);

  // Surface 1: defineExtension exists and accepts an object.
  assert(typeof Prisma.defineExtension === 'function', 'Prisma.defineExtension is not a function');

  // Surface 2: factory returns a closure that, when given a client stub, calls
  // $extends with our spec.
  const spec = captureSpec();
  assert(spec.name === 'prisma-extension-binary-uuid', `spec.name was ${spec.name}`);
  assert(
    typeof spec.query.$allModels.$allOperations === 'function',
    'spec.query.$allModels.$allOperations is not a function',
  );
  assert(
    spec.client.$binaryUuidExtensionMarker === Symbol.for('prisma-extension-binary-uuid.v1'),
    'marker symbol does not match Symbol.for("prisma-extension-binary-uuid.v1")',
  );

  // Surface 3: handler converts string UUID → binary on the way down.
  let downstreamSawBinary = false;
  let downstreamArgsLength = -1;
  const result = await spec.query.$allModels.$allOperations({
    model: 'User',
    operation: 'findUnique',
    args: { where: { id: UUID_A } },
    query: async (args: unknown) => {
      const a = args as { where: { id: Uint8Array } };
      downstreamSawBinary = a.where.id instanceof Uint8Array;
      downstreamArgsLength = a.where.id.length;
      // Simulate what a real driver would return.
      return { id: uidToBin(UUID_B), name: 'Bob' };
    },
  });

  assert(downstreamSawBinary, 'downstream did not receive Uint8Array for where.id');
  assert(
    downstreamArgsLength === 16,
    `downstream binary length was ${downstreamArgsLength}, expected 16`,
  );

  // Surface 4: handler converts binary → string on the way back up.
  const r = result as { id: string; name: string };
  assert(typeof r.id === 'string', `result.id type was ${typeof r.id}, expected string`);
  assert(r.id === UUID_B, `result.id was ${r.id}, expected ${UUID_B}`);
  assert(r.name === 'Bob', `result.name was ${r.name}, expected Bob`);

  // Round-trip primitives still work.
  assert(uidFromBin(uidToBin(UUID_A)) === UUID_A, 'uidToBin/uidFromBin roundtrip failed');

  process.stdout.write('compat: ok\n');
}

main().catch((err: unknown) => {
  process.stderr.write(
    `compat smoke FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
