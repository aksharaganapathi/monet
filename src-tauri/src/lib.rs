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

pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub auth: Mutex<Option<Webauthn>>,
    pub auth_state: Mutex<Option<PasskeyAuthentication>>,
    pub reg_state: Mutex<Option<PasskeyRegistration>>,
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

fn derive_db_key(password: &str, salt: &[u8]) -> Result<String, String> {
    if password.trim().len() < 4 {
        return Err("Password must be at least 4 characters.".to_string());
    }

    let iterations =
        NonZeroU32::new(PBKDF2_ITERATIONS).ok_or("Invalid password derivation iterations")?;
    let mut derived = [0u8; DERIVED_KEY_LEN];

    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        iterations,
        salt,
        password.as_bytes(),
        &mut derived,
    );

    Ok(base64::engine::general_purpose::STANDARD.encode(derived))
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
    let key = derive_db_key(password, &salt)?;
    verify_password_key(app, &key)
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories (id),
            FOREIGN KEY (account_id) REFERENCES accounts (id)
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

fn create_fresh_salt() -> Result<[u8; 16], String> {
    let mut salt = [0u8; 16];
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

#[cfg(windows)]
fn protect_secret(secret: &str) -> Result<String, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    use windows_sys::Win32::Foundation::LocalFree;

    let mut secret_bytes = secret.as_bytes().to_vec();
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: secret_bytes.len() as u32,
        pbData: secret_bytes.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &mut input,
            null(),
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

#[cfg(not(windows))]
fn unprotect_secret(_blob_b64: &str) -> Result<String, String> {
    Err("Secure secret storage is currently only available on Windows.".to_string())
}

fn protect_biometric_key(key: &str) -> Result<String, String> {
    protect_secret(key)
}

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
        version: 1,
        protected_blob_b64: protect_secret(&passkey_json)?,
    };
    let json = serde_json::to_string(&protected).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn unlock_with_key(state: &State<AppState>, app: &AppHandle, key: &str) -> Result<(), String> {
    let conn = initialize_connection_with_key(app, key, false)?;
    set_open_connection(state, conn);
    Ok(())
}

pub(crate) fn unlock_with_password_internal(
    state: &State<AppState>,
    app: &AppHandle,
    password: &str,
) -> Result<StoredAuthConfig, String> {
    let config = require_auth_config(app)?;
    let salt = decode_config_salt(&config)?;
    let key = derive_db_key(password, &salt)?;
    verify_password_key(app, &key)?;
    unlock_with_key(state, app, &key)?;
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
    let key = unprotect_biometric_key(&blob)?;
    unlock_with_key(state, app, &key)?;
    Ok(config)
}

pub fn get_setup_status_internal(app: &AppHandle) -> Result<SetupStatus, String> {
    if let Some(config) = load_auth_config(&app)? {
        return Ok(SetupStatus {
            is_configured: true,
            user_name: Some(config.user_name),
            biometric_enabled: config.biometric_enabled,
            can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
        });
    }

    let has_legacy_key = legacy_key_path(&app)?.exists();
    Ok(SetupStatus {
        is_configured: has_legacy_key,
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

    let salt = create_fresh_salt()?;
    let key = derive_db_key(&password, &salt)?;
    let biometric_blob_b64 = if biometric_enabled {
        Some(protect_biometric_key(&key)?)
    } else {
        None
    };

    let conn = initialize_connection_with_key(app, &key, true)?;
    ensure_schema(&conn)?;
    set_open_connection(state, conn);

    let config = StoredAuthConfig {
        version: 1,
        user_name: trimmed_name.to_string(),
        db_salt_b64: base64::engine::general_purpose::STANDARD.encode(salt),
        biometric_enabled,
        biometric_key_blob_b64: biometric_blob_b64.clone(),
    };

    save_auth_config(app, &config)?;

    Ok(SetupStatus {
        is_configured: true,
        user_name: Some(config.user_name),
        biometric_enabled: config.biometric_enabled,
        can_use_biometric_unlock: biometric_blob_b64.is_some(),
    })
}

pub fn unlock_with_password_command(
    state: &State<AppState>,
    app: &AppHandle,
    password: String,
) -> Result<SetupStatus, String> {
    let config = unlock_with_password_internal(state, app, &password)?;
    Ok(SetupStatus {
        is_configured: true,
        user_name: Some(config.user_name),
        biometric_enabled: config.biometric_enabled,
        can_use_biometric_unlock: config.biometric_key_blob_b64.is_some(),
    })
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
    })
}

pub(crate) fn change_password_internal(
    state: &State<AppState>,
    app: &AppHandle,
    current_password: String,
    new_password: String,
) -> Result<SetupStatus, String> {
    let mut config = require_auth_config(app)?;
    let current_salt = decode_config_salt(&config)?;
    let current_key = derive_db_key(&current_password, &current_salt)?;
    verify_password_key(app, &current_key)?;
    let new_salt = create_fresh_salt()?;
    let new_key = derive_db_key(&new_password, &new_salt)?;

    let conn = if db_is_open(state) {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        conn.pragma_update(None, "rekey", &new_key)
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "key", &new_key)
            .map_err(|e| e.to_string())?;
        let _: i32 = conn
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| row.get(0))
            .map_err(|e| format!("Failed to verify database after password change: {}", e))?;
        None
    } else {
        let conn = open_connection_with_key(app, &current_key)?;
        conn.pragma_update(None, "rekey", &new_key)
            .map_err(|e| e.to_string())?;
        Some(conn)
    };

    if let Some(conn) = conn {
        set_open_connection(state, conn);
    }

    config.db_salt_b64 = base64::engine::general_purpose::STANDARD.encode(new_salt);
    if config.biometric_enabled {
        config.biometric_key_blob_b64 = Some(protect_biometric_key(&new_key)?);
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
    app: &AppHandle,
    password: String,
    enabled: bool,
) -> Result<SetupStatus, String> {
    let mut config = require_auth_config(app)?;
    let salt = decode_config_salt(&config)?;
    let key = derive_db_key(&password, &salt)?;
    verify_password_key(app, &key)?;

    if enabled {
        config.biometric_enabled = true;
        config.biometric_key_blob_b64 = Some(protect_biometric_key(&key)?);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenv();

    let rp_id = std::env::var("MONET_RP_ID").unwrap_or_else(|_| "localhost".to_string());
    let rp_origin = Url::parse(
        &std::env::var("MONET_RP_ORIGIN").unwrap_or_else(|_| "http://localhost:1420".to_string()),
    )
    .unwrap();
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
            db_cmds::create_transaction,
            db_cmds::update_transaction,
            db_cmds::delete_transaction,
            db_cmds::get_transaction_by_id,
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
