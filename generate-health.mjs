#!/usr/bin/env node
// generate-health.mjs — publish a registry's trust surface.
//
// Emits registry-health.json at the registry root: the machine-readable
// summary a downstream agent or maintainer reads to decide how much to trust
// the registry before fetching components from it. All inputs already exist
// (config, tiles, observations, findings ledger, validator); this only
// aggregates them and makes them addressable.
//
// The point is calibration, not a green dashboard: a registry that publishes
// its drift register, its unstamped tiles and its last check date is telling
// you where NOT to trust it, which is the only honest form of trust.
//
// Usage:
//   node _base/generate-health.mjs                    # validate-as-side-effect
//   node _base/generate-health.mjs --allow-fail       # emit even if validation errors

import fs from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const ALLOW_FAIL = process.argv.includes('--allow-fail');
const read = (p) => {
  try { return JSON.parse(fs.readFileSync(join(ROOT, p), 'utf8')); } catch { return null; }
};
const exists = (p) => fs.existsSync(join(ROOT, p));

const config = read('registry.config.json');
if (!config) { console.error('generate-health: no registry.config.json — run from the registry root'); process.exit(1); }
const tileDir = config.tileDir ?? 'infinite';
const index = read(`${tileDir}/components.index.json`);
const obs = read(`${tileDir}/observations.json`);
const ledger = read(`${tileDir}/findings.json`);
const core = read(`${tileDir}/core-classes.json`);

const ds = config.designSystem ?? {};
const pin = ds.version;
const cc = config.staticView?.classCheck;
const prefixes = cc ? (Array.isArray(cc.prefix) ? cc.prefix : [cc.prefix]) : [];
const allowlist = cc?.allowlist ?? [];

// Stamp census against the live tiles.
function walk(dir, o = []) {
  for (const i of fs.readdirSync(dir)) {
    const p = join(dir, i);
    if (fs.statSync(p).isDirectory()) walk(p, o);
    else if (i.endsWith('.html') && !i.endsWith('.resolved.html')) o.push(p);
  }
  return o;
}
let total = 0, verified = 0;
if (pin) {
  for (const f of walk(join(ROOT, tileDir))) {
    total++;
    const h = fs.readFileSync(f, 'utf8');
    const id = (h.match(/id="([^"]*agent-meta[^"]*)"/) || [])[1];
    if (!id) continue;
    const m = h.match(new RegExp('<script[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</script>'));
    if (!m) continue;
    try { if (JSON.parse(m[1])?.provenance?.designSystemVersion === pin) verified++; } catch { /* shape checked by the validator */ }
  }
}

// Drift register, bucketed by the reason a maintainer wrote.
const cats = { drift: 0, appLayer: 0, siteLayer: 0, extension: 0, canonicalUnstyled: 0, other: 0 };
for (const a of allowlist) {
  const r = (a.reason || '').toLowerCase();
  if (r.includes('canonical markup with no css')) cats.canonicalUnstyled++;
  else if (r.includes('app layer') || r.includes('publishing')) cats.appLayer++;
  else if (r.includes('site layer') || r.includes('not part of')) cats.siteLayer++;
  else if (r.includes('extension')) cats.extension++;
  else if (r.includes('drift') || r.includes('pre-')) cats.drift++;
  else cats.other++;
}

// Convergence watchlist: extensions observed on 2+ independent sites.
let watchlist = 0;
try {
  const out = execFileSync('node', [join(ROOT, '_base', 'detect-convergence.mjs'), '.', '--min', '2'], { encoding: 'utf8' });
  const line = (out.match(/Watchlist \(≥2 independent sites, class level\): (\d+)/) || [])[1];
  if (line !== undefined) watchlist = Number(line);
} catch { /* detector absent or failed — the field is simply omitted */ }

// Conformance: ask the shipped validator (its own result is the datum).
let conformance = 'unknown';
try {
  const out = execFileSync('node', [join(ROOT, '_base', 'validate-registry.mjs'), '.', '--conformance'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  conformance = JSON.parse(out).conformance;
} catch (e) {
  try { conformance = JSON.parse(e.stdout).conformance; } catch { /* keep unknown */ }
  if (!ALLOW_FAIL && conformance === 'fail') {
    console.error('generate-health: registry does not conform — fix it first (or pass --allow-fail)');
    process.exit(1);
  }
}

// Last deep check: newest ledger entry of kind deep-check (or upgrade).
const deepChecks = (ledger?.findings ?? []).filter((e) => e.kind === 'deep-check' || e.kind === 'upgrade');
deepChecks.sort((a, b) => String(b.date).localeCompare(String(a.date)));
const lastDeepCheck = deepChecks[0]?.date ?? null;

const families = new Set((index?.components ?? []).map((c) => c.file.split('/')[0]));
const obsCount = (obs?.observations ?? []).length;

const health = {
  schemaVersion: 1,
  registry: config.name,
  description: 'Machine-readable trust surface: what this registry claims, and how far that claim has been checked. A registry with drift or unstamped tiles is telling you where not to trust it.',
  designSystem: {
    name: ds.name,
    pin,
    package: ds.package ?? null,
    groundTruth: ds.verification?.groundTruth ?? null,
    verification: ds.verification
      ? { markup: ds.verification.markup, styling: ds.verification.styling }
      : null,
  },
  classCheck: cc
    ? { enabled: true, prefixes, allowlistSize: allowlist.length, categories: cats }
    : { enabled: false, prefixes: [], allowlistSize: 0, categories: null },
  stamps: total ? { verified, total, percent: Math.round((verified / total) * 100) } : null,
  tiles: total,
  families: families.size,
  coreClasses: core ? Object.values(core.categories ?? {}).reduce((n, l) => n + l.length, 0) : null,
  observations: obsCount,
  convergenceWatchlist: obsCount ? watchlist : null,
  findings: ledger
    ? { count: ledger.findings.length, lastDeepCheck, byResult: countBy(ledger.findings, 'result') }
    : null,
  conformance,
  generatedBy: '_base/generate-health.mjs',
  generatedAt: new Date().toISOString().slice(0, 10),
};

function countBy(arr, k) {
  return arr.reduce((m, e) => { m[e[k]] = (m[e[k]] || 0) + 1; return m; }, {});
}

fs.writeFileSync(join(ROOT, 'registry-health.json'), JSON.stringify(health, null, 2) + '\n');
console.log(`registry-health.json: pin ${pin} · stamps ${verified}/${total} · classCheck ${cc ? 'on' : 'off'} · conformance ${conformance} · last deep check ${lastDeepCheck ?? 'none recorded'}`);
