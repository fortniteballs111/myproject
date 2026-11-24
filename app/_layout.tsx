import '../global.css';

import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';

import { Onboarding } from '../src/components/Onboarding';
import { Button } from '../src/components/ui';
import { feedback } from '../src/platform/haptics';
import { registerOfflineWorker } from '../src/platform/offline';
import { syncSessionReminders } from '../src/platform/reminders';
import { hydrateScheduler, useSchedulerStore } from '../src/store/useSchedulerStore';

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#6366F1',
    background: '#09090B',
    card: '#18181B',
    border: '#27272A',
  },
};

export default function RootLayout() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const onboardingComplete = useSchedulerStore(state => state.onboardingComplete);
  const sessions = useSchedulerStore(state => state.schedule.sessions);
  const remindersEnabled = useSchedulerStore(state => state.remindersEnabled);
  const focusId = useSchedulerStore(state => state.focus?.session.id);
  const runningSince = useSchedulerStore(state => state.focus?.runningSinceMs ?? null);

  useEffect(registerOfflineWorker, []);

  useEffect(() => {
    let active = true;
    hydrateScheduler().then(
      () => { if (active) setStatus('ready'); },
      () => { if (active) setStatus('error'); },
    );
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (status !== 'ready') return;
    const refresh = () => useSchedulerStore.getState().refreshDate();
    const timer = setInterval(refresh, 60_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [status]);

  useEffect(() => {
    if (status !== 'ready') return;
    const sync = () => {
      void syncSessionReminders(sessions.filter(session => session.id !== focusId), remindersEnabled).catch(error => console.warn('Chronos reminders:', error));
    };
    sync();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') sync(); });
    return () => subscription.remove();
  }, [status, sessions, remindersEnabled, focusId]);

  useEffect(() => {
    if (status !== 'ready' || runningSince === null) return;
    const settle = () => {
      const recorded = useSchedulerStore.getState().finishFocus(Date.now(), true);
      if (recorded !== null) feedback('success');
    };
    settle();
    const timer = setInterval(settle, 500);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') settle(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [status, runningSince]);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      {status === 'ready' && !onboardingComplete ? <Onboarding /> : status === 'ready' ? (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="focus/[sessionId]" options={{ presentation: 'fullScreenModal' }} />
        </Stack>
      ) : (
        <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
          {status === 'loading' ? <ActivityIndicator accessibilityLabel="Загрузка расписания" color="#6366F1" /> : (
            <>
              <Text className="text-center text-base text-zinc-100">Не удалось прочитать локальное расписание.</Text>
              <Button label="Повторить" onPress={() => { setStatus('loading'); setAttempt(value => value + 1); }} />
            </>
          )}
        </View>
      )}
    </ThemeProvider>
  );
}
