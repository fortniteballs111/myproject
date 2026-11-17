import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Chip, Feedback, Field, Heading, Panel, Screen, Sheet } from '../../src/components/ui';
import { exportBackup } from '../../src/platform/backup';
import { remindersSupported, requestReminderPermission, syncSessionReminders } from '../../src/platform/reminders';
import { schedulerData, useSchedulerStore } from '../../src/store/useSchedulerStore';
import type { EnergyLevel, EnergyWindow, FixedBlock } from '../../src/types/scheduler';
import { formatMinute, localDateISO } from '../../src/utils/dates';
import { ENERGY_LABEL, ENERGY_LEVELS, parseClock, WEEKDAYS } from '../../src/utils/format';

const ENERGY_COLORS: Record<EnergyLevel, string> = { high: '#818CF8', medium: '#5EEAD4', low: '#71717A' };

function BlockForm({ onClose }: { onClose: () => void }) {
  const addFixedBlock = useSchedulerStore(state => state.addFixedBlock);
  const [title, setTitle] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [error, setError] = useState('');

  function submit() {
    const startMinute = parseClock(start);
    const endMinute = parseClock(end);
    if (startMinute === null || endMinute === null || startMinute >= endMinute) {
      setError('Введите время начала и конца в формате ЧЧ:ММ в пределах одного дня.');
      return;
    }
    try {
      addFixedBlock({ title, daysOfWeek: days, startMinute, endMinute, category: 'Фиксированный блок' });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось добавить блок.');
    }
  }

  return (
    <Sheet title="Новый фиксированный блок" onClose={onClose}>
      <Field label="Название блока" value={title} onChangeText={setTitle} maxLength={100} />
      <View className="gap-2">
        <Text className="text-sm font-medium text-zinc-200">Дни недели</Text>
        <View className="flex-row flex-wrap gap-2">
          {WEEKDAYS.map(({ day, label }) => (
            <Chip key={day} label={label} selected={days.includes(day)}
              onPress={() => setDays(current => current.includes(day) ? current.filter(value => value !== day) : [...current, day])} />
          ))}
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1"><Field label="Начало блока" value={start} onChangeText={setStart} placeholder="09:00" /></View>
        <View className="flex-1"><Field label="Конец блока" value={end} onChangeText={setEnd} placeholder="10:00" /></View>
      </View>
      {error ? <Feedback error>{error}</Feedback> : null}
      <Button label="Добавить блок" onPress={submit} />
    </Sheet>
  );
}

type EnergyDraft = { id: number; start: string; end: string; level: EnergyLevel };

function toDraft(windows: EnergyWindow[]): EnergyDraft[] {
  return windows.map((window, id) => ({
    id, start: formatMinute(window.startMinute), end: formatMinute(window.endMinute), level: window.level,
  }));
}

function EnergyEditor({ windows }: { windows: EnergyWindow[] }) {
  const updateEnergyWindows = useSchedulerStore(state => state.updateEnergyWindows);
  const [draft, setDraft] = useState(() => toDraft(windows));
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    setDraft(toDraft(windows));
    setDirty(false);
  }, [windows]);

  function commit(rows: EnergyDraft[]) {
    try {
      const next = rows.map(row => {
        const startMinute = parseClock(row.start);
        const endMinute = parseClock(row.end);
        if (startMinute === null || endMinute === null || startMinute >= endMinute) {
          throw new Error('У каждого интервала начало должно быть раньше конца. Формат ЧЧ:ММ.');
        }
        return { startMinute, endMinute, level: row.level };
      }).sort((a, b) => a.startMinute - b.startMinute);
      if (next.some((window, index) => index > 0 && window.startMinute < next[index - 1].endMinute)) {
        throw new Error('Энергетические интервалы не должны пересекаться.');
      }
      updateEnergyWindows(next);
      setDraft(toDraft(next));
      setDirty(false);
      setError(false);
      setMessage('Режим сохранён. Расписание пересчитано.');
    } catch (failure) {
      setError(true);
      setMessage(failure instanceof Error ? failure.message : 'Не удалось сохранить режим.');
    }
  }

  function edit(rows: EnergyDraft[]) {
    setDraft(rows);
    setDirty(true);
    setMessage('');
  }

  return (
    <View className="gap-3">
      <Heading title="Окна энергии" subtitle="Задайте 3–4 непересекающихся интервала. Режим повторяется каждый день." />
      <View className="flex-row gap-1 rounded-full bg-zinc-800 p-1" style={{ height: 16 }}>
        {windows.map(window => (
          <View key={window.startMinute} style={{
            flex: window.endMinute - window.startMinute,
            borderRadius: 9, backgroundColor: ENERGY_COLORS[window.level],
          }} />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-3">
        {ENERGY_LEVELS.map(level => (
          <View key={level} className="flex-row items-center gap-1.5">
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ENERGY_COLORS[level] }} />
            <Text className="text-xs text-zinc-400">{ENERGY_LABEL[level]}</Text>
          </View>
        ))}
      </View>
      {draft.map((row, index) => (
        <Panel key={row.id}>
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-zinc-100">Интервал {index + 1}</Text>
            {draft.length > 3 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={'Удалить интервал ' + (index + 1)}
                onPress={() => edit(draft.filter(item => item.id !== row.id))} hitSlop={8}>
                <Text className="text-sm text-red-300">Удалить</Text>
              </Pressable>
            ) : null}
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1"><Field label={'Начало интервала ' + (index + 1)} value={row.start}
              onChangeText={start => edit(draft.map(item => item.id === row.id ? { ...item, start } : item))} /></View>
            <View className="flex-1"><Field label={'Конец интервала ' + (index + 1)} value={row.end}
              onChangeText={end => edit(draft.map(item => item.id === row.id ? { ...item, end } : item))} /></View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {ENERGY_LEVELS.map(level => (
              <Chip key={level} label={ENERGY_LABEL[level]} selected={row.level === level} onPress={() => {
                if (row.level === level) return;
                const next = draft.map(item => item.id === row.id ? { ...item, level } : item);
                if (dirty) edit(next);
                else commit(next);
              }} />
            ))}
          </View>
        </Panel>
      ))}
      {draft.length < 4 ? (
        <Button label="Добавить интервал" kind="secondary" onPress={() => edit([
          ...draft, { id: Math.max(...draft.map(row => row.id)) + 1, start: '22:00', end: '24:00', level: 'low' },
        ])} />
      ) : null}
      {dirty ? <Button label="Сохранить окна энергии" onPress={() => commit(draft)} /> : null}
      {message ? <Feedback error={error}>{message}</Feedback> : null}
    </View>
  );
}

function LocalSettings() {
  const reminders = useSchedulerStore(state => state.remindersEnabled);
  const setReminders = useSchedulerStore(state => state.setRemindersEnabled);
  const reset = useSchedulerStore(state => state.resetDemo);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');

  async function changeReminders() {
    setBusy(true);
    try {
      if (reminders) {
        await syncSessionReminders([], false);
        setReminders(false);
        setMessage('Напоминания выключены.');
      } else {
        const status = await requestReminderPermission();
        if (status === 'granted') {
          const current = useSchedulerStore.getState();
          await syncSessionReminders(current.schedule.sessions.filter(session => session.id !== current.focus?.session.id), true);
          setReminders(true);
          setMessage('Напоминания включены.');
        } else {
          setMessage(status === 'blocked' ? 'Разрешите уведомления Chronos в настройках устройства.' : 'Разрешение не предоставлено.');
        }
      }
    } catch {
      setMessage('Не удалось изменить напоминания. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  async function createBackup() {
    const now = new Date();
    const backup = { version: 2, exportedAt: now.toISOString(), data: schedulerData(useSchedulerStore.getState()) };
    try {
      await exportBackup('chronos-backup-' + localDateISO(now) + '.json', JSON.stringify(backup, null, 2));
    } catch {
      setMessage('Не удалось экспортировать бэкап.');
    }
  }

  return (
    <Panel>
      <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-50">Напоминания и данные</Text>
      {remindersSupported ? (
        <>
          <Feedback>Локальное уведомление за 10 минут до начала сессии.</Feedback>
          <Button label={reminders ? 'Выключить напоминания' : 'Включить напоминания'} kind="secondary"
            disabled={busy} onPress={() => void changeReminders()} />
        </>
      ) : <Feedback>Напоминания доступны в мобильном приложении.</Feedback>}
      <Button label="Экспорт бэкапа (JSON)" kind="secondary" onPress={() => void createBackup()} />
      <Button label="Сбросить к демо-данным" kind="danger" onPress={() => setConfirmReset(true)} />
      {message ? <Feedback>{message}</Feedback> : null}
      {confirmReset ? (
        <Sheet title="Сбросить данные?" onClose={() => setConfirmReset(false)}>
          <Feedback>Цели, расписание, история и текущий таймер будут заменены демо-данными. Перед сбросом можно экспортировать JSON.</Feedback>
          <Button label="Подтвердить сброс" kind="danger" onPress={() => {
            reset();
            setConfirmReset(false);
            setMessage('Демо-данные восстановлены.');
          }} />
        </Sheet>
      ) : null}
    </Panel>
  );
}

export default function RoutineScreen() {
  const blocks = useSchedulerStore(state => state.fixedBlocks);
  const windows = useSchedulerStore(state => state.energyWindows);
  const deleteBlock = useSchedulerStore(state => state.deleteFixedBlock);
  const [showAdd, setShowAdd] = useState(false);
  const [removing, setRemoving] = useState<FixedBlock>();

  return (
    <Screen>
      <Heading title="Режим и энергия" subtitle="Фиксированные блоки защищают время, а окна энергии помогают выбрать время для целей." />
      <View className="gap-3">
        <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-50">Фиксированные блоки</Text>
        {blocks.length === 0 ? <Feedback>Фиксированных блоков пока нет.</Feedback> : null}
        {[...blocks].sort((a, b) => a.startMinute - b.startMinute).map(block => (
          <Panel key={block.id}>
            <View className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 font-semibold text-zinc-50">{block.title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={'Удалить блок: ' + block.title}
                onPress={() => setRemoving(block)} hitSlop={8}>
                <Text className="text-sm text-red-300">Удалить</Text>
              </Pressable>
            </View>
            <Text className="text-sm text-zinc-400">
              {formatMinute(block.startMinute)}–{formatMinute(block.endMinute)}
              {' · '}{WEEKDAYS.filter(day => block.daysOfWeek.includes(day.day)).map(day => day.label).join(', ')}
            </Text>
          </Panel>
        ))}
        <Button label="Новый фиксированный блок" onPress={() => setShowAdd(true)} />
      </View>
      <EnergyEditor windows={windows} />
      <LocalSettings />
      {showAdd ? <BlockForm onClose={() => setShowAdd(false)} /> : null}
      {removing ? (
        <Sheet title={'Удалить блок «' + removing.title + '»?'} onClose={() => setRemoving(undefined)}>
          <Button label="Удалить блок" kind="danger" onPress={() => { deleteBlock(removing.id); setRemoving(undefined); }} />
        </Sheet>
      ) : null}
    </Screen>
  );
}
