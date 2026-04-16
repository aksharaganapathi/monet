import { invoke } from '@tauri-apps/api/core';
import type { SetupStatus } from '../types';

export const authRepository = {
  async getSetupStatus(): Promise<SetupStatus> {
    return invoke<SetupStatus>('get_setup_status');
  },

  async completeOnboarding(payload: {
    name: string;
    password: string;
    biometricEnabled: boolean;
  }): Promise<SetupStatus> {
    return invoke<SetupStatus>('complete_onboarding', payload);
  },

  async unlockWithPassword(password: string): Promise<SetupStatus> {
    return invoke<SetupStatus>('unlock_with_password', { password });
  },

  async updateUserName(name: string): Promise<SetupStatus> {
    return invoke<SetupStatus>('update_user_name', { name });
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<SetupStatus> {
    return invoke<SetupStatus>('change_password', {
      currentPassword,
      newPassword,
    });
  },

  async setBiometricEnabled(password: string, enabled: boolean): Promise<SetupStatus> {
    return invoke<SetupStatus>('set_biometric_enabled', {
      password,
      enabled,
    });
  },

  async verifyPassword(password: string): Promise<void> {
    return invoke('verify_password', { password });
  },

  async resetBiometricRegistration(): Promise<void> {
    return invoke('reset_biometric_registration');
  },

  /** Lock the database and drop the open connection (M-5 idle-lock). */
  async lockDatabase(): Promise<void> {
    return invoke('lock_database');
  },

};
