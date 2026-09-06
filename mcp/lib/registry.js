/**
 * Local registry loader for the MCP server.
 *
 * Reads everything from the current working directory (the registry repo being
 * served), so the same generic server works for any sub-registry that includes
 * the base spec as a submodule. No network calls — pure local filesystem.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_ROOT = process.cwd();

let _config = null;

export function loadConfig() {
  if (_config) return _config;
  const configPath = join(REGISTRY_ROOT, 'registry.config.json');
  try {
    _config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e) {
    throw new Error(`Cannot read registry.config.json at ${configPath}: ${e.message}`);
  }
  return _config;
}

export function getTileDir() {
  const { tileDir = 'infinite' } = loadConfig();
  return join(REGISTRY_ROOT, tileDir);
}

export function readIndex() {
  const { tileDir = 'infinite' } = loadConfig();
  const path = join(REGISTRY_ROOT, tileDir, 'components.index.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function readFacets() {
  const { tileDir = 'infinite' } = loadConfig();
  const path = join(REGISTRY_ROOT, tileDir, 'facets.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function listTileFiles() {
  const dir = getTileDir();
  const files = [];
  function walk(d) {
    for (const item of readdirSync(d)) {
      if (item === 'components.index.json' || item === 'facets.json') continue;
      const full = join(d, item);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (item.endsWith('.html')) files.push(full.replace(dir + '/', ''));
    }
  }
  walk(dir);
  return files;
}

/**
 * Read a component tile. Returns the raw HTML and the parsed agent-meta block.
 */
export function readTile(file) {
  const dir = getTileDir();
  const full = join(dir, file);
  if (!existsSync(full)) {
    throw new Error(`Tile not found: ${file}`);
  }
  const html = readFileSync(full, 'utf-8');
  const { agentMetaId } = loadConfig();
  const metaRegex = new RegExp(
    `<script[^>]*id="${agentMetaId}"[^>]*>([\\s\\S]*?)</script>`,
    'i'
  );
  const match = html.match(metaRegex);
  let meta = null;
  if (match) {
    try {
      meta = JSON.parse(match[1]);
    } catch (e) {
      throw new Error(`Failed to parse ${agentMetaId} in ${file}: ${e.message}`);
    }
  }
  return { html, meta, file };
}

/**
 * Read an adapter mapping file for a component, if it exists.
 */
export function readAdapter(component) {
  const path = join(REGISTRY_ROOT, 'adapters', `${component}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function readAdapterManifest() {
  const path = join(REGISTRY_ROOT, 'adapters', 'adapters.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Family-level cross-system compatibility map (e.g. USWDS → GOV.UK / Carbon).
 * Location: `compatibilityPath` from registry.config.json (relative to the
 * registry root; defaults to ./compatibility.json for single-registry repos —
 * monorepo registries point at a shared cross/ directory).
 */
export function readCompatibility() {
  const { compatibilityPath = 'compatibility.json' } = loadConfig();
  const path = join(REGISTRY_ROOT, compatibilityPath);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Surface 4: Component Recipes.
 * Recipes live at {tileDir}/recipes/{name}.json with an index.json manifest.
 */
export function listRecipes() {
  const { tileDir = 'infinite' } = loadConfig();
  const manifestPath = join(REGISTRY_ROOT, tileDir, 'recipes', 'index.json');
  if (!existsSync(manifestPath)) return { schemaVersion: 1, count: 0, recipes: [] };
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

export function readRecipe(name) {
  const { tileDir = 'infinite' } = loadConfig();
  const safe = String(name).replace(/[^a-z0-9-]/gi, '');
  const path = join(REGISTRY_ROOT, tileDir, 'recipes', `${safe}.json`);
  if (!existsSync(path)) {
    throw new Error(`Recipe not found: ${safe}. Use list_recipes or get_recipe without a name to see available recipes.`);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Version-history groundwork (Surface 5, planned). Reads
 * {tileDir}/versions.json if the registry publishes one; returns
 * { available: false } otherwise so agents can probe without failing.
 */
export function readVersions(component) {
  const { tileDir = 'infinite' } = loadConfig();
  const path = component
    ? join(REGISTRY_ROOT, tileDir, component, 'versions.json')
    : join(REGISTRY_ROOT, tileDir, 'versions.json');
  if (!existsSync(path)) return { available: false, note: 'This registry does not publish version history yet (Surface 5).' };
  return { available: true, ...JSON.parse(readFileSync(path, 'utf-8')) };
}
