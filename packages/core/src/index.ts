/** Stable package identity for diagnostics and boundary tests. */
export const CORE_PACKAGE_NAME = '@kyxos/render-core' as const;

export type { Disposable, DisposeAction, DisposeTarget } from './disposable.js';
export { DisposeBag } from './disposable.js';
export type {
  EngineErrorCode,
  EngineErrorOptions,
  EngineModule,
  SerializedEngineError,
} from './errors.js';
export { isKyxosEngineError, KyxosEngineError, toKyxosEngineError } from './errors.js';
export type { EventListener, Unsubscribe } from './events.js';
export { TypedEventEmitter } from './events.js';
export type { Handle, UnknownHandle } from './handles.js';
export { HandleAllocator, handleKey, isHandle } from './handles.js';
