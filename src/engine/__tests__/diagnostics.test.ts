import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EnergyWindow, FixedBlock, Goal, ScheduledSession } from '../../types/scheduler';
import { addDays } from '../../utils/dates';
import { analyzeScheduleHealth } from '../diagnostics';
import { generateSchedule, optimizeSchedule, type Schedule } from '../solver';

const monday = '2026-11-16';
const goal: Goal = {
  id: 'exam', title: 'Экзамен', totalMinutesRequired: 120, completedMinutes: 0, deadlineISO: monday,
  priority: 5, minSessionMinutes: 30, maxSessionMinutes: 90, preferredEnergy: 'high', color: '#A5B4FC',
};
const peak: EnergyWindow = { startMinute: 600, endMinute: 720, level: 'high' };

function session(id: string, startMinute: number, endMinute: number, dateISO = monday, isLocked = false): ScheduledSession {
  return { id, title: goal.title, goalId: goal.id, dateISO, startMinute, endMinute, isLocked, energyMatchScore: 0 };
}

function plan(goals: Goal[], sessions: ScheduledSession[], fixedBlocks: FixedBlock[] = [], energyWindows = [peak]): Schedule {
  return { params: { startDateISO: monday, goals, fixedBlocks, energyWindows }, sessions, unscheduledMinutes: {} };
}

test('weights real peak overlap by minutes, ignoring stale stored scores, and suggests an available peak', () => {
  const input = plan([goal], [session('a', 570, 630), session('b', 840, 900)]);
  const result = analyzeScheduleHealth([goal], [], [peak], input);
  assert.equal(result.difficultMinutes, 120);
  assert.equal(result.energyAlignmentPercent, 25);
  assert.equal(result.burnoutRisk, 'low');
  assert.ok(result.insights.some(insight => insight.type === 'tip' && /пике энергии/.test(insight.message)));
});

test('reports the daily deadline shortfall and estimated delay', () => {
  const dueTomorrow = { ...goal, deadlineISO: addDays(monday, 1) };
  const input = plan([dueTomorrow], [session('a', 600, 660)]);
  const result = analyzeScheduleHealth([dueTomorrow], [], [peak], input);
  assert.ok(result.insights.some(insight => insight.type === 'warning' &&
    /30 мин\/день \(60 мин всего\).*2 дн/.test(insight.message)));
});

test('detects a high schedule load and constrained free windows after rest buffers', () => {
  const recurring: FixedBlock[] = [
    { id: 'before', title: 'До работы', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], category: 'занято', startMinute: 0, endMinute: 525 },
    { id: 'after', title: 'После работы', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], category: 'занято', startMinute: 630, endMinute: 1440 },
  ];
  const busyGoal = { ...goal, totalMinutesRequired: 525, deadlineISO: addDays(monday, 6) };
  const input = generateSchedule({ startDateISO: monday, fixedBlocks: recurring, goals: [busyGoal], energyWindows: [peak] });
  const result = analyzeScheduleHealth([busyGoal], recurring, [peak], input);
  assert.equal(result.burnoutRisk, 'high');
  assert.equal(result.overtimeDays, 7);
  assert.ok(result.insights.some(insight => insight.type === 'warning' && /буферов отдыха/.test(insight.message)));
});

test('does not flag a goal beyond the horizon that is on pace to finish', () => {
  const future = { ...goal, totalMinutesRequired: 700, deadlineISO: addDays(monday, 13) };
  const slots = Array.from({ length: 7 }, (_, index) => session(String(index), 600, 650, addDays(monday, index)));
  const result = analyzeScheduleHealth([future], [], [peak], plan([future], slots));
  assert.ok(result.insights.every(insight => insight.type !== 'warning'));
});

test('an empty plan reports no work in peaks and no overload', () => {
  const result = analyzeScheduleHealth([], [], [], plan([], [], [], []));
  assert.equal(result.burnoutRisk, 'low');
  assert.equal(result.energyAlignmentPercent, 0);
  assert.equal(result.difficultMinutes, 0);
  assert.equal(result.insights[0].type, 'tip');
});

test('auto-optimization improves energy while preserving past, pinned and protected sessions', () => {
  const active = session('active', 480, 510);
  const past = session('past', 360, 390);
  const pinned = session('pinned', 810, 840, monday, true);
  const movable = session('movable', 900, 930);
  const input = plan([goal], [past, active, pinned, movable]);
  const optimized = optimizeSchedule(input, { todayMinute: 410, protectedSessionId: active.id });
  for (const kept of [past, active, pinned]) {
    assert.deepEqual(optimized.sessions.find(candidate => candidate.id === kept.id), kept);
  }
  const moved = optimized.sessions.find(candidate => candidate.id === movable.id)!;
  assert.equal(moved.energyMatchScore, 1);
  assert.equal(moved.endMinute - moved.startMinute, 30);
  assert.equal(moved.dateISO, monday);
  assert.equal(input.sessions.at(-1)?.startMinute, 900);
});
