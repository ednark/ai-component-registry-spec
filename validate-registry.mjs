#!/usr/bin/env node
/**
 * AI Component Registry — Registry Validator
 *
 * Lints any registry that follows the ai-component-registry-spec:
 *   - registry.config.json required fields
 *   - tile agent-meta blocks parse as JSON
 *   - required metadata presence (warning-level unless the registry declares it)
 *   - dangling references (relatedComponents, coordination, recipes)
 *   - recipe component files exist
 *   - index freshness + facet coverage
 *   - index size budget (leanness rule)
 *
 * Usage:
 *   node _base/validate-registry.mjs                    # validate cwd registry
 *   node _base/validate-registry.mjs /path/to/registry  # validate another registry
 *   node _base/validate-registry.mjs --conformance /path/to/registry
 *       # run only the 5-step conformance flow (facets -> index -> filter ->
 *       # tile -> meta parse), for cross-registry spec-generality checks
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFORMANCE_ONLY = process.argv.includes('--conformance');
const argPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
const ROOT = argPath ? resolve(argPath) : process.cwd();

const errors = [];
const warnings = [];
const error = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// --- 1. Config ---

const configPath = join(ROOT, 'registry.config.json');
let config;
if (!existsSync(configPath)) {
  console.error(`✗ No registry.config.json at ${configPath}`);
  process.exit(1);
}
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (e) {
  console.error(`✗ registry.config.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

const REQUIRED_CONFIG = ['name', 'description', 'agentMetaId', 'tileDir', 'facets', 'indexSchemaVersion', 'repo', 'base'];
for (const field of REQUIRED_CONFIG) {
  if (config[field] === undefined) error(`registry.config.json missing required field: ${field}`);
}

const { agentMetaId, tileDir = 'infinite', facets = [], additionalFields = [] } = config;
const TILE_DIR = join(ROOT, tileDir);

// What the registry *declares* governs which metadata checks are hard errors.
const declares = {
  coordination: additionalFields.includes('coordination') || facets.some((f) => ['costTier', 'prerequisites'].includes(f)),
  compliance: facets.includes('fedRampLevel') || (additionalFields || []).includes('compliance'),
  mobileUX: facets.includes('touchTargetSize') || (additionalFields || []).includes('mobileUX'),
  recipes: facets.includes('compositionRecipes') || existsSync(join(TILE_DIR, 'recipes')),
};

// --- 2. Tiles ---

function findHtmlFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    const stat = statSync(full);
    if (stat.isDirectory()) findHtmlFiles(full, files);
    else if (item.endsWith('.html')) files.push(full);
  }
  return files;
}

const tileFiles = findHtmlFiles(TILE_DIR);
const componentDirs = new Set(
  tileFiles.map((f) => f.replace(TILE_DIR + '/', '').split('/')[0])
);
const metaById = new Map();

for (const file of tileFiles) {
  const relPath = file.replace(TILE_DIR + '/', '');
  const html = readFileSync(file, 'utf-8');
  const re = new RegExp(`<script[^>]*id="${agentMetaId}"[^>]*>([\\s\\S]*?)</script>`, 'i');
  const match = html.match(re);
  if (!match) {
    error(`${relPath}: missing ${agentMetaId} metadata block`);
    continue;
  }
  let meta;
  try {
    meta = JSON.parse(match[1]);
  } catch (e) {
    error(`${relPath}: ${agentMetaId} block is not valid JSON: ${e.message}`);
    continue;
  }

  metaById.set(relPath, meta);

  // file convention varies by registry: tileDir-relative (USWDS) or
  // registry-root-relative (forever). Accept either; only mismatch = error.
  const fileMatches =
    meta.file === relPath || meta.file === `${tileDir}/${relPath}`;
  if (meta.file !== undefined && !fileMatches) error(`${relPath}: meta.file is "${meta.file}" (mismatch)`);
  if (meta.file === undefined) warn(`${relPath}: missing meta.file`);
  if (!meta.title) error(`${relPath}: missing title`);

  const version = meta._schemaVersion || 1;
  if (CONFORMANCE_ONLY) continue;

  if (version >= 2) {
    for (const cat of ['discovery', 'selection', 'instruction', 'constraints']) {
      if (!meta[cat]) warn(`${relPath}: schema v2 but missing category "${cat}"`);
    }
  }

  if (declares.coordination) {
    const c = meta.coordination;
    if (!c) warn(`${relPath}: missing coordination block`);
    else {
      for (const refKey of ['prerequisiteComponents', 'incompatibleWith']) {
        for (const ref of c[refKey] || []) {
          const name = typeof ref === 'string' ? ref : ref.name;
          if (!componentDirs.has(name)) error(`${relPath}: coordination.${refKey} references unknown component "${name}"`);
        }
      }
      if (!c.compositionCost?.costTier) warn(`${relPath}: coordination.compositionCost.costTier missing`);
    }
  }

  if (declares.compliance && !meta.discovery?.compliance) warn(`${relPath}: missing discovery.compliance (registry declares compliance facets)`);
  if (declares.mobileUX && !meta.discovery?.mobileUX) warn(`${relPath}: missing discovery.mobileUX (registry declares mobileUX facets)`);
}

// --- 3. Recipes ---

const recipesDir = join(TILE_DIR, 'recipes');
if (existsSync(recipesDir)) {
  const declaredRecipeNames = new Set();
  for (const item of readdirSync(recipesDir)) {
    if (!item.endsWith('.json') || item === 'index.json') continue;
    let recipe;
    try {
      recipe = JSON.parse(readFileSync(join(recipesDir, item), 'utf-8'));
    } catch (e) {
      error(`recipes/${item}: invalid JSON: ${e.message}`);
      continue;
    }
    if (!recipe.recipe) error(`recipes/${item}: missing "recipe" name`);
    declaredRecipeNames.add(recipe.recipe);

    const seen = new Set();
    for (const c of recipe.components || []) {
      if (!c.file) error(`recipes/${item}: component missing "file"`);
      else if (!existsSync(join(TILE_DIR, c.file))) error(`recipes/${item}: references missing tile "${c.file}"`);
      if (c.order === undefined) warn(`recipes/${item}: component "${c.file}" missing order`);
      if (seen.has(c.order)) warn(`recipes/${item}: duplicate order ${c.order}`);
      seen.add(c.order);
    }
    if (!recipe.nesting) warn(`recipes/${item}: missing nesting description`);
    if (!Array.isArray(recipe.a11yNotes) || recipe.a11yNotes.length === 0) warn(`recipes/${item}: missing a11yNotes`);
  }
  const indexFile = join(recipesDir, 'index.json');
  if (!existsSync(indexFile)) warn('recipes/index.json manifest missing');
  else {
    try {
      const manifest = JSON.parse(readFileSync(indexFile, 'utf-8'));
      for (const r of manifest.recipes || []) {
        if (!existsSync(join(TILE_DIR, 'recipes', `${r.name}.json`))) error(`recipes/index.json: ${r.name} has no recipe file`);
        if (!declaredRecipeNames.has(r.name) && declaredRecipeNames.size) warn(`recipes/index.json: ${r.name} not found on disk`);
      }
    } catch (e) {
      error(`recipes/index.json: invalid JSON: ${e.message}`);
    }
  }
  // Tiles claiming recipes must name real recipes
  for (const [relPath, meta] of metaById) {
    for (const name of meta.coordination?.compositionRecipes || []) {
      if (declaredRecipeNames.size && !declaredRecipeNames.has(name)) {
        warn(`${relPath}: compositionRecipes references unknown recipe "${name}"`);
      }
    }
  }
}

// --- Class-field completeness (registry metadata defect class) ---
// The discovery class field (uswdClass/govukClass/frClass/eclClass/canadaClass)
// is required for class-level coverage checking. The T2 round-trip caught
// 149/152 USWDS tiles missing it — this rule makes that defect impossible
// to reintroduce silently.
{
  const classField = {
    'uswds-ai-components': 'uswdClass',
    'govuk-ai-components': 'govukClass',
    'dsfr-ai-components': 'frClass',
    'ecl-ai-components': 'eclClass',
    'canada-ai-components': 'canadaClass'
  }[config.name];
  if (classField && metaById.size) {
    const missing = [...metaById.entries()].filter(([, m]) => !m.discovery?.[classField]);
    if (missing.length) {
      warn(`class-field "${classField}" missing on ${missing.length}/${metaById.size} tiles (e.g. ${missing[0][0]}) — class-level coverage checking will be incomplete`);
    }
  }
}

// --- 3. Version history + compatibility maps ---

const versionsFile = join(TILE_DIR, 'versions.json');
if (existsSync(versionsFile)) {
  try {
    const versions = JSON.parse(readFileSync(versionsFile, 'utf-8'));
    for (const v of versions.versions || []) {
      if (!v.version) error('versions.json: entry missing "version"');
      if (!v.migrationPath) error(`versions.json: ${v.version || '?'} missing migrationPath`);
      if (!v.releaseDate) warn(`versions.json: ${v.version || '?'} missing releaseDate`);
    }
    if (config.updated && versions.versions?.length) {
      const latest = versions.versions[versions.versions.length - 1].version;
      if (latest !== config.updated) warn(`versions.json latest (${latest}) != config.updated (${config.updated})`);
    }
  } catch (e) {
    error(`versions.json: invalid JSON: ${e.message}`);
  }
}

const compatFile = join(ROOT, 'compatibility.json');
if (existsSync(compatFile)) {
  let compat;
  try {
    compat = JSON.parse(readFileSync(compatFile, 'utf-8'));
  } catch (e) {
    error(`compatibility.json: invalid JSON: ${e.message}`);
    compat = null;
  }
  if (compat) {
    for (const [sectionKey, section] of Object.entries(compat)) {
      if (sectionKey.startsWith('_') || !section || typeof section !== 'object' || !section.target) continue;
      if (!sectionKey.includes('-to-')) continue;
      for (const [component, entry] of Object.entries(section)) {
        if (component.startsWith('_') || component === 'target') continue;
        if (!entry || typeof entry !== 'object') {
          error(`compatibility.json: ${sectionKey}.${component} is not an object`);
          continue;
        }
        if (!entry.adaptation) warn(`compatibility.json: ${sectionKey}.${component} missing "adaptation"`);
        if (entry.adaptation === 'css-only' && !entry.classMap) {
          warn(`compatibility.json: ${sectionKey}.${component} is css-only but has no classMap`);
        }
        for (const [cls, targetCls] of Object.entries(entry.classMap || {})) {
          if (targetCls !== null && typeof targetCls !== 'string') {
            error(`compatibility.json: ${sectionKey}.${component}.classMap.${cls} must be a string or null`);
          }
        }
        if (!componentDirs.has(component) && componentDirs.size) {
          warn(`compatibility.json: ${sectionKey} references unknown component family "${component}"`);
        }
      }
    }
  }
}

// --- 4. Index freshness + facet coverage ---

const indexPath = join(TILE_DIR, 'components.index.json');
if (!existsSync(indexPath)) {
  error(`missing ${tileDir}/components.index.json — run generate-index.mjs`);
} else {
  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch (e) {
    error(`components.index.json is not valid JSON: ${e.message}`);
    index = null;
  }
  if (index) {
    if (index.counts?.total !== tileFiles.length) {
      warn(`index counts.total (${index.counts?.total}) != tile count (${tileFiles.length}) — regenerate index`);
    }
    const indexedFiles = new Set((index.components || []).map((c) => c.file));
    for (const f of metaById.keys()) {
      if (!indexedFiles.has(f)) warn(`tile "${f}" missing from index — regenerate index`);
    }

    // Facet coverage
    for (const facet of facets) {
      const withFacet = (index.components || []).filter((c) => {
        const v = c[facet];
        return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
      }).length;
      if (withFacet === 0) warn(`facet "${facet}" has zero coverage across ${tileFiles.length} tiles`);
      else if (withFacet < tileFiles.length) (CONFORMANCE_ONLY ? console.error : console.log)(`  ℹ facet "${facet}" coverage: ${withFacet}/${tileFiles.length} (partial facets are valid)`);
    }

    // Leanness budget — per-record, scale-free (a lean 600-record index is fine;
    // prose bloat shows up in the average, not the total)
    const bytes = statSync(indexPath).size;
    const recordCount = Math.max((index.components || []).length, 1);
    const perRecord = bytes / recordCount;
    if (perRecord > 3072) error(`index averages ${Math.round(perRecord)}B/record (over 3KB) — move prose out of the index`);
    else if (perRecord > 2048) warn(`index averages ${Math.round(perRecord)}B/record (over 2KB) — check for bloated fields`);
    else (CONFORMANCE_ONLY ? console.error : console.log)(`  ℹ index leanness: ${Math.round(perRecord)}B/record across ${recordCount} records`);
  }
}

// facets.json exists
if (!existsSync(join(TILE_DIR, 'facets.json'))) warn(`missing ${tileDir}/facets.json`);

// --- Report ---

if (CONFORMANCE_ONLY) {
  // Conformance = the 5-step flow ran clean against this registry
  const flowOk = errors.length === 0 && metaById.size > 0;
  console.log(JSON.stringify({
    registry: config.name || ROOT,
    conformance: flowOk ? 'pass' : 'fail',
    tiles: metaById.size,
    errors: errors.length,
  }, null, 2));
  process.exit(flowOk ? 0 : 1);
}

console.log(`Registry: ${config.name || ROOT}`);
console.log(`Tiles scanned: ${tileFiles.length}`);
console.log('');
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log(`\nErrors: ${errors.length}, Warnings: ${warnings.length}`);
process.exit(errors.length > 0 ? 1 : 0);
