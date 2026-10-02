/**
 * What the feed actually measured.
 *
 * Every row here is a real sample from `docs/PERFORMANCE.md`, drawn from a
 * stated window. Nothing is smoothed into a single reassuring "latency"
 * figure, and a metric with no samples reads as unavailable rather than zero —
 * a reviewer should be able to tell "we did not measure this" from "this is
 * fast", because those are very different claims.
 */
import { useAppSelector } from '@/store/hooks';
import type { SampleSummary } from '@/lib/telemetry';
import type { PerformanceReport } from '@/store/slices/marketSlice';

interface Metric {
  key: keyof PerformanceReport & string;
  label: string;
  unit: string;
  explanation: string;
}

const METRICS: Metric[] = [
  { key: 'transportJitterMs', label: 'Transport jitter', unit: 'ms',
    explanation: 'How much further apart this browser saw two frames than the server sent them. It is a difference of intervals, so the unknown offset between the two clocks cancels. Positive means the stream stretched; negative is the catch-up after.' },
  { key: 'processingMs', label: 'Receive → commit', unit: 'ms',
    explanation: 'From a frame arriving on the socket to it being applied to the store. This includes the wait for the next animation frame, because display frames are drained a frame at a time on purpose — so most of this number is deliberate batching, not overhead. Browser clock only.' },
  { key: 'frameDelayMs', label: 'Frame delay', unit: 'ms',
    explanation: 'Interval between animation-frame drains. A rising p99 here is what a stalled screen feels like.' },
  { key: 'roundTripMs', label: 'Round trip', unit: 'ms',
    explanation: 'Ping to pong, measured on one clock. It is not halved: that would assume a symmetric path this client cannot verify.' },
  { key: 'replayLagMs', label: 'Replay lag', unit: 'ms',
    explanation: 'How far the rendered market trails the session clock, both read in replay event time.' },
];

function value(summary: SampleSummary | undefined, percentile: 'p50' | 'p95' | 'p99'): string {
  const reading = summary?.[percentile];
  return reading === null || reading === undefined ? '—' : reading.toFixed(1);
}

export function PerformanceReadout({ onReset }: { onReset: () => void }) {
  const report = useAppSelector(s => s.market.measurements);
  const replay = useAppSelector(s => s.replay.status);

  function exportReport() {
    if (!report) return;
    const artifact = {
      takenAt: new Date().toISOString(),
      // Environment belongs with the numbers: a percentile without a machine
      // behind it cannot be compared with anything.
      environment: { userAgent: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}` },
      replay: replay && { fixtureId: replay.fixtureId, mode: replay.mode, speed: replay.speed,
                          eventTimeNs: replay.eventTimeNs, unit: replay.unit },
      method: { window: report.windowSize, percentile: 'nearest rank', protocol: 'docs/PERFORMANCE.md' },
      measurements: report,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `vanna-measurements-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-label="Feed measurements" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wider text-vanna-text-secondary">MEASUREMENTS</h3>
        <div className="flex gap-2">
          <button type="button" className="desk-button" onClick={onReset}>Reset measurements</button>
          <button type="button" className="desk-button" disabled={!report} onClick={exportReport}>Export</button>
        </div>
      </div>

      {!report ? (
        <p data-testid="measurements-empty" className="text-xs text-vanna-text-secondary">
          No samples yet. Measurements appear once the feed has been running for a sampling window.
        </p>
      ) : (
        <>
          <table className="w-full text-xs font-mono" aria-label="Latency percentiles">
            <thead>
              <tr className="text-vanna-text-secondary text-left">
                <th scope="col" className="font-normal">Metric</th>
                <th scope="col" className="font-normal text-right">p50</th>
                <th scope="col" className="font-normal text-right">p95</th>
                <th scope="col" className="font-normal text-right">p99</th>
                <th scope="col" className="font-normal text-right">n</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map(metric => {
                const summary = report[metric.key] as SampleSummary;
                return (
                  <tr key={metric.key} data-metric={metric.key}>
                    <th scope="row" className="font-normal text-left text-vanna-text-secondary">{metric.label}</th>
                    <td className="text-right tabular-nums">{value(summary, 'p50')}</td>
                    <td className="text-right tabular-nums">{value(summary, 'p95')}</td>
                    <td className="text-right tabular-nums">{value(summary, 'p99')}</td>
                    <td className="text-right tabular-nums text-vanna-text-secondary">{summary?.count ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-vanna-text-secondary">events/s</dt>
              <dd className="font-mono" data-metric="eventRate">{report.eventRate.toFixed(1)}</dd></div>
            <div><dt className="text-vanna-text-secondary">lost frames</dt>
              <dd className="font-mono" data-metric="lostFrames">{report.lostFrames}</dd></div>
            <div><dt className="text-vanna-text-secondary">book gaps</dt>
              <dd className="font-mono" data-metric="bookGaps">{report.bookGaps}</dd></div>
            <div><dt className="text-vanna-text-secondary">reconnects</dt>
              <dd className="font-mono" data-metric="reconnects">{report.reconnects}</dd></div>
            <div><dt className="text-vanna-text-secondary">long tasks</dt>
              <dd className="font-mono" data-metric="longTasks">
                {report.longTasks === null ? 'unavailable' : `${report.longTasks} · ${report.longTaskMs}ms`}
              </dd></div>
            <div><dt className="text-vanna-text-secondary">shed quotes</dt>
              <dd className="font-mono" data-metric="droppedDisplay">{report.droppedDisplay}</dd></div>
          </dl>

          {report.stampedFrames === 0 && report.unstampedFrames > 0 && (
            <p role="status" className="text-[11px] text-amber-300">
              Server frame stamps are off, so transport jitter and lost frames cannot be measured.
            </p>
          )}

          <details className="text-[11px] text-vanna-text-secondary">
            <summary className="cursor-pointer">What these mean</summary>
            <dl className="mt-2 space-y-2">
              {METRICS.map(metric => (
                <div key={metric.key}>
                  <dt className="text-vanna-text">{metric.label}</dt>
                  <dd>{metric.explanation}</dd>
                </div>
              ))}
              <div>
                <dt className="text-vanna-text">Method</dt>
                <dd>
                  Percentiles are nearest rank over a rolling window of the last {report.windowSize} samples,
                  so a spike cannot hide behind a long history. One-way latency is not reported: the server
                  and browser clocks are not synchronised, so it cannot be measured here.
                </dd>
              </div>
            </dl>
          </details>
        </>
      )}
    </section>
  );
}
