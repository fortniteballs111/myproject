import assert from 'node:assert/strict';
import { test } from 'node:test';

import { creditedWork, focusRanges, MINUTE_MS, remainingFocusMs, type FocusRun } from '../focus';

const run: FocusRun = {
  session: {
    id: 's-1', goalId: 'g-1', title: 'Goal', dateISO: '2026-11-16',
    startMinute: 600, endMinute: 630, energyMatchScore: 1, isLocked: false,
  },
  targetMinutes: 30, runningSinceMs: 0, ranges: [],
};

test('clamps work to timer expiry even after a long background gap', () => {
  assert.equal(remainingFocusMs(run, 70 * MINUTE_MS), 0);
  assert.deepEqual(creditedWork(focusRanges(run, 70 * MINUTE_MS)), {
    minutes: 30, ranges: [{ startMs: 0, endMs: 30 * MINUTE_MS }],
  });
});

test('excludes paused time and credits only full elapsed minutes', () => {
  const paused = { ...run, ranges: focusRanges(run, 2.5 * MINUTE_MS), runningSinceMs: null };
  assert.equal(remainingFocusMs(paused, 60 * MINUTE_MS), 27.5 * MINUTE_MS);
  const resumed = { ...paused, targetMinutes: 45, runningSinceMs: 60 * MINUTE_MS };
  const result = creditedWork(focusRanges(resumed, 61 * MINUTE_MS));
  assert.equal(result.minutes, 3);
  assert.deepEqual(result.ranges, [
    { startMs: 0, endMs: 2.5 * MINUTE_MS },
    { startMs: 60 * MINUTE_MS, endMs: 60.5 * MINUTE_MS },
  ]);
});

test('award zero minutes when ended within the first minute', () => {
  assert.deepEqual(creditedWork(focusRanges(run, 59_999)), { minutes: 0, ranges: [] });
});
