// Pre-publication quality gate. Runs on schema-validated generated drafts and
// decides pass / hold / reject against the persona, the retrieved evidence, and
// recent editorial memory.

export {
  runQualityGate,
  evidenceUrlsOf,
  openingOf,
  type QualityGateReport,
  type QualityGateInput,
  type QualityCheckResult,
  type QualityVerdict
} from './gate';
