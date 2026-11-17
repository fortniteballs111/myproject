import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export function feedback(kind: 'selection' | 'impact' | 'success') {
  if (Platform.OS === 'web') return;
  const action = kind === 'selection' ? Haptics.selectionAsync() :
    kind === 'impact' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) :
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  void action.catch(() => undefined);
}
