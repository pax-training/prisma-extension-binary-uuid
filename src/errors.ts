/**
 * Typed error hierarchy for prisma-extension-binary-uuid.
 *
 * Every error carries a stable `code` for programmatic handling and a `model`/`field`
 * context when applicable. Sensitive values (the actual UUID that failed to parse,
 * for example) are NEVER included in the default serialized error — they can leak
 * user identifiers or session tokens into logs. Callers who need the value for
 * debugging can opt into it via `err.valueDebug` inside a controlled environment.
 */

export type BinaryUuidErrorCode =
  | 'BINARY_UUID_MALFORMED'
  | 'BINARY_UUID_WRONG_LENGTH'
  | 'BINARY_UUID_UNKNOWN_MODEL'
  | 'BINARY_UUID_UNKNOWN_FIELD'
  | 'BINARY_UUID_INVALID_CONFIG'
  | 'BINARY_UUID_TYPE_MISMATCH';

export interface BinaryUuidErrorContext {
  readonly model?: string;
  readonly field?: string;
  readonly operation?: string;
}

/**
 * Base class for all extension errors. Subclass this so callers can branch on
 * `instanceof BinaryUuidError` for "any extension error" before narrowing further.
 */
export class BinaryUuidError extends Error {
  public readonly code: BinaryUuidErrorCode;
  public readonly model: string | undefined;
  public readonly field: string | undefined;
  public readonly operation: string | undefined;

  constructor(code: BinaryUuidErrorCode, message: string, context: BinaryUuidErrorContext = {}) {
    super(message);
    this.name = 'BinaryUuidError';
    this.code = code;
    this.model = context.model;
    this.field = context.field;
    this.operation = context.operation;
    // Ensure the prototype chain is correct when transpiled to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Safe-for-logs representation. Omits the offending value by design.
   */
  public toJSON(): {
    name: string;
    code: BinaryUuidErrorCode;
    message: string;
    model: string | undefined;
    field: string | undefined;
    operation: string | undefined;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      model: this.model,
      field: this.field,
      operation: this.operation,
    };
  }
}

/**
 * Thrown when a string that should be a UUID cannot be parsed. Covers wrong
 * length, non-hex characters, and malformed dash placement.
 */
export class MalformedUuidError extends BinaryUuidError {
  /**
   * Debug-only access to the offending value. Not serialized by toJSON.
   * Prefixed with an underscore to discourage accidental use.
   */
  public readonly _valueDebug: string;

  constructor(value: string, context: BinaryUuidErrorContext = {}) {
    super(
      'BINARY_UUID_MALFORMED',
      `Malformed UUID${
        context.field !== undefined ? ` at ${context.model ?? '?'}.${context.field}` : ''
      }: expected 32 hex chars (with optional dashes), got ${value.length} chars`,
      context,
    );
    this.name = 'MalformedUuidError';
    this._valueDebug = value;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a Uint8Array that should be a 16-byte UUID is the wrong length.
 */
export class WrongLengthUuidError extends BinaryUuidError {
  public readonly actualLength: number;

  constructor(actualLength: number, context: BinaryUuidErrorContext = {}) {
    super(
      'BINARY_UUID_WRONG_LENGTH',
      `Binary UUID must be exactly 16 bytes, got ${actualLength}${
        context.field !== undefined ? ` at ${context.model ?? '?'}.${context.field}` : ''
      }`,
      context,
    );
    this.name = 'WrongLengthUuidError';
    this.actualLength = actualLength;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the config references a model that Prisma doesn't know about.
 * Raised at extension init time; never at query time.
 */
export class UnknownModelError extends BinaryUuidError {
  constructor(model: string) {
    super(
      'BINARY_UUID_UNKNOWN_MODEL',
      `Config references model "${model}" but it's not present in the Prisma client. Check for typos or a stale config.`,
      { model },
    );
    this.name = 'UnknownModelError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the config declares a UUID field that doesn't exist on the
 * referenced model. Raised at extension init time.
 */
export class UnknownFieldError extends BinaryUuidError {
  constructor(model: string, field: string) {
    super(
      'BINARY_UUID_UNKNOWN_FIELD',
      `Config declares UUID field "${model}.${field}" but the field doesn't exist on the model.`,
      { model, field },
    );
    this.name = 'UnknownFieldError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the config itself is structurally invalid — missing required
 * keys, circular relations, impossible combinations, etc.
 */
export class InvalidConfigError extends BinaryUuidError {
  constructor(message: string) {
    super('BINARY_UUID_INVALID_CONFIG', `Invalid binary UUID config: ${message}`);
    this.name = 'InvalidConfigError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a value arrives at the walker with a type that can't be converted —
 * for example a number where a UUID was expected. This is a programmer error;
 * it should not be caught and ignored.
 */
export class TypeMismatchError extends BinaryUuidError {
  public readonly actualType: string;

  constructor(actualType: string, context: BinaryUuidErrorContext = {}) {
    super(
      'BINARY_UUID_TYPE_MISMATCH',
      `Expected string or Uint8Array for UUID field${
        context.field !== undefined ? ` ${context.model ?? '?'}.${context.field}` : ''
      }, got ${actualType}`,
      context,
    );
    this.name = 'TypeMismatchError';
    this.actualType = actualType;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
