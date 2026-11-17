import type { ScheduledSession } from '../types/scheduler';

export interface WorkRange {
  startMs: number;
  endMs: number;
}

export interface FocusRun {
  session: ScheduledSession;
  targetMinutes: number;
  ranges: WorkRange[];
  runningSinceMs: number | null;
}

export const MINUTE_MS = 60_000;

export function workMilliseconds(ranges: readonly WorkRange[]): number {
  return ranges.reduce((sum, range) => sum + range.endMs - range.startMs, 0);
}

export function focusRanges(run: FocusRun, nowMs: number): WorkRange[] {
  if (run.runningSinceMs === null) return run.ranges;
  const outstanding = run.targetMinutes * MINUTE_MS - workMilliseconds(run.ranges);
  const endMs = Math.min(nowMs, run.runningSinceMs + outstanding);
  if (endMs <= run.runningSinceMs) return run.ranges;
  return [...run.ranges, { startMs: run.runningSinceMs, endMs }];
}

export function remainingFocusMs(run: FocusRun, nowMs: number): number {
  return Math.max(0, run.targetMinutes * MINUTE_MS - workMilliseconds(focusRanges(run, nowMs)));
}

export function creditedWork(ranges: readonly WorkRange[]) {
  const minutes = Math.floor(workMilliseconds(ranges) / MINUTE_MS);
  let remaining = minutes * MINUTE_MS;
  const creditedRanges: WorkRange[] = [];
  for (const range of ranges) {
    if (remaining <= 0) break;
    const duration = Math.min(remaining, range.endMs - range.startMs);
    creditedRanges.push({ startMs: range.startMs, endMs: range.startMs + duration });
    remaining -= duration;
  }
  return { minutes, ranges: creditedRanges };
}
