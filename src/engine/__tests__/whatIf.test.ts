import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FixedBlock, Goal } from '../../types/scheduler';
import { generateSchedule } from '../solver';
import { projectGoal } from '../whatIf';

const monday = '2026-11-16';
const tuesday = '2026-11-17';
const existing: Goal = {
  id: 'existing', title: 'Existing', totalMinutesRequired: 60, completedMinutes: 0,
  deadlineISO: tuesday, priority: 3, minSessionMinutes: 60, maxSessionMinutes: 60,
  preferredEnergy: 'medium', color: '#A5B4FC',
};
const fixed: FixedBlock = {
  id: 'work', title: 'Work', startMinute: 75, endMinute: 1440, daysOfWeek: [1, 2], category: 'Work',
};
const hypothetical = { ...existing, title: 'Hypothetical', deadlineISO: monday, priority: 5 } as const;

test('replans only the scenario and reports the completion shift for an existing goal', () => {
  const goals = [existing];
  const schedule = generateSchedule({ startDateISO: monday, fixedBlocks: [fixed], energyWindows: [], goals });
  const before = structuredClone({ schedule, goals });
  const preview = projectGoal(schedule, goals, hypothetical);
  assert.equal(preview.forecast.finish?.dateISO, monday);
  // The fixed block also requires a rest buffer after midnight on Tuesday.
  assert.equal(preview.existing[0].before.finish?.dateISO, monday);
  assert.equal(preview.existing[0].after.finish, undefined);
  assert.equal(preview.existing[0].after.missingMinutes, 60);
  assert.deepEqual({ schedule, goals }, before);

  const extended = generateSchedule({
    ...schedule.params,
    fixedBlocks: [{ ...fixed, daysOfWeek: [1] }],
  });
  const shifted = projectGoal(extended, goals, hypothetical);
  assert.equal(shifted.existing[0].after.finish?.dateISO, tuesday);
  assert.equal(shifted.existing[0].shiftMinutes, 1455);
});

test('reserves an in-progress session and reports a missed deadline for the new goal', () => {
  const schedule = generateSchedule({
    startDateISO: monday, fixedBlocks: [fixed], energyWindows: [], goals: [existing],
  });
  const [focus] = schedule.sessions;
  const preview = projectGoal(schedule, [existing], hypothetical, focus.id);

  assert.equal(preview.forecast.finish, undefined);
  assert.equal(preview.forecast.missingMinutes, 60);
  assert.equal(preview.existing[0].after.finish?.id, focus.id);
  assert.equal(preview.existing[0].shiftMinutes, 0);
  assert.equal(focus.isLocked, false);
});
