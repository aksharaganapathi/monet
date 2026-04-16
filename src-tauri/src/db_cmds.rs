use rusqlite::{params, params_from_iter, OptionalExtension};
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{State, AppHandle, command, Manager};
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use rsa::{Oaep, RsaPrivateKey, RsaPublicKey};
use rsa::rand_core::OsRng;
use sha2::Sha256;
use crate::AppState;

#[derive(Serialize)]
pub struct BudgetRow {
    id: i64,
    category_id: i64,
    amount: f64,
    period: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
pub struct CategoryRow {
    id: i64,
    name: String,
    icon: Option<String>,
    is_custom: i64,
    created_at: String,
}

#[derive(Serialize)]
pub struct BudgetProgressRow {
    budget: BudgetRow,
    category: CategoryRow,
    spent: f64,
    remaining: f64,
    percent_used: f64,
}

fn value_to_sql_type(v: &Value) -> rusqlite::types::ToSqlOutput<'_> {
    match v {
        Value::Null => rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Null),
        Value::Bool(b) => rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Integer(if *b { 1 } else { 0 })),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Integer(i))
            } else if let Some(f) = n.as_f64() {
                rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Real(f))
            } else {
                rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Null)
            }
        },
        Value::String(s) => rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Text(s.clone())),
        Value::Array(_) | Value::Object(_) => rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Text(v.to_string())),
    }
}

// Internal helper for queries
fn execute_query(state: &State<AppState>, query: &str, bind_values: Vec<Value>) -> Result<Value, String> {
    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;
    let params: Vec<_> = bind_values.iter().map(value_to_sql_type).collect();
    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let rows_affected = stmt.execute(params_from_iter(params)).map_err(|e| e.to_string())?;
    let last_insert_id = conn.last_insert_rowid();
    
    let mut map = Map::new();
    map.insert("lastInsertId".to_string(), Value::Number(last_insert_id.into()));
    map.insert("rowsAffected".to_string(), Value::Number(rows_affected.into()));
    
    Ok(Value::Object(map))
}

fn select_query(state: &State<AppState>, query: &str, bind_values: Vec<Value>) -> Result<Vec<Value>, String> {
    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;
    let params: Vec<_> = bind_values.iter().map(value_to_sql_type).collect();
    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let column_names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    
    use rusqlite::types::ValueRef;
    let mut rows = stmt.query(params_from_iter(params)).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut map = Map::new();
        for (i, name) in column_names.iter().enumerate() {
            let value = match row.get_ref(i).map_err(|e| e.to_string())? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(i) => Value::Number(i.into()),
                ValueRef::Real(f) => Value::Number(
                    serde_json::Number::from_f64(f)
                        .unwrap_or_else(|| serde_json::Number::from(0)),
                ),
                ValueRef::Text(t) => Value::String(String::from_utf8(t.to_vec()).map_err(|e| e.to_string())?),
                ValueRef::Blob(b) => {
                    use base64::Engine;
                    Value::String(base64::engine::general_purpose::STANDARD.encode(b))
                },
            };
            map.insert(name.clone(), value);
        }
        results.push(Value::Object(map));
    }
    
    Ok(results)
}

fn upsert_today_balance_snapshot_on_conn(conn: &rusqlite::Connection) -> Result<(), String> {
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

fn upsert_today_balance_snapshot(state: &State<AppState>) -> Result<(), String> {
    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;
    upsert_today_balance_snapshot_on_conn(conn)
}

fn month_period_from_iso_date(date: &str) -> Option<String> {
    if date.len() < 7 {
        return None;
    }

    let period = &date[0..7];
    if period.chars().nth(4) != Some('-') {
        return None;
    }

    Some(period.to_string())
}

fn invalidate_month_story_cache_on_conn(conn: &rusqlite::Connection, period_key: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM ai_summaries WHERE period_key = ?1",
        params![period_key],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn invalidate_month_story_cache_from_date(state: &State<AppState>, date: &str) -> Result<(), String> {
    let Some(period_key) = month_period_from_iso_date(date) else {
        return Ok(());
    };

    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;
    invalidate_month_story_cache_on_conn(conn, &period_key)
}

fn invalidate_current_month_story_cache_on_conn(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM ai_summaries WHERE period_key = strftime('%Y-%m', 'now')",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn upsert_month_story_cache_on_conn(conn: &rusqlite::Connection, period_key: &str, summary: &str) -> Result<(), String> {
    conn.execute(
        "
        INSERT INTO ai_summaries (period_key, summary, updated_at)
        VALUES (?1, ?2, datetime('now'))
        ON CONFLICT(period_key) DO UPDATE SET
            summary = excluded.summary,
            updated_at = datetime('now')
        ",
        params![period_key, summary],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn fallback_month_story(income: f64, expense: f64, categories: &[(String, f64)]) -> String {
    if income == 0.0 && expense == 0.0 {
        return "No meaningful activity yet this month. Add a few transactions so Monet can judge your cash flow, spending concentration, and next step.".to_string();
    }

    let net_flow = income - expense;
    let savings_rate = if income > 0.0 {
        (net_flow / income) * 100.0
    } else {
        0.0
    };

    if categories.is_empty() {
        return format!(
            "You brought in ${:.2}, spent ${:.2}, and kept ${:.2} net. Savings rate is {:.1}%. Categorize more expenses so the biggest source of spending pressure becomes clearer.",
            income,
            expense,
            net_flow,
            savings_rate
        );
    }

    let (top_name, top_total) = &categories[0];
    let top_pct = if expense > 0.0 { (*top_total / expense) * 100.0 } else { 0.0 };
    let runner_up_text = categories
        .get(1)
        .map(|(name, total)| {
            let pct = if expense > 0.0 { (total / expense) * 100.0 } else { 0.0 };
            format!(" The second-largest category is {} at {:.1}%.", name, pct)
        })
        .unwrap_or_default();

    format!(
        "You brought in ${:.2}, spent ${:.2}, and kept ${:.2} net, for a savings rate of {:.1}%. {} is your biggest pressure point at {:.1}% of spending.{} Keep an eye on whether that category is intentional or drifting.",
        income,
        expense,
        net_flow,
        savings_rate,
        top_name,
        top_pct,
        runner_up_text
    )
}

fn env_var_or_compile(name: &str, compiled: Option<&'static str>) -> Option<String> {
    std::env::var(name)
        .ok()
        .and_then(|v| {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .or_else(|| {
            compiled.and_then(|v| {
                let trimmed = v.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
        })
}

fn db_setting(app: &AppHandle, key: &str) -> Option<String> {
    let state: State<AppState> = app.state();
    let mut lock = state.db.lock().ok()?;
    let conn = lock.as_mut()?;
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

fn resolve_ai_api_key(app: &AppHandle) -> Option<String> {
    db_setting(app, "ai_api_key")
        .or_else(|| env_var_or_compile("MONET_GROQ_API_KEY", option_env!("MONET_GROQ_API_KEY")))
        .or_else(|| env_var_or_compile("GROQ_API_KEY", option_env!("GROQ_API_KEY")))
        .or_else(|| env_var_or_compile("MONET_AI_API_KEY", option_env!("MONET_AI_API_KEY")))
}

fn resolve_google_client_id(app: &AppHandle) -> Option<String> {
    db_setting(app, "google_client_id")
        .or_else(|| env_var_or_compile("MONET_GOOGLE_CLIENT_ID", option_env!("MONET_GOOGLE_CLIENT_ID")))
}

fn resolve_google_client_secret(app: &AppHandle) -> Option<String> {
    db_setting(app, "google_client_secret")
        .or_else(|| env_var_or_compile("MONET_GOOGLE_CLIENT_SECRET", option_env!("MONET_GOOGLE_CLIENT_SECRET")))
}

fn discover_google_oauth_credentials_file(app: &AppHandle) -> Option<(PathBuf, String, String)> {
    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(dir) = crate::app_data_dir(app) {
        candidate_dirs.push(dir);
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidate_dirs.push(cwd.clone());
        candidate_dirs.push(cwd.join(".."));
    }

    if let Some(script_path) = resolve_sync_script_path() {
        if let Some(parent) = script_path.parent() {
            candidate_dirs.push(parent.to_path_buf());
        }
    }

    let mut deduped_dirs: Vec<PathBuf> = Vec::new();
    let mut seen = HashSet::new();
    for dir in candidate_dirs {
        let key = dir.to_string_lossy().to_string();
        if seen.insert(key) {
            deduped_dirs.push(dir);
        }
    }

    for dir in deduped_dirs {
        let entries = match std::fs::read_dir(&dir) {
            Ok(items) => items,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
                continue;
            };

            let looks_like_google_oauth_file =
                (name.starts_with("client_secret_") && name.ends_with(".json"))
                    || name == "credentials.json";

            if !looks_like_google_oauth_file {
                continue;
            }

            let raw = match std::fs::read_to_string(&path) {
                Ok(content) => content,
                Err(_) => continue,
            };

            let parsed: Value = match serde_json::from_str(&raw) {
                Ok(value) => value,
                Err(_) => continue,
            };

            let section = parsed
                .get("installed")
                .or_else(|| parsed.get("web"))
                .and_then(|v| v.as_object());

            let Some(section) = section else {
                continue;
            };

            let client_id = section
                .get("client_id")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());

            let client_secret = section
                .get("client_secret")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());

            if let (Some(id), Some(secret)) = (client_id, client_secret) {
                return Some((path, id, secret));
            }
        }
    }

    None
}

fn read_google_oauth_credentials_from_file(app: &AppHandle) -> Option<(String, String)> {
    discover_google_oauth_credentials_file(app).map(|(_, id, secret)| (id, secret))
}

fn google_oauth_credentials_path_from_file(app: &AppHandle) -> Option<PathBuf> {
    discover_google_oauth_credentials_file(app).map(|(path, _, _)| path)
}

fn resolve_sync_script_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("sync_script.py"));
        candidates.push(cwd.join("..").join("sync_script.py"));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            candidates.push(parent.join("sync_script.py"));
            candidates.push(parent.join("..").join("sync_script.py"));
        }
    }

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn write_trusted_senders_file(app: &AppHandle, trusted_entries: &[String]) -> Result<PathBuf, String> {
    let app_dir = crate::app_data_dir(app)?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    let trusted_path = app_dir.join("trusted_senders.json");
    let payload = serde_json::to_string(trusted_entries).map_err(|e| e.to_string())?;
    std::fs::write(&trusted_path, payload.as_bytes()).map_err(|e| e.to_string())?;
    Ok(trusted_path)
}

fn spawn_sync_worker_with_launcher(
    launcher: &str,
    launcher_args: &[&str],
    script_path: &Path,
    worker_args: &[String],
    log_path: &Path,
) -> Result<(), String> {
    let inherit_stdio = std::env::var("MONET_SYNC_STDIO")
        .ok()
        .map(|value| {
            let lowered = value.trim().to_ascii_lowercase();
            lowered == "1" || lowered == "true" || lowered == "yes"
        })
        .unwrap_or(false);

    let mut command = Command::new(launcher);
    command
        .args(launcher_args)
        .arg(script_path)
        .args(worker_args)
        .stdin(Stdio::null());

    if inherit_stdio {
        command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else {
        let log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .map_err(|e| format!("Unable to open sync worker log {}: {}", log_path.display(), e))?;
        let err_file = log_file
            .try_clone()
            .map_err(|e| format!("Unable to clone sync worker log handle: {}", e))?;
        command
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(err_file));
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{} launch error: {}", launcher, e))
}

fn launch_sync_worker(
    app: &AppHandle,
    public_key_path: &Path,
    trusted_senders_path: &Path,
    credentials_path: Option<&Path>,
) -> Result<PathBuf, String> {
    let script_path = resolve_sync_script_path().ok_or_else(|| {
        "Could not find sync_script.py. Keep it in the project root for automatic background sync.".to_string()
    })?;

    let app_dir = crate::app_data_dir(app)?;
    let queue_dir = app_dir.join("sync_queue");
    let log_path = app_dir.join("sync_worker.log");
    std::fs::create_dir_all(&queue_dir).map_err(|e| e.to_string())?;
    let token_path = app_dir.join("token.json");
    let config_path = app_dir.join("sync_config.json");

    let mut config = serde_json::json!({
        "public_key": public_key_path.to_string_lossy(),
        "queue_dir": queue_dir.to_string_lossy(),
        "token": token_path.to_string_lossy(),
        "trusted_senders_json": trusted_senders_path.to_string_lossy(),
        "current_month_only": true,
        "watch": true,
        "interval": 30
    });

    if let Some(path) = credentials_path {
        config["credentials"] = Value::String(path.to_string_lossy().to_string());
    }

    let config_json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, config_json).map_err(|e| e.to_string())?;

    let worker_args = vec![
        "--config".to_string(),
        config_path.to_string_lossy().to_string(),
    ];

    match spawn_sync_worker_with_launcher("python", &["-u"], &script_path, &worker_args, &log_path) {
        Ok(()) => Ok(log_path),
        Err(primary_error) => {
            match spawn_sync_worker_with_launcher("py", &["-3", "-u"], &script_path, &worker_args, &log_path) {
                Ok(()) => Ok(log_path),
                Err(fallback_error) => {
                    Err(format!("{} | {}", primary_error, fallback_error))
                }
            }
        }
    }
}

fn write_google_token_cache(
    app: &AppHandle,
    access_token: &str,
    refresh_token: Option<&str>,
    client_id: &str,
    client_secret: &str,
) -> Result<PathBuf, String> {
    let app_dir = crate::app_data_dir(app)?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    let token_path = app_dir.join("token.json");
    let payload = serde_json::json!({
        "token": access_token,
        "refresh_token": refresh_token.unwrap_or(""),
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": client_id,
        "client_secret": client_secret,
        "scopes": ["https://www.googleapis.com/auth/gmail.readonly"],
        "type": "authorized_user"
    });

    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    std::fs::write(&token_path, json).map_err(|e| e.to_string())?;
    Ok(token_path)
}

fn is_env_only_setting_key(_key: &str) -> bool {
    false
}

async fn fetch_google_profile_email(access_token: &str) -> Option<String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let body: Value = response.json().await.ok()?;
    body.get("emailAddress")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[command]
pub async fn summarize_month_story(state: State<'_, AppState>, app: AppHandle, year: i32, month: u32) -> Result<String, String> {
    if month == 0 || month > 12 {
        return Err("Invalid month".to_string());
    }


    let period_key = format!("{:04}-{:02}", year, month);
    let start_date = format!("{}-01", period_key);
    let end_date = format!("{}-31", period_key);

    let (income, expense, categories, total_tx_count, spend_tx_count, cached_summary) = {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;

        let cached_summary: Option<String> = conn
            .query_row(
                "SELECT summary FROM ai_summaries WHERE period_key = ?1",
                params![period_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let income: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE amount >= 0 AND date BETWEEN ?1 AND ?2",
                params![start_date, end_date],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let total_tx_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transactions WHERE date BETWEEN ?1 AND ?2",
                params![start_date, end_date],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let spend_tx_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transactions WHERE amount < 0 AND date BETWEEN ?1 AND ?2",
                params![start_date, end_date],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let expense: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(ABS(amount)), 0) FROM transactions WHERE amount < 0 AND date BETWEEN ?1 AND ?2",
                params![start_date, end_date],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare(
                "
                SELECT c.name, COALESCE(SUM(ABS(t.amount)), 0) as total
                FROM transactions t
                JOIN categories c ON t.category_id = c.id
                WHERE t.amount < 0 AND t.date BETWEEN ?1 AND ?2
                GROUP BY c.name
                HAVING total > 0
                ORDER BY total DESC
                LIMIT 6
                ",
            )
            .map_err(|e| e.to_string())?;

        let mut rows = stmt.query(params![start_date, end_date]).map_err(|e| e.to_string())?;
        let mut categories: Vec<(String, f64)> = Vec::new();

        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let name: String = row.get(0).map_err(|e| e.to_string())?;
            let total: f64 = row.get(1).map_err(|e| e.to_string())?;
            categories.push((name, total));
        }

        (income, expense, categories, total_tx_count, spend_tx_count, cached_summary)
    };

    let fallback = fallback_month_story(income, expense, &categories);


    let model = db_setting(&app, "ai_model")
        .or_else(|| env_var_or_compile("MONET_GROQ_MODEL", option_env!("MONET_GROQ_MODEL")))
        .or_else(|| env_var_or_compile("GROQ_MODEL", option_env!("GROQ_MODEL")))
        .unwrap_or_else(|| "llama-3.1-8b-instant".to_string());
    let api_key = resolve_ai_api_key(&app);

    let Some(api_key) = api_key else {
        return Ok(fallback);
    };

    if let Some(summary) = cached_summary {
        return Ok(summary);
    }

    let net_flow = income - expense;
    let savings_rate = if income > 0.0 { (net_flow / income) * 100.0 } else { 0.0 };
    let avg_expense_tx = if spend_tx_count > 0 {
        expense / spend_tx_count as f64
    } else {
        0.0
    };

    let category_lines = if categories.is_empty() {
        "No expense categories this month.".to_string()
    } else {
        categories
            .iter()
            .map(|(name, total)| {
                let pct = if expense > 0.0 { (total / expense) * 100.0 } else { 0.0 };
                format!("- {}: ${:.2} ({:.1}%)", name, total, pct)
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let prompt = format!(
        "Write exactly 2 concise plain-English sentences. Sentence 1 should explain cash posture for the month. Sentence 2 should identify the biggest spending pressure and one useful next step. Keep it analytical, practical, and brief. No markdown, no bullets, no hype, no emojis.\n\nMonth: {:04}-{:02}\nIncome: ${:.2}\nExpense: ${:.2}\nNet flow: ${:.2}\nSavings rate: {:.1}%\nTotal transactions: {}\nSpending transactions: {}\nAverage expense transaction: ${:.2}\nSpending categories:\n{}",
        year,
        month,
        income,
        expense,
        net_flow,
        savings_rate,
        total_tx_count,
        spend_tx_count,
        avg_expense_tx,
        category_lines
    );

    let client = reqwest::Client::new();
    let (endpoint, auth_header, body_json) = build_ai_request(&api_key, &model, &prompt);

    let mut request = client.post(&endpoint);
    request = request.header("Authorization", &auth_header);

    let response = match request
        .header("Content-Type", "application/json")
        .json(&body_json)
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(_) => return Ok(fallback),
    };

    if !response.status().is_success() {
        return Ok(fallback);
    }

    let body: Value = match response.json().await {
        Ok(v) => v,
        Err(_) => return Ok(fallback),
    };

    let Some(summary) = extract_ai_response(&body) else {
        return Ok(fallback);
    };

    {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        upsert_month_story_cache_on_conn(conn, &period_key, &summary)?;
    }

    Ok(summary)
}

fn build_ai_request(api_key: &str, model: &str, prompt: &str) -> (String, String, Value) {
    let system_msg = "You are a personal finance analyst. Return short, concrete monthly readouts that help users decide what deserves attention next.";
    let endpoint = "https://api.groq.com/openai/v1/chat/completions".to_string();
    let body = serde_json::json!({
        "model": model,
        "temperature": 0.2,
        "max_tokens": 120,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": prompt}
        ]
    });
    (endpoint, format!("Bearer {}", api_key), body)
}

fn extract_ai_response(body: &Value) -> Option<String> {
    let raw = body
        .get("choices")
        .and_then(|v| v.get(0))
        .and_then(|v| v.get("message"))
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_str())?;

    let cleaned: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() { None } else { Some(cleaned) }
}

// ------ Settings ------

#[command]
pub fn get_setting(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    if is_env_only_setting_key(&key) {
        return Ok(None);
    }

    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(value)
}

#[command]
pub fn put_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    if is_env_only_setting_key(&key) {
        return Err("This setting is env-only and cannot be stored in the database.".to_string());
    }

    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub fn delete_setting(state: State<AppState>, key: String) -> Result<(), String> {
    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub fn get_all_settings(state: State<AppState>) -> Result<Vec<Value>, String> {
    select_query(
        &state,
        "SELECT key, value FROM settings WHERE key NOT IN ('ai_provider', 'ai_model', 'ai_api_key', 'google_client_id', 'google_client_secret') ORDER BY key ASC",
        vec![],
    )
}

// ------ Sync Queue ------

fn normalize_sync_sender_entry(value: &str) -> Option<String> {
    let lowered = value.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return None;
    }

    if let Some(email) = extract_email_address(&lowered) {
        return Some(email);
    }

    let domain = lowered.trim_start_matches('@').trim_matches('.');
    if domain.contains('.')
        && domain
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '.')
    {
        return Some(domain.to_string());
    }

    None
}

fn extract_email_address(value: &str) -> Option<String> {
    let lowered = value.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return None;
    }

    if let (Some(start), Some(end)) = (lowered.find('<'), lowered.find('>')) {
        if end > start + 1 {
            let candidate = lowered[start + 1..end].trim();
            if candidate.contains('@') && candidate.contains('.') {
                return Some(candidate.to_string());
            }
        }
    }

    lowered
        .split_whitespace()
        .map(|part| {
            part.trim_matches(|ch: char| {
                ch == '<' || ch == '>' || ch == '"' || ch == '\'' || ch == ',' || ch == ';'
            })
        })
        .find(|part| part.contains('@') && part.contains('.'))
        .map(|part| part.to_string())
}

fn sender_is_trusted(sender_raw: &str, trusted_entries: &[String]) -> bool {
    if trusted_entries.is_empty() {
        return true;
    }

    let Some(sender_email) = extract_email_address(sender_raw) else {
        return false;
    };

    let sender_domain = sender_email
        .split_once('@')
        .map(|(_, domain)| domain)
        .unwrap_or("");

    for entry in trusted_entries {
        if entry.contains('@') {
            if sender_email == *entry {
                return true;
            }
            continue;
        }

        if sender_domain == entry || sender_domain.ends_with(&format!(".{}", entry)) {
            return true;
        }
    }

    false
}

fn load_sync_trusted_entries(conn: &rusqlite::Connection) -> Vec<String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'sync_domains'",
            [],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();

    let Some(raw) = raw else {
        return Vec::new();
    };

    let parsed: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    parsed
        .into_iter()
        .filter_map(|entry| normalize_sync_sender_entry(&entry))
        .collect()
}

fn store_sync_keypair(
    conn: &mut rusqlite::Connection,
    private_key_pem: &str,
    public_key_pem: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES ('sync_private_key', ?1, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        params![private_key_pem],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES ('sync_public_key', ?1, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        params![public_key_pem],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn create_sync_keypair_pem() -> Result<(String, String), String> {
    let mut rng = OsRng;
    let private_key = RsaPrivateKey::new(&mut rng, 2048).map_err(|e| e.to_string())?;
    let public_key = RsaPublicKey::from(&private_key);
    let private_pem = private_key
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| e.to_string())?
        .to_string();
    let public_pem = public_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| e.to_string())?;
    Ok((private_pem, public_pem))
}

fn write_public_key_file(app: &AppHandle, public_key_pem: &str) -> Result<std::path::PathBuf, String> {
    let app_dir = crate::app_data_dir(app)?;
    let sync_dir = app_dir.join("sync_queue");
    std::fs::create_dir_all(&sync_dir).map_err(|e| e.to_string())?;

    let public_key_path = app_dir.join("monet_sync.pub");
    std::fs::write(&public_key_path, public_key_pem.as_bytes()).map_err(|e| e.to_string())?;
    Ok(public_key_path)
}

pub(crate) fn ensure_sync_keypair(
    state: &State<AppState>,
    app: &AppHandle,
) -> Result<std::path::PathBuf, String> {
    let (stored_private, stored_public) = {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        let private_key: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'sync_private_key'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let public_key: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'sync_public_key'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        (private_key, public_key)
    };

    if let Some(private_pem) = stored_private {
        if let Ok(private_key) = RsaPrivateKey::from_pkcs8_pem(&private_pem) {
            let should_backfill_public = stored_public
                .as_ref()
                .map(|v| v.trim().is_empty())
                .unwrap_or(true);

            let public_pem = match stored_public {
                Some(existing) if !existing.trim().is_empty() => existing,
                _ => RsaPublicKey::from(&private_key)
                    .to_public_key_pem(LineEnding::LF)
                    .map_err(|e| e.to_string())?,
            };

            if should_backfill_public {
                let mut lock = state.db.lock().unwrap();
                let conn = lock.as_mut().ok_or("Database not initialized")?;
                conn.execute(
                    "INSERT INTO settings (key, value, updated_at) VALUES ('sync_public_key', ?1, datetime('now'))
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
                    params![public_pem],
                )
                .map_err(|e| e.to_string())?;
            }

            return write_public_key_file(app, &public_pem);
        }
    }

    let (private_pem, public_pem) = create_sync_keypair_pem()?;
    {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        store_sync_keypair(conn, &private_pem, &public_pem)?;
    }
    write_public_key_file(app, &public_pem)
}

/// Decrypt a legacy base64 AES-256-GCM blob using a legacy symmetric key.
/// This keeps old queued files readable during migration to asymmetric sync.
fn decrypt_sync_blob_legacy(encrypted_b64: &str, key_b64: &str) -> Result<String, String> {
    use base64::Engine;
    use ring::aead::{self, Aad, LessSafeKey, Nonce, UnboundKey};

    let key_bytes = base64::engine::general_purpose::STANDARD
        .decode(key_b64.as_bytes())
        .map_err(|e| format!("Invalid legacy sync key: {}", e))?;

    let encrypted = base64::engine::general_purpose::STANDARD
        .decode(encrypted_b64.as_bytes())
        .map_err(|e| format!("Invalid encrypted data: {}", e))?;

    if encrypted.len() < 12 {
        return Err("Encrypted data too short".to_string());
    }

    let (nonce_bytes, ciphertext) = encrypted.split_at(12);
    let nonce = Nonce::try_assume_unique_for_key(nonce_bytes)
        .map_err(|_| "Invalid nonce".to_string())?;
    let unbound_key = UnboundKey::new(&aead::AES_256_GCM, &key_bytes)
        .map_err(|_| "Invalid AES key".to_string())?;
    let key = LessSafeKey::new(unbound_key);

    let mut in_out = ciphertext.to_vec();
    let plaintext = key
        .open_in_place(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| "Decryption failed — data may be corrupted or key mismatch".to_string())?;

    String::from_utf8(plaintext.to_vec())
        .map_err(|e| format!("Decrypted data is not valid UTF-8: {}", e))
}

/// Decrypt an RSA-OAEP + AES-GCM encrypted queue file.
fn decrypt_sync_blob(encrypted_blob_json: &str, private_key_pem: &str) -> Result<String, String> {
    use base64::Engine;
    use ring::aead::{self, Aad, LessSafeKey, Nonce, UnboundKey};

    let trimmed = encrypted_blob_json.trim();
    if !trimmed.starts_with('{') {
        return decrypt_sync_blob_legacy(trimmed, private_key_pem);
    }

    let envelope: Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Invalid sync envelope JSON: {}", e))?;

    let encrypted_key_b64 = envelope
        .get("encrypted_key")
        .and_then(|v| v.as_str())
        .ok_or("Missing encrypted_key in sync envelope")?;
    let nonce_b64 = envelope
        .get("nonce")
        .and_then(|v| v.as_str())
        .ok_or("Missing nonce in sync envelope")?;
    let ciphertext_b64 = envelope
        .get("ciphertext")
        .and_then(|v| v.as_str())
        .ok_or("Missing ciphertext in sync envelope")?;

    let encrypted_key = base64::engine::general_purpose::STANDARD
        .decode(encrypted_key_b64.as_bytes())
        .map_err(|e| format!("Invalid encrypted_key encoding: {}", e))?;
    let nonce_bytes = base64::engine::general_purpose::STANDARD
        .decode(nonce_b64.as_bytes())
        .map_err(|e| format!("Invalid nonce encoding: {}", e))?;
    let ciphertext = base64::engine::general_purpose::STANDARD
        .decode(ciphertext_b64.as_bytes())
        .map_err(|e| format!("Invalid ciphertext encoding: {}", e))?;

    if nonce_bytes.len() != 12 {
        return Err("Invalid nonce length for AES-GCM".to_string());
    }

    let private_key = RsaPrivateKey::from_pkcs8_pem(private_key_pem)
        .map_err(|e| format!("Invalid sync private key: {}", e))?;
    let symmetric_key = private_key
        .decrypt(Oaep::new::<Sha256>(), &encrypted_key)
        .map_err(|e| format!("Failed to decrypt envelope key: {}", e))?;

    if symmetric_key.len() != 32 {
        return Err("Decrypted envelope key is not AES-256 length".to_string());
    }

    let nonce = Nonce::try_assume_unique_for_key(&nonce_bytes)
        .map_err(|_| "Invalid nonce".to_string())?;
    let unbound_key = UnboundKey::new(&aead::AES_256_GCM, &symmetric_key)
        .map_err(|_| "Invalid AES key material".to_string())?;
    let key = LessSafeKey::new(unbound_key);

    let mut in_out = ciphertext;
    let plaintext = key
        .open_in_place(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| "Sync payload decryption failed".to_string())?;

    String::from_utf8(plaintext.to_vec())
        .map_err(|e| format!("Decrypted payload is not valid UTF-8: {}", e))
}

pub(crate) fn import_sync_queue_internal(state: &State<AppState>, app: &AppHandle) -> Result<u64, String> {
    let mut sync_dirs: Vec<PathBuf> = vec![crate::app_data_dir(app)?.join("sync_queue")];
    if let Ok(cwd) = std::env::current_dir() {
        sync_dirs.push(cwd.join("sync_queue"));
        sync_dirs.push(cwd.join("..").join("sync_queue"));
    }

    let mut seen_dirs: HashSet<String> = HashSet::new();
    sync_dirs.retain(|dir| {
        if !dir.exists() {
            return false;
        }
        let key = dir.to_string_lossy().to_string();
        if seen_dirs.contains(&key) {
            return false;
        }
        seen_dirs.insert(key);
        true
    });

    if sync_dirs.is_empty() {
        return Ok(0);
    }

    let has_any_account = {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        let account_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        account_count > 0
    };
    if !has_any_account {
        // Keep queue files untouched until the user has at least one account.
        return Ok(0);
    }

    let private_key_pem = {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'sync_private_key'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "Sync keypair not configured. Go to Settings > Email Sync to set up.".to_string())?
    };

    let mut imported_count = 0u64;

    for sync_dir in &sync_dirs {
        let mut files: Vec<_> = std::fs::read_dir(sync_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .map(|ext| ext == "enc")
                    .unwrap_or(false)
            })
            .collect();
        files.sort_by_key(|entry| entry.file_name());

        for file_entry in &files {
            let file_path = file_entry.path();

            let encrypted_blob = match std::fs::read_to_string(&file_path) {
                Ok(content) => content,
                Err(_) => continue,
            };

            let decrypted_json = match decrypt_sync_blob(&encrypted_blob, &private_key_pem) {
                Ok(json) => json,
                Err(_) => continue,
            };

            let transactions: Vec<Value> = match serde_json::from_str(&decrypted_json) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let file_imported = {
                let mut lock = state.db.lock().unwrap();
                let conn = lock.as_mut().ok_or("Database not initialized")?;
                let trusted_entries = load_sync_trusted_entries(conn);
                let tx = conn.transaction().map_err(|e| e.to_string())?;

            let default_account_id: Option<i64> = tx
                .query_row(
                    "SELECT id FROM accounts ORDER BY id ASC LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            let mut touched_periods: HashSet<String> = HashSet::new();
            let mut file_imported = 0u64;

            for txn in &transactions {
                let amount = txn.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let date = txn
                    .get("date")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                let note = txn
                    .get("note")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Synced from email");
                let merchant = txn
                    .get("merchant")
                    .and_then(|v| v.as_str())
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty());
                let category_name = txn
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Other");
                let account_name = txn
                    .get("account")
                    .and_then(|v| v.as_str())
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty());
                let source_email = txn
                    .get("source_email")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let external_id = txn
                    .get("external_id")
                    .and_then(|v| v.as_str())
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty());

                if date.is_empty() {
                    continue;
                }

                if !sender_is_trusted(source_email, &trusted_entries) {
                    continue;
                }

                if let Some(sync_id) = external_id {
                    let already_seen: Option<i64> = tx
                        .query_row(
                            "SELECT 1 FROM sync_imports WHERE external_id = ?1 LIMIT 1",
                            params![sync_id],
                            |row| row.get(0),
                        )
                        .optional()
                        .map_err(|e| e.to_string())?;
                    if already_seen.is_some() {
                        continue;
                    }
                }

                let category_id: i64 = match tx
                    .query_row(
                        "SELECT id FROM categories WHERE name = ?1 LIMIT 1",
                        params![category_name],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?
                {
                    Some(id) => id,
                    None => tx
                        .query_row(
                            "SELECT id FROM categories WHERE name = 'Other' LIMIT 1",
                            [],
                            |row| row.get(0),
                        )
                        .optional()
                        .map_err(|e| e.to_string())?
                        .unwrap_or(1),
                };

                let account_id = if let Some(acct_name) = account_name {
                    tx.query_row(
                        "SELECT id FROM accounts WHERE name = ?1 LIMIT 1",
                        params![acct_name],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?
                    .or(default_account_id)
                } else {
                    default_account_id
                };

                let Some(account_id) = account_id else {
                    continue;
                };

                tx.execute(
                    "INSERT INTO transactions (amount, category_id, account_id, date, note, merchant) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![amount, category_id, account_id, date, note, merchant],
                )
                .map_err(|e| e.to_string())?;

                if let Some(sync_id) = external_id {
                    tx.execute(
                        "INSERT OR IGNORE INTO sync_imports (external_id, imported_at) VALUES (?1, datetime('now'))",
                        params![sync_id],
                    )
                    .map_err(|e| e.to_string())?;
                }

                if let Some(period_key) = month_period_from_iso_date(date) {
                    touched_periods.insert(period_key);
                }

                file_imported += 1;
            }

            tx.commit().map_err(|e| e.to_string())?;

            if file_imported > 0 {
                for period_key in &touched_periods {
                    invalidate_month_story_cache_on_conn(conn, period_key)?;
                }
                upsert_today_balance_snapshot_on_conn(conn)?;
            }

                file_imported
            };

            // Queue files are immutable work items: once read and processed (or
            // intentionally skipped after validation), remove them to advance.
            let _ = std::fs::remove_file(&file_path);
            imported_count += file_imported;
        }
    }

    Ok(imported_count)
}

pub(crate) fn bootstrap_sync_on_unlock(state: &State<AppState>, app: &AppHandle) -> Result<u64, String> {
    let public_key_path = ensure_sync_keypair(state, app)?;
    let mut worker_active = false;

    let (sync_active, trusted_entries, access_token, refresh_token) = {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;

        let trusted_entries = load_sync_trusted_entries(conn);
        let sync_active: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'sync_active'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let access_token: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'google_access_token'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let refresh_token: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'google_refresh_token'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        (sync_active.unwrap_or_default() == "1", trusted_entries, access_token, refresh_token)
    };

    if sync_active {
        let file_fallback = read_google_oauth_credentials_from_file(app);
        let client_id = resolve_google_client_id(app)
            .or_else(|| file_fallback.as_ref().map(|(id, _)| id.clone()));
        let client_secret = resolve_google_client_secret(app)
            .or_else(|| file_fallback.map(|(_, secret)| secret));

        if let (Some(access), Some(client_id), Some(client_secret)) = (access_token, client_id, client_secret) {
            let _ = write_google_token_cache(
                app,
                &access,
                refresh_token.as_deref(),
                &client_id,
                &client_secret,
            );

            let trusted_senders_path = write_trusted_senders_file(app, &trusted_entries)?;
            let credentials_path = google_oauth_credentials_path_from_file(app);
            let worker_launch = launch_sync_worker(
                app,
                &public_key_path,
                &trusted_senders_path,
                credentials_path.as_deref(),
            );

            if worker_launch.is_ok() {
                worker_active = true;
            }

            if let Err(err) = worker_launch {
                eprintln!("[monet] warn: background sync worker did not start on unlock: {}", err);
            }
        }
    }

    {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        let active_value = if worker_active { "1" } else { "0" };
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ('sync_worker_active', ?1, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            params![active_value],
        )
        .map_err(|e| e.to_string())?;
    }

    import_sync_queue_internal(state, app)
}

#[command]
pub async fn connect_google_account(state: State<'_, AppState>, app: AppHandle) -> Result<String, String> {
    let file_fallback = read_google_oauth_credentials_from_file(&app);

    let client_id = resolve_google_client_id(&app)
        .or_else(|| file_fallback.as_ref().map(|(id, _)| id.clone()))
        .ok_or_else(|| {
        "Google sign-in is not configured. Set MONET_GOOGLE_CLIENT_ID (runtime env in dev shell or compile-time env during build), or place a Google OAuth client JSON (client_secret_*.json) at the project root.".to_string()
    })?;
    let client_secret = resolve_google_client_secret(&app)
        .or_else(|| file_fallback.map(|(_, secret)| secret))
        .ok_or_else(|| {
        "Google sign-in is missing a client secret. Set MONET_GOOGLE_CLIENT_SECRET (runtime env in dev shell or compile-time env during build), or place a Google OAuth client JSON (client_secret_*.json) at the project root.".to_string()
    })?;

    let client_id_for_worker = client_id.clone();
    let client_secret_for_worker = client_secret.clone();

    let tokens = crate::google_oauth::run_google_oauth_loopback(&app, client_id, client_secret).await?;
    let access_token = tokens.access_token.clone();
    let refresh_token = tokens.refresh_token.clone();
    let connected_email = fetch_google_profile_email(&tokens.access_token).await;
    let public_key_path = ensure_sync_keypair(&state, &app)?;

    let trusted_entries = {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        let trusted_entries = load_sync_trusted_entries(conn);
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ('google_access_token', ?1, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            params![access_token],
        )
        .map_err(|e| e.to_string())?;

        if let Some(rt) = refresh_token.clone() {
            tx.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES ('google_refresh_token', ?1, datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
                params![rt],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ('sync_active', '1', datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            [],
        )
        .map_err(|e| e.to_string())?;

        if let Some(email) = connected_email {
            tx.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES ('google_connected_email', ?1, datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
                params![email],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())?;
        trusted_entries
    };

    write_google_token_cache(
        &app,
        &access_token,
        refresh_token.as_deref(),
        &client_id_for_worker,
        &client_secret_for_worker,
    )?;

    let trusted_senders_path = write_trusted_senders_file(&app, &trusted_entries)?;
    let credentials_path = google_oauth_credentials_path_from_file(&app);
    let worker_launch = launch_sync_worker(
        &app,
        &public_key_path,
        &trusted_senders_path,
        credentials_path.as_deref(),
    );

    {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        let active_value = if worker_launch.is_ok() { "1" } else { "0" };
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ('sync_worker_active', ?1, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            params![active_value],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut message = format!(
        "Google account connected successfully. Syncing is active. Public key ready at: {}",
        public_key_path.to_string_lossy()
    );

    match &worker_launch {
        Err(err) => {
            message.push_str(&format!(
                " Automatic background script start failed: {}. Start manually with `python -u sync_script.py --watch --interval 30`.",
                err
            ));
        }
        Ok(log_path) => {
            message.push_str(&format!(
                " Background worker started (30s test interval). Logs: {}",
                log_path.to_string_lossy()
            ));
        }
    }

    Ok(message)
}

/// Import encrypted sync queue files from the sync directory.
#[command]
pub fn import_sync_queue(state: State<AppState>, app: AppHandle) -> Result<Value, String> {
    let imported_count = import_sync_queue_internal(&state, &app)?;
    let mut map = serde_json::Map::new();
    map.insert("imported".to_string(), Value::Number(imported_count.into()));
    Ok(Value::Object(map))
}

// ------ Accounts ------

#[command]
pub fn get_accounts(state: State<AppState>) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT * FROM accounts ORDER BY name ASC", vec![])
}

#[command]
pub fn get_account_by_id(state: State<AppState>, id: Value) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT * FROM accounts WHERE id = ?1", vec![id])
}

#[command]
pub fn create_account(state: State<AppState>, name: Value, type_: Value, balance: Value, institution: Value) -> Result<Value, String> {
    let result = execute_query(&state, "INSERT INTO accounts (name, type, balance, institution) VALUES (?1, ?2, ?3, ?4)", vec![name, type_, balance, institution])?;
    upsert_today_balance_snapshot(&state)?;
    Ok(result)
}

#[command]
pub fn update_account(state: State<AppState>, id: Value, name: Value, type_: Value, institution: Value) -> Result<Value, String> {
    execute_query(&state, "UPDATE accounts SET name = ?1, type = ?2, institution = ?3, updated_at = datetime('now') WHERE id = ?4", vec![name, type_, institution, id])
}

#[command]
pub fn update_account_balance(state: State<AppState>, id: Value, delta: Value) -> Result<Value, String> {
    let result = execute_query(&state, "UPDATE accounts SET balance = balance + ?1, updated_at = datetime('now') WHERE id = ?2", vec![delta, id])?;
    upsert_today_balance_snapshot(&state)?;
    Ok(result)
}

#[command]
pub fn set_account_balance(state: State<AppState>, id: Value, new_balance: Value, note: Value) -> Result<Value, String> {
    let account_id = id.as_i64().ok_or("Invalid account id")?;
    let next_balance = new_balance.as_f64().ok_or("Invalid balance")?;
    let adjustment_note = match note {
        Value::String(ref s) => Some(s.clone()),
        Value::Null => None,
        _ => return Err("Invalid note".into()),
    };

    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;

    let current_balance: f64 = conn
        .query_row(
            "SELECT balance FROM accounts WHERE id = ?1",
            [account_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let delta = next_balance - current_balance;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    if delta.abs() > 0.000001 {
        let preferred_category = if delta >= 0.0 { "Salary" } else { "Transfer" };
        let category_id: i64 = tx
            .query_row(
                "SELECT id FROM categories WHERE name = ?1 LIMIT 1",
                [preferred_category],
                |row| row.get(0),
            )
            .or_else(|_| {
                tx.query_row(
                    "SELECT id FROM categories WHERE name = 'Other' LIMIT 1",
                    [],
                    |row| row.get(0),
                )
            })
            .map_err(|e| e.to_string())?;

        let note_value = adjustment_note.unwrap_or_else(|| {
            if delta >= 0.0 {
                "Manual balance adjustment (inflow)".to_string()
            } else {
                "Manual balance adjustment (outflow)".to_string()
            }
        });

        tx.execute(
            "INSERT INTO transactions (amount, category_id, account_id, date, note) VALUES (?1, ?2, ?3, date('now'), ?4)",
            params![delta, category_id, account_id, note_value],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    if delta.abs() > 0.000001 {
        invalidate_current_month_story_cache_on_conn(conn)?;
    }
    upsert_today_balance_snapshot_on_conn(conn)?;

    Ok(Value::Object(Map::new()))
}

#[command]
pub fn delete_account(state: State<AppState>, id: Value) -> Result<Value, String> {
    execute_query(&state, "DELETE FROM transactions WHERE account_id = ?1", vec![id.clone()])?;
    let result = execute_query(&state, "DELETE FROM accounts WHERE id = ?1", vec![id])?;
    upsert_today_balance_snapshot(&state)?;
    Ok(result)
}

#[command]
pub fn get_total_balance(state: State<AppState>) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT COALESCE(SUM(balance), 0) as total FROM accounts", vec![])
}

// ------ Categories ------

#[command]
pub fn get_categories(state: State<AppState>) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT * FROM categories ORDER BY is_custom ASC, name ASC", vec![])
}

#[command]
pub fn create_category(state: State<AppState>, name: Value, icon: Value) -> Result<Value, String> {
    execute_query(&state, "INSERT INTO categories (name, icon, is_custom) VALUES (?1, ?2, 1)", vec![name, icon])
}

#[command]
pub fn delete_category(state: State<AppState>, id: Value) -> Result<Value, String> {
    execute_query(&state, "DELETE FROM categories WHERE id = ?1 AND is_custom = 1", vec![id])
}

#[command]
pub fn get_category_transaction_count(state: State<AppState>, id: Value) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT COUNT(*) as count FROM transactions WHERE category_id = ?1", vec![id])
}

// ------ Transactions ------

#[command]
pub fn get_transactions(state: State<AppState>, limit: Value) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT t.*, c.name as category_name, c.icon as category_icon, a.name as account_name FROM transactions t JOIN categories c ON t.category_id = c.id JOIN accounts a ON t.account_id = a.id ORDER BY t.date DESC, t.created_at DESC LIMIT ?1", vec![limit])
}

#[command]
pub fn get_transactions_by_account(state: State<AppState>, account_id: Value, limit: Value) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT t.*, c.name as category_name, c.icon as category_icon, a.name as account_name FROM transactions t JOIN categories c ON t.category_id = c.id JOIN accounts a ON t.account_id = a.id WHERE t.account_id = ?1 ORDER BY t.date DESC, t.created_at DESC LIMIT ?2", vec![account_id, limit])
}

#[command]
pub fn get_transactions_by_date(state: State<AppState>, start_date: Value, end_date: Value) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT t.*, c.name as category_name, c.icon as category_icon, a.name as account_name FROM transactions t JOIN categories c ON t.category_id = c.id JOIN accounts a ON t.account_id = a.id WHERE t.date BETWEEN ?1 AND ?2 ORDER BY t.date DESC, t.created_at DESC", vec![start_date, end_date])
}

#[command]
pub fn get_monthly_spending(state: State<AppState>, start_date: Value, end_date: Value) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT c.name as category_name, COALESCE(SUM(ABS(t.amount)), 0) as total FROM transactions t JOIN categories c ON t.category_id = c.id WHERE t.amount < 0 AND t.date BETWEEN ?1 AND ?2 GROUP BY c.name ORDER BY total DESC", vec![start_date, end_date])
}

#[command]
pub fn get_monthly_total_spent(state: State<AppState>, start_date: Value, end_date: Value) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM transactions WHERE amount < 0 AND date BETWEEN ?1 AND ?2", vec![start_date, end_date])
}

#[command]
pub fn set_transaction_flagged(state: State<AppState>, id: Value, flagged: Value) -> Result<Value, String> {
    execute_query(
        &state,
        "UPDATE transactions SET flagged = ?1 WHERE id = ?2",
        vec![flagged, id],
    )
}

#[command]
pub fn create_transaction(state: State<AppState>, amount: Value, category_id: Value, account_id: Value, date: Value, note: Value, merchant: Value) -> Result<Value, String> {
    let date_for_cache = date.as_str().map(|s| s.to_string());

    let merchant_value = match merchant {
        Value::String(ref s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Value::Null
            } else {
                Value::String(trimmed.to_string())
            }
        }
        Value::Null => Value::Null,
        _ => return Err("Invalid merchant".into()),
    };

    let result = execute_query(
        &state,
        "INSERT INTO transactions (amount, category_id, account_id, date, note, merchant) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        vec![amount, category_id, account_id, date, note, merchant_value],
    )?;

    if let Some(tx_date) = date_for_cache {
        invalidate_month_story_cache_from_date(&state, &tx_date)?;
    }

    Ok(result)
}

#[command]
pub fn update_transaction(
    state: State<AppState>,
    id: Value,
    amount: Value,
    category_id: Value,
    account_id: Value,
    date: Value,
    note: Value,
    merchant: Value,
) -> Result<Value, String> {
    let txn_id = id.as_i64().ok_or("Invalid transaction id")?;
    let next_amount = amount.as_f64().ok_or("Invalid amount")?;
    let next_category_id = category_id.as_i64().ok_or("Invalid category id")?;
    let next_account_id = account_id.as_i64().ok_or("Invalid account id")?;
    let next_date = date.as_str().ok_or("Invalid date")?;
    let next_note = match note {
        Value::String(ref s) => Some(s.clone()),
        Value::Null => None,
        _ => return Err("Invalid note".into()),
    };
    let next_merchant = match merchant {
        Value::String(ref s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Null => None,
        _ => return Err("Invalid merchant".into()),
    };

    let next_date_owned = next_date.to_string();

    let (rows_affected, prev_date) = {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;

        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let prev_date: String = tx
            .query_row(
                "SELECT date FROM transactions WHERE id = ?1",
                [txn_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let rows_affected = tx
            .execute(
                "UPDATE transactions SET amount = ?1, category_id = ?2, account_id = ?3, date = ?4, note = ?5, merchant = ?6 WHERE id = ?7",
                params![next_amount, next_category_id, next_account_id, next_date, next_note, next_merchant, txn_id],
            )
            .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        upsert_today_balance_snapshot_on_conn(conn)?;

        (rows_affected, prev_date)
    };

    invalidate_month_story_cache_from_date(&state, &prev_date)?;
    if prev_date != next_date_owned {
        invalidate_month_story_cache_from_date(&state, &next_date_owned)?;
    }

    let mut map = Map::new();
    map.insert("lastInsertId".to_string(), Value::Number(txn_id.into()));
    map.insert("rowsAffected".to_string(), Value::Number(rows_affected.into()));
    Ok(Value::Object(map))
}

#[command]
pub fn delete_transaction(state: State<AppState>, id: Value) -> Result<Value, String> {
    let txn_id = id.as_i64().ok_or("Invalid transaction id")?;

    let date_for_cache: Option<String> = {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;

        conn.query_row(
            "SELECT date FROM transactions WHERE id = ?1",
            [txn_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    let result = execute_query(&state, "DELETE FROM transactions WHERE id = ?1", vec![id])?;

    if let Some(tx_date) = date_for_cache {
        invalidate_month_story_cache_from_date(&state, &tx_date)?;
    }

    Ok(result)
}

#[command]
pub fn get_transaction_by_id(state: State<AppState>, id: Value) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT * FROM transactions WHERE id = ?1", vec![id])
}

// ------ Budgets ------

#[command]
pub fn get_budgets(state: State<AppState>) -> Result<Vec<Value>, String> {
    select_query(
        &state,
        "SELECT id, category_id, amount, period, created_at, updated_at FROM budgets ORDER BY updated_at DESC, id DESC",
        vec![],
    )
}

#[command]
pub fn upsert_budget(state: State<AppState>, category_id: Value, amount: Value) -> Result<Value, String> {
    let category_id_value = category_id.as_i64().ok_or("Invalid category id")?;
    let amount_value = amount.as_f64().ok_or("Invalid budget amount")?;

    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;

    conn.execute(
        "
        INSERT INTO budgets (category_id, amount, period, created_at, updated_at)
        VALUES (?1, ?2, 'monthly', datetime('now'), datetime('now'))
        ON CONFLICT(category_id) DO UPDATE SET
            amount = excluded.amount,
            period = 'monthly',
            updated_at = datetime('now')
        ",
        params![category_id_value, amount_value],
    )
    .map_err(|e| e.to_string())?;

    let budget_id: i64 = conn
        .query_row(
            "SELECT id FROM budgets WHERE category_id = ?1",
            params![category_id_value],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let amount_number = serde_json::Number::from_f64(amount_value).ok_or("Invalid budget amount")?;

    let mut map = Map::new();
    map.insert("lastInsertId".to_string(), Value::Number(budget_id.into()));
    map.insert("rowsAffected".to_string(), Value::Number(1.into()));
    map.insert("id".to_string(), Value::Number(budget_id.into()));
    map.insert("category_id".to_string(), Value::Number(category_id_value.into()));
    map.insert("amount".to_string(), Value::Number(amount_number));
    map.insert("period".to_string(), Value::String("monthly".to_string()));
    Ok(Value::Object(map))
}

#[command]
pub fn delete_budget(state: State<AppState>, id: Value) -> Result<Value, String> {
    execute_query(&state, "DELETE FROM budgets WHERE id = ?1", vec![id])
}

#[command]
pub fn get_budget_progress(state: State<AppState>, month: String) -> Result<Vec<BudgetProgressRow>, String> {
    if month.len() != 7 {
        return Err("Invalid month".to_string());
    }

    let start_date = format!("{}-01", month);
    let end_date = format!("{}-31", month);
    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;

    let mut stmt = conn
        .prepare(
            "
            SELECT
                b.id,
                b.category_id,
                b.amount,
                b.period,
                b.created_at,
                b.updated_at,
                c.id,
                c.name,
                c.icon,
                c.is_custom,
                c.created_at,
                COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0) AS spent
            FROM budgets b
            JOIN categories c ON c.id = b.category_id
            LEFT JOIN transactions t
                ON t.category_id = b.category_id
               AND t.date BETWEEN ?1 AND ?2
            GROUP BY b.id, c.id
            ORDER BY spent DESC, c.name ASC
            ",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![start_date, end_date], |row| {
            let amount: f64 = row.get(2)?;
            let spent: f64 = row.get(11)?;
            let remaining = amount - spent;
            let percent_used = if amount > 0.0 { (spent / amount) * 100.0 } else { 0.0 };

            Ok(BudgetProgressRow {
                budget: BudgetRow {
                    id: row.get(0)?,
                    category_id: row.get(1)?,
                    amount,
                    period: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                },
                category: CategoryRow {
                    id: row.get(6)?,
                    name: row.get(7)?,
                    icon: row.get(8)?,
                    is_custom: row.get(9)?,
                    created_at: row.get(10)?,
                },
                spent,
                remaining,
                percent_used,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }

    Ok(results)
}

#[command]
pub fn get_daily_balance_changes(state: State<AppState>) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT date, SUM(amount) as daily_change FROM transactions GROUP BY date ORDER BY date ASC", vec![])
}

#[command]
pub fn get_balance_snapshots(state: State<AppState>) -> Result<Vec<Value>, String> {
    select_query(
        &state,
        "SELECT snapshot_date as date, total_balance as value FROM balance_snapshots ORDER BY snapshot_date ASC",
        vec![],
    )
}
