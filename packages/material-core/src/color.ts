import { KyxosEngineError } from '@kyxos/render-core';

export type RgbColor = readonly [red: number, green: number, blue: number];
export type RgbaColor = readonly [red: number, green: number, blue: number, alpha: number];

const SRGB_TO_LINEAR_THRESHOLD = 0.04045;
const LINEAR_TO_SRGB_THRESHOLD = 0.0031308;

function error(message: string): KyxosEngineError {
  return new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'material',
    recoverable: false,
  });
}

function finiteChannel(value: number, label: string): number {
  if (!Number.isFinite(value)) throw error(`${label} must be finite.`);
  return value;
}

function unitChannel(value: number, label: string): number {
  finiteChannel(value, label);
  if (value < 0 || value > 1) throw error(`${label} must be from 0 through 1.`);
  return value;
}

export function createLinearRgb(value: RgbColor, label = 'linear RGB'): RgbColor {
  return Object.freeze([
    unitChannel(value[0], `${label} red`),
    unitChannel(value[1], `${label} green`),
    unitChannel(value[2], `${label} blue`),
  ]);
}

export function createLinearRgba(value: RgbaColor, label = 'linear RGBA'): RgbaColor {
  return Object.freeze([
    unitChannel(value[0], `${label} red`),
    unitChannel(value[1], `${label} green`),
    unitChannel(value[2], `${label} blue`),
    unitChannel(value[3], `${label} alpha`),
  ]);
}

export function srgbChannelToLinear(value: number): number {
  const channel = finiteChannel(value, 'sRGB channel');
  const magnitude = Math.abs(channel);
  if (magnitude <= SRGB_TO_LINEAR_THRESHOLD) return channel / 12.92;
  return Math.sign(channel) * ((magnitude + 0.055) / 1.055) ** 2.4;
}

export function linearChannelToSrgb(value: number): number {
  const channel = finiteChannel(value, 'Linear channel');
  const magnitude = Math.abs(channel);
  if (magnitude <= LINEAR_TO_SRGB_THRESHOLD) return channel * 12.92;
  return Math.sign(channel) * (1.055 * magnitude ** (1 / 2.4) - 0.055);
}

export function srgbToLinearRgb(value: RgbColor): RgbColor {
  return Object.freeze(value.map(srgbChannelToLinear)) as unknown as RgbColor;
}

export function linearToSrgbRgb(value: RgbColor): RgbColor {
  return Object.freeze(value.map(linearChannelToSrgb)) as unknown as RgbColor;
}

export function srgbToLinearRgba(value: RgbaColor): RgbaColor {
  finiteChannel(value[3], 'Alpha channel');
  return Object.freeze([
    srgbChannelToLinear(value[0]),
    srgbChannelToLinear(value[1]),
    srgbChannelToLinear(value[2]),
    value[3],
  ]);
}

export function linearToSrgbRgba(value: RgbaColor): RgbaColor {
  finiteChannel(value[3], 'Alpha channel');
  return Object.freeze([
    linearChannelToSrgb(value[0]),
    linearChannelToSrgb(value[1]),
    linearChannelToSrgb(value[2]),
    value[3],
  ]);
}
