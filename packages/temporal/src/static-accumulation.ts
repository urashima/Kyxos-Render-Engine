import { KyxosEngineError } from '@kyxos/render-core';

import { TEMPORAL_SAMPLE_LIMIT } from './convergence.js';

export type StaticAccumulationRgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

export interface StaticAccumulationInput {
  readonly accumulatedColor: StaticAccumulationRgba;
  readonly accumulatedSampleCount: number;
  readonly currentColor: StaticAccumulationRgba;
  readonly historyValid: boolean;
}

export interface StaticAccumulationResult {
  readonly currentWeight: number;
  readonly historyAccepted: boolean;
  readonly historyWeight: number;
  /** Maximum absolute RGB difference between the current sample and the accepted prior mean. */
  readonly maximumChannelDelta: number | null;
  readonly outputColor: StaticAccumulationRgba;
  readonly sampleCount: number;
}

export interface StaticAccumulationReferenceCase {
  readonly id: 'first-sample' | 'running-mean';
  readonly input: StaticAccumulationInput;
}

export interface DeterministicStaticAccumulationReference {
  readonly cases: readonly {
    readonly id: StaticAccumulationReferenceCase['id'];
    readonly result: StaticAccumulationResult;
  }[];
  readonly values: readonly number[];
}

export const STATIC_ACCUMULATION_REFERENCE_OUTPUT_FIELDS = Object.freeze([
  'output-red',
  'output-green',
  'output-blue',
  'output-alpha',
  'sample-count',
  'history-weight',
  'current-weight',
  'maximum-channel-delta',
] as const);

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'temporal',
    recoverable: false,
  });
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) invalid(`${label} must be finite and non-negative.`);
  return value;
}

function unit(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    invalid(`${label} must be finite and from 0 through 1.`);
  }
  return value;
}

function rgba(value: readonly number[], label: string): StaticAccumulationRgba {
  if (value.length !== 4) invalid(`${label} must contain four channels.`);
  return Object.freeze([
    finiteNonNegative(value[0] as number, `${label} red`),
    finiteNonNegative(value[1] as number, `${label} green`),
    finiteNonNegative(value[2] as number, `${label} blue`),
    unit(value[3] as number, `${label} alpha`),
  ]);
}

function previousSampleCount(value: number): number {
  const maximum = TEMPORAL_SAMPLE_LIMIT.maximum - 1;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    invalid(`Static accumulation sample count must be a safe integer from 0 through ${maximum}.`);
  }
  return value;
}

/**
 * Adds one linear-HDR sample to an arithmetic running mean.
 * Invalid History always restarts from the current sample and a sample count of one.
 */
export function accumulateStaticSample(input: StaticAccumulationInput): StaticAccumulationResult {
  if (typeof input.historyValid !== 'boolean') {
    invalid('Static accumulation History validity must be boolean.');
  }
  const currentColor = rgba(input.currentColor, 'Static accumulation current Color');
  const accumulatedColor = rgba(
    input.accumulatedColor,
    'Static accumulation prior Color',
  );
  const declaredSampleCount = previousSampleCount(input.accumulatedSampleCount);
  if (input.historyValid && declaredSampleCount === 0) {
    invalid('Valid Static accumulation History must contain at least one prior sample.');
  }

  const historyAccepted = input.historyValid && declaredSampleCount > 0;
  const acceptedSampleCount = historyAccepted ? declaredSampleCount : 0;
  const sampleCount = acceptedSampleCount + 1;
  const currentWeight = 1 / sampleCount;
  const historyWeight = acceptedSampleCount / sampleCount;
  const outputColor = Object.freeze([
    accumulatedColor[0] * historyWeight + currentColor[0] * currentWeight,
    accumulatedColor[1] * historyWeight + currentColor[1] * currentWeight,
    accumulatedColor[2] * historyWeight + currentColor[2] * currentWeight,
    accumulatedColor[3] * historyWeight + currentColor[3] * currentWeight,
  ]) as StaticAccumulationRgba;
  const maximumChannelDelta = historyAccepted
    ? Math.max(
        Math.abs(currentColor[0] - accumulatedColor[0]),
        Math.abs(currentColor[1] - accumulatedColor[1]),
        Math.abs(currentColor[2] - accumulatedColor[2]),
      )
    : null;

  return Object.freeze({
    currentWeight,
    historyAccepted,
    historyWeight,
    maximumChannelDelta,
    outputColor,
    sampleCount,
  });
}

function referenceRgba(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): StaticAccumulationRgba {
  return Object.freeze([red, green, blue, alpha]);
}

export const STATIC_ACCUMULATION_REFERENCE_CASES: readonly [
  StaticAccumulationReferenceCase,
  StaticAccumulationReferenceCase,
] = Object.freeze([
  Object.freeze({
    id: 'first-sample',
    input: Object.freeze({
      accumulatedColor: referenceRgba(9, 9, 9, 0.1),
      accumulatedSampleCount: 0,
      currentColor: referenceRgba(0.25, 0.5, 1, 0.75),
      historyValid: false,
    }),
  }),
  Object.freeze({
    id: 'running-mean',
    input: Object.freeze({
      accumulatedColor: referenceRgba(0.5, 1, 2, 0.5),
      accumulatedSampleCount: 3,
      currentColor: referenceRgba(1.5, 0.5, 1, 1),
      historyValid: true,
    }),
  }),
]);

export function evaluateDeterministicStaticAccumulationReference(): DeterministicStaticAccumulationReference {
  const cases = STATIC_ACCUMULATION_REFERENCE_CASES.map(({ id, input }) =>
    Object.freeze({ id, result: accumulateStaticSample(input) }),
  );
  const values = cases.flatMap(({ result }) => [
    ...result.outputColor,
    result.sampleCount,
    result.historyWeight,
    result.currentWeight,
    result.maximumChannelDelta ?? -1,
  ]);
  return Object.freeze({
    cases: Object.freeze(cases),
    values: Object.freeze(values),
  });
}
