import { invoke } from '@tauri-apps/api/core';

export const insightsRepository = {
  async getMonthStory(year: number, month: number): Promise<string> {
    const summary = await invoke<string>('summarize_month_story', { year, month });
    return summary;
  },
};
