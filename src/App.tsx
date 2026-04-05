import { useEffect, useState, useRef } from 'react';
import { checkStatus, authenticate } from '@tauri-apps/plugin-biometric';
import { invoke } from '@tauri-apps/api/core';
import { Layout } from './components/Layout';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { AccountsPage } from './features/accounts/AccountsPage';
import { TransactionsPage } from './features/transactions/TransactionsPage';
import { CategoriesPage } from './features/categories/CategoriesPage';
import { useUIStore } from './store/uiStore';
import { Button } from './components/ui/Button';
import { Smile } from 'lucide-react';
import monetLogo from './monet_logo.png';

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


async function registerWebAuthn(): Promise<void> {
  const opts: any = await invoke('start_register');
  opts.publicKey.challenge = fromBase64Url(opts.publicKey.challenge);
  opts.publicKey.user.id = fromBase64Url(opts.publicKey.user.id);
  
  const created = await navigator.credentials.create(opts);
  if (!created) throw new Error('Registration cancelled');
  
  const cred = created as PublicKeyCredential;
  const authResponse = cred.response as AuthenticatorAttestationResponse;
  
  const credJson = {
    id: cred.id,
    type: cred.type,
    rawId: toBase64Url(new Uint8Array(cred.rawId)),
    response: {
      clientDataJSON: toBase64Url(new Uint8Array(authResponse.clientDataJSON)),
      attestationObject: toBase64Url(new Uint8Array(authResponse.attestationObject)),
    }
  };
  await invoke('finish_register', { credential: credJson });
}

async function runWindowsHelloCheck(): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Windows Hello is not available in this environment.');
  }

  if (!window.isSecureContext || !('PublicKeyCredential' in window) || !navigator.credentials) {
    throw new Error('Windows Hello is not supported in this runtime.');
  }

  let opts: any;
  try {
    opts = await invoke('start_auth');
  } catch (err: any) {
    if (err.includes('No passkey registered')) {
      await registerWebAuthn();
      opts = await invoke('start_auth');
    } else {
      throw err;
    }
  }

  opts.publicKey.challenge = fromBase64Url(opts.publicKey.challenge);
  if (opts.publicKey.allowCredentials) {
     for (let c of opts.publicKey.allowCredentials) {
         c.id = fromBase64Url(c.id);
     }
  }
  
  const assertion = await navigator.credentials.get(opts);
  if (!assertion) throw new Error('Authentication cancelled');
  
  const cred = assertion as PublicKeyCredential;
  const authResponse = cred.response as AuthenticatorAssertionResponse;
  
  const authJson = {
    id: cred.id,
    type: cred.type,
    rawId: toBase64Url(new Uint8Array(cred.rawId)),
    response: {
      clientDataJSON: toBase64Url(new Uint8Array(authResponse.clientDataJSON)),
      authenticatorData: toBase64Url(new Uint8Array(authResponse.authenticatorData)),
      signature: toBase64Url(new Uint8Array(authResponse.signature)),
      userHandle: authResponse.userHandle ? toBase64Url(new Uint8Array(authResponse.userHandle)) : undefined,
    }
  };
  
  await invoke('finish_auth_and_init', { authRes: authJson });
}

function App() {
  const { activePage } = useUIStore();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');

  const isTauriRuntime =
    typeof window !== 'undefined' &&
    Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

  const isMobileRuntime =
    typeof navigator !== 'undefined' &&
    /android|iphone|ipad|ipod/i.test(navigator.userAgent);

  const isWindowsRuntime =
    typeof navigator !== 'undefined' &&
    /windows/i.test(navigator.userAgent);

  const authTriggered = useRef(false);

  useEffect(() => {
    if (!authTriggered.current) {
      authTriggered.current = true;
      runBiometricCheck();
    }
  }, []);

  const runBiometricCheck = async () => {
    try {
      setAuthError('');

      if (!isTauriRuntime || !isMobileRuntime) {
        if (isTauriRuntime && isWindowsRuntime) {
          await runWindowsHelloCheck();
          setIsAuthenticated(true);
          return;
        }

        // Browser and non-Windows desktop builds skip biometric lock.
        await invoke('initialize_db');
        setIsAuthenticated(true);
        return;
      }

      const status = await checkStatus();
      if (!status.isAvailable) {
        // Mobile without available biometrics should not block app access.
        await invoke('initialize_db');
        setIsAuthenticated(true);
        return;
      }

      await authenticate('Log in to Monet');
      await invoke('initialize_db');
      setIsAuthenticated(true);
      setAuthError('');
    } catch (err: any) {
      console.warn('Biometric Error:', err);
      const errMsg = err?.message || (typeof err === 'string' ? err : '');
      if (errMsg.includes('timed out') || errMsg.includes('not allowed')) {
         setAuthError('Authentication cancelled.');
      } else if (errMsg) {
         setAuthError(errMsg);
      } else {
         setAuthError('Authentication failed.');
      }
      setIsAuthenticated(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center bg-surface px-4">
        <div className="relative flex w-full max-w-sm flex-col items-center gap-6 p-8 text-center">
          <div>
            <img src={monetLogo} alt="Monet Logo" className="w-64 h-auto mx-auto object-contain drop-shadow-sm" />
          </div>
          <div className={`w-full max-w-[200px] transition-transform ${authError ? 'animate-[shake_0.4s_cubic-bezier(.36,.07,.19,.97)_both]' : ''}`}>
             <Button onClick={runBiometricCheck} className="w-full justify-center gap-2">
               <Smile size={18} />
               <span>Unlock</span>
             </Button>
          </div>
          {authError && <p className="text-sm text-expense mt-[-10px]">{authError}</p>}
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'accounts':
        return <AccountsPage />;
      case 'transactions':
        return <TransactionsPage />;
      case 'categories':
        return <CategoriesPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <Layout>
      {renderPage()}
    </Layout>
  );
}

export default App;
