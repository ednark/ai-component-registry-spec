# Findings ledger

`{tileDir}/findings.json` is a registry's **epistemic record**: what was tested,
what broke, and what changed as a result. It is the substrate the rest of the
project's epistemic layer is built on:

- **Spec rules cite it.** A rule in `protocol.md` / `tile-format.md` / [design-decision]
  `deep-check.md` marked `[evidence: uswds:F-007]` is load-bearing because a
  test produced it; `[design-decision]` marks taste. `lint-spec.mjs` enforces
  that every rule-bearing bullet carries one.
- **`registry-health.json` aggregates it.** `lastDeepCheck` and the finding [design-decision]
  counts come from here.

A finding with `result: "clean"` is recorded exactly like a fix. A registry
that checked and found nothing has a *measurement*; a registry that never
checked has an absence. That distinction is the point.

## Where the ledger lives

| Scope | File | Cited as |
|---|---|---|
| One registry | `{tileDir}/findings.json` | `uswds:F-002` |
| Cross-registry | `ai-component-registry-spec/findings.json` (the spec repo root) | `spec:F-007` |

A lesson that applies to every registry — the coverage mechanism, the class
discipline, the composition finding — belongs in the spec ledger, not
duplicated into five registries. A finding that is *about* one registry's
tiles belongs in that registry.

## For the agent maintaining a registry

This is the highest-leverage file in the repository, and the reason is
negative: **it records the fixes, so they do not get undone.**

Before changing a tile, read the ledger. Each entry's `changed` array names
files and decisions that already exist for a reason. The specific ways a
well-meaning agent breaks a registry here, all of them recorded:

| Tempting "fix" | What the ledger says |
|---|---|
| Add `fr-card__link` back (it looks missing) | pre-1.15 drift, not a gap — `dsfr:F-002` |
| Remove an allowlisted class as dead code | it may be canonical markup the stylesheet simply doesn't style — `uswds:F-008`, `govuk:F-001` |
| Correct the DSFR `download` tile against the current component | the component is deprecated upstream; there is nothing to correct against — `dsfr:F-004` |
| Delete `ecl-button--ghost` as invalid | a community extension in production on three sites; it is `origin: extension` — `ecl:F-003` |
| Relabel an extension tile as canon | it is not in any release; that is the point of the label — `ecl:F-003` |
| Add `govuk-button--disabled` (v6 must need it) | v6 uses the native attribute; the class is pre-v4 drift — `govuk:F-002` |
| "Improve" `constraint` metadata to prescribe design | metadata coordinates implementation; it does not design pages — `spec:F-005` |
| Rework the header into `<header role="banner">` | GOV.UK ships the header as a `div`; the landmark is the page template's job — `govuk:F-002` |

The failure this prevents is not carelessness. It is an agent that reads a
drift register, does not know it is a register, and "fixes" it — which is
exactly what happened twice during the 2026-09 deep checks, in both
directions (an invented class accepted as real, and a canonical class treated
as drift).

## A finding is complete when it is closed

`result` distinguishes the states:

- `broke` — something was wrong. If `changed` is empty it is an **open item**. [design-decision]
- `fixed` — corrected here, and (ideally) re-measured. The ledger's best
  entries are closed loops: L11 was found in `t5-001`, fixed with a
  `selection.guidance` flag, and **re-measured resolved** in `t5-002`
  (`uswds:F-011`). [evidence: uswds:F-011, uswds:F-012]
- `clean` — checked, nothing wrong. A measurement, not an absence. [design-decision]
- `recorded` — knowledge captured; nothing needed changing. [design-decision]
- `deprecated` — the thing this was about is gone upstream. [design-decision]

```json
{
  "id": "F-007",
  "date": "2026-09-30",
  "kind": "deep-check | sweep | test | upgrade | rework | observation | decision",
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
  entry is indistinguishable from a check that never ran. [evidence: uswds:F-009]
- **`broke` without a `changed` is an open item.** It is legal (a finding you
  are carrying), but it should show up in a review. [evidence: uswds:F-009]
- **Entries are append-only.** A finding is a record of what was true on its
  date; superseding it means writing a new entry, not rewriting the old one. [evidence: uswds:F-009]
- **The ledger never states a claim it cannot point at.** If `evidence` is [design-decision]
  empty and `result` is `fixed`, that is a smell.

## Related surfaces

- `registry-health.json` — machine-readable trust summary (generated) [design-decision]
- `versions.json` — the registry's own changelog; the ledger explains *why* a [design-decision]
  version entry exists
- `observations.json` (Surface 7) — the record of what the *ecosystem* does, [design-decision]
  as opposed to what testing found about the registry itself
