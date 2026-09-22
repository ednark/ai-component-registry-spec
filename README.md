# AI Component Registry Spec

A reusable base layer for creating AI-retrievable component registries.

## What Is This?

This repo defines a **retrieval protocol** that lets AI coding agents discover, filter, and adapt UI components from a curated registry. It provides the shared infrastructure — protocol spec, generator script, and templates — that any domain-specific registry can inherit.

Think of it as a **base theme** in Drupal: you don't use it directly. You create a sub-registry that declares its own design system, facets, and components, but inherits the retrieval protocol and tooling from this base.

## Architecture

```
ai-component-registry-spec (this repo — the "base theme")
    ↑ submodule
    │
┌───┴──────────────────┐
│                      │
uswds-ai-components    forever-ai-components
(government UI)        (artistic/creative UI)
```

Each sub-registry:
1. Adds this repo as a git submodule at `_base/`
2. Creates a `registry.config.json` declaring its design system, facets, and metadata
3. Fills its `tileDir` with self-contained HTML component tiles
4. Runs `_base/generate-index.mjs` to build the discovery index and facets

## What's Included

| File | Purpose |
|------|---------|
| `protocol.md` | The retrieval protocol spec (5 surfaces: facets, index, tile, recipes, versions — plus flow, constraint handling, adaptation rules) |
| `tile-format.md` | HTML tile format with embedded `*-agent-meta` JSON block (supports schema v1 flat and v2 categorized metadata) |
| `generate-index.mjs` | Generic, config-driven index generator (normalizes v1 and v2 metadata to a lean, prose-free index) |
| `registry.config.schema.json` | JSON Schema for validating `registry.config.json` |
| `validate-registry.mjs` | Registry linter + cross-registry conformance checker |
| `compliance-scorer.mjs` | Compliance coverage report (FedRAMP/PII/audit/NIST) |
| `cost-modeler.mjs` | Cheapest-agent-path estimator from costTier metadata |
| `agents.template.json` | Template for the `agents.json` manifest |
| `llms.template.txt` | Template for `llms.txt` |
| `catalog.template.json` | Template for `catalog.json` |
| `mcp/` | Generic Model Context Protocol server — exposes any registry's components as MCP tools (stdio) |
| `examples/` | Example configs showing how different registries configure the base |

## Metadata Schema

Tiles support two metadata schema versions:

### Schema v1 (Legacy — flat structure)
All metadata fields at the top level. Still supported for backward compatibility.

### Schema v2 (Current — categorized structure)
Metadata is organized into four processing categories, informed by research on LLM-native markup languages (LLMON, IBM Research 2026) and constraint priority inversion (Constraint Tax, 2026):

| Category | Processing Mode | Fields |
|----------|----------------|--------|
| `discovery` | **Index only** — never sent to the model | `description`, `tier`, `tags`, domain facets |
| `selection` | **Read before adapting** — helps choose the right component | `useWhen`, `avoidWhen`, `guidance` (do/don't pairs) |
| `instruction` | **Follow** — direct guidance for adaptation | `agentPrompt`, `relatedComponents` |
| *(optional)* `{agentMetaId}-dense` | **Budget** — token-optimized compression of the full block | `use`, `avoid`, `do`, `dont`, `preserve`, `adapt` |
| `constraints` | **Enforce** — hard boundaries on adaptation | `preserve`, `editable`, `limitations` |

The generator normalizes both formats into a unified flat index structure for backward compatibility.

### Constraint Priority Order
When constraints conflict, follow this order (highest to lowest):
1. `constraints.preserve` — never modify these elements
2. `constraints.limitations` — respect known caveats
3. `instruction.agentPrompt` — adapt within the above boundaries
4. `constraints.editable` — prefer changes listed here

## How to Create a Sub-Registry

```bash
# 1. Create your project
mkdir my-ai-components && cd my-ai-components
git init

# 2. Add the spec as a submodule
git submodule add https://github.com/ednark/ai-component-registry-spec.git _base

# 3. Create your registry.config.json
cp _base/examples/uswds.config.json registry.config.json
# Edit it with your design system, facets, agentMetaId, metadataSchemaVersion, etc.

# 4. Create your component tiles
mkdir -p infinite/button
# Write infinite/button/default.html with embedded <script id="your-agent-meta"> JSON
# Use schema v2 categorized format for best results

# 5. Generate the index
node _base/generate-index.mjs

# 6. Create agents.json, llms.txt, catalog.json from templates
cp _base/agents.template.json agents.json
cp _base/llms.template.txt llms.txt
# Fill in {placeholders}
```

### Migrating from v1 to v2

Sub-registries can include a migration script like `tools/migrate-v2.mjs` to convert existing v1 tiles to v2 format. The generator handles both formats transparently.

## MCP Integration

Any sub-registry can be exposed to MCP-capable agents (Claude Desktop, opencode, etc.) via the
generic server in `mcp/`. It reads `registry.config.json` + `tileDir` from the current working
directory, so the same server serves USWDS, Drupal, or any future sub-registry.

Tools exposed: `search_components`, `get_component`, `list_facets`, `get_index`, `get_adapter`,
`translate_component`, `get_recipe`, `query_compliance`, `get_versions`. Transport is **stdio**
(no network). See `mcp/README.md` for run + connect instructions.

To enable for a sub-registry, add a minimal `package.json` installing `@modelcontextprotocol/sdk`
and a `mcp` script (`node _base/mcp/server.mjs`), then run `npm run mcp` from the registry root.

## Known Registries

Registries that implement this spec. Each is certified with
`node validate-registry.mjs --conformance <path>` — the identical 5-step agent
flow (manifest → facets → index → filter → tile) runs unchanged against all of
them.

| Registry | Domain | Tiles | Conformance |
|---|---|---|---|
| [uswds-ai-components](https://github.com/ednark/uswds-ai-components) | U.S. Web Design System (government) | 152 | pass |
| [govuk-ai-components](https://github.com/ednark/govuk-ai-components) | GOV.UK Design System (UK government) | 45 | pass |
| [dsfr-ai-components](https://github.com/ednark/dsfr-ai-components) | Système de Design de l'État (French government) | 42 | pass |
| [ecl-ai-components](https://github.com/ednark/ecl-ai-components) | Europa Component Library (European Commission / EU) | 36 | pass |
| [canada-ai-components](https://github.com/ednark/canada-ai-components) | Canada.ca Design System (Government of Canada, bilingual EN/FR) | 25 | pass |
| [forever-ai-components](https://github.com/isas1/forever-ai-components) | Creative/animated components (origin project) | 604 | pass |
| drupal-uswds-ai-components | Drupal integration guidance | 24 | pass |

The machine-readable directory is [`registries.json`](registries.json) — the seed
of the federated directory: the spec lists implementations that pass
conformance; registries reference the spec via `_base`. One-directional edges
by design.

## Credits

The retrieval protocol was originated by [forever-ai-components](https://github.com/isas1/forever-ai-components). This repo extracts and generalizes that protocol so other design systems can adopt it.

The metadata schema v2 design is informed by:
- **LLMON** (IBM Research, 2026) — LLM-native markup language showing 74.2% accuracy improvement from explicit instruction/data separation
- **Strategies for Guiding LLMs to Use Software Design Patterns** (PROMISE 2026) — iterative binary feedback for constraint adherence
- **Constraint Tax in Open-Weight LLMs** (2026) — constraint priority inversion and mitigation strategies

## License

MIT
