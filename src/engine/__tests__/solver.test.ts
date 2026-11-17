import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FixedBlock, Goal, ScheduledSession } from '../../types/scheduler';
import { addDays, dateIndex } from '../../utils/dates';
import { generateSchedule, rescheduleOnDisruption } from '../solver';

const monday = '2026-11-16';
const tuesday = addDays(monday, 1);
const weekdays = [0, 1, 2, 3, 4, 5, 6];
const goal: Goal = {
  id: 'exam', title: 'Exam', totalMinutesRequired: 120, completedMinutes: 0,
  deadlineISO: addDays(monday, 6), priority: 5, minSessionMinutes: 60,
  maxSessionMinutes: 60, preferredEnergy: 'high', color: '#6366F1',
};

function fixed(id: string, startMinute: number, endMinute: number, daysOfWeek = weekdays): FixedBlock {
  return { id, title: id, startMinute, endMinute, daysOfWeek, category: 'reserved' };
}

function locked(id: string, dateISO: string, startMinute: number, endMinute: number): ScheduledSession {
  return { id, goalId: goal.id, title: goal.title, dateISO, startMinute, endMinute, energyMatchScore: 0, isLocked: true };
}

function assertBuffer(sessions: ScheduledSession[]) {
  for (let index = 1; index < sessions.length; index++) {
    const previous = sessions[index - 1];
    const next = sessions[index];
    const distance = (dateIndex(next.dateISO) - dateIndex(previous.dateISO)) * 1440;
    assert.ok(distance + next.startMinute - previous.endMinute >= 15);
  }
}

test('leaves an exact 15-minute buffer on both sides of fixed blocks and between sessions', () => {
  const result = generateSchedule({
    startDateISO: monday,
    fixedBlocks: [fixed('sleep', 0, 420), fixed('school', 585, 1440)],
    goals: [goal],
    energyWindows: [],
  });

  assert.deepEqual(result.sessions.map(session => [session.startMinute, session.endMinute]), [[435, 495], [510, 570]]);
  assertBuffer(result.sessions);
  assert.equal(result.unscheduledMinutes.exam, 0);
});

test('keeps locked sessions and enforces rest across midnight', () => {
  const pinned = locked('pinned', monday, 1380, 1440);
  const result = generateSchedule({
    startDateISO: monday,
    fixedBlocks: [fixed('busy', 0, 1365, [1])],
    goals: [goal],
    energyWindows: [],
    lockedSessions: [pinned],
  });

  assert.deepEqual(result.sessions[0], pinned);
  assert.equal(result.sessions[1].dateISO, tuesday);
  assert.equal(result.sessions[1].startMinute, 15);
  assertBuffer(result.sessions);
});

test('improves energy alignment without moving a session past its deadline', () => {
  const result = generateSchedule({
    startDateISO: monday,
    fixedBlocks: [],
    goals: [{ ...goal, totalMinutesRequired: 60, deadlineISO: monday }],
    energyWindows: [
      { startMinute: 0, endMinute: 240, level: 'low' },
      { startMinute: 240, endMinute: 1440, level: 'high' },
    ],
  });

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].dateISO, monday);
  assert.equal(result.sessions[0].energyMatchScore, 1);
});

test('moves missed sessions forward around fixed and locked blocks while preserving past sessions', () => {
  const pinned = locked('pinned', tuesday, 510, 570);
  const initial = generateSchedule({
    startDateISO: monday,
    fixedBlocks: [fixed('sleep', 0, 420), fixed('busy', 585, 1440, [1, 2])],
    goals: [{ ...goal, totalMinutesRequired: 180 }],
    energyWindows: [],
    lockedSessions: [pinned],
  });
  const [done, missed] = initial.sessions;
  const updated = rescheduleOnDisruption(initial, monday, 500);
  const moved = updated.sessions.find(session => session.id === missed.id);

  assert.equal(initial.sessions[1].dateISO, monday);
  assert.deepEqual(updated.sessions.find(session => session.id === done.id), done);
  assert.deepEqual(updated.sessions.find(session => session.id === pinned.id), pinned);
  assert.equal(moved?.dateISO, tuesday);
  assert.equal(moved?.startMinute, 435);
  assert.equal(moved?.endMinute, 495);
  assertBuffer(updated.sessions);
  assert.equal(updated.unscheduledMinutes.exam, 0);
});

test('a partial disruption moves only overlapping sessions and reports work blocked by a deadline', () => {
  const initial = generateSchedule({
    startDateISO: monday,
    fixedBlocks: [],
    goals: [{ ...goal, deadlineISO: monday }],
    energyWindows: [],
  });
  const [missed, unaffected] = initial.sessions;
  const partial = rescheduleOnDisruption(initial, monday, 0, 60);
  assert.deepEqual(partial.sessions[0], unaffected);
  assert.equal(partial.sessions[1].id, missed.id);
  assert.equal(partial.sessions[1].startMinute, 150);
  const full = rescheduleOnDisruption(initial, monday, 0);
  assert.deepEqual(full.sessions, []);
  assert.equal(full.unscheduledMinutes.exam, 120);
});

test('allocates scarce time using priority and deadline proximity', () => {
  const result = generateSchedule({
    startDateISO: monday,
    fixedBlocks: [fixed('before', 0, 420), fixed('after', 510, 1440)],
    goals: [
      { ...goal, id: 'later', priority: 5, deadlineISO: addDays(monday, 8) },
      { ...goal, id: 'urgent-low', priority: 2, totalMinutesRequired: 60, deadlineISO: monday },
      { ...goal, id: 'urgent-high', priority: 3, totalMinutesRequired: 60, deadlineISO: monday },
    ],
    energyWindows: [],
  });

  assert.equal(result.sessions[0].goalId, 'urgent-high');
  assert.equal(result.unscheduledMinutes['urgent-low'], 60);
  assert.equal(result.unscheduledMinutes.later, 0);
});

test('keeps completed or unavailable time out of regenerated and recovered sessions', () => {
  const unavailable = { dateISO: monday, startMinute: 75, endMinute: 180 };
  const initial = generateSchedule({
    startDateISO: monday,
    fixedBlocks: [],
    goals: [{ ...goal, deadlineISO: monday }],
    energyWindows: [],
    unavailable: [unavailable],
  });
  assert.deepEqual(initial.sessions.map(session => session.startMinute), [0, 195]);

  const recovered = rescheduleOnDisruption(initial, monday, 0, 60);
  assert.deepEqual(recovered.sessions.map(session => session.startMinute), [195, 270]);
  assert.equal(recovered.unscheduledMinutes.exam, 0);
  assertBuffer(recovered.sessions);
});

test('can start at the end of an interruption without treating it as a task needing rest', () => {
  const result = generateSchedule({
    startDateISO: monday,
    fixedBlocks: [fixed('end', 135, 1440)],
    goals: [{ ...goal, totalMinutesRequired: 60, deadlineISO: monday }],
    energyWindows: [],
    unavailable: [{ dateISO: monday, startMinute: 0, endMinute: 60, requiresBuffer: false }],
  });

  assert.deepEqual(result.sessions.map(session => [session.startMinute, session.endMinute]), [[60, 120]]);
});
