# AI Component Registry Protocol

## Overview

A component registry is a **retrieval layer** that an AI coding agent queries over HTTP to discover, filter, and adapt UI components. The registry is not a library you install — it's a database you query. The agent fetches only what it needs, adapts it to the project's style, and writes the result into the user's codebase.

## The Three-Surface Architecture

The registry exposes three increasingly heavy surfaces, designed so an agent never loads more than it needs:

```
facets.json          (tiny — a few KB)
  ↓
components.index.json (lean — one record per component, no prose)
  ↓
<component>.html       (heavy — full source + embedded adaptation metadata)
```

### Surface 1: `facets.json` — the filter vocabulary (optional)

A few KB listing every filterable facet with its values and counts. An agent fetches this first to learn the schema before pulling the index.

```
GET {base}/infinite/facets.json
```

### Surface 2: `components.index.json` — the discovery index

A flat JSON array of all components with **discovery facets only** — title, description, file path, and filterable attributes. Critically, the heavy adaptation prose (`useWhen`, `avoidWhen`, `agentPrompt`, etc.) is **NOT** here. The index stays small so an agent can load it once and filter in code.

```
GET {base}/infinite/components.index.json
```

**Rule:** Do not paste the whole index into a model context. Filter it in code first.

### Surface 3: `<component>.html` — the component tile

Fetched only for components the agent has already selected. One fetch returns:
- The complete, copy-pasteable source (HTML + inline CSS/JS, zero dependencies)
- An embedded `<script type="application/json" id="{agentMetaId}">` JSON block with adaptation guidance

The adaptation metadata travels *inside* the tile so it's never wasted in the index.

```
GET {base}/infinite/{file}
```

## The Retrieval Flow

```
1. GET agents.json          → learn the manifest (count, URLs, facet schema)
2. GET facets.json          → learn what you can filter on (optional)
3. GET components.index.json → load the full component list
4. Filter in CODE           → narrow by facets to a shortlist
5. GET infinite/{file}      → fetch only the chosen tiles
6. Read embedded agent-meta → parse adaptation guidance
```

## Agent Entry Points

Two machine-readable entry points allow agents to discover the registry:

- **`agents.json`** — compact manifest: registry name, component count, index URL, fetch URL pattern, facet schema, retrieval flow. The "front door" for agents.
- **`llms.txt`** — plain-text protocol following the `llms.txt` convention. Describes the three surfaces in natural language.

## Composition Strategy

Retrieve coordinated sets, not single components. When the task is a page or layout, retrieve a set of components that work together. Choose the smallest set that solves the task. Avoid retrieving components that will not be used.

## Adaptation Rules

When adapting a retrieved component:

- Inherit the project's colour palette: replace hardcoded hex values
- Inherit the project's spacing scale: replace hardcoded px values where practical
- Inherit the project's typography: replace font families
- Preserve `prefers-reduced-motion` handling: do not remove it
- Preserve `document.hidden` pause logic: do not remove it
- Preserve CSS/JS namespace prefixes: do not globalise component styles
- Preserve semantic HTML structure
- Minimise additional dependencies introduced during adaptation
- Read the embedded `*-agent-meta` block for component-specific guidance

## Output Contract

When returning components to a user, include:

1. **Reason** — why this component was selected over alternatives
2. **Selected components** — file paths and titles
3. **Adaptations made** — what was changed from the source and why
4. **Remaining work** — what the component does not yet cover
5. **Recommended next** — what to retrieve or build next to complete the interface

## Quality Gates

Each registry may define its own quality gates. Common patterns:

- Don't retrieve `tier: needs-review` components unless no alternative exists
- Don't use heavy/expensive components for mobile-primary contexts
- Don't use pointer-only interactions for touch-only contexts without a fallback
- Check `requiresJs` if the project prefers CSS-only solutions
- Check `govCompliance` if the project has legal accessibility requirements

## Decision Strategy

When solving a UI task, follow this order:

1. Understand the requested outcome
2. Infer the component type needed
3. Search the index, filtering by relevant facets
4. Prefer existing components over generating new UI from scratch
5. Prefer simpler/cheaper components unless the task requires more
6. Prefer accessible and mobile-ready components by default
7. Only generate new UI if no suitable component exists in the registry
