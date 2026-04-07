use tauri::{AppHandle, State};

use crate::{AppState, SetupStatus};

#[tauri::command]
pub fn get_setup_status(app: AppHandle) -> Result<SetupStatus, String> {
    crate::get_setup_status_internal(&app)
}

#[tauri::command]
pub fn complete_onboarding(
    state: State<AppState>,
    app: AppHandle,
    name: String,
    password: String,
    biometric_enabled: bool,
) -> Result<SetupStatus, String> {
    crate::complete_onboarding_internal(&state, &app, name, password, biometric_enabled)
}

#[tauri::command]
pub fn unlock_with_password(
    state: State<AppState>,
    app: AppHandle,
    password: String,
) -> Result<SetupStatus, String> {
    crate::unlock_with_password_command(&state, &app, password)
}

#[tauri::command]
pub fn update_user_name(app: AppHandle, name: String) -> Result<SetupStatus, String> {
    crate::update_user_name_internal(&app, name)
}

#[tauri::command]
pub fn change_password(
    state: State<AppState>,
    app: AppHandle,
    current_password: String,
    new_password: String,
) -> Result<SetupStatus, String> {
    crate::change_password_internal(&state, &app, current_password, new_password)
}

#[tauri::command]
pub fn set_biometric_enabled(
    app: AppHandle,
    password: String,
    enabled: bool,
) -> Result<SetupStatus, String> {
    crate::set_biometric_enabled_internal(&app, password, enabled)
}

#[tauri::command]
pub fn verify_password(app: AppHandle, password: String) -> Result<(), String> {
    crate::verify_password_internal(&app, &password)
}

#[tauri::command]
pub fn reset_biometric_registration(app: AppHandle) -> Result<(), String> {
    let path = crate::passkey_path(&app)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
