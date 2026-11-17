import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { feedback } from '../../src/platform/haptics';

const ACTIVE = '#6366F1';
const INACTIVE = '#A1A1AA';

type Icon = ComponentProps<typeof Ionicons>['name'];

const tabs: { name: string; label: string; icon: Icon; activeIcon: Icon }[] = [
  { name: 'index', label: 'Сегодня / Неделя', icon: 'calendar-outline', activeIcon: 'calendar' },
  { name: 'goals', label: 'Цели', icon: 'flag-outline', activeIcon: 'flag' },
  { name: 'schedule', label: 'Режим и Энергия', icon: 'flash-outline', activeIcon: 'flash' },
  { name: 'analytics', label: 'Аналитика', icon: 'bar-chart-outline', activeIcon: 'bar-chart' },
];

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: ACTIVE,
      tabBarInactiveTintColor: INACTIVE,
      tabBarStyle: { backgroundColor: '#09090B', borderTopColor: '#27272A' },
      tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      tabBarLabelPosition: 'below-icon',
    }}>
      {tabs.map(tab => (
        <Tabs.Screen key={tab.name} name={tab.name} listeners={{ tabPress: () => feedback('selection') }} options={{
          title: tab.label,
          tabBarIcon: ({ focused, size }) =>
            <Ionicons name={focused ? tab.activeIcon : tab.icon} color={focused ? ACTIVE : INACTIVE} size={size} />,
        }} />
      ))}
    </Tabs>
  );
}
