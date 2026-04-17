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
    return invoke<SetupStatus>('complete_setup', {
      name: payload.name,
      secret: payload.password,
      biometricEnabled: payload.biometricEnabled,
    });
  },

  async unlockWithPassword(password: string): Promise<SetupStatus> {
    return invoke<SetupStatus>('unlock_vault', { secret: password });
  },

  async updateUserName(name: string): Promise<SetupStatus> {
    return invoke<SetupStatus>('update_user_name', { name });
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<SetupStatus> {
    return invoke<SetupStatus>('change_vault_secret', {
      currentSecret: currentPassword,
      newSecret: newPassword,
    });
  },

  async setBiometricEnabled(password: string, enabled: boolean): Promise<SetupStatus> {
    return invoke<SetupStatus>('set_biometric_enabled', {
      secret: password,
      enabled,
    });
  },

  async verifyPassword(password: string): Promise<void> {
    return invoke('verify_unlock_secret', { secret: password });
  },

  async resetBiometricRegistration(): Promise<void> {
    return invoke('reset_biometric_registration');
  },

  /** Lock the database and drop the open connection (M-5 idle-lock). */
  async lockDatabase(): Promise<void> {
    return invoke('lock_database');
  },

};
