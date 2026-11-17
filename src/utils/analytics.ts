import { MINUTE_MS } from '../engine/focus';
import type { CompletedSession } from '../store/useSchedulerStore';
import type { Goal } from '../types/scheduler';
import { addDays, localDateISO, weekday } from './dates';

export function summarizeActivity(
  sessions: readonly CompletedSession[],
  goals: readonly Goal[],
  disruptionHistory: readonly number[],
  today: string,
) {
  const first = addDays(today, -6);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(first, index));
  const dailyGoals = new Map(dates.map(date => [date, new Map<string, number>()]));
  const focusHours = Array<number>(24).fill(0);
  const disruptionHours = Array<number>(24).fill(0);
  const colors = new Map(goals.map(goal => [goal.id, goal.color]));
  const labels = new Map(goals.map(goal => [goal.id, goal.title]));

  const contribute = (id: string, date: string, minutes: number, hour?: number) => {
    const daily = dailyGoals.get(date);
    if (!daily) return;
    daily.set(id, (daily.get(id) ?? 0) + minutes);
    if (hour !== undefined) focusHours[hour] += minutes;
  };

  for (const session of sessions) {
    if (session.goalColor && !colors.has(session.goalId)) colors.set(session.goalId, session.goalColor);
    if (!labels.has(session.goalId)) labels.set(session.goalId, session.title);
    if (session.workRanges) {
      for (const { startMs, endMs } of session.workRanges) {
        for (let cursor = startMs; cursor < endMs;) {
          const local = new Date(cursor);
          const nextHour = cursor + 60 * MINUTE_MS - local.getMinutes() * MINUTE_MS -
            local.getSeconds() * 1000 - local.getMilliseconds();
          const boundary = Math.min(endMs, nextHour);
          contribute(session.goalId, localDateISO(local), (boundary - cursor) / MINUTE_MS, local.getHours());
          cursor = boundary;
        }
      }
    } else {
      const date = session.completedDateISO ?? session.dateISO;
      const hour = session.completedAtMs !== undefined ? new Date(session.completedAtMs).getHours() : undefined;
      contribute(session.goalId, date, session.workMinutes ?? session.endMinute - session.startMinute, hour);
    }
  }
  for (const timestamp of disruptionHistory) {
    const date = new Date(timestamp);
    if (dailyGoals.has(localDateISO(date))) disruptionHours[date.getHours()]++;
  }
  const bars = dates.map(date => {
    const segments = [...dailyGoals.get(date)!].map(([id, minutes]) => ({
      id, minutes, color: colors.get(id) ?? '#A1A1AA', title: labels.get(id) ?? id,
    }));
    return {
      date, weekday: weekday(date), segments,
      minutes: segments.reduce((sum, segment) => sum + segment.minutes, 0),
    };
  }).sort((a, b) => (a.weekday + 6) % 7 - (b.weekday + 6) % 7);
  const legend = [...new Map(bars.flatMap(day => day.segments).map(item => [item.id, item])).values()];
  return { bars, legend, focusHours, disruptionHours, totalMinutes: bars.reduce((sum, day) => sum + day.minutes, 0) };
}
