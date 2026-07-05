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
| `protocol.md` | The retrieval protocol spec (3-surface architecture, flow, adaptation rules) |
| `tile-format.md` | HTML tile format with embedded `*-agent-meta` JSON block |
| `generate-index.mjs` | Generic, config-driven index generator |
| `registry.config.schema.json` | JSON Schema for validating `registry.config.json` |
| `agents.template.json` | Template for the `agents.json` manifest |
| `llms.template.txt` | Template for `llms.txt` |
| `catalog.template.json` | Template for `catalog.json` |
| `examples/` | Example configs showing how different registries configure the base |

## How to Create a Sub-Registry

```bash
# 1. Create your project
mkdir my-ai-components && cd my-ai-components
git init

# 2. Add the spec as a submodule
git submodule add https://github.com/ednark/ai-component-registry-spec.git _base

# 3. Create your registry.config.json
cp _base/examples/uswds.config.json registry.config.json
# Edit it with your design system, facets, agentMetaId, etc.

# 4. Create your component tiles
mkdir -p infinite/button
# Write infinite/button/default.html with embedded <script id="your-agent-meta"> JSON

# 5. Generate the index
node _base/generate-index.mjs

# 6. Create agents.json, llms.txt, catalog.json from templates
cp _base/agents.template.json agents.json
cp _base/llms.template.txt llms.txt
# Fill in {placeholders}
```

## Credits

The retrieval protocol was originated by [forever-ai-components](https://github.com/isas1/forever-ai-components). This repo extracts and generalizes that protocol so other design systems can adopt it.

## License

MIT
