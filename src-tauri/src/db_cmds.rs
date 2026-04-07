use rusqlite::{params, params_from_iter, OptionalExtension};
use serde_json::{Map, Value};
use tauri::{State, AppHandle, command};
use std::env;
use crate::AppState;

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
                ValueRef::Real(f) => Value::Number(serde_json::Number::from_f64(f).unwrap()),
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

#[command]
pub async fn summarize_month_story(state: State<'_, AppState>, year: i32, month: u32) -> Result<String, String> {
    if month == 0 || month > 12 {
        return Err("Invalid month".to_string());
    }

    let period_key = format!("{:04}-{:02}", year, month);
    let start_date = format!("{}-01", period_key);
    let end_date = format!("{}-31", period_key);

    let (income, expense, categories, total_tx_count, spend_tx_count) = {
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

        if let Some(summary) = cached_summary {
            return Ok(summary);
        }

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

        (income, expense, categories, total_tx_count, spend_tx_count)
    };

    let fallback = fallback_month_story(income, expense, &categories);
    let api_key = match env::var("GROQ_API_KEY") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => return Ok(fallback),
    };

    let model = env::var("GROQ_MODEL").unwrap_or_else(|_| "llama-3.1-8b-instant".to_string());
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
    let response = match client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": model,
            "temperature": 0.2,
            "max_tokens": 120,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a personal finance analyst. Return short, concrete monthly readouts that help users decide what deserves attention next."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        }))
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

    let summary = body
        .get("choices")
        .and_then(|v| v.get(0))
        .and_then(|v| v.get("message"))
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_str())
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_else(|| fallback.clone());

    if summary.is_empty() {
        return Ok(fallback);
    }

    {
        let mut lock = state.db.lock().unwrap();
        let conn = lock.as_mut().ok_or("Database not initialized")?;
        upsert_month_story_cache_on_conn(conn, &period_key, &summary)?;
    }

    Ok(summary)
}

// ------ Settings/DB Init ------

#[command]
pub fn initialize_db(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    crate::open_legacy_db(&state, &app)
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

    let rows_affected = tx
        .execute(
            "UPDATE accounts SET balance = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![next_balance, account_id],
        )
        .map_err(|e| e.to_string())?;

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

    let mut map = Map::new();
    map.insert("rowsAffected".to_string(), Value::Number(rows_affected.into()));
    Ok(Value::Object(map))
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
pub fn create_transaction(state: State<AppState>, amount: Value, category_id: Value, account_id: Value, date: Value, note: Value) -> Result<Value, String> {
    let date_for_cache = date.as_str().map(|s| s.to_string());
    let result = execute_query(
        &state,
        "INSERT INTO transactions (amount, category_id, account_id, date, note) VALUES (?1, ?2, ?3, ?4, ?5)",
        vec![amount, category_id, account_id, date, note],
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

    let mut lock = state.db.lock().unwrap();
    let conn = lock.as_mut().ok_or("Database not initialized")?;

    let (prev_amount, prev_account_id): (f64, i64) = conn
        .query_row(
            "SELECT amount, account_id FROM transactions WHERE id = ?1",
            [txn_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE accounts SET balance = balance - ?1, updated_at = datetime('now') WHERE id = ?2",
        params![prev_amount, prev_account_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE accounts SET balance = balance + ?1, updated_at = datetime('now') WHERE id = ?2",
        params![next_amount, next_account_id],
    )
    .map_err(|e| e.to_string())?;

    let rows_affected = tx
        .execute(
            "UPDATE transactions SET amount = ?1, category_id = ?2, account_id = ?3, date = ?4, note = ?5 WHERE id = ?6",
            params![next_amount, next_category_id, next_account_id, next_date, next_note, txn_id],
        )
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    upsert_today_balance_snapshot_on_conn(conn)?;

    let mut map = Map::new();
    map.insert("lastInsertId".to_string(), Value::Number(txn_id.into()));
    map.insert("rowsAffected".to_string(), Value::Number(rows_affected.into()));
    Ok(Value::Object(map))
}

#[command]
pub fn delete_transaction(state: State<AppState>, id: Value) -> Result<Value, String> {
    execute_query(&state, "DELETE FROM transactions WHERE id = ?1", vec![id])
}

#[command]
pub fn get_transaction_by_id(state: State<AppState>, id: Value) -> Result<Vec<Value>, String> {
    select_query(&state, "SELECT * FROM transactions WHERE id = ?1", vec![id])
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
