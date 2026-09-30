#!/usr/bin/env node
// lint-spec.mjs — every rule in the spec must declare where it came from.
//
//   [evidence: ecl:F-007]  a rule a test produced (cite the ledger finding)
//   [design-decision]      taste: a judgement call, not a measured one
//
// This is what makes the epistemic layer self-maintaining: the spec cannot
// quietly grow unearned rules, and a reader can tell at a glance which rules
// are load-bearing. It is per-spec, so it lives here rather than in
// validate-registry.mjs (which runs per registry).
//
// Usage: node lint-spec.mjs [--fix-hint]

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

const DOCS = ['protocol.md', 'tile-format.md', 'deep-check.md', 'findings-ledger.md'];
// One or more citations: [evidence: uswds:F-002] or [evidence: canada:F-001, uswds:F-002]
const MARKER = /\[(evidence:\s*[a-z0-9-]+:F-\d+(\s*,\s*[a-z0-9-]+:F-\d+)*|design-decision)\]/i;

// Which constructs count as "rule-bearing": normative bullets and the
// requirement lines under them. A rule we should be able to trace.
const isRule = (line) => {
  const t = line.trim();
  if (!t) return false;
  if (/^(#{1,6}\s|\||>|```|\*\*)/.test(t)) return false;      // headings, tables, quotes, code
  if (t.startsWith('- ') || t.startsWith('* ')) return true;     // bullets
  if (/^(must|must not|never|always|required|forbidden)\b/i.test(t)) return true;
  if (/^\d+\.\s+\S/.test(t) && t.length > 24) return true;       // numbered requirements
  return false;
};

let total = 0, marked = 0, missing = 0;
const byDoc = {};

// Group lines into rule blocks: a rule starts at a rule line and absorbs the
// indented continuation lines beneath it. A marker anywhere in the block
// counts — prose rules span lines, and putting the marker mid-sentence would
// read worse than putting it at the end of the rule.
const isContinuation = (line, prevWasRule) => {
  if (!line.trim()) return false;
  return /^\s{2,}\S/.test(line) && prevWasRule;
};

for (const doc of DOCS) {
  let text;
  try { text = readFileSync(join(process.cwd(), doc), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  byDoc[doc] = { rules: 0, marked: 0, missing: [] };
  let inRule = false;
  lines.forEach((line, i) => {
    if (isRule(line)) inRule = true;
    else if (isContinuation(line, inRule)) return; // part of the current rule
    else inRule = false;

    if (!isRule(line)) return;
    // Collect the whole block, then test for a marker in any of it.
    let block = line;
    for (let j = i + 1; j < lines.length; j++) {
      if (!isContinuation(lines[j], true)) break;
      block += '\n' + lines[j];
    }
    total++; byDoc[doc].rules++;
    if (MARKER.test(block)) { marked++; byDoc[doc].marked++; return; }
    missing++;
    byDoc[doc].missing.push(`${i + 1}: ${line.trim().slice(0, 96)}`);
  });
}

for (const [doc, s] of Object.entries(byDoc)) {
  console.log(`${doc.padEnd(22)} ${String(s.rules).padStart(3)} rule lines · ${String(s.marked).padStart(3)} marked · ${s.missing.length} unmarked`);
}
console.log(`\ntotal: ${total} rule lines · ${marked} marked · ${missing} unmarked`);

// Integrity: a citation to a finding that does not exist is worse than no
// citation, because it looks earned. Resolve every <registry>:F-NNN against
// that registry's ledger (sibling directories of the spec).
const CITE = /\[evidence:\s*([a-z0-9-]+):(F-\d+)/g;
const siblingRegistries = (() => {
  const out = [];
  const up = resolvePath(process.cwd(), '..');
  if (!existsSync(up)) return out;
  for (const d of readdirSync(up)) {
    const p = resolvePath(up, d);
    if (statSync(p).isDirectory() && existsSync(resolvePath(p, 'infinite', 'findings.json'))) out.push(d);
  }
  return out;
})();
const ledgers = new Map(); // short name -> finding ids
const ledgersById = new Map(); // full finding id -> registry (for reporting)
// The spec repo has its own ledger for cross-registry findings, cited spec:F-NNN.
try {
  const own = JSON.parse(readFileSync(join(process.cwd(), 'findings.json'), 'utf8')).findings.map((f) => f.id);
  ledgers.set('spec', own);
  for (const id of own) ledgersById.set(`spec:${id}`, 'ai-component-registry-spec');
} catch { /* no spec ledger yet — spec: citations will report as dangling */ }
for (const reg of siblingRegistries) {
  try {
    const ids = JSON.parse(readFileSync(resolvePath(process.cwd(), '..', reg, 'infinite', 'findings.json'), 'utf8')).findings.map((f) => f.id);
    // A citation may name the registry short ("uswds") or full ("uswds-ai-components").
    // Index both so either form resolves.
    ledgers.set(reg, ids);
    const short = reg.replace(/-ai-components$/, '');
    ledgers.set(short, ids);
    for (const id of ids) ledgersById.set(`${short}:${id}`, reg);
  } catch { /* unreadable — treat as empty */ }
}

const cites = new Set();
for (const doc of DOCS) {
  let text; try { text = readFileSync(join(process.cwd(), doc), 'utf8'); } catch { continue; }
  for (const m of text.matchAll(CITE)) cites.add(`${m[1]}:${m[2]}`);
}
let dangling = 0;
for (const c of cites) {
  const [reg, id] = c.split(':');
  if (!ledgers.has(reg)) { console.log(`  ✗ ${c} — no findings ledger found for registry "${reg}"`); dangling++; }
  else if (!ledgers.get(reg).includes(id)) { console.log(`  ✗ ${c} — ${reg} has no finding ${id} (a citation that resolves to nothing is not evidence)`); dangling++; }
}
console.log(`citations: ${cites.size} distinct · ${dangling} dangling`);
if (!ledgers.size) console.log('  ℹ no sibling registries with ledgers found — citation integrity not checked');

if (missing || dangling) {
  if (missing) {
    console.log('\nUnmarked rules (each needs [evidence: <registry>:F-NNN] or [design-decision]):');
    for (const m of Object.entries(byDoc).flatMap(([doc, s]) => s.missing.map((x) => `${doc} ${x}`)).slice(0, 40)) console.log('  ' + m);
  }
  console.log('\nA rule with no marker is an assertion; a citation that resolves to nothing is worse.');
  process.exit(1);
}
console.log('\nEvery rule declares its provenance, and every citation resolves to a real finding.');
