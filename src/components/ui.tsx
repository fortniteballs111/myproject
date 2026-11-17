import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: '#09090B' }}>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 28 }}>
          <View className="mx-auto w-full max-w-2xl gap-5 px-5 pb-4 pt-5">{children}</View>
        </ScrollView>
      ) : children}
    </SafeAreaView>
  );
}

export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="gap-1">
      <Text accessibilityRole="header" className="text-3xl font-bold text-zinc-50">{title}</Text>
      {subtitle ? <Text className="text-sm leading-5 text-zinc-400">{subtitle}</Text> : null}
    </View>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return <View className="gap-3 rounded-2xl border border-zinc-800 bg-card p-4">{children}</View>;
}

export function Button({ label, onPress, kind = 'primary', disabled = false }: {
  label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean;
}) {
  const background = disabled ? 'bg-zinc-800' : kind === 'primary' ? 'bg-accent' :
    kind === 'danger' ? 'bg-red-950' : 'bg-zinc-800';
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      className={'min-h-11 justify-center rounded-xl px-4 py-3 active:opacity-75 ' + background}
    >
      <Text className={'text-center text-sm font-semibold ' + (kind === 'danger' ? 'text-red-200' : 'text-white')}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
      className={'min-h-10 justify-center rounded-xl border px-3 py-2 ' +
        (selected ? 'border-indigo-400 bg-indigo-950' : 'border-zinc-700 bg-card')}
    >
      <Text className={'text-sm font-medium ' + (selected ? 'text-indigo-100' : 'text-zinc-300')}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-zinc-200">{label}</Text>
      <TextInput
        accessibilityLabel={label} placeholderTextColor="#71717A"
        className="min-h-11 rounded-xl border border-zinc-700 bg-background px-3 py-2 text-base text-zinc-50"
        {...props}
      />
    </View>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' }}>
        <View accessibilityViewIsModal className="mx-auto max-h-[92%] w-full max-w-2xl rounded-t-3xl border border-zinc-800 bg-card">
          <ScrollView keyboardShouldPersistTaps="handled">
            <View className="gap-4 p-5">
              <View className="flex-row items-center justify-between gap-4">
                <Text accessibilityRole="header" className="flex-1 text-xl font-bold text-zinc-50">{title}</Text>
                <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} className="py-2">
                  <Text className="font-semibold text-indigo-300">Закрыть</Text>
                </Pressable>
              </View>
              {children}
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

export function Feedback({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <Text accessibilityLiveRegion="polite" className={'text-sm leading-5 ' + (error ? 'text-red-300' : 'text-zinc-300')}>
      {children}
    </Text>
  );
}
