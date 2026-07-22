import { KyxosEngineError } from '@kyxos/render-core';

export type MaterialFeatureValue = boolean | string;
export type MaterialFeatureSet = Readonly<Record<string, MaterialFeatureValue>>;

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'material',
    recoverable: false,
  });
}

function segment(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) invalid(`${label} must not be empty.`);
  return encodeURIComponent(normalized);
}

export function createMaterialFeatureKey(model: string, features: MaterialFeatureSet): string {
  const entries = Object.entries(features).sort(([left], [right]) => left.localeCompare(right));
  const encoded = entries.map(([name, value]) => {
    const encodedName = segment(name, 'Material feature name');
    if (typeof value === 'boolean') return `${encodedName}=${value ? '1' : '0'}`;
    return `${encodedName}=${segment(value, `Material feature "${name}" value`)}`;
  });
  return [segment(model, 'Material model'), ...encoded].join('|');
}
