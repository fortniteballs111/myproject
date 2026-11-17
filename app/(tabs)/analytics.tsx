import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Feedback, Heading, Panel, Screen } from '../../src/components/ui';
import { analyzeScheduleHealth } from '../../src/engine/diagnostics';
import { useSchedulerStore } from '../../src/store/useSchedulerStore';
import { summarizeActivity } from '../../src/utils/analytics';
import { formatDuration, WEEKDAYS } from '../../src/utils/format';

const riskLabels = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
const riskColors = { low: '#6EE7B7', medium: '#FCD34D', high: '#FDA4AF' };
const insightIcons = {
  warning: { name: 'warning-outline', color: '#FCD34D' },
  tip: { name: 'bulb-outline', color: '#A5B4FC' },
  success: { name: 'checkmark-circle-outline', color: '#6EE7B7' },
} as const;
const hoursDisplay = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function Metric({ label, value, color = '#F4F4F5' }: { label: string; value: string; color?: string }) {
  return (
    <View className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-card px-2.5 py-3">
      <Text className="text-xs leading-4 text-zinc-400">{label}</Text>
      <Text style={{ color }} className="mt-1.5 text-xl font-bold">{value}</Text>
    </View>
  );
}

function HourHeatmap({ values, kind }: { values: number[]; kind: 'work' | 'disruption' }) {
  const peak = Math.max(1, ...values);
  const color = kind === 'work' ? '129, 140, 248' : '251, 191, 36';
  return (
    <View className="gap-1.5">
      {[0, 8, 16].map(start => (
        <View key={start} className="flex-row gap-1">
          {values.slice(start, start + 8).map((value, index) => {
            const hour = String(start + index).padStart(2, '0');
            const alpha = value ? 0.25 + 0.65 * value / peak : 0.05;
            return (
              <View key={hour} accessible accessibilityLabel={hour + ':00, ' +
                (kind === 'work' ? formatDuration(Math.round(value)) : value + ' форс-мажоров')}
                className="min-w-0 flex-1 items-center rounded-md border border-zinc-700 py-1.5"
                style={{ backgroundColor: 'rgba(' + color + ', ' + alpha + ')' }}>
                <Text className="text-[10px] font-medium text-white">{hour}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function AnalyticsScreen() {
  const completed = useSchedulerStore(state => state.completedSessions);
  const goals = useSchedulerStore(state => state.goals);
  const fixedBlocks = useSchedulerStore(state => state.fixedBlocks);
  const energyWindows = useSchedulerStore(state => state.energyWindows);
  const schedule = useSchedulerStore(state => state.schedule);
  const disruptionHistory = useSchedulerStore(state => state.disruptionHistory);
  const autoOptimize = useSchedulerStore(state => state.autoOptimize);
  const [message, setMessage] = useState('');
  const health = useMemo(() => analyzeScheduleHealth(goals, fixedBlocks, energyWindows, schedule),
    [goals, fixedBlocks, energyWindows, schedule]);
  const today = schedule.params.startDateISO;
  const activity = useMemo(() => summarizeActivity(completed, goals, disruptionHistory, today),
    [completed, goals, disruptionHistory, today]);
  const chartScale = Math.max(60, ...activity.bars.map(day => day.minutes));

  return (
    <Screen>
      <Heading title="Аналитика" subtitle="Ваши результаты за семь дней и прогноз по текущему плану." />
      <View className="flex-row gap-2">
        <Metric label="Выполнено за 7 дней" value={hoursDisplay.format(activity.totalMinutes / 60) + ' ч'} color="#A5B4FC" />
        <Metric label="Попадание в пики энергии" value={health.difficultMinutes ? health.energyAlignmentPercent + '%' : '—'} />
        <Metric label="Риск перегруза" value={riskLabels[health.burnoutRisk]} color={riskColors[health.burnoutRisk]} />
      </View>
      <Panel>
        <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-50">Выполнено по дням</Text>
        <View className="flex-row gap-2">
          {activity.bars.map(day => (
            <View key={day.date} accessible accessibilityLabel={day.date + ', ' + formatDuration(Math.round(day.minutes))}
              className="min-w-0 flex-1 items-center gap-1">
              <Text numberOfLines={1} className="text-[10px] text-zinc-400">
                {day.minutes ? hoursDisplay.format(day.minutes / 60) + ' ч' : '—'}
              </Text>
              <View className="w-full justify-end overflow-hidden rounded-md bg-zinc-800" style={{ height: 104 }}>
                {day.segments.map(segment => (
                  <View key={segment.id} style={{ height: segment.minutes / chartScale * 104, backgroundColor: segment.color }} />
                ))}
              </View>
              <Text className="text-xs font-semibold text-zinc-300">{WEEKDAYS.find(item => item.day === day.weekday)?.label}</Text>
              <Text className="text-[10px] text-zinc-500">{Number(day.date.slice(-2))}</Text>
            </View>
          ))}
        </View>
        <View className="flex-row flex-wrap gap-3">
          {activity.legend.map(item => (
            <View key={item.id} className="flex-row items-center gap-1.5">
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color }} />
              <Text className="text-xs text-zinc-300">{item.title}</Text>
            </View>
          ))}
        </View>
        {!activity.legend.length ? <Feedback>Выполненных сессий за этот период пока нет.</Feedback> : null}
      </Panel>
      <Panel>
        <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-50">Активность по часам</Text>
        <Text className="text-sm text-zinc-400">Работа в фокусе и отметки о выполнении</Text>
        <HourHeatmap values={activity.focusHours} kind="work" />
        <Text className="text-sm text-zinc-400">Запуски форс-мажора</Text>
        <HourHeatmap values={activity.disruptionHours} kind="disruption" />
      </Panel>
      <Panel>
        <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-50">Диагностика солвера</Text>
        {health.insights.map(insight => (
          <View key={insight.message} className="flex-row items-start gap-3">
            <Ionicons {...insightIcons[insight.type]} size={19} />
            <Text className="flex-1 text-sm leading-5 text-zinc-200">{insight.message}</Text>
          </View>
        ))}
        <Button label="Применить автооптимизацию" onPress={() => {
          const moved = autoOptimize();
          setMessage(moved ? 'План обновлён. Перенесено сессий: ' + moved + '.' :
            'С учётом ограничений более удачных слотов не найдено.');
        }} />
        {message ? <Feedback>{message}</Feedback> : null}
      </Panel>
    </Screen>
  );
}
