#!/usr/bin/env node
/**
 * AI Component Registry — MCP Server (stdio)
 *
 * A generic Model Context Protocol server that exposes any registry's
 * components as tools. It reads `registry.config.json` and the `tileDir`
 * from the current working directory, so the same server works for any
 * sub-registry (USWDS, Drupal, etc.) that includes the base spec.
 *
 * Usage:
 *   node _base/mcp/server.mjs          # serves the registry in cwd
 *   cd uswds-ai-components && npm run mcp
 *
 * Transport: stdio (no network). Requires @modelcontextprotocol/sdk.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './lib/tools.js';
import { loadConfig } from './lib/registry.js';

const config = loadConfig();
const server = new McpServer({
  name: `${config.name}-mcp`,
  version: config.updated || '1.0.0',
});

const info = registerTools(server);
console.error(
  `[mcp] Serving registry "${info.registry}" with tools: ${info.tools.join(', ')}`
);

const transport = new StdioServerTransport();
await server.connect(transport);
