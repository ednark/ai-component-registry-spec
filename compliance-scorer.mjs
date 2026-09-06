#!/usr/bin/env node
/**
 * AI Component Registry — Compliance Coverage Scorer
 *
 * Scores a registry's compliance readiness against a target FedRAMP impact
 * level and optional PII/audit requirements. Reads the flattened compliance
 * summaries from components.index.json (fedRampLevel, piiHandling,
 * auditTrailCompatible, nistControls).
 *
 * Semantics are conservative: a component is "cleared" for a target level
 * only if its reviewed fedRampLevel floor is >= the target. Components with
 * a lower floor are "pending review", not failures — someone must review and
 * raise the floor before claiming coverage.
 *
 * Usage:
 *   node _base/compliance-scorer.mjs                        # cwd registry, IL2
 *   node _base/compliance-scorer.mjs --target-level IL4
 *   node _base/compliance-scorer.mjs --target-level IL4 --requires-pii-input
 *   node _base/compliance-scorer.mjs --target-level IL4 --json
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const hasFlag = (flag) => args.includes(flag);

const ROOT = process.cwd();
const configPath = join(ROOT, 'registry.config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const { tileDir = 'infinite', name } = config;

const indexPath = join(ROOT, tileDir, 'components.index.json');
if (!existsSync(indexPath)) {
  console.error(`✗ missing ${indexPath} — run generate-index.mjs first`);
  process.exit(1);
}
const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
const components = index.components || [];

const LEVELS = ['IL2', 'IL2+', 'IL4', 'IL5'];
const targetLevel = argValue('--target-level') || 'IL2';
if (!LEVELS.includes(targetLevel)) {
  console.error(`✗ unknown target level "${targetLevel}" (use one of: ${LEVELS.join(', ')})`);
  process.exit(1);
}
const minIndex = LEVELS.indexOf(targetLevel);
const requiresPiiInput = hasFlag('--requires-pii-input');

const withCompliance = components.filter((c) => c.fedRampLevel !== undefined);
const cleared = withCompliance.filter((c) => LEVELS.indexOf(c.fedRampLevel) >= minIndex);
const pendingReview = withCompliance.filter((c) => LEVELS.indexOf(c.fedRampLevel) < minIndex);
const missingData = components.filter((c) => c.fedRampLevel === undefined);

// PII handling
const piiInput = withCompliance.filter((c) => c.piiHandling === 'accepts_input');
const piiDisplay = withCompliance.filter((c) => c.piiHandling === 'displays_only');
const piiInputCleared = piiInput.filter((c) => LEVELS.indexOf(c.fedRampLevel) >= minIndex);

// Audit trail
const auditCapable = withCompliance.filter((c) => c.auditTrailCompatible);

// NIST control coverage
const controlContributors = {};
for (const c of withCompliance) {
  for (const control of c.nistControls || []) {
    (controlContributors[control] ||= []).push(c.file);
  }
}

const coveragePct = withCompliance.length
  ? Math.round((cleared.length / withCompliance.length) * 1000) / 10
  : 0;

const report = {
  registry: name,
  targetLevel,
  totalComponents: components.length,
  complianceMetadata: withCompliance.length,
  clearedForTarget: cleared.length,
  pendingReview: pendingReview.map((c) => c.file),
  coverage: `${coveragePct}%`,
  pii: {
    inputComponents: piiInput.length,
    inputClearedForTarget: piiInputCleared.length,
    displayOnly: piiDisplay.length,
  },
  auditTrailCompatible: auditCapable.length,
  nistControlsCovered: Object.fromEntries(
    Object.entries(controlContributors).map(([k, v]) => [k, v.length])
  ),
  recommendation:
    pendingReview.length === 0
      ? `Registry is fully cleared for ${targetLevel} at current review state.`
      : `${pendingReview.length} component(s) have a reviewed floor below ${targetLevel}. Their fedRampLevel must be raised (or the components excluded) before claiming ${targetLevel} coverage. Do not rely on unreviewed components in a ${targetLevel} proposal.` +
        (requiresPiiInput ? ` PII-accepting components cleared for ${targetLevel}: ${piiInputCleared.length}/${piiInput.length}.` : ''),
};

if (missingData.length) {
  report.missingComplianceMetadata = missingData.map((c) => c.file);
}

if (hasFlag('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Registry:      ${report.registry}`);
  console.log(`Target level:  ${report.targetLevel}`);
  console.log(`Coverage:      ${report.coverage} (${report.clearedForTarget}/${report.complianceMetadata} cleared)`);
  console.log(`Pending review: ${report.pendingReview.length}`);
  console.log(`PII inputs:    ${report.pii.inputComponents} (cleared: ${report.pii.inputClearedForTarget})`);
  console.log(`Audit-capable: ${report.auditTrailCompatible}`);
  console.log(`NIST controls: ${Object.entries(report.nistControlsCovered).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}`);
  console.log(`\n${report.recommendation}`);
}
