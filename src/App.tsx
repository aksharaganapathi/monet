import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startTransition } from 'react';
import { authenticate, checkStatus } from '@tauri-apps/plugin-biometric';
import { invoke } from '@tauri-apps/api/core';
import { Layout } from './components/Layout';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { AccountsPage } from './features/accounts/AccountsPage';
import { TransactionsPage } from './features/transactions/TransactionsPage';
import { CategoriesPage } from './features/categories/CategoriesPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { InsightsPage } from './features/insights/InsightsPage';
import { BudgetsPage } from './features/budgets/BudgetsPage';
import { useUIStore } from './store/uiStore';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import { Card } from './components/ui/Card';
import { authRepository } from './lib/repositories/authRepository';
import { normalizeAuthError } from './lib/authErrors';
import type { SetupStatus } from './lib/types';
import { LockKeyhole, ShieldCheck, Smile, UserRound } from 'lucide-react';
import monetLogo from './monet_logo.svg';

type AuthView = 'booting' | 'onboarding' | 'locked' | 'unlocked';

/** Lock the vault after this many milliseconds of inactivity (M-5). */
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

function toBase64Url(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

async function registerWebAuthn(userName?: string): Promise<void> {
  const opts: any = await invoke('start_register', { userName: userName?.trim() || null });
  opts.publicKey.challenge = fromBase64Url(opts.publicKey.challenge);
  opts.publicKey.user.id = fromBase64Url(opts.publicKey.user.id);
  opts.publicKey.authenticatorSelection = {
    ...(opts.publicKey.authenticatorSelection ?? {}),
    authenticatorAttachment: 'platform',
    residentKey: 'preferred',
    userVerification: 'required',
  };
  opts.publicKey.extensions = {
    ...(opts.publicKey.extensions ?? {}),
    credProps: true,
  };

  const created = await navigator.credentials.create(opts);
  if (!created) throw new Error('Registration cancelled');

  const cred = created as PublicKeyCredential;
  const authResponse = cred.response as AuthenticatorAttestationResponse;

  await invoke('finish_register', {
    credential: {
      id: cred.id,
      type: cred.type,
      rawId: toBase64Url(new Uint8Array(cred.rawId)),
      response: {
        clientDataJSON: toBase64Url(new Uint8Array(authResponse.clientDataJSON)),
        attestationObject: toBase64Url(new Uint8Array(authResponse.attestationObject)),
      },
    },
  });
}

async function runWindowsHelloUnlock(): Promise<void> {
  let opts: any;

  try {
    opts = await invoke('start_auth');
  } catch (err: any) {
    const message = err?.message || String(err ?? '');
    if (message.includes('No passkey registered')) {
      throw new Error('Biometric unlock has not been set up yet. Use your password first.');
    }
    throw err;
  }

  opts.publicKey.challenge = fromBase64Url(opts.publicKey.challenge);
  if (opts.publicKey.allowCredentials) {
    for (const credential of opts.publicKey.allowCredentials) {
      credential.id = fromBase64Url(credential.id);
      credential.transports = ['internal'];
    }
  }
  opts.publicKey.userVerification = 'required';

  const assertion = await navigator.credentials.get(opts);
  if (!assertion) {
    throw new Error('Authentication cancelled');
  }

  const cred = assertion as PublicKeyCredential;
  const authResponse = cred.response as AuthenticatorAssertionResponse;

  await invoke('finish_auth_and_init', {
    authRes: {
      id: cred.id,
      type: cred.type,
      rawId: toBase64Url(new Uint8Array(cred.rawId)),
      response: {
        clientDataJSON: toBase64Url(new Uint8Array(authResponse.clientDataJSON)),
        authenticatorData: toBase64Url(new Uint8Array(authResponse.authenticatorData)),
        signature: toBase64Url(new Uint8Array(authResponse.signature)),
        userHandle: authResponse.userHandle ? toBase64Url(new Uint8Array(authResponse.userHandle)) : undefined,
      },
    },
  });
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-surface px-4 py-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(168,139,74,0.18),transparent_36%),radial-gradient(circle_at_82%_20%,rgba(16,185,129,0.12),transparent_34%),radial-gradient(circle_at_72%_82%,rgba(46,111,149,0.11),transparent_42%)]"
      />
      <div className="relative z-10 w-full max-w-5xl">{children}</div>
    </div>
  );
}

function BootScreen() {
  return (
    <AuthShell>
      <div className="mx-auto flex max-w-sm flex-col items-center gap-5 rounded-[28px] border border-white/65 bg-white/72 px-8 py-10 text-center shadow-[0_22px_60px_-40px_rgba(15,23,42,0.6)] backdrop-blur-2xl">
        <img src={monetLogo} alt="Monet" className="h-auto w-60 object-contain drop-shadow-sm" />
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-text-secondary">Preparing vault</p>
          <p className="text-sm text-text-secondary">Loading your secure workspace and account summary.</p>
        </div>
      </div>
    </AuthShell>
  );
}

function OnboardingScreen({
  supportsBiometrics,
  busy,
  error,
  onSubmit,
}: {
  supportsBiometrics: boolean;
  busy: boolean;
  error: string;
  onSubmit: (payload: { name: string; password: string; confirmPassword: string; wantsBiometrics: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [wantsBiometrics, setWantsBiometrics] = useState(supportsBiometrics);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({ name, password, confirmPassword, wantsBiometrics: supportsBiometrics && wantsBiometrics });
  };

  return (
    <AuthShell>
      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="glass-card flex min-h-[520px] flex-col justify-between rounded-[28px] p-8">
          <div className="space-y-6">
            <img src={monetLogo} alt="Monet" className="h-auto w-64 object-contain" />
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-text-secondary">First-time setup</p>
              <h1 className="max-w-md text-4xl font-semibold tracking-[-0.04em] text-text-primary">
                Build a private vault that still feels personal.
              </h1>
              <p className="max-w-lg text-sm leading-6 text-text-secondary">
                Set your name, choose a password-backed encryption key, and optionally add Windows Hello so future unlocks can feel instant without storing the database key in plaintext.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/60 bg-white/60 p-4">
              <UserRound size={18} className="text-accent" />
              <p className="mt-3 text-sm font-semibold text-text-primary">Personal greeting</p>
              <p className="mt-1 text-xs leading-5 text-text-secondary">Monet will greet you by name on the dashboard.</p>
            </div>
            <div className="rounded-2xl border border-white/60 bg-white/60 p-4">
              <LockKeyhole size={18} className="text-accent" />
              <p className="mt-3 text-sm font-semibold text-text-primary">Password-derived unlock</p>
              <p className="mt-1 text-xs leading-5 text-text-secondary">Your password derives the database key instead of writing one to disk in plaintext.</p>
            </div>
            <div className="rounded-2xl border border-white/60 bg-white/60 p-4">
              <ShieldCheck size={18} className="text-accent" />
              <p className="mt-3 text-sm font-semibold text-text-primary">Optional biometrics</p>
              <p className="mt-1 text-xs leading-5 text-text-secondary">Windows Hello can unlock the protected key when available.</p>
            </div>
          </div>
        </Card>

        <Card className="glass-card rounded-[28px] p-8">
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-secondary">Secure onboarding</p>
              <h2 className="text-2xl font-semibold text-text-primary">Tell Monet who it’s for</h2>
            </div>

            <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Akshara" autoFocus />
            <Input label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Choose a strong password" />
            <Input
              label="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter password"
            />

            <label className={`flex items-start gap-3 rounded-2xl border p-4 ${supportsBiometrics ? 'border-white/60 bg-white/55' : 'border-border bg-white/40 opacity-70'}`}>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
                checked={supportsBiometrics && wantsBiometrics}
                onChange={(event) => setWantsBiometrics(event.target.checked)}
                disabled={!supportsBiometrics}
              />
              <span className="block">
                <span className="block text-sm font-semibold text-text-primary">Set up Windows Hello unlock</span>
                <span className="mt-1 block text-xs leading-5 text-text-secondary">
                  {supportsBiometrics
                    ? 'If setup succeeds, biometric approval can unlock Monet without asking for your password every time.'
                    : 'Biometric setup is only available in the Windows desktop app right now.'}
                </span>
              </span>
            </label>

            {error && <p className="rounded-2xl border border-expense/30 bg-expense-subtle px-4 py-3 text-sm text-expense">{error}</p>}

            <Button type="submit" className="w-full justify-center" size="lg" disabled={busy}>
              {busy ? 'Setting up Monet...' : 'Finish setup'}
            </Button>
          </form>
        </Card>
      </div>
    </AuthShell>
  );
}

function LockScreen({
  canUseBiometrics,
  usePassword,
  busy,
  error,
  onUnlockWithPassword,
  onUnlockWithBiometrics,
  onToggleMode,
}: {
  canUseBiometrics: boolean;
  usePassword: boolean;
  busy: boolean;
  error: string;
  onUnlockWithPassword: (password: string) => Promise<void>;
  onUnlockWithBiometrics: () => Promise<void>;
  onToggleMode: (nextUsePassword: boolean) => void;
}) {
  const [password, setPassword] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onUnlockWithPassword(password);
  };

  return (
    <AuthShell>
      <div className="mx-auto grid max-w-4xl gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="glass-card rounded-[28px] p-8">
          <img src={monetLogo} alt="Monet" className="h-auto w-64 object-contain" />
          <div className="mt-8 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-text-secondary">Vault locked</p>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-text-primary">Welcome back to Monet.</h1>
            <p className="max-w-md text-sm leading-6 text-text-secondary">
              Your database now uses password-derived encryption. If biometric unlock is available, you can use that first and fall back to your password anytime.
            </p>
          </div>

          <div className="mt-8 rounded-[24px] border border-white/60 bg-white/55 p-5">
            <p className="text-sm font-semibold text-text-primary">Unlock options</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  if (canUseBiometrics) {
                    onToggleMode(false);
                  }
                }}
                disabled={!canUseBiometrics}
                aria-disabled={!canUseBiometrics}
                className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
                  canUseBiometrics
                    ? !usePassword
                      ? 'border-accent bg-accent-subtle text-text-primary'
                      : 'border-white/60 bg-white/55 text-text-secondary'
                    : 'cursor-not-allowed border-border bg-surface-muted text-text-tertiary opacity-70'
                }`}
              >
                <p className="text-sm font-semibold">Biometric unlock</p>
                <p className="mt-1 text-xs leading-5">{canUseBiometrics ? 'Use Windows Hello if it is already configured.' : 'Biometric unlock is not available on this setup.'}</p>
              </button>
              <button
                type="button"
                onClick={() => onToggleMode(true)}
                className={`rounded-2xl border px-4 py-4 text-left transition-colors ${usePassword ? 'border-accent bg-accent-subtle text-text-primary' : 'border-white/60 bg-white/55 text-text-secondary'}`}
              >
                <p className="text-sm font-semibold">Password unlock</p>
                <p className="mt-1 text-xs leading-5">Use your password to derive the encryption key directly.</p>
              </button>
            </div>
          </div>
        </Card>

        <Card className="glass-card rounded-[28px] p-8">
          {!usePassword && canUseBiometrics ? (
            <div className="flex h-full flex-col justify-between gap-6">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-secondary">Biometric unlock</p>
                <h2 className="text-2xl font-semibold text-text-primary">Use Windows Hello</h2>
                <p className="text-sm leading-6 text-text-secondary">
                  Approve the prompt and Monet will use your protected unlock secret instead of asking for the password first.
                </p>
              </div>

              <div className={`rounded-[24px] border border-white/60 bg-white/60 p-6 text-center transition-transform ${error ? 'animate-[shake_0.4s_cubic-bezier(.36,.07,.19,.97)_both]' : ''}`}>
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-subtle text-accent">
                  <Smile size={28} />
                </div>
                <Button onClick={onUnlockWithBiometrics} className="mt-5 w-full justify-center gap-2" size="lg" disabled={busy}>
                  {busy ? 'Waiting for approval...' : 'Unlock with biometrics'}
                </Button>
                <button type="button" onClick={() => onToggleMode(true)} className="mt-4 text-sm font-medium text-text-secondary hover:text-text-primary">
                  Use password instead
                </button>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-secondary">Password unlock</p>
                <h2 className="text-2xl font-semibold text-text-primary">Enter your Monet password</h2>
                <p className="text-sm leading-6 text-text-secondary">If biometric unlock is unavailable or skipped, your password can always unlock the encrypted database.</p>
              </div>
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
                placeholder="Enter password"
              />

              {canUseBiometrics && (
                <button type="button" onClick={() => onToggleMode(false)} className="text-sm font-medium text-text-secondary hover:text-text-primary">
                  Try biometric unlock instead
                </button>
              )}

              {error && <p className="rounded-2xl border border-expense/30 bg-expense-subtle px-4 py-3 text-sm text-expense">{error}</p>}

              <Button type="submit" className="w-full justify-center" size="lg" disabled={busy}>
                {busy ? 'Unlocking...' : 'Unlock Monet'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </AuthShell>
  );
}

function App() {
  const { activePage } = useUIStore();
  const [authView, setAuthView] = useState<AuthView>('booting');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [usePasswordUnlock, setUsePasswordUnlock] = useState(false);

  const isTauriRuntime = typeof window !== 'undefined' && Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  const isWindowsRuntime = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);
  const isMobileRuntime = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

  const supportsBiometrics = useMemo(() => {
    if (!isTauriRuntime) return false;
    if (isWindowsRuntime) {
      return window.isSecureContext && 'PublicKeyCredential' in window && Boolean(navigator.credentials);
    }
    return false;
  }, [isTauriRuntime, isWindowsRuntime]);

  // --- Idle-lock timer (M-5) ---
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authViewRef = useRef(authView);
  authViewRef.current = authView;

  const lockVault = useCallback(async () => {
    if (!isTauriRuntime || authViewRef.current !== 'unlocked') return;
    try {
      await authRepository.lockDatabase();
    } catch {
      // best-effort; proceed to UI lock regardless
    }
    setAuthView('locked');
    setAuthError('');
    setUsePasswordUnlock(true);
  }, [isTauriRuntime]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(lockVault, IDLE_TIMEOUT_MS);
  }, [lockVault]);

  useEffect(() => {
    if (!isTauriRuntime || authView !== 'unlocked') {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }

    const events = ['mousemove', 'keydown', 'pointerdown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, resetIdleTimer, { passive: true }));
    resetIdleTimer(); // start the timer immediately on unlock

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdleTimer));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [isTauriRuntime, authView, resetIdleTimer]);

  useEffect(() => {
    const boot = async () => {
      if (!isTauriRuntime) {
        setAuthView('unlocked');
        return;
      }

      try {
        const status = await authRepository.getSetupStatus();
        setSetupStatus(status);
        setUserName(status.userName);

        if (!status.userName) {
          setAuthView('onboarding');
          return;
        }

        startTransition(() => {
          setUsePasswordUnlock(!status.canUseBiometricUnlock);
          setAuthView('locked');
        });
      } catch (error) {
        setAuthError(normalizeAuthError(error));
        setAuthView('onboarding');
      }
    };

    boot();
  }, [isTauriRuntime]);

  const unlockWithPassword = async (password: string) => {
    try {
      setAuthBusy(true);
      setAuthError('');
      const status = await authRepository.unlockWithPassword(password);
      setSetupStatus(status);
      setUserName(status.userName);
      setAuthView('unlocked');
    } catch (error) {
      setAuthError(normalizeAuthError(error));
      setAuthView('locked');
      setUsePasswordUnlock(true);
    } finally {
      setAuthBusy(false);
    }
  };

  const unlockWithBiometrics = async () => {
    try {
      setAuthBusy(true);
      setAuthError('');

      if (isWindowsRuntime) {
        await runWindowsHelloUnlock();
        setAuthView('unlocked');
        return;
      }

      if (isMobileRuntime) {
        const status = await checkStatus();
        if (!status.isAvailable) {
          throw new Error('Biometric unlock is not available on this device.');
        }
        await authenticate('Log in to Monet');
        setAuthView('unlocked');
        return;
      }

      throw new Error('Biometric unlock is not available in this environment.');
    } catch (error) {
      setAuthError(normalizeAuthError(error));
      setUsePasswordUnlock(true);
    } finally {
      setAuthBusy(false);
    }
  };

  const completeOnboarding = async (payload: {
    name: string;
    password: string;
    confirmPassword: string;
    wantsBiometrics: boolean;
  }) => {
    if (!payload.name.trim()) {
      setAuthError('Please enter your name.');
      return;
    }

    if (payload.password.length < 12) {
      setAuthError('Please choose a password with at least 12 characters.');
      return;
    }

    if (payload.password !== payload.confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }

    try {
      setAuthBusy(true);
      setAuthError('');

      if (payload.wantsBiometrics) {
        await registerWebAuthn(payload.name);
      }

      const status = await authRepository.completeOnboarding({
        name: payload.name.trim(),
        password: payload.password,
        biometricEnabled: payload.wantsBiometrics,
      });

      setSetupStatus(status);
      setUserName(status.userName);
      setUsePasswordUnlock(!status.canUseBiometricUnlock);
      setAuthView('unlocked');
    } catch (error) {
      setAuthError(normalizeAuthError(error));
      setAuthView('onboarding');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleStatusChange = (status: SetupStatus) => {
    setSetupStatus(status);
    setUserName(status.userName);
  };

  if (authView === 'booting') {
    return <BootScreen />;
  }

  if (authView === 'onboarding') {
    return (
      <OnboardingScreen
        supportsBiometrics={supportsBiometrics}
        busy={authBusy}
        error={authError}
        onSubmit={completeOnboarding}
      />
    );
  }

  if (authView === 'locked') {
    return (
      <LockScreen
        canUseBiometrics={Boolean(setupStatus?.canUseBiometricUnlock)}
        usePassword={usePasswordUnlock}
        busy={authBusy}
        error={authError}
        onUnlockWithPassword={unlockWithPassword}
        onUnlockWithBiometrics={unlockWithBiometrics}
        onToggleMode={setUsePasswordUnlock}
      />
    );
  }

  return (
    <Layout>
      <div className={activePage === 'dashboard' ? 'block h-full' : 'hidden h-full'}>
        <DashboardPage
          userName={userName ?? undefined}
          aiEnabled={setupStatus?.aiEnabled ?? false}
        />
      </div>
      <div className={activePage === 'accounts' ? 'block h-full' : 'hidden h-full'}>
        <AccountsPage />
      </div>
      <div className={activePage === 'transactions' ? 'block h-full' : 'hidden h-full'}>
        <TransactionsPage />
      </div>
      <div className={activePage === 'budgets' ? 'block h-full' : 'hidden h-full'}>
        <BudgetsPage />
      </div>
      <div className={activePage === 'categories' ? 'block h-full' : 'hidden h-full'}>
        <CategoriesPage />
      </div>
      <div className={activePage === 'settings' ? 'block h-full' : 'hidden h-full'}>
        <SettingsPage
          setupStatus={setupStatus}
          supportsBiometrics={supportsBiometrics}
          onStatusChange={handleStatusChange}
          onRequestBiometricEnrollment={() => registerWebAuthn(userName ?? undefined)}
        />
      </div>
      <div className={activePage === 'insights' ? 'block h-full' : 'hidden h-full'}>
        <InsightsPage />
      </div>
    </Layout>
  );
}

export default App;
