from pathlib import Path
import re

# Replace brittle texture ordinal checks with an explicit ordered descriptor contract.
p = Path('packages/renderer/test/dynamic-taa-gpu-history.test.ts')
t = p.read_text()
pattern = re.compile(r"    expect\(createTexture\)\.toHaveBeenNthCalledWith\(1,[\s\S]*?    expect\(createSampler\)", re.M)
replacement = """    expect(createTexture.mock.calls.map(([descriptor]) => [descriptor.label, descriptor.format])).toEqual([
      ['taa-history-viewport-a-current-color', 'rgba16float'],
      ['taa-history-viewport-a-current-velocity', 'rg16float'],
      ['taa-history-viewport-a-0-color', 'rgba16float'],
      ['taa-history-viewport-a-0-depth', 'depth32float'],
      ['taa-history-viewport-a-0-normal', 'rgba16float'],
      ['taa-history-viewport-a-1-color', 'rgba16float'],
      ['taa-history-viewport-a-1-depth', 'depth32float'],
      ['taa-history-viewport-a-1-normal', 'rgba16float'],
    ]);
    expect(createSampler"""
t, count = pattern.subn(replacement, t, count=1)
if count != 1:
    raise RuntimeError('history ordinal assertion block not found')
t = t.replace('createdTotal: 9,\n      destroyedTotal: 1', 'createdTotal: 10,\n      destroyedTotal: 1')
t = t.replace('createdTotal: 9,\n      destroyedTotal: 9', 'createdTotal: 10,\n      destroyedTotal: 10')
p.write_text(t)

# Resolve must bind Velocity at slot 2 and move the accepted History contract by one slot.
p = Path('packages/renderer/test/dynamic-taa-resolve-pass.test.ts')
t = p.read_text()
pattern = re.compile(r"    expect\(createBindGroup\)\.toHaveBeenLastCalledWith\([\s\S]*?    \);\n\n    history\.commitFrame\(\);", re.M)
replacement = """    const latestEntries = createBindGroup.mock.calls.at(-1)?.[0].entries;
    expect(latestEntries).toEqual([
      { binding: 0, resource: { buffer: expect.any(Object) } },
      { binding: 1, resource: { texture: first.currentColorTexture } },
      { binding: 2, resource: { texture: first.currentVelocityTexture } },
      { binding: 3, resource: { texture: first.writeDepthTexture } },
      { binding: 4, resource: { texture: first.writeNormalTexture } },
      { binding: 5, resource: { texture: first.readColorTexture } },
      { binding: 6, resource: { texture: first.readDepthTexture } },
      { binding: 7, resource: { texture: first.readNormalTexture } },
      { binding: 8, resource: { sampler: first.sampler } },
    ]);

    history.commitFrame();"""
t, count = pattern.subn(replacement, t, count=1)
if count != 1:
    raise RuntimeError('resolve binding assertion block not found')
p.write_text(t)

p = Path('packages/renderer/test/dynamic-taa-present-pass.test.ts')
t = p.read_text().replace('expect(backend.getResourceStatistics().activeCount).toBe(8);', 'expect(backend.getResourceStatistics().activeCount).toBe(9);')
p.write_text(t)

p = Path('packages/renderer/test/pbr-render-feature.test.ts')
t = p.read_text()
t, count = re.subn(r"(expect\(descriptor\.fragment\?\.targets\?\.map\(\(\{ format \}\) => format\)\)\.toEqual\(\[\s*'rgba16float',\s*'rgba16float',)(\s*\]\);)", r"\1\n        'rg16float',\2", t, count=1)
if count != 1:
    raise RuntimeError('PBR target format assertion not found')
p.write_text(t)

print('explicit velocity assertions aligned')
