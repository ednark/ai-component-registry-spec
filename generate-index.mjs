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
    // Skip the index files themselves
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
  // Try to extract the configured agent-meta block
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

// --- Generic facet building ---

/**
 * Build facet counts for a single field across all components.
 * Handles strings, arrays, and objects generically.
 */
function buildFacetForField(components, field) {
  const counts = {};

  for (const comp of components) {
    const value = comp[field];
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      // Array field: count each element
      for (const v of value) {
        if (v === null || v === undefined) continue;
        const key = String(v);
        counts[key] = (counts[key] || 0) + 1;
      }
    } else if (typeof value === 'object') {
      // Object field (e.g., a11y): iterate keys
      for (const [k, v] of Object.entries(value)) {
        if (typeof v === 'boolean') {
          if (v) {
            // Count true booleans under the key name
            counts[k] = (counts[k] || 0) + 1;
          }
        } else if (v !== null && v !== undefined) {
          // Count string/number values
          const key = String(v);
          counts[key] = (counts[key] || 0) + 1;
        }
      }
    } else {
      // String, number, or boolean: count the value directly
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
  console.log('');

  console.log('Scanning component tiles...');
  const htmlFiles = findHtmlFiles(TILE_DIR);
  console.log(`Found ${htmlFiles.length} component tiles`);

  const components = [];

  for (const file of htmlFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      const relPath = file.replace(TILE_DIR + '/', '');

      let meta = extractMeta(content, relPath);

      if (meta) {
        // Ensure file path and id are correct
        meta.file = relPath;
        if (!meta.id) {
          meta.id = relPath.replace(/\//g, '-').replace('.html', '');
        }
        components.push(meta);
        console.log(`  \u2713 ${relPath}`);
      } else {
        // Fall back to basic extraction
        const basicMeta = extractBasicMeta(content, relPath);
        basicMeta.file = relPath;
        basicMeta.id = relPath.replace(/\//g, '-').replace('.html', '');
        components.push(basicMeta);
        console.log(`  ~ ${relPath} (basic metadata only)`);
      }
    } catch (e) {
      console.error(`  \u2717 Error reading ${file}:`, e.message);
    }
  }

  // Build facets
  console.log('\nBuilding facets...');
  const facets = buildAllFacets(components);

  // Build counts
  const counts = {
    total: components.length,
  };

  // Add bySection if section facet exists
  if (facets.section) {
    counts.bySection = facets.section;
  }

  // Build index JSON
  const indexJson = {
    schemaVersion: indexSchemaVersion,
    ...(taxonomyVersion !== undefined && { taxonomyVersion }),
    generatedBy: '_base/generate-index.mjs',
    counts,
    components,
  };

  // Build facets JSON
  const facetsJson = {
    schemaVersion: indexSchemaVersion,
    ...(taxonomyVersion !== undefined && { taxonomyVersion }),
    generatedBy: '_base/generate-index.mjs',
    total: components.length,
    ...(designSystem && { designSystem: `${designSystem.name} ${designSystem.version || ''}`.trim() }),
    facets,
  };

  // Write files
  console.log('\nWriting index files...');
  writeFileSync(COMPONENTS_INDEX, JSON.stringify(indexJson, null, 2));
  console.log(`  \u2713 ${COMPONENTS_INDEX}`);

  writeFileSync(FACETS_FILE, JSON.stringify(facetsJson, null, 2));
  console.log(`  \u2713 ${FACETS_FILE}`);

  console.log(`\nDone! Generated index with ${components.length} components`);
}

// Run
generate();
