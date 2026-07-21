import { describe, expect, it } from 'vitest';

import {
  BACKEND_FEATURES,
  backendResourceHandleKind,
  createBackendCapabilityReport,
  isBackendResourceHandle,
} from '../src/index.js';

describe('backend capability contracts', () => {
  it('produces a complete immutable report with conservative feature defaults', () => {
    const report = createBackendCapabilityReport({
      available: false,
      backend: 'webgpu',
      features: { compute: true },
      unavailableReason: 'adapter unavailable',
    });

    expect(Object.keys(report.features)).toHaveLength(BACKEND_FEATURES.length);
    expect(report.features.compute).toBe(true);
    expect(report.features['timestamp-query']).toBe(false);
    expect(report.unavailableReason).toBe('adapter unavailable');
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.limits)).toBe(true);
  });

  it('recognizes only positive backend resource handle shapes', () => {
    expect(backendResourceHandleKind('texture')).toBe('backend:texture');
    expect(isBackendResourceHandle({ id: 1, kind: 'backend:texture' })).toBe(true);
    expect(isBackendResourceHandle({ id: 0, kind: 'backend:texture' })).toBe(false);
    expect(isBackendResourceHandle({ id: 1, kind: 'texture' })).toBe(false);
    expect(isBackendResourceHandle(undefined)).toBe(false);
  });
});
