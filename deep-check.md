# Deep check — verifying a registry against its design system

A deep check asks one question: **do this registry's tiles still match the
design system they claim to mirror?** It is a periodic audit (per release, or
when a version is suspected), distinct from the *upgrade* runbook in
`protocol.md` (which assumes the pin is moving) and from the field-test
procedure a registry project may run separately (which measures assembled
pages, not tiles).

Every step below exists because it caught something real, or because skipping it
caused a wrong conclusion. The pitfalls are the point of the document.

---

## 0. Establish the ground truth first

You cannot verify against a pin you cannot read. In order of preference:

1. **An installed package** (`npm i --save-dev --no-fund <pkg>@<exact>`) —
   immutable, versioned, CI-installable. This is what USWDS, ECL and GOV.UK use.
2. **A published stylesheet with a version header** — e.g. canada.ca's
   `theme.min.css` declares `v19.6.0 - 2026-08-18` in its banner. Acceptable,
   but a snapshot, not a mechanism.
3. **A CDN** (`unpkg`, `jsdelivr`) — fine for a one-off, but pin the exact
   version in the URL. Do not use `@latest` as evidence.
4. **The live site** — last resort; a real browser may show a different page
   than a scripted fetch (and may not reach it at all).

**Then declare it.** Add the pin, the package, and a `verification` block to
`registry.config.json` (see protocol.md "Verification strategy"), and wire the
stylesheet into `staticView.css` + `staticView.classCheck`. A check that isn't
mechanized will not be repeated.

## 1. Pin exactly — and let the guards fire

`npm install` writes a **range** (`^6.5.1`). The validator rejects ranges for
ground-truth purposes; pin the exact version in `package.json`. Then run the
validator: it will report `package.json`, `versions.json` and `agents.json`
disagreements with the new pin. That is not noise — it is the mechanism working,
and on four registries the stale copy was a real finding.

## 2. Choose your axes before sweeping

Ask: does this design system ship **templates**? If yes, verify markup against
them *and* styling against the stylesheet.

- **One axis (stylesheets only)** — works when every class carries style rules.
- **Two axes (templates + stylesheets)** — required for template-based systems
  (govuk-frontend `.njk`, DSFR `.ejs`, ECL `.html.twig`).

**Pitfall — a class in the templates may have no CSS at all.** GOV.UK's
`govuk-table__head` is canonical v6 markup with zero style rules. A stylesheet
sweep reports it as undefined, and the tempting "fix" is to rewrite a correct
tile. Verify the template before correcting anything.

## 3. Sweep every tile body, scripts excluded

Hash and compare the *component layer* only. The purity baseline already
provides the right normalisation (whitespace-normalised body, script elements
excluded) — reuse that idea.

**Pitfall — prefix-matching regexes lie.** A naive check for
`.govuk-table__head(?![\w-])` rejects the real class because the CSS also
contains `.govuk-table__header`. Verify a surprising "undefined" with a raw
grep for the class before acting on it.

## 4. Classify each finding into exactly one bucket

Never let a binary pass/fail carry this decision. Every class lands in one of:

| Bucket | Test | Action |
|---|---|---|
| **Canon, styled** | in the package CSS | stamp it |
| **Canon, unstyled** | in the templates, no CSS rules | stamp it; allowlist with that reason |
| **App layer** | absent from the package; belongs to a publishing/presentation layer | `origin: live-site` + a limitations note; never a package variant |
| **Pre-migration drift** | absent from both axes | allowlist with the version it predates; rework pending |
| **Extension** | a site-local class in the design system's namespace | `observations.json` (Surface 7), never a tile |

**Pitfall — the allowlist is not a pass.** If your verification predicate
accepts allowlisted classes, you will stamp drifted tiles as verified. Test
*actual definition*; the allowlist is the drift register, not a waiver.

**Pitfall — absence from the stylesheet is not evidence of invention.** Check
the version that shipped the class before calling anything invented.

## 5. Fix only what you can cite

A fix is a cited ground-truth correction through the purity path (tile-format
"Purity"): change the body, cite the new template/package, re-run the
generator, let it re-baseline and re-stamp. **Do not** rewrite a component
from a stylesheet alone — that is inference wearing a citation. Structural
rework (a redesigned component) needs the template, and often a content
decision that is not yours to make.

## 6. Sweep the stamps, then record the event

`provenance.designSystemVersion` per tile; the aggregated worklist warning
tells you what still owes verification. Then: `versions.json` entry (with
`designSystemVersion`, `breakingChanges`, `migrationPath`), `agents.json`,
`versions.json` designSystem block, the federated `registries.json` entry, and
the registry's `AGENTS.md`.

## 7. Re-arm the machine

The check is only finished when the *next* one is cheap. Confirm:
`designSystem.package` set and exact, `staticView.css` pointing at the pinned
stylesheet, `staticView.classCheck` active with categorised reasons, and the
stamp worklist reported. Without these the next release drifts silently again —
which is the state all four registries were in before their first deep check.

---

## What each check found (evidence for why this exists)

| Registry | Finding | Bucket |
|---|---|---|
| USWDS | `versions.json` said 3.13.0 while the pin was 3.14.0 | self-disagreement |
| DSFR | 5 tiles used structure absent from 1.15 **through 1.15.3** | pre-migration drift |
| Canada | pin `"5.x"` unverifiable; `flag`, `class="footer"`, footnote demo classes in neither the pinned CSS nor the live site | invented |
| ECL | half the registry predated 5.x; `ecl-alert` → `ecl-notification` rename; `ecl-icon--error` invented | rename + invented |
| GOV.UK | pin `"5.x"`; v3-era markup; `warning-callout` duplicated by its own v4 replacement | pre-migration drift |

The common cause is not "versions change". It is that a pin was *stated* and
never checked against anything.
