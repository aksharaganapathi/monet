use std::num::NonZeroU32;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use ring::pbkdf2;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;
use url::Url;
use webauthn_rs::prelude::*;

mod auth;
mod db_cmds;
mod setup_cmds;
mod google_oauth;

const AUTH_CONFIG_FILE: &str = "auth-config.json";
const PASSKEY_FILE: &str = "passkey.json";
const PBKDF2_ITERATIONS: u32 = 600_000;
const DERIVED_KEY_LEN: usize = 32;
const SALT_LEN: usize = 32;
/// Per-application entropy for DPAPI blobs (H-2).  Changing this invalidates all
/// existing blobs, so it must remain stable for the lifetime of the application.
#[cfg(windows)]
const DPAPI_ENTROPY: &[u8] = b"monet-com.monet.finance-dpapi-v1";
/// Minimum acceptable password length for *new* passwords (M-1).
const MIN_PASSWORD_LEN: usize = 12;
/// Maximum consecutive failed unlock attempts before a hard lockout (H-5).
const MAX_FAILED_ATTEMPTS: u32 = 10;
/// Exponent cap for the exponential back-off delay: max delay = 2^MAX_BACKOFF_POWER seconds (H-5).
const MAX_BACKOFF_POWER: u32 = 4; // 2^4 = 16 seconds
/// How long a successful password verification is considered valid for
/// sensitive follow-up actions like passkey enrollment.
const PASSWORD_REVERIFY_WINDOW_SECS: u64 = 120;

pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub auth: Mutex<Option<Webauthn>>,
    pub auth_state: Mutex<Option<PasskeyAuthentication>>,
    pub reg_state: Mutex<Option<PasskeyRegistration>>,
    /// Epoch-seconds timestamp of the most recent successful sensitive
    /// verification, used to gate sensitive settings changes.
    pub last_sensitive_verify_epoch_secs: std::sync::atomic::AtomicU64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub is_configured: bool,
    pub user_name: Option<String>,
    pub biometric_enabled: bool,
    pub can_use_biometric_unlock: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAuthConfig {
    version: u8,
    user_name: String,
    db_salt_b64: String,
    biometric_enabled: bool,
    biometric_key_blob_b64: Option<String>,
    #[serde(default)]
    failed_auth_attempts: Option<u32>,
    #[serde(default)]
    lockout_until_epoch_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPasskeyFile {
    version: u8,
    protected_blob_b64: String,
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn auth_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join(AUTH_CONFIG_FILE))
}

pub(crate) fn passkey_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join(PASSKEY_FILE))
}

fn db_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join("monet.db"))
}

fn load_auth_config(app: &AppHandle) -> Result<Option<StoredAuthConfig>, String> {
    let path = auth_config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let config = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(Some(config))
}


fn save_auth_config(app: &AppHandle, config: &StoredAuthConfig) -> Result<(), String> {
    let path = auth_config_path(app)?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn require_auth_config(app: &AppHandle) -> Result<StoredAuthConfig, String> {
    load_auth_config(app)?.ok_or("Monet has not been set up yet.".to_string())
}

fn decode_config_salt(config: &StoredAuthConfig) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(config.db_salt_b64.as_bytes())
        .map_err(|e| e.to_string())
}

/// Validate that a *new* password meets the minimum length requirement (M-1).
fn validate_new_password(password: &str) -> Result<(), String> {
    if password.len() < MIN_PASSWORD_LEN {
        return Err(format!(
            "Password must be at least {} characters.",
            MIN_PASSWORD_LEN
        ));
    }
    Ok(())
}

/// Core PBKDF2 derivation — returns raw key bytes.  No length validation here
/// so that verification of *existing* passwords (which may have been set before
/// the current minimum) continues to work (H-5, M-1).
fn derive_key_bytes(password: &str, salt: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    let iterations =
        NonZeroU32::new(PBKDF2_ITERATIONS).ok_or("Invalid password derivation iterations")?;
    let mut derived = Zeroizing::new(vec![0u8; DERIVED_KEY_LEN]);
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        iterations,
        salt,
        password.as_bytes(),
        derived.as_mut_slice(),
    );
    Ok(derived)
}

/// Encode raw key bytes as lower-case hex (H-3 helper).
fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Format raw key bytes into a SQLCipher PRAGMA key argument using the raw
/// `x'<hex>'` format to avoid internal re-KDF (H-3).
fn format_key_pragma(key_bytes: &[u8]) -> Zeroizing<String> {
    Zeroizing::new(format!("x'{}'", bytes_to_hex(key_bytes)))
}

fn open_connection_with_key(app: &AppHandle, key: &str) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "key", key)
        .map_err(|e| e.to_string())?;
    let _: i32 = conn
        .query_row("SELECT count(*) FROM sqlite_schema", [], |row| row.get(0))
        .map_err(|e| format!("Invalid password or corrupted DB: {}", e))?;
    Ok(conn)
}

fn verify_password_key(app: &AppHandle, key: &str) -> Result<(), String> {
    let conn = open_connection_with_key(app, key).map_err(|_| "E-AUTH-PASSWORD: Current password is incorrect.".to_string())?;
    drop(conn);
    Ok(())
}

pub(crate) fn verify_password_internal(app: &AppHandle, password: &str) -> Result<(), String> {
    let config = require_auth_config(app)?;
    let salt = decode_config_salt(&config)?;
    let key_bytes = derive_key_bytes(password, &salt)?;
    let pragma = format_key_pragma(&key_bytes);
    verify_password_key(app, &pragma)
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn mark_recent_password_verification(state: &State<AppState>) {
    state
    .last_sensitive_verify_epoch_secs
        .store(now_epoch_secs(), Ordering::SeqCst);
}

fn has_recent_password_verification(state: &State<AppState>) -> bool {
    let last = state
        .last_sensitive_verify_epoch_secs
        .load(Ordering::SeqCst);
    if last == 0 {
        return false;
    }

    let now = now_epoch_secs();
    now.saturating_sub(last) <= PASSWORD_REVERIFY_WINDOW_SECS
}

pub(crate) fn ensure_recent_password_verification_for_passkey_enrollment(
    state: &State<AppState>,
    app: &AppHandle,
) -> Result<(), String> {
    // During first-run onboarding there is no configured password yet.
    if load_auth_config(app)?.is_none() {
        return Ok(());
    }

    if has_recent_password_verification(state) {
        return Ok(());
    }

    Err("E-AUTH-REVERIFY: Please verify your password before enrolling biometrics.".to_string())
}

fn run_with_password_attempt_guard<T, F>(state: &State<AppState>, app: &AppHandle, op: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let mut config = match load_auth_config(app)? {
        Some(c) => c,
        None => return match op() {
            Ok(value) => {
                mark_recent_password_verification(state);
                Ok(value)
            }
            Err(e) => Err(e),
        },
    };

    let now = now_epoch_secs();
    if let Some(lockout_until) = config.lockout_until_epoch_secs {
        if now < lockout_until {
            let wait_time = lockout_until - now;
            return Err(format!("E-AUTH-LOCKED: Too many failed attempts. Try again in {} seconds.", wait_time));
        }
    }

    let mut slot = config.failed_auth_attempts.unwrap_or(0);
    if slot >= MAX_FAILED_ATTEMPTS {
        return Err("E-AUTH-LOCKED: Too many failed attempts. The vault is securely locked.".to_string());
    }

    match op() {
        Ok(value) => {
            if slot > 0 || config.lockout_until_epoch_secs.is_some() {
                config.failed_auth_attempts = Some(0);
                config.lockout_until_epoch_secs = None;
                let _ = save_auth_config(app, &config);
            }
            mark_recent_password_verification(state);
            Ok(value)
        }
        Err(e) => {
            slot += 1;
            config.failed_auth_attempts = Some(slot);
            
            if slot >= MAX_FAILED_ATTEMPTS {
                config.lockout_until_epoch_secs = Some(now + (3600 * 24 * 365 * 10)); // Permanent lock
            } else {
                let backoff_power = (slot - 1).min(MAX_BACKOFF_POWER);
                let delay_secs = 1u64 << backoff_power;
                config.lockout_until_epoch_secs = Some(now + delay_secs);
            }
            
            let _ = save_auth_config(app, &config);
            Err(e)
        }
    }
}

pub(crate) fn verify_password_command(
    state: &State<AppState>,
    app: &AppHandle,
    password: String,
) -> Result<(), String> {
    run_with_password_attempt_guard(state, app, || verify_password_internal(app, &password))
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            balance REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            icon TEXT,
            is_custom INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            amount REAL NOT NULL,
            category_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL,
            date DATE NOT NULL,
            note TEXT,
            merchant TEXT,
            external_id TEXT,
            flagged INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories (id),
            FOREIGN KEY (account_id) REFERENCES accounts (id)
        );
        CREATE TABLE IF NOT EXISTS budgets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER REFERENCES categories(id) UNIQUE,
            amount REAL NOT NULL,
            period TEXT NOT NULL DEFAULT 'monthly',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS balance_snapshots (
            snapshot_date TEXT PRIMARY KEY,
            total_balance REAL NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS ai_summaries (
            period_key TEXT PRIMARY KEY,
            summary TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sync_imports (
            external_id TEXT PRIMARY KEY,
            imported_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Triggers for automatic balance management
        CREATE TRIGGER IF NOT EXISTS update_balance_on_insert
        AFTER INSERT ON transactions
        BEGIN
            UPDATE accounts SET balance = balance + NEW.amount, updated_at = datetime('now') WHERE id = NEW.account_id;
        END;

        CREATE TRIGGER IF NOT EXISTS update_balance_on_delete
        AFTER DELETE ON transactions
        BEGIN
            UPDATE accounts SET balance = balance - OLD.amount, updated_at = datetime('now') WHERE id = OLD.account_id;
        END;

        CREATE TRIGGER IF NOT EXISTS update_balance_on_update
        AFTER UPDATE OF amount, account_id ON transactions
        BEGIN
            UPDATE accounts SET balance = balance - OLD.amount, updated_at = datetime('now') WHERE id = OLD.account_id;
            UPDATE accounts SET balance = balance + NEW.amount, updated_at = datetime('now') WHERE id = NEW.account_id;
        END;
    ",
    )
    .map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "ALTER TABLE accounts ADD COLUMN institution TEXT DEFAULT 'other'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE transactions ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE transactions ADD COLUMN merchant TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE transactions ADD COLUMN external_id TEXT",
        [],
    );
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external_id ON transactions(external_id) WHERE external_id IS NOT NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
    let _ = conn.execute(
        "ALTER TABLE budgets ADD COLUMN amount REAL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE budgets ADD COLUMN period TEXT DEFAULT 'monthly'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE budgets ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE budgets ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))",
        [],
    );
    let _ = conn.execute(
        "UPDATE budgets SET amount = monthly_limit WHERE amount IS NULL",
        [],
    );
    let _ = conn.execute(
        "UPDATE budgets SET period = COALESCE(period, 'monthly'), created_at = COALESCE(created_at, datetime('now')), updated_at = COALESCE(updated_at, datetime('now'))",
        [],
    );

    let default_categories = [
        ("Groceries", "shopping-basket"),
        ("Dining", "utensils-crossed"),
        ("Rent", "house"),
        ("Utilities", "lightbulb"),
        ("Transport", "car"),
        ("Healthcare", "heart-pulse"),
        ("Entertainment", "film"),
        ("Shopping", "shopping-bag"),
        ("Travel", "plane"),
        ("Income", "banknote-arrow-up"),
        ("Transfers", "arrow-left-right"),
        ("Savings", "piggy-bank"),
        ("Salary", "briefcase-business"),
        ("Freelance", "badge-dollar-sign"),
        ("Investment", "chart-line"),
        ("Other", "shapes"),
    ];

    for (name, icon) in default_categories {
        conn.execute(
            "
            INSERT INTO categories (name, icon, is_custom)
            SELECT ?1, ?2, 0
            WHERE NOT EXISTS (
              SELECT 1 FROM categories WHERE name = ?1 AND is_custom = 0
            )
            ",
            params![name, icon],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "
        INSERT INTO balance_snapshots (snapshot_date, total_balance, updated_at)
        VALUES (
            date('now'),
            (SELECT COALESCE(SUM(balance), 0) FROM accounts),
            datetime('now')
        )
        ON CONFLICT(snapshot_date) DO UPDATE SET
            total_balance = excluded.total_balance,
            updated_at = datetime('now')
        ",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn set_open_connection(state: &State<AppState>, conn: Connection) {
    let mut lock = state.db.lock().unwrap();
    *lock = Some(conn);
}

fn db_is_open(state: &State<AppState>) -> bool {
    state.db.lock().unwrap().is_some()
}

fn bootstrap_sync_after_unlock(_state: &State<AppState>, _app: &AppHandle) {
    // Automatic sync bootstrap is intentionally disabled in this build.
}

fn create_fresh_salt() -> Result<[u8; SALT_LEN], String> {
    let mut salt = [0u8; SALT_LEN];
    getrandom::fill(&mut salt).map_err(|e| e.to_string())?;
    Ok(salt)
}

fn initialize_connection_with_key(
    app: &AppHandle,
    key: &str,
) -> Result<Connection, String> {
    let conn = open_connection_with_key(app, key)?;
    ensure_schema(&conn)?;
    Ok(conn)
}

/// Protect `secret` using DPAPI with `DPAPI_ENTROPY` so only this application
/// (running as the same user) can decrypt it (H-2).
fn protect_secret(secret: &str) -> Result<String, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    use windows_sys::Win32::Foundation::LocalFree;

    let mut secret_bytes = secret.as_bytes().to_vec();
    let mut entropy_bytes = DPAPI_ENTROPY.to_vec();
    let input = CRYPT_INTEGER_BLOB {
        cbData: secret_bytes.len() as u32,
        pbData: secret_bytes.as_mut_ptr(),
    };
    let entropy_blob = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &input,
            null(),
            &entropy_blob,
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };

    if ok == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }

    let encoded = unsafe {
        let protected = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let value = base64::engine::general_purpose::STANDARD.encode(protected);
        LocalFree(output.pbData as *mut core::ffi::c_void);
        value
    };

    Ok(encoded)
}

/// Decrypt a DPAPI blob that was created with `DPAPI_ENTROPY` (H-2).
fn unprotect_secret(blob_b64: &str) -> Result<String, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    use windows_sys::Win32::Foundation::LocalFree;

    let mut blob = base64::engine::general_purpose::STANDARD
        .decode(blob_b64.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut entropy_bytes = DPAPI_ENTROPY.to_vec();
    let input = CRYPT_INTEGER_BLOB {
        cbData: blob.len() as u32,
        pbData: blob.as_mut_ptr(),
    };
    let entropy_blob = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &input,
            null_mut(),
            &entropy_blob,
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };

    if ok == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }

    let secret = unsafe {
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as *mut core::ffi::c_void);
        String::from_utf8(bytes).map_err(|e| e.to_string())?
    };

    Ok(secret)
}

/// Decrypt a biometric blob (H-2).
fn unprotect_biometric_key(blob_b64: &str) -> Result<String, String> {
    unprotect_secret(blob_b64)
}

pub(crate) fn load_passkey(app: &AppHandle) -> Result<Passkey, String> {
    let path = passkey_path(app)?;
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    if let Ok(stored) = serde_json::from_str::<StoredPasskeyFile>(&raw) {
        let decrypted = unprotect_secret(&stored.protected_blob_b64)?;
        return serde_json::from_str(&decrypted).map_err(|e| e.to_string());
    }

    let legacy_passkey: Passkey = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    save_passkey(app, &legacy_passkey)?;
    Ok(legacy_passkey)
}

pub(crate) fn save_passkey(app: &AppHandle, passkey: &Passkey) -> Result<(), String> {
    let path = passkey_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let passkey_json = serde_json::to_string(passkey).map_err(|e| e.to_string())?;
    let protected = StoredPasskeyFile {
        version: 2, // entropy-protected (H-2)
        protected_blob_b64: protect_secret(&passkey_json)?,
    };
    let json = serde_json::to_string(&protected).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

pub(crate) fn unlock_with_password_internal(
    state: &State<AppState>,
    app: &AppHandle,
    password: &str,
) -> Result<StoredAuthConfig, String> {
    let config = require_auth_config(app)?;
    let salt = decode_config_salt(&config)?;
    let key_bytes = derive_key_bytes(password, &salt)?;
    let pragma = format_key_pragma(&key_bytes);

    // Opening the connection also validates the key (H-3).
    let conn = open_connection_with_key(app, &pragma)
        .map_err(|_| "E-AUTH-PASSWORD: Current password is incorrect.".to_string())?;

    ensure_schema(&conn)?;
    set_open_connection(state, conn);

    Ok(config)
}

pub(crate) fn unlock_with_biometric_internal(
    state: &State<AppState>,
    app: &AppHandle,
) -> Result<StoredAuthConfig, String> {
    let config = require_auth_config(app)?;
    let blob = config
        .biometric_key_blob_b64
        .clone()
        .ok_or("Biometric unlock is not configured.")?;
    let key_pragma = unprotect_biometric_key(&blob)?;

    // Open DB with raw hex key format (H-3).
    let conn = open_connection_with_key(app, &key_pragma)
        .map_err(|_| "Biometric unlock failed to open database.".to_string())?;

    ensure_schema(&conn)?;
    set_open_connection(state, conn);
    bootstrap_sync_after_unlock(state, app);

    Ok(config)
}

pub fn get_setup_status_internal(app: &AppHandle) -> Result<SetupStatus, String> {
    if let Some(config) = load_auth_config(app)? {
        return Ok(SetupStatus {
            is_configured: true,
            user_name: Some(config.user_name),
            biometric_enabled: config.biometric_enabled,
            can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
        });
    }

    Ok(SetupStatus {
        is_configured: false,
        user_name: None,
        biometric_enabled: false,
        can_use_biometric_unlock: false,
    })
}

pub fn complete_onboarding_internal(
    state: &State<AppState>,
    app: &AppHandle,
    name: String,
    password: String,
    biometric_enabled: bool,
) -> Result<SetupStatus, String> {
    if load_auth_config(app)?.is_some() {
        return Err("Monet is already set up.".to_string());
    }

    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Please enter your name.".to_string());
    }

    // Enforce minimum password length for new vaults (M-1).
    validate_new_password(&password)?;

    let salt = create_fresh_salt()?;
    let key_bytes = derive_key_bytes(&password, &salt)?;
    let key_pragma = format_key_pragma(&key_bytes);

    let biometric_blob_b64 = if biometric_enabled {
        // Use entropy-protected DPAPI blob (H-2).
        Some(protect_secret(&key_pragma)?)
    } else {
        None
    };

    let conn = initialize_connection_with_key(app, &key_pragma)?;
    ensure_schema(&conn)?;
    set_open_connection(state, conn);

    let config = StoredAuthConfig {
        version: 1,
        user_name: trimmed_name.to_string(),
        db_salt_b64: base64::engine::general_purpose::STANDARD.encode(salt.as_ref()),
        biometric_enabled,
        biometric_key_blob_b64: biometric_blob_b64.clone(),
        failed_auth_attempts: Some(0),
        lockout_until_epoch_secs: None,
    };

    save_auth_config(app, &config)?;
    bootstrap_sync_after_unlock(state, app);

    Ok(SetupStatus {
        is_configured: true,
        user_name: Some(config.user_name),
        biometric_enabled: config.biometric_enabled,
        can_use_biometric_unlock: biometric_blob_b64.is_some(),
    })
}

/// Entry point called from the Tauri command layer.
/// Enforces brute-force backoff before delegating to `unlock_with_password_internal` (H-5).
pub fn unlock_with_password_command(
    state: &State<AppState>,
    app: &AppHandle,
    password: String,
) -> Result<SetupStatus, String> {
    match run_with_password_attempt_guard(state, app, || {
        unlock_with_password_internal(state, app, &password)
    }) {
        Ok(config) => {
            let status = SetupStatus {
                is_configured: true,
                user_name: Some(config.user_name),
                biometric_enabled: config.biometric_enabled,
                can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
            };
            bootstrap_sync_after_unlock(state, app);
            Ok(status)
        }
        Err(e) => Err(e),
    }
}

pub(crate) fn update_user_name_internal(
    app: &AppHandle,
    name: String,
) -> Result<SetupStatus, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Please enter your name.".to_string());
    }

    let mut config = require_auth_config(app)?;
    config.user_name = trimmed_name.to_string();
    save_auth_config(app, &config)?;

    Ok(SetupStatus {
        is_configured: true,
        user_name: Some(config.user_name),
        biometric_enabled: config.biometric_enabled,
        can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
    })
}

pub(crate) fn change_password_internal(
    state: &State<AppState>,
    app: &AppHandle,
    current_password: String,
    new_password: String,
) -> Result<SetupStatus, String> {
    // Enforce minimum password length for the *new* password (M-1).
    validate_new_password(&new_password)?;

    let mut config = require_auth_config(app)?;
    let current_salt = decode_config_salt(&config)?;
    let current_key_bytes = derive_key_bytes(&current_password, &current_salt)?;
    let current_pragma = format_key_pragma(&current_key_bytes);

    // Verify current password before making any changes.
    run_with_password_attempt_guard(state, app, || verify_password_key(app, &current_pragma))?;

    let new_salt = create_fresh_salt()?;
    let new_key_bytes = derive_key_bytes(&new_password, &new_salt)?;
    // Always rekey to raw hex format (H-3).
    let new_pragma = format_key_pragma(&new_key_bytes);

    if db_is_open(state) {
        let mut lock = state.db.lock().unwrap_or_else(|e| e.into_inner());
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        conn.pragma_update(None, "rekey", new_pragma.as_str())
            .map_err(|e| e.to_string())?;
        // Note: PRAGMA key is intentionally omitted here (M-2 fix).
        // After rekey, the current connection already uses the new key.
        let _: i32 = conn
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| row.get(0))
            .map_err(|e| format!("Failed to verify database after password change: {}", e))?;
    } else {
        let conn = open_connection_with_key(app, &current_pragma)?;
        conn.pragma_update(None, "rekey", new_pragma.as_str())
            .map_err(|e| e.to_string())?;
        set_open_connection(state, conn);
    }

    config.db_salt_b64 = base64::engine::general_purpose::STANDARD.encode(new_salt.as_ref());
    if config.biometric_enabled {
        // Re-protect biometric blob with new pragma + current DPAPI entropy (H-2 + H-3).
        config.biometric_key_blob_b64 = Some(protect_secret(new_pragma.as_str())?);
    }
    save_auth_config(app, &config)?;

    Ok(SetupStatus {
        is_configured: true,
        user_name: Some(config.user_name),
        biometric_enabled: config.biometric_enabled,
        can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
    })
}

pub(crate) fn set_biometric_enabled_internal(
    state: &State<AppState>,
    app: &AppHandle,
    password: String,
    enabled: bool,
) -> Result<SetupStatus, String> {
    let mut config = require_auth_config(app)?;
    let salt = decode_config_salt(&config)?;
    let key_bytes = derive_key_bytes(&password, &salt)?;
    let key_pragma = format_key_pragma(&key_bytes);
    run_with_password_attempt_guard(state, app, || verify_password_key(app, &key_pragma))?;

    if enabled {
        config.biometric_enabled = true;
        // Store the DB key pragma under entropy-protected DPAPI (H-2).
        config.biometric_key_blob_b64 = Some(protect_secret(&key_pragma)?);
    } else {
        config.biometric_enabled = false;
        config.biometric_key_blob_b64 = None;
        let path = passkey_path(app)?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }

    save_auth_config(app, &config)?;

    Ok(SetupStatus {
        is_configured: true,
        user_name: Some(config.user_name),
        biometric_enabled: config.biometric_enabled,
        can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
    })
}

/// Lock the database: drop the open connection so all subsequent DB commands fail
/// until the user unlocks again.  Called by the idle-lock timer (M-5).
pub(crate) fn lock_database_internal(state: &State<AppState>) {
    let mut lock = state.db.lock().unwrap_or_else(|e| e.into_inner());
    *lock = None;
    state
        .last_sensitive_verify_epoch_secs
        .store(0, Ordering::SeqCst);
}


pub fn run() {
    #[cfg(debug_assertions)]
    let _ = dotenvy::dotenv();

    // In release builds the RP ID and origin are hardcoded so they cannot be
    // overridden by a planted .env file or environment variable (M-4).
    #[cfg(not(debug_assertions))]
    let (rp_id, rp_origin) = (
        "localhost".to_string(),
        Url::parse("http://localhost:1420").unwrap(),
    );
    #[cfg(debug_assertions)]
    let (rp_id, rp_origin) = (
        std::env::var("MONET_RP_ID").unwrap_or_else(|_| "localhost".to_string()),
        Url::parse(
            &std::env::var("MONET_RP_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:1420".to_string()),
        )
        .unwrap(),
    );

    let builder = WebauthnBuilder::new(&rp_id, &rp_origin)
        .unwrap()
        .rp_name("Monet");
    let webauthn = builder.build().unwrap();

    let builder = tauri::Builder::default()
        .setup(|_app| Ok(()))
        .manage(AppState {
            db: Mutex::new(None),
            auth: Mutex::new(Some(webauthn)),
            auth_state: Mutex::new(None),
            reg_state: Mutex::new(None),
            last_sensitive_verify_epoch_secs: std::sync::atomic::AtomicU64::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            auth::start_register,
            auth::finish_register,
            auth::start_auth,
            auth::finish_auth_and_init,
            setup_cmds::get_setup_status,
            setup_cmds::complete_setup,
            setup_cmds::unlock_vault,
            setup_cmds::update_user_name,
            setup_cmds::change_vault_secret,
            setup_cmds::set_biometric_enabled,
            setup_cmds::verify_unlock_secret,
            setup_cmds::reset_biometric_registration,
            setup_cmds::lock_database,
            db_cmds::get_accounts,
            db_cmds::get_account_by_id,
            db_cmds::create_account,
            db_cmds::update_account,
            db_cmds::update_account_balance,
            db_cmds::set_account_balance,
            db_cmds::delete_account,
            db_cmds::get_total_balance,
            db_cmds::get_categories,
            db_cmds::create_category,
            db_cmds::delete_category,
            db_cmds::get_category_transaction_count,
            db_cmds::get_transactions,
            db_cmds::get_transactions_by_account,
            db_cmds::get_transactions_by_date,
            db_cmds::get_monthly_spending,
            db_cmds::get_monthly_total_spent,
            db_cmds::set_transaction_flagged,
            db_cmds::create_transaction,
            db_cmds::update_transaction,
            db_cmds::delete_transaction,
            db_cmds::get_transaction_by_id,
            db_cmds::get_budgets,
            db_cmds::upsert_budget,
            db_cmds::delete_budget,
            db_cmds::get_budget_progress,
            db_cmds::summarize_month_story,
            db_cmds::get_balance_snapshots,
            db_cmds::get_daily_balance_changes,
            db_cmds::get_setting,
            db_cmds::put_setting,
            db_cmds::delete_setting,
            db_cmds::get_all_settings,
            db_cmds::import_sync_queue,
            db_cmds::connect_google_account
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
