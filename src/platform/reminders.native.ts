import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { ScheduledSession } from '../types/scheduler';

const CHANNEL = 'chronos-sessions';
const PREFIX = 'chronos.reminder.';
const LIMIT = 60;

export const remindersSupported: boolean = true;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

async function setupChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Сессии Chronos', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

function authorized(status: Notifications.NotificationPermissionsStatus): boolean {
  return status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function requestReminderPermission(): Promise<'granted' | 'denied' | 'blocked'> {
  await setupChannel();
  const current = await Notifications.getPermissionsAsync();
  if (authorized(current)) return 'granted';
  if (!current.canAskAgain) return 'blocked';
  const result = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true } });
  return authorized(result) ? 'granted' : result.canAskAgain ? 'denied' : 'blocked';
}

function reminderTime(session: ScheduledSession): number {
  const [year, month, date] = session.dateISO.split('-').map(Number);
  // Construct the planned start in local calendar time, then subtract ten real minutes.
  return new Date(year, month - 1, date, Math.floor(session.startMinute / 60), session.startMinute % 60).getTime() - 600_000;
}

let queue: Promise<void> = Promise.resolve();
let revision = 0;

export function syncSessionReminders(sessions: readonly ScheduledSession[], enabled: boolean): Promise<void> {
  const requestRevision = ++revision;
  const reconcile = async () => {
    if (requestRevision !== revision) return;
    const allowed = enabled && authorized(await Notifications.getPermissionsAsync());
    const desired = new Map<string, { time: number; session: ScheduledSession }>();
    const now = Date.now();
    if (allowed) {
      await setupChannel();
      const upcoming = sessions.map(session => ({ session, time: reminderTime(session) }))
        .filter(entry => entry.time > now).sort((a, b) => a.time - b.time).slice(0, LIMIT);
      for (const entry of upcoming) {
        const { session, time } = entry;
        const identifier = PREFIX + time + '.' + encodeURIComponent(session.goalId);
        desired.set(identifier, entry);
      }
    }

    const current = (await Notifications.getAllScheduledNotificationsAsync())
      .filter(request => request.identifier.startsWith(PREFIX));
    const keep = new Set(current.filter(request => desired.get(request.identifier)?.session.title === request.content.body)
      .map(request => request.identifier));
    await Promise.all(current.filter(request => !keep.has(request.identifier))
      .map(request => Notifications.cancelScheduledNotificationAsync(request.identifier)));
    for (const [identifier, { time, session }] of desired) {
      if (requestRevision !== revision) return;
      if (keep.has(identifier) || time <= Date.now()) continue;
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: { title: 'Сессия через 10 минут', body: session.title },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: time, channelId: CHANNEL },
      });
    }
  };
  const result = queue.then(reconcile);
  queue = result.catch(() => undefined);
  return result;
}
