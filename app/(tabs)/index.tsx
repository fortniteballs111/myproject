import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Feedback, Heading, Screen, Sheet } from '../../src/components/ui';
import { feedback } from '../../src/platform/haptics';
import { type DisruptionDuration, useSchedulerStore } from '../../src/store/useSchedulerStore';
import type { FixedBlock, ScheduledSession } from '../../src/types/scheduler';
import { addDays, formatMinute, weekday } from '../../src/utils/dates';
import { formatDate, formatDuration, WEEKDAYS } from '../../src/utils/format';

const FIRST_MINUTE = 360;
const LAST_MINUTE = 1440;
const MINUTE_HEIGHT = 1.65;
const HOURS = Array.from({ length: 19 }, (_, index) => FIRST_MINUTE + index * 60);

type TimelineItem =
  | { kind: 'fixed'; item: FixedBlock; color: string }
  | { kind: 'planned' | 'completed'; item: ScheduledSession; color: string };

const disruptionOptions: { duration: DisruptionDuration; label: string }[] = [
  { duration: 60, label: 'Пропал 1 час' },
  { duration: 120, label: 'Пропало 2 часа' },
  { duration: 'rest-of-day', label: 'Весь остаток дня' },
];

function energyLabel(session: ScheduledSession): string {
  return session.energyMatchScore >= 0.95 ? 'Пик энергии' : 'Энергия ' + Math.round(session.energyMatchScore * 100) + '%';
}

function TimelineCard({ entry, open, complete, lock, focus }: {
  entry: TimelineItem; open: () => void; complete: () => void; lock: () => void; focus: () => void;
}) {
  const { item, color, kind } = entry;
  const height = (Math.min(item.endMinute, LAST_MINUTE) - Math.max(item.startMinute, FIRST_MINUTE)) * MINUTE_HEIGHT;
  const top = (Math.max(item.startMinute, FIRST_MINUTE) - FIRST_MINUTE) * MINUTE_HEIGHT;
  const detailed = height >= 50;
  const inlineActions = kind === 'planned' && height >= 40;
  const subtitle = kind === 'fixed' ? item.category : kind === 'completed' ? 'Выполнено' : energyLabel(item);
  const range = formatMinute(item.startMinute) + '–' + formatMinute(item.endMinute);

  return (
    <View style={[
      styles.card, { top, height, borderColor: kind === 'fixed' ? '#3F3F46' : color + '65', borderLeftColor: color },
      kind === 'fixed' ? styles.fixed : { backgroundColor: color + (kind === 'completed' ? '12' : '26') },
    ]}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={item.title + ', ' + range + ', ' + subtitle}
        onPress={open} style={styles.cardBody} hitSlop={height < 35 ? 8 : undefined}
      >
        <View className="flex-row items-center gap-1.5">
          {kind === 'fixed' ? <Ionicons name="lock-closed-outline" size={13} color="#A1A1AA" /> : null}
          {kind === 'completed' ? <Ionicons name="checkmark-circle" size={15} color={color} /> : null}
          <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-zinc-100">{item.title}</Text>
        </View>
        {detailed ? (
          <Text numberOfLines={1} className="text-xs" style={{ color: kind === 'fixed' ? '#A1A1AA' : color }}>
            {range} · {subtitle}
          </Text>
        ) : null}
      </Pressable>
      {inlineActions && kind === 'planned' ? (
        <View className="flex-row items-center">
          <Pressable accessibilityRole="button" accessibilityLabel={'Начать фокус: ' + item.title}
            onPress={focus} style={styles.iconButton}>
            <Ionicons name="play-circle-outline" color="#F4F4F5" size={20} />
          </Pressable>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: false }}
            accessibilityLabel={'Выполнено: ' + item.title} onPress={complete} style={styles.iconButton}>
            <Ionicons name="square-outline" color="#F4F4F5" size={20} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: item.isLocked }}
            accessibilityLabel={(item.isLocked ? 'Открепить: ' : 'Закрепить: ') + item.title}
            onPress={lock} style={styles.iconButton}>
            <Ionicons name={item.isLocked ? 'pin' : 'pin-outline'} color={item.isLocked ? color : '#D4D4D8'} size={20} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function TimelineScreen() {
  const router = useRouter();
  const focusId = useSchedulerStore(state => state.focus?.session.id);
  const beginFocus = useSchedulerStore(state => state.beginFocus);
  const fixedBlocks = useSchedulerStore(state => state.fixedBlocks);
  const goals = useSchedulerStore(state => state.goals);
  const schedule = useSchedulerStore(state => state.schedule);
  const completed = useSchedulerStore(state => state.completedSessions);
  const completeSession = useSchedulerStore(state => state.completeSession);
  const toggleLockSession = useSchedulerStore(state => state.toggleLockSession);
  const triggerDisruption = useSchedulerStore(state => state.triggerDisruption);
  const [selectedDay, setSelectedDay] = useState(0);
  const [showDisruption, setShowDisruption] = useState(false);
  const [details, setDetails] = useState<TimelineItem>();
  const [message, setMessage] = useState('');

  const today = schedule.params.startDateISO;
  const days = Array.from({ length: 7 }, (_, day) => addDays(today, day));
  const selected = days[selectedDay];
  const colorFor = (session: ScheduledSession) => goals.find(goal => goal.id === session.goalId)?.color ?? '#A5B4FC';
  const timeline: TimelineItem[] = [
    ...fixedBlocks.filter(block => block.daysOfWeek.includes(weekday(selected)))
      .map(item => ({ item, kind: 'fixed' as const, color: '#71717A' })),
    ...schedule.sessions.filter(session => session.dateISO === selected)
      .map(item => ({ item, kind: 'planned' as const, color: colorFor(item) })),
    ...completed.filter(session => session.dateISO === selected)
      .map(item => ({ item, kind: 'completed' as const, color: colorFor(item) })),
  ];
  const visible = timeline.filter(({ item }) => item.endMinute > FIRST_MINUTE && item.startMinute < LAST_MINUTE);
  const outsideTimeline = timeline.filter(entry => !visible.includes(entry));
  const focusMinutes = timeline.reduce((total, entry) =>
    entry.kind === 'planned' ? total + entry.item.endMinute - entry.item.startMinute : total, 0);

  function openFocus(id: string) {
    if (!beginFocus(id)) {
      setDetails(undefined);
      setMessage('Другой таймер уже запущен. Вы можете вернуться к нему из расписания.');
      return;
    }
    setDetails(undefined);
    router.push({ pathname: '/focus/[sessionId]', params: { sessionId: id } });
  }

  function applyDisruption(duration: DisruptionDuration) {
    const count = triggerDisruption(duration);
    setShowDisruption(false);
    setSelectedDay(0);
    setMessage('Расписание обновлено. Затронуто сессий: ' + count + '.');
  }

  function finishSession(id: string) {
    setDetails(undefined);
    if (!completeSession(id)) {
      setMessage('Для этой сессии уже идёт таймер. Завершите её в режиме фокуса.');
      return;
    }
    feedback('success');
    setMessage('Сессия выполнена. План и прогресс обновлены.');
  }

  function toggleSession(id: string) {
    toggleLockSession(id);
    setDetails(undefined);
  }

  return (
    <Screen scroll={false}>
      <View className="mx-auto w-full max-w-2xl flex-1">
        <View className="gap-4 border-b border-zinc-800 px-4 pb-3 pt-4">
          <View className="flex-row items-center justify-between gap-2">
            <View className="flex-1">
              <Heading title={selectedDay === 0 ? 'Сегодня' : 'Неделя'} subtitle={formatDate(selected, true)} />
            </View>
            <Button label="Форс-мажор" kind="secondary" onPress={() => { feedback('impact'); setShowDisruption(true); }} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {days.map((date, day) => (
              <Pressable key={date} accessibilityRole="button" accessibilityLabel={formatDate(date, true)}
                accessibilityState={{ selected: selectedDay === day }} onPress={() => { if (day !== selectedDay) feedback('selection'); setSelectedDay(day); }}
                className={'min-w-12 items-center gap-0.5 rounded-xl border px-3 py-2 ' +
                  (selectedDay === day ? 'border-indigo-400 bg-indigo-950' : 'border-zinc-800 bg-card')}>
                <Text className="text-xs font-medium text-zinc-400">
                  {WEEKDAYS.find(entry => entry.day === weekday(date))?.label}
                </Text>
                <Text className="text-base font-bold text-zinc-50">{Number(date.slice(-2))}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text className="text-xs text-zinc-400">
            {focusMinutes > 0 ? 'Запланировано на цели · ' + formatDuration(focusMinutes) : 'Целевых сессий на этот день нет'}
          </Text>
          {focusId ? <Button label="Вернуться к фокусу" kind="secondary" onPress={() => openFocus(focusId)} /> : null}
          {message ? <Feedback>{message}</Feedback> : null}
        </View>
        <ScrollView key={selected} contentContainerStyle={{ paddingBottom: 28 }}>
          {outsideTimeline.some(entry => entry.kind !== 'fixed') ? (
            <View className="gap-2 px-4 pt-4">
              <Text className="text-xs text-zinc-400">Сессии до 06:00</Text>
              {outsideTimeline.filter(entry => entry.kind !== 'fixed').map(entry => (
                <Button key={entry.item.id} kind="secondary" onPress={() => setDetails(entry)}
                  label={formatMinute(entry.item.startMinute) + ' · ' + entry.item.title} />
              ))}
            </View>
          ) : null}
          <View style={styles.timeline}>
            {HOURS.map(minute => (
              <View key={minute} pointerEvents="none" style={[styles.tick, { top: (minute - FIRST_MINUTE) * MINUTE_HEIGHT }]}>
                <Text style={styles.tickLabel}>{formatMinute(minute)}</Text>
                <View style={styles.tickLine} />
              </View>
            ))}
            <View pointerEvents="box-none" style={styles.cardLayer}>
              {visible.map(entry => (
                <TimelineCard key={entry.kind + ':' + entry.item.id} entry={entry}
                  open={() => setDetails(entry)} complete={() => finishSession(entry.item.id)}
                  lock={() => toggleSession(entry.item.id)} focus={() => openFocus(entry.item.id)} />
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
      {showDisruption ? (
        <Sheet title="Форс-мажор" onClose={() => setShowDisruption(false)}>
          <Feedback>Перенесём незакреплённые сессии, которые пересекаются с выбранным интервалом начиная с текущего времени.</Feedback>
          {disruptionOptions.map(option => (
            <Button key={option.duration} label={option.label} kind="secondary" onPress={() => applyDisruption(option.duration)} />
          ))}
        </Sheet>
      ) : null}
      {details ? (
        <Sheet title={details.item.title} onClose={() => setDetails(undefined)}>
          <Feedback>{formatMinute(details.item.startMinute)}–{formatMinute(details.item.endMinute)}</Feedback>
          {details.kind === 'fixed' ? <Feedback>{details.item.category}</Feedback> : null}
          {details.kind === 'completed' ? <Feedback>Сессия выполнена</Feedback> : null}
          {details.kind === 'planned' ? (
            <>
              <Feedback>{energyLabel(details.item)}</Feedback>
              <Button label="Начать фокус" onPress={() => openFocus(details.item.id)} />
              <Button label="Выполнено" kind="secondary" onPress={() => finishSession(details.item.id)} />
              <Button label={details.item.isLocked ? 'Открепить' : 'Закрепить'} kind="secondary"
                onPress={() => toggleSession(details.item.id)} />
            </>
          ) : null}
        </Sheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  timeline: { height: (LAST_MINUTE - FIRST_MINUTE) * MINUTE_HEIGHT + 14, marginHorizontal: 14, marginTop: 20 },
  tick: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', height: 1 },
  tickLabel: { width: 48, color: '#A1A1AA', fontSize: 11, fontVariant: ['tabular-nums'] },
  tickLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#3F3F46' },
  cardLayer: { position: 'absolute', left: 49, top: 0, right: 1, bottom: 0 },
  card: {
    position: 'absolute', left: 1, right: 0, borderWidth: 1, borderLeftWidth: 3,
    borderRadius: 9, flexDirection: 'row', alignItems: 'center',
  },
  fixed: { backgroundColor: '#18181B' },
  cardBody: { flex: 1, height: '100%', paddingHorizontal: 8, justifyContent: 'center', gap: 3, overflow: 'hidden' },
  iconButton: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center' },
});
