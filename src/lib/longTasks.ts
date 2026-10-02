/**
 * Long-task counter.
 *
 * A "long task" is a main-thread block of 50ms or more, which is where a
 * streaming terminal stops feeling live: quotes keep arriving and the screen
 * stops answering. Frame delay shows the symptom; this names the cause.
 *
 * `PerformanceObserver` and the `longtask` entry type are not universal — jsdom
 * has neither, Safari lacks the entry type — so this reports whether it is
 * observing at all, rather than reporting zero long tasks from a browser that
 * cannot see them.
 */
export class LongTaskCounter {
  private observer: PerformanceObserver | null = null;
  private tasks = 0;
  private blockedMs = 0;

  get count(): number { return this.tasks; }
  get totalMs(): number { return this.blockedMs; }
  /** False when this browser cannot report long tasks; zero would be a lie. */
  get observing(): boolean { return this.observer !== null; }

  start(): void {
    if (this.observer || typeof PerformanceObserver === 'undefined') return;
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          this.tasks++;
          this.blockedMs += entry.duration;
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      this.observer = observer;
    } catch {
      // An unsupported entry type throws. Stay unobserving rather than pretend.
      this.observer = null;
    }
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  reset(): void {
    this.tasks = 0;
    this.blockedMs = 0;
  }
}
