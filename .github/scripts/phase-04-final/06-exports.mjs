import { replaceExact } from './helpers.mjs';

await replaceExact(
  'packages/renderer/src/index.ts',
  `  type TemporalTaaSettings,
  type TemporalTaaSettingsDescriptor,`,
  `  type TemporalTaaAdvancedResolveSettings,
  type TemporalTaaResolveSettings,
  type TemporalTaaSettings,
  type TemporalTaaSettingsDescriptor,`,
);
await replaceExact(
  'packages/sdk/src/temporal-pbr.ts',
  `  type TemporalTaaSettings,
  type TemporalTaaSettingsDescriptor,`,
  `  type TemporalTaaAdvancedResolveSettings,
  type TemporalTaaResolveSettings,
  type TemporalTaaSettings,
  type TemporalTaaSettingsDescriptor,`,
);
