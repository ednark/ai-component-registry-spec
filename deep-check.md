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

## Why the mechanical parts are limited

Three attempts to *infer* correctness from design-system sources failed the same
way. They are recorded here because the temptation recurs every time a new gate
is proposed.

| Attempt | Assumption | Why it failed |
|---|---|---|
| Element contracts from demo templates | a class's legal element set is what the demos show | a demo exercises ONE element per class, so legal alternatives look like violations |
| Element contracts from CSS/JS selectors | tag-qualified selectors are the contract | excluding templates discarded real evidence, and prefix-resolved constants materialise only after substitution |
| Variant names from class existence | a variants list holds modifier classes | it holds *family/sibling* variant names, producing over a hundred false positives |

The recurring failure: **inferring a schema from a few examples and asserting it
across every tile.** Registry metadata conventions are emergent and per-tile. A
gate needs a maintainer statement of what a field means before it can check it.
So: audit one component at a time, record verified facts, and mechanise only
what a declaration makes checkable.

A fourth failure is worth naming because it looks like success: **a gate that
returns zero findings is indistinguishable from a gate that is broken.** One
ownership check passed silently because a regex without a capture group had
emptied the lookup map. Validate every new check with a positive control — a
case you know must fail — before trusting a clean run.

---

## 0. Establish the ground truth first

You cannot verify against a pin you cannot read. In order of preference:

1. **An installed package** (`npm i --save-dev --no-fund <pkg>@<exact>`) — [design-decision]
   immutable, versioned, CI-installable. This is what USWDS, ECL and GOV.UK use.
2. **A published stylesheet with a version header** — e.g. canada.ca's [design-decision]
   `theme.min.css` declares `v19.6.0 - 2026-08-18` in its banner. Acceptable,
   but a snapshot, not a mechanism.
3. **A CDN** (`unpkg`, `jsdelivr`) — fine for a one-off, but pin the exact [design-decision]
   version in the URL. Do not use `@latest` as evidence.
4. **The live site** — last resort; a real browser may show a different page [design-decision]
   than a scripted fetch (and may not reach it at all).

**Then declare it.** Add the pin, the package, and a `verification` block to
`registry.config.json` (see protocol.md "Verification strategy"), and wire the
stylesheet into `staticView.css` + `staticView.classCheck`. A check that isn't
mechanized will not be repeated.

### Evidence hierarchy

Sources disagree. Resolve by the highest tier that can support the claim, and
record the tier rather than just the fact.

| Tier | Source | Authoritative for |
|---|---|---|
| 5 | Observed behaviour on an installed site | "it actually works" — render, JS init, interaction |
| 4 | Design-system source (pinned package: templates, JS, CSS) | what the code does; the only ground truth for what renders |
| 3 | Maintainer guidance (issue queue, changelog, release notes) | intended usage, deprecations, known limitations |
| 2 | Project registry (e.g. drupal.org) | existence, supported versions, maintenance, security advisories |
| 1 | Documentation and **live examples** | the documented pattern and canonical structure |

**Live examples are a distinct, high-value source.** A docs page renders real
markup for every variant in one place — often clearer than templates, which wrap
classes in macros and loops. Extract them and diff structurally.

**Pitfall — a docs page may not inline its markup.** Some components publish
screenshots and iframe links instead (headers and footers commonly do). When
that happens the pinned template is the only ground truth, and the check is
weaker: say so rather than implying the live tier was consulted.

**Pitfall — never grep class names in a markdown-rendered docs page.** Markdown
drops HTML `class` attributes, so the search returns nothing and a documented
class looks invented. Always fetch raw HTML and grep the source. Absence of
evidence from a lossy rendering is not evidence of absence — and when a check
says a documented thing does not exist, suspect the check.

**Version drift caveat:** note the version the live site reflects. When it and
the pin disagree, prefer the pinned package (tier 4) and record the divergence.

## 1. Pin exactly — and let the guards fire

`npm install` writes a **range** (`^6.5.1`). The validator rejects ranges for
ground-truth purposes; pin the exact version in `package.json`. Then run the
validator: it will report `package.json`, `versions.json` and `agents.json`
disagreements with the new pin. That is not noise — it is the mechanism working,
and on four registries the stale copy was a real finding.

## 2. Choose your axes before sweeping

Ask: does this design system ship **templates**? If yes, verify markup against
them *and* styling against the stylesheet. [evidence: spec:F-004, uswds:F-008]

- **One axis (stylesheets only)** — works when every class carries style rules. [design-decision]
- **Two axes (templates + stylesheets)** — required for template-based systems [design-decision]
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

Never let a binary pass/fail carry this decision. Every class lands in one of: [design-decision]

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

### The four blind spots

A class-existence gate validates classes that are *present*. Four failure modes
are structurally invisible to it, and each needs a different answer.

| Blind spot | Example shape | Answer |
|---|---|---|
| **Absent class** | the tile claims a component class its body never applies | compare the tile's declared class to its own body |
| **Unprefixed custom class** | a site-local wrapper the design system does not ship | class provenance: design-system, utility, declared scaffolding, or documented |
| **Tile name encoding an invented variant** | a filename implying a modifier that does not exist | curate the documented variant list; do not infer it |
| **Real class, wrong component** | a class from a sibling component used as if it belonged here | **not mechanisable** — composition and misuse look identical from outside |

The last one is the important admission. A layout legitimately contains a
navigation component; a navigation tile using a different component's classes
does not. Only intent distinguishes them, and intent is not in the markup.
Audit it by hand or not at all.

### Which layer owns the contract

Before calling any structural difference a defect, establish whether the
**stylesheet** or the **component JS** owns it. The two produce opposite correct
answers:

- A component whose JS **relocates** its root class to a created wrapper at init
  must be authored in that post-init state — the stylesheet targets the wrapper,
  and moving the class back renders it unstyled.
- A component whose JS **initialises from** the authored class must not be
  authored in its post-init state — the selector never matches and the component
  is inert.

Record which applies in `provenance.contractLayer` (`js` / `css` / `both` /
`neither`) with a `contractNote`. This is the cheapest guard against a reviewer
"fixing" correct markup, and it is a fact the audit establishes anyway.

## 5. Fix only what you can cite

A fix is a cited ground-truth correction through the purity path (tile-format
"Purity"): change the body, cite the new template/package, re-run the
generator, let it re-baseline and re-stamp. **Do not** rewrite a component
from a stylesheet alone — that is inference wearing a citation. Structural
rework (a redesigned component) needs the template, and often a content
decision that is not yours to make.

## 6. Edit discipline

Tile metadata is JSON inside HTML, and it is easy to corrupt. Rules learned by
breaking it:

1. **Never put a raw `"` inside a JSON string value.** Escape it, or write the
   citation without quotes. This is the single most common corruption.
2. **Parse the metadata block after every write.** The validator will catch it;
   catching it yourself is faster and keeps the tree clean.
3. **Prefer whole-file writes or programmatic JSON manipulation** over regex
   insertion into structured blocks.
4. **Back up configuration** (`registry.config.json`, `agents.json`) before
   editing, and keep backups outside the repo — a `git add -A` will otherwise
   commit them.
5. **Gate the commit on the validator, not on a pipeline.** `cmd | tail -1`
   returns `tail`'s exit code, so `&&` chains sail past a failing validator.
   Capture the output and check it explicitly.

## 7. Sweep the stamps, then record the event

`provenance.designSystemVersion` per tile; the aggregated worklist warning
tells you what still owes verification. Then: `versions.json` entry (with
`designSystemVersion`, `breakingChanges`, `migrationPath`), `agents.json`,
`versions.json` designSystem block, the federated `registries.json` entry, and
the registry's `AGENTS.md`.

## 8. Re-arm the machine

The check is only finished when the *next* one is cheap. Confirm:
`designSystem.package` set and exact, `staticView.css` pointing at the pinned
stylesheet, `staticView.classCheck` active with categorised reasons, and the
stamp worklist reported. Without these the next release drifts silently again —
which is the state all four registries were in before their first deep check.

## 9. Know what is automated and what is not

Mechanical checks catch class-name errors. Everything structural — missing
wrappers, wrong elements, absent classes, inert JavaScript — has so far come
from reading against source. Keep the division honest when reporting.

| Automated | Manual |
|---|---|
| class existence (stylesheet + package harvest) | element order and nesting |
| preserve-list citations | structural wrappers |
| prose class citations | absent classes (unless the registry opts in) |
| behaviour-selector resolution | tile names |
| ARIA/id cross-references | wrong-component usage |
| repo-level JSON citations | contract layer |
| design-token citations | prose claims about policy or behaviour |
| curated element contracts (declared) | |
| class provenance (declared scaffolding) | |

## 10. Definition of done

- [ ] All ground-truth sources gathered, including live examples where they exist
- [ ] Elements, classes, and nesting compared; deviations classified
- [ ] Every class accounted for — design-system, utility, scaffolding, or documented
- [ ] Every divergence either fixed (cited) or labeled with its origin
- [ ] Contract layer recorded where the structure is non-obvious
- [ ] Metadata keys reviewed for usefulness; duplicates noted
- [ ] Validators: 0 errors
- [ ] Resolved views regenerated; `versions.json` entry written
- [ ] Findings recorded in the ledger with the evidence chain

**Report honestly.** If a finding is unproven, say so. A wrong "confirmed defect"
costs more than an admitted unknown, because it teaches the next reviewer to
distrust the whole register.

---

## What each check found (evidence for why this exists)

| Registry | Finding | Bucket |
|---|---|---|
| USWDS | `versions.json` said 3.13.0 while the pin was 3.14.0 | self-disagreement |
| DSFR | 5 tiles used structure absent from 1.15 **through 1.15.3** | pre-migration drift |
| Canada | pin `"5.x"` unverifiable; `flag`, `class="footer"`, footnote demo classes in neither the pinned CSS nor the live site | invented |
| ECL | half the registry predated 5.x; `ecl-alert` → `ecl-notification` rename; `ecl-icon--error` invented | rename + invented |
| GOV.UK | pin `"5.x"`; v3-era markup; `warning-callout` duplicated by its own v4 replacement | pre-migration drift |
| USWDS | a documented modifier class was deleted as "non-canon" because the check had grepped a markdown rendering of the docs page | false negative in the check |
| USWDS | a component whose JS relocates its root class to a wrapper was flagged as wrong; the tile was correct | contract layer (css) |
| USWDS | a heading level the component JS explicitly preserves was flagged as a deviation; it was supported | contract layer (js) |
| USWDS | a component authored in its post-init state was inert because the JS initialises from the authored class | contract layer (js) |
| USWDS | 18 tiles declared a `uswdsClass` their body never applied | absent / unclaimed |
| USWDS | a tile named for a size variant never applied the modifier | absent class |
| USWDS | 9 tiles claimed variants the design system does not ship | invented variant |
| USWDS | 3 tiles asserted JavaScript requirements that the package does not have (two ship no JS at all) | false claim |

The common cause is not "versions change". It is that a pin was *stated* and
never checked against anything. [design-decision]
