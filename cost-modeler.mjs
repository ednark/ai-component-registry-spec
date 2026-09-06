#!/usr/bin/env node
/**
 * AI Component Registry — Agent Cost Modeler
 *
 * Predicts the cheapest capable agent path for a composition task using the
 * registry's own cost metadata (coordination.compositionCost).
 *
 * Task resolution order:
 *   1. --recipe <name>     → cost a published recipe (Surface 4)
 *   2. --files a.html,b... → cost an explicit tile set
 *   3. --task "..."        → keyword-match task text against recipes
 *
 * Usage:
 *   node _base/cost-modeler.mjs --task "build a contact form"
 *   node _base/cost-modeler.mjs --recipe login-flow
 *   node _base/cost-modeler.mjs --files button/default.html,form/default.html
 *   node _base/cost-modeler.mjs --recipe login-flow --json
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const hasFlag = (flag) => args.includes(flag);

// Rough model routing constants — tune to your provider pricing.
const MODELS = [
  { id: 'haiku', costPer1kTokens: 0.001, successRate: 0.9 },
  { id: 'sonnet', costPer1kTokens: 0.003, successRate: 0.99 },
];
const SUCCESS_THRESHOLD = 0.9;

const ROOT = process.cwd();
const config = JSON.parse(readFileSync(join(ROOT, 'registry.config.json'), 'utf-8'));
const { tileDir = 'infinite', name } = config;
const index = JSON.parse(readFileSync(join(ROOT, tileDir, 'components.index.json'), 'utf-8'));
const byFile = new Map((index.components || []).map((c) => [c.file, c]));

const TIER_TOKENS = { cheap: 750, moderate: 2000, expensive: 4500 };

function resolveRecipe() {
  const recipesDir = join(ROOT, tileDir, 'recipes');
  let recipeArg = argValue('--recipe');
  const task = argValue('--task');
  if (!recipeArg && task) {
    const q = task.toLowerCase();
    const manifestPath = join(recipesDir, 'index.json');
    if (!existsSync(manifestPath)) return { error: `No recipes manifest at ${manifestPath}` };
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    let best = null;
    let bestScore = 0;
    for (const r of manifest.recipes || []) {
      const hay = `${r.name} ${r.title} ${r.description}`.toLowerCase();
      const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = r.name;
      }
    }
    if (!best) return { error: `No recipe matches "${task}". Use --files to cost an explicit tile set.` };
    recipeArg = best;
  }
  if (!recipeArg) return { error: 'Provide --recipe <name>, --task "<text>", or --files a.html,b.html' };
  const path = join(recipesDir, `${String(recipeArg).replace(/[^a-z0-9-]/gi, '')}.json`);
  if (!existsSync(path)) return { error: `Recipe not found: ${recipeArg}` };
  return { recipe: JSON.parse(readFileSync(path, 'utf-8')) };
}

let files = [];
let source = '';
if (argValue('--files')) {
  files = argValue('--files').split(',').map((f) => f.trim()).filter(Boolean);
  source = 'explicit file set';
} else {
  const resolved = resolveRecipe();
  if (resolved.error) {
    console.error(`✗ ${resolved.error}`);
    process.exit(1);
  }
  files = resolved.recipe.components.map((c) => c.file);
  source = `recipe:${resolved.recipe.recipe}`;
  var recipeName = resolved.recipe.recipe;
}

const missing = files.filter((f) => !byFile.has(f));
if (missing.length) {
  console.error(`✗ Unknown tiles: ${missing.join(', ')}`);
  process.exit(1);
}

const details = files.map((f) => {
  const c = byFile.get(f);
  return {
    file: f,
    costTier: c.costTier || 'unknown',
    estimatedTokens: TIER_TOKENS[c.costTier] || 1500,
  };
});

const totalTokens = details.reduce((a, d) => a + d.estimatedTokens, 0);
const totalFetches = files.length;
const hasJs = files.some((f) => byFile.get(f).requiresJs === 'required');
const expensive = files.filter((f) => byFile.get(f).costTier === 'expensive').length;

const estimates = MODELS.map((m) => ({
  model: m.id,
  estimatedCost: Math.round(((totalTokens / 1000) * m.costPer1kTokens + totalFetches * 0.0001) * 100000) / 100000,
  successRate: m.successRate,
  expectedTokens: totalTokens,
}));

const viable = estimates.filter((e) => e.successRate >= SUCCESS_THRESHOLD);
const recommended = (viable.length ? viable : estimates).sort((a, b) => a.estimatedCost - b.estimatedCost)[0];

const result = {
  registry: name,
  source,
  ...(recipeName && { recipe: recipeName }),
  components: totalFetches,
  totalEstimatedTokens: totalTokens,
  requiresJsBehavior: hasJs,
  expensiveComponents: expensive,
  estimates,
  recommendation: `${recommended.model}; total cost ≈ $${recommended.estimatedCost.toFixed(4)} at ~${recommended.successRate * 100}% success.${expensive ? ` ${expensive} expensive component(s) — consider routing those fetches to a stronger model tier.` : ''}`,
};

if (hasFlag('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Source:        ${result.source}${recipeName ? ` (${recipeName})` : ''}`);
  console.log(`Components:    ${result.components}`);
  console.log(`Est. tokens:   ~${result.totalEstimatedTokens}`);
  console.log(`JS behavior:   ${result.requiresJsBehavior ? 'yes' : 'no'}`);
  console.log('');
  for (const e of estimates) {
    console.log(`  ${e.model.padEnd(8)} $${e.estimatedCost.toFixed(4)}  (${Math.round(e.successRate * 100)}% success)`);
  }
  console.log(`\n→ ${result.recommendation}`);
}
