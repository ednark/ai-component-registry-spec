#!/usr/bin/env node
// Generate resolved-view companions for every tile in a registry.
//
// A resolved view (`{variant}.resolved.html`) is a generated companion file
// co-located with its tile: same DOM, but every element carries its *computed*
// styles inline (geometry, colors, spacing — everything a static consumer
// cannot compute), page chrome is materialized on a wrapper element, and
// scripts/styles/links are removed. Generated with the design system's CSS
// injected at build time, so tiles whose design system relies on external
// stylesheets (e.g., USWDS) still resolve to their true appearance.
//
// Canonical tiles are never modified. Browsers and agents ignore resolved
// views; the index generator and validator skip them (reserved suffix).
//
// Requirements (resolved lazily from the REGISTRY's node_modules, not _base):
//   npm i -D puppeteer          # in the registry repo
// Config (registry.config.json):
//   "staticView": {
//     "css": ["node_modules/@uswds/uswds/dist/css/uswds.min.css"],  // optional
//     "viewport": { "width": 1280, "height": 4000 }                 // optional
//   }
//
// Usage: node _base/generate-resolved-view.mjs [--only <component/variant>] [--dry-run]

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const configPath = join(ROOT, 'registry.config.json');
if (!existsSync(configPath)) {
  console.error('generate-resolved-view.mjs: run from a registry root (registry.config.json not found).');
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const TILE_DIR = join(ROOT, config.tileDir ?? 'infinite');
const SUFFIX = '.resolved.html';
const VIEWPORT = config.staticView?.viewport ?? { width: 1280, height: 4000 };
const CSS_FILES = config.staticView?.css ?? [];
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

// --- resolve puppeteer from the registry, not from _base ---
const require = createRequire(join(ROOT, 'package.json'));
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch {
  console.error(
    'generate-resolved-view.mjs requires puppeteer in the registry repo:\n' +
    '  npm i -D puppeteer\n' +
    '(Chrome must be installed; set PUPPETEER_EXECUTABLE_PATH if bundled Chromium fails.)'
  );
  process.exit(1);
}

function findHtmlFiles(dir, files = []) {
  for (const item of readdirSync(dir)) {
    if (item.endsWith(SUFFIX)) continue;
    const full = join(dir, item);
    if (statSync(full).isDirectory()) findHtmlFiles(full, files);
    else if (item.endsWith('.html')) files.push(full);
  }
  return files;
}

const only = ONLY;
const dry = process.argv.includes('--dry');

const KEEP = [
  'display', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'box-sizing',
  'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap',
  'grid-template-columns', 'grid-template-rows',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'color', 'background-color', 'background-image',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius', 'box-shadow', 'opacity', 'overflow',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-decoration', 'text-transform', 'white-space', 'vertical-align', 'list-style-type',
];

const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
});
const jobs = findHtmlFiles(TILE_DIR).filter(f => !only || f.includes(`${only}/`) || f.includes(only));
console.log(`Generating resolved views for ${jobs.length} tiles (viewport ${VIEWPORT.width}x${VIEWPORT.height})...`);

let ok = 0, fail = 0;
for (const tile of jobs) {
  const out = tile.replace(/\.html$/, SUFFIX);
  if (dry) { console.log(`[dry] ${out}`); continue; }
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto('file://' + tile, { waitUntil: 'networkidle0', timeout: 30000 });
    if (CSS_FILES.length) {
      await page.addStyleTag({ content: CSS_FILES.map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n') });
      await new Promise(r => setTimeout(r, 300)); // let recompute settle
    }
    const title = (await page.title()).replace(/\s*\(.*\)$/, '');
    // Stamp the resolved view with the tile source hash so the validator can
    // detect staleness without relying on mtimes (unreliable across clones).
    const tileHash = createHash('sha256').update(readFileSync(tile)).digest('hex');
    const flat = await page.evaluate((KEEP, SUFFIX) => {
      const bodyStyle = getComputedStyle(document.body);
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-resolved', '');
      wrapper.style.cssText = [
        `background-color:${bodyStyle.backgroundColor}`,
        `color:${bodyStyle.color}`,
        `font-family:${bodyStyle.fontFamily}`,
        `font-size:${bodyStyle.fontSize}`,
        `line-height:${bodyStyle.lineHeight}`,
        `padding:${bodyStyle.padding}`,
      ].join(';');
      for (const el of document.body.querySelectorAll('*')) {
        if (/^(SCRIPT|LINK|META|STYLE)$/.test(el.tagName)) continue;
        const s = getComputedStyle(el);
        const decls = [];
        for (const prop of KEEP) {
          const v = s.getPropertyValue(prop);
          if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') decls.push(`${prop}:${v}`);
        }
        el.setAttribute('style', decls.join(';') || '');
      }
      for (const el of document.querySelectorAll('script, style, link')) el.remove();
      while (document.body.firstChild) wrapper.appendChild(document.body.firstChild);
      document.body.appendChild(wrapper);
      return document.body.innerHTML;
    }, KEEP, SUFFIX);
    writeFileSync(out,
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<title>${title} (resolved view)</title>` +
      `<!-- Generated by _base/generate-resolved-view.mjs from ${basename(tile)} — DO NOT EDIT. -->` +
      `<!-- resolved-from: sha256:${tileHash} -->` +
      `</head><body>${flat}</body></html>`);
    ok++;
    process.stdout.write(`  ✓ ${out}\n`);
    await page.close();
  } catch (e) {
    fail++;
    console.error(`  ✗ ${tile}: ${e.message.slice(0, 120)}`);
  }
}
await browser.close();
console.log(`\nDone: ${ok} generated, ${fail} failed.`);
if (fail > 0) process.exit(1);