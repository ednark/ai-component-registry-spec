# MCP Server for AI Component Registries

A generic [Model Context Protocol](https://modelcontextprotocol.io) server that exposes any
component registry's components as MCP tools. It reads `registry.config.json` and the `tileDir`
from the **current working directory**, so the same server works for every sub-registry that
includes the base spec as a submodule (USWDS, Drupal, etc.).

Transport: **stdio** (no network). Implementation: official `@modelcontextprotocol/sdk`.

## What it exposes

| Tool | Purpose |
|------|---------|
| `search_components` | Filter the index by facet values / free text → shortlist |
| `get_component` | Fetch one tile (full HTML + v2-categorized meta) |
| `list_facets` | Return the facet vocabulary |
| `get_index` | Return the full / section-filtered discovery index |
| `get_adapter` | Return cross-system adapter mapping for a component |
| `translate_component` | Adapt a tile to a target design system (material, bootstrap) |

These map directly to the registry's [retrieval flow](../protocol.md) and
[cross-design-system transfer](../protocol.md#cross-design-system-transfer).

## Running for a sub-registry

The server reads from `cwd`, so run it from inside the registry repo:

```bash
cd uswds-ai-components
npm install                # installs @modelcontextprotocol/sdk (see package.json)
npm run mcp                # node _base/mcp/server.mjs
```

Or directly:

```bash
cd uswds-ai-components
node /path/to/_base/mcp/server.mjs
```

To serve the Drupal registry instead, `cd drupal-uswds-ai-components && npm run mcp`.

## Connecting an agent

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "uswds-components": {
      "command": "node",
      "args": ["/absolute/path/to/uswds-ai-components/_base/mcp/server.mjs"],
      "cwd": "/absolute/path/to/uswds-ai-components"
    }
  }
}
```

**opencode** — register the server in your `opencode.json` `mcp` block with the same
`command` + `args` + `cwd`.

## Testing

Drive the server with the official inspector:

```bash
npx @modelcontextprotocol/inspector node _base/mcp/server.mjs
```

Then call e.g. `search_components({ section: "utilities" })` or
`translate_component({ file: "button/default.html", target: "bootstrap" })`.

## Notes

- The server makes **no network calls** — it reads local files only.
- `translate_component` enforces `constraints.portableInvariants` (returned for the calling
  agent to honor) and reports unmapped classes / limitations as `gaps`.
- Adapter registries are optional; if a component has no adapter and no `classMapping`, the
  tool returns `portableInvariants` only and a `gaps` note.
