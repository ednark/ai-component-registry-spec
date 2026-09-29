#!/usr/bin/env node
// Convergence detector — Surface 7 sensor (protocol.md).
//
// Reads one or more registries' observations.json and reports design-system
// namespace extensions by how many distinct sites observed them.
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

const byExtension = new Map();
let total = 0, registriesRead = 0;

for (const root of paths) {
  const config = JSON.parse(readFileSync(join(root, 'registry.config.json'), 'utf-8'));
  const tileDir = config.tileDir ?? 'infinite';
  const obsPath = join(root, tileDir, 'observations.json');
  if (!existsSync(obsPath)) {
    console.log(`ℹ ${config.name}: no observations.json — skipping`);
    continue;
  }
  const obs = JSON.parse(readFileSync(obsPath, 'utf-8'));
  registriesRead++;
  for (const o of obs.observations || []) {
    if (o.kind !== 'extension' || !o.extension) continue;
    total++;
    const key = o.extension.toLowerCase();
    if (!byExtension.has(key)) byExtension.set(key, { extension: o.extension, family: o.family, sites: new Map() });
    const rec = byExtension.get(key);
    rec.family = rec.family || o.family;
    if (!rec.sites.has(o.site)) rec.sites.set(o.site, o.url);
  }
}

const rows = [...byExtension.values()].sort((a, b) => b.sites.size - a.sites.size);
console.log(`\nDesign-system namespace convergence — ${total} extension observations across ${registriesRead} registrie(s), ${rows.length} distinct extensions\n`);

const watch = [];
for (const r of rows) {
  const line = `${String(r.sites.size).padStart(2)} site(s)  ${r.extension.padEnd(34)} [${r.family}]  ${[...r.sites.keys()].join(', ')}`;
  if (r.sites.size >= MIN) { watch.push(r); console.log('▲ ' + line); }
  else console.log('  ' + line);
}

console.log(`\nWatchlist (≥${MIN} independent sites): ${watch.length}`);
if (watch.length) {
  console.log('These are ecosystem demand signals only. Extensions enter the canon');
  console.log('registry solely when the mainline design system ships them — then they');
  console.log('arrive through the normal purity path with their own provenance.');
}
console.log('(sensor reading — no registry state was modified)');
