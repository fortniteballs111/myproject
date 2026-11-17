import type { EnergyLevel, EnergyWindow, FixedBlock, Goal, ScheduledSession } from '../types/scheduler';
import { addDays, dateIndex, localDateISO, weekday } from '../utils/dates';

const DAY = 1440;
const HORIZON = 7;
const BUFFER = 15;
const SEARCH_ITERATIONS = 500;
const ENERGY_RANK: Record<EnergyLevel, number> = { low: 0, medium: 1, high: 2 };

export interface UnavailableInterval {
  dateISO: string;
  startMinute: number;
  endMinute: number;
  /** An interruption can end immediately before a new session. */
  requiresBuffer?: boolean;
}

export interface ScheduleParams {
  startDateISO?: string;
  fixedBlocks: readonly FixedBlock[];
  goals: readonly Goal[];
  /** Recurring daily energy profile. Windows must not overlap. */
  energyWindows: readonly EnergyWindow[];
  lockedSessions?: readonly ScheduledSession[];
  unavailable?: readonly UnavailableInterval[];
}

export interface Schedule {
  /** Kept with the sessions so disruption recovery can reuse the original constraints. */
  params: ScheduleParams & { startDateISO: string };
  sessions: ScheduledSession[];
  unscheduledMinutes: Record<string, number>;
}

type Span = { start: number; end: number; withoutBuffer?: boolean };

function timeRange(start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > DAY || start >= end) {
    throw new RangeError('Expected a nonempty minute interval within 0–1440');
  }
}

function validate(params: Schedule['params']): void {
  params.fixedBlocks.forEach(block => timeRange(block.startMinute, block.endMinute));
  let previousEnd = 0;
  for (const window of [...params.energyWindows].sort((a, b) => a.startMinute - b.startMinute)) {
    timeRange(window.startMinute, window.endMinute);
    if (window.startMinute < previousEnd) throw new RangeError('Energy windows overlap');
    previousEnd = window.endMinute;
  }
  for (const goal of params.goals) {
    timeRange(0, goal.maxSessionMinutes);
    timeRange(0, goal.minSessionMinutes);
    dateIndex(goal.deadlineISO);
    if (goal.minSessionMinutes > goal.maxSessionMinutes ||
        !Number.isInteger(goal.totalMinutesRequired) || goal.totalMinutesRequired < 0 ||
        !Number.isInteger(goal.completedMinutes) || goal.completedMinutes < 0) {
      throw new RangeError('Invalid session bounds or minute budget for goal ' + goal.id);
    }
  }
  for (const interval of params.unavailable ?? []) {
    timeRange(interval.startMinute, interval.endMinute);
    dateIndex(interval.dateISO);
  }
  for (const session of params.lockedSessions ?? []) {
    timeRange(session.startMinute, session.endMinute);
    dateIndex(session.dateISO);
  }
}

function createContext(params: Schedule['params']) {
  const base = dateIndex(params.startDateISO);
  const dates = Array.from({ length: HORIZON }, (_, day) => addDays(params.startDateISO, day));
  const fixed: Span[] = [];
  // Include blocks just outside the horizon so the buffer also holds at midnight.
  for (let day = -1; day <= HORIZON; day++) {
    const dayOfWeek = weekday(addDays(params.startDateISO, day));
    for (const block of params.fixedBlocks) {
      if (block.daysOfWeek.includes(dayOfWeek)) {
        fixed.push({ start: day * DAY + block.startMinute, end: day * DAY + block.endMinute });
      }
    }
  }
  for (const interval of params.unavailable ?? []) {
    const offset = (dateIndex(interval.dateISO) - base) * DAY;
    fixed.push({
      start: offset + interval.startMinute, end: offset + interval.endMinute,
      withoutBuffer: interval.requiresBuffer === false,
    });
  }
  const goals = new Map(params.goals.map(goal => [goal.id, goal]));
  const deadlines = new Map(params.goals.map(goal => [goal.id, dateIndex(goal.deadlineISO) - base]));
  const energy = new Map<EnergyLevel, Float64Array>();
  for (const preference of Object.keys(ENERGY_RANK) as EnergyLevel[]) {
    const weights = new Float64Array(DAY);
    for (const window of params.energyWindows) {
      const score = 1 - Math.abs(ENERGY_RANK[preference] - ENERGY_RANK[window.level]) / 2;
      weights.fill(score, window.startMinute, window.endMinute);
    }
    const prefix = new Float64Array(DAY + 1);
    for (let minute = 0; minute < DAY; minute++) prefix[minute + 1] = prefix[minute] + weights[minute];
    energy.set(preference, prefix);
  }
  const dayOf = (dateISO: string) => dateIndex(dateISO) - base;
  const spanOf = (session: ScheduledSession): Span => {
    const offset = dayOf(session.dateISO) * DAY;
    return { start: offset + session.startMinute, end: offset + session.endMinute };
  };
  const score = (goal: Goal, start: number, end: number) => {
    const prefix = energy.get(goal.preferredEnergy)!;
    return (prefix[end] - prefix[start]) / (end - start);
  };
  return { dates, fixed, goals, deadlines, dayOf, spanOf, score };
}

type Context = ReturnType<typeof createContext>;

function hasBuffer(candidate: Span, occupied: Span): boolean {
  const padding = occupied.withoutBuffer ? 0 : BUFFER;
  return candidate.end + padding <= occupied.start || occupied.end + padding <= candidate.start;
}

function freeWindows(day: number, occupied: readonly Span[], from = 0): Span[] {
  const endOfDay = (day + 1) * DAY;
  const windows: Span[] = [];
  let cursor = Math.max(day * DAY, from);
  const blocked = occupied.map(span => {
    const padding = span.withoutBuffer ? 0 : BUFFER;
    return { start: span.start - padding, end: span.end + padding };
  }).sort((a, b) => a.start - b.start);
  for (const span of blocked) {
    if (span.end <= cursor) continue;
    if (span.start >= endOfDay) break;
    if (span.start > cursor) windows.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
    if (cursor >= endOfDay) return windows;
  }
  if (cursor < endOfDay) windows.push({ start: cursor, end: endOfDay });
  return windows;
}

/** Daily free windows after immovable constraints, using the same buffers as the solver. */
export function scheduleAvailability(params: Schedule['params'], occupiedSessions: readonly ScheduledSession[] = []) {
  const context = createContext(params);
  const occupied = [...context.fixed, ...occupiedSessions.map(context.spanOf)];
  return context.dates.map((dateISO, day) => ({
    dateISO,
    windows: freeWindows(day, occupied).map(span => ({
      startMinute: span.start - day * DAY,
      endMinute: span.end - day * DAY,
    })),
  }));
}

function scheduledAt(session: ScheduledSession, day: number, start: number, context: Context): ScheduledSession {
  const startMinute = start - day * DAY;
  const endMinute = startMinute + session.endMinute - session.startMinute;
  const goal = context.goals.get(session.goalId);
  return {
    ...session,
    dateISO: context.dates[day],
    startMinute,
    endMinute,
    energyMatchScore: goal ? context.score(goal, startMinute, endMinute) : session.energyMatchScore,
  };
}

function remaining(goal: Goal, sessions: readonly ScheduledSession[]): number {
  const scheduled = sessions.reduce((total, session) => total +
    (session.goalId === goal.id ? session.endMinute - session.startMinute : 0), 0);
  return Math.max(0, goal.totalMinutesRequired - goal.completedMinutes - scheduled);
}

function finish(params: Schedule['params'], sessions: ScheduledSession[]): Schedule {
  sessions.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.startMinute - b.startMinute);
  return {
    params,
    sessions,
    unscheduledMinutes: Object.fromEntries(params.goals.map(goal => [goal.id, remaining(goal, sessions)])),
  };
}

function sessionLength(goal: Goal, minutesLeft: number, available: number): number {
  const longest = Math.min(goal.maxSessionMinutes, minutesLeft, available);
  const remainder = minutesLeft - longest;
  if (remainder > 0 && remainder < goal.minSessionMinutes) {
    const shortened = minutesLeft - goal.minSessionMinutes;
    if (shortened >= goal.minSessionMinutes) return shortened;
  }
  return longest;
}

export function generateSchedule(input: ScheduleParams): Schedule {
  const params = { ...input, startDateISO: input.startDateISO ?? localDateISO() };
  validate(params);
  const context = createContext(params);
  const locked = (params.lockedSessions ?? []).filter(session => session.isLocked);
  const sessions = locked.filter(session => {
    const day = context.dayOf(session.dateISO);
    return day >= 0 && day < HORIZON;
  });
  const occupied = [...context.fixed, ...locked.map(context.spanOf)];
  const rankedGoals = [...params.goals].sort((a, b) => {
    // Each day of deadline proximity adds one point, each priority level adds two.
    const urgency = (goal: Goal) => 2 * goal.priority - (context.deadlines.get(goal.id) ?? 0);
    return urgency(b) - urgency(a) || a.deadlineISO.localeCompare(b.deadlineISO);
  });
  const ids = new Set(locked.map(session => session.id));
  let nextId = 0;
  for (const goal of rankedGoals) {
    let minutesLeft = remaining(goal, sessions);
    const lastDay = Math.min(HORIZON - 1, context.deadlines.get(goal.id)!);
    for (let day = 0; day <= lastDay && minutesLeft >= goal.minSessionMinutes; day++) {
      for (const window of freeWindows(day, occupied)) {
        for (let start = window.start; start < window.end;) {
          const length = sessionLength(goal, minutesLeft, window.end - start);
          if (length < goal.minSessionMinutes) break;
          let id: string;
          do { id = 'session-' + ++nextId; } while (ids.has(id));
          ids.add(id);
          const startMinute = start - day * DAY;
          const endMinute = startMinute + length;
          sessions.push({
            id, goalId: goal.id, title: goal.title, dateISO: context.dates[day],
            startMinute, endMinute, energyMatchScore: context.score(goal, startMinute, endMinute),
            isLocked: false,
          });
          occupied.push({ start, end: start + length });
          minutesLeft -= length;
          start += length + BUFFER;
        }
      }
    }
  }
  improveEnergy(sessions, [...context.fixed, ...locked.map(context.spanOf)], context);
  return finish(params, sessions);
}

/** Rebalance the existing plan while preserving each session and goal's allotted minutes. */
export function optimizeSchedule(
  schedule: Schedule,
  options: { todayMinute?: number; protectedSessionId?: string } = {},
): Schedule {
  const context = createContext(schedule.params);
  const todayMinute = options.todayMinute ?? 0;
  const protectedSlot = (session: ScheduledSession) => session.id === options.protectedSessionId ||
    (context.deadlines.get(session.goalId) ?? -1) < context.dayOf(session.dateISO) ||
    (context.dayOf(session.dateISO) === 0 && session.startMinute < todayMinute);
  const sessions = schedule.sessions.map(session => protectedSlot(session) ? { ...session, isLocked: true } : session);
  const fixed = [
    ...context.fixed,
    ...(schedule.params.lockedSessions ?? [])
      .filter(session => session.isLocked && !sessions.some(candidate => candidate.id === session.id))
      .map(context.spanOf),
    ...sessions.filter(session => session.isLocked).map(context.spanOf),
  ];
  improveEnergy(sessions, fixed, context, { todayMinute });
  const originalLocks = new Map(schedule.sessions.map(session => [session.id, session.isLocked]));
  return finish(schedule.params, sessions.map(session => ({ ...session, isLocked: originalLocks.get(session.id)! })));
}

function improveEnergy(
  sessions: ScheduledSession[],
  fixed: Span[],
  context: Context,
  balance?: { todayMinute: number },
): void {
  const movable = sessions.map((session, index) => session.isLocked ? -1 : index).filter(index => index >= 0);
  if (movable.length === 0) return;
  // Reproducible runs make the same inputs produce the same schedule.
  let seed = balance ? 2027 : 42;
  const pick = (size: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor(seed / 4294967296 * size);
  };
  const lastDay = (session: ScheduledSession) => Math.min(HORIZON - 1, context.deadlines.get(session.goalId)!);
  const duration = (session: ScheduledSession) => session.endMinute - session.startMinute;
  const objective = (session: ScheduledSession) => {
    const goal = context.goals.get(session.goalId);
    const weight = balance && goal ? 1 + 0.2 * (goal.priority - 1) : 1;
    const offHours = balance ? Math.max(0, Math.min(360, session.endMinute) - session.startMinute) +
      Math.max(0, session.endMinute - Math.max(1320, session.startMinute)) : 0;
    return session.energyMatchScore * duration(session) * weight - 0.65 * offHours;
  };
  const load = context.dates.map(date => sessions.reduce((total, session) =>
    session.dateISO === date ? total + duration(session) : total, 0));
  const penalty = (minutes: number) => Math.max(0, minutes - 240) ** 2 / 240;
  const improvement = (from: number, to: number, minutes: number) => !balance || from === to ? 0 :
    penalty(load[from]) + penalty(load[to]) - penalty(load[from] - minutes) - penalty(load[to] + minutes);
  const applyLoad = (from: number, to: number, minutes: number) => {
    load[from] -= minutes;
    load[to] += minutes;
  };
  const spans = sessions.map(context.spanOf);
  const iterations = balance ? 3 * SEARCH_ITERATIONS : SEARCH_ITERATIONS;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const first = movable[pick(movable.length)];
    const a = sessions[first];
    const others = [...fixed];
    const second = iteration % 2 === 1 && movable.length > 1 ? movable[pick(movable.length)] : first;
    spans.forEach((span, index) => {
      if (index !== first && index !== second && !sessions[index].isLocked) others.push(span);
    });
    if (second !== first) {
      const b = sessions[second];
      const aDay = context.dayOf(a.dateISO);
      const bDay = context.dayOf(b.dateISO);
      if (bDay > lastDay(a) || aDay > lastDay(b)) continue;
      const movedA = scheduledAt(a, bDay, spans[second].start, context);
      const movedB = scheduledAt(b, aDay, spans[first].start, context);
      if (movedA.endMinute > DAY || movedB.endMinute > DAY) continue;
      const spanA = context.spanOf(movedA);
      const spanB = context.spanOf(movedB);
      const loadChange = duration(a) - duration(b);
      if (objective(movedA) + objective(movedB) - objective(a) - objective(b) +
          improvement(aDay, bDay, loadChange) <= 0 ||
          !hasBuffer(spanA, spanB) ||
          !others.every(span => hasBuffer(spanA, span) && hasBuffer(spanB, span))) continue;
      sessions[first] = movedA;
      sessions[second] = movedB;
      spans[first] = spanA;
      spans[second] = spanB;
      applyLoad(aDay, bDay, loadChange);
    } else {
      const day = pick(lastDay(a) + 1);
      const length = a.endMinute - a.startMinute;
      const windows = freeWindows(day, others, day === 0 ? balance?.todayMinute : undefined)
        .filter(window => window.end - window.start >= length);
      if (windows.length === 0) continue;
      const window = windows[pick(windows.length)];
      const start = window.start + pick(window.end - window.start - length + 1);
      const moved = scheduledAt(a, day, start, context);
      const from = context.dayOf(a.dateISO);
      if (objective(moved) - objective(a) + improvement(from, day, length) <= 0) continue;
      applyLoad(from, day, length);
      sessions[first] = moved;
      spans[first] = context.spanOf(moved);
    }
  }
}

/** Unlocked sessions overlapping the disruption interval are considered missed.
 * By default the rest of that day is unavailable. Pass resumeMinute for a shorter disruption.
 */
export function rescheduleOnDisruption(
  currentSchedule: Schedule,
  disruptedDateISO: string,
  fromMinute: number,
  resumeMinute = DAY,
): Schedule {
  if (!Number.isInteger(fromMinute) || !Number.isInteger(resumeMinute) ||
      fromMinute < 0 || resumeMinute > DAY || resumeMinute < fromMinute) {
    throw new RangeError('Expected a disruption interval within 0–1440');
  }
  const { params } = currentSchedule;
  const context = createContext(params);
  const disruptedDay = context.dayOf(disruptedDateISO);
  if (disruptedDay < 0 || disruptedDay >= HORIZON || fromMinute === resumeMinute) return currentSchedule;
  const missed: ScheduledSession[] = [];
  const kept = currentSchedule.sessions.filter(session => {
    if (session.isLocked || session.dateISO !== disruptedDateISO ||
        session.endMinute <= fromMinute || session.startMinute >= resumeMinute) return true;
    missed.push(session);
    return false;
  });
  const outsideLocks = (params.lockedSessions ?? []).filter(session => {
    const day = context.dayOf(session.dateISO);
    return session.isLocked && (day < 0 || day >= HORIZON);
  });
  const occupied = [...context.fixed, ...kept.map(context.spanOf), ...outsideLocks.map(context.spanOf)];
  for (const session of missed) {
    const firstStart = disruptedDay * DAY + Math.max(resumeMinute, session.startMinute + 1);
    const lastDay = Math.min(HORIZON - 1, context.deadlines.get(session.goalId) ?? -1);
    const length = session.endMinute - session.startMinute;
    for (let day = Math.floor(firstStart / DAY); day <= lastDay; day++) {
      const space = freeWindows(day, occupied, firstStart).find(window => window.end - window.start >= length);
      if (!space) continue;
      const moved = scheduledAt(session, day, space.start, context);
      kept.push(moved);
      occupied.push(context.spanOf(moved));
      break;
    }
  }
  return finish(params, kept);
}
