# Adapter Registry Format Specification

## Overview

An adapter registry provides **cross-design system semantic mappings** — it maps component semantics from a source design system to equivalent components in target design systems. Unlike component registries, adapter registries contain no tiles. They contain only mapping definitions.

This separation is informed by research on framework-agnostic intermediate representations (Widget2Code, CVPR 2026; Scenethesis, ICSE 2026) and intent-driven cross-library migration (IntentTester, 2026). The key insight: abstracting intent (not code) is the key to cross-system transfer.

## When to Use an Adapter Registry

| Scenario | Use |
|----------|-----|
| Simple class substitution (e.g., `usa-button` → `mdc-button`) | `portability.classMapping` in tile metadata |
| Semantic mapping with behavioral differences | Adapter registry |
| Cross-language/framework migration | Adapter registry |
| Components with no 1:1 equivalent | Adapter registry |

## Architecture

```
adapter-registry/
├── adapters.json              → manifest: source/target systems, component count
├── adapters/
│   ├── button.json            → per-component semantic mapping
│   ├── card.json
│   └── ...
└── README.md
```

## The Manifest: `adapters.json`

```json
{
  "name": "uswds-to-material-adapter",
  "description": "Semantic mappings from USWDS 3.13.0 to Material Design 3",
  "source": {
    "designSystem": "U.S. Web Design System",
    "version": "3.13.0",
    "registry": "https://raw.githubusercontent.com/ednark/uswds-ai-components/main"
  },
  "targets": [
    {
      "id": "material",
      "designSystem": "Material Design 3",
      "version": "3.0.0",
      "docs": "https://m3.material.io/components"
    }
  ],
  "count": 48,
  "adaptersUrl": "https://raw.githubusercontent.com/example/uswds-to-material-adapter/main/adapters/{component}.json",
  "updated": "1.0.0"
}
```

## Component Adapter: `adapters/{component}.json`

Each adapter file maps one source component to one or more target equivalents.

```json
{
  "source": {
    "component": "button",
    "registry": "uswds-ai-components",
    "tiles": ["button/default.html", "button/secondary.html", "button/outline.html"]
  },
  "mappings": {
    "material": {
      "component": "button",
      "equivalence": "close",
      "baseClass": "mdc-button",
      "semanticNotes": [
        "Material buttons use ripple effect by default — add js-ripple class",
        "Material does not have a direct 'accent-warm' variant — use color tokens"
      ],
      "variantMapping": {
        "default": { "class": "mdc-button", "notes": "Primary filled button" },
        "secondary": { "class": "mdc-button mdc-button--unelevated", "notes": null },
        "outline": { "class": "mdc-button mdc-button--outlined", "notes": null },
        "big": { "class": "mdc-button mdc-button--touch", "notes": "Use touch target wrapper" },
        "accent-cool": null,
        "accent-warm": null,
        "unstyled": { "class": "mdc-button mdc-button--text", "notes": "Closest equivalent: text button" }
      },
      "attributeMapping": {
        "disabled='disabled'": "disabled",
        "type='button'": "type='button'",
        "type='submit'": "type='submit'"
      },
      "structuralMapping": {
        "preserve": [
          "Semantic <button> or <a> element",
          "type attribute",
          "disabled attribute"
        ],
        "replace": [
          { "source": "usa-button", "target": "mdc-button" },
          { "source": "usa-button--secondary", "target": "mdc-button--unelevated" }
        ],
        "add": [
          "<span class=\"mdc-button__label\">{text}</span> wrapper for button text"
        ],
        "remove": [
          "usa-focus class — Material handles focus via ripple"
        ]
      },
      "dependencies": [
        "@material/button/styles",
        "@material/button/mdc-button"
      ],
      "limitations": [
        "Material buttons require JS for ripple effect",
        "No direct equivalent for accent-cool/accent-warm color variants"
      ]
    }
  }
}
```

## Adapter Fields

### Top-Level

| Field | Type | Description |
|-------|------|-------------|
| `source.component` | string | source component name |
| `source.registry` | string | source registry name |
| `source.tiles` | string[] | source tile file paths |
| `mappings` | object | keyed by target design system ID |

### Per-Target Mapping

| Field | Type | Description |
|-------|------|-------------|
| `component` | string | target component name |
| `equivalence` | enum | `exact`, `close`, `partial`, `none` |
| `baseClass` | string | target base CSS class |
| `semanticNotes` | string[] | behavioral differences the agent should know |
| `variantMapping` | object | maps source variant names to target classes + notes |
| `attributeMapping` | object | maps source attributes to target attributes |
| `structuralMapping.preserve` | string[] | elements that survive translation |
| `structuralMapping.replace` | object[] | source→target class replacements |
| `structuralMapping.add` | string[] | markup to add in target system |
| `structuralMapping.remove` | string[] | markup to remove in target system |
| `dependencies` | string[] | required packages/modules in target system |
| `limitations` | string[] | known gaps in the mapping |

### Equivalence Levels

| Level | Meaning | Agent Action |
|-------|---------|-------------|
| `exact` | 1:1 semantic and visual match | Direct substitution |
| `close` | Semantically equivalent, minor visual differences | Substitute with notes |
| `partial` | Covers some but not all source functionality | Substitute available features, note gaps |
| `none` | No equivalent exists | Do not translate, recommend alternative |

When `variantMapping` value is `null`, that variant has no equivalent in the target system. The agent should note this gap in its output.

## Relationship to Tile Metadata

Tile metadata (`portability.classMapping`) and adapter registries serve different purposes:

| Aspect | Tile `classMapping` | Adapter Registry |
|--------|-------------------|-----------------|
| Scope | Simple class substitution | Full semantic mapping |
| Detail | Base class + variant classes | Structural changes, dependencies, limitations |
| Location | Embedded in tile HTML | Separate registry |
| Use when | Target system has near-identical component | Target system has behavioral differences |
| Fallback | If no classMapping entry exists | If no adapter exists, use portableInvariants only |

Agents should check tile `classMapping` first (it's already fetched). Only fetch adapter registry entries when the mapping requires structural or behavioral guidance beyond class substitution.

## Agent Workflow for Cross-System Transfer

```
1. Fetch source tile from component registry
2. Parse metadata — read portableInvariants and classMapping
3. IF classMapping has entry for target system:
     → Simple substitution: replace classes, keep invariants
4. ELSE IF adapter registry has entry for component:
     → Fetch adapter, follow structuralMapping
     → Apply replace/add/remove operations
     → Respect semanticNotes and limitations
5. ELSE:
     → Fall back to portableInvariants only
     → Note in output: "No mapping available for {target system}"
6. Validate output against portableInvariants
```
