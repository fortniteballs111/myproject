import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Chip, Feedback, Field, Heading, Panel, Screen, Sheet } from '../../src/components/ui';
import { useSchedulerStore } from '../../src/store/useSchedulerStore';
import type { EnergyLevel, Goal, ScheduledSession } from '../../src/types/scheduler';
import { addDays, localDateISO } from '../../src/utils/dates';
import { ENERGY_LABEL, ENERGY_LEVELS, formatDate, formatDuration } from '../../src/utils/format';

const PRIORITIES: Goal['priority'][] = [1, 2, 3, 4, 5];
const COLORS = [
  { value: '#A5B4FC', label: 'Индиго' }, { value: '#5EEAD4', label: 'Бирюзовый' },
  { value: '#FDA4AF', label: 'Розовый' }, { value: '#FCD34D', label: 'Янтарный' },
  { value: '#93C5FD', label: 'Голубой' },
];

function forecast(goal: Goal, sessions: ScheduledSession[], today: string) {
  let remaining = goal.totalMinutesRequired - goal.completedMinutes;
  if (remaining <= 0) return { success: true, label: 'Цель выполнена' };
  if (goal.deadlineISO < today) return { success: false, label: 'Дедлайн прошёл · осталось ' + formatDuration(remaining) };

  for (const session of sessions) {
    if (session.goalId !== goal.id || session.dateISO > goal.deadlineISO) continue;
    remaining -= session.endMinute - session.startMinute;
    if (remaining <= 0) return { success: true, label: 'По плану завершится ' + formatDate(session.dateISO) };
  }
  return { success: false, label: 'До дедлайна в текущем плане не хватает ' + formatDuration(remaining) };
}

function GoalForm({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const addGoal = useSchedulerStore(state => state.addGoal);
  const updateGoal = useSchedulerStore(state => state.updateGoal);
  const deleteGoal = useSchedulerStore(state => state.deleteGoal);
  const [title, setTitle] = useState(goal?.title ?? '');
  const [hours, setHours] = useState(goal ? String(Number((goal.totalMinutesRequired / 60).toFixed(4))) : '');
  const [deadline, setDeadline] = useState(goal?.deadlineISO ?? addDays(localDateISO(), 6));
  const [min, setMin] = useState(String(goal?.minSessionMinutes ?? 30));
  const [max, setMax] = useState(String(goal?.maxSessionMinutes ?? 60));
  const [priority, setPriority] = useState<Goal['priority']>(goal?.priority ?? 3);
  const [energy, setEnergy] = useState<EnergyLevel>(goal?.preferredEnergy ?? 'medium');
  const [color, setColor] = useState(goal?.color ?? COLORS[0].value);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  function submit() {
    const value = hours.trim();
    if (!/^\d+(?:[,.]\d+)?$/.test(value) || !/^\d+$/.test(min.trim()) || !/^\d+$/.test(max.trim())) {
      setError('Укажите число часов и целое число минут для длительности.');
      return;
    }
    const input = {
      title, totalMinutesRequired: Math.round(Number(value.replace(',', '.')) * 60),
      deadlineISO: deadline.trim(), priority, minSessionMinutes: Number(min), maxSessionMinutes: Number(max),
      preferredEnergy: energy, color,
    };
    try {
      if (goal) updateGoal(goal.id, input);
      else addGoal(input);
      onClose();
    } catch (failure) {
      setError(failure instanceof RangeError ? 'Введите корректную дату в формате ГГГГ-ММ-ДД.' :
        failure instanceof Error ? failure.message : 'Не удалось сохранить цель.');
    }
  }

  return (
    <Sheet title={goal ? 'Редактировать цель' : 'Новая цель'} onClose={onClose}>
      <Field label="Название" value={title} onChangeText={setTitle} maxLength={100} />
      <Field label="Общий объём, часов" value={hours} onChangeText={setHours} keyboardType="decimal-pad" placeholder="Например, 3,5" />
      <Field label="Дедлайн (ГГГГ-ММ-ДД)" value={deadline} onChangeText={setDeadline} autoCapitalize="none" maxLength={10} />
      <View className="flex-row gap-3">
        <View className="flex-1"><Field label="Минимум, мин" value={min} onChangeText={setMin} keyboardType="number-pad" /></View>
        <View className="flex-1"><Field label="Максимум, мин" value={max} onChangeText={setMax} keyboardType="number-pad" /></View>
      </View>
      <View className="gap-2">
        <Text className="text-sm font-medium text-zinc-200">Приоритет</Text>
        <View className="flex-row flex-wrap gap-2">
          {PRIORITIES.map(value => <Chip key={value} label={String(value)} selected={priority === value} onPress={() => setPriority(value)} />)}
        </View>
      </View>
      <View className="gap-2">
        <Text className="text-sm font-medium text-zinc-200">Предпочтительная энергия</Text>
        <View className="flex-row flex-wrap gap-2">
          {ENERGY_LEVELS.map(level => (
            <Chip key={level} label={ENERGY_LABEL[level]} selected={energy === level} onPress={() => setEnergy(level)} />
          ))}
        </View>
      </View>
      <View className="gap-2">
        <Text className="text-sm font-medium text-zinc-200">Цвет</Text>
        <View className="flex-row flex-wrap gap-3">
          {COLORS.map(option => (
            <Pressable
              key={option.value} accessibilityRole="button" accessibilityLabel={option.label}
              accessibilityState={{ selected: color === option.value }} onPress={() => setColor(option.value)}
              style={{ backgroundColor: option.value, borderWidth: color === option.value ? 3 : 0, borderColor: '#FFF', width: 38, height: 38, borderRadius: 19 }}
            />
          ))}
        </View>
      </View>
      {error ? <Feedback error>{error}</Feedback> : null}
      <Button label={goal ? 'Сохранить изменения' : 'Добавить цель'} onPress={submit} />
      {goal && !confirmDelete ? <Button label="Удалить цель" kind="danger" onPress={() => setConfirmDelete(true)} /> : null}
      {goal && confirmDelete ? (
        <>
          <Feedback>Цель и её запланированные сессии будут удалены. Выполненные сессии останутся в истории.</Feedback>
          <Button label="Подтвердить удаление" kind="danger" onPress={() => { deleteGoal(goal.id); onClose(); }} />
          <Button label="Отмена" kind="secondary" onPress={() => setConfirmDelete(false)} />
        </>
      ) : null}
    </Sheet>
  );
}

export default function GoalsScreen() {
  const goals = useSchedulerStore(state => state.goals);
  const schedule = useSchedulerStore(state => state.schedule);
  const [editing, setEditing] = useState<Goal | 'new'>();
  const orderedGoals = [...goals].sort((a, b) =>
    Number(a.completedMinutes >= a.totalMinutesRequired) - Number(b.completedMinutes >= b.totalMinutesRequired));

  return (
    <Screen>
      <Heading title="Цели" subtitle="Прогресс и прогноз на основе текущего расписания." />
      <Button label="Новая цель" onPress={() => setEditing('new')} />
      {orderedGoals.length === 0 ? <Panel><Feedback>Добавьте цель, чтобы включить её в расписание.</Feedback></Panel> : null}
      {orderedGoals.map(goal => {
        const progress = Math.min(100, Math.round(100 * goal.completedMinutes / goal.totalMinutesRequired));
        const prediction = forecast(goal, schedule.sessions, schedule.params.startDateISO);
        return (
          <Panel key={goal.id}>
            <View className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 text-base font-semibold text-zinc-50">{goal.title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={'Изменить: ' + goal.title}
                onPress={() => setEditing(goal)} hitSlop={8}>
                <Text className="text-sm font-semibold text-indigo-300">Изменить</Text>
              </Pressable>
            </View>
            <View accessibilityRole="progressbar" accessibilityLabel={'Прогресс: ' + goal.title}
              accessibilityValue={{ min: 0, max: 100, now: progress }} className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <View style={{ width: progress + '%', height: '100%', backgroundColor: goal.color }} />
            </View>
            <View className="flex-row flex-wrap justify-between gap-2">
              <Text className="text-sm text-zinc-300">{formatDuration(goal.completedMinutes)} / {formatDuration(goal.totalMinutesRequired)}</Text>
              <Text className="text-sm text-zinc-300">{progress}%</Text>
            </View>
            <Text className="text-xs text-zinc-400">Дедлайн {formatDate(goal.deadlineISO)} · Приоритет {goal.priority}/5</Text>
            <Text className={'text-sm font-medium ' + (prediction.success ? 'text-emerald-300' : 'text-red-300')}>
              {prediction.label}
            </Text>
          </Panel>
        );
      })}
      {editing ? <GoalForm goal={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} /> : null}
    </Screen>
  );
}
