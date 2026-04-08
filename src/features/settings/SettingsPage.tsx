import { FormEvent, useState } from 'react';
import { motion } from 'framer-motion';
import { Fingerprint, KeyRound, Save, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { authRepository } from '../../lib/repositories/authRepository';
import { normalizeAuthError } from '../../lib/authErrors';
import type { SetupStatus } from '../../lib/types';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

export function SettingsPage({
  setupStatus,
  supportsBiometrics,
  onStatusChange,
  onRequestBiometricEnrollment,
}: {
  setupStatus: SetupStatus | null;
  supportsBiometrics: boolean;
  onStatusChange: (status: SetupStatus) => void;
  onRequestBiometricEnrollment: () => Promise<void>;
}) {
  const [name, setName] = useState(setupStatus?.userName ?? '');
  const [nameMessage, setNameMessage] = useState('');
  const [nameError, setNameError] = useState('');
  const [nameBusy, setNameBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [biometricPassword, setBiometricPassword] = useState('');
  const [biometricMessage, setBiometricMessage] = useState('');
  const [biometricError, setBiometricError] = useState('');
  const [biometricBusy, setBiometricBusy] = useState(false);

  const [aiEnabled, setAiEnabled] = useState(setupStatus?.aiEnabled ?? false);
  const [aiMessage, setAiMessage] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    setNameBusy(true);
    setNameError('');
    setNameMessage('');
    try {
      const status = await authRepository.updateUserName(name);
      onStatusChange(status);
      setName(status.userName ?? '');
      setNameMessage('Name updated.');
    } catch (error) {
      setNameError(error instanceof Error ? error.message : 'Unable to update name.');
    } finally {
      setNameBusy(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentPassword) {
      setPasswordError('E-AUTH-PASSWORD-REQUIRED: Enter your current password.');
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError('E-AUTH-PASSWORD-SHORT: New password must be at least 12 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('E-AUTH-PASSWORD-MISMATCH: New passwords do not match.');
      return;
    }

    setPasswordBusy(true);
    setPasswordError('');
    setPasswordMessage('');
    try {
      const status = await authRepository.changePassword(currentPassword, newPassword);
      onStatusChange(status);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated and database rekeyed.');
    } catch (error) {
      setPasswordError(normalizeAuthError(error, 'E-AUTH-PASSWORD-CHANGE: Unable to change password.'));
    } finally {
      setPasswordBusy(false);
    }
  };

  const toggleBiometric = async (enable: boolean) => {
    setBiometricBusy(true);
    setBiometricError('');
    setBiometricMessage('');
    try {
      if (enable) {
        if (!supportsBiometrics) {
          throw new Error('E-BIO-UNAVAILABLE: Biometrics are only available in the Windows desktop app.');
        }
        if (!biometricPassword) {
          throw new Error('E-AUTH-PASSWORD-REQUIRED: Enter your password.');
        }
        await authRepository.verifyPassword(biometricPassword);
        try {
          await onRequestBiometricEnrollment();
        } catch (error) {
          const message = normalizeAuthError(error, 'E-BIO-ENROLL: Unable to enroll biometrics.');
          throw new Error(message);
        }
      } else if (!biometricPassword) {
        throw new Error('E-AUTH-PASSWORD-REQUIRED: Enter your password.');
      }

      const status = await authRepository.setBiometricEnabled(biometricPassword, enable);
      onStatusChange(status);
      setBiometricPassword('');
      setBiometricMessage(enable ? 'Biometric unlock enabled.' : 'Biometric unlock disabled.');
    } catch (error) {
      setBiometricError(normalizeAuthError(error, 'E-BIO-UPDATE: Unable to update biometric settings.'));
    } finally {
      setBiometricBusy(false);
    }
  };

  const toggleAi = async (enable: boolean) => {
    setAiBusy(true);
    setAiError('');
    setAiMessage('');
    try {
      const status = await authRepository.setAiEnabled(enable);
      onStatusChange(status);
      setAiEnabled(enable);
      setAiMessage(enable ? 'AI summaries enabled.' : 'AI summaries disabled.');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Unable to update AI settings.');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="flex h-full min-h-0 flex-col gap-4">
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text-primary">Settings</h1>
          <p className="mt-1 text-sm text-text-secondary">Update the personal and security details around your vault.</p>
        </div>
      </motion.div>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-4">
        <motion.div variants={item} className="col-span-12 lg:col-span-4">
          <Card className="h-full rounded-[24px] p-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                <ShieldCheck size={20} />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">Security posture</p>
                <h2 className="mt-1 text-lg font-semibold text-text-primary">Vault access</h2>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-white/60 bg-white/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">Name</p>
                <p className="mt-1 text-base font-semibold text-text-primary">{setupStatus?.userName ?? 'Not set'}</p>
              </div>
              <div className="rounded-2xl border border-white/60 bg-white/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">Password unlock</p>
                <p className="mt-1 text-sm text-text-primary">Required for recovery and for changing security settings.</p>
              </div>
              <div className="rounded-2xl border border-white/60 bg-white/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">Biometric unlock</p>
                <p className="mt-1 text-sm text-text-primary">
                  {setupStatus?.biometricEnabled ? 'Enabled' : 'Disabled'}
                </p>
                <p className="mt-1 text-xs leading-5 text-text-secondary">
                  {setupStatus?.biometricEnabled
                    ? 'Biometric approval can unlock the protected key.'
                    : 'You can enable Windows Hello after setup if you want a faster unlock path.'}
                </p>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="col-span-12 lg:col-span-8">
          <div className="grid h-full grid-cols-12 gap-4">
            <Card className="col-span-12 rounded-[24px] p-5">
              <form onSubmit={saveName} className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                    <UserRound size={18} />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">Profile</h2>
                    <p className="text-sm text-text-secondary">Change the name used in your dashboard greeting.</p>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                  <Input label="Display name" value={name} onChange={(event) => setName(event.target.value)} />
                  <Button type="submit" icon={<Save size={16} />} disabled={nameBusy}>
                    {nameBusy ? 'Saving...' : 'Save Name'}
                  </Button>
                </div>
                {nameMessage && <p className="text-sm text-income">{nameMessage}</p>}
                {nameError && <p className="text-sm text-expense">{nameError}</p>}
              </form>
            </Card>

            <Card className="col-span-12 xl:col-span-7 rounded-[24px] p-5">
              <form onSubmit={savePassword} className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-warning-subtle text-warning">
                    <KeyRound size={18} />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">Password</h2>
                    <p className="text-sm text-text-secondary">Changing it will rekey the encrypted database.</p>
                  </div>
                </div>
                <Input label="Current password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                <div className="grid gap-4 md:grid-cols-2">
                  <Input label="New password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                  <Input label="Confirm new password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    {passwordMessage && <p className="text-sm text-income">{passwordMessage}</p>}
                    {passwordError && <p className="text-sm text-expense">{passwordError}</p>}
                  </div>
                  <Button type="submit" disabled={passwordBusy}>
                    {passwordBusy ? 'Updating...' : 'Change Password'}
                  </Button>
                </div>
              </form>
            </Card>

            <Card className="col-span-12 xl:col-span-5 rounded-[24px] p-5">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-income-subtle text-income">
                    <Fingerprint size={18} />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">Biometrics</h2>
                    <p className="text-sm text-text-secondary">Enroll or remove biometric unlock after setup.</p>
                  </div>
                </div>

                <Input
                  label="Password confirmation"
                  type="password"
                  value={biometricPassword}
                  onChange={(event) => setBiometricPassword(event.target.value)}
                  placeholder="Required to update biometric unlock"
                />

                <div className="grid gap-3">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => toggleBiometric(true)}
                    disabled={biometricBusy}
                    className="w-full justify-center"
                  >
                    {biometricBusy ? 'Updating...' : setupStatus?.biometricEnabled ? 'Re-enroll Biometrics' : 'Enable Biometrics'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => toggleBiometric(false)}
                    disabled={biometricBusy || !setupStatus?.biometricEnabled}
                    className="w-full justify-center"
                  >
                    {biometricBusy && setupStatus?.biometricEnabled ? 'Disabling...' : 'Disable Biometrics'}
                  </Button>
                </div>

                {biometricMessage && <p className="text-sm text-income">{biometricMessage}</p>}
                {biometricError && <p className="text-sm text-expense">{biometricError}</p>}
              </div>
            </Card>

            <Card className="col-span-12 rounded-[24px] p-5">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                    <Sparkles size={18} />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">AI Insights</h2>
                    <p className="text-sm text-text-secondary">
                      Monthly spending summaries powered by Groq. Financial data is sent to Groq's API only when enabled.
                    </p>
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/60 bg-white/60 p-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-accent)]"
                    checked={aiEnabled}
                    onChange={(e) => toggleAi(e.target.checked)}
                    disabled={aiBusy}
                  />
                  <span className="text-sm font-medium text-text-primary">
                    {aiEnabled ? 'AI summaries are on — spending data is sent to Groq.' : 'Enable AI-powered monthly summaries (opt-in)'}
                  </span>
                </label>

                {aiMessage && <p className="text-sm text-income">{aiMessage}</p>}
                {aiError && <p className="text-sm text-expense">{aiError}</p>}
              </div>
            </Card>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
