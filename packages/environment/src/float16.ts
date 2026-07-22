import { KyxosEngineError } from '@kyxos/render-core';

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'environment',
    recoverable: false,
  });
}

function roundToEven(value: number): number {
  const lower = Math.floor(value);
  const fraction = value - lower;
  return fraction > 0.5 || (fraction === 0.5 && lower % 2 !== 0) ? lower + 1 : lower;
}

/** Deterministic IEEE-754 binary16 encoding with round-to-nearest behavior. */
export function float32ToFloat16Bits(value: number): number {
  if (Number.isNaN(value)) return 0x7e00;
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const magnitude = Math.abs(value);
  if (magnitude === Number.POSITIVE_INFINITY) return sign | 0x7c00;
  if (magnitude === 0 || magnitude < 2 ** -25) return sign;
  if (magnitude < 2 ** -14) {
    return sign | Math.min(0x03ff, roundToEven(magnitude / 2 ** -24));
  }
  if (magnitude > 65_504) return sign | 0x7c00;

  let exponent = Math.floor(Math.log2(magnitude));
  let mantissa = roundToEven((magnitude / 2 ** exponent - 1) * 1024);
  if (mantissa === 1024) {
    exponent += 1;
    mantissa = 0;
  }
  if (exponent > 15) return sign | 0x7c00;
  return sign | ((exponent + 15) << 10) | mantissa;
}

export function float16BitsToFloat32(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    invalid('Float16 bits must be an unsigned 16-bit integer.');
  }
  const sign = (value & 0x8000) === 0 ? 1 : -1;
  const exponent = (value >>> 10) & 0x1f;
  const mantissa = value & 0x03ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

export function encodeFloat16(values: ArrayLike<number>): Uint16Array {
  const result = new Uint16Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    result[index] = float32ToFloat16Bits(values[index] as number);
  }
  return result;
}
