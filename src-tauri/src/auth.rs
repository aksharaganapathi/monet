
use tauri::{State, AppHandle, command};
use webauthn_rs::prelude::*;
use crate::AppState;

fn build_passkey_name(user_name: Option<String>) -> String {
    let normalized = user_name
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .chars()
                .map(|char| {
                    if char.is_ascii_alphanumeric() {
                        char
                    } else {
                        '-'
                    }
                })
                .collect::<String>()
        })
        .map(|value| value.trim_matches('-').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "user".to_string());

    format!("monet-{normalized}")
}

#[command]
pub fn start_register(
    state: State<AppState>,
    app: AppHandle,
    user_name: Option<String>,
) -> Result<CreationChallengeResponse, String> {
    crate::ensure_recent_password_verification_for_passkey_enrollment(&state, &app)?;

    let auth_lock = state.auth.lock().unwrap();
    let webauthn = auth_lock.as_ref().ok_or("Auth not configured")?;
    
    let user_id = uuid::Uuid::new_v4();
    let display_name = build_passkey_name(user_name);
    
    let (challenge, reg_state) = webauthn
        .start_passkey_registration(
            user_id,
            &display_name,
            &display_name,
            None
        )
        .map_err(|e| e.to_string())?;
        
    *state.reg_state.lock().unwrap() = Some(reg_state);
    
    Ok(challenge)
}

#[command]
pub fn finish_register(state: State<AppState>, app: AppHandle, credential: RegisterPublicKeyCredential) -> Result<(), String> {
    crate::ensure_recent_password_verification_for_passkey_enrollment(&state, &app)?;

    let auth_lock = state.auth.lock().unwrap();
    let webauthn = auth_lock.as_ref().ok_or("Auth not configured")?;
    
    let reg_state = state.reg_state.lock().unwrap().take().ok_or("No registration in progress")?;
    
    let passkey = webauthn.finish_passkey_registration(&credential, &reg_state).map_err(|e| e.to_string())?;
    
    crate::save_passkey(&app, &passkey)?;
    
    Ok(())
}

#[command]
pub fn start_auth(state: State<AppState>, app: AppHandle) -> Result<RequestChallengeResponse, String> {
    let auth_lock = state.auth.lock().unwrap();
    let webauthn = auth_lock.as_ref().ok_or("Auth not configured")?;
    
    // load passkey
    let path = crate::passkey_path(&app)?;
    if !path.exists() {
        return Err("No passkey registered".to_string());
    }
    
    let passkey = crate::load_passkey(&app)?;
    
    let (challenge, auth_state) = webauthn.start_passkey_authentication(&[passkey]).map_err(|e| e.to_string())?;
    
    *state.auth_state.lock().unwrap() = Some(auth_state);
    
    Ok(challenge)
}

#[command]
pub fn finish_auth_and_init(state: State<AppState>, app: tauri::AppHandle, auth_res: PublicKeyCredential) -> Result<(), String> {
    let auth_lock = state.auth.lock().unwrap();
    let webauthn = auth_lock.as_ref().ok_or("Auth not configured")?;
    
    let auth_state = state.auth_state.lock().unwrap().take().ok_or("No auth in progress")?;
    
    let _verify_result = webauthn.finish_passkey_authentication(&auth_res, &auth_state).map_err(|e| e.to_string())?;
    
    crate::unlock_with_biometric_internal(&state, &app).map(|_| ())
}
