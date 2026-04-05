
use tauri::{State, Manager, AppHandle, command};
use webauthn_rs::prelude::*;
use crate::AppState;
use std::fs;

// In a real app, you would pass these from the frontend dynamically
const RP_ID: &str = "localhost";
const RP_ORIGIN: &str = "http://localhost:1420";

#[command]
pub fn start_register(state: State<AppState>, app: AppHandle) -> Result<CreationChallengeResponse, String> {
    let auth_lock = state.auth.lock().unwrap();
    let webauthn = auth_lock.as_ref().ok_or("Auth not configured")?;
    
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("passkey.json");
    if path.exists() {
        return Err("A passkey is already registered.".to_string());
    }
    
    let user_id = uuid::Uuid::new_v4();
    
    let (challenge, reg_state) = webauthn
        .start_passkey_registration(
            user_id,
            "monet-user",
            "Monet User",
            None
        )
        .map_err(|e| e.to_string())?;
        
    *state.reg_state.lock().unwrap() = Some(reg_state);
    
    Ok(challenge)
}

#[command]
pub fn finish_register(state: State<AppState>, app: AppHandle, credential: RegisterPublicKeyCredential) -> Result<(), String> {
    let auth_lock = state.auth.lock().unwrap();
    let webauthn = auth_lock.as_ref().ok_or("Auth not configured")?;
    
    let reg_state = state.reg_state.lock().unwrap().take().ok_or("No registration in progress")?;
    
    let passkey = webauthn.finish_passkey_registration(&credential, &reg_state).map_err(|e| e.to_string())?;
    
    // Save passkey locally securely
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("passkey.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    let json = serde_json::to_string(&passkey).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[command]
pub fn start_auth(state: State<AppState>, app: AppHandle) -> Result<RequestChallengeResponse, String> {
    let auth_lock = state.auth.lock().unwrap();
    let webauthn = auth_lock.as_ref().ok_or("Auth not configured")?;
    
    // load passkey
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("passkey.json");
    if !path.exists() {
        return Err("No passkey registered".to_string());
    }
    
    let passkey_json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let passkey: Passkey = serde_json::from_str(&passkey_json).map_err(|e| e.to_string())?;
    
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
    
    // Verification succeeded! Unlock the database.
    crate::open_db(&state, &app)
}
