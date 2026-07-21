import { isHandle } from '@kyxos/render-core';
import type { Handle } from '@kyxos/render-core';

export const BACKEND_RESOURCE_KINDS = [
  'bind-group',
  'buffer',
  'command-encoder',
  'pipeline',
  'sampler',
  'shader-module',
  'surface',
  'texture',
] as const;

export type BackendResourceKind = (typeof BACKEND_RESOURCE_KINDS)[number];
export type BackendResourceHandleKind<Kind extends BackendResourceKind> = `backend:${Kind}`;
export type BackendResourceHandle<Kind extends BackendResourceKind = BackendResourceKind> = Handle<
  BackendResourceHandleKind<Kind>
>;

export interface BackendResourceDescriptor {
  readonly estimatedBytes?: number;
  readonly label?: string;
}

export interface BackendResourceKindStatistics {
  readonly activeCount: number;
  readonly activeEstimatedBytes: number;
}

export interface BackendResourceStatistics {
  readonly activeCount: number;
  readonly activeEstimatedBytes: number;
  readonly byKind: Readonly<Record<BackendResourceKind, BackendResourceKindStatistics>>;
  readonly createdTotal: number;
  readonly destroyedTotal: number;
}

export function backendResourceHandleKind<Kind extends BackendResourceKind>(
  kind: Kind,
): BackendResourceHandleKind<Kind> {
  return `backend:${kind}`;
}

export function isBackendResourceHandle(
  value: unknown,
): value is BackendResourceHandle<BackendResourceKind> {
  return (
    isHandle(value) &&
    BACKEND_RESOURCE_KINDS.some((kind) => value.kind === backendResourceHandleKind(kind))
  );
}
