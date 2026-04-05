use rusqlite::params_from_iter;
use serde_json::{Map, Value};
use tauri::{State, AppHandle, command};
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

// ------ Settings/DB Init ------

#[command]
pub fn initialize_db(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    crate::open_db(&state, &app)
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
    execute_query(&state, "INSERT INTO accounts (name, type, balance, institution) VALUES (?1, ?2, ?3, ?4)", vec![name, type_, balance, institution])
}

#[command]
pub fn update_account(state: State<AppState>, id: Value, name: Value, type_: Value, institution: Value) -> Result<Value, String> {
    execute_query(&state, "UPDATE accounts SET name = ?1, type = ?2, institution = ?3, updated_at = datetime('now') WHERE id = ?4", vec![name, type_, institution, id])
}

#[command]
pub fn update_account_balance(state: State<AppState>, id: Value, delta: Value) -> Result<Value, String> {
    execute_query(&state, "UPDATE accounts SET balance = balance + ?1, updated_at = datetime('now') WHERE id = ?2", vec![delta, id])
}

#[command]
pub fn delete_account(state: State<AppState>, id: Value) -> Result<Value, String> {
    execute_query(&state, "DELETE FROM transactions WHERE account_id = ?1", vec![id.clone()])?;
    execute_query(&state, "DELETE FROM accounts WHERE id = ?1", vec![id])
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
    execute_query(&state, "INSERT INTO transactions (amount, category_id, account_id, date, note) VALUES (?1, ?2, ?3, ?4, ?5)", vec![amount, category_id, account_id, date, note])
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
