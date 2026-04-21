/**
 * prisma-extension-binary-uuid
 *
 * Transparent BINARY(16) UUID storage for Prisma + MySQL / MariaDB.
 *
 * See README for installation, configuration, and migration guide.
 */

// Primary API: extension factory + config helpers.
export { createBinaryUuidExtension, BINARY_UUID_EXTENSION_MARKER } from './extension.js';
export { defineBinaryUuidConfig } from './config/define-config.js';

// Public config types.
export type {
  BinaryUuidConfig,
  BinaryUuidLogger,
  BinaryUuidMetrics,
  BinaryUuidOptions,
  RelationTargetMap,
  UuidFieldMap,
  UuidVersion,
} from './config/types.js';

// Type-branding helpers for query argument positions.
export { uuidString, asString } from './types/brand.js';
export type { UuidString } from './types/brand.js';

// Low-level conversion primitives — exposed for power users and tests.
export {
  uidToBin,
  uidFromBin,
  isUuidString,
  isUuidBytes,
  newUidV4,
  newUidV4Raw,
  newUidV7,
  UUID_REGEX,
} from './conversion/index.js';

// Error types for programmatic handling.
export {
  BinaryUuidError,
  MalformedUuidError,
  WrongLengthUuidError,
  UnknownModelError,
  UnknownFieldError,
  InvalidConfigError,
  TypeMismatchError,
} from './errors.js';
export type { BinaryUuidErrorCode, BinaryUuidErrorContext } from './errors.js';
