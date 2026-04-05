use std::sync::Mutex;
use rusqlite::Connection;
use tauri::{State, Manager, AppHandle, command};

use base64::Engine;
use webauthn_rs::prelude::*;
use url::Url;

mod auth;
mod db_cmds;

pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub auth: Mutex<Option<Webauthn>>,
    pub auth_state: Mutex<Option<PasskeyAuthentication>>,
    pub reg_state: Mutex<Option<PasskeyRegistration>>,
}

fn get_or_create_key(app: &AppHandle) -> Result<String, String> {
    let key_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("db.key");
    if key_path.exists() {
        return std::fs::read_to_string(&key_path).map_err(|e| e.to_string());
    }

    let mut key_bytes = [0u8; 32];
    getrandom::fill(&mut key_bytes).map_err(|e| e.to_string())?;
    let new_key = base64::engine::general_purpose::STANDARD.encode(key_bytes);
    
    if let Some(parent) = key_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&key_path, &new_key).map_err(|e| e.to_string())?;
    
    Ok(new_key)
}

pub fn open_db(state: &State<AppState>, app: &AppHandle) -> Result<(), String> {
    let key = get_or_create_key(app)?;
    
    // Resolve secure app data dir
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("monet.db");
    
    // ensure dir exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    let path_str = path.to_str().unwrap().to_string();
    let conn = Connection::open(&path_str).map_err(|e| e.to_string())?;
    
    conn.pragma_update(None, "key", &key).map_err(|e| e.to_string())?;
    let _: i32 = conn.query_row("SELECT count(*) FROM sqlite_schema", [], |row| row.get(0)).map_err(|e| format!("Invalid password or corrupted DB: {}", e))?;
    
    conn.execute_batch("
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
    ").map_err(|e| e.to_string())?;

    // Migrate: Add institution column to accounts table if it doesn't exist
    let _ = conn.execute("ALTER TABLE accounts ADD COLUMN institution TEXT DEFAULT 'other'", []);

    let mut lock = state.db.lock().unwrap();
    *lock = Some(conn);
    Ok(())
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Generate Webauthn
    let rp_id = "localhost";
    let rp_origin = Url::parse("http://localhost:1420").unwrap();
    let builder = WebauthnBuilder::new(rp_id, &rp_origin).unwrap().rp_name("Monet Finance");
    let webauthn = builder.build().unwrap();

    let builder = tauri::Builder::default()
        .setup(|_app| {
            // Check if we don't have passkey.rs, meaning dev environment and tests etc? 
            // In a real app we would do this intelligently.
            Ok(())
        })
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
            db_cmds::initialize_db,
            db_cmds::get_accounts,
            db_cmds::get_account_by_id,
            db_cmds::create_account,
            db_cmds::update_account,
            db_cmds::update_account_balance,
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
            db_cmds::delete_transaction,
            db_cmds::get_transaction_by_id,
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
