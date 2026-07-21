export interface Disposable {
  readonly disposed: boolean;
  dispose(): void;
}

export type DisposeAction = () => void;
export type DisposeTarget = Disposable | DisposeAction;

function toDisposeAction(target: DisposeTarget): DisposeAction {
  return typeof target === 'function' ? target : () => target.dispose();
}

/**
 * Owns cleanup actions and releases them in reverse registration order.
 *
 * Disposal is idempotent. Every registered action is attempted even when an
 * earlier action fails, and failures are reported after ownership is cleared.
 */
export class DisposeBag implements Disposable {
  readonly #actions: DisposeAction[] = [];
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  add<T extends DisposeTarget>(target: T): T {
    const action = toDisposeAction(target);

    if (this.#disposed) {
      action();
      return target;
    }

    this.#actions.push(action);
    return target;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    const actions = this.#actions.splice(0).reverse();
    const errors: unknown[] = [];

    for (const action of actions) {
      try {
        action();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple owned resources failed to dispose.');
    }
  }
}
