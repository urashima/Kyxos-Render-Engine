import type {
  BackendLossInfo,
  BackendRenderPassStatistics,
  GraphicsBackend,
} from '@kyxos/render-backend-api';
import type { DirtyFlag, TemporalFrameMetadata } from '@kyxos/render-frame-scheduler';
import { KyxosEngineError } from '@kyxos/render-core';
import type { Disposable, Unsubscribe } from '@kyxos/render-core';

export interface EngineExtension {
  readonly id: string;
  dispose?(): void;
}

export interface RenderFeatureInitializationContext {
  readonly backend: GraphicsBackend;
}

export interface RenderFeatureFrameContext extends RenderFeatureInitializationContext {
  readonly dirtyFlags: readonly DirtyFlag[];
  readonly frameIndex: number;
  readonly temporal?: TemporalFrameMetadata;
  readonly timestamp: number;
}

export interface RenderFeature extends EngineExtension {
  initialize?(context: RenderFeatureInitializationContext): Promise<void> | void;
  onBackendLost?(loss: BackendLossInfo): void;
  render?(context: RenderFeatureFrameContext): BackendRenderPassStatistics | undefined;
}

export type MaterialExtension = EngineExtension;
export type AssetDecoder = EngineExtension;
export type PreviewPreset = EngineExtension;

export type ExtensionCategory =
  'asset-decoder' | 'material-extension' | 'preview-preset' | 'render-feature';

export class ExtensionRegistry<Extension extends EngineExtension> implements Disposable {
  readonly #category: ExtensionCategory;
  readonly #extensions = new Map<string, Extension>();
  #disposed = false;

  constructor(category: ExtensionCategory) {
    this.#category = category;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get size(): number {
    return this.#extensions.size;
  }

  values(): readonly Extension[] {
    return Object.freeze([...this.#extensions.values()]);
  }

  register(extension: Extension): Unsubscribe {
    if (this.#disposed) {
      throw this.#error(
        'Cannot register an extension after renderer disposal.',
        'ALREADY_DISPOSED',
      );
    }

    if (extension.id.trim().length === 0) {
      throw this.#error('Extension id must not be empty.', 'INVALID_ARGUMENT');
    }

    if (this.#extensions.has(extension.id)) {
      throw this.#error(
        `Duplicate ${this.#category} registration for id "${extension.id}".`,
        'EXTENSION_REGISTRATION_FAILED',
      );
    }

    this.#extensions.set(extension.id, extension);
    let active = true;
    return () => {
      if (!active) {
        return;
      }

      active = false;
      const owned = this.#extensions.get(extension.id);
      if (owned === extension) {
        this.#extensions.delete(extension.id);
        extension.dispose?.();
      }
    };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    const extensions = [...this.#extensions.values()].reverse();
    this.#extensions.clear();
    const errors: unknown[] = [];

    for (const extension of extensions) {
      try {
        extension.dispose?.();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new AggregateError(errors, `Multiple ${this.#category} extensions failed to dispose.`);
    }
  }

  #error(
    message: string,
    code: 'ALREADY_DISPOSED' | 'EXTENSION_REGISTRATION_FAILED' | 'INVALID_ARGUMENT',
  ): KyxosEngineError {
    return new KyxosEngineError(message, {
      code,
      module: 'renderer',
      recoverable: false,
    });
  }
}
