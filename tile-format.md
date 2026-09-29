# Tile Format Specification

## Overview

Every component in the registry is a single self-contained `.html` file. The file serves two purposes simultaneously:

1. **Runnable demo** — opens in a browser by double-clicking, no build step
2. **Adaptation instructions** — contains an embedded JSON block that tells an AI agent how to safely modify the component

## File Requirements

- **Structurally self-contained**: all markup, component class names, and
  embedded metadata need nothing external. All CSS and JS that the registry
  itself authors is inline. Where a design system's component styling lives in
  the design system's own stylesheet (e.g., USWDS CSS), tiles rely on it — the
  appearance resolves either through the host page that loads the design
  system (the primary agent-integration flow) or through the tile's generated
  **resolved view** (see below) for standalone preview and non-browser tools.
- **Works offline**: opens by double-click, no server required.
- **One component per file**: each tile demonstrates one component variant.

## Tile Purity (component ground truth)

A tile is three layers with different governance:

| Layer | Content | Governance |
|---|---|---|
| **Component** | body markup — structure, classes, text, attributes (script elements excluded) | **Purity** — changes only as ground-truth corrections |
| **Behavior** | `<script>` elements | Behavior contract (`instruction.behavior`) — truthful, single-handling |
| **Interface** | agent-meta blocks (`{agentMetaId}`, `{agentMetaId}-dense`) | Free — the coordination layer; may change at any time |

The component belongs to the design system, not the registry; the registry's
value is the metadata around it. Therefore:

1. **Metadata may change freely** — facets, guidance, coordination, patterns,
   compliance fields. This is the instruction layer, and it is the only place
   the registry authors content.
2. **Body markup changes only as ground-truth capture or correction** — two
   admissible sources, each cited in the tile's `provenance` (`method` +
   `source`):
   - **Design-system source** (canon): the official template, component page,
     or documented structure. Corrections move tiles *toward* the design
     system; never for convenience, invention, or restyling.
   - **Live-site observation** (variant): a real implementation observed on a
     live site, when the design system itself does not canonize the component.
     The live site is the ground truth for that variant, and the tile MUST be
     labeled `discovery.origin: "live-site"` (see Discovery Fields) so agents
     can filter doctrine from observed variants.
3. **Behavior scripts are declared, not improvised** — an inline script is
   legitimate when the tile's `instruction.behavior` contract declares
   `source: inline`, and must follow the single-handling rule when the host
   bundle is wired. Script changes are governed by the behavior contract, not
   by purity.

### Enforcement (body-stamp baseline)

`generate-index.mjs` computes a SHA-256 over each tile's whitespace-normalized
body markup with script elements excluded, and maintains
`{tileDir}/tile-purity.json` as a git-tracked baseline.

- **Baseline drift** (a tile's body changed since the last baseline) is a
  generation failure unless that tile's `provenance` cites ground truth
  (`method` + `source`) — with a citation, the baseline is regenerated and the
  correction is logged; without one, the generator aborts before writing
  anything.
- `validate-registry.mjs` recomputes the hashes: a tile whose body differs
  from the baseline is a conformance error. The check is active whenever
  `tile-purity.json` exists, so registries opt in by generating it.
- Whitespace is normalized before hashing: formatting-only changes are not
  component changes; everything else is.

## HTML Structure

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="description" content="Brief description of this component.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Component Name (Variant)</title>
  <script type="application/json" id="{agentMetaId}">
  {
    "file": "component/variant.html",
    "title": "Component (Variant)",
    "_schemaVersion": 2,
    ...metadata fields...
  }
  </script>
</head>
<body>
  <!-- Component markup here -->
</body>
</html>
```

## The Embedded Metadata Block

The `<script type="application/json" id="{agentMetaId}">` block is the key innovation. It travels inside the tile so:

- The index stays lean (no prose bloating the discovery layer)
- One fetch returns code + instructions together
- The agent only pays the prose cost for components it actually retrieves

The `agentMetaId` is configurable per registry:
- `forever-ai-components` uses `forever-agent-meta`
- `uswds-ai-components` uses `uswds-agent-meta`
- Your registry can use `your-agent-meta`

### Dense metadata block (optional, token-budgeted)

A tile MAY carry a second block `<script type="application/json"
id="{agentMetaId}-dense">` containing the same metadata in token-optimized
form: short strings, no prose duplication, categories flattened. Inspired by
Astryx's three-density doc pattern (full / translated / dense). Rules:

- The dense block is a *compression* of the full block, never a second source
  of truth. On any conflict, the full block wins.
- Required keys: `use`, `avoid`, `do`, `dont` (each a compact string array —
  `do`/`dont` flatten `selection.guidance` into `true`/`false` groups),
  `preserve` (string array), `adapt` (the `instruction.agentPrompt`, shortened).
- Budget: the dense block's JSON must be ≤ 40% of the full block's JSON length
  (enforced by the validator as a warning). If it exceeds the budget, the
  registry should trim prose rather than drop required keys.
- Agents that already hold the full block skip the dense block; the dense
  surface pays off in multi-component assembly, where several tiles' full meta
  would blow a single context budget.

## Resolved View Companion (optional, generated)

The tile contract guarantees fidelity under **browser rendering**. Some
consumers — design tools, static analyzers, canvas-based editors — parse HTML
without a CSS engine and cannot compute layout (geometry, inheritance, page
chrome). A registry MAY generate a **resolved view** per tile to serve these
consumers:

- Path: co-located with the tile as `{variant}.resolved.html`
  (e.g. `infinite/button/default.html` → `infinite/button/default.resolved.html`).
  `.resolved.html` is a **reserved suffix**: `generate-index.mjs` and
  `validate-registry.mjs` skip it; it is never a tile. When present,
  `generate-index.mjs` exposes the path on the tile's index record as
  `resolvedView`, making appearance a first-class retrieval surface.
- **Staleness**: each resolved view embeds a SHA-256 stamp of its tile source
  (`resolved-from: sha256:…`). The validator errors on missing resolved views
  (when the registry declares `staticView`) and warns on stale ones.
- Content: the tile's DOM with every element's **computed styles flattened
  inline** (geometry, colors, borders, spacing, typography), page chrome
  materialized on a wrapper element, and scripts/styles/links removed. Class
  names and text content are preserved byte-for-byte.
- Generation: `node _base/generate-resolved-view.mjs` (run from the registry
  root; requires `npm i -D puppeteer` in the registry). Configured via
  `registry.config.json`:

```json
"staticView": {
  "css": ["node_modules/@uswds/uswds/dist/css/uswds.min.css"],
  "viewport": { "width": 1280, "height": 4000 }
}
```

- `css` lists stylesheets injected at generation time. This is how registries
  whose tiles rely on external design-system CSS (the tile-format
  self-containment exception) still resolve to their true appearance.
- Resolved views are **generated artifacts**: never hand-edited, never indexed,
  never counted in facet coverage. Regenerate alongside tile changes.
- Field-test evidence (openpencil-field-test, 2026-09-22): with resolved views,
  a third-party design-tool importer produced correct node geometry, fills,
  and typography for tiles that previously collapsed to default placeholders.

### Class ground-truth check (`staticView.classCheck`)

When `staticView.classCheck` is declared, `validate-registry.mjs` treats the
`staticView.css` stylesheets as ground truth: every tile-DOM class with the
configured `prefix` must be **defined by those stylesheets** or appear in the
`allowlist` with a reason (JS mounts, documented no-ops, registry demo
classes). Violations are conformance errors. This closes the L9 asymmetry —
the hallucinated-class discipline that field tests apply to artifacts now
applies to the registry itself.

## Metadata Schema Versions

### Schema v1 (Legacy — flat structure)

All metadata fields at the top level. Still supported for backward compatibility.

### Schema v2 (Current — categorized structure)

Metadata is organized into categories based on how the agent should process each field. This separation is informed by research showing that explicit instruction/data separation improves LLM accuracy by 74.2% (LLMON, IBM Research 2026) and reduces constraint priority inversion in multi-constraint scenarios (Constraint Tax, 2026). Research on cross-framework transfer (Widget2Code, CVPR 2026; IntentTester, 2026) shows that separating portable intent from system-specific implementation enables reliable adaptation across design systems.

```json
{
  "file": "button/default.html",
  "title": "Button (Default)",
  "_schemaVersion": 2,

  "discovery": {
    "description": "Primary button for important actions.",
    "tier": "curated",
    "tags": ["button", "cta", "action"]
  },

  "selection": {
    "useWhen": [
      "Important actions users should take on the site",
      "Primary CTAs that advance to the next step"
    ],
    "avoidWhen": [
      "Linking between pages — use regular links instead"
    ]
  },

  "tradeoffs": {
    "sacrifices": [
      { "capability": "loading states", "because": "pending indication belongs to the host application; the tile stays a static starting point" }
    ]
  },

  "instruction": {
    "agentPrompt": "Change button text, add variant classes like usa-button--secondary.",
    "relatedComponents": ["button-group", "link"]
  },

  "coordination": {
    "prerequisiteComponents": [
      { "name": "form", "reason": "Provides form context; place inputs inside it" }
    ],
    "incompatibleWith": [
      { "name": "button-group", "reason": "Button groups override individual button event handlers" }
    ],
    "compositionCost": {
      "costTier": "cheap",
      "estimatedTokens": 750,
      "renderingTimeMs": 15,
      "recommendedModel": "haiku"
    },
    "agentPromptSequence": [
      "1. Fetch form wrapper first",
      "2. Place the button as the last child of the form",
      "3. Set type='submit' if it submits the form"
    ]
  },

  "constraints": {
    "preserve": [
      "usa-button base class on button or link element",
      "type='button' on non-submit buttons"
    ],
    "portableInvariants": [
      "Semantic <button> or <a> element",
      "type attribute for behavior definition",
      "disabled attribute syntax for screen readers",
      "Sentence case text capitalization"
    ],
    "editable": [
      "Button label text content",
      "Variant class: usa-button--secondary, usa-button--outline",
      "Disabled state: disabled='disabled' or aria-disabled='true'"
    ],
    "limitations": [
      "Always set type attribute to define behavior",
      "Big buttons do not automatically resize on mobile"
    ]
  },

  "portability": {
    "classMapping": {
      "material": { "base": "mdc-button", "variants": { "secondary": "mdc-button--unelevated", "outline": "mdc-button--outlined", "big": "mdc-button--touch" } },
      "bootstrap": { "base": "btn btn-primary", "variants": { "secondary": "btn btn-secondary", "outline": "btn btn-outline-primary", "big": "btn btn-lg" } }
    }
  }
}
```

## Why Categorized Metadata?

Research on LLM-native markup languages (LLMON) demonstrates that separating instructions from data improves model accuracy, safety, and security. The categorized structure maps to distinct processing modes:

| Category | Processing Mode | Purpose |
|----------|----------------|---------|
| `discovery` | **Index only** — never sent to the model | Facets for filtering in code |
| `selection` | **Read before adapting** — helps choose the right component | When to use / avoid this component |
| `tradeoffs` | **Read before selecting** — explains deliberate design | Capabilities the component gives up on purpose, so agents don't treat design decisions as defects |
| `instruction` | **Follow** — direct guidance for adaptation | What the agent should do |
| `customization` | **Override deliberately** — the declared, typed override surface | Where and how the component may be customized, and what to re-verify |
| `coordination` | **Plan before composing** — check before combining components | Dependencies, conflicts, cost of composition |
| `constraints` | **Enforce** — hard boundaries on adaptation | What must/must not change |
| `portability` | **Translate** — cross-design system mapping | How to adapt to other design systems |

### Constraint Priority Order

When constraints conflict, follow this order (highest to lowest):

1. **`constraints.portableInvariants`** — never modify these elements (semantic HTML, ARIA, behavior attributes). These survive cross-design system translation.
2. **`constraints.preserve`** — never modify within the source design system (CSS classes, design tokens)
3. **`constraints.limitations`** — respect known caveats
4. **`instruction.agentPrompt`** — adapt within the above boundaries
5. **`constraints.editable`** — prefer changes listed here

This ordering prevents "constraint priority inversion" where a less important constraint silently overrides a more important one (Constraint Tax, 2026). The separation of `portableInvariants` from `preserve` is informed by cross-framework transfer research (Widget2Code, CVPR 2026; IntentTester, 2026) showing that abstracting intent-level invariants from implementation-level classes enables reliable adaptation across design systems.

## Standard Metadata Fields (Schema v2)

### Discovery Fields (for filtering, not sent to model)

| Field | Type | Description |
|-------|------|-------------|
| `file` | string | path relative to tileDir |
| `title` | string | component name + variant |
| `_schemaVersion` | integer | metadata schema version (currently `2`) |
| `discovery.description` | string | one-line summary |
| `discovery.tier` | string | quality tier (e.g., `curated`, `needs-review`) |
| `discovery.tags` | string[] | semantic search keywords |
| `discovery.origin` | enum | provenance of the component body: `design-system` (canon — the design system documents or ships it; implied when absent) or `live-site` (an observed variant captured from a real implementation, **not** design-system canon). Required (as `live-site`) whenever the tile's `provenance.method` is `live-site observation`. Index-normalized so agents can filter doctrine from observed variants in code. |
| `discovery.patterns` | string[] | pattern names (protocol.md Surface 6) this component participates in. Normalized into the index like `compositionRecipes` so pattern members are filterable in code. |

### Selection Fields (help agent choose the right component)

| Field | Type | Description |
|-------|------|-------------|
| `selection.useWhen` | string[] | situations this component is a good fit |
| `selection.avoidWhen` | string[] | situations to avoid this component |
| `selection.guidance` | {guidance: boolean, description: string}[] | machine-readable do/don't pairs for *adapting* this component. `guidance: true` = do, `false` = don't. Distinct from `useWhen`/`avoidWhen` (which govern *component choice*): guidance governs *how the placed component behaves* in its context. Entries are binary-labeled so agents can enforce them without prose interpretation. |

Guidance entries carry task-level quality rules that field tests showed agents
drift on when absent (T5 `t5-001`: relative-only countdowns in time-sensitive
warnings, opaque commitment actions — see `lessons-learned.md` L11/L12). A
`false` entry is a prohibition, not a suggestion.

### Trade-off Fields (deliberate design, recorded as data)

Optional block recording what the component gives up **on purpose**. Without
it, agents read a deliberate sacrifice as a defect and "helpfully" work around
it or substitute another component — the cross-registry mistranslation class
documented in field tests (L7: DSFR and Canada omit page-level error summaries
by design; an agent translating a USWDS form page adds one anyway).

| Field | Type | Description |
|-------|------|-------------|
| `tradeoffs.sacrifices` | {capability, because}[] | capabilities this component deliberately does not provide, each with the design reason |
| `tradeoffs.note` | string | optional pointer to the design-system documentation this trade-off traces to |

```json
"tradeoffs": {
  "sacrifices": [
    { "capability": "in-place editing", "because": "summary-list rows link to dedicated change pages instead — one trust pattern per journey" }
  ]
}
```

Rules:

- `because` is required on every entry — an omission without a stated reason
  is a gap, not a trade-off (validator-enforced). Registry-level omissions
  (whole concepts the design system intentionally does not tile) are declared
  in `registry.config.json` `gaps` with `status: not_part_of_design_system` —
  one concept, one name; this block records component-level trade-offs only.
- Sacrifices record the design system's decision, not the registry author's
  preference. When the reason traces to documentation, cite it in `note`.
- **Index leanness rule:** `tradeoffs` never enters the discovery index; it
  travels in the tile like all prose enrichment.

### Instruction Fields (guide adaptation)

| Field | Type | Description |
|-------|------|-------------|
| `instruction.agentPrompt` | string | concrete adaptation instruction |
| `instruction.relatedComponents` | string[] | commonly paired components |

### Behavior Fields (make the placed component work)

A `requiresJs: required` index record is a *promise the tile must keep*.
Field tests (federal-anchor-test, 2026-09-27) showed the family-wide failure
mode: tiles ship markup + metadata but no behavior contract, so an agent that
follows the retrieval flow correctly can still only render inert components.
The registry's obligation ends at publishing a complete, truthful contract;
**acting on it is the implementor's job.**

| Field | Type | Description |
|-------|------|-------------|
| `instruction.behavior` | object | the behavior contract for interactive components. Required whenever the index record declares `requiresJs: required` or `optional`. Present but minimal (`requires: "none"` may be omitted entirely) for passive components. |
| `instruction.behavior.requires` | enum | `required` \| `optional` — mirrors the index `requiresJs` facet; the tile-local value wins on conflict |
| `instruction.behavior.source` | enum | where the implementing agent gets the behavior: `host` — the design system's own JS bundle, which the host page is expected to load in the primary agent-integration flow; `inline` — a dependency-free `<script>` the tile itself carries after the agent-meta block; `url` — an explicit script URL |
| `instruction.behavior.script` | string | with `source: url`, the script URL; with `source: host`, the design-system bundle the host page must load (e.g. `uswds.min.js`) |
| `instruction.behavior.init` | string | the activation contract — e.g. `auto (DOMContentLoaded)`, or an entry point/selector the implementor must call after insertion |
| `instruction.behavior.fallback` | string | the documented no-JS rendering the implementor must preserve when JS is genuinely unavailable (e.g. `static-expanded, content visible`) |

Rules:

- **Details travel in the tile, never the index** — the index keeps only the
  lean `requiresJs` facet; discovery stays filterable, enrichment stays
  one-fetch (same rule as all prose).
- **`source: inline` scripts are part of the tile's self-containment
  guarantee** and must be dependency-free and copyable verbatim.
- **The contract must be truthful**: a tile that renders functional only
  with design-system JS must not claim `source: inline`.
- **Single-handling rule**: when the implementor wires a behavior's
  `source: host`/`url` bundle and the bundle already implements a component
  that also carries an `inline` script, the inline script must be omitted —
  never double-register handlers on the same control (federal-anchor-test
  2026-09-27: banner disclosure double-toggle when both were wired).
- Validator hook: `validate-registry.mjs` should error on any index record
  with `requiresJs ∈ {required, optional}` whose tile lacks
  `instruction.behavior`.

### Coordination Fields (plan before composing)

### Customization Fields (declared override surface — proposal, additive)

"Agent-ready" and "fully customizable" are usually framed as opposing goals:
constraints that make generation predictable seem to forbid customization. The
resolution this spec adopts: **constraints bind what the agent generates;
customizability is a declared, typed surface the registry hands out.** The two
cannot fight when every override point is enumerable and every override rung
carries its own verification obligation. (The framing responds to the common
critique that agent-ready design systems cannot also be customizable.)

`customization` publishes that surface as the **Override Ladder** — an ordered
list of sanctioned override layers, most-constrained first:

| Rung | Layer | Meaning | Typical legality |
|------|-------|---------|------------------|
| 1 | `variant-class` | switch to an enumerated variant of the component (or a sibling tile's variant) | free, but fetch the target tile first — never guess the class |
| 2 | `css-var` | override declared design tokens / CSS custom properties | free within declared token vocabulary |
| 3 | `inline-style` | page-level styling on/around the component (emphasis, spacing, shadow) | free at page level; **never invent `usa-*`-style component classes** (the L3 rule) |
| 4 | `core-class` | use the registry's untiled core layer for layout/typography | free from `core-classes.json` only |
| 5 | `fork` | diverge from the component's class vocabulary entirely | **gated**: only with a documented divergence in the registry's provenance record |

Fields:

| Field | Type | Description |
|-------|------|-------------|
| `customization.ladder` | {rung: integer, layer: enum, free: boolean, options?, vars?, note?, rule?, source?}[] | the sanctioned override layers for this component, ordered by rung. `layer` ∈ `variant-class` \| `css-var` \| `inline-style` \| `core-class` \| `fork`. `options` enumerates legal variant classes (rung 1); `vars` enumerates legal custom properties (rung 2); `source` names the manifest for core classes (rung 4); `rule` states the gate condition (rung 5). Rungs may be skipped when a layer does not apply to this component. |
| `customization.verificationAfter` | string[] | checks the agent must re-run after any override (e.g. `constraints.preserve intact`, `coverage zero-invented`, `role/state semantics unchanged`) |

Design rules:

- **Rung legality defers to constraints.** `constraints.preserve` and
  `portableInvariants` outrank every rung: a rung never licenses changing a
  preserved element. The ladder routes requests *around* constraints, not
  through them.
- **The ladder is per-component, not universal.** A button with build-time
  token settings may omit rung 2; an alert family with five variants leans on
  rung 1. Omitting a layer declares that path closed — an agent that needs it
  climbs to the next rung instead of improvising.
- **Rung 5 is the registry's answer to swizzle/eject** (Astryx's term): our
  tiles are already the full component source, so ejection is inherent; the
  only gate is documentation. Divergence without a provenance record is the
  failure mode the coverage checker treats as invention.
- **Context-qualified etiquette (optional).** A registry MAY qualify the
  ladder per delivery context (static HTML, React wrapper, Drupal theme) via
  its adapter mechanism: the same component, different override etiquette per
  consumer. Each etiquette is declared, so customization stays constrained.

This category is additive and optional (schema v2). Absent `customization`,
agents fall back to the implicit ordering above (variants → tokens → inline →
core → documented fork).

### Coordination Fields (plan before composing)

Coordination metadata tells an orchestrating agent what must exist before this
component is used, what it conflicts with, and what composing it costs. This
supports multi-agent workflows where a coordinator assembles components
retrieved by workers.

| Field | Type | Description |
|-------|------|-------------|
| `coordination.prerequisiteComponents` | {name, reason}[] | components that must be fetched/placed first (e.g. a form wrapper before its inputs) |
| `coordination.incompatibleWith` | {name, reason}[] | components that should not be paired with this one |
| `coordination.compositionCost.costTier` | enum | `cheap` \| `moderate` \| `expensive` — routing hint for model/task assignment (vocabulary shared with the forever-ai-components `perfTier` facet) |
| `coordination.compositionCost.estimatedTokens` | integer | approximate token count of the tile source |
| `coordination.compositionCost.renderingTimeMs` | integer | approximate client-side render/behavior cost |
| `coordination.compositionCost.recommendedModel` | string | suggested model tier for adapting this component (e.g. `haiku`, `sonnet`) |
| `coordination.agentPromptSequence` | string[] | ordered assembly instructions for placing this component in a larger UI |
| `coordination.compositionRecipes` | string[] | recipe names (Surface 4) this component participates in |
| `coordination.variantRules` | object | optional nested-variant legality: `exclusiveGroups` (array of mutually exclusive variant name arrays) and `combinable` (variant names that combine freely) |

### Compliance & Mobile Fields (domain-enriched discovery)

Registries serving regulated domains attach compliance and mobile-safety facts
to the `discovery` category so they can be filtered in code. These are
*facts about the component*, not instructions.

| Field | Type | Description |
|-------|------|-------------|
| `discovery.compliance.nistControls` | string[] | NIST SP 800-53 control IDs this component touches (e.g. `AU-12` for audit-record-producing inputs) |
| `discovery.compliance.fedRampLevel` | string | minimum suitable FedRAMP impact level (`IL2`, `IL2+`, `IL4`, `IL5`) |
| `discovery.compliance.section508` | boolean | Section 508 conformance |
| `discovery.compliance.wcag21AA` | boolean | WCAG 2.1 AA conformance |
| `discovery.compliance.piiHandling` | enum | `accepts_input` \| `displays_only` \| `none` — PII relationship |
| `discovery.compliance.auditTrailCompatible` | boolean | suitable for systems with audit-logging requirements |
| `discovery.compliance.dataMaskingCompatible` | boolean | supports masked input (e.g. password-style display) |
| `discovery.mobileUX.touchTargetSize` | string | smallest touch target this variant guarantees (e.g. `44px`) |
| `discovery.mobileUX.requiredMinSpacing` | string | minimum spacing between adjacent instances (e.g. `8px`) |
| `discovery.mobileUX.orientationLocked` | boolean | whether the component forces an orientation |
| `discovery.mobileUX.fullscreenSafe` | boolean | renders correctly in fullscreen/notch-aware viewports |
| `supportedTokenProfiles` | string[] | token profile names (registry `tokenProfiles` keys) this component supports |

**Index leanness rule:** coordination *summary* fields, compliance/mobileUX
flattened summaries, and `supportedTokenProfiles` are normalized into
`components.index.json`; the verbose blocks themselves (`reason`,
`agentPromptSequence`, full `compositionCost`, `variantRules`, full
`compliance`, full `mobileUX`) travel only in the tile, so the discovery
index stays filterable without bloat.

### Constraint Fields (enforce boundaries)

| Field | Type | Description |
|-------|------|-------------|
| `constraints.portableInvariants` | string[] | semantic/behavioral elements that survive cross-system translation |
| `constraints.preserve` | string[] | design-system-specific elements that must remain unchanged |
| `constraints.editable` | string[] | what you can safely change |
| `constraints.limitations` | string[] | caveats and known issues |

### Portability Fields (cross-design system transfer)

| Field | Type | Description |
|-------|------|-------------|
| `portability.classMapping` | object | maps component classes to equivalent classes in other design systems |
| `portability.classMapping.{system}.base` | string | base class in target design system |
| `portability.classMapping.{system}.variants` | object | maps variant names to target variant classes |

#### classMapping Structure

```json
"portability": {
  "classMapping": {
    "material": {
      "base": "mdc-button",
      "variants": {
        "secondary": "mdc-button--unelevated",
        "outline": "mdc-button--outlined"
      }
    },
    "bootstrap": {
      "base": "btn btn-primary",
      "variants": {
        "secondary": "btn btn-secondary",
        "outline": "btn btn-outline-primary"
      }
    }
  }
}
```

The `classMapping` keys are design system identifiers. Each mapping provides:
- `base`: the equivalent base class in the target system
- `variants`: a mapping from source variant names to target variant classes

Agents use `classMapping` together with `portableInvariants` to translate a component: replace design-system-specific classes (`constraints.preserve`) with mapped equivalents (`portability.classMapping`), while keeping portable invariants intact.

## Backward Compatibility (Schema v1)

Schema v1 tiles (flat structure) are still supported. The generator detects the schema version automatically:

- If `_schemaVersion` is absent or `1`, fields are read from the top level
- If `_schemaVersion` is `2`, fields are read from their categorized locations

The generator normalizes both formats into a unified index structure.

## Domain-Specific Fields

Registries can add fields specific to their design system within any category. For example, USWDS adds discovery fields:

```json
{
  "discovery": {
    "description": "...",
    "tier": "curated",
    "tags": ["button"],
    "uswdsComponentType": "button",
    "uswdsClass": "usa-button",
    "section": "utilities",
    "variant": "default",
    "requiresJs": "no",
    "interaction": ["click", "focus", "hover"],
    "a11y": { "wcag21AA": true, "keyboardNav": true },
    "govCompliance": ["Section 508", "WCAG 2.1 AA"]
  },
  "instruction": {
    "agentPrompt": "...",
    "relatedComponents": ["button-group"],
    "variants": ["default", "secondary", "outline"],
    "settings": ["$theme-button-border-radius"],
    "tokenOverrides": ["$theme-button-stroke-width"]
  }
}
```

### Provenance Fields (where the tile knowledge came from)

Optional block recording when and where the component/variant knowledge was
acquired — valuable for field-research-driven registries and for auditing
coverage claims.

| Field | Type | Description |
|-------|------|-------------|
| `provenance.observed` | date | when the variant was observed/derived (YYYY-MM-DD) |
| `provenance.source` | string | URL of the site or documentation page where it was observed |
| `provenance.method` | enum | `live-site observation` \| `design-system documentation` \| `coverage audit` |
| `provenance.designSystemVersion` | string | design-system version this tile's body was last verified against. Set at capture; `generate-index.mjs` re-stamps it automatically when a purity re-baseline occurs (a cited correction is a re-verification against the current pin). Stale or missing stamps are an aggregated worklist warning, never an error — see protocol.md "Design-System Version Sync". |

**Index leanness rule:** provenance stays in the tile; it is never copied into
the discovery index. Registries doing systematic field research should also
maintain a session log at `{tileDir}/provenance.json` (sessions with date,
source, findings, and tilesAdded).

**Tile purity:** body-markup corrections cite their ground truth here
(`method` + `source`) — `generate-index.mjs` requires this citation before
re-baselining a changed tile body (see "Tile Purity" above).

### Core Classes (the untiled layer)

Registries tile **components** — but agents assembling full pages also need
each design system's **layout/grid/typography/wrapper classes**, which are
deliberately not components. Every registry publishes a
`core-classes.json` manifest declaring that layer, so page assembly never
relies on out-of-band knowledge or invented classes.

```json
{
  "schemaVersion": 1,
  "registry": "dsfr-ai-components",
  "description": "Real, documented design-system classes that are NOT tiled components",
  "categories": {
    "layout": ["fr-container", "fr-grid-row", "fr-col-6", "fr-col-12"],
    "typography": ["fr-h5", "fr-text--sm", "fr-text--lg"],
    "elements": ["fr-link", "fr-logo", "fr-label", "fr-hint-text"],
    "states": ["fr-error-text", "fr-valid-text"]
  }
}
```

**Authoring rule (enforced by field testing):** site customizations and
composition layout are expressed with **inline styles or core classes** —
never with invented component-style classes (`fr-*`, `usa-*`, `govuk-*`,
`ecl-*` names that no tile defines). Zero invented classes is an acceptance
criterion of the field-test procedure (`test-procedure.md`).

### Language Fields

Tile markup labels are written in the registry's declared language(s).
Registries declare their language convention in `registry.config.json`
(`language` for single-language registries, `languages` for bilingual
mandates such as Canada). Bilingual-default registries (DSFR) carry
target-language strings in tile markup — agents translating into them must
expect and handle target-language label text.

## File Naming Convention

Tiles are organized as `{tileDir}/{component}/{variant}.html`:

```
infinite/
├── button/
│   ├── default.html
│   ├── secondary.html
│   └── big.html
├── card/
│   ├── default.html
│   └── flag.html
└── header/
    ├── default.html
    └── extended.html
```

The `file` field in the metadata matches this path: `button/default.html`.
