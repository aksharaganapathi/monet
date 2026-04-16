use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge, RedirectUrl,
    Scope, TokenResponse, TokenUrl,
};
use std::collections::HashMap;
use tiny_http::{Response, Server, StatusCode};
use url::Url;

pub struct GoogleTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

pub async fn run_google_oauth_loopback(
    app: &tauri::AppHandle,
    client_id_str: String,
    client_secret_str: String,
) -> Result<GoogleTokens, String> {
    let client_id = ClientId::new(client_id_str);
    let client_secret = ClientSecret::new(client_secret_str);
    let auth_url = AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())
        .map_err(|e| format!("Invalid auth URL: {}", e))?;
    let token_url = TokenUrl::new("https://oauth2.googleapis.com/token".to_string())
        .map_err(|e| format!("Invalid token URL: {}", e))?;

    let server = Server::http("127.0.0.1:0")
        .map_err(|e| format!("Failed to start HTTP server: {}", e))?;
    let port = server.server_addr().to_ip().ok_or_else(|| "Failed to get IP".to_string())?.port();

    let redirect_url = format!("http://localhost:{}", port);
    let redirect_uri =
        RedirectUrl::new(redirect_url).map_err(|e| format!("Invalid redirect URL: {}", e))?;

    let client = BasicClient::new(client_id)
        .set_client_secret(client_secret)
        .set_auth_uri(auth_url)
        .set_token_uri(token_url)
        .set_redirect_uri(redirect_uri);

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let (auth_req_url, csrf_state) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new(
            "https://www.googleapis.com/auth/gmail.readonly".to_string(),
        ))
        .set_pkce_challenge(pkce_challenge)
        .add_extra_param("access_type", "offline")
        .url();

    use tauri_plugin_opener::OpenerExt;
    if let Err(e) = app.opener().open_url(auth_req_url.as_str(), None::<String>) {
        return Err(format!("Failed to open browser: {}", e));
    }

    // Wait for the callback.
    let request = server
        .incoming_requests()
        .next()
        .ok_or_else(|| "Failed to receive HTTP request".to_string())?;

    let url_path = format!("http://localhost{}", request.url());
    let parsed_url =
        Url::parse(&url_path).map_err(|e| format!("Failed to parse redirect URL: {}", e))?;

    let query_pairs: HashMap<_, _> = parsed_url.query_pairs().into_owned().collect();

    if let Some(error) = query_pairs.get("error") {
        let _ = request.respond(
            Response::from_string(format!("Error: {}", error))
                .with_status_code(StatusCode::from(400)),
        );
        return Err(format!("OAuth error: {}", error));
    }

    let code = query_pairs
        .get("code")
        .ok_or_else(|| "Authorization code not found in redirect URL".to_string())?;

    let state = query_pairs
        .get("state")
        .ok_or_else(|| "State not found in redirect URL".to_string())?;

    if state != csrf_state.secret() {
        let _ = request.respond(
            Response::from_string("Error: CSRF state mismatch.")
                .with_status_code(StatusCode::from(400)),
        );
        return Err("CSRF state mismatch".to_string());
    }

    let _ = request.respond(
        Response::from_string(
            "Authentication successful! You can now close this tab and return to the app.",
        )
        .with_status_code(StatusCode::from(200)),
    );

    let http_client = reqwest::Client::new();
    let token_result = client
        .exchange_code(AuthorizationCode::new(code.clone()))
        .set_pkce_verifier(pkce_verifier)
        .request_async(&http_client)
        .await
        .map_err(|e| format!("Failed to exchange authorization code: {}", e))?;

    Ok(GoogleTokens {
        access_token: token_result.access_token().secret().clone(),
        refresh_token: token_result.refresh_token().map(|t| t.secret().clone()),
    })
}
