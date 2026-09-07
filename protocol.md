# AI Component Registry Protocol

## Overview

A component registry is a **retrieval layer** that an AI coding agent queries over HTTP to discover, filter, and adapt UI components. The registry is not a library you install — it's a database you query. The agent fetches only what it needs, adapts it to the project's style, and writes the result into the user's codebase.

## The Multi-Surface Architecture

The registry exposes increasingly heavy surfaces, designed so an agent never loads more than it needs:

```
facets.json          (tiny — a few KB)
  ↓
components.index.json (lean — one record per component, no prose)
  ↓
<component>.html       (heavy — full source + embedded adaptation metadata)

recipes/{name}.json   (on demand — one atomic pattern fetch)
versions.json         (on demand — what changed and how to migrate)
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

### Surface 4: `recipes/{name}.json` — component recipes (optional)

Agents often build UI patterns that combine multiple components. A **recipe**
encodes one pattern as a single atomic fetch: which components to retrieve, in
what order, how to nest them, and how to validate the result. This is the spec
term for what the forever-ai-components ROADMAP calls *collections* — one
concept, one name across registries.

```
GET {base}/infinite/recipes/index.json       → recipe manifest (names + descriptions)
GET {base}/infinite/recipes/{recipe}.json    → one recipe
```

A recipe is a static JSON file alongside the tiles:

```json
{
  "recipe": "contact-form",
  "title": "Contact Form",
  "description": "Accessible contact form with validation",
  "components": [
    { "order": 1, "component": "form", "variant": "default", "file": "form/default.html", "role": "root-container" },
    { "order": 2, "component": "text-input", "variant": "default", "file": "text-input/default.html", "label": "Full name", "required": true },
    { "order": 3, "component": "button", "variant": "default", "file": "button/default.html", "label": "Submit" }
  ],
  "nesting": "Components 2+ are children of the order-1 root; buttons come last",
  "validationOrder": ["required fields present", "email format valid"],
  "a11yNotes": ["Link error messages to inputs with aria-describedby"]
}
```

Recipe rules:

- Every `components[].file` must reference a real tile in the same registry
- `order` is the fetch/assembly order; `role` explains why the component is in the set
- Components listed in a recipe must declare the recipe in their tile's
  `coordination.compositionRecipes` so facet filtering finds recipe members
- Recipes are discovery surfaces: keep them lean (no component source inline)

### Surface 5: `versions.json` — version history (optional)

Design systems and registries change. Version history lets an agent answer
"did anything I rely on change?" without diffing repositories.

```
GET {base}/infinite/versions.json                    → registry-level history
GET {base}/infinite/{component}/versions.json        → component-level (optional)
```

```json
{
  "schemaVersion": 1,
  "registry": "uswds-ai-components",
  "designSystem": { "name": "U.S. Web Design System", "version": "3.13.0" },
  "versions": [
    {
      "version": "2.1.0",
      "releaseDate": "2026-09-06",
      "componentCount": 146,
      "breakingChanges": [],
      "addedCategories": ["coordination"],
      "addedFacets": ["costTier", "prerequisites", "compositionRecipes", "fedRampLevel", "piiHandling", "touchTargetSize"],
      "metadataChanges": ["discovery.compliance", "discovery.mobileUX", "supportedTokenProfiles"],
      "migrationPath": "Fully additive — no tile changes required. Re-fetch facets.json for the new facet vocabulary.",
      "notes": "Surface 4 recipes, MCP get_recipe/query_compliance/get_versions"
    }
  ]
}
```

Version-history rules:

- `breakingChanges` must list anything that invalidates previously fetched
  tiles or index filters (removed facets, renamed fields, changed `file` paths)
- Every entry needs a `migrationPath` — even if it is "none required"
- Component-level files follow the same shape scoped to one component's variants
- Registries without meaningful versioning may omit this surface; MCP
  `get_versions` returns `available: false` (the probe never fails)

## The Retrieval Flow

```
1. GET agents.json          → learn the manifest (count, URLs, facet schema)
2. GET facets.json          → learn what you can filter on (optional)
3. GET components.index.json → load the full component list
4. Filter in CODE           → narrow by facets to a shortlist
5. GET infinite/{file}      → fetch only the chosen tiles
6. Parse metadata           → read the embedded agent-meta block
7. Check _schemaVersion     → v2: read categorized fields; v1: read flat fields
8. Validate selection       → confirm useWhen/avoidWhen match the task
9. Adapt with constraints   → follow instruction, enforce constraints
10. Verify output           → check all constraints.preserve elements are intact
```

## Agent Entry Points

Three machine-readable entry points allow agents to discover the registry:

- **`agents.json`** — compact manifest: registry name, component count, index URL, fetch URL pattern, facet schema, retrieval flow. The "front door" for agents.
- **`llms.txt`** — plain-text protocol following the `llms.txt` convention. Describes the three surfaces in natural language.
- **MCP server** (`_base/mcp/server.mjs`) — a Model Context Protocol server that exposes the registry as tools (`search_components`, `get_component`, `list_facets`, `get_index`, `get_adapter`, `translate_component`). Enables direct integration with MCP-capable agents (Claude Desktop, opencode, etc.) over stdio. See `mcp/README.md`.

When an MCP client is connected, agents should prefer the MCP tools over raw HTTP fetches — the tools encapsulate the retrieval flow and cross-design-system transfer below.

## Composition Strategy

Retrieve coordinated sets, not single components. When the task is a page or layout, retrieve a set of components that work together. Choose the smallest set that solves the task. Avoid retrieving components that will not be used.

When the task matches a published recipe (Surface 4), fetch the recipe first — it replaces N component lookups plus assembly guesswork with one atomic fetch. Check `coordination.compositionRecipes` in the index (or the recipe manifest) before composing manually. If composing without a recipe, respect each tile's `coordination.prerequisiteComponents` and `coordination.incompatibleWith`.

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

## Constraint Handling

The embedded metadata uses a categorized structure (schema v2) that separates metadata into three processing categories. This separation is informed by research on LLM-native markup languages showing that explicit instruction/data separation improves accuracy by 74.2% (LLMON, IBM Research 2026) and prevents constraint priority inversion (Constraint Tax, 2026).

### Processing Categories

| Category | Fields | How to Process |
|----------|--------|----------------|
| `discovery` | `description`, `tier`, `tags`, domain facets | **Filter in code** — do not send to model |
| `selection` | `useWhen`, `avoidWhen` | **Read before adapting** — confirms component choice |
| `instruction` | `agentPrompt`, `relatedComponents` | **Follow** — direct guidance for what to do |
| `coordination` | `prerequisiteComponents`, `incompatibleWith`, `compositionCost`, `agentPromptSequence` | **Plan before composing** — check before combining components |
| `constraints` | `preserve`, `editable`, `limitations` | **Enforce** — hard boundaries on changes |
| `portability` | `classMapping` | **Translate** — cross-design-system class substitution |

### Constraint Priority Order

When constraints conflict, resolve in this order (highest priority first):

1. **`constraints.preserve`** — never modify these elements. This protects accessibility (ARIA attributes), semantic HTML structure, and design system integrity.
2. **`constraints.limitations`** — respect known caveats. These document real-world constraints the component cannot overcome.
3. **`instruction.agentPrompt`** — adapt within the boundaries set above. This is the creative guidance.
4. **`constraints.editable`** — prefer changes listed here. These are known-safe modification points.

### Constraint Priority Inversion Prevention

Research shows that when multiple constraints are active simultaneously, less important constraints can silently override more important ones (Constraint Tax, 2026). To prevent this:

- **Never** remove or modify elements listed in `constraints.preserve` to satisfy `instruction.agentPrompt`
- **Never** ignore `constraints.limitations` to enable an adaptation suggested by `instruction.agentPrompt`
- If `instruction.agentPrompt` conflicts with `constraints.preserve`, follow `constraints.preserve` and note the conflict in your output
- If `constraints.editable` doesn't cover a needed change, check `constraints.preserve` first — if the element is not listed there, the change may be safe but should be noted

### Validation Contract

After adapting a component, verify:

1. Every element in `constraints.preserve` is present and unmodified in the output
2. No element in `constraints.limitations` has been violated
3. Changes align with `instruction.agentPrompt` within the constraint boundaries
4. All changes are within `constraints.editable` or explicitly safe

If validation fails, revert the violating change and try an alternative approach.

## Agent-facing docs

Every registry ships two hand-authored agent entry points, kept prose-first
and hand-maintained — never generated from tooling. The registries'
Decision Strategy and Quality Gates sections above are the shared skeleton;
each registry folds its mandates (bilingual parity, error model, identity
assets) into them.

### llms.txt — the lean agent protocol

Recommended section order:

1. **Quick start** — the surface URLs (agents.json, facets.json, index, tile
   pattern, recipes, versions)
2. **Facets** — the filter vocabulary
3. **Decision strategy** — the registry's ladder from the Decision Strategy
   section, ending with "only generate new UI if no suitable component exists"
4. **Quality gates and declared gaps** — do-not-retrieve rules mapped to
   facets (costTier, requiresJs, knownLimitations), plus pointers to the
   registry's declared `gaps` (registry.config.json) and core-classes.json
   (the untiled layout/typography layer)
5. **Component schema** — what an index record and a tile meta block contain
6. **Patterns** — task-to-component-set guidance or a pointer to recipes
7. **Output contract** — the registry's contract from the Output Contract
   section

### agents.json — the compact machine manifest

Keep it ~2KB: registry identity, URLs (index/facets/tiles/recipes/versions/
compatibility), count, facets, retrieval flow, agentMetaId/tileDir, MCP
flags, schema versions. Prose detail (adaptation guidance, constraint
priority, category explanations, token-profile tables) belongs in llms.txt
and AGENTS.md, not the manifest.

### AGENTS.md — the working rules

Retrieval workflow, registry-specific mandates (bilingual parity, error
model, identity-asset rules), quality gates, constraint priority, MCP and
CLI usage.

## Output Contract

When returning components to a user, include:

1. **Reason** — why this component was selected over alternatives
2. **Selected components** — file paths and titles
3. **Constraint verification** — confirm all `constraints.preserve` elements are intact
4. **Adaptations made** — what was changed from the source and why
5. **Remaining work** — what the component does not yet cover
6. **Recommended next** — what to retrieve or build next to complete the interface

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
7. Read `selection.useWhen` and `selection.avoidWhen` to confirm fit
8. Read `constraints.preserve` before making any changes
9. Follow `instruction.agentPrompt` within constraint boundaries
10. Verify all `constraints.preserve` elements are intact in output
11. Only generate new UI if no suitable component exists in the registry

## Cross-Design System Transfer

The registry protocol supports adapting components from one design system to another (e.g., USWDS to Material or Bootstrap). This is informed by research on framework-agnostic intermediate representations (Widget2Code, CVPR 2026; Scenethesis, ICSE 2026) and intent-driven cross-library migration (IntentTester, 2026).

### How It Works

The v2 metadata schema separates **portable invariants** (semantic HTML, ARIA, behavior attributes) from **design-system-specific preserves** (CSS classes, design tokens). This separation enables an agent to:

1. Keep portable invariants intact across any design system
2. Replace design-system-specific classes using `portability.classMapping`
3. Validate the result against the original tile's rendered output (oracle-driven validation)

### Transfer Flow

```
1. Fetch source tile from this registry
2. Parse metadata — identify portableInvariants vs preserve
3. Look up classMapping for target design system
4. Replace: preserve classes → classMapping equivalents
5. Keep: portableInvariants unchanged
6. Validate: rendered output matches source behavior
```

### Adapter Registries

For complex cross-system mappings that go beyond class substitution, adapter registries provide component-level semantic mappings:

```
GET {adapterBase}/adapters.json     → mapping manifest
GET {adapterBase}/adapters/{component}.json → detailed component mapping
```

Adapter registries are separate from component registries. They contain no tiles — only mapping definitions. See `adapter-format.md` for the specification.

### Portable vs. System-Specific

| Aspect | Portable (survives transfer) | System-Specific (replaced) |
|--------|------------------------------|---------------------------|
| Semantic HTML | `<button>`, `<nav>`, `<main>` | — |
| ARIA attributes | `aria-label`, `role`, `aria-expanded` | — |
| Behavior attributes | `type`, `disabled`, `href` | — |
| CSS classes | — | `usa-button`, `mdc-button`, `btn` |
| Design tokens | — | `$theme-button-border-radius` |
| JS behavior | — | USWDS-specific initialization |

### Validation Contract for Transfer

After cross-system adaptation, verify:

1. Every `constraints.portableInvariants` element is present and unmodified
2. CSS classes match `portability.classMapping` for the target system
3. Visual rendering is functionally equivalent to the source tile
4. Accessibility attributes are preserved
5. JavaScript behavior (if any) works with the target system's runtime

If the target design system is not in `classMapping`, fall back to `portableInvariants` only — do not guess class mappings.
