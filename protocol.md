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
patterns/{name}.json  (on demand — one task-to-component-set guidance fetch)
versions.json         (on demand — what changed and how to migrate)
observations.json     (on demand — field observations of the design system's ecosystem)
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
- The complete, copy-pasteable source (HTML + inline CSS/JS, zero dependencies) [design-decision]
- An embedded `<script type="application/json" id="{agentMetaId}">` JSON block with adaptation guidance [design-decision]

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

- Every `components[].file` must reference a real tile in the same registry [design-decision]
- `order` is the fetch/assembly order; `role` explains why the component is in the set [design-decision]
- Components listed in a recipe must declare the recipe in their tile's [design-decision]
  `coordination.compositionRecipes` so facet filtering finds recipe members
- Recipes are discovery surfaces: keep them lean (no component source inline) [design-decision]

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

- `breakingChanges` must list anything that invalidates previously fetched [design-decision]
  tiles or index filters (removed facets, renamed fields, changed `file` paths)
- Every entry needs a `migrationPath` — even if it is "none required" [design-decision]
- Component-level files follow the same shape scoped to one component's variants [design-decision]
- Registries without meaningful versioning may omit this surface; MCP [design-decision]
  `get_versions` returns `available: false` (the probe never fails)

### Surface 6: `patterns/{name}.json` — pattern guidance (optional)

Recipes (Surface 4) answer "which components combine." **Patterns** answer
"which components and doctrine apply to this task" — task-to-component-set
guidance, the slot the `agents.json` "Patterns" entry already reserves.

Patterns are retrieval direction for a page designer, **not page design**.
The registry's obligation ends at pointing: page structure, sequence, and
quality judgment remain the implementor's job — the same boundary the
behavior contract draws for tiles.

**The lane rule (normative):** every substantive claim in a pattern file is a
citation. `doctrine` entries cite design-system documentation;
`knownFailureModes` cite field-test runs; `mandatedElements` cite the legal
or policy source. A pattern file never authors cadence, page structure, or
quality checklists — if a design system documents a sequence for a pattern,
it arrives as a quoted, sourced doctrine note. The validator rejects
uncited claims.

```
GET {base}/infinite/patterns/index.json      → pattern manifest (names + descriptions)
GET {base}/infinite/patterns/{pattern}.json  → one pattern
```

A pattern is a static JSON file alongside the tiles:

```json
{
  "pattern": "time-sensitive-action",
  "description": "Task guidance for acting before a user-facing deadline",
  "useWhen": ["the user must act before a deadline", "an expiry or cutoff drives the task"],
  "avoidWhen": ["the deadline is not user-facing"],
  "components": ["alert", "button", "summary-list"],
  "recipes": ["trial-expiry-banner"],
  "doctrine": [
    { "source": "USWDS time-sensitive-warning guidance", "url": "https://designsystem.digital.gov/patterns/", "note": "state dates in absolute terms" }
  ],
  "knownFailureModes": [
    { "run": "T5 degradation run t5-001 (2026-09-17)", "lesson": "L11", "note": "relative-only countdown drifted in across turns 0–2" }
  ],
  "mandatedElements": [
    { "name": "date-modified", "jurisdictions": ["canada"], "source": "Standard on Web Accessibility", "note": "legally required page element with no component equivalent" }
  ]
}
```

Pattern rules:

- **Task-to-component-set only.** `components` names tile families and [design-decision]
  `recipes` names Surface 4 recipes; both must reference real entries in the
  same registry. No ordering, nesting, or placement instruction belongs in a
  pattern file — that is a recipe's job or the implementor's.
- **Citations required.** Every `doctrine[]` and `mandatedElements[]` entry [evidence: uswds:F-004]
  carries a `source`; every `knownFailureModes[]` entry carries a `run`
  (field-test evidence — measured failures, not design opinion).
- Components listed in a pattern must declare the pattern in their tile's [design-decision]
  `discovery.patterns` so facet filtering finds pattern members (mirror of
  the recipe rule).
- `useWhen`/`avoidWhen` govern *task* match (pattern-level selection), the [design-decision]
  same distinction `selection.useWhen`/`avoidWhen` makes for component choice.
- Patterns are discovery surfaces: keep them lean (no component source inline). [design-decision]
- **Config-gated:** a registry publishes this surface only by declaring [design-decision]
  `patternGuidance: true` in `registry.config.json`. `generate-index.mjs`
  emits `patterns/index.json` and normalizes `discovery.patterns` into index
  records; `validate-registry.mjs` enforces the rules above only for
  registries that declare it. A registry that does not declare it sees zero
  new surfaces.
- MCP servers MAY expose `get_pattern`; it is optional and not required for [design-decision]
  conformance.

### Surface 7: `observations.json` — field observations (optional)

Live sites extend design systems inside their namespaces (hhs.gov ships
`usa-alert--no-collapse`; usda.gov extends the nav). These extensions are
knowledge about the design system's **ecosystem** — never tiles in the canon
registry (classCheck blocks non-canon classes by construction). This surface
records them so agents and maintainers can retrieve that context instead of
rediscovering it.

```
GET {base}/infinite/observations.json
```

```json
{
  "schemaVersion": 1,
  "observations": [
    {
      "observed": "2026-09-29",
      "site": "hhs.gov",
      "url": "https://www.hhs.gov",
      "family": "alert",
      "kind": "extension",
      "extension": "usa-alert--no-collapse",
      "note": "alert rendered without the leading icon",
      "source": "surveys/2026-09-agency-survey"
    }
  ]
}
```

Observation rules:

- **Citations required**: every entry carries `observed` (date), `site`, [evidence: uswds:F-004]
  `url`, and `source` — the registry may only point, never assert
- **Never tiles**: an observation is a record about the ecosystem; the [evidence: uswds:F-004]
  referenced classes are site-local and must not enter canon tiles
- `kind`: `extension` (a new class in the design system's namespace) | [design-decision]
  `composition` (a multi-component arrangement) | `other`
- `family` names the canon family the observation relates to (a tiled family [design-decision]
  or a core class); unknown families are a validator warning
- **Convergence tool**: `_base/detect-convergence.mjs` reports extensions [evidence: uswds:F-004, ecl:F-003]
  observed across multiple independent sites. Convergence is a **sensor
  reading, not a promotion path**: extensions enter the canon registry only
  when the mainline design system ships them — at which point they arrive
  through the normal purity path with their own provenance.

## Design-System Version Sync

The registry is a **faithful snapshot of a pinned design-system version** —
`registry.config.json` `designSystem.version` is the single source of truth.
Version sync is event-driven, not continuous: between design-system releases
the registry carries zero version burden, and an upgrade is an audited event
with mechanical drift detection.

### The pin

- `designSystem.version` — the exact pinned release (no ranges) [evidence: uswds:F-001]
- `designSystem.package` — the npm package carrying that release (e.g.
  `@uswds/uswds`), whose devDependency must match the pin exactly. [evidence: uswds:F-001]
- Cross-checked everywhere the version appears: `package.json`, [evidence: uswds:F-001]
  `versions.json`, `agents.json` — disagreement is a conformance error

### Verification strategy (how a registry proves its tiles)

A pin is only meaningful if something checks tiles against it. A registry
declares its own ground truth in `designSystem.verification`, because no two
design systems verify the same way:

```json
"designSystem": {
  "version": "6.5.1",
  "package": "govuk-frontend",
  "verification": {
    "markup": "package-templates",
    "styling": "package-css",
    "packagePath": "node_modules/govuk-frontend/dist/govuk",
    "groundTruth": "installed package (exact devDependency)"
  }
}
```

| Field | Values | Meaning |
|-------|--------|---------|
| `markup` | `package-templates` \| `package-css` \| `live-html` \| `none` | what proves a class/structure is canon |
| `styling` | `package-css` \| `live-css` \| `none` | what proves a class is styled |
| `packagePath` | path | where the stylesheet/templates live in the registry |
| `groundTruth` | `installed-package` \| `live-site` \| `documentation` | the source of record |

**Two-axis verification** (`markup` + `styling` both set) is required when a
design system ships templates: a class can be **canonical markup with no CSS
rules**. GOV.UK's `govuk-table__head` is in the v6 templates but carries no
styles (v4+ styles `__header`/`__cell`); a styling-only check misreads it as
drift and will "correct" a correct tile. Verify markup before styling. [evidence: govuk:F-001, uswds:F-008]

Prefer `installed-package` over `live-site`: a versioned package is immutable
and CI-installable, while a live stylesheet changes under you. A registry that
has no package (e.g. a registry mirroring a live site rather than a published
library) declares `live-css` and accepts that its verification is a snapshot,
not a mechanism.

### The app layer

A design system may have a **presentation/app layer outside its package** —
GOV.UK publishes `govuk-frontend` and separately `govuk-publishing-frontend`
(the `layout-*`, `gem-*`, `app-*` classes that render www.gov.uk). The class
prefix alone does not tell you which layer a class belongs to.

Registries whose design system has an app layer SHOULD record app-layer tiles
with `discovery.origin: "live-site"` and a `limitations` note naming the
publishing layer, so an agent can tell canon from presentation. A class that is
absent from the package is never a package variant, whatever prefix it carries.

### The drift register

`staticView.classCheck.allowlist` is where drift becomes *tracked* state rather
than invisible state. Every entry carries a `reason`, and reasons SHOULD fall
into the three categories the deep check distinguishes (see `deep-check.md`):

- **canonical-but-unstyled** — in the templates, no CSS rules by design [evidence: govuk:F-001, uswds:F-008]
- **app layer** — publishing/presentation layer, not a package component [evidence: govuk:F-003]
- **pre-migration drift** — predates the pinned version; rework pending [evidence: uswds:F-001, dsfr:F-001, ecl:F-001]

A registry that grows an allowlist is telling the truth about its drift; a
registry that silently passes is not necessarily correct.

### Per-tile verification stamps

`provenance.designSystemVersion` records the pinned version each tile body was
last verified against. Set at capture; `generate-index.mjs` re-stamps a tile
automatically when its body is re-baselined (a cited correction is a
re-verification). Stale or missing stamps are an aggregated **worklist
warning** — never an error — so a half-finished upgrade stays commitable.

### The upgrade runbook

1. **Bump the pin** (`designSystem.version` + `designSystem.package` in [evidence: uswds:F-001]
   `package.json`) — the validator now reports every disagreement
2. **Class drift**: `staticView.classCheck` enumerates tile classes the new [design-decision]
   release renamed or removed (error-level, mechanical)
3. **Stamp drift**: the validator lists tiles not yet verified against the [design-decision]
   new pin
4. **Cited corrections**: for each affected tile, apply the new template's [design-decision]
   markup through the purity path (provenance cites the new template; the
   generator re-baselines and re-stamps)
5. **Behavior check**: behavior contracts + conformance tests cover what [design-decision]
   class checks cannot
6. **Resolved views + index**: regenerate [design-decision]
7. **Record the event**: `versions.json` entry (version, [design-decision]
   `designSystemVersion`, `breakingChanges`, `migrationPath`), update
   `agents.json`, refresh the federated `registries.json` entry, and fold the
   registry's specifics into its AGENTS.md

### Non-goals

- **No multi-version tile sets** — one registry tracks one pinned version [design-decision]
- **No version-range metadata** — tiles state what they were verified [design-decision]
  against, not what they might survive
- **No auto-sync** — upgrades are deliberate, cited events; the design [design-decision]
  system's own changelog arrives mechanically through the drift detectors

### Trust surface: `registry-health.json`

Every registry publishes `registry-health.json` at its root (generated by
`_base/generate-health.mjs`, advertised in `agents.json` as `healthUrl`). It is
the machine-readable answer to *how much should I trust this registry before I
fetch anything from it?*

```json
{
  "registry": "ecl-ai-components",
  "designSystem": { "pin": "5.3.1", "package": "@ecl/preset-eu",
                    "groundTruth": "installed-package" },
  "classCheck": { "enabled": true, "prefixes": 1, "allowlistSize": 21,
                  "categories": { "drift": 19, "canonicalUnstyled": 2, ... } },
  "stamps": { "verified": 34, "total": 36, "percent": 94 },
  "findings": { "count": 4, "lastDeepCheck": "2026-09-30",
                "byResult": { "broke": 2, "fixed": 1, "recorded": 1 } },
  "conformance": "pass"
}
```

- **The point is calibration, not a green dashboard.** A registry that [design-decision]
  publishes its drift register, its unstamped tiles and its last check date is
  telling you where *not* to trust it. Silence is the bad signal.
- `stamps.percent` is the operative number: it is the share of tiles verified [design-decision]
  against the pinned design system, so a low value is a stated limitation
  rather than a hidden one.
- `classCheck.categories` says how much of the register is *expected* drift [design-decision]
  (canonical-but-unstyled, app layer) versus unexpected (drift, site layer).
- `conformance` is the shipped validator's own verdict, re-derived at [design-decision]
  generation time — a registry cannot claim conformance it no longer passes.
- A registry with no `findings` block has no ledger; `lastDeepCheck: null` [design-decision]
  means no check has ever been recorded, which is a different state from
  "checked and clean".

### The findings ledger (`findings.json`)

`{tileDir}/findings.json` is the registry's epistemic record — what was
tested, what broke, and what changed (`findings-ledger.md` has the schema).
Spec rules cite it: `[evidence: ecl:F-002]` for a rule that a test produced,
`[design-decision]` for taste. `lastDeepCheck` in the health file comes from
the newest `deep-check` entry.

## The Retrieval Flow

```
1. GET agents.json          → learn the manifest (count, URLs, facet schema) [design-decision]
2. GET facets.json          → learn what you can filter on (optional) [design-decision]
3. GET components.index.json → load the full component list [design-decision]
4. Filter in CODE           → narrow by facets to a shortlist [design-decision]
5. GET infinite/{file}      → fetch only the chosen tiles [design-decision]
6. Parse metadata           → read the embedded agent-meta block [design-decision]
7. Check _schemaVersion     → v2: read categorized fields; v1: read flat fields [design-decision]
8. Validate selection       → confirm useWhen/avoidWhen match the task [design-decision]
9. Adapt with constraints   → follow instruction, enforce constraints [design-decision]
10. Verify output           → check all constraints.preserve elements are intact [design-decision]
```

## Agent Entry Points

Three machine-readable entry points allow agents to discover the registry:

- **`agents.json`** — compact manifest: registry name, component count, index URL, fetch URL pattern, facet schema, retrieval flow. The "front door" for agents. [design-decision]
- **`llms.txt`** — plain-text protocol following the `llms.txt` convention. Describes the three surfaces in natural language. [design-decision]
- **MCP server** (`_base/mcp/server.mjs`) — a Model Context Protocol server that exposes the registry as tools (`search_components`, `get_component`, `list_facets`, `get_index`, `get_adapter`, `translate_component`). Enables direct integration with MCP-capable agents (Claude Desktop, opencode, etc.) over stdio. See `mcp/README.md`. [design-decision]

When an MCP client is connected, agents should prefer the MCP tools over raw HTTP fetches — the tools encapsulate the retrieval flow and cross-design-system transfer below.

## Composition Strategy

Retrieve coordinated sets, not single components. When the task is a page or layout, retrieve a set of components that work together. Choose the smallest set that solves the task. Avoid retrieving components that will not be used.

When the task matches a published recipe (Surface 4), fetch the recipe first — it replaces N component lookups plus assembly guesswork with one atomic fetch. Check `coordination.compositionRecipes` in the index (or the recipe manifest) before composing manually. If composing without a recipe, respect each tile's `coordination.prerequisiteComponents` and `coordination.incompatibleWith`.

When the task matches a published pattern (Surface 6), fetch the pattern first for its component set and cited doctrine. Patterns supply task-level *selection* guidance — which components other builds used for this task and what the design system documents about it. Recipes remain the atomic *assembly* instruction; patterns never prescribe page structure, sequence, or quality standards.

## Adaptation Rules

When adapting a retrieved component:

- Inherit the project's colour palette: replace hardcoded hex values [design-decision]
- Inherit the project's spacing scale: replace hardcoded px values where practical [design-decision]
- Inherit the project's typography: replace font families [design-decision]
- Preserve `prefers-reduced-motion` handling: do not remove it [design-decision]
- Preserve `document.hidden` pause logic: do not remove it [design-decision]
- Preserve CSS/JS namespace prefixes: do not globalise component styles [design-decision]
- Preserve semantic HTML structure [design-decision]
- Minimise additional dependencies introduced during adaptation [design-decision]
- Read the embedded `*-agent-meta` block for component-specific guidance [design-decision]

## Constraint Handling

The embedded metadata uses a categorized structure (schema v2) that separates metadata into three processing categories. This separation is informed by research on LLM-native markup languages showing that explicit instruction/data separation improves accuracy by 74.2% (LLMON, IBM Research 2026) and prevents constraint priority inversion (Constraint Tax, 2026).

### Processing Categories

| Category | Fields | How to Process |
|----------|--------|----------------|
| `discovery` | `description`, `tier`, `tags`, domain facets | **Filter in code** — do not send to model |
| `selection` | `useWhen`, `avoidWhen` | **Read before adapting** — confirms component choice |
| `tradeoffs` | `sacrifices` | **Read before selecting** — explains deliberate design so agents don't treat it as a defect |
| `instruction` | `agentPrompt`, `relatedComponents` | **Follow** — direct guidance for what to do |
| `coordination` | `prerequisiteComponents`, `incompatibleWith`, `compositionCost`, `agentPromptSequence` | **Plan before composing** — check before combining components |
| `constraints` | `preserve`, `editable`, `limitations` | **Enforce** — hard boundaries on changes |
| `portability` | `classMapping` | **Translate** — cross-design-system class substitution |

### Constraint Priority Order

When constraints conflict, resolve in this order (highest priority first):

1. **`constraints.preserve`** — never modify these elements. This protects accessibility (ARIA attributes), semantic HTML structure, and design system integrity. [design-decision]
2. **`constraints.limitations`** — respect known caveats. These document real-world constraints the component cannot overcome. [design-decision]
3. **`instruction.agentPrompt`** — adapt within the boundaries set above. This is the creative guidance. [design-decision]
4. **`constraints.editable`** — prefer changes listed here. These are known-safe modification points. [design-decision]

### Constraint Priority Inversion Prevention

Research shows that when multiple constraints are active simultaneously, less important constraints can silently override more important ones (Constraint Tax, 2026). To prevent this:

- **Never** remove or modify elements listed in `constraints.preserve` to satisfy `instruction.agentPrompt` [design-decision]
- **Never** ignore `constraints.limitations` to enable an adaptation suggested by `instruction.agentPrompt` [design-decision]
- If `instruction.agentPrompt` conflicts with `constraints.preserve`, follow `constraints.preserve` and note the conflict in your output [design-decision]
- If `constraints.editable` doesn't cover a needed change, check `constraints.preserve` first — if the element is not listed there, the change may be safe but should be noted [design-decision]

### Validation Contract

After adapting a component, verify:

1. Every element in `constraints.preserve` is present and unmodified in the output [design-decision]
2. No element in `constraints.limitations` has been violated [design-decision]
3. Changes align with `instruction.agentPrompt` within the constraint boundaries [design-decision]
4. All changes are within `constraints.editable` or explicitly safe [design-decision]

If validation fails, revert the violating change and try an alternative approach.

## Agent-facing docs

Every registry ships two hand-authored agent entry points, kept prose-first
and hand-maintained — never generated from tooling. The registries'
Decision Strategy and Quality Gates sections above are the shared skeleton;
each registry folds its mandates (bilingual parity, error model, identity
assets) into them.

### llms.txt — the lean agent protocol

Recommended section order:

1. **Quick start** — the surface URLs (agents.json, facets.json, index, tile [design-decision]
   pattern, recipes, versions)
2. **Facets** — the filter vocabulary [design-decision]
3. **Decision strategy** — the registry's ladder from the Decision Strategy [design-decision]
   section, ending with "only generate new UI if no suitable component exists"
4. **Quality gates and declared gaps** — do-not-retrieve rules mapped to [design-decision]
   facets (costTier, requiresJs, knownLimitations), plus pointers to the
   registry's declared `gaps` (registry.config.json) and core-classes.json
   (the untiled layout/typography layer)
5. **Component schema** — what an index record and a tile meta block contain [design-decision]
6. **Patterns** — task-to-component-set guidance (Surface 6, `patterns/`) or a pointer to recipes [design-decision]
7. **Output contract** — the registry's contract from the Output Contract [design-decision]
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

1. **Reason** — why this component was selected over alternatives [design-decision]
2. **Selected components** — file paths and titles [design-decision]
3. **Constraint verification** — confirm all `constraints.preserve` elements are intact [design-decision]
4. **Adaptations made** — what was changed from the source and why [design-decision]
5. **Remaining work** — what the component does not yet cover [design-decision]
6. **Recommended next** — what to retrieve or build next to complete the interface [design-decision]

## Quality Gates

Each registry may define its own quality gates. Common patterns:

- Don't retrieve `tier: needs-review` components unless no alternative exists [design-decision]
- Don't use heavy/expensive components for mobile-primary contexts [design-decision]
- Don't use pointer-only interactions for touch-only contexts without a fallback [design-decision]
- Check `requiresJs` if the project prefers CSS-only solutions [design-decision]
- Check `govCompliance` if the project has legal accessibility requirements [design-decision]

## Decision Strategy

When solving a UI task, follow this order:

1. Understand the requested outcome [design-decision]
2. Infer the component type needed [design-decision]
3. Search the index, filtering by relevant facets [design-decision]
4. Prefer existing components over generating new UI from scratch [design-decision]
5. Prefer simpler/cheaper components unless the task requires more [design-decision]
6. Prefer accessible and mobile-ready components by default [design-decision]
7. Read `selection.useWhen` and `selection.avoidWhen` to confirm fit [design-decision]
8. Read `constraints.preserve` before making any changes [design-decision]
9. Follow `instruction.agentPrompt` within constraint boundaries [design-decision]
10. Verify all `constraints.preserve` elements are intact in output [design-decision]
11. Only generate new UI if no suitable component exists in the registry [design-decision]

## Cross-Design System Transfer

The registry protocol supports adapting components from one design system to another (e.g., USWDS to Material or Bootstrap). This is informed by research on framework-agnostic intermediate representations (Widget2Code, CVPR 2026; Scenethesis, ICSE 2026) and intent-driven cross-library migration (IntentTester, 2026).

### How It Works

The v2 metadata schema separates **portable invariants** (semantic HTML, ARIA, behavior attributes) from **design-system-specific preserves** (CSS classes, design tokens). This separation enables an agent to:

1. Keep portable invariants intact across any design system [design-decision]
2. Replace design-system-specific classes using `portability.classMapping` [design-decision]
3. Validate the result against the original tile's rendered output (oracle-driven validation) [design-decision]

### Transfer Flow

```
1. Fetch source tile from this registry [design-decision]
2. Parse metadata — identify portableInvariants vs preserve [design-decision]
3. Look up classMapping for target design system [design-decision]
4. Replace: preserve classes → classMapping equivalents [design-decision]
5. Keep: portableInvariants unchanged [design-decision]
6. Validate: rendered output matches source behavior [design-decision]
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

1. Every `constraints.portableInvariants` element is present and unmodified [design-decision]
2. CSS classes match `portability.classMapping` for the target system [design-decision]
3. Visual rendering is functionally equivalent to the source tile [design-decision]
4. Accessibility attributes are preserved [design-decision]
5. JavaScript behavior (if any) works with the target system's runtime [design-decision]

If the target design system is not in `classMapping`, fall back to `portableInvariants` only — do not guess class mappings.
