/**
 * Build a Prisma client pointed at a test container, wrap with the extension.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { createBinaryUuidExtension } from '../../../src/index.js';

import { uuidConfig } from './uuid-config.js';

/**
 * Build a fully extended Prisma client. We cast the extension's return type
 * back to `PrismaClient` for test ergonomics — in production code, users get
 * accurate types because their schema generates real model delegates. Here
 * our dev schema's model shapes are what matter; the extension preserves them.
 */
export function buildClient(url: string): PrismaClient {
  const adapter = new PrismaMariaDb(url);
  const base = new PrismaClient({ adapter });
  return base.$extends(createBinaryUuidExtension(uuidConfig)) as unknown as PrismaClient;
}

export type ExtendedClient = PrismaClient;

/**
 * Widen `create` args so tests don't have to supply auto-generated binary
 * fields (id, storageId) that the extension will fill in at runtime.
 *
 * In production consumers who want fully-typed inputs should either use a
 * generated config wrapper (see docs) or cast narrowly at call sites.
 */
export type LooseData<T> = Partial<T> & Record<string, unknown>;
