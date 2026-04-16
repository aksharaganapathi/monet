import { FormEvent, KeyboardEvent, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Fingerprint,
  KeyRound,
  Link2,
  Mail,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { authRepository } from '../../lib/repositories/authRepository';
import { settingsRepository } from '../../lib/repositories/settingsRepository';
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

function getUnknownErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }

    const serialized = String(error);
    if (serialized && serialized !== '[object Object]') {
      return serialized;
    }
  }

  return fallback;
}

function normalizeTrustedSender(value: string): string | null {
  const lowered = value.trim().toLowerCase();
  if (!lowered) {
    return null;
  }

  const emailMatch = lowered.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  if (emailMatch?.[0]) {
    return emailMatch[0];
  }

  const normalizedDomain = lowered
    .replace(/^@+/, '')
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/\.$/, '');

  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalizedDomain)) {
    return normalizedDomain;
  }

  return null;
}

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

  // Sync domains & Google OAuth
  const [syncDomains, setSyncDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const [googleConnectBusy, setGoogleConnectBusy] = useState(false);
  const [syncActive, setSyncActive] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState('');

  // Load settings from encrypted DB on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [domains, active, email] = await Promise.all([
          settingsRepository.getSyncDomains(),
          settingsRepository.isSyncActive(),
          settingsRepository.getGoogleConnectedEmail(),
        ]);
        setSyncDomains(domains);
        setSyncActive(active);
        setConnectedEmail(email);
      } catch {
        // Settings not available yet (DB not open)
      }
    };
    void loadSettings();
  }, []);

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

  const addDomain = async () => {
    setSyncError('');
    const normalized = normalizeTrustedSender(newDomain);
    if (!normalized) {
      setSyncError('Enter a valid sender email or domain, such as alerts@bank.com or chase.com.');
      return;
    }
    if (syncDomains.includes(normalized)) {
      setNewDomain('');
      return;
    }

    const previous = syncDomains;
    const updated = [...syncDomains, normalized];
    setSyncDomains(updated);
    setNewDomain('');

    try {
      await settingsRepository.setSyncDomains(updated);
    } catch (error) {
      setSyncDomains(previous);
      setSyncError(error instanceof Error ? error.message : 'Unable to save trusted senders.');
    }
  };

  const removeDomain = async (domain: string) => {
    setSyncError('');
    const previous = syncDomains;
    const updated = syncDomains.filter((d) => d !== domain);
    setSyncDomains(updated);
    try {
      await settingsRepository.setSyncDomains(updated);
    } catch (error) {
      setSyncDomains(previous);
      setSyncError(error instanceof Error ? error.message : 'Unable to update trusted senders.');
    }
  };

  const handleDomainKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void addDomain();
    }
  };

  const connectGoogle = async () => {
    setGoogleConnectBusy(true);
    setSyncError('');
    setSyncMessage('');
    try {
      const message = await settingsRepository.connectGoogleAccount();
      setSyncMessage(message);
      setSyncActive(true);
      const [email] = await Promise.all([
        settingsRepository.getGoogleConnectedEmail(),
      ]);
      setConnectedEmail(email);
    } catch (error) {
      setSyncError(getUnknownErrorMessage(error, 'Unable to start Google connection flow.'));
    } finally {
      setGoogleConnectBusy(false);
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

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-4 overflow-y-auto pr-1">
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
                    ? 'Note: For convenience, the database key is protected by your Windows OS session, meaning it can be decrypted by any process running as you without your fingerprint.'
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

            {/* AI Insights toggle */}
            <Card className="col-span-12 rounded-[24px] p-5">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                    <Sparkles size={18} />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">AI Insights</h2>
                    <p className="text-sm text-text-secondary">
                      Monthly spending summaries powered by your chosen AI provider. Financial data is sent only when enabled.
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
                    {aiEnabled ? 'AI summaries are on — spending data is sent to your provider.' : 'Enable AI-powered monthly summaries (opt-in)'}
                  </span>
                </label>

                {aiMessage && <p className="text-sm text-income">{aiMessage}</p>}
                {aiError && <p className="text-sm text-expense">{aiError}</p>}
              </div>
            </Card>

            {/* Email Sync */}
            <Card className="col-span-12 rounded-[24px] p-5">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-income-subtle text-income">
                    <Mail size={18} />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">Email Sync</h2>
                    <p className="text-sm text-text-secondary">
                      Seamlessly connect your Google account to import transaction emails.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="primary"
                    icon={<Link2 size={14} />}
                    onClick={() => void connectGoogle()}
                    disabled={googleConnectBusy}
                  >
                    {googleConnectBusy ? 'Opening Google Sign-In...' : 'Sign in with Google'}
                  </Button>
                  {syncActive && (
                    <span className="rounded-full border border-income/30 bg-income-subtle px-3 py-1 text-xs font-semibold text-income">
                      Syncing is active
                    </span>
                  )}
                </div>

                {syncActive && connectedEmail && (
                  <p className="text-xs text-text-secondary">
                    Connected account: <span className="font-semibold text-text-primary">{connectedEmail}</span>
                  </p>
                )}

                {/* Trusted senders list */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                    Trusted email senders
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-text-primary outline-none transition-shadow placeholder:text-text-tertiary focus:ring-2 focus:ring-accent/20"
                      placeholder="alerts@bank.com"
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      onKeyDown={handleDomainKeyDown}
                    />
                    <Button type="button" variant="secondary" icon={<Plus size={14} />} onClick={() => void addDomain()}>
                      Add
                    </Button>
                  </div>
                  {syncDomains.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {syncDomains.map((domain) => (
                        <span
                          key={domain}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs font-medium text-text-primary"
                        >
                          {domain}
                          <button
                            type="button"
                            className="text-text-tertiary transition-colors hover:text-expense"
                            onClick={() => void removeDomain(domain)}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {syncMessage && <p className="text-sm text-income">{syncMessage}</p>}
                {syncError && <p className="text-sm text-expense">{syncError}</p>}
              </div>
            </Card>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
