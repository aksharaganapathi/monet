use std::num::NonZeroU32;
use std::sync::Mutex;

use base64::Engine;
use dotenvy::dotenv;
use ring::pbkdf2;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use url::Url;
use webauthn_rs::prelude::*;

mod auth;
mod db_cmds;
mod setup_cmds;

const AUTH_CONFIG_FILE: &str = "auth-config.json";
const LEGACY_DB_KEY_FILE: &str = "db.key";
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

pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub auth: Mutex<Option<Webauthn>>,
    pub auth_state: Mutex<Option<PasskeyAuthentication>>,
    pub reg_state: Mutex<Option<PasskeyRegistration>>,
    /// Consecutive failed password-unlock attempts (H-5 brute-force protection).
    pub failed_auth_attempts: Mutex<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub is_configured: bool,
    pub user_name: Option<String>,
    pub biometric_enabled: bool,
    pub can_use_biometric_unlock: bool,
    /// Whether the user has opted into the Groq AI summary feature (H-4).
    pub ai_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAuthConfig {
    version: u8,
    user_name: String,
    db_salt_b64: String,
    biometric_enabled: bool,
    biometric_key_blob_b64: Option<String>,
    /// SQLCipher key format: None / 1 = base64 text-passphrase (legacy),
    /// 2 = raw `x'<hex>'` bytes (H-3).
    #[serde(default)]
    key_version: Option<u8>,
    /// DPAPI protection level for the biometric blob: None / 1 = no entropy
    /// (legacy), 2 = app-specific entropy (H-2).
    #[serde(default)]
    biometric_key_version: Option<u8>,
    /// User has opted into Groq AI summaries (H-4).
    #[serde(default)]
    ai_enabled: Option<bool>,
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

fn legacy_key_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data_dir(app)?.join(LEGACY_DB_KEY_FILE))
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

/// Returns whether the user has opted into the Groq AI summary feature (H-4).
/// Accessible to sub-modules (e.g. `db_cmds`) without exposing `StoredAuthConfig`.
pub(crate) fn get_ai_enabled(app: &AppHandle) -> bool {
    load_auth_config(app)
        .ok()
        .flatten()
        .and_then(|c| c.ai_enabled)
        .unwrap_or(false)
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
fn derive_key_bytes(password: &str, salt: &[u8]) -> Result<Vec<u8>, String> {
    let iterations =
        NonZeroU32::new(PBKDF2_ITERATIONS).ok_or("Invalid password derivation iterations")?;
    let mut derived = vec![0u8; DERIVED_KEY_LEN];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        iterations,
        salt,
        password.as_bytes(),
        &mut derived,
    );
    Ok(derived)
}

/// Encode raw key bytes as lower-case hex (H-3 helper).
fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Format raw key bytes into a SQLCipher PRAGMA key argument.
/// - version 2: `x'<hex>'` — passed directly as raw bytes (correct, avoids
///   SQLCipher's internal re-KDF).
/// - version 1 (legacy): base64 text-passphrase (SQLCipher re-applies its
///   own KDF on this string — kept only for migration / opening old DBs).
fn format_key_pragma(key_bytes: &[u8], version: u8) -> String {
    if version >= 2 {
        format!("x'{}'", bytes_to_hex(key_bytes))
    } else {
        base64::engine::general_purpose::STANDARD.encode(key_bytes)
    }
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
    let key_version = config.key_version.unwrap_or(1);
    let pragma = format_key_pragma(&key_bytes, key_version);
    verify_password_key(app, &pragma)
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

fn create_fresh_salt() -> Result<[u8; SALT_LEN], String> {
    let mut salt = [0u8; SALT_LEN];
    getrandom::fill(&mut salt).map_err(|e| e.to_string())?;
    Ok(salt)
}

fn migrate_legacy_database_if_present(app: &AppHandle, new_key: &str) -> Result<Option<Connection>, String> {
    let legacy_path = legacy_key_path(app)?;
    if !legacy_path.exists() {
        return Ok(None);
    }

    let legacy_key = std::fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
    let conn = open_connection_with_key(app, legacy_key.trim())?;
    conn.pragma_update(None, "rekey", new_key)
        .map_err(|e| e.to_string())?;
    let _: i32 = conn
        .query_row("SELECT count(*) FROM sqlite_schema", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(legacy_path);
    Ok(Some(conn))
}

fn initialize_connection_with_key(
    app: &AppHandle,
    key: &str,
    allow_legacy_migration: bool,
) -> Result<Connection, String> {
    let conn = if allow_legacy_migration {
        match migrate_legacy_database_if_present(app, key)? {
            Some(conn) => conn,
            None => open_connection_with_key(app, key)?,
        }
    } else {
        open_connection_with_key(app, key)?
    };

    ensure_schema(&conn)?;
    Ok(conn)
}

/// Protect `secret` using DPAPI with `DPAPI_ENTROPY` so only this application
/// (running as the same user) can decrypt it (H-2).
#[cfg(windows)]
fn protect_secret(secret: &str) -> Result<String, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    use windows_sys::Win32::Foundation::LocalFree;

    let mut secret_bytes = secret.as_bytes().to_vec();
    let mut entropy_bytes = DPAPI_ENTROPY.to_vec();
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: secret_bytes.len() as u32,
        pbData: secret_bytes.as_mut_ptr(),
    };
    let mut entropy_blob = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &mut input,
            null(),
            &mut entropy_blob,
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

#[cfg(not(windows))]
fn protect_secret(_secret: &str) -> Result<String, String> {
    Err("Secure secret storage is currently only available on Windows.".to_string())
}

/// Decrypt a DPAPI blob that was created **without** application entropy.
#[cfg(windows)]
fn unprotect_secret_legacy(blob_b64: &str) -> Result<String, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    use windows_sys::Win32::Foundation::LocalFree;

    let mut blob = base64::engine::general_purpose::STANDARD
        .decode(blob_b64.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: blob.len() as u32,
        pbData: blob.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            null_mut(),
            null_mut(),
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

/// Decrypt a DPAPI blob that was created with `DPAPI_ENTROPY` (H-2).
#[cfg(windows)]
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
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: blob.len() as u32,
        pbData: blob.as_mut_ptr(),
    };
    let mut entropy_blob = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            null_mut(),
            &mut entropy_blob,
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

#[cfg(not(windows))]
fn unprotect_secret_legacy(_blob_b64: &str) -> Result<String, String> {
    Err("Secure secret storage is currently only available on Windows.".to_string())
}

#[cfg(not(windows))]
fn unprotect_secret(_blob_b64: &str) -> Result<String, String> {
    Err("Secure secret storage is currently only available on Windows.".to_string())
}

/// Decrypt a blob, trying the current (entropic) format first.
/// Falls back to the legacy (no-entropy) format for migration (H-2).
fn unprotect_secret_auto(blob_b64: &str, blob_version: u8) -> Result<String, String> {
    if blob_version >= 2 {
        unprotect_secret(blob_b64)
    } else {
        unprotect_secret_legacy(blob_b64)
    }
}

/// Protect the biometric DB-key pragma with app-specific DPAPI entropy (H-2).
fn protect_biometric_key(key: &str) -> Result<String, String> {
    protect_secret(key)
}

/// Decrypt a biometric blob, taking the stored version into account (H-2).
fn unprotect_biometric_key(blob_b64: &str, version: u8) -> Result<String, String> {
    unprotect_secret_auto(blob_b64, version)
}

pub(crate) fn load_passkey(app: &AppHandle) -> Result<Passkey, String> {
    let path = passkey_path(app)?;
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    if let Ok(stored) = serde_json::from_str::<StoredPasskeyFile>(&raw) {
        let decrypted = unprotect_secret_auto(&stored.protected_blob_b64, stored.version)?;
        // Lazily re-protect with current (entropic) format if the stored blob
        // used the legacy no-entropy format (H-2).
        if stored.version < 2 {
            let upgraded = StoredPasskeyFile {
                version: 2,
                protected_blob_b64: protect_secret(&decrypted)?,
            };
            let json = serde_json::to_string(&upgraded).map_err(|e| e.to_string())?;
            let _ = std::fs::write(&path, json);
        }
        return serde_json::from_str(&decrypted).map_err(|e| e.to_string());
    }

    let legacy_passkey: Passkey = serde_json::from_str(&raw).map_err(|e| e.to_string());
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

/// Unlock the database with the user's password.
/// Transparently migrates:
///   - SQLCipher key format v1 (base64 text passphrase) → v2 (raw `x'hex'`) (H-3)
///   - DPAPI biometric blob v1 (no entropy) → v2 (with entropy) (H-2)
pub(crate) fn unlock_with_password_internal(
    state: &State<AppState>,
    app: &AppHandle,
    password: &str,
) -> Result<StoredAuthConfig, String> {
    let mut config = require_auth_config(app)?;
    let salt = decode_config_salt(&config)?;
    let key_bytes = derive_key_bytes(password, &salt)?;
    let key_version = config.key_version.unwrap_or(1);
    let current_pragma = format_key_pragma(&key_bytes, key_version);

    // Opening the connection also validates the key (H-3).
    let conn = open_connection_with_key(app, &current_pragma)
        .map_err(|_| "E-AUTH-PASSWORD: Current password is incorrect.".to_string())?;

    let mut needs_save = false;

    // Migrate SQLCipher key format from v1 to v2 on successful unlock (H-3).
    if key_version < 2 {
        let v2_pragma = format_key_pragma(&key_bytes, 2);
        if conn.pragma_update(None, "rekey", &v2_pragma).is_ok() {
            config.key_version = Some(2);
            needs_save = true;

            // Also update the biometric blob to store the new pragma (H-3 + H-2).
            if config.biometric_key_blob_b64.is_some() {
                // Store the new v2 pragma under v2 DPAPI entropy.
                match protect_biometric_key(&v2_pragma) {
                    Ok(new_blob) => {
                        config.biometric_key_blob_b64 = Some(new_blob);
                        config.biometric_key_version = Some(2);
                    }
                    Err(_) => {} // leave biometric blob as-is; DB key is already migrated
                }
            }
        }
        // If rekey fails (e.g. read-only FS), open with old pragma — still works.
        let open_pragma = if config.key_version == Some(2) {
            format_key_pragma(&key_bytes, 2)
        } else {
            current_pragma
        };
        ensure_schema(&conn)?;
        // Re-open with new key so the connection in AppState uses the new encryption.
        drop(conn);
        let final_conn = open_connection_with_key(app, &open_pragma)
            .map_err(|e| format!("Failed to open database after key migration: {}", e))?;
        ensure_schema(&final_conn)?;
        set_open_connection(state, final_conn);
    } else {
        // Migrate DPAPI biometric blob entropy even if DB key is already v2 (H-2).
        let biometric_version = config.biometric_key_version.unwrap_or(1);
        if biometric_version < 2 {
            if let Some(old_blob) = &config.biometric_key_blob_b64.clone() {
                if let Ok(old_key) = unprotect_secret_legacy(old_blob) {
                    if let Ok(new_blob) = protect_biometric_key(&old_key) {
                        config.biometric_key_blob_b64 = Some(new_blob);
                        config.biometric_key_version = Some(2);
                        needs_save = true;
                    }
                }
            }
        }
        ensure_schema(&conn)?;
        set_open_connection(state, conn);
    }

    if needs_save {
        let _ = save_auth_config(app, &config); // best-effort; migrates again next unlock on failure
    }

    Ok(config)
}

/// Unlock the database with the biometric (Windows Hello / passkey) path.
/// Transparently migrates key format and DPAPI entropy (H-2, H-3).
pub(crate) fn unlock_with_biometric_internal(
    state: &State<AppState>,
    app: &AppHandle,
) -> Result<StoredAuthConfig, String> {
    let mut config = require_auth_config(app)?;
    let blob = config
        .biometric_key_blob_b64
        .clone()
        .ok_or("Biometric unlock is not configured.")?;
    let biometric_version = config.biometric_key_version.unwrap_or(1);
    let key_pragma = unprotect_biometric_key(&blob, biometric_version)?;

    // Open DB with whatever key format is stored in the blob.
    let conn = open_connection_with_key(app, &key_pragma)
        .map_err(|_| "Biometric unlock failed to open database.".to_string())?;

    let mut needs_save = false;
    let key_version = config.key_version.unwrap_or(1);

    // Migrate SQLCipher key from v1 (base64 passphrase) to v2 (raw hex) (H-3).
    if key_version < 2 {
        // v1 biometric blob stores base64(raw_bytes). Recover raw bytes to build v2 pragma.
        let raw_bytes = base64::engine::general_purpose::STANDARD
            .decode(key_pragma.as_bytes())
            .map_err(|e| format!("Failed to decode biometric key for migration: {}", e))?;
        let v2_pragma = format_key_pragma(&raw_bytes, 2);

        if conn.pragma_update(None, "rekey", &v2_pragma).is_ok() {
            config.key_version = Some(2);
            // Re-protect biometric blob with new pragma + entropy (H-2 + H-3).
            if let Ok(new_blob) = protect_biometric_key(&v2_pragma) {
                config.biometric_key_blob_b64 = Some(new_blob);
                config.biometric_key_version = Some(2);
            }
            needs_save = true;

            drop(conn);
            let final_conn = open_connection_with_key(app, &v2_pragma)
                .map_err(|e| format!("Failed to re-open database after key migration: {}", e))?;
            ensure_schema(&final_conn)?;
            set_open_connection(state, final_conn);
        } else {
            ensure_schema(&conn)?;
            set_open_connection(state, conn);
        }
    } else {
        // DB is v2; lazily migrate DPAPI entropy if blob was v1 (H-2).
        if biometric_version < 2 {
            if let Ok(new_blob) = protect_biometric_key(&key_pragma) {
                config.biometric_key_blob_b64 = Some(new_blob);
                config.biometric_key_version = Some(2);
                needs_save = true;
            }
        }
        ensure_schema(&conn)?;
        set_open_connection(state, conn);
    }

    if needs_save {
        let _ = save_auth_config(app, &config);
    }

    Ok(config)
}

pub fn get_setup_status_internal(app: &AppHandle) -> Result<SetupStatus, String> {
    if let Some(config) = load_auth_config(&app)? {
        return Ok(SetupStatus {
            is_configured: true,
            user_name: Some(config.user_name),
            biometric_enabled: config.biometric_enabled,
            can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
            ai_enabled: config.ai_enabled.unwrap_or(false),
        });
    }

    let has_legacy_key = legacy_key_path(&app)?.exists();
    Ok(SetupStatus {
        is_configured: has_legacy_key,
        user_name: None,
        biometric_enabled: false,
        can_use_biometric_unlock: false,
        ai_enabled: false,
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
    // Always create new vaults with v2 key format (x'hex') (H-3).
    let key_bytes = derive_key_bytes(&password, &salt)?;
    let key_pragma = format_key_pragma(&key_bytes, 2);

    let biometric_blob_b64 = if biometric_enabled {
        // Use entropy-protected DPAPI blob (H-2).
        Some(protect_biometric_key(&key_pragma)?)
    } else {
        None
    };

    let conn = initialize_connection_with_key(app, &key_pragma, true)?;
    ensure_schema(&conn)?;
    set_open_connection(state, conn);

    let config = StoredAuthConfig {
        version: 1,
        user_name: trimmed_name.to_string(),
        db_salt_b64: base64::engine::general_purpose::STANDARD.encode(salt),
        biometric_enabled,
        biometric_key_blob_b64: biometric_blob_b64.clone(),
        key_version: Some(2),
        biometric_key_version: if biometric_enabled { Some(2) } else { None },
        ai_enabled: Some(false),
    };

    save_auth_config(app, &config)?;

    Ok(SetupStatus {
        is_configured: true,
        user_name: Some(config.user_name),
        biometric_enabled: config.biometric_enabled,
        can_use_biometric_unlock: biometric_blob_b64.is_some(),
        ai_enabled: false,
    })
}

/// Entry point called from the Tauri command layer.
/// Enforces brute-force backoff before delegating to `unlock_with_password_internal` (H-5).
pub fn unlock_with_password_command(
    state: &State<AppState>,
    app: &AppHandle,
    password: String,
) -> Result<SetupStatus, String> {
    // --- Brute-force protection (H-5) ---
    let attempt = {
        let lock = state.failed_auth_attempts.lock().unwrap_or_else(|e| e.into_inner());
        *lock
    };

    if attempt >= MAX_FAILED_ATTEMPTS {
        return Err(format!(
            "E-AUTH-LOCKED: Too many failed attempts. Restart Monet to try again."
        ));
    }

    // Exponential backoff: 0 s, 1 s, 2 s, 4 s, 8 s, 16 s (max).
    if attempt > 0 {
        let delay_secs = 1u64 << attempt.min(4);
        std::thread::sleep(std::time::Duration::from_secs(delay_secs));
    }

    match unlock_with_password_internal(state, app, &password) {
        Ok(config) => {
            // Reset counter on success.
            *state.failed_auth_attempts.lock().unwrap_or_else(|e| e.into_inner()) = 0;
            Ok(SetupStatus {
                is_configured: true,
                user_name: Some(config.user_name),
                biometric_enabled: config.biometric_enabled,
                can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
                ai_enabled: config.ai_enabled.unwrap_or(false),
            })
        }
        Err(e) => {
            *state.failed_auth_attempts.lock().unwrap_or_else(|e| e.into_inner()) += 1;
            Err(e)
        }
    }
}

pub fn open_legacy_db(state: &State<AppState>, app: &AppHandle) -> Result<(), String> {
    let path = legacy_key_path(app)?;
    if !path.exists() {
        return Err("Database setup is required before opening Monet.".to_string());
    }

    let key = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let conn = initialize_connection_with_key(app, key.trim(), false)?;
    set_open_connection(state, conn);
    Ok(())
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
        ai_enabled: config.ai_enabled.unwrap_or(false),
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
    let current_version = config.key_version.unwrap_or(1);
    let current_pragma = format_key_pragma(&current_key_bytes, current_version);

    // Verify current password before making any changes.
    verify_password_key(app, &current_pragma)?;

    let new_salt = create_fresh_salt()?;
    let new_key_bytes = derive_key_bytes(&new_password, &new_salt)?;
    // Always rekey to v2 (raw hex) format (H-3).
    let new_pragma = format_key_pragma(&new_key_bytes, 2);

    if db_is_open(state) {
        let mut lock = state.db.lock().unwrap_or_else(|e| e.into_inner());
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        conn.pragma_update(None, "rekey", &new_pragma)
            .map_err(|e| e.to_string())?;
        // Note: PRAGMA key is intentionally omitted here (M-2 fix).
        // After rekey, the current connection already uses the new key.
        let _: i32 = conn
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| row.get(0))
            .map_err(|e| format!("Failed to verify database after password change: {}", e))?;
    } else {
        let conn = open_connection_with_key(app, &current_pragma)?;
        conn.pragma_update(None, "rekey", &new_pragma)
            .map_err(|e| e.to_string())?;
        set_open_connection(state, conn);
    }

    config.db_salt_b64 = base64::engine::general_purpose::STANDARD.encode(new_salt);
    config.key_version = Some(2);
    if config.biometric_enabled {
        // Re-protect biometric blob with new pragma + current DPAPI entropy (H-2 + H-3).
        config.biometric_key_blob_b64 = Some(protect_biometric_key(&new_pragma)?);
        config.biometric_key_version = Some(2);
    }
    save_auth_config(app, &config)?;

    Ok(SetupStatus {
        is_configured: true,
        user_name: Some(config.user_name),
        biometric_enabled: config.biometric_enabled,
        can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
        ai_enabled: config.ai_enabled.unwrap_or(false),
    })
}

pub(crate) fn set_biometric_enabled_internal(
    app: &AppHandle,
    password: String,
    enabled: bool,
) -> Result<SetupStatus, String> {
    let mut config = require_auth_config(app)?;
    let salt = decode_config_salt(&config)?;
    let key_bytes = derive_key_bytes(&password, &salt)?;
    let key_version = config.key_version.unwrap_or(1);
    let key_pragma = format_key_pragma(&key_bytes, key_version);
    verify_password_key(app, &key_pragma)?;

    if enabled {
        config.biometric_enabled = true;
        // Store the DB key pragma under entropy-protected DPAPI (H-2).
        config.biometric_key_blob_b64 = Some(protect_biometric_key(&key_pragma)?);
        config.biometric_key_version = Some(2);
    } else {
        config.biometric_enabled = false;
        config.biometric_key_blob_b64 = None;
        config.biometric_key_version = None;
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
        ai_enabled: config.ai_enabled.unwrap_or(false),
    })
}

/// Lock the database: drop the open connection so all subsequent DB commands fail
/// until the user unlocks again.  Called by the idle-lock timer (M-5).
pub(crate) fn lock_database_internal(state: &State<AppState>) {
    let mut lock = state.db.lock().unwrap_or_else(|e| e.into_inner());
    *lock = None;
}

/// Toggle the Groq AI summary opt-in (H-4).
pub(crate) fn set_ai_enabled_internal(
    app: &AppHandle,
    enabled: bool,
) -> Result<SetupStatus, String> {
    let mut config = require_auth_config(app)?;
    config.ai_enabled = Some(enabled);
    save_auth_config(app, &config)?;
    Ok(SetupStatus {
        is_configured: true,
        user_name: Some(config.user_name),
        biometric_enabled: config.biometric_enabled,
        can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
        ai_enabled: enabled,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenv();

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
            failed_auth_attempts: Mutex::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            auth::start_register,
            auth::finish_register,
            auth::start_auth,
            auth::finish_auth_and_init,
            setup_cmds::get_setup_status,
            setup_cmds::complete_onboarding,
            setup_cmds::unlock_with_password,
            setup_cmds::update_user_name,
            setup_cmds::change_password,
            setup_cmds::set_biometric_enabled,
            setup_cmds::verify_password,
            setup_cmds::reset_biometric_registration,
            setup_cmds::lock_database,
            setup_cmds::set_ai_enabled,
            db_cmds::initialize_db,
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
            db_cmds::get_daily_balance_changes
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_biometric::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
