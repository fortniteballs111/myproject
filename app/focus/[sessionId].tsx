import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Feedback, Heading, Screen } from '../../src/components/ui';
import { remainingFocusMs } from '../../src/engine/focus';
import { feedback } from '../../src/platform/haptics';
import { useSchedulerStore } from '../../src/store/useSchedulerStore';
import { formatDuration } from '../../src/utils/format';

function displayTime(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000);
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  return m + ':' + String(seconds % 60).padStart(2, '0');
}

export default function FocusScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const run = useSchedulerStore(state => state.focus?.session.id === sessionId ? state.focus : null);
  const completed = useSchedulerStore(state => state.completedSessions.find(session => session.id === sessionId));
  const goal = useSchedulerStore(state => state.goals.find(candidate => candidate.id === run?.session.goalId));
  const togglePause = useSchedulerStore(state => state.toggleFocusPause);
  const extend = useSchedulerStore(state => state.extendFocus);
  const finish = useSchedulerStore(state => state.finishFocus);
  const [now, setNow] = useState(Date.now);
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    if (!run || run.runningSinceMs === null) return;
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [run]);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function endRun() {
    const minutes = finish();
    if (minutes === null) return;
    setResult(minutes);
    feedback('success');
  }

  const recorded = completed?.workMinutes ?? result;
  if (!run) {
    return (
      <Screen scroll={false}>
        <View className="mx-auto w-full max-w-lg flex-1 justify-center gap-5 px-6">
          <Heading title={recorded === null ? 'Таймер недоступен' : 'Фокус завершён'} />
          {recorded !== null ? <Feedback>Засчитано {formatDuration(recorded)}. {recorded > 0 ? 'План обновлён.' : 'Сессия осталась в плане.'}</Feedback> : null}
          <Button label="К расписанию" onPress={goBack} />
        </View>
      </Screen>
    );
  }

  const paused = run.runningSinceMs === null;
  return (
    <Screen>
      <View className="gap-8" style={{ paddingBottom: bottom }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Вернуться к расписанию" onPress={goBack}
          className="min-h-11 flex-row items-center gap-2 self-start">
          <Ionicons name="arrow-back" size={19} color="#A5B4FC" />
          <Text className="font-semibold text-indigo-300">К расписанию</Text>
        </Pressable>
        <View className="gap-4 py-12">
          <Text className="text-center text-sm font-semibold" style={{ color: goal?.color ?? '#A5B4FC' }}>
            {paused ? 'На паузе' : 'Режим фокуса'}
          </Text>
          <Text accessibilityRole="header" className="text-center text-2xl font-semibold text-white">{goal?.title ?? run.session.title}</Text>
          <Text accessibilityLabel="Осталось времени" adjustsFontSizeToFit numberOfLines={1}
            className="text-center font-mono font-bold text-zinc-50" style={{ fontSize: 78, fontVariant: ['tabular-nums'] }}>
            {displayTime(remainingFocusMs(run, now))}
          </Text>
        </View>
        <View className="gap-3">
          <Button label={paused ? 'Продолжить' : 'Пауза'} onPress={() => { const time = Date.now(); togglePause(time); setNow(time); }} />
          <Button label="+15 минут" kind="secondary" onPress={() => { const time = Date.now(); extend(time); setNow(time); }} />
          <Button label="Завершить фокус" kind="secondary" onPress={endRun} />
        </View>
      </View>
    </Screen>
  );
}
