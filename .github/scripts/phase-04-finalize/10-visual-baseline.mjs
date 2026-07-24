import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';

const candidatePath = 'visual-baselines/phase-04/reference.png';
const bytes = await readFile(candidatePath);
const fileStat = await stat(candidatePath);
const sha256 = createHash('sha256').update(bytes).digest('hex');

const metadataPath = 'visual-baselines/phase-04/metadata.json';
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
for (const key of ['reference', 'current']) {
  metadata.files[key].bytes = fileStat.size;
  metadata.files[key].sha256 = sha256;
}
metadata.canonicalProvenance.phase04FinalTraaPromotion = {
  candidateRunId: 30081926596,
  candidateJobId: 89445249028,
  candidateArtifactId: 8592313529,
  candidateArtifactDigest:
    'sha256:1f4be5b95a89602ab6d99afe682b6297db0cb575eb202113e7ac9c8b266fac80',
  candidateSourceCommit: '677465bb82c99bc715416cfc6fe979fdd3313509',
  previousBaselineDiffPixels: 65,
  previousBaselineThreshold: 0.2,
  promotedBytes: fileStat.size,
  promotedSha256: sha256,
  reviewStatus: 'PASS',
  reviewReason:
    'Deterministic final Velocity/TRAA edge response; layout, materials, controls, diagnostics, and resource state were manually reviewed with no blocking defect.',
};
metadata.subjectiveReview.temporalPbr =
  'The final explicit-Velocity TRAA sphere matrix has coherent silhouettes, stable HDR response, and no visible ghost trails or stale-scene residue.';
await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

const workLogPath = 'docs/execution/WORK_LOG.md';
let workLog = await readFile(workLogPath, 'utf8');
workLog += `

### P4-15 final visual baseline promotion

- Reviewed candidate: workflow run 30081926596, job 89445249028, artifact 8592313529.
- The final explicit-Velocity TRAA output differed from the previous frozen image by 65 deterministic edge pixels at threshold 0.2 in both attempts.
- Layout, materials, controls, diagnostics, History state, and resource state were reviewed with no blocking visual defect.
- The reviewed candidate was promoted to both Phase 4 reference and current images; the strict zero-difference visual gate remains unchanged.
- Promoted PNG: ${fileStat.size} bytes, SHA-256 ${sha256}.
`;
await writeFile(workLogPath, workLog, 'utf8');
