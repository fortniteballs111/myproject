export function registerOfflineWorker(): void {
  if (__DEV__ || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Chronos offline:', error));
}
