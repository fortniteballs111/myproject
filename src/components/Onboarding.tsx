import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { View } from 'react-native';

import { useSchedulerStore } from '../store/useSchedulerStore';
import { Button, Heading, Panel, Screen } from './ui';

const steps = [
  {
    title: 'Добро пожаловать в Chronos',
    description: 'Задайте цели, и Chronos распределит работу на ближайшие семь дней с учётом дедлайнов.',
    icon: 'calendar-outline',
  },
  {
    title: 'Настройте свой режим',
    description: 'Добавьте повторяющиеся дела и отметьте, когда у вас больше энергии. Планировщик учтёт их при выборе времени для сессий.',
    icon: 'flash-outline',
  },
  {
    title: 'Выберите, с чего начать',
    description: 'Создайте свой план с базовыми окнами сна и энергии или изучите готовый пример.',
    icon: 'flag-outline',
  },
] as const;

export function Onboarding() {
  const [step, setStep] = useState(0);
  const finish = useSchedulerStore(state => state.finishOnboarding);
  const { title, description, icon } = steps[step];
  const last = step === steps.length - 1;

  return (
    <Screen>
      <Panel>
        <Ionicons name={icon} size={36} color="#A5B4FC" />
        <Heading title={title} subtitle={description} />
      </Panel>
      {last ? (
        <View className="gap-2">
          <Button label="Создать свой план" onPress={() => finish('personal')} />
          <Button label="Открыть демо-план" kind="secondary" onPress={() => finish('demo')} />
        </View>
      ) : (
        <Button label="Далее" onPress={() => setStep(step + 1)} />
      )}
      {step > 0 ? <Button label="Назад" kind="secondary" onPress={() => setStep(step - 1)} /> : null}
    </Screen>
  );
}
