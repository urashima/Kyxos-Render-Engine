export type EngineErrorCode =
  | 'ALREADY_DISPOSED'
  | 'BACKEND_INITIALIZATION_FAILED'
  | 'BACKEND_UNAVAILABLE'
  | 'CONTEXT_LOST'
  | 'DEVICE_LOST'
  | 'EXTENSION_REGISTRATION_FAILED'
  | 'INTERNAL_ERROR'
  | 'INVALID_ARGUMENT'
  | 'INVALID_STATE'
  | 'RESOURCE_CREATION_FAILED'
  | 'RESOURCE_DISPOSE_FAILED'
  | 'UNSUPPORTED_CAPABILITY';

export type EngineModule =
  | 'asset'
  | 'backend'
  | 'camera'
  | 'core'
  | 'geometry'
  | 'material'
  | 'renderer'
  | 'scene'
  | 'scheduler'
  | 'sdk'
  | 'unknown';

export interface EngineErrorOptions {
  readonly cause?: unknown;
  readonly code: EngineErrorCode;
  readonly module: EngineModule;
  readonly recoverable: boolean;
  readonly suggestedAction?: string;
}

export interface SerializedEngineError {
  readonly code: EngineErrorCode;
  readonly message: string;
  readonly module: EngineModule;
  readonly name: 'KyxosEngineError';
  readonly recoverable: boolean;
  readonly suggestedAction?: string;
}

export class KyxosEngineError extends Error {
  readonly code: EngineErrorCode;
  readonly module: EngineModule;
  readonly recoverable: boolean;
  readonly suggestedAction: string | undefined;

  constructor(message: string, options: EngineErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'KyxosEngineError';
    this.code = options.code;
    this.module = options.module;
    this.recoverable = options.recoverable;
    this.suggestedAction = options.suggestedAction;
  }

  toJSON(): SerializedEngineError {
    return {
      code: this.code,
      message: this.message,
      module: this.module,
      name: 'KyxosEngineError',
      recoverable: this.recoverable,
      ...(this.suggestedAction === undefined ? {} : { suggestedAction: this.suggestedAction }),
    };
  }
}

export function isKyxosEngineError(error: unknown): error is KyxosEngineError {
  return error instanceof KyxosEngineError;
}

export function toKyxosEngineError(
  error: unknown,
  fallback: Omit<EngineErrorOptions, 'cause'> & { readonly message: string },
): KyxosEngineError {
  if (isKyxosEngineError(error)) {
    return error;
  }

  return new KyxosEngineError(fallback.message, {
    cause: error,
    code: fallback.code,
    module: fallback.module,
    recoverable: fallback.recoverable,
    ...(fallback.suggestedAction === undefined
      ? {}
      : { suggestedAction: fallback.suggestedAction }),
  });
}
