/**
 * MCP tool definitions for the AI Component Registry server.
 *
 * Mirrors the registry's retrieval flow (facets -> index -> tile) plus the
 * cross-design-system transfer layer (adapters + translate).
 *
 * Uses Zod raw shapes for input schemas (required by @modelcontextprotocol/sdk).
 */

import { z } from 'zod';
import {
  loadConfig,
  readIndex,
  readFacets,
  readTile,
  readAdapter,
  listRecipes,
  readRecipe,
  readVersions,
} from './registry.js';
import { translateTile } from './translate.js';

function json(text) {
  return { content: [{ type: 'text', text }] };
}

export function searchComponents(params) {
  const index = readIndex();
  const { query, section, requiresJs, govCompliance, a11y, tags, costTier, prerequisites, incompatibleWith, recipe, fedRampMin, piiHandling, limit } = params;
  let results = index.components;

  if (section) {
    results = results.filter((c) => c.section === section);
  }
  if (requiresJs) {
    results = results.filter((c) => c.requiresJs === requiresJs);
  }
  if (costTier) {
    results = results.filter((c) => c.costTier === costTier);
  }
  if (prerequisites && prerequisites.length) {
    results = results.filter((c) =>
      prerequisites.every((p) => (c.prerequisites || []).includes(p))
    );
  }
  if (incompatibleWith && incompatibleWith.length) {
    results = results.filter((c) =>
      !(c.incompatibleWith || []).some((p) => incompatibleWith.includes(p))
    );
  }
  if (recipe) {
    results = results.filter((c) => (c.compositionRecipes || []).includes(recipe));
  }
  if (fedRampMin) {
    const order = ['IL2', 'IL2+', 'IL4', 'IL5'];
    const min = order.indexOf(fedRampMin);
    results = results.filter((c) => {
      const lvl = order.indexOf(c.fedRampLevel || 'IL2');
      return lvl >= Math.max(min, 0);
    });
  }
  if (piiHandling) {
    results = results.filter((c) => c.piiHandling === piiHandling);
  }
  if (govCompliance && govCompliance.length) {
    results = results.filter((c) =>
      (c.govCompliance || []).some((g) => govCompliance.includes(g))
    );
  }
  if (tags && tags.length) {
    results = results.filter((c) =>
      (c.tags || []).some((t) => tags.includes(t))
    );
  }
  if (a11y && typeof a11y === 'object') {
    results = results.filter((c) => {
      const a = c.a11y || {};
      return Object.entries(a11y).every(([k, v]) => v === false || a[k] === true);
    });
  }
  if (query) {
    const q = query.toLowerCase();
    results = results.filter((c) =>
      [c.title, c.description, c.uswdsClass, ...(c.tags || [])]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }

  if (limit && Number.isInteger(limit)) {
    results = results.slice(0, limit);
  }

  return results.map((c) => ({
    file: c.file,
    title: c.title,
    description: c.description,
    section: c.section,
    variant: c.variant,
    requiresJs: c.requiresJs,
    govCompliance: c.govCompliance,
    costTier: c.costTier,
    prerequisites: c.prerequisites,
    incompatibleWith: c.incompatibleWith,
    compositionRecipes: c.compositionRecipes,
    fedRampLevel: c.fedRampLevel,
    piiHandling: c.piiHandling,
    touchTargetSize: c.touchTargetSize,
    supportedTokenProfiles: c.supportedTokenProfiles,
    tags: c.tags,
  }));
}

export function registerTools(server) {
  const config = loadConfig();

  server.registerTool(
    'search_components',
    {
      title: 'Search components',
      description:
        'Filter the registry index by facet values or free-text query and return a shortlist of matching components. Use this instead of loading the whole index.',
      inputSchema: {
        query: z.string().optional().describe('Free-text match against title, description, class, tags'),
        section: z.string().optional().describe('Filter by section facet (e.g. forms, navigation, utilities)'),
        requiresJs: z.enum(['no', 'optional', 'required']).optional().describe('JavaScript requirement'),
        costTier: z.enum(['cheap', 'moderate', 'expensive']).optional().describe('Composition cost tier (cheap/moderate/expensive)'),
        prerequisites: z.array(z.string()).optional().describe('Require these prerequisite components (e.g. ["form"])'),
        incompatibleWith: z.array(z.string()).optional().describe('Exclude components incompatible with these'),
        recipe: z.string().optional().describe('Only components participating in this recipe (e.g. contact-form)'),
        fedRampMin: z.enum(['IL2', 'IL2+', 'IL4', 'IL5']).optional().describe('Minimum suitable FedRAMP impact level'),
        piiHandling: z.enum(['accepts_input', 'displays_only', 'none']).optional().describe('PII relationship (accepts_input/displays_only/none)'),
        govCompliance: z.array(z.string()).optional().describe('Filter by compliance labels (Section 508, WCAG 2.1 AA, ...)'),
        a11y: z.record(z.boolean()).optional().describe('Require these a11y flags true (wcag21AA, keyboardNav, screenReader, ...)'),
        tags: z.array(z.string()).optional().describe('Filter by tags'),
        limit: z.number().int().optional().describe('Maximum number of results'),
      },
    },
    async (args) => json(JSON.stringify(searchComponents(args), null, 2))
  );

  server.registerTool(
    'get_component',
    {
      title: 'Get component tile',
      description:
        'Fetch a single component tile (full HTML source + parsed v2-categorized adaptation metadata). Pass the `file` path from search results.',
      inputSchema: {
        file: z.string().describe('Tile file path, e.g. button/default.html'),
      },
    },
    async ({ file }) => {
      const { html, meta } = readTile(file);
      return json(JSON.stringify({ file, html, meta: meta || null }, null, 2));
    }
  );

  server.registerTool(
    'list_facets',
    {
      title: 'List facets',
      description: 'Return the facet vocabulary (filterable values + counts) for the registry.',
      inputSchema: {},
    },
    async () => json(JSON.stringify(readFacets(), null, 2))
  );

  server.registerTool(
    'get_index',
    {
      title: 'Get discovery index',
      description:
        'Return the full or section-filtered discovery index (one lean record per component). Prefer search_components for targeted lookups.',
      inputSchema: {
        section: z.string().optional().describe('Optional section filter'),
      },
    },
    async ({ section } = {}) => {
      const index = readIndex();
      const out = section
        ? { ...index, components: index.components.filter((c) => c.section === section) }
        : index;
      return json(JSON.stringify(out, null, 2));
    }
  );

  server.registerTool(
    'get_adapter',
    {
      title: 'Get cross-system adapter',
      description:
        'Return the adapter mapping for a component to a target design system (material, bootstrap, ...). Throws if no adapter exists.',
      inputSchema: {
        component: z.string().describe('Source component name, e.g. button'),
        target: z.string().optional().describe('Target design system id (material, bootstrap)'),
      },
    },
    async ({ component, target }) => {
      const adapter = readAdapter(component);
      if (!adapter) {
        throw new Error(`No adapter registered for component "${component}"`);
      }
      const payload = target ? adapter.mappings?.[target] || null : adapter;
      if (target && !payload) {
        throw new Error(`Adapter for "${component}" has no mapping for target "${target}"`);
      }
      return json(JSON.stringify(payload, null, 2));
    }
  );

  server.registerTool(
    'translate_component',
    {
      title: 'Translate component to another design system',
      description:
        'Adapt a USWDS component tile to a target design system (material, bootstrap). Applies portableInvariants + classMapping/adapter, and reports gaps/limitations.',
      inputSchema: {
        file: z.string().describe('Tile file path, e.g. button/default.html'),
        target: z.string().describe('Target design system id (material, bootstrap)'),
      },
    },
    async ({ file, target }) => {
      const { html, meta } = readTile(file);
      const result = translateTile({ html, meta, target });
      return json(JSON.stringify(result, null, 2));
    }
  );

  server.registerTool(
    'get_recipe',
    {
      title: 'Get component recipe',
      description:
        'Surface 4: retrieve a named composition recipe — an ordered, nestable component set for a common UI pattern (contact-form, login-flow, data-table-with-sorting, error-handling-stack, navigation-hierarchy). Call without a name to list available recipes.',
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe('Recipe name; omit to list available recipes'),
      },
    },
    async ({ name } = {}) => {
      if (!name) return json(JSON.stringify(listRecipes(), null, 2));
      const recipe = readRecipe(name);
      return json(JSON.stringify(recipe, null, 2));
    }
  );

  server.registerTool(
    'query_compliance',
    {
      title: 'Query compliance readiness',
      description:
        'Filter components by compliance facts (FedRAMP level, PII handling, audit-trail capability, NIST controls) and return a readiness summary. Conservative: fedRampLevel is the reviewed floor, not a guarantee.',
      inputSchema: {
        fedRampMin: z.enum(['IL2', 'IL2+', 'IL4', 'IL5']).optional().describe('Minimum suitable FedRAMP impact level'),
        piiHandling: z.enum(['accepts_input', 'displays_only', 'none']).optional().describe('PII relationship'),
        auditTrail: z.boolean().optional().describe('Require auditTrailCompatible: true'),
        nistControl: z.string().optional().describe('Require this NIST SP 800-53 control id (e.g. AU-12)'),
        limit: z.number().int().optional().describe('Maximum components in the returned list'),
      },
    },
    async ({ fedRampMin, piiHandling, auditTrail, nistControl, limit } = {}) => {
      const index = readIndex();
      let results = index.components || [];
      const total = results.length;
      const LEVELS = ['IL2', 'IL2+', 'IL4', 'IL5'];
      if (fedRampMin) {
        const min = Math.max(LEVELS.indexOf(fedRampMin), 0);
        results = results.filter((c) => LEVELS.indexOf(c.fedRampLevel || 'IL2') >= min);
      }
      if (piiHandling) results = results.filter((c) => c.piiHandling === piiHandling);
      if (auditTrail) results = results.filter((c) => c.auditTrailCompatible === true);
      if (nistControl) results = results.filter((c) => (c.nistControls || []).includes(nistControl));

      const summary = {
        totalComponents: total,
        matching: results.length,
        filters: { ...(fedRampMin && { fedRampMin }), ...(piiHandling && { piiHandling }), ...(auditTrail && { auditTrail }), ...(nistControl && { nistControl }) },
        fedRampLevelCounts: {},
        piiHandlingCounts: {},
      };
      for (const c of index.components || []) {
        if (c.fedRampLevel) summary.fedRampLevelCounts[c.fedRampLevel] = (summary.fedRampLevelCounts[c.fedRampLevel] || 0) + 1;
        if (c.piiHandling) summary.piiHandlingCounts[c.piiHandling] = (summary.piiHandlingCounts[c.piiHandling] || 0) + 1;
      }
      const list = (limit && Number.isInteger(limit) ? results.slice(0, limit) : results).map((c) => ({
        file: c.file,
        title: c.title,
        fedRampLevel: c.fedRampLevel,
        piiHandling: c.piiHandling,
        auditTrailCompatible: c.auditTrailCompatible,
        nistControls: c.nistControls,
        touchTargetSize: c.touchTargetSize,
      }));
      return json(JSON.stringify({ summary, components: list }, null, 2));
    }
  );

  server.registerTool(
    'get_versions',
    {
      title: 'Get version history (groundwork)',
      description:
        'Surface 5 (planned): version history for the registry or a single component. Returns available:false for registries that do not publish versions.json yet.',
      inputSchema: {
        component: z.string().optional().describe('Component dir (e.g. button); omit for registry-level history'),
      },
    },
    async ({ component } = {}) => json(JSON.stringify(readVersions(component), null, 2))
  );

  return {
    registry: config.name,
    tools: [
      'search_components',
      'get_component',
      'list_facets',
      'get_index',
      'get_adapter',
      'translate_component',
      'get_recipe',
      'query_compliance',
      'get_versions',
    ],
  };
}
