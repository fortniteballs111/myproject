import type { ScheduledSession } from '../types/scheduler';

export const remindersSupported: boolean = false;

export async function requestReminderPermission(): Promise<'granted' | 'denied' | 'blocked'> {
  return 'blocked';
}

export async function syncSessionReminders(_sessions: readonly ScheduledSession[], _enabled: boolean): Promise<void> {}
