import { KyxosEngineError } from '@kyxos/render-core';

export type TemporalTaaRgb = readonly [red: number, green: number, blue: number];
export type TemporalTaaRgba = readonly [red: number, green: number, blue: number, alpha: number];
export type TemporalTaaVec3 = readonly [x: number, y: number, z: number];

export type TemporalTaaNeighborhood = readonly [
  TemporalTaaRgb,
  TemporalTaaRgb,
  TemporalTaaRgb,
  TemporalTaaRgb,
  TemporalTaaRgb,
  TemporalTaaRgb,
  TemporalTaaRgb,
  TemporalTaaRgb,
  TemporalTaaRgb,
];

export interface TemporalTaaResolveInput {
  readonly currentColor: TemporalTaaRgba;
  readonly currentDepth: number;
  readonly currentNormal: TemporalTaaVec3;
  /** History sampled at a caller-provided reprojected coordinate. */
  readonly historyColor: TemporalTaaRgba;
  readonly historyDepth: number;
  readonly historyNormal: TemporalTaaVec3;
  readonly historyValid: boolean;
  readonly neighborhood: TemporalTaaNeighborhood;
  readonly responsiveMask: number;
}

export interface TemporalTaaResolveOptions {
  readonly baseHistoryWeight: number;
  readonly depthAbsoluteThreshold: number;
  readonly depthRelativeThreshold: number;
  readonly normalRejectionCosine: number;
  readonly responsiveHistoryReduction: number;
}

export type TemporalTaaRejectionReason = 'depth' | 'history-invalid' | 'normal';

export interface TemporalTaaResolveResult {
  readonly clampedHistoryColor: TemporalTaaRgb;
  readonly depthDifference: number;
  readonly depthTolerance: number;
  readonly historyWeight: number;
  readonly neighborhoodMaximum: TemporalTaaRgb;
  readonly neighborhoodMinimum: TemporalTaaRgb;
  readonly normalSimilarity: number;
  readonly outputColor: TemporalTaaRgba;
  readonly rejected: boolean;
  readonly rejectionReason: TemporalTaaRejectionReason | null;
  readonly responsiveMask: number;
}

export interface TemporalTaaReferenceCase {
  readonly id: 'accepted' | 'depth-rejected' | 'normal-rejected';
  readonly input: TemporalTaaResolveInput;
}

export interface DeterministicTemporalTaaReference {
  readonly cases: readonly {
    readonly id: TemporalTaaReferenceCase['id'];
    readonly result: TemporalTaaResolveResult;
  }[];
  readonly values: readonly number[];
}

export const TEMPORAL_TAA_DEFAULT_OPTIONS: TemporalTaaResolveOptions = Object.freeze({
  baseHistoryWeight: 0.9,
  depthAbsoluteThreshold: 0.001,
  depthRelativeThreshold: 0.01,
  normalRejectionCosine: 0.85,
  responsiveHistoryReduction: 0.8,
});

export const TEMPORAL_TAA_REFERENCE_OUTPUT_FIELDS = Object.freeze([
  'output-red',
  'output-green',
  'output-blue',
  'output-alpha',
  'clamped-history-red',
  'clamped-history-green',
  'clamped-history-blue',
  'history-weight',
  'neighborhood-minimum-red',
  'neighborhood-minimum-green',
  'neighborhood-minimum-blue',
  'depth-difference',
  'neighborhood-maximum-red',
  'neighborhood-maximum-green',
  'neighborhood-maximum-blue',
  'normal-similarity',
  'depth-tolerance',
  'rejection-mask',
  'responsive-mask',
  'base-history-weight',
] as const);

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'temporal',
    recoverable: false,
  });
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) invalid(`${label} must be finite.`);
  return value;
}

function unit(value: number, label: string): number {
  finite(value, label);
  if (value < 0 || value > 1) invalid(`${label} must be from 0 through 1.`);
  return value;
}

function nonNegative(value: number, label: string): number {
  finite(value, label);
  if (value < 0) invalid(`${label} must be non-negative.`);
  return value;
}

function rgb(value: readonly number[], label: string): TemporalTaaRgb {
  if (value.length !== 3) invalid(`${label} must contain three channels.`);
  return Object.freeze([
    nonNegative(value[0] as number, `${label} red`),
    nonNegative(value[1] as number, `${label} green`),
    nonNegative(value[2] as number, `${label} blue`),
  ]);
}

function rgba(value: readonly number[], label: string): TemporalTaaRgba {
  if (value.length !== 4) invalid(`${label} must contain four channels.`);
  return Object.freeze([
    nonNegative(value[0] as number, `${label} red`),
    nonNegative(value[1] as number, `${label} green`),
    nonNegative(value[2] as number, `${label} blue`),
    unit(value[3] as number, `${label} alpha`),
  ]);
}

function normalize(value: readonly number[], label: string): TemporalTaaVec3 {
  if (value.length !== 3) invalid(`${label} must contain three components.`);
  const x = finite(value[0] as number, `${label} x`);
  const y = finite(value[1] as number, `${label} y`);
  const z = finite(value[2] as number, `${label} z`);
  const length = Math.hypot(x, y, z);
  if (length === 0) invalid(`${label} must be non-zero.`);
  return Object.freeze([x / length, y / length, z / length]);
}

function createOptions(
  options: Partial<TemporalTaaResolveOptions> | undefined,
): TemporalTaaResolveOptions {
  if (options === undefined) return TEMPORAL_TAA_DEFAULT_OPTIONS;
  const baseHistoryWeight = unit(
    options.baseHistoryWeight ?? TEMPORAL_TAA_DEFAULT_OPTIONS.baseHistoryWeight,
    'TAA base History weight',
  );
  const depthAbsoluteThreshold = unit(
    options.depthAbsoluteThreshold ?? TEMPORAL_TAA_DEFAULT_OPTIONS.depthAbsoluteThreshold,
    'TAA absolute Depth threshold',
  );
  const depthRelativeThreshold = unit(
    options.depthRelativeThreshold ?? TEMPORAL_TAA_DEFAULT_OPTIONS.depthRelativeThreshold,
    'TAA relative Depth threshold',
  );
  const normalRejectionCosine = finite(
    options.normalRejectionCosine ?? TEMPORAL_TAA_DEFAULT_OPTIONS.normalRejectionCosine,
    'TAA Normal rejection cosine',
  );
  if (normalRejectionCosine < -1 || normalRejectionCosine > 1) {
    invalid('TAA Normal rejection cosine must be from -1 through 1.');
  }
  const responsiveHistoryReduction = unit(
    options.responsiveHistoryReduction ?? TEMPORAL_TAA_DEFAULT_OPTIONS.responsiveHistoryReduction,
    'TAA responsive History reduction',
  );
  return Object.freeze({
    baseHistoryWeight,
    depthAbsoluteThreshold,
    depthRelativeThreshold,
    normalRejectionCosine,
    responsiveHistoryReduction,
  });
}

function neighborhoodBounds(neighborhood: TemporalTaaNeighborhood): {
  readonly maximum: TemporalTaaRgb;
  readonly minimum: TemporalTaaRgb;
} {
  if (neighborhood.length !== 9) invalid('TAA neighborhood must contain exactly nine RGB samples.');
  const samples = neighborhood.map((sample, index) => rgb(sample, `TAA neighborhood ${index}`));
  const first = samples[0] as TemporalTaaRgb;
  const minimum = [first[0], first[1], first[2]];
  const maximum = [first[0], first[1], first[2]];
  for (const sample of samples.slice(1)) {
    for (let channel = 0; channel < 3; channel += 1) {
      minimum[channel] = Math.min(minimum[channel] as number, sample[channel] as number);
      maximum[channel] = Math.max(maximum[channel] as number, sample[channel] as number);
    }
  }
  return Object.freeze({
    maximum: Object.freeze(maximum) as TemporalTaaRgb,
    minimum: Object.freeze(minimum) as TemporalTaaRgb,
  });
}

/** Resolves one linear-HDR pixel after the caller has sampled reprojected History. */
export function resolveTemporalTaa(
  input: TemporalTaaResolveInput,
  partialOptions?: Partial<TemporalTaaResolveOptions>,
): TemporalTaaResolveResult {
  if (typeof input.historyValid !== 'boolean') invalid('TAA History validity must be boolean.');
  const options = createOptions(partialOptions);
  const currentColor = rgba(input.currentColor, 'TAA current Color');
  const historyColor = rgba(input.historyColor, 'TAA History Color');
  const currentDepth = unit(input.currentDepth, 'TAA current Depth');
  const historyDepth = unit(input.historyDepth, 'TAA History Depth');
  const currentNormal = normalize(input.currentNormal, 'TAA current Normal');
  const historyNormal = normalize(input.historyNormal, 'TAA History Normal');
  const responsiveMask = unit(input.responsiveMask, 'TAA responsive mask');
  const bounds = neighborhoodBounds(input.neighborhood);
  const clampedHistoryColor = Object.freeze([
    Math.min(bounds.maximum[0], Math.max(bounds.minimum[0], historyColor[0])),
    Math.min(bounds.maximum[1], Math.max(bounds.minimum[1], historyColor[1])),
    Math.min(bounds.maximum[2], Math.max(bounds.minimum[2], historyColor[2])),
  ]) as TemporalTaaRgb;
  const depthDifference = Math.abs(currentDepth - historyDepth);
  const depthTolerance = Math.max(
    options.depthAbsoluteThreshold,
    options.depthRelativeThreshold * Math.max(currentDepth, historyDepth),
  );
  const normalSimilarity = Math.min(
    1,
    Math.max(
      -1,
      currentNormal[0] * historyNormal[0] +
        currentNormal[1] * historyNormal[1] +
        currentNormal[2] * historyNormal[2],
    ),
  );
  const rejectionReason: TemporalTaaRejectionReason | null = !input.historyValid
    ? 'history-invalid'
    : depthDifference > depthTolerance
      ? 'depth'
      : normalSimilarity < options.normalRejectionCosine
        ? 'normal'
        : null;
  const historyWeight =
    rejectionReason === null
      ? options.baseHistoryWeight * (1 - responsiveMask * options.responsiveHistoryReduction)
      : 0;
  const currentWeight = 1 - historyWeight;
  const outputColor = Object.freeze([
    currentColor[0] * currentWeight + clampedHistoryColor[0] * historyWeight,
    currentColor[1] * currentWeight + clampedHistoryColor[1] * historyWeight,
    currentColor[2] * currentWeight + clampedHistoryColor[2] * historyWeight,
    currentColor[3],
  ]) as TemporalTaaRgba;
  return Object.freeze({
    clampedHistoryColor,
    depthDifference,
    depthTolerance,
    historyWeight,
    neighborhoodMaximum: bounds.maximum,
    neighborhoodMinimum: bounds.minimum,
    normalSimilarity,
    outputColor,
    rejected: rejectionReason !== null,
    rejectionReason,
    responsiveMask,
  });
}

function referenceRgb(red: number, green: number, blue: number): TemporalTaaRgb {
  return Object.freeze([red, green, blue]);
}

function referenceRgba(red: number, green: number, blue: number, alpha: number): TemporalTaaRgba {
  return Object.freeze([red, green, blue, alpha]);
}

function referenceVec3(x: number, y: number, z: number): TemporalTaaVec3 {
  return Object.freeze([x, y, z]);
}

const REFERENCE_NEIGHBORHOOD: TemporalTaaNeighborhood = Object.freeze([
  referenceRgb(0.1, 0.4, 0.2),
  referenceRgb(0.2, 0.3, 0.4),
  referenceRgb(0.15, 0.25, 0.35),
  referenceRgb(0.3, 0.2, 0.5),
  referenceRgb(0.25, 0.35, 0.45),
  referenceRgb(0.4, 0.1, 0.3),
  referenceRgb(0.2, 0.5, 0.1),
  referenceRgb(0.35, 0.45, 0.25),
  referenceRgb(0.05, 0.15, 0.55),
]);

function referenceInput(
  historyDepth: number,
  historyNormal: TemporalTaaVec3,
): TemporalTaaResolveInput {
  return Object.freeze({
    currentColor: referenceRgba(0.25, 0.35, 0.45, 0.8),
    currentDepth: 0.4,
    currentNormal: referenceVec3(0, 0, 1),
    historyColor: referenceRgba(0.9, 0.05, 0.6, 0.2),
    historyDepth,
    historyNormal,
    historyValid: true,
    neighborhood: REFERENCE_NEIGHBORHOOD,
    responsiveMask: 0.5,
  });
}

export const TEMPORAL_TAA_REFERENCE_CASES: readonly [
  TemporalTaaReferenceCase,
  TemporalTaaReferenceCase,
  TemporalTaaReferenceCase,
] = Object.freeze([
  Object.freeze({
    id: 'accepted',
    input: referenceInput(0.403, referenceVec3(0.2, 0, 0.98)),
  }),
  Object.freeze({
    id: 'depth-rejected',
    input: referenceInput(0.45, referenceVec3(0.2, 0, 0.98)),
  }),
  Object.freeze({
    id: 'normal-rejected',
    input: referenceInput(0.403, referenceVec3(0, 1, 0)),
  }),
]);

function encodeReferenceResult(result: TemporalTaaResolveResult): readonly number[] {
  return Object.freeze([
    ...result.outputColor,
    ...result.clampedHistoryColor,
    result.historyWeight,
    ...result.neighborhoodMinimum,
    result.depthDifference,
    ...result.neighborhoodMaximum,
    result.normalSimilarity,
    result.depthTolerance,
    result.rejected ? 1 : 0,
    result.responsiveMask,
    TEMPORAL_TAA_DEFAULT_OPTIONS.baseHistoryWeight,
  ]);
}

export function evaluateDeterministicTemporalTaaReference(): DeterministicTemporalTaaReference {
  const cases = Object.freeze(
    TEMPORAL_TAA_REFERENCE_CASES.map(({ id, input }) =>
      Object.freeze({ id, result: resolveTemporalTaa(input) }),
    ),
  );
  return Object.freeze({
    cases,
    values: Object.freeze(cases.flatMap(({ result }) => encodeReferenceResult(result))),
  });
}
