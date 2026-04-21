/**
 * Public configuration type for the binary UUID extension.
 *
 * Consumers construct a config object and pass it to `createBinaryUuidExtension`.
 * The config declares which fields on which models hold UUIDs, how auto-generation
 * should behave, and how relations map to target models for nested-write walking.
 */

export type UuidVersion = 'v4' | 'v7';

/**
 * Optional logger interface. If supplied, the extension emits diagnostic
 * messages at these levels. No logger is wired up by default to keep output
 * clean in production.
 */
export interface BinaryUuidLogger {
  debug?: (message: string, context?: Record<string, unknown>) => void;
  warn?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Optional metrics hook. If supplied, the extension calls `onQuery` after
 * every operation with the timing and shape information. Intended for
 * integration with OpenTelemetry, Datadog, Prometheus, etc.
 */
export interface BinaryUuidMetrics {
  onQuery?: (info: {
    model: string | undefined;
    operation: string;
    durationMs: number;
    argsConverted: number;
    resultConverted: number;
  }) => void;
}

/**
 * Runtime behavior flags.
 */
export interface BinaryUuidOptions {
  /**
   * When true (default), the walker rejects non-UUID strings in UUID fields
   * with a `MalformedUuidError`. When false, it passes them through and lets
   * the database raise the error. Only disable this if you have very strict
   * pre-validation upstream.
   *
   * @default true
   */
  readonly strictValidation?: boolean;

  /**
   * When true (default), the walker accepts `Uint8Array` values in input
   * positions without throwing — useful for callers who have already
   * converted upstream. When false, raw `Uint8Array` in inputs raises
   * `TypeMismatchError` (forces string-only input discipline).
   *
   * @default true
   */
  readonly allowBufferInput?: boolean;

  /**
   * Optional logger for diagnostic output. No messages are emitted if unset.
   */
  readonly logger?: BinaryUuidLogger;

  /**
   * Optional metrics hook. Called once per intercepted operation.
   */
  readonly metrics?: BinaryUuidMetrics;
}

/**
 * A map of model name → list of field names that hold UUIDs. Model names
 * are the PascalCase names from `schema.prisma`. The extension handles
 * delegate-name conversion (PascalCase ↔ camelCase) internally.
 */
export type UuidFieldMap = Readonly<Record<string, readonly string[]>>;

/**
 * A map of model name → (relation field name → target model name). Required
 * for nested-write walking — when the walker descends into `data.author.create`,
 * it needs to know the `author` relation points to a `User`.
 *
 * Example:
 * ```ts
 * relations: {
 *   Post: { author: 'User', comments: 'Comment' },
 *   User: { posts: 'Post' }
 * }
 * ```
 */
export type RelationTargetMap = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * Full configuration shape for the extension.
 */
export interface BinaryUuidConfig {
  /**
   * Required: which fields on which models hold UUIDs. Every UUID column in
   * your schema must be declared here. The CLI (`prisma-extension-binary-uuid init`)
   * can generate this from `schema.prisma`.
   */
  readonly fields: UuidFieldMap;

  /**
   * Optional: which fields should auto-generate a UUID on create if the
   * caller omits them. Defaults to all fields named `id` in `fields`. Add
   * other auto-generated non-PK UUID fields (e.g., `storageId`) here.
   */
  readonly autoGenerate?: UuidFieldMap;

  /**
   * Required for any schema with relations: relation-field → target-model map.
   * The CLI extracts this from `schema.prisma`. If you omit a relation here,
   * nested writes through that relation won't have their UUID fields converted.
   */
  readonly relations?: RelationTargetMap;

  /**
   * UUID version for auto-generated values. Default `v4`. Use `v7` if you
   * want timestamp-ordered IDs (better index locality for append-heavy tables).
   *
   * @default 'v4'
   */
  readonly version?: UuidVersion;

  /**
   * Custom UUID generator. Overrides `version` if supplied. Must return a
   * 16-byte `Uint8Array`. Useful for injecting test fixtures or using a
   * platform-specific generator.
   */
  readonly generate?: () => Uint8Array;

  /**
   * Runtime behavior flags. See `BinaryUuidOptions`.
   */
  readonly options?: BinaryUuidOptions;
}

/**
 * Internal normalized form. `defineBinaryUuidConfig` converts user input to
 * this shape at init time so the walker can rely on consistent invariants.
 *
 * @internal
 */
export interface NormalizedConfig {
  readonly fields: Map<string, ReadonlySet<string>>;
  readonly autoGenerate: Map<string, ReadonlySet<string>>;
  readonly relations: Map<string, Map<string, string>>;
  readonly allUuidFieldNames: ReadonlySet<string>;
  readonly generate: () => Uint8Array;
  readonly strictValidation: boolean;
  readonly allowBufferInput: boolean;
  readonly logger: BinaryUuidLogger | undefined;
  readonly metrics: BinaryUuidMetrics | undefined;
}
