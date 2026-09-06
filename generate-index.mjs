#!/usr/bin/env node
/**
 * AI Component Registry — Generic Index Generator
 *
 * Reads registry.config.json from the project root (or a path passed as CLI arg),
 * scans all component HTML tiles in the configured tileDir,
 * extracts the embedded agent-meta JSON block (using the configured agentMetaId),
 * and regenerates:
 *   - {tileDir}/components.index.json
 *   - {tileDir}/facets.json
 *
 * Supports both metadata schema v1 (flat) and v2 (categorized):
 *   - v1: all fields at top level (legacy)
 *   - v2: fields organized into discovery/selection/instruction/coordination/constraints
 *
 * Usage:
 *   node _base/generate-index.mjs                    # reads registry.config.json from cwd
 *   node _base/generate-index.mjs /path/to/config    # reads config from given path
 *
 * This is the shared generator that works for any sub-registry.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Load config ---

const configPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(process.cwd(), 'registry.config.json');

let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (e) {
  console.error(`Cannot read registry.config.json at ${configPath}:`, e.message);
  console.error('Run this script from your registry root, or pass the config path as an argument.');
  process.exit(1);
}

const {
  name,
  agentMetaId,
  tileDir = 'infinite',
  facets: configuredFacets = [],
  indexSchemaVersion = 1,
  metadataSchemaVersion: configMetadataVersion = 1,
  taxonomyVersion,
  designSystem,
  repo,
  base,
  additionalFields = [],
} = config;

const ROOT = process.cwd();
const TILE_DIR = join(ROOT, tileDir);
const COMPONENTS_INDEX = join(TILE_DIR, 'components.index.json');
const FACETS_FILE = join(TILE_DIR, 'facets.json');

// --- File scanning ---

function findHtmlFiles(dir, files = []) {
  const items = readdirSync(dir);
  for (const item of items) {
    if (item === 'components.index.json' || item === 'facets.json') continue;
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findHtmlFiles(fullPath, files);
    } else if (item.endsWith('.html')) {
      files.push(fullPath);
    }
  }
  return files;
}

// --- Metadata extraction ---

function extractMeta(htmlContent, filePath) {
  const metaRegex = new RegExp(
    `<script[^>]*id="${agentMetaId}"[^>]*>([\\s\\S]*?)</script>`,
    'i'
  );
  const match = htmlContent.match(metaRegex);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      console.warn(`  Warning: Failed to parse ${agentMetaId} in ${filePath}:`, e.message);
      return null;
    }
  }
  return null;
}

function extractBasicMeta(htmlContent, filePath) {
  const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
  const descMatch = htmlContent.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
  return {
    title: titleMatch ? titleMatch[1] : basename(filePath, '.html'),
    description: descMatch ? descMatch[1] : '',
  };
}

// --- Schema normalization ---

/**
 * Normalize v2 categorized metadata into the flat index format.
 * The index always uses flat fields for backward compatibility with
 * existing agent code that filters by top-level facet names.
 *
 * Leanness rule: the index carries discovery facets and lean summary
 * fields ONLY. Adaptation prose (agentPrompt, useWhen/avoidWhen,
 * preserve/editable/limitations, portability maps) travels in the tile's
 * agent-meta block — one fetch returns code + instructions together.
 */
function normalizeV2ToFlat(meta) {
  const flat = {
    file: meta.file,
    title: meta.title,
    _schemaVersion: meta._schemaVersion || 2,
  };

  if (meta.discovery) {
    Object.assign(flat, meta.discovery);
  }

  // Compliance & mobileUX: keep the full blocks out of the index; expose only
  // flattened summary fields for facet filtering.
  const compliance = meta.discovery?.compliance || meta.compliance;
  if (compliance) {
    if (compliance.fedRampLevel !== undefined) flat.fedRampLevel = compliance.fedRampLevel;
    if (compliance.piiHandling !== undefined) flat.piiHandling = compliance.piiHandling;
    if (compliance.auditTrailCompatible !== undefined) flat.auditTrailCompatible = compliance.auditTrailCompatible;
    if (Array.isArray(compliance.nistControls)) flat.nistControls = compliance.nistControls;
    delete flat.compliance;
  }
  const mobileUX = meta.discovery?.mobileUX || meta.mobileUX;
  if (mobileUX) {
    if (mobileUX.touchTargetSize !== undefined) flat.touchTargetSize = mobileUX.touchTargetSize;
    delete flat.mobileUX;
  }
  if (Array.isArray(meta.supportedTokenProfiles)) {
    flat.supportedTokenProfiles = meta.supportedTokenProfiles;
  }

  // Selection: useWhen/avoidWhen are prose and live in the tile only.
  // Agents read them from the tile after selecting it.

  // Instruction: keep name-list fields; prose (agentPrompt) stays in the tile.
  if (meta.instruction) {
    if (meta.instruction.relatedComponents) flat.relatedComponents = meta.instruction.relatedComponents;
    if (meta.instruction.variants) flat.variants = meta.instruction.variants;
  }

  // Coordination: only lean summary fields go into the index.
  // Verbose detail (reasons, sequences, full cost object) stays in the tile.
  if (meta.coordination) {
    const coord = meta.coordination;
    if (Array.isArray(coord.prerequisiteComponents)) {
      flat.prerequisites = coord.prerequisiteComponents
        .map((p) => (typeof p === 'string' ? p : p.name))
        .filter(Boolean);
    }
    if (Array.isArray(coord.incompatibleWith)) {
      flat.incompatibleWith = coord.incompatibleWith
        .map((p) => (typeof p === 'string' ? p : p.name))
        .filter(Boolean);
    }
    if (coord.compositionCost && coord.compositionCost.costTier) {
      flat.costTier = coord.compositionCost.costTier;
    }
    if (Array.isArray(coord.compositionRecipes)) {
      flat.compositionRecipes = coord.compositionRecipes;
    }
  }

  // Constraints & portability: never in the index — enforced at tile level
  // (constraints.preserve/editable/limitations, portableInvariants,
  // portability.classMapping). One tile fetch returns code + instructions.

  return flat;
}

/**
 * Detect metadata schema version and normalize to flat format for the index.
 */
function normalizeMeta(meta) {
  const version = meta._schemaVersion || 1;
  if (version >= 2) {
    return normalizeV2ToFlat(meta);
  }
  // v1 (flat) tiles: strip known prose fields so the index stays lean for
  // legacy registries too — the leanness rule applies regardless of schema.
  const PROSE_FIELDS = [
    'agentPrompt', 'useWhen', 'avoidWhen',
    'preserveElements', 'editableAreas', 'knownLimitations',
    'portableInvariants', 'portability', 'settings', 'tokenOverrides',
  ];
  const lean = { ...meta };
  for (const f of PROSE_FIELDS) delete lean[f];
  return lean;
}

// --- Generic facet building ---

function buildFacetForField(components, field) {
  const counts = {};

  for (const comp of components) {
    const value = comp[field];
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      for (const v of value) {
        if (v === null || v === undefined) continue;
        const key = String(v);
        counts[key] = (counts[key] || 0) + 1;
      }
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (typeof v === 'boolean') {
          if (v) {
            counts[k] = (counts[k] || 0) + 1;
          }
        } else if (v !== null && v !== undefined) {
          const key = String(v);
          counts[key] = (counts[key] || 0) + 1;
        }
      }
    } else {
      const key = String(value);
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  return counts;
}

function buildAllFacets(components) {
  const facets = {};
  for (const field of configuredFacets) {
    const counts = buildFacetForField(components, field);
    if (Object.keys(counts).length > 0) {
      facets[field] = counts;
    }
  }
  return facets;
}

// --- Main generation ---

function generate() {
  console.log(`Registry: ${name}`);
  console.log(`Agent meta ID: ${agentMetaId}`);
  console.log(`Tile directory: ${tileDir}`);
  console.log(`Config metadata schema version: ${configMetadataVersion}`);
  console.log('');

  console.log('Scanning component tiles...');
  const htmlFiles = findHtmlFiles(TILE_DIR);
  console.log(`Found ${htmlFiles.length} component tiles`);

  const components = [];
  let v1Count = 0;
  let v2Count = 0;

  for (const file of htmlFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      const relPath = file.replace(TILE_DIR + '/', '');

      let meta = extractMeta(content, relPath);

      if (meta) {
        meta.file = relPath;
        if (!meta.id) {
          meta.id = relPath.replace(/\//g, '-').replace('.html', '');
        }

        const version = meta._schemaVersion || 1;
        if (version >= 2) v2Count++;
        else v1Count++;

        const normalized = normalizeMeta(meta);
        components.push(normalized);
        console.log(`  ✓ ${relPath} (schema v${version})`);
      } else {
        const basicMeta = extractBasicMeta(content, relPath);
        basicMeta.file = relPath;
        basicMeta.id = relPath.replace(/\//g, '-').replace('.html', '');
        components.push(basicMeta);
        v1Count++;
        console.log(`  ~ ${relPath} (basic metadata only)`);
      }
    } catch (e) {
      console.error(`  ✗ Error reading ${file}:`, e.message);
    }
  }

  console.log(`\nSchema versions: ${v1Count} v1, ${v2Count} v2`);

  // Build facets
  console.log('\nBuilding facets...');
  const facets = buildAllFacets(components);

  // Build counts
  const counts = {
    total: components.length,
  };

  if (facets.section) {
    counts.bySection = facets.section;
  }

  // Build index JSON
  const indexJson = {
    schemaVersion: indexSchemaVersion,
    metadataSchemaVersion: configMetadataVersion,
    ...(taxonomyVersion !== undefined && { taxonomyVersion }),
    generatedBy: '_base/generate-index.mjs',
    counts,
    components,
  };

  // Build facets JSON
  const facetsJson = {
    schemaVersion: indexSchemaVersion,
    metadataSchemaVersion: configMetadataVersion,
    ...(taxonomyVersion !== undefined && { taxonomyVersion }),
    generatedBy: '_base/generate-index.mjs',
    total: components.length,
    ...(designSystem && { designSystem: `${designSystem.name} ${designSystem.version || ''}`.trim() }),
    facets,
  };

  // Write files
  console.log('\nWriting index files...');
  writeFileSync(COMPONENTS_INDEX, JSON.stringify(indexJson, null, 2));
  console.log(`  ✓ ${COMPONENTS_INDEX}`);

  writeFileSync(FACETS_FILE, JSON.stringify(facetsJson, null, 2));
  console.log(`  ✓ ${FACETS_FILE}`);

  console.log(`\nDone! Generated index with ${components.length} components`);
}

// Run
generate();
