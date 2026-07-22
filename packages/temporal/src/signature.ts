import { KyxosEngineError } from '@kyxos/render-core';

export const TEMPORAL_HISTORY_SIGNATURE_FIELDS = [
  'camera',
  'device',
  'environment',
  'geometry',
  'lighting',
  'materials',
  'postProcess',
  'scene',
  'viewport',
] as const;

export type TemporalHistorySignatureField = (typeof TEMPORAL_HISTORY_SIGNATURE_FIELDS)[number];

export type TemporalHistorySignatureDescriptor = Readonly<
  Record<TemporalHistorySignatureField, number>
>;

export type TemporalHistorySignature = TemporalHistorySignatureDescriptor;

function assertRevision(field: TemporalHistorySignatureField, revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new KyxosEngineError(
      `Temporal history signature field "${field}" must be a non-negative safe integer.`,
      {
        code: 'INVALID_ARGUMENT',
        module: 'temporal',
        recoverable: false,
      },
    );
  }
}

export function createTemporalHistorySignature(
  descriptor: TemporalHistorySignatureDescriptor,
): TemporalHistorySignature {
  for (const field of TEMPORAL_HISTORY_SIGNATURE_FIELDS) {
    assertRevision(field, descriptor[field]);
  }

  return Object.freeze({
    camera: descriptor.camera,
    device: descriptor.device,
    environment: descriptor.environment,
    geometry: descriptor.geometry,
    lighting: descriptor.lighting,
    materials: descriptor.materials,
    postProcess: descriptor.postProcess,
    scene: descriptor.scene,
    viewport: descriptor.viewport,
  });
}

export function temporalHistorySignaturesEqual(
  left: TemporalHistorySignature,
  right: TemporalHistorySignature,
): boolean {
  return TEMPORAL_HISTORY_SIGNATURE_FIELDS.every((field) => left[field] === right[field]);
}
