import { invoke } from '@tauri-apps/api/core';

export const settingsRepository = {
  async get(key: string): Promise<string | null> {
    return invoke<string | null>('get_setting', { key });
  },

  async put(key: string, value: string): Promise<void> {
    return invoke('put_setting', { key, value });
  },

  async remove(key: string): Promise<void> {
    return invoke('delete_setting', { key });
  },

  async getAll(): Promise<Array<{ key: string; value: string }>> {
    const rows = await invoke<Array<{ key: string; value: string }>>('get_all_settings');
    return rows;
  },

  // --- Sync domains ---

  async getSyncDomains(): Promise<string[]> {
    const raw = await this.get('sync_domains');
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  async setSyncDomains(domains: string[]): Promise<void> {
    return this.put('sync_domains', JSON.stringify(domains));
  },

  async connectGoogleAccount(): Promise<string> {
    return invoke<string>('connect_google_account');
  },

  async isSyncActive(): Promise<boolean> {
    const value = await this.get('sync_active');
    return value === '1';
  },

  async isSyncWorkerActive(): Promise<boolean> {
    const value = await this.get('sync_worker_active');
    return value === '1';
  },

  async getGoogleConnectedEmail(): Promise<string> {
    return (await this.get('google_connected_email')) ?? '';
  },

  // --- Sync import ---

  async importSyncQueue(): Promise<{ imported: number }> {
    return invoke<{ imported: number }>('import_sync_queue');
  },
};
