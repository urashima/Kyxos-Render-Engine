import { describe, expect, it } from 'vitest';

import { KyxosEngineError, isKyxosEngineError, toKyxosEngineError } from '../src/index.js';

describe('KyxosEngineError', () => {
  it('serializes a stable public error shape', () => {
    const error = new KyxosEngineError('No backend is available.', {
      code: 'BACKEND_UNAVAILABLE',
      module: 'backend',
      recoverable: true,
      suggestedAction: 'Enable WebGPU or use WebGL2.',
    });

    expect(error.toJSON()).toEqual({
      code: 'BACKEND_UNAVAILABLE',
      message: 'No backend is available.',
      module: 'backend',
      name: 'KyxosEngineError',
      recoverable: true,
      suggestedAction: 'Enable WebGPU or use WebGL2.',
    });
    expect(isKyxosEngineError(error)).toBe(true);
  });

  it('preserves an existing engine error and wraps unknown failures', () => {
    const existing = new KyxosEngineError('Existing', {
      code: 'INVALID_STATE',
      module: 'core',
      recoverable: false,
    });
    expect(
      toKyxosEngineError(existing, {
        code: 'INTERNAL_ERROR',
        message: 'Fallback',
        module: 'unknown',
        recoverable: false,
      }),
    ).toBe(existing);

    const cause = new Error('native');
    const wrapped = toKyxosEngineError(cause, {
      code: 'INTERNAL_ERROR',
      message: 'Wrapped',
      module: 'unknown',
      recoverable: false,
    });
    expect(wrapped.cause).toBe(cause);
    expect(wrapped.code).toBe('INTERNAL_ERROR');
  });
});
