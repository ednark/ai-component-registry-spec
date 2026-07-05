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

## Standard Metadata Fields

These fields are common across all registries:

| Field | Type | Description |
|-------|------|-------------|
| `file` | string | path relative to tileDir |
| `title` | string | component name + variant |
| `description` | string | one-line summary |
| `useWhen` | string[] | situations this component is a good fit |
| `avoidWhen` | string[] | situations to avoid this component |
| `agentPrompt` | string | concrete adaptation instruction |
| `editableAreas` | string[] | what you can safely change |
| `preserveElements` | string[] | what you must keep unchanged |
| `knownLimitations` | string[] | caveats and constraints |
| `tier` | string | quality tier (e.g., `curated`, `needs-review`) |
| `tags` | string[] | semantic search keywords |

## Domain-Specific Fields

Registries can add fields specific to their design system. For example, USWDS adds:

| Field | Type | Description |
|-------|------|-------------|
| `uswdsComponentType` | string | official USWDS component name |
| `uswdsClass` | string | primary CSS class |
| `section` | string | USWDS section (forms, navigation, etc.) |
| `variant` | string | variant name |
| `requiresJs` | enum | no, optional, required |
| `interaction` | string[] | passive, click, hover, keyboard, etc. |
| `a11y` | object | wcag21AA, keyboardNav, screenReader, etc. |
| `govCompliance` | string[] | Section 508, WCAG 2.1 AA, 21st Century IDEA |
| `variants` | string[] | all available variant names |
| `settings` | string[] | Sass settings that affect this component |
| `relatedComponents` | string[] | commonly paired components |
| `tokenOverrides` | string[] | design tokens commonly overridden |

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
