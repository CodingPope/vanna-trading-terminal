#!/usr/bin/env node
/**
 * Renders the human-readable report from the benchmark artifact.
 *
 * Deliberately a projection of one file: a prose summary written by hand drifts
 * from the numbers it describes, and then the prose is what people quote.
 *
 *     node scripts/benchmark-report.mjs [artifact.json] > report.md
 */
import { readFileSync } from 'node:fs';

const METRICS = [
  ['transportJitterMs', 'Transport jitter', 'ms'],
  ['processingMs', 'Receive → commit', 'ms'],
  ['frameDelayMs', 'Frame delay', 'ms'],
  ['roundTripMs', 'Round trip', 'ms'],
  ['replayLagMs', 'Replay lag', 'ms'],
];

const show = value => (value === null || value === undefined ? 'unavailable' : value);
const fixed = value => (typeof value === 'number' ? value.toFixed(1) : 'unavailable');

function report(artifact) {
  const lines = [];
  const { environment: env, scenario, runs } = artifact;

  lines.push('# Feed benchmark');
  lines.push('');
  lines.push(`**${artifact.pass ? 'PASS' : 'FAIL'}** · ${artifact.takenAt} · commit \`${artifact.commit.slice(0, 7)}\`` +
    (artifact.workingTreeDirty ? ' · **working tree dirty**' : ''));
  lines.push('');
  lines.push('Method and metric definitions: [docs/PERFORMANCE.md](../PERFORMANCE.md).');
  lines.push('');

  lines.push('## Environment');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push(`| Machine | ${env.cpu}, ${env.cores} cores, ${env.totalMemoryGb} GB |`);
  lines.push(`| Platform | ${env.platform} |`);
  lines.push(`| Browser | ${env.browser} |`);
  lines.push(`| Node | ${env.node} |`);
  lines.push(`| Build | ${env.buildMode} |`);
  lines.push(`| Fixture | ${artifact.fixture?.fixtureId ?? 'unavailable'} (${artifact.fixture?.mode ?? '—'}) |`);
  lines.push('');

  lines.push('## Scenario');
  lines.push('');
  lines.push(`${scenario.runs} runs · ${scenario.warmupMs / 1000}s warmup discarded · ` +
    `${scenario.windowMs / 1000}s window · speed ${scenario.speed} · ${scenario.viewport} · ${scenario.interactions}`);
  lines.push('');
  lines.push(`Percentiles: ${artifact.method.percentile} over the last ${artifact.method.window} samples.`);
  lines.push('');

  lines.push('## Results');
  lines.push('');
  lines.push(`| Metric | ${runs.map(r => `Run ${r.run} p50 | Run ${r.run} p95 | Run ${r.run} p99 | Run ${r.run} n`).join(' | ')} |`);
  lines.push(`|---|${runs.map(() => '---|---|---|---|').join('')}`);
  for (const [key, label] of METRICS) {
    const cells = runs.flatMap(run => {
      const summary = run.measurements[key] ?? {};
      return [fixed(summary.p50), fixed(summary.p95), fixed(summary.p99), show(summary.count)];
    });
    lines.push(`| ${label} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  lines.push('| Counter | ' + runs.map(r => `Run ${r.run}`).join(' | ') + ' |');
  lines.push('|---|' + runs.map(() => '---|').join(''));
  for (const [key, label] of [['eventRate', 'Events/s'], ['lostFrames', 'Lost frames'],
                              ['bookGaps', 'Book gaps'], ['reconnects', 'Reconnects'],
                              ['droppedDisplay', 'Shed quotes'], ['longTasks', 'Long tasks'],
                              ['longTaskMs', 'Long-task ms']]) {
    lines.push(`| ${label} | ${runs.map(r => show(r.measurements[key])).join(' | ')} |`);
  }
  lines.push(`| Heap (MB) | ${runs.map(r => show(r.heapMb)).join(' | ')} |`);
  lines.push('');

  lines.push('## Thresholds');
  lines.push('');
  lines.push('| Check | Value | Limit | |');
  lines.push('|---|---|---|---|');
  for (const check of artifact.checks) {
    lines.push(`| ${check.metric} | ${show(check.value)} | ${check.kind} ${check.limit} | ${check.pass ? 'pass' : '**fail**'} |`);
  }
  lines.push('');

  lines.push('## Run-to-run stability');
  lines.push('');
  lines.push('A regression signal is only as good as the agreement between two runs of the same build.');
  lines.push('');
  lines.push('| Metric | Runs | Ratio | Limit | |');
  lines.push('|---|---|---|---|---|');
  for (const check of artifact.stability) {
    lines.push(`| ${check.metric} | ${check.values.map(show).join(', ')} | ` +
      `${check.ratio === null ? 'unavailable' : check.ratio.toFixed(2)} | ${check.limit} | ${check.pass ? 'pass' : '**fail**'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

const source = process.argv[2] ?? 'benchmark/results/latest.json';
process.stdout.write(`${report(JSON.parse(readFileSync(source, 'utf8')))}\n`);
