import { KyxosEngineError } from '@kyxos/render-core';

export const MATERIAL_TEXTURE_SEMANTICS = [
  'base-color',
  'emissive',
  'metallic-roughness',
  'normal',
  'occlusion',
] as const;

export type MaterialTextureSemantic = (typeof MATERIAL_TEXTURE_SEMANTICS)[number];
export type TextureTransferFunction = 'linear' | 'srgb';
export type TextureChannelSelection = 'b' | 'g-b' | 'r' | 'rgb' | 'rgba';
export type Vec2 = readonly [x: number, y: number];

export interface MaterialTextureSemanticInfo {
  readonly channels: TextureChannelSelection;
  readonly semantic: MaterialTextureSemantic;
  readonly transferFunction: TextureTransferFunction;
}

export interface MaterialTextureReferenceDescriptor {
  readonly id: string;
  readonly transferFunction: TextureTransferFunction;
}

export interface MaterialTextureReference {
  readonly id: string;
  readonly transferFunction: TextureTransferFunction;
}

export interface UvTransformDescriptor {
  readonly offset?: Vec2;
  readonly rotation?: number;
  readonly scale?: Vec2;
  readonly texCoord?: number;
}

export interface UvTransform {
  readonly offset: Vec2;
  readonly rotation: number;
  readonly scale: Vec2;
  readonly texCoord: number;
}

export interface MaterialTextureBindingDescriptor extends UvTransformDescriptor {
  readonly texture: MaterialTextureReference;
}

export interface MaterialTextureBinding {
  readonly texture: MaterialTextureReference;
  readonly transform: UvTransform;
}

const SEMANTICS: Readonly<Record<MaterialTextureSemantic, MaterialTextureSemanticInfo>> =
  Object.freeze({
    'base-color': Object.freeze({
      channels: 'rgba',
      semantic: 'base-color',
      transferFunction: 'srgb',
    }),
    emissive: Object.freeze({
      channels: 'rgb',
      semantic: 'emissive',
      transferFunction: 'srgb',
    }),
    'metallic-roughness': Object.freeze({
      channels: 'g-b',
      semantic: 'metallic-roughness',
      transferFunction: 'linear',
    }),
    normal: Object.freeze({
      channels: 'rgb',
      semantic: 'normal',
      transferFunction: 'linear',
    }),
    occlusion: Object.freeze({
      channels: 'r',
      semantic: 'occlusion',
      transferFunction: 'linear',
    }),
  });

function invalid(message: string): never {
  throw new KyxosEngineError(message, {
    code: 'INVALID_ARGUMENT',
    module: 'material',
    recoverable: false,
  });
}

function finiteVec2(value: Vec2, label: string): Vec2 {
  if (value.length !== 2 || value.some((component) => !Number.isFinite(component))) {
    invalid(`${label} must contain two finite values.`);
  }
  return Object.freeze([...value]) as unknown as Vec2;
}

export function materialTextureSemanticInfo(
  semantic: MaterialTextureSemantic,
): MaterialTextureSemanticInfo {
  const result = SEMANTICS[semantic];
  if (result === undefined) invalid(`Unknown material texture semantic "${String(semantic)}".`);
  return result;
}

export function createMaterialTextureReference(
  descriptor: MaterialTextureReferenceDescriptor,
): MaterialTextureReference {
  const id = descriptor.id.trim();
  if (id.length === 0) invalid('Material texture reference id must not be empty.');
  if (descriptor.transferFunction !== 'linear' && descriptor.transferFunction !== 'srgb') {
    invalid('Material texture transferFunction must be "linear" or "srgb".');
  }
  return Object.freeze({ id, transferFunction: descriptor.transferFunction });
}

export function createUvTransform(descriptor: UvTransformDescriptor = {}): UvTransform {
  const texCoord = descriptor.texCoord ?? 0;
  if (!Number.isSafeInteger(texCoord) || texCoord < 0) {
    invalid('Texture coordinate index must be a nonnegative safe integer.');
  }
  const rotation = descriptor.rotation ?? 0;
  if (!Number.isFinite(rotation)) invalid('UV rotation must be finite.');
  return Object.freeze({
    offset: finiteVec2(descriptor.offset ?? [0, 0], 'UV offset'),
    rotation,
    scale: finiteVec2(descriptor.scale ?? [1, 1], 'UV scale'),
    texCoord,
  });
}

export function createMaterialTextureBinding(
  descriptor: MaterialTextureBindingDescriptor,
): MaterialTextureBinding {
  const texture = createMaterialTextureReference(descriptor.texture);
  return Object.freeze({ texture, transform: createUvTransform(descriptor) });
}

export function materialTextureBindingKey(binding: MaterialTextureBinding): string {
  const normalized = createMaterialTextureBinding({
    offset: binding.transform.offset,
    rotation: binding.transform.rotation,
    scale: binding.transform.scale,
    texCoord: binding.transform.texCoord,
    texture: binding.texture,
  });
  return JSON.stringify([
    normalized.texture.id,
    normalized.texture.transferFunction,
    normalized.transform.texCoord,
    normalized.transform.offset,
    normalized.transform.scale,
    normalized.transform.rotation,
  ]);
}
