# Findings ledger

`{tileDir}/findings.json` is a registry's **epistemic record**: what was tested,
what broke, and what changed as a result. It is the substrate the rest of the
project's epistemic layer is built on:

- **Spec rules cite it.** A rule in `protocol.md` / `tile-format.md` /
  `deep-check.md` marked `[evidence: uswds:F-007]` is load-bearing because a
  test produced it; `[design-decision]` marks taste. `lint-spec.mjs` enforces
  that every rule-bearing bullet carries one.
- **`registry-health.json` aggregates it.** `lastDeepCheck` and the finding
  counts come from here.

A finding with `result: "clean"` is recorded exactly like a fix. A registry
that checked and found nothing has a *measurement*; a registry that never
checked has an absence. That distinction is the point.

## Entry shape

```json
{
  "id": "F-007",
  "date": "2026-09-30",
  "kind": "deep-check | sweep | upgrade | rework | observation | decision",
  "result": "broke | fixed | clean | recorded | deprecated",
  "target": ["button/ghost", "expandable"],
  "changed": [
    "spec: discovery.origin gained the 'extension' value",
    "tile: button/ghost relabeled origin: extension, tier: observed"
  ],
  "evidence": [
    "@ecl/preset-eu@5.2.0 / 5.3.1 — class absent",
    "cordis.europa.eu, data.europa.eu, digital-strategy.ec.europa.eu — class present (observed)"
  ],
  "summary": "One line, shown in aggregates and reviews.",
  "detail": "Prose for a human who was not there."
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `F-NNN`, unique within the file, stable once published — other documents cite it |
| `date` | yes | ISO `YYYY-MM-DD` |
| `kind` | yes | one of the enum above |
| `result` | yes | `broke` (something was wrong), `fixed` (corrected here), `clean` (checked, nothing wrong), `recorded` (knowledge captured, nothing changed), `deprecated` (upstream retired) |
| `target` | no | tiles, families, or surfaces affected (`["card/*"]` is fine) |
| `changed` | no | what actually changed — the reason the finding exists. Empty is suspicious: a `broke` finding with no change means it is unresolved |
| `evidence` | no | the sources that make the claim checkable (a package@version, a URL, a file in this repo) |
| `summary` | yes | one line |
| `detail` | no | prose |

## Cross-registry citation

Prefix the registry name: `ecl:F-007`. The spec never cites a bare `F-NNN`
because a spec rule is usually load-bearing across more than one registry.

## Rules

- **Every deep check writes an entry**, including a clean one. A check with no
  entry is indistinguishable from a check that never ran.
- **`broke` without a `changed` is an open item.** It is legal (a finding you
  are carrying), but it should show up in a review.
- **Entries are append-only.** A finding is a record of what was true on its
  date; superseding it means writing a new entry, not rewriting the old one.
- **The ledger never states a claim it cannot point at.** If `evidence` is
  empty and `result` is `fixed`, that is a smell.

## Related surfaces

- `registry-health.json` — machine-readable trust summary (generated)
- `versions.json` — the registry's own changelog; the ledger explains *why* a
  version entry exists
- `observations.json` (Surface 7) — the record of what the *ecosystem* does,
  as opposed to what testing found about the registry itself
