import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function exportBackup(filename: string, json: string): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw new Error('Системное меню экспорта недоступно.');
  const file = new File(Paths.cache, filename);
  await file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Бэкап Chronos' });
}
