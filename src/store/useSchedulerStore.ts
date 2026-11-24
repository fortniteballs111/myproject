import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { creditedWork, focusRanges, remainingFocusMs, type FocusRun, type WorkRange } from '../engine/focus';
import { generateSchedule, optimizeSchedule, rescheduleOnDisruption, type Schedule, type UnavailableInterval } from '../engine/solver';
import type { EnergyWindow, FixedBlock, Goal, ScheduledSession } from '../types/scheduler';
import { addDays, dateIndex, localDateISO, weekday } from '../utils/dates';
import { createDemoParams } from '../utils/demo';

export type DisruptionDuration = 60 | 120 | 'rest-of-day';

export interface CompletedSession extends ScheduledSession {
  completedDateISO: string;
  workMinutes?: number;
  completedAtMs?: number;
  workRanges?: WorkRange[];
  goalColor?: string;
}

export interface SchedulerData {
  fixedBlocks: FixedBlock[];
  goals: Goal[];
  energyWindows: EnergyWindow[];
  schedule: Schedule;
  completedSessions: CompletedSession[];
  disruptions: UnavailableInterval[];
  disruptionHistory: number[];
  focus: FocusRun | null;
  remindersEnabled: boolean;
}

interface SchedulerState extends SchedulerData {
  onboardingComplete: boolean;
  finishOnboarding: (mode: 'personal' | 'demo') => void;
  addGoal: (goal: Omit<Goal, 'id' | 'completedMinutes'>) => void;
  updateGoal: (id: string, updates: Partial<Omit<Goal, 'id' | 'completedMinutes'>>) => void;
  deleteGoal: (id: string) => void;
  completeSession: (id: string) => boolean;
  beginFocus: (id: string, nowMs?: number) => boolean;
  toggleFocusPause: (nowMs?: number) => void;
  extendFocus: (nowMs?: number) => void;
  finishFocus: (nowMs?: number, onlyIfElapsed?: boolean) => number | null;
  autoOptimize: (now?: Date) => number;
  setRemindersEnabled: (enabled: boolean) => void;
  resetDemo: () => void;
  toggleLockSession: (id: string) => void;
  addFixedBlock: (block: Omit<FixedBlock, 'id'>) => void;
  deleteFixedBlock: (id: string) => void;
  updateEnergyWindows: (windows: EnergyWindow[]) => void;
  triggerDisruption: (duration: DisruptionDuration, now?: Date) => number;
  regenerateAll: () => void;
  refreshDate: () => void;
}

let sequence = 0;
function newId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '-' + ++sequence;
}

function initialData(): SchedulerData {
  const demo = createDemoParams();
  const fixedBlocks = demo.fixedBlocks.map(block => block.id === 'school'
    ? { ...block, daysOfWeek: [1, 2, 3, 4, 5] }
    : block);
  const goals = demo.goals.map(goal => ({ ...goal, deadlineISO: addDays(demo.startDateISO, goal.id === 'exam' ? 2 : 5) }));
  const energyWindows: EnergyWindow[] = [
    { startMinute: 420, endMinute: 720, level: 'high' },
    { startMinute: 720, endMinute: 1020, level: 'medium' },
    { startMinute: 1020, endMinute: 1200, level: 'high' },
    { startMinute: 1200, endMinute: 1380, level: 'low' },
  ];
  return {
    fixedBlocks, goals, energyWindows, completedSessions: [], disruptions: [],
    disruptionHistory: [], focus: null, remindersEnabled: false,
    schedule: generateSchedule({ startDateISO: demo.startDateISO, fixedBlocks, goals, energyWindows }),
  };
}

function makeUnavailable(data: SchedulerData, earliest: string): UnavailableInterval[] {
  const recorded = data.completedSessions.flatMap(session => {
    if (!session.workRanges) {
      const { dateISO, startMinute, endMinute } = session;
      return dateISO >= earliest ? [{ dateISO, startMinute, endMinute }] : [];
    }
    return session.workRanges.filter(({ endMs }) => localDateISO(new Date(endMs)) >= earliest)
      .flatMap(({ startMs, endMs }) => {
        const intervals: UnavailableInterval[] = [];
        for (let cursor = startMs; cursor < endMs;) {
          const start = new Date(cursor);
          const nextDay = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
          const clipped = Math.min(nextDay, endMs);
          const end = new Date(clipped);
          const startMinute = start.getHours() * 60 + start.getMinutes();
          const endMinute = clipped === nextDay ? 1440 :
            Math.ceil(end.getHours() * 60 + end.getMinutes() + (end.getSeconds() * 1000 + end.getMilliseconds()) / 60_000);
          // During the repeated DST hour a local end can be earlier than its own start.
          intervals.push({ dateISO: localDateISO(start), startMinute, endMinute: Math.max(startMinute + 1, endMinute) });
          cursor = clipped;
        }
        return intervals;
      });
  });
  return [...data.disruptions, ...recorded].filter(interval => interval.dateISO >= earliest);
}

function replan(state: SchedulerData, patch: Partial<SchedulerData> = {}, today = localDateISO()): SchedulerData {
  const data = { ...state, ...patch };
  const { fixedBlocks, goals, energyWindows, completedSessions } = data;
  const disruptions = data.disruptions.filter(interval => interval.dateISO >= today);
  const yesterday = addDays(today, -1);
  const priorLocks = (data.schedule.params.lockedSessions ?? []).filter(session =>
    session.dateISO >= yesterday && session.dateISO < data.schedule.params.startDateISO);
  const goalsById = new Map(goals.map(goal => [goal.id, goal]));
  const lockedSessions = [...priorLocks, ...data.schedule.sessions].flatMap(session => {
    const goal = goalsById.get(session.goalId);
    return session.isLocked && goal && session.dateISO >= yesterday ? [{ ...session, title: goal.title }] : [];
  });
  const focusSession = data.focus?.session;
  const focusSlot = focusSession && data.schedule.sessions.find(session => session.id === focusSession.id);
  const preserveFocus = focusSlot && focusSlot.dateISO >= yesterday && goalsById.has(focusSlot.goalId);
  if (preserveFocus && !focusSlot.isLocked) lockedSessions.push({ ...focusSlot, isLocked: true });
  const unavailable = makeUnavailable({ ...data, disruptions }, yesterday);
  const now = new Date();
  if (localDateISO(now) === today && completedSessions.some(session => session.workRanges && session.completedDateISO === today)) {
    const elapsed = Math.ceil(now.getHours() * 60 + now.getMinutes() + (now.getSeconds() + now.getMilliseconds() / 1000) / 60);
    if (elapsed > 0) unavailable.push({ dateISO: today, startMinute: 0, endMinute: elapsed, requiresBuffer: false });
  }
  const schedule = generateSchedule({
    startDateISO: today, fixedBlocks, goals, energyWindows, lockedSessions, unavailable,
  });

  for (const session of schedule.sessions) {
    if (preserveFocus && session.id === focusSlot.id) session.isLocked = focusSlot.isLocked;
    else if (!session.isLocked) session.id = newId('session');
  }
  schedule.params.lockedSessions = lockedSessions.filter(session => !preserveFocus || session.id !== focusSlot.id || focusSlot.isLocked);
  return {
    fixedBlocks, goals, energyWindows, completedSessions, disruptions, schedule,
    focus: data.focus, disruptionHistory: data.disruptionHistory, remindersEnabled: data.remindersEnabled,
  };
}

export function validateGoal(goal: Omit<Goal, 'id' | 'completedMinutes'>): void {
  dateIndex(goal.deadlineISO);
  if (!goal.title.trim() || !Number.isInteger(goal.totalMinutesRequired) || goal.totalMinutesRequired < 1 ||
      !Number.isInteger(goal.minSessionMinutes) || !Number.isInteger(goal.maxSessionMinutes) ||
      goal.minSessionMinutes < 1 || goal.maxSessionMinutes > 1440 || goal.maxSessionMinutes < goal.minSessionMinutes ||
      goal.minSessionMinutes > goal.totalMinutesRequired) {
    throw new Error('Проверьте название, общий объём и границы длительности сессии.');
  }
}

function recordCompletion(
  state: SchedulerData,
  session: ScheduledSession,
  minutes: number,
  completedAtMs: number,
  workRanges?: WorkRange[],
): SchedulerData {
  const goalColor = state.goals.find(goal => goal.id === session.goalId)?.color;
  const completed: CompletedSession = {
    ...session, isLocked: false, completedAtMs, completedDateISO: localDateISO(new Date(completedAtMs)),
    workMinutes: minutes, workRanges, goalColor,
  };
  return replan(state, {
    goals: state.goals.map(goal => goal.id === session.goalId
      ? { ...goal, completedMinutes: goal.completedMinutes + minutes } : goal),
    completedSessions: [...state.completedSessions, completed],
    schedule: { ...state.schedule, sessions: state.schedule.sessions.filter(candidate => candidate.id !== session.id) },
  });
}

export function schedulerData({
  fixedBlocks, goals, energyWindows, schedule, completedSessions, disruptions,
  disruptionHistory, focus, remindersEnabled,
}: SchedulerData): SchedulerData {
  return { fixedBlocks, goals, energyWindows, schedule, completedSessions, disruptions, disruptionHistory, focus, remindersEnabled };
}

let pendingWrite = Promise.resolve();
const orderedStorage: StateStorage = {
  getItem: key => pendingWrite.then(() => AsyncStorage.getItem(key)),
  setItem: (key, value) => {
    pendingWrite = pendingWrite.then(() => AsyncStorage.setItem(key, value)).catch(error => {
      console.warn('Не удалось сохранить расписание:', error);
    });
    return pendingWrite;
  },
  removeItem: key => pendingWrite.then(() => AsyncStorage.removeItem(key)),
};

export const useSchedulerStore = create<SchedulerState>()(persist((set, get) => ({
  ...initialData(),
  onboardingComplete: false,
  finishOnboarding: mode => {
    if (get().onboardingComplete) return;
    const data = initialData();
    const fixedBlocks = data.fixedBlocks.filter(block => block.category === 'Отдых');
    set({
      ...(mode === 'demo' ? data : replan(data, { goals: [], fixedBlocks })),
      onboardingComplete: true,
    });
  },
  addGoal: input => {
    validateGoal(input);
    set(state => replan(state, {
      goals: [...state.goals, { ...input, title: input.title.trim(), id: newId('goal'), completedMinutes: 0 }],
    }));
  },
  updateGoal: (id, updates) => set(state => {
    const existing = state.goals.find(goal => goal.id === id);
    if (!existing) return state;
    const goal = { ...existing, ...updates, title: (updates.title ?? existing.title).trim() };
    validateGoal(goal);
    if (goal.totalMinutesRequired < goal.completedMinutes) {
      throw new Error('Объём цели уже меньше выполненного времени.');
    }
    const reserved = state.schedule.sessions.filter(session =>
      session.goalId === id && (session.isLocked || session.id === state.focus?.session.id));
    if (reserved.some(session => session.dateISO > goal.deadlineISO)) {
      throw new Error('Снимите закрепление или завершите текущий фокус, если сессия окажется после дедлайна.');
    }
    const lockedMinutes = reserved.reduce((sum, session) => sum + session.endMinute - session.startMinute, 0);
    if (goal.completedMinutes + lockedMinutes > goal.totalMinutesRequired) {
      throw new Error('Новый объём меньше суммы выполненных и зарезервированных минут.');
    }
    return replan(state, { goals: state.goals.map(candidate => candidate.id === id ? goal : candidate) });
  }),
  deleteGoal: id => set(state => replan(state, {
    goals: state.goals.filter(goal => goal.id !== id),
    focus: state.focus?.session.goalId === id ? null : state.focus,
  })),
  completeSession: id => {
    const state = get();
    const session = state.schedule.sessions.find(candidate => candidate.id === id);
    if (!session || state.focus?.session.id === id ||
        state.completedSessions.some(candidate => candidate.id === id)) return false;
    set(recordCompletion(state, session, session.endMinute - session.startMinute, Date.now()));
    return true;
  },
  beginFocus: (id, nowMs = Date.now()) => {
    const state = get();
    if (state.focus) return state.focus.session.id === id;
    const session = state.schedule.sessions.find(candidate => candidate.id === id);
    if (!session) return false;
    set({ focus: { session, targetMinutes: session.endMinute - session.startMinute, ranges: [], runningSinceMs: nowMs } });
    return true;
  },
  toggleFocusPause: (nowMs = Date.now()) => {
    const run = get().focus;
    if (!run || remainingFocusMs(run, nowMs) === 0) return;
    set({ focus: run.runningSinceMs === null ? { ...run, runningSinceMs: nowMs } :
      { ...run, ranges: focusRanges(run, nowMs), runningSinceMs: null } });
  },
  extendFocus: (nowMs = Date.now()) => {
    const run = get().focus;
    if (!run || remainingFocusMs(run, nowMs) === 0) return;
    set({ focus: { ...run, targetMinutes: run.targetMinutes + 15 } });
  },
  finishFocus: (nowMs = Date.now(), onlyIfElapsed = false) => {
    const state = get();
    const run = state.focus;
    if (!run || (onlyIfElapsed && remainingFocusMs(run, nowMs) > 0)) return null;
    const work = creditedWork(focusRanges(run, nowMs));
    if (work.minutes > 0) {
      const actualEnd = work.ranges.at(-1)?.endMs ?? nowMs;
      set(recordCompletion({ ...state, focus: null }, run.session, work.minutes, actualEnd, work.ranges));
    } else {
      set({ focus: null });
    }
    return work.minutes;
  },
  autoOptimize: (now = new Date()) => {
    const state = get();
    const todayMinute = localDateISO(now) === state.schedule.params.startDateISO ? now.getHours() * 60 + now.getMinutes() : 0;
    const schedule = optimizeSchedule(state.schedule, { todayMinute, protectedSessionId: state.focus?.session.id });
    const previous = new Map(state.schedule.sessions.map(session => [session.id, session]));
    const moved = schedule.sessions.filter(session => {
      const before = previous.get(session.id);
      return before && (before.dateISO !== session.dateISO || before.startMinute !== session.startMinute);
    }).length;
    if (moved) set({ schedule });
    return moved;
  },
  setRemindersEnabled: remindersEnabled => set({ remindersEnabled }),
  resetDemo: () => set(initialData()),
  toggleLockSession: id => set(state => {
    const sessions = state.schedule.sessions.map(session =>
      session.id === id ? { ...session, isLocked: !session.isLocked } : session);
    return { schedule: { ...state.schedule, sessions, params: {
      ...state.schedule.params, lockedSessions: [
        ...(state.schedule.params.lockedSessions ?? []).filter(session => session.dateISO < state.schedule.params.startDateISO),
        ...sessions.filter(session => session.isLocked),
      ],
    } } };
  }),
  addFixedBlock: input => set(state => {
    if (!input.title.trim() || !input.daysOfWeek.length ||
        input.daysOfWeek.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
        !Number.isInteger(input.startMinute) || !Number.isInteger(input.endMinute) ||
        input.startMinute < 0 || input.endMinute > 1440 || input.startMinute >= input.endMinute) {
      throw new Error('Укажите название, дни недели и корректный интервал в пределах суток.');
    }
    const overlaps = state.fixedBlocks.some(block =>
      block.daysOfWeek.some(day => input.daysOfWeek.includes(day)) &&
      block.startMinute < input.endMinute && input.startMinute < block.endMinute);
    if (overlaps) throw new Error('Интервал пересекается с другим фиксированным блоком.');
    const hitsLock = state.schedule.sessions.some(session => {
      if (!session.isLocked && session.id !== state.focus?.session.id) return false;
      const day = weekday(session.dateISO);
      return [-1, 0, 1].some(offset =>
        input.daysOfWeek.includes((day + offset + 7) % 7) &&
        input.startMinute + offset * 1440 < session.endMinute + 15 &&
        session.startMinute - 15 < input.endMinute + offset * 1440);
    });
    if (hitsLock) throw new Error('Блок или его буфер затрагивает закреплённую сессию. Сначала снимите закрепление.');
    return replan(state, {
      fixedBlocks: [...state.fixedBlocks, { ...input, id: newId('fixed'), title: input.title.trim() }],
    });
  }),
  deleteFixedBlock: id => set(state => replan(state, { fixedBlocks: state.fixedBlocks.filter(block => block.id !== id) })),
  updateEnergyWindows: energyWindows => {
    if (energyWindows.length < 3 || energyWindows.length > 4) throw new Error('Задайте от 3 до 4 окон энергии.');
    set(state => replan(state, { energyWindows: [...energyWindows].sort((a, b) => a.startMinute - b.startMinute) }));
  },
  triggerDisruption: (duration, now = new Date()) => {
    const today = localDateISO(now);
    const from = now.getHours() * 60 + now.getMinutes();
    const end = duration === 'rest-of-day' ? 1440 : from + duration;
    const intervals: UnavailableInterval[] = [
      { dateISO: today, startMinute: from, endMinute: Math.min(1440, end), requiresBuffer: false },
    ];
    if (end > 1440) intervals.push({
      dateISO: addDays(today, 1), startMinute: 0, endMinute: end - 1440, requiresBuffer: false,
    });
    const state = get();
    const active = state.schedule.params.startDateISO === today ? state : replan(state, {}, today);
    const disruptions = [...active.disruptions, ...intervals];
    const focusId = active.focus?.session.id;
    const focusedSlot = active.schedule.sessions.find(session => session.id === focusId);
    let schedule: Schedule = { ...active.schedule, sessions: active.schedule.sessions.map(session =>
      session.id === focusId ? { ...session, isLocked: true } : session), params: {
      ...active.schedule.params,
      unavailable: [
        ...(active.schedule.params.unavailable ?? []),
        ...intervals,
      ],
    } };
    const affected = new Set(schedule.sessions.filter(session => !session.isLocked && intervals.some(interval =>
      session.dateISO === interval.dateISO && session.startMinute < interval.endMinute && interval.startMinute < session.endMinute))
      .map(session => session.id));
    // Clear the next day's interval first so sessions from today can use the recovered space.
    for (const interval of [...intervals].reverse()) {
      schedule = rescheduleOnDisruption(schedule, interval.dateISO, interval.startMinute, interval.endMinute);
    }
    if (focusedSlot && !focusedSlot.isLocked) {
      schedule.sessions = schedule.sessions.map(session => session.id === focusId ? { ...session, isLocked: false } : session);
    }
    set({ ...active, disruptions, schedule, disruptionHistory: [...active.disruptionHistory, now.getTime()] });
    return affected.size;
  },
  regenerateAll: () => set(state => replan(state)),
  refreshDate: () => {
    const today = localDateISO();
    if (get().schedule.params.startDateISO !== today) set(state => replan(state, {}, today));
  },
}), {
  name: 'chronos.scheduler.v1',
  storage: createJSONStorage(() => orderedStorage),
  skipHydration: true,
  partialize: state => ({ ...schedulerData(state), onboardingComplete: state.onboardingComplete }),
  merge: (stored, current) => {
    const previous = stored as Partial<SchedulerState> | undefined;
    return {
      ...current, ...previous,
      onboardingComplete: previous?.onboardingComplete ?? Boolean(previous?.schedule),
    };
  },
}));

let hydration: Promise<void> | undefined;

export function hydrateScheduler(): Promise<void> {
  if (useSchedulerStore.persist.hasHydrated()) return Promise.resolve();
  hydration ??= Promise.resolve(useSchedulerStore.persist.rehydrate()).then(async () => {
    if (!useSchedulerStore.persist.hasHydrated()) throw new Error('Не удалось прочитать локальное расписание.');
    useSchedulerStore.getState().refreshDate();
    // Persist the seeded plan when AsyncStorage was empty.
    await useSchedulerStore.setState({});
  }).finally(() => { hydration = undefined; });
  return hydration;
}
