from pathlib import Path


def update(path, pairs):
    p = Path(path)
    text = p.read_text()
    for old, new in pairs:
        if old not in text:
            raise RuntimeError(f'{path}: missing {old}')
        text = text.replace(old, new)
    p.write_text(text)

update('packages/renderer/test/dynamic-taa-gpu-history.test.ts', [
    ('estimatedGpuBytes: 384', 'estimatedGpuBytes: 416'),
    ('estimatedGpuBytes: 1536', 'estimatedGpuBytes: 1664'),
    ('toHaveBeenCalledTimes(7)', 'toHaveBeenCalledTimes(8)'),
    ('activeEstimatedBytes: 384', 'activeEstimatedBytes: 416'),
    ('activeEstimatedBytes: 1536', 'activeEstimatedBytes: 1664'),
    ('texture: { activeCount: 7', 'texture: { activeCount: 8'),
    ('createdTotal: 16', 'createdTotal: 18'),
    ('destroyedTotal: 8', 'destroyedTotal: 9'),
    ('activeCount: 8', 'activeCount: 9'),
])

for path in [
    'packages/renderer/test/dynamic-taa-present-pass.test.ts',
    'packages/renderer/test/dynamic-taa-resolve-pass.test.ts',
]:
    update(path, [
        ('texture: { activeCount: 7, activeEstimatedBytes: 1152 }', 'texture: { activeCount: 8, activeEstimatedBytes: 1248 }'),
    ])

update('packages/renderer/test/dynamic-taa-present-pass.test.ts', [('activeCount: 13', 'activeCount: 14')])
update('packages/renderer/test/dynamic-taa-resolve-pass.test.ts', [('activeCount: 12', 'activeCount: 13')])

update('packages/renderer/test/pbr-render-feature.test.ts', [
    ('stable 448-byte', 'stable 512-byte'),
    ('toHaveLength(112)', 'toHaveLength(128)'),
    ('data.length === 112', 'data.length === 128'),
])

print('resource snapshots aligned')
