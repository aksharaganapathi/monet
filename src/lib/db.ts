import { invoke } from '@tauri-apps/api/core';

class CustomDatabase {
  async execute(query: string, bindValues?: unknown[]): Promise<{ lastInsertId: number; rowsAffected: number }> {
    return await invoke('db_execute', { query, bindValues });
  }
  async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    return await invoke('db_select', { query, bindValues });
  }
}

const db = new CustomDatabase();

export async function getDb(): Promise<CustomDatabase> {
  return db;
}
