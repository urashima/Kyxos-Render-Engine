import { KyxosEngineError } from './errors.js';

declare const handleBrand: unique symbol;

export type Handle<Kind extends string> = Readonly<{
  readonly id: number;
  readonly kind: Kind;
  readonly [handleBrand]: Kind;
}>;

export interface UnknownHandle {
  readonly id: number;
  readonly kind: string;
}

/**
 * Allocates monotonic opaque handles. IDs are intentionally not reused so a
 * stale handle cannot silently resolve to a newly created resource.
 */
export class HandleAllocator<Kind extends string> {
  readonly #kind: Kind;
  #nextId = 1;

  constructor(kind: Kind) {
    if (kind.length === 0) {
      throw new KyxosEngineError('Handle kind must not be empty.', {
        code: 'INVALID_ARGUMENT',
        module: 'core',
        recoverable: false,
      });
    }

    this.#kind = kind;
  }

  create(): Handle<Kind> {
    if (!Number.isSafeInteger(this.#nextId)) {
      throw new KyxosEngineError(`Handle space for "${this.#kind}" is exhausted.`, {
        code: 'RESOURCE_CREATION_FAILED',
        module: 'core',
        recoverable: false,
      });
    }

    const handle = {
      id: this.#nextId,
      kind: this.#kind,
    } as Handle<Kind>;
    this.#nextId += 1;
    return Object.freeze(handle);
  }
}

export function isHandle(value: unknown, expectedKind?: string): value is UnknownHandle {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<UnknownHandle>;
  return (
    Number.isSafeInteger(candidate.id) &&
    (candidate.id ?? 0) > 0 &&
    typeof candidate.kind === 'string' &&
    candidate.kind.length > 0 &&
    (expectedKind === undefined || candidate.kind === expectedKind)
  );
}

export function handleKey(handle: UnknownHandle): string {
  return `${handle.kind}:${handle.id}`;
}
