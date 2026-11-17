import type { EnergyWindow, FixedBlock, Goal, ScheduledSession } from '../types/scheduler';
import { dateIndex } from '../utils/dates';
import { scheduleAvailability, type Schedule } from './solver';

export interface ScheduleInsight {
  type: 'warning' | 'tip' | 'success';
  message: string;
}

export interface ScheduleHealth {
  burnoutRisk: 'low' | 'medium' | 'high';
  energyAlignmentPercent: number;
  difficultMinutes: number;
  overtimeDays: number;
  insights: ScheduleInsight[];
}

type Window = { startMinute: number; endMinute: number };

const duration = (window: Window) => window.endMinute - window.startMinute;
const overlap = (a: Window, b: Window) =>
  Math.max(0, Math.min(a.endMinute, b.endMinute) - Math.max(a.startMinute, b.startMinute));

export function analyzeScheduleHealth(
  goals: readonly Goal[],
  fixedBlocks: readonly FixedBlock[],
  energyWindows: readonly EnergyWindow[],
  schedule: Schedule,
): ScheduleHealth {
  const params = { ...schedule.params, fixedBlocks, energyWindows, goals };
  const capacity = scheduleAvailability(params);
  const spare = scheduleAvailability(params, schedule.sessions);
  const fixedOnly = params.unavailable?.length ? scheduleAvailability({ ...params, unavailable: [] }) : capacity;
  const peaks = energyWindows.filter(window => window.level === 'high');
  const difficultGoals = new Set(goals.filter(goal => goal.preferredEnergy === 'high').map(goal => goal.id));
  const byDay = new Map<string, ScheduledSession[]>();
  const byGoal = new Map<string, ScheduledSession[]>();
  for (const session of schedule.sessions) {
    const day = byDay.get(session.dateISO) ?? [];
    day.push(session);
    byDay.set(session.dateISO, day);
    const goalSessions = byGoal.get(session.goalId) ?? [];
    goalSessions.push(session);
    byGoal.set(session.goalId, goalSessions);
  }

  let usableMinutes = 0;
  let plannedMinutes = 0;
  let overtimeDays = 0;
  const constrainedDays = fixedOnly.filter(({ windows }) =>
    windows.reduce((sum, window) => sum + duration(window), 0) < 120 ||
    !windows.some(window => duration(window) >= 30)).length;
  let difficultMinutes = 0;
  let peakMinutes = 0;

  for (const { dateISO, windows } of capacity) {
    const sessions = byDay.get(dateISO) ?? [];
    const usable = windows.reduce((sum, window) => sum + duration(window), 0);
    const planned = sessions.reduce((sum, session) => sum + duration(session), 0);
    const offHours = sessions.reduce((sum, session) =>
      sum + duration(session) - overlap(session, { startMinute: 360, endMinute: 1320 }), 0);
    usableMinutes += usable;
    plannedMinutes += planned;
    // Six hours of focused work or at least 30 minutes outside 06:00–22:00 counts as overtime.
    if (planned > 360 || offHours >= 30 || (planned > 0 && planned >= 0.9 * usable)) overtimeDays++;

    for (const session of sessions) {
      if (!difficultGoals.has(session.goalId)) continue;
      difficultMinutes += duration(session);
      for (const peak of peaks) peakMinutes += overlap(peak, session);
    }
  }

  const utilization = usableMinutes ? plannedMinutes / usableMinutes : Number(plannedMinutes > 0);
  const burnoutRisk = utilization >= 0.85 || overtimeDays >= 3 ? 'high' :
    utilization >= 0.65 || overtimeDays >= 1 ? 'medium' : 'low';
  const insights: ScheduleInsight[] = [];

  if (burnoutRisk !== 'low') {
    insights.push({
      type: 'warning',
      message: 'Занято ' + Math.round(utilization * 100) + '% свободного времени. Дней с переработкой: ' +
        overtimeDays + '. Перенесите часть сессий на менее загруженные дни.',
    });
  }
  if (constrainedDays > 0) {
    insights.push({
      type: 'warning',
      message: 'Дней с тесным расписанием: ' + constrainedDays +
        '. Сократите или разнесите фиксированные блоки, чтобы освободить хотя бы одно окно на 30 минут сверх буферов отдыха.',
    });
  }

  const horizonStart = dateIndex(schedule.params.startDateISO);
  for (const goal of goals) {
    const remaining = Math.max(0, goal.totalMinutesRequired - goal.completedMinutes);
    if (!remaining) continue;
    const deadlineOffset = dateIndex(goal.deadlineISO) - horizonStart;
    const sessions = byGoal.get(goal.id) ?? [];
    const allocated = sessions.filter(session => session.dateISO <= goal.deadlineISO)
      .reduce((sum, session) => sum + duration(session), 0);
    const daysBefore = Math.max(1, deadlineOffset + 1);
    const availableDaysInPlan = Math.min(daysBefore, capacity.length);
    const openDays = spare.filter(({ windows }) => windows.some(window => duration(window) >= goal.minSessionMinutes)).length;
    const rawPace = allocated / availableDaysInPlan;
    // Without any historical plan for this goal, estimate one session on days with a suitable gap.
    const fallbackPace = goal.minSessionMinutes * openDays / capacity.length;
    const pace = rawPace || fallbackPace;
    const projectedOutsidePlan = Math.max(0, daysBefore - capacity.length) * pace;
    const shortfall = Math.max(0, Math.ceil(remaining - allocated - projectedOutsidePlan));
    if (!shortfall) continue;

    const delayDays = pace > 0 ? Math.ceil(shortfall / pace) + Math.max(0, -deadlineOffset) : null;
    const delay = delayDays === null ? 'Свободных окон для прогноза нет.' :
      'Оценка задержки: ' + delayDays + ' дн. при оценочном темпе.';
    const daily = deadlineOffset < 0 ? 'Дедлайн прошёл, осталось ' + shortfall + ' мин. ' :
      'До дедлайна не хватает ' + Math.ceil(shortfall / daysBefore) + ' мин/день (' + shortfall + ' мин всего). ';
    const smallRemainder = remaining - allocated < goal.minSessionMinutes ?
      ' Можно уменьшить минимальную длительность сессии.' : '';
    insights.push({ type: 'warning', message: '«' + goal.title + '». ' + daily + delay + smallRemainder });
  }

  const peakCandidate = [...goals].sort((a, b) => b.priority - a.priority).find(goal => {
    if (goal.priority < 4 || goal.preferredEnergy !== 'high') return false;
    return (byGoal.get(goal.id) ?? []).some(session => !session.isLocked &&
      peaks.reduce((sum, peak) => sum + overlap(peak, session), 0) < duration(session) &&
      spare.some(({ dateISO, windows }) => dateISO <= goal.deadlineISO &&
        windows.some(window => peaks.some(peak => overlap(window, peak) >= duration(session)))));
  });
  if (peakCandidate) {
    insights.push({ type: 'tip', message: 'В пике энергии есть свободное окно для цели «' + peakCandidate.title + '». Попробуйте автооптимизацию.' });
  }
  if (insights.length === 0) {
    insights.push(plannedMinutes
      ? { type: 'success', message: 'В текущем плане есть запас времени. Узких мест по дедлайнам и нагрузке не найдено.' }
      : { type: 'tip', message: 'Добавьте активную цель, чтобы оценить нагрузку и попадание в пики энергии.' });
  }

  return {
    burnoutRisk, difficultMinutes, overtimeDays, insights,
    energyAlignmentPercent: difficultMinutes ? Math.round(100 * peakMinutes / difficultMinutes) : 0,
  };
}
