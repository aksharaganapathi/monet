use tauri::{AppHandle, State};

use crate::{AppState, SetupStatus};

#[tauri::command]
pub fn get_setup_status(app: AppHandle) -> Result<SetupStatus, String> {
    crate::get_setup_status_internal(&app)
}

#[tauri::command]
pub fn complete_setup(
    state: State<AppState>,
    app: AppHandle,
    name: String,
    secret: String,
    biometric_enabled: bool,
) -> Result<SetupStatus, String> {
    crate::complete_onboarding_internal(&state, &app, name, secret, biometric_enabled)
}

#[tauri::command]
pub fn unlock_vault(
    state: State<AppState>,
    app: AppHandle,
    secret: String,
) -> Result<SetupStatus, String> {
    crate::unlock_with_password_command(&state, &app, secret)
}

#[tauri::command]
pub fn update_user_name(app: AppHandle, name: String) -> Result<SetupStatus, String> {
    crate::update_user_name_internal(&app, name)
}

#[tauri::command]
pub fn change_vault_secret(
    state: State<AppState>,
    app: AppHandle,
    current_secret: String,
    new_secret: String,
) -> Result<SetupStatus, String> {
    crate::change_password_internal(&state, &app, current_secret, new_secret)
}

#[tauri::command]
pub fn set_biometric_enabled(
    state: State<AppState>,
    app: AppHandle,
    secret: String,
    enabled: bool,
) -> Result<SetupStatus, String> {
    crate::set_biometric_enabled_internal(&state, &app, secret, enabled)
}

#[tauri::command]
pub fn verify_unlock_secret(state: State<AppState>, app: AppHandle, secret: String) -> Result<(), String> {
    crate::verify_password_command(&state, &app, secret)
}

#[tauri::command]
pub fn reset_biometric_registration(app: AppHandle) -> Result<(), String> {
    let path = crate::passkey_path(&app)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Drop the open database connection, effectively locking the vault (M-5).
#[tauri::command]
pub fn lock_database(state: State<AppState>) -> Result<(), String> {
    crate::lock_database_internal(&state);
    Ok(())
}

