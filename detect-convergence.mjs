#!/usr/bin/env node
// Convergence detector v2 — Surface 7 sensor (protocol.md).
//
// Reads one or more registries' observations.json and reports design-system
// namespace extensions by how many distinct sites observed them.
//
// v2: canonicalizes class spellings before grouping — modifier separators are
// config-driven (registry.config.json modifierSeparators, longest first), and
// single-dash splits are anchored to the registry's known families so
// hyphenated family names (usa-sign-up) don't split into fake families.
// Also reports a family rollup (per observation.family distinct-site counts).
//
// Read-only report. Convergence is a SENSOR READING, not a promotion path:
// extensions enter the canon registry only when the mainline design system
// ships them — at which point they arrive through the normal purity path.
//
// Usage:
//   node _base/detect-convergence.mjs <registry-path> [more-paths...] [--min N]
//   node _base/detect-convergence.mjs .            # single registry, cwd

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const minIdx = argv.indexOf('--min');
const MIN = minIdx !== -1 ? parseInt(argv[minIdx + 1], 10) || 3 : 3;
const paths = argv.filter((a, i) => !a.startsWith('--') && (minIdx === -1 || i !== minIdx + 1)).map((p) => resolve(p));

if (!paths.length) {
  console.error('Usage: node _base/detect-convergence.mjs <registry-path> [more...] [--min N]');
  process.exit(1);
}

// canonical form: family--variant, anchored to known families.
// Longest-first known-family match guards hyphenated family names
// (usa-sign-up is one family, not family "sign" + variant "up").
function canonicalize(token, prefix, seps, known) {
  let rest = token.startsWith(prefix) ? token.slice(prefix.length) : token;
  for (const sep of seps) {
    if (sep.length >= 2) {
      const i = rest.indexOf(sep);
      if (i > 0) return { key: rest.slice(0, i) + '--' + rest.slice(i + sep.length), family: rest.slice(0, i), variant: rest.slice(i + sep.length) };
    }
  }
  const parts = rest.split('-');
  for (let take = parts.length - 1; take >= 1; take--) {
    const fam = parts.slice(0, take).join('-');
    if (known.has(fam)) return { key: fam + '--' + parts.slice(take).join('-'), family: fam, variant: parts.slice(take).join('-') };
  }
  for (const sep of seps) {
    const i = rest.indexOf(sep);
    if (i > 0) return { key: rest.slice(0, i) + '--' + rest.slice(i + sep.length), family: rest.slice(0, i), variant: rest.slice(i + sep.length) };
  }
  return { key: rest, family: rest, variant: null };
}

const byCanonical = new Map();
const byFamily = new Map();
let total = 0, registriesRead = 0, spellings = 0;

for (const root of paths) {
  const config = JSON.parse(readFileSync(join(root, 'registry.config.json'), 'utf-8'));
  const tileDir = config.tileDir ?? 'infinite';
  const obsPath = join(root, tileDir, 'observations.json');
  if (!existsSync(obsPath)) {
    console.log(`ℹ ${config.name}: no observations.json — skipping`);
    continue;
  }
  registriesRead++;
  const obs = JSON.parse(readFileSync(obsPath, 'utf-8'));

  // class prefix: mode of the first hyphen-segment across index *Class fields
  let prefix = null;
  const idxPath = join(root, tileDir, 'components.index.json');
  if (existsSync(idxPath)) {
    const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
    const seg = new Map();
    for (const c of idx.components) {
      for (const [k, v] of Object.entries(c)) {
        if (/class$/i.test(k) && typeof v === 'string') {
          const s = v.trim().split(/\s+/)[0].split('-')[0] + '-';
          seg.set(s, (seg.get(s) || 0) + 1);
        }
      }
    }
    if (seg.size) prefix = [...seg.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  const seps = (config.modifierSeparators?.length ? [...config.modifierSeparators] : ['--', '__', '-']).sort((a, b) => b.length - a.length);
  const known = new Set();
  if (existsSync(idxPath)) {
    const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
    for (const c of idx.components) known.add(c.file.split('/')[0]);
  }
  const corePath = join(root, tileDir, 'core-classes.json');
  if (existsSync(corePath)) {
    try {
      const cj = JSON.parse(readFileSync(corePath, 'utf8'));
      for (const list of Object.values(cj.categories || {})) {
        for (const cls of list) {
          const i = cls.indexOf('-');
          if (i > 0) known.add(cls.slice(i + 1).split('__')[0]);
        }
      }
    } catch { /* shape checked by the validator */ }
  }

  for (const o of obs.observations || []) {
    if (o.kind !== 'extension' || !o.extension) continue;
    total++;
    const canon = canonicalize(o.extension, prefix || '', seps, known);
    if (canon.key !== o.extension) spellings++;
    if (!byCanonical.has(canon.key)) byCanonical.set(canon.key, { canonical: canon.key, family: o.family || canon.family, extensions: new Set(), sites: new Map() });
    const rec = byCanonical.get(canon.key);
    rec.extensions.add(o.extension);
    if (!rec.sites.has(o.site)) rec.sites.set(o.site, o.url);
    if (o.family) {
      if (!byFamily.has(o.family)) byFamily.set(o.family, { sites: new Map(), extensions: new Set() });
      byFamily.get(o.family).sites.set(o.site, o.url);
      byFamily.get(o.family).extensions.add(o.extension);
    }
  }
}

const rows = [...byCanonical.values()].sort((a, b) => b.sites.size - a.sites.size);
console.log(`\nDesign-system namespace convergence — ${total} extension observations across ${registriesRead} registrie(s), ${rows.length} distinct extensions (canonicalized; ${spellings} spelling variant(s) merged)\n`);

const watch = [];
for (const r of rows) {
  const line = `${String(r.sites.size).padStart(2)} site(s)  ${r.canonical.padEnd(34)} [${r.family}]  as: ${[...r.extensions].join(', ')} — ${[...r.sites.keys()].join(', ')}`;
  if (r.sites.size >= MIN) { watch.push(r); console.log('▲ ' + line); }
  else console.log('  ' + line);
}

console.log(`\nFamily rollup (observation.family → distinct sites):`);
const fams = [...byFamily.values()].sort((a, b) => b.sites.size - a.sites.size);
for (const f of fams) {
  console.log(`  ${String(f.sites.size).padStart(2)} site(s)  [${[...byFamily.keys()].find(k => byFamily.get(k) === f)}]  extensions: ${[...f.extensions].join(', ')}`);
}

console.log(`\nWatchlist (≥${MIN} independent sites, class level): ${watch.length}`);
console.log('These are ecosystem demand signals only. Extensions enter the canon');
console.log('registry solely when the mainline design system ships them — then they');
console.log('arrive through the normal purity path with their own provenance.');
console.log('(sensor reading — no registry state was modified)');
