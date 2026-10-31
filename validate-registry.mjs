#!/usr/bin/env node
/**
 * AI Component Registry — Registry Validator
 *
 * Lints any registry that follows the ai-component-registry-spec:
 *   - registry.config.json required fields
 *   - tile agent-meta blocks parse as JSON
 *   - required metadata presence (warning-level unless the registry declares it)
 *   - dangling references (relatedComponents, coordination, recipes, patterns)
 *   - recipe component files exist
 *   - pattern files: citations required, task-to-component-set only (Surface 6)
 *   - tile tradeoffs.sacrifices carry reasons (deliberate design, not defects)
 *   - doctrine-backed gaps carry consequence + source
 *   - index freshness + facet coverage
 *   - index size budget (leanness rule)
 *
 * Usage:
 *   node _base/validate-registry.mjs                    # validate cwd registry
 *   node _base/validate-registry.mjs /path/to/registry  # validate another registry
 *   node _base/validate-registry.mjs --conformance /path/to/registry
 *       # run only the 5-step conformance flow (facets -> index -> filter ->
 *       # tile -> meta parse), for cross-registry spec-generality checks
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFORMANCE_ONLY = process.argv.includes('--conformance');
const argPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
const ROOT = argPath ? resolve(argPath) : process.cwd();

const errors = [];
const warnings = [];
const error = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// --- 1. Config ---

const configPath = join(ROOT, 'registry.config.json');
let config;
if (!existsSync(configPath)) {
  console.error(`✗ No registry.config.json at ${configPath}`);
  process.exit(1);
}
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (e) {
  console.error(`✗ registry.config.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

const REQUIRED_CONFIG = ['name', 'description', 'agentMetaId', 'tileDir', 'facets', 'indexSchemaVersion', 'repo', 'base'];
for (const field of REQUIRED_CONFIG) {
  if (config[field] === undefined) error(`registry.config.json missing required field: ${field}`);
}

const { agentMetaId, tileDir = 'infinite', facets = [], additionalFields = [] } = config;
const TILE_DIR = join(ROOT, tileDir);

// --- 1b. Class ground truth (optional, config-driven) ---
// staticView.classCheck: every tile-DOM class with `prefix` must be defined by
// the design-system stylesheet (staticView.css) or explicitly allowlisted with
// a reason (JS mounts, documented no-ops, registry demo classes). Catches
// hallucinated design-system classes at the source (field-test L9 asymmetry).
const classCheck = config.staticView?.classCheck ?? null;
let definedClasses = null;
const classAllow = new Map(
  (classCheck?.allowlist ?? []).map((a) => [typeof a === 'string' ? a : a.class, typeof a === 'string' ? 'allowlisted' : (a.reason ?? 'allowlisted')])
);
if (classCheck) {
  let cssText = '';
  let cssMissing = false;
  for (const p of config.staticView?.css ?? []) {
    try {
      cssText += readFileSync(join(ROOT, p), 'utf-8');
    } catch {
      warn(`staticView.css entry not found: ${p} — class ground-truth check skipped`);
      cssMissing = true;
    }
  }
  if (!cssMissing) {
    if (!cssText.trim()) warn('staticView.classCheck declared but staticView.css is empty — class ground-truth check skipped');
    else definedClasses = new Set([...cssText.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
  }
}
const CLASS_PREFIXES = (() => {
  const p = classCheck?.prefix ?? ['usa-'];
  return Array.isArray(p) ? p : [p]; // string form still accepted
})();

/**
 * Extract (tag, classes) for every opening tag carrying a class attribute.
 * Shared by the class-existence gate, the preserve/prose lint, the behavior
 * selector checks and the ARIA cross-reference check, so all of them agree on
 * what "applied markup" is (scripts/styles excluded by the caller).
 */
function tokenizeMarkup(html) {
  const out = [];
  const re = /<([a-zA-Z][\w-]*)\s([^>]*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    if (/^\/\s*$/.test(attrs)) continue;
    const cm = attrs.match(/class\s*=\s*"([^"]*)"/);
    if (!cm) continue;
    const classes = cm[1].split(/\s+/).filter(Boolean);
    if (classes.length) out.push({ tag, classes });
  }
  return out;
}

// tagContract: class -> Set(tag), harvested from the package's own templates.
const tagContract = new Map();

// Enrich ground truth from the design-system package itself when one is
// installed: behavior hooks and JS mounts (e.g. usa-character-count__field)
// are official markup with no stylesheet rule of their own. Ported from the
// class-harvest reference implementation (registry-change-plan.md §D).
if (classCheck?.package && definedClasses) {
  const pkgDir = join(ROOT, classCheck.package);
  if (!existsSync(pkgDir)) {
    warn(`staticView.classCheck.package not found at ${classCheck.package} — package harvest skipped`);
  } else {
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const walk = (dir, exts, out = []) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, exts, out);
        else if (exts.some((e) => name.endsWith(e))) out.push(full);
      }
      return out;
    };
    const prefRe = new RegExp(`^(${CLASS_PREFIXES.map(escapeRe).join('|')})`);
    for (const file of walk(pkgDir, ['.twig', '.js', '.css'])) {
      let source = readFileSync(file, 'utf-8');
      // Resolve class-name constants, e.g. `const CHARACTER_COUNT_CLASS = \`usa-character-count\`;`
      // — replace ${PREFIX} FIRST so `${PREFIX}-led` constants resolve too,
      // and run two passes for chained constants (${A} inside ${B}'s value).
      source = source.replaceAll('${PREFIX}', CLASS_PREFIXES[0].replace(/-$/, ''));
      for (let pass = 0; pass < 2; pass++) {
        const constRe = new RegExp(`const (\\w+) = \\\`(${CLASS_PREFIXES.map(escapeRe).join('|')}[\\w-]+)\\\`;`, 'g');
        for (const [, name, value] of source.matchAll(constRe)) {
          source = source.replaceAll(`\${${name}}`, value);
        }
      }
      for (const [, value] of source.matchAll(/class="([^"]*)"/g)) {
        value.split(/\s+/).filter((cls) => /^[\w:-]+$/.test(cls)).forEach((cls) => definedClasses.add(cls));
      }
      // Record ELEMENT contracts, but only where the evidence is hard (§D,
      // narrowed): the tag must DIRECTLY qualify the class in a design-system
      // CSS or JS selector (`button.usa-accordion__button[aria-controls]`),
      // not merely co-occur in a template.
      //
      // Twig demo markup is deliberately excluded here. A template shows one
      // authored state, and component JS may move the class afterwards —
      // usa-file-input is authored on the <input> but the JS removes it there
      // and adds it to a created parent wrapper, which is the only structure
      // the stylesheet targets (`.usa-file-input .usa-file-input__input`).
      // Harvesting demo markup therefore flags *correct* tiles as broken.
      if (config.staticView?.structure === true && /\.(js|css)$/.test(file)) {
        const tagSel = new RegExp(
          `\\b(button|input|select|textarea|ul|ol|li|nav|header|footer|section|table|legend|label|a)\\.((?:${CLASS_PREFIXES.map(escapeRe).join('|')})[\\w-]*)`,
          'g'
        );
        for (const [, tag, cls] of source.matchAll(tagSel)) {
          if (!tagContract.has(cls)) tagContract.set(cls, new Set());
          tagContract.get(cls).add(tag.toLowerCase());
        }
      }
      // Class-name literals in templates and component JS: any prefixed token
      // in package source IS official markup, even if the stylesheet never
      // styles it.
      for (const p of CLASS_PREFIXES) {
        const litRe = new RegExp(escapeRe(p) + '[\\w-]+', 'g');
        for (const [cls] of source.matchAll(litRe)) definedClasses.add(cls);
      }
    }
  }
}

// What the registry *declares* governs which metadata checks are hard errors.
const declares = {
  coordination: additionalFields.includes('coordination') || facets.some((f) => ['costTier', 'prerequisites'].includes(f)),
  compliance: facets.includes('fedRampLevel') || (additionalFields || []).includes('compliance'),
  mobileUX: facets.includes('touchTargetSize') || (additionalFields || []).includes('mobileUX'),
  recipes: facets.includes('compositionRecipes') || existsSync(join(TILE_DIR, 'recipes')),
};

// --- 2. Tiles ---

function findHtmlFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    const stat = statSync(full);
    if (stat.isDirectory()) findHtmlFiles(full, files);
    else if (item.endsWith('.html') && !item.endsWith('.resolved.html')) files.push(full);
  }
  return files;
}

const tileFiles = findHtmlFiles(TILE_DIR);
const componentDirs = new Set(
  tileFiles.map((f) => f.replace(TILE_DIR + '/', '').split('/')[0])
);
const metaById = new Map();

for (const file of tileFiles) {
  const relPath = file.replace(TILE_DIR + '/', '');
  const html = readFileSync(file, 'utf-8');
  const re = new RegExp(`<script[^>]*id="${agentMetaId}"[^>]*>([\\s\\S]*?)</script>`, 'i');
  const match = html.match(re);
  if (!match) {
    error(`${relPath}: missing ${agentMetaId} metadata block`);
    continue;
  }
  let meta;
  try {
    meta = JSON.parse(match[1]);
  } catch (e) {
    error(`${relPath}: ${agentMetaId} block is not valid JSON: ${e.message}`);
    continue;
  }

  metaById.set(relPath, meta);

  // Shared per-tile DOM projection (scripts/styles excluded; code/pre are
  // documentation, not live markup) — used by the class gate, behavior
  // selectors, and ARIA cross-references.
  const domHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(code|pre)[\s\S]*?<\/\1>/gi, '');
  const domClasses = new Set();
  for (const m of domHtml.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && domClasses.add(c));
  const domIds = new Set();
  for (const m of domHtml.matchAll(/\sid="([^"]+)"/g)) domIds.add(m[1]);

  // Class ground truth: DOM classes must exist in the design-system stylesheet.
  if (definedClasses) {
    const domOnly = domHtml;
    const used = new Set();
    for (const m of domOnly.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) {
        if (CLASS_PREFIXES.some((p) => c.startsWith(p))) used.add(c);
      }
    }
    for (const c of used) {
      if (definedClasses.has(c) || classAllow.has(c)) continue;
      error(`${relPath}: class "${c}" is not defined by the design-system stylesheet (staticView.css) and not allowlisted — ${classAllow.get(c) ?? 'hallucinated design-system class'}`);
    }

    // Preserve-list lint: classes named in constraints.preserve must exist in
    // ground truth too — preserve lists are how invented classes propagate
    // from tile to tile (registry-change-plan.md §D). Entries that explicitly
    // negate a class ("X is not a USWDS class; …") are negative guidance, not
    // preserve instructions, and are skipped.
    const NEGATIVE_ENTRY = /\b(?:is|are)\s+not\b/i;
    const preserveStrings = meta.constraints?.preserve || [];
    const preserveClasses = new Set();
    for (const s of Array.isArray(preserveStrings) ? preserveStrings : []) {
      if (NEGATIVE_ENTRY.test(String(s))) continue;
      for (const tok of String(s).matchAll(/[A-Za-z][\w:-]*/g)) {
        const c = tok[0];
        if (CLASS_PREFIXES.some((p) => c.startsWith(p))) preserveClasses.add(c);
      }
    }
    for (const c of preserveClasses) {
      if (definedClasses.has(c) || classAllow.has(c)) continue;
      error(`${relPath}: constraints.preserve names class "${c}" which is not defined by the design system and not allowlisted — preserve lists must only cite real classes`);
    }

    // Prose class citations (§D): agentPrompt, editable, guidance, useWhen/
    // avoidWhen, and variants are the remaining hallucination surface —
    // metadata strings must only cite real classes. String-level negation
    // skip: entries that explicitly negate a class ("X is not a USWDS
    // class", "do not invent", "removed") are negative guidance. Whole-string
    // skip is conservative — it trades some coverage for zero false
    // positives on mixed sentences with abbreviations ("e.g.").
    const NEG_SEGMENT = /\b(?:is|are)\s+not\b|\bdo(?:es)?\s+not\b|\bdon'?t\b|\bnever\b|\bremoved\b|\bnot\s+canonical?\b|\bnot\s+(?:a\s+)?real\b|\bnot\s+in\b|\bhas\s+no\b|\bno\s+[\w.-]+\s+class\b/i;
    const proseSegments = [];
    const pushProse = (v) => {
      if (typeof v === 'string') proseSegments.push(v);
      else if (v && typeof v === 'object' && typeof v.description === 'string') proseSegments.push(v.description);
    };
    pushProse(meta.instruction?.agentPrompt);
    (Array.isArray(meta.instruction?.variants) ? meta.instruction.variants : []).forEach(pushProse);
    (Array.isArray(meta.constraints?.editable) ? meta.constraints.editable : []).forEach(pushProse);
    (Array.isArray(meta.constraints?.limitations) ? meta.constraints.limitations : []).forEach(pushProse);
    (Array.isArray(meta.selection?.useWhen) ? meta.selection.useWhen : []).forEach(pushProse);
    (Array.isArray(meta.selection?.avoidWhen) ? meta.selection.avoidWhen : []).forEach(pushProse);
    (Array.isArray(meta.selection?.guidance) ? meta.selection.guidance : []).forEach(pushProse);
    (Array.isArray(meta.coordination?.agentPromptSequence) ? meta.coordination.agentPromptSequence : []).forEach(pushProse);
    const proseTokens = new Set();
    for (const s of proseSegments) {
      if (NEG_SEGMENT.test(s)) continue;
      for (const tok of s.matchAll(/[A-Za-z][\w:-]*/g)) {
        const c = tok[0].replace(/-+$/, '');
        if (c.length > 3 && CLASS_PREFIXES.some((p) => c.startsWith(p))) proseTokens.add(c);
      }
    }
    for (const c of proseTokens) {
      if (definedClasses.has(c) || classAllow.has(c)) continue;
      error(`${relPath}: prose cites class "${c}" which is not defined by the design system and not allowlisted`);
    }

    // Tag contracts (§D): design-system CSS and JS frequently depend on the
    // ELEMENT a class sits on, not just the class name — e.g. USWDS selects
    // `button.usa-accordion__button[aria-controls]`, so the class on a `<p>`
    // silently produces an inert toggle (the banner/default defect class).
    // A mismatch may also be a legitimate semantic choice, and the demo
    // templates under-determine the legal tag set (they show one usage each) —
    // so this is warning-level: triage, then fix the tile or record the
    // divergence in `provenance`.
    for (const { tag, classes } of tokenizeMarkup(domHtml)) {
      for (const c of classes) {
        const allowed = tagContract.get(c);
        if (!allowed || allowed.has(tag)) continue;
        warn(`${relPath}: class "${c}" is applied to <${tag}>, but the design system uses it on <${[...allowed].sort().join(' | ')}> — verify the element, or record the divergence in provenance`);
      }
    }
  }

  // Resolved-view staleness guard: when a registry declares staticView, every
  // tile must have its generated companion, and it must match the tile's
  // current source hash (mtime comparison is unreliable across git clones).
  if (config.staticView) {
    const resolvedPath = file.replace(/\.html$/, '.resolved.html');
    if (!existsSync(resolvedPath)) {
      warn(`${relPath}: resolved view missing (${relPath.replace(/\.html$/, '.resolved.html')}) — run _base/generate-resolved-view.mjs`);
    } else {
      const stamp = readFileSync(resolvedPath, 'utf-8').match(/resolved-from: sha256:([a-f0-9]{64})/);
      if (!stamp) {
        warn(`${relPath}: resolved view has no source hash stamp — regenerate with _base/generate-resolved-view.mjs`);
      } else if (stamp[1] !== createHash('sha256').update(html).digest('hex')) {
        warn(`${relPath}: resolved view is stale (tile changed since generation) — regenerate`);
      }
    }
  }

  // file convention varies by registry: tileDir-relative (USWDS) or
  // registry-root-relative (forever). Accept either; only mismatch = error.
  const fileMatches =
    meta.file === relPath || meta.file === `${tileDir}/${relPath}`;
  if (meta.file !== undefined && !fileMatches) error(`${relPath}: meta.file is "${meta.file}" (mismatch)`);
  if (meta.file === undefined) warn(`${relPath}: missing meta.file`);
  if (!meta.title) error(`${relPath}: missing title`);

  const version = meta._schemaVersion || 1;
  if (CONFORMANCE_ONLY) continue;

  if (version >= 2) {
    for (const cat of ['discovery', 'selection', 'instruction', 'constraints']) {
      if (!meta[cat]) warn(`${relPath}: schema v2 but missing category "${cat}"`);
    }
  }

  // discovery.origin — canon vs observed variant vs community extension
  // labeling (tile-format.md "Tile Purity"). The provenance pair must be
  // consistent: a live-site-observed body is ground truth for a variant, and
  // agents must be able to filter all three categories in code.
  {
    const provMethod = meta.provenance?.method;
    const origin = meta.discovery?.origin;
    if (origin !== undefined && !['design-system', 'live-site', 'extension'].includes(origin)) {
      error(`${relPath}: discovery.origin must be "design-system", "live-site" or "extension"`);
    }
    if (provMethod === 'live-site observation' && !['live-site', 'extension'].includes(origin)) {
      error(`${relPath}: provenance.method "live-site observation" requires discovery.origin "live-site" (an observed variant) or "extension" (a class the design system does not ship) — observed classes must be labeled as non-canon`);
    }
    if (origin === 'live-site' && provMethod !== 'live-site observation') {
      error(`${relPath}: discovery.origin "live-site" requires provenance.method "live-site observation" citing the observed source`);
    }
  }

  // provenance.tier — authoritative-source hierarchy (design-system-source >
  // design-system-docs > maintainer-guidance > observed-behavior). Optional;
  // when present it must be a real tier and must agree with provenance.method.
  {
    const TIER_VALUES = ['design-system-source', 'design-system-docs', 'maintainer-guidance', 'observed-behavior'];
    const prov = meta.provenance || {};
    const tier = prov.tier;
    if (tier !== undefined && !TIER_VALUES.includes(tier)) {
      error(`${relPath}: provenance.tier must be one of ${TIER_VALUES.join(' | ')}`);
    }
    if (tier === 'observed-behavior' && prov.method !== 'live-site observation') {
      error(`${relPath}: provenance.tier "observed-behavior" requires provenance.method "live-site observation"`);
    }
    if (prov.method === 'live-site observation' && tier !== undefined && tier !== 'observed-behavior') {
      error(`${relPath}: provenance.method "live-site observation" requires provenance.tier "observed-behavior"`);
    }
    if (prov.method === 'design-system documentation' && tier !== undefined && !['design-system-source', 'design-system-docs'].includes(tier)) {
      error(`${relPath}: provenance.method "design-system documentation" requires provenance.tier "design-system-source" or "design-system-docs"`);
    }
    if (prov.method === 'coverage audit' && tier !== undefined && tier !== 'design-system-docs') {
      error(`${relPath}: provenance.method "coverage audit" requires provenance.tier "design-system-docs"`);
    }
  }

  // ARIA/id cross-references: a reference the tile itself does not satisfy is
  // an a11y defect and a classic hallucination artifact (fabricated ids).
  for (const m of domHtml.matchAll(/aria-(controls|describedby|labelledby|owns)="([^"]+)"/g)) {
    for (const id of m[2].split(/\s+/)) {
      if (id && !domIds.has(id)) error(`${relPath}: aria-${m[1]}="${id}" references an id the tile does not define`);
    }
  }
  for (const m of domHtml.matchAll(/\sfor="([^"]+)"/g)) {
    if (m[1] && !domIds.has(m[1])) error(`${relPath}: label for="${m[1]}" references an id the tile does not define`);
  }

  // requiresJs ↔ limitations honesty (heuristic, warning-level): a tile
  // claiming no JS whose limitations say a behavior requires JavaScript may be
  // self-contradictory (the banner/default defect class) — or may be honestly
  // noting that an additional behavior (e.g. table sorting) needs script.
  // Surfaced as a worklist warning; the provable contradiction (behavior
  // contract vs requiresJs) is enforced above as an error.
  {
    const tileRequires = meta.discovery?.requiresJs ?? meta.requiresJs;
    const lims = meta.constraints?.limitations || meta.constraints?.knownLimitations || [];
    const claimsJs = lims.some((l) => /\b(?:requires?|needs?)\s+(?:javascript|js)\b/i.test(String(l)));
    if (tileRequires === 'no' && claimsJs) {
      warn(`${relPath}: requiresJs "no" but limitations state a behavior requires JavaScript — verify the JS claim refers to additional behavior, not this tile's own contract (banner/default defect class)`);
    }
  }

  // selection.guidance — machine-readable do/don't pairs (schema v2, additive).
  if (meta.selection?.guidance !== undefined) {    if (!Array.isArray(meta.selection.guidance)) {
      error(`${relPath}: selection.guidance must be an array`);
    } else {
      meta.selection.guidance.forEach((g, i) => {
        if (typeof g !== 'object' || g === null || Array.isArray(g)) {
          error(`${relPath}: selection.guidance[${i}] must be an object`);
        } else {
          if (typeof g.guidance !== 'boolean') error(`${relPath}: selection.guidance[${i}].guidance must be boolean (true=do, false=don't)`);
          if (typeof g.description !== 'string' || !g.description.trim()) error(`${relPath}: selection.guidance[${i}].description must be a non-empty string`);
        }
      });
    }
  }

  // customization.ladder — declared override surface (proposal, additive).
  // Layers mirror tile-format.md "Override Ladder"; rungs defer to constraints.
  if (meta.customization !== undefined) {
    const c = meta.customization;
    if (!Array.isArray(c.ladder)) {
      error(`${relPath}: customization.ladder must be an array`);
    } else {
      const LAYERS = ['variant-class', 'css-var', 'inline-style', 'core-class', 'fork'];
      const rungs = new Set();
      c.ladder.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') {
          error(`${relPath}: customization.ladder[${i}] must be an object`);
          return;
        }
        if (!Number.isInteger(entry.rung) || entry.rung < 1) {
          error(`${relPath}: customization.ladder[${i}].rung must be a positive integer`);
        } else if (rungs.has(entry.rung)) {
          error(`${relPath}: customization.ladder duplicate rung ${entry.rung}`);
        } else {
          rungs.add(entry.rung);
        }
        if (!LAYERS.includes(entry.layer)) {
          error(`${relPath}: customization.ladder[${i}].layer must be one of: ${LAYERS.join(', ')}`);
        }
        if (entry.layer === 'variant-class' && !Array.isArray(entry.options)) {
          warn(`${relPath}: customization rung ${entry.rung} (variant-class) should enumerate legal options`);
        }
        if (entry.layer === 'core-class' && !entry.source) {
          warn(`${relPath}: customization rung ${entry.rung} (core-class) should name its manifest via "source"`);
        }
        if (entry.layer === 'fork' && entry.free !== false && !entry.rule) {
          warn(`${relPath}: customization rung ${entry.rung} (fork) should be gated — set free:false and a rule`);
        }
      });
    }
    if (!Array.isArray(c.verificationAfter) || c.verificationAfter.length === 0) {
      warn(`${relPath}: customization.verificationAfter missing — every rung should name its re-checks`);
    }
  }

  // tradeoffs.sacrifices — deliberate design recorded as data (tile-format.md
  // "Trade-off Fields"). An omission without a stated reason is a gap, not a
  // trade-off: agents that read an undocumented sacrifice "fix" deliberate
  // design or substitute another component (field-test L7 mistranslation class).
  if (meta.tradeoffs !== undefined) {
    const t = meta.tradeoffs;
    if (!Array.isArray(t.sacrifices)) {
      error(`${relPath}: tradeoffs.sacrifices must be an array`);
    } else {
      t.sacrifices.forEach((s, i) => {
        if (!s || typeof s !== 'object' || Array.isArray(s)) {
          error(`${relPath}: tradeoffs.sacrifices[${i}] must be an object`);
          return;
        }
        if (typeof s.capability !== 'string' || !s.capability.trim()) {
          error(`${relPath}: tradeoffs.sacrifices[${i}].capability must be a non-empty string`);
        }
        if (typeof s.because !== 'string' || !s.because.trim()) {
          error(`${relPath}: tradeoffs.sacrifices[${i}].because missing — an omission without a stated reason is a gap, not a trade-off`);
        }
      });
    }
  }

  // instruction.behavior — the behavior contract (tile-format.md "Behavior
  // Fields"). A requiresJs: required/optional index record is a promise the
  // tile must keep: when the registry declares behaviorContract, interactive
  // tiles must publish a truthful contract the implementor can act on.
  if (config.behaviorContract) {
    const tileRequires = meta.discovery?.requiresJs ?? meta.requiresJs;
    const behavior = meta.instruction?.behavior;
    if (tileRequires === 'required' || tileRequires === 'optional') {
      if (!behavior || typeof behavior !== 'object') {
        error(`${relPath}: requiresJs "${tileRequires}" but no instruction.behavior contract (tile-format.md Behavior Fields)`);
      } else {
        if (behavior.requires !== tileRequires) error(`${relPath}: behavior.requires "${behavior.requires}" != tile requiresJs "${tileRequires}"`);
        if (!['host', 'inline', 'url'].includes(behavior.source)) error(`${relPath}: behavior.source must be one of: host, inline, url`);
        if (behavior.source === 'url' && typeof behavior.script !== 'string') error(`${relPath}: behavior.source "url" needs a script URL`);
        if (behavior.source === 'host' && typeof behavior.script !== 'string') error(`${relPath}: behavior.source "host" needs the design-system bundle name`);

        // Behavior selectors are contracts, not prose: every cited selector
        // must resolve against the tile's own markup (§D — the mechanical
        // half of behavior conformance; the interactive half is the runner).
        const checkSelector = (sel, label) => {
          if (typeof sel !== 'string' || !sel.trim()) return;
          for (const m of sel.matchAll(/\.([A-Za-z][\w-]*)/g)) {
            if (!domClasses.has(m[1])) error(`${relPath}: behavior ${label} cites ".${m[1]}" — not present in the tile markup`);
          }
          for (const m of sel.matchAll(/#([\w-]+)/g)) {
            if (!domIds.has(m[1])) error(`${relPath}: behavior ${label} cites "#${m[1]}" — not present in the tile markup`);
          }
        };
        for (const t of Array.isArray(behavior.triggers) ? behavior.triggers : []) {
          checkSelector(t?.control, 'trigger control');
          checkSelector(t?.target, 'trigger target');
        }
        if (behavior.focus && typeof behavior.focus === 'object') {
          checkSelector(behavior.focus.onOpen, 'focus.onOpen');
          checkSelector(behavior.focus.onClose, 'focus.onClose');
          checkSelector(behavior.focus.onAnimationEnd, 'focus.onAnimationEnd');
        }
        // Runtime classes (bodyClass, state classes) are applied by JS at
        // runtime — checked against ground truth (package harvest), not the
        // static DOM.
        const runtimeClass = (v, label) => {
          if (typeof v !== 'string') return;
          const c = v.trim().replace(/^-+|-+$/g, '');
          if (c && CLASS_PREFIXES.some((p) => c.startsWith(p)) && !definedClasses.has(c) && !classAllow.has(c)) {
            error(`${relPath}: behavior ${label} "${c}" is not in design-system ground truth and not allowlisted`);
          }
        };
        runtimeClass(behavior.bodyClass, 'bodyClass');
        for (const st of Object.values(behavior.states || {})) {
          if (st && typeof st === 'object') for (const v of Object.values(st)) runtimeClass(v, 'state');
        }
        if (typeof behavior.init !== 'string' || !behavior.init.trim()) error(`${relPath}: behavior.init missing — the activation contract is required`);
        if (typeof behavior.fallback !== 'string' || !behavior.fallback.trim()) error(`${relPath}: behavior.fallback missing — the no-JS rendering must be documented`);
        if (behavior.source === 'inline') {
          const behaviorScripts = html.match(/<script(?![^>]*application\/json)[^>]*>[\s\S]*?<\/script>/gi) || [];
          if (!behaviorScripts.length) error(`${relPath}: behavior.source "inline" but the tile carries no behavior <script>`);
        }
      }
    }
  }

  // Dense meta block ({agentMetaId}-dense) — optional token-budgeted
  // compression of the full block (tile-format.md "Dense metadata block").
  const denseRe = new RegExp(`<script[^>]*id="${agentMetaId}-dense"[^>]*>([\\s\\S]*?)</script>`, 'i');
  const denseMatch = html.match(denseRe);
  if (denseMatch) {
    let dense;
    try {
      dense = JSON.parse(denseMatch[1]);
    } catch (e) {
      error(`${relPath}: ${agentMetaId}-dense block is not valid JSON: ${e.message}`);
      dense = null;
    }
    if (dense) {
      for (const key of ['use', 'avoid', 'do', 'dont', 'preserve', 'adapt']) {
        if (key === 'adapt' ? typeof dense[key] !== 'string' : !Array.isArray(dense[key])) {
          warn(`${relPath}: dense block missing required key "${key}"`);
        }
      }
      if (denseMatch[1].length > match[1].length * 0.4) {
        warn(`${relPath}: dense block is ${Math.round(100 * denseMatch[1].length / match[1].length)}% of full block size (budget 40%) — trim prose`);
      }
    }
  }

  if (declares.coordination) {
    const c = meta.coordination;
    if (!c) warn(`${relPath}: missing coordination block`);
    else {
      for (const refKey of ['prerequisiteComponents', 'incompatibleWith']) {
        for (const ref of c[refKey] || []) {
          const name = typeof ref === 'string' ? ref : ref.name;
          if (!componentDirs.has(name)) error(`${relPath}: coordination.${refKey} references unknown component "${name}"`);
        }
      }
      if (!c.compositionCost?.costTier) warn(`${relPath}: coordination.compositionCost.costTier missing`);
    }
  }

  if (declares.compliance && !meta.discovery?.compliance) warn(`${relPath}: missing discovery.compliance (registry declares compliance facets)`);
  if (declares.mobileUX && !meta.discovery?.mobileUX) warn(`${relPath}: missing discovery.mobileUX (registry declares mobileUX facets)`);
}

// --- 2b. Repo-level class citations — the untiled layer and cross-system
// surfaces cite class names in JSON prose; only source-system prefixes are
// checkable (target-system classes belong to other universes). Negative
// lines ("X is not a USWDS class") are skipped, as in the tile prose scan.
if (definedClasses) {
  const universe = (c) => definedClasses.has(c) || classAllow.has(c);
  const NEG_LINE = /\b(?:is|are)\s+not\b|\bdo(?:es)?\s+not\b|\bdon'?t\b|\bnever\b|\bremoved\b|\bnot\s+canonical?\b|\bnot\s+(?:a\s+)?real\b|\bnot\s+in\b|\bhas\s+no\b|\bno\s+[\w.-]+\s+class\b/i;
  const scanJson = (relPath, text) => {
    text.split('\n').forEach((line, i) => {
      if (NEG_LINE.test(line)) return;
      for (const tok of line.matchAll(/[A-Za-z][\w-]*/g)) {
        const c = tok[0].replace(/-+$/, '');
        if (c.length > 3 && CLASS_PREFIXES.some((p) => c.startsWith(p)) && !universe(c)) {
          error(`${relPath}:${i + 1}: cites class "${c}" which is not in design-system ground truth and not allowlisted`);
        }
      }
    });
  };
  const ccPath = join(TILE_DIR, 'core-classes.json');
  if (existsSync(ccPath)) {
    try {
      const cc = JSON.parse(readFileSync(ccPath, 'utf-8'));
      for (const [cat, list] of Object.entries(cc.categories || {})) {
        for (const c of Array.isArray(list) ? list : []) {
          if (CLASS_PREFIXES.some((p) => c.startsWith(p)) && !universe(c)) {
            error(`core-classes.json: category "${cat}" lists "${c}" — not in design-system ground truth and not allowlisted`);
          }
        }
      }
    } catch (e) {
      error(`core-classes.json: invalid JSON: ${e.message}`);
    }
  }
  const surfaces = [];
  const adaptersDir = join(ROOT, 'adapters');
  if (existsSync(adaptersDir)) {
    for (const f of readdirSync(adaptersDir)) if (f.endsWith('.json')) surfaces.push([`adapters/${f}`, readFileSync(join(adaptersDir, f), 'utf-8')]);
  }
  const compatPath = join(ROOT, 'compatibility.json');
  if (existsSync(compatPath)) surfaces.push(['compatibility.json', readFileSync(compatPath, 'utf-8')]);
  const patternsDir2 = join(TILE_DIR, 'patterns');
  if (existsSync(patternsDir2)) {
    for (const f of readdirSync(patternsDir2)) if (f.endsWith('.json')) surfaces.push([`patterns/${f}`, readFileSync(join(patternsDir2, f), 'utf-8')]);
  }
  const recipesDir2 = join(TILE_DIR, 'recipes');
  if (existsSync(recipesDir2)) {
    for (const f of readdirSync(recipesDir2)) if (f.endsWith('.json')) surfaces.push([`recipes/${f}`, readFileSync(join(recipesDir2, f), 'utf-8')]);
  }
  for (const [p, text] of surfaces) scanJson(p, text);
}

// --- 3. Recipes ---

const declaredRecipeNames = new Set();
const recipesDir = join(TILE_DIR, 'recipes');
if (existsSync(recipesDir)) {
  for (const item of readdirSync(recipesDir)) {
    if (!item.endsWith('.json') || item === 'index.json') continue;
    let recipe;
    try {
      recipe = JSON.parse(readFileSync(join(recipesDir, item), 'utf-8'));
    } catch (e) {
      error(`recipes/${item}: invalid JSON: ${e.message}`);
      continue;
    }
    if (!recipe.recipe) error(`recipes/${item}: missing "recipe" name`);
    declaredRecipeNames.add(recipe.recipe);

    const seen = new Set();
    for (const c of recipe.components || []) {
      if (!c.file) error(`recipes/${item}: component missing "file"`);
      else if (!existsSync(join(TILE_DIR, c.file))) error(`recipes/${item}: references missing tile "${c.file}"`);
      if (c.order === undefined) warn(`recipes/${item}: component "${c.file}" missing order`);
      if (seen.has(c.order)) warn(`recipes/${item}: duplicate order ${c.order}`);
      seen.add(c.order);
    }
    if (!recipe.nesting) warn(`recipes/${item}: missing nesting description`);
    if (!Array.isArray(recipe.a11yNotes) || recipe.a11yNotes.length === 0) warn(`recipes/${item}: missing a11yNotes`);
  }
  const indexFile = join(recipesDir, 'index.json');
  if (!existsSync(indexFile)) warn('recipes/index.json manifest missing');
  else {
    try {
      const manifest = JSON.parse(readFileSync(indexFile, 'utf-8'));
      if (manifest.count !== undefined && manifest.count !== (manifest.recipes || []).length) {
        error(`recipes/index.json: count (${manifest.count}) != actual recipe entries (${(manifest.recipes || []).length})`);
      }
      for (const r of manifest.recipes || []) {
        if (!existsSync(join(TILE_DIR, 'recipes', `${r.name}.json`))) error(`recipes/index.json: ${r.name} has no recipe file`);
        if (!declaredRecipeNames.has(r.name) && declaredRecipeNames.size) warn(`recipes/index.json: ${r.name} not found on disk`);
      }
    } catch (e) {
      error(`recipes/index.json: invalid JSON: ${e.message}`);
    }
  }
  // Tiles claiming recipes must name real recipes
  for (const [relPath, meta] of metaById) {
    for (const name of meta.coordination?.compositionRecipes || []) {
      if (declaredRecipeNames.size && !declaredRecipeNames.has(name)) {
        warn(`${relPath}: compositionRecipes references unknown recipe "${name}"`);
      }
    }
  }
}

// --- Class-field completeness (registry metadata defect class) ---
// The property came from uswds:F-010: 149/152 USWDS tiles were missing
// uswdClass, so an entire component family was invisible to class-level
// coverage — a missing facet does not fail, it disappears.
// The discovery class field (uswdClass/govukClass/frClass/eclClass/canadaClass)
// is required for class-level coverage checking. The T2 round-trip caught
// 149/152 USWDS tiles missing it — this rule makes that defect impossible
// to reintroduce silently.
{
  const classField = {
    'uswds-ai-components': 'uswdClass',
    'govuk-ai-components': 'govukClass',
    'dsfr-ai-components': 'frClass',
    'ecl-ai-components': 'eclClass',
    'canada-ai-components': 'canadaClass',
    'drupal-uswds-ai-components': 'uswdClass'
  }[config.name];
  if (classField && metaById.size) {
    const missing = [...metaById.entries()].filter(([, m]) =>
      !m.discovery?.[classField] && !m.discovery?.multiComponent);
    if (missing.length) {
      warn(`class-field "${classField}" missing on ${missing.length}/${metaById.size} tiles (e.g. ${missing[0][0]}) — class-level coverage checking will be incomplete`);
    }
  }
}

// --- Declared gaps ---
if (Array.isArray(config.gaps)) {
  for (const gap of config.gaps) {
    if (!gap.concept) error('gaps: entry missing "concept"');
    if (!['not_part_of_design_system', 'deferred'].includes(gap.status)) {
      error(`gaps: ${gap.concept || '?'} has invalid status "${gap.status}"`);
    }
    if (!gap.reason) warn(`gaps: ${gap.concept || '?'} missing reason`);
    // Doctrine-backed omissions must cite their source and state the
    // instruction-shaped consequence (registry.config.schema.json if/then).
    // The registry records doctrine with sources; it never authors it.
    if (gap.status === 'not_part_of_design_system') {
      if (!gap.consequence) error(`gaps: ${gap.concept} (not_part_of_design_system) missing "consequence" — an omission without a stated consequence is an undeclared gap`);
      if (!gap.source) error(`gaps: ${gap.concept} (not_part_of_design_system) missing "source" — the registry may only point, never assert`);
    }
  }
}

// --- Surface 6: pattern guidance (optional, config-gated) ---
// Task-to-component-set guidance with citations only — the lane rule
// (protocol.md Surface 6). The registry points; the implementor designs.
const patternsDir = join(TILE_DIR, 'patterns');
const patternsDeclared = config.patternGuidance === true;
const patternsOnDisk = existsSync(patternsDir);
if (patternsOnDisk && !patternsDeclared) {
  warn('patterns/ directory exists but registry.config.json does not declare patternGuidance: true — Surface 6 is not published');
}
if (patternsDeclared && !patternsOnDisk) {
  warn('patternGuidance: true but no patterns/ directory — publish one pattern file or unset the flag');
}
if (patternsOnDisk) {
  const declaredPatternNames = new Set();
  for (const item of readdirSync(patternsDir)) {
    if (!item.endsWith('.json') || item === 'index.json') continue;
    let pattern;
    try {
      pattern = JSON.parse(readFileSync(join(patternsDir, item), 'utf-8'));
    } catch (e) {
      error(`patterns/${item}: invalid JSON: ${e.message}`);
      continue;
    }
    if (!pattern.pattern) error(`patterns/${item}: missing "pattern" name`);
    declaredPatternNames.add(pattern.pattern);
    if (pattern.pattern && pattern.pattern !== item.replace(/\.json$/, '')) {
      warn(`patterns/${item}: file name does not match pattern name "${pattern.pattern}"`);
    }
    if (!pattern.description) warn(`patterns/${item}: missing description`);
    for (const key of ['useWhen', 'avoidWhen']) {
      if (!Array.isArray(pattern[key])) error(`patterns/${item}: missing "${key}" array`);
      else if (pattern[key].some((s) => typeof s !== 'string' || !s.trim())) {
        error(`patterns/${item}: ${key} entries must be non-empty strings`);
      }
    }

    // Cross-references: components and recipes must exist in this registry.
    for (const name of pattern.components || []) {
      if (!componentDirs.has(name)) error(`patterns/${item}: references unknown component "${name}"`);
    }
    for (const name of pattern.recipes || []) {
      if (declaredRecipeNames.size && !declaredRecipeNames.has(name)) {
        error(`patterns/${item}: references unknown recipe "${name}"`);
      }
    }

    // Citation enforcement — the lane rule. Every claim is a citation:
    // doctrine → design-system source, failure modes → field-test run,
    // mandated elements → legal/policy source.
    for (const [key, citeKey, label] of [
      ['doctrine', 'source', 'design-system source'],
      ['mandatedElements', 'source', 'legal/policy source'],
      ['knownFailureModes', 'run', 'field-test run'],
    ]) {
      (pattern[key] || []).forEach((entry, i) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          error(`patterns/${item}: ${key}[${i}] must be an object`);
          return;
        }
        if (typeof entry[citeKey] !== 'string' || !entry[citeKey].trim()) {
          error(`patterns/${item}: ${key}[${i}] missing "${citeKey}" (${label}) — the registry may only point, never assert`);
        }
      });
    }

    // Lane enforcement: pattern files are task-to-component-set guidance.
    // Any key that prescribes page structure, sequence, or quality standards
    // is page design and belongs to the implementor, not the registry.
    const OUT_OF_LANE = ['cadence', 'nesting', 'sequence', 'steps', 'order', 'layout', 'placement', 'pageStructure', 'definitionOfDone', 'validationOrder'];
    for (const key of OUT_OF_LANE) {
      if (pattern[key] !== undefined) {
        error(`patterns/${item}: "${key}" is out of lane — pattern files are task-to-component-set guidance only (protocol.md Surface 6)`);
      }
    }
  }
  if (patternsDeclared && !existsSync(join(patternsDir, 'index.json'))) {
    warn('patterns/index.json manifest missing — run generate-index.mjs');
  }
  if (existsSync(join(patternsDir, 'index.json'))) {
    try {
      const manifest = JSON.parse(readFileSync(join(patternsDir, 'index.json'), 'utf-8'));
      for (const p of manifest.patterns || []) {
        const pname = p.pattern || p.name;
        if (!existsSync(join(patternsDir, `${pname}.json`))) error(`patterns/index.json: ${pname} has no pattern file`);
      }
    } catch (e) {
      error(`patterns/index.json: invalid JSON: ${e.message}`);
    }
  }
  // Tiles claiming patterns must name real patterns (mirror of the recipe rule)
  if (declaredPatternNames.size) {
    for (const [relPath, meta] of metaById) {
      for (const name of meta.discovery?.patterns || []) {
        if (!declaredPatternNames.has(name)) {
          error(`${relPath}: discovery.patterns references unknown pattern "${name}"`);
        }
      }
    }
  }
}

// --- Findings ledger (epistemic record; see findings-ledger.md) ---
// Optional per registry; when present, checks shape and ID uniqueness.
{
  const fPath = join(TILE_DIR, 'findings.json');
  if (existsSync(fPath) && !CONFORMANCE_ONLY) {
    let f;
    try {
      f = JSON.parse(readFileSync(fPath, 'utf-8'));
    } catch (e) {
      error(`findings.json: invalid JSON: ${e.message}`);
      f = null;
    }
    if (f) {
      const KINDS = ['deep-check', 'sweep', 'test', 'upgrade', 'rework', 'observation', 'decision'];
      const RESULTS = ['broke', 'fixed', 'clean', 'recorded', 'deprecated'];
      const ids = new Set();
      const list = f.findings || [];
      for (const [i, e] of list.entries()) {
        const at = `findings[${i}]`;
        if (!e.id) error(`${fPath}: ${at} missing "id"`);
        else if (ids.has(e.id)) error(`${fPath}: duplicate finding id "${e.id}"`);
        else ids.add(e.id);
        if (!/^F-\d+$/.test(e.id || '')) warn(`${fPath}: ${at} id "${e.id}" is not in F-NNN form`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) error(`${fPath}: ${at} missing or malformed "date" (YYYY-MM-DD)`);
        if (!KINDS.includes(e.kind)) error(`${fPath}: ${at}.kind must be one of: ${KINDS.join(', ')}`);
        if (!RESULTS.includes(e.result)) error(`${fPath}: ${at}.result must be one of: ${RESULTS.join(', ')}`);
        if (typeof e.summary !== 'string' || !e.summary.trim()) error(`${fPath}: ${at} missing "summary"`);
        // A "broke" finding with no change recorded is an open item, not a finding.
        if (e.result === 'broke' && !(e.changed || []).length) warn(`${fPath}: ${at} (${e.id}) result "broke" with no recorded change — unresolved or undocumented`);
      }
      if (!list.length) warn(`${fPath}: no findings recorded`);
      // Null results are evidence too; say so when a registry has none.
      if (!list.some((e) => e.result === 'clean' || e.result === 'fixed')) {
        console.log(`  ℹ findings.json: no clean/fixed results — this registry records only observations`);
      }
    }
  }
}

// --- Tile purity (component ground truth) ---
// Active when the registry carries a tile-purity.json baseline (generated by
// generate-index.mjs). Body markup is component ground truth (tile-format.md
// "Tile Purity"): drift from the baseline is a conformance error. Re-baseline
// via generate-index.mjs, which permits body changes only when the tile's
// provenance cites ground truth.
{
  const purityPath = join(TILE_DIR, 'tile-purity.json');
  if (existsSync(purityPath) && !CONFORMANCE_ONLY) {
    let baseline;
    try {
      baseline = JSON.parse(readFileSync(purityPath, 'utf-8'));
    } catch (e) {
      error(`tile-purity.json: invalid JSON: ${e.message}`);
      baseline = null;
    }
    if (baseline) {
      const bodyOf = (html) => {
        const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        return (m ? m[1] : '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/\s+/g, ' ').trim();
      };
      let mismatches = 0, missing = 0;
      for (const file of tileFiles) {
        const relPath = file.replace(TILE_DIR + '/', '');
        const recorded = baseline.tiles?.[relPath];
        if (!recorded) {
          error(`${relPath}: no tile-purity baseline entry — run _base/generate-index.mjs`);
          missing++;
          continue;
        }
        const actual = createHash('sha256').update(bodyOf(readFileSync(file, 'utf-8'))).digest('hex');
        if (actual !== recorded) {
          error(`${relPath}: body markup differs from the tile-purity baseline — body changes are ground-truth corrections: cite provenance (method + source), then run _base/generate-index.mjs (tile-format.md "Tile Purity")`);
          mismatches++;
        }
      }
      for (const rel of Object.keys(baseline.tiles || {})) {
        if (!metaById.has(rel)) warn(`tile-purity.json: baseline entry for missing tile "${rel}"`);
      }
      if (!missing && !mismatches) console.log(`  ℹ tile purity: ${tileFiles.length} bodies verified against baseline`);
    }
  }
}

// --- Surface 7: observations.json (optional, hand-maintained) ---
// Ecosystem knowledge: live-site extensions/compositions of the design
// system's namespace. Citations required; observations are never tiles.
{
  const knownFamilies = (() => {
    const names = new Set(componentDirs);
    const corePath = join(TILE_DIR, 'core-classes.json');
    if (existsSync(corePath)) {
      try {
        const c = JSON.parse(readFileSync(corePath, 'utf-8'));
        for (const list of Object.values(c.categories || {})) {
          for (const cls of list) names.add(cls.replace(/^usa-/, '').split('__')[0]);
        }
      } catch { /* shape checked elsewhere */ }
    }
    return names;
  })();
  const obsPath = join(TILE_DIR, 'observations.json');
  if (existsSync(obsPath) && !CONFORMANCE_ONLY) {
    let obs;
    try {
      obs = JSON.parse(readFileSync(obsPath, 'utf-8'));
    } catch (e) {
      error(`observations.json: invalid JSON: ${e.message}`);
      obs = null;
    }
    if (obs) {
      const entries = obs.observations || [];
      entries.forEach((o, i) => {
        const at = `observations[${i}]`;
        for (const field of ['observed', 'site', 'url', 'source']) {
          if (typeof o[field] !== 'string' || !o[field].trim()) error(`${obsPath}: ${at} missing "${field}" — citations required (protocol.md Surface 7)`);
        }
        if (!['extension', 'composition', 'other'].includes(o.kind)) error(`${obsPath}: ${at}.kind must be extension | composition | other`);
        if (o.kind === 'extension' && (typeof o.extension !== 'string' || !o.extension.trim())) error(`${obsPath}: ${at} missing "extension" class string`);
        if (o.family && !knownFamilies.has(o.family)) warn(`${obsPath}: ${at}.family "${o.family}" matches no tiled family or core class`);
      });
      if (!entries.length) warn(`${obsPath}: no observations recorded`);
    }
  }
}

// --- Design-system version pin (event-driven sync) ---
// registry.config.json designSystem.version is THE pin; the registry is a
// faithful snapshot of that version. Cross-checks everywhere the version
// appears; per-tile stamps are an aggregated worklist warning (protocol.md
// "Design-System Version Sync").
{
  const pin = config.designSystem?.version;
  if (!pin) {
    warn('registry.config.json has no designSystem.version pin — version sync checks inactive (protocol.md "Design-System Version Sync")');
  } else {
    const exact = /^\d+\.\d+(\.\d+)?$/.test(pin);
    if (!exact) warn(`design-system pin "${pin}" is not an exact version — pin the exact release to activate stamp checks`);
    const pkg = config.designSystem?.package;
    if (pkg) {
      try {
        const pkgJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
        const declared = pkgJson.devDependencies?.[pkg] ?? pkgJson.dependencies?.[pkg];
        if (!declared) error(`designSystem.package "${pkg}" not found in package.json dependencies`);
        else if (declared.replace(/^[~^]/, '') !== pin.replace(/^[~^]/, '')) {
          error(`package.json ${pkg} (${declared}) != design-system pin ${pin} — align the pin before upgrading`);
        } else if (/^[~^]/.test(declared)) {
          warn(`package.json ${pkg} is a range (${declared}) — pin the exact version for ground-truth class checks`);
        }
      } catch (e) {
        warn(`package.json unreadable: ${e.message}`);
      }
    }
    const vPath = join(TILE_DIR, 'versions.json');
    if (existsSync(vPath)) {
      try {
        const v = JSON.parse(readFileSync(vPath, 'utf-8'));
        if (v.designSystem?.version && v.designSystem.version !== pin) {
          error(`versions.json designSystem.version (${v.designSystem.version}) != design-system pin (${pin})`);
        }
        const entries = v.versions || [];
        const latest = entries[entries.length - 1];
        if (latest?.designSystemVersion && latest.designSystemVersion !== pin) {
          error(`versions.json latest entry ${latest.version} verified against ${latest.designSystemVersion} != pin ${pin}`);
        }
      } catch (e) {
        warn(`versions.json unreadable: ${e.message}`);
      }
    }
    const aPath = join(ROOT, 'agents.json');
    if (existsSync(aPath)) {
      try {
        const a = JSON.parse(readFileSync(aPath, 'utf-8'));
        if (a.designSystem?.version && a.designSystem.version !== pin) {
          error(`agents.json designSystem.version (${a.designSystem.version}) != design-system pin (${pin})`);
        }
        if (a.count !== undefined && a.count !== metaById.size) {
          error(`agents.json count (${a.count}) != tile count (${metaById.size}) — regenerate agents.json`);
        }
      } catch (e) {
        warn(`agents.json unreadable: ${e.message}`);
      }
    }
    if (exact && !CONFORMANCE_ONLY && metaById.size) {
      let ok = 0, stale = 0, missing = 0, first = null;
      for (const [rel, meta] of metaById) {
        const s = meta.provenance?.designSystemVersion;
        if (!s) { missing++; first = first || rel; }
        else if (s !== pin) { stale++; first = first || rel; }
        else ok++;
      }
      if (ok < metaById.size) {
        warn(`design-system stamps: ${ok}/${metaById.size} tiles verified against pin ${pin} (${missing} missing, ${stale} stale; e.g. ${first}) — worklist, see protocol.md "Design-System Version Sync"`);
      }
    }
  }
}

// --- 3. Version history + compatibility maps ---

const versionsFile = join(TILE_DIR, 'versions.json');
if (existsSync(versionsFile)) {
  try {
    const versions = JSON.parse(readFileSync(versionsFile, 'utf-8'));
    for (const v of versions.versions || []) {
      if (!v.version) error('versions.json: entry missing "version"');
      if (!v.migrationPath) error(`versions.json: ${v.version || '?'} missing migrationPath`);
      if (!v.releaseDate) warn(`versions.json: ${v.version || '?'} missing releaseDate`);
    }
    if (config.updated && versions.versions?.length) {
      const latest = versions.versions[versions.versions.length - 1].version;
      if (latest !== config.updated) warn(`versions.json latest (${latest}) != config.updated (${config.updated})`);
    }
  } catch (e) {
    error(`versions.json: invalid JSON: ${e.message}`);
  }
}

const compatFile = join(ROOT, 'compatibility.json');
if (existsSync(compatFile)) {
  let compat;
  try {
    compat = JSON.parse(readFileSync(compatFile, 'utf-8'));
  } catch (e) {
    error(`compatibility.json: invalid JSON: ${e.message}`);
    compat = null;
  }
  if (compat) {
    for (const [sectionKey, section] of Object.entries(compat)) {
      if (sectionKey.startsWith('_') || !section || typeof section !== 'object' || !section.target) continue;
      if (!sectionKey.includes('-to-')) continue;
      for (const [component, entry] of Object.entries(section)) {
        if (component.startsWith('_') || component === 'target') continue;
        if (!entry || typeof entry !== 'object') {
          error(`compatibility.json: ${sectionKey}.${component} is not an object`);
          continue;
        }
        if (!entry.adaptation) warn(`compatibility.json: ${sectionKey}.${component} missing "adaptation"`);
        if (entry.adaptation === 'css-only' && !entry.classMap) {
          warn(`compatibility.json: ${sectionKey}.${component} is css-only but has no classMap`);
        }
        for (const [cls, targetCls] of Object.entries(entry.classMap || {})) {
          if (targetCls !== null && typeof targetCls !== 'string') {
            error(`compatibility.json: ${sectionKey}.${component}.classMap.${cls} must be a string or null`);
          }
        }
        if (!componentDirs.has(component) && componentDirs.size) {
          warn(`compatibility.json: ${sectionKey} references unknown component family "${component}"`);
        }
      }
    }
  }
}

// --- 4. Index freshness + facet coverage ---

const indexPath = join(TILE_DIR, 'components.index.json');
if (!existsSync(indexPath)) {
  error(`missing ${tileDir}/components.index.json — run generate-index.mjs`);
} else {
  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch (e) {
    error(`components.index.json is not valid JSON: ${e.message}`);
    index = null;
  }
  if (index) {
    if (index.counts?.total !== tileFiles.length) {
      warn(`index counts.total (${index.counts?.total}) != tile count (${tileFiles.length}) — regenerate index`);
    }
    const indexedFiles = new Set((index.components || []).map((c) => c.file));
    for (const f of metaById.keys()) {
      if (!indexedFiles.has(f)) warn(`tile "${f}" missing from index — regenerate index`);
    }

    // Facet coverage
    for (const facet of facets) {
      const withFacet = (index.components || []).filter((c) => {
        const v = c[facet];
        return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
      }).length;
      if (withFacet === 0) warn(`facet "${facet}" has zero coverage across ${tileFiles.length} tiles`);
      else if (withFacet < tileFiles.length) (CONFORMANCE_ONLY ? console.error : console.log)(`  ℹ facet "${facet}" coverage: ${withFacet}/${tileFiles.length} (partial facets are valid)`);
    }

    // Leanness budget — per-record, scale-free (a lean 600-record index is fine;
    // prose bloat shows up in the average, not the total)
    const bytes = statSync(indexPath).size;
    const recordCount = Math.max((index.components || []).length, 1);
    const perRecord = bytes / recordCount;
    if (perRecord > 3072) error(`index averages ${Math.round(perRecord)}B/record (over 3KB) — move prose out of the index`);
    else if (perRecord > 2048) warn(`index averages ${Math.round(perRecord)}B/record (over 2KB) — check for bloated fields`);
    else (CONFORMANCE_ONLY ? console.error : console.log)(`  ℹ index leanness: ${Math.round(perRecord)}B/record across ${recordCount} records`);
  }
}

// facets.json exists
if (!existsSync(join(TILE_DIR, 'facets.json'))) warn(`missing ${tileDir}/facets.json`);

// --- Report ---

if (CONFORMANCE_ONLY) {
  // Conformance = the 5-step flow ran clean against this registry
  const flowOk = errors.length === 0 && metaById.size > 0;
  console.log(JSON.stringify({
    registry: config.name || ROOT,
    conformance: flowOk ? 'pass' : 'fail',
    tiles: metaById.size,
    errors: errors.length,
  }, null, 2));
  process.exit(flowOk ? 0 : 1);
}

console.log(`Registry: ${config.name || ROOT}`);
console.log(`Tiles scanned: ${tileFiles.length}`);
console.log('');
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log(`\nErrors: ${errors.length}, Warnings: ${warnings.length}`);
process.exit(errors.length > 0 ? 1 : 0);
