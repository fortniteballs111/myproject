import type { Goal, ScheduledSession } from '../types/scheduler';
import { dateIndex } from '../utils/dates';
import { generateSchedule, type Schedule } from './solver';

export function forecastGoal(goal: Goal, schedule: Schedule) {
  let missingMinutes = Math.max(0, goal.totalMinutesRequired - goal.completedMinutes);
  let finish: ScheduledSession | undefined;
  if (missingMinutes && goal.deadlineISO >= schedule.params.startDateISO) {
    for (const session of schedule.sessions) {
      if (session.goalId !== goal.id || session.dateISO > goal.deadlineISO) continue;
      missingMinutes = Math.max(0, missingMinutes - (session.endMinute - session.startMinute));
      if (!missingMinutes) {
        finish = session;
        break;
      }
    }
  }
  return { missingMinutes, finish };
}

export function projectGoal(
  schedule: Schedule,
  goals: readonly Goal[],
  input: Omit<Goal, 'id' | 'completedMinutes'>,
  focusedId?: string,
) {
  let id = 'what-if';
  while (goals.some(goal => goal.id === id)) id += '-';
  const goal = { ...input, id, completedMinutes: 0 };
  const focused = schedule.sessions.find(session => session.id === focusedId);
  const locked = schedule.params.lockedSessions ?? [];
  const next = generateSchedule({
    ...schedule.params,
    goals: [...goals, goal],
    lockedSessions: focused && !locked.some(session => session.id === focused.id)
      ? [...locked, { ...focused, isLocked: true }] : locked,
  });

  return {
    goal,
    forecast: forecastGoal(goal, next),
    existing: goals.map(existing => {
      const before = forecastGoal(existing, schedule);
      const after = forecastGoal(existing, next);
      const shiftMinutes = before.finish && after.finish
        ? (dateIndex(after.finish.dateISO) - dateIndex(before.finish.dateISO)) * 1440 +
          after.finish.endMinute - before.finish.endMinute
        : undefined;
      return { goal: existing, before, after, shiftMinutes };
    }),
  };
}
