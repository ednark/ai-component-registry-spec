# Tile Format Specification

## Overview

Every component in the registry is a single self-contained `.html` file. The file serves two purposes simultaneously:

1. **Runnable demo** — opens in a browser by double-clicking, no build step
2. **Adaptation instructions** — contains an embedded JSON block that tells an AI agent how to safely modify the component

## File Requirements

- **Self-contained**: all CSS and JS is inline. No external dependencies (unless the design system itself requires them, e.g., USWDS CSS).
- **Works offline**: opens by double-click, no server required.
- **One component per file**: each tile demonstrates one component variant.

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
| `instruction` | **Follow** — direct guidance for adaptation | What the agent should do |
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

### Selection Fields (help agent choose the right component)

| Field | Type | Description |
|-------|------|-------------|
| `selection.useWhen` | string[] | situations this component is a good fit |
| `selection.avoidWhen` | string[] | situations to avoid this component |

### Instruction Fields (guide adaptation)

| Field | Type | Description |
|-------|------|-------------|
| `instruction.agentPrompt` | string | concrete adaptation instruction |
| `instruction.relatedComponents` | string[] | commonly paired components |

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

**Index leanness rule:** provenance stays in the tile; it is never copied into
the discovery index. Registries doing systematic field research should also
maintain a session log at `{tileDir}/provenance.json` (sessions with date,
source, findings, and tilesAdded).

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
