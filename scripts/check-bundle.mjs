#!/usr/bin/env node
/**
 * Enforces the bundle budgets in bundle-budget.json.
 *
 * A budget that only prints a total tells you that you regressed, not what
 * did it. This walks the real import graph out of dist/bundle-analysis.json,
 * so a failure names the asset, its size, its limit, and the modules inside it.
 *
 *     node scripts/check-bundle.mjs
 */
import { readFileSync } from 'node:fs';

const kb = bytes => Math.round((bytes / 1024) * 10) / 10;

function load(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Cannot read ${file}: ${error.message}`);
    console.error('Run `yarn build` first — the analysis is written by the build.');
    process.exit(2);
  }
}

const analysis = load('dist/bundle-analysis.json');
const budget = load('bundle-budget.json');
const byFile = new Map(analysis.chunks.map(chunk => [chunk.file, chunk]));

/** Everything the browser must fetch before the entry can run. */
function initialGraph() {
  const entry = analysis.chunks.find(chunk => chunk.entry);
  if (!entry) throw new Error('No entry chunk in the analysis');
  const seen = new Set();
  const walk = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of byFile.get(file)?.imports ?? []) walk(next);
  };
  walk(entry.file);
  return [...seen].map(file => byFile.get(file)).filter(Boolean);
}

const initial = initialGraph();
const js = analysis.chunks.filter(chunk => chunk.kind === 'chunk');
const css = analysis.chunks.filter(chunk => chunk.file.endsWith('.css'));
const async_ = js.filter(chunk => !initial.some(loaded => loaded.file === chunk.file));

const sum = chunks => chunks.reduce((total, chunk) => total + chunk.gzipBytes, 0);
const largest = chunks => chunks.reduce((worst, chunk) =>
  (!worst || chunk.gzipBytes > worst.gzipBytes ? chunk : worst), null);

const biggestAsync = largest(async_);
const results = [
  { name: 'initial JavaScript (gzip)', value: sum(initial.filter(c => c.kind === 'chunk')),
    limit: budget.initialJsGzipKb * 1024,
    detail: initial.map(c => c.file).join(', ') },
  { name: 'largest async chunk (gzip)', value: biggestAsync?.gzipBytes ?? 0,
    limit: budget.largestAsyncChunkGzipKb * 1024,
    detail: biggestAsync?.file ?? 'none' },
  { name: 'all CSS (gzip)', value: sum(css), limit: budget.totalCssGzipKb * 1024,
    detail: css.map(c => c.file).join(', ') },
  { name: 'all assets (gzip)', value: sum(analysis.chunks), limit: budget.totalGzipKb * 1024,
    detail: `${analysis.chunks.length} assets` },
];

let failed = false;
for (const result of results) {
  const pass = result.value <= result.limit;
  failed ||= !pass;
  const headroom = Math.round(((result.limit - result.value) / result.limit) * 100);
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${result.name.padEnd(28)} ` +
    `${String(kb(result.value)).padStart(7)} kB / ${kb(result.limit)} kB` +
    `${pass ? ` (${headroom}% headroom)` : ''}`);
  console.log(`      ${result.detail}`);
  if (!pass) {
    const chunk = byFile.get(result.detail.split(', ')[0]);
    for (const module of chunk?.topModules?.slice(0, 5) ?? []) {
      console.log(`      ${String(kb(module.bytes)).padStart(7)} kB  ${module.id}`);
    }
  }
}

if (failed) {
  console.error('\nBundle budget exceeded. dist/bundle-analysis.json lists every chunk and what is in it.');
  console.error('Either split the offending feature behind a dynamic import, or raise the limit in');
  console.error('bundle-budget.json with a note saying why the weight is worth it.');
  process.exit(1);
}
