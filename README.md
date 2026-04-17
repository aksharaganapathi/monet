# Monet

<p align="center">
  <img src="src/monet_logo.svg" alt="Monet logo" width="240" />
</p>

Monet is a desktop personal finance app built with Tauri, React, TypeScript, and Rust. The goal is simple: keep your money data local, make the dashboard feel calm instead of crowded, and give you useful financial context without turning the app into a spreadsheet.

## What Monet Does

Monet currently focuses on the core pieces of a private finance tracker:

- Track checking, savings, investment, and cash accounts
- Record, edit, and review transactions with search and date/category filters
- Flag transactions and surface recurring spending signals automatically
- Organize spending with categories and monthly budgets
- View a dashboard with net worth, cash flow, savings posture, and spending concentration
- Explore a dedicated insights page for trend analysis, cadence, and month-end forecast signals
- Protect access with password-derived encryption and optional Windows Hello unlock

Everything is designed around local-first use. Your database lives on your machine, and the app can still function without a cloud backend.

## Security Model

Security is a first-class concern in Monet.

- The SQLite database is encrypted with SQLCipher.
- The database key is derived from the user’s password (PBKDF2, 600,000 iterations) instead of being stored directly in plaintext.
- New and changed passwords must be at least 12 characters.
- Unlock attempts are hardened with exponential backoff and a hard lockout after too many failed tries.
- The vault auto-locks after 15 minutes of inactivity.
- Biometric unlock is optional and currently geared toward the Windows desktop flow.
- Biometric key material is protected locally using OS-level protection, and security-setting changes require password verification.
- Email-sync ingestion uses an asymmetric boundary: Monet stores the private key in SQLCipher and exports only a public key for background scripts.

If you are working on this repo, treat all locally generated app data as sensitive, even during development.

## Project Structure

- `src/`: React UI, state management, repositories, and page-level features
- `src-tauri/`: Rust commands, auth logic, encrypted database setup, and native integration
- `public/`: static assets for the frontend build

## Running Monet Locally

### Prerequisites

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)
- Tauri development prerequisites for your platform: [Tauri docs](https://tauri.app/start/prerequisites/)

### Install dependencies

```bash
npm install
```

### Start the desktop app in development

```bash
npm run tauri dev
```

### Build the frontend

```bash
npm run build
```

### Check the Rust side

```bash
cd src-tauri
cargo check
```

## Optional AI Monthly Summary

Monet includes a monthly summary widget on the dashboard.

- AI summaries are opt-in.
- AI key/model are resolved from environment variables.
- If AI is disabled or key/model configuration is missing, Monet falls back to a deterministic local summary.

Supported env vars:

- `GROQ_API_KEY`
- `GROQ_MODEL` (optional, defaults internally when omitted)

## Email Sync (Google OAuth)

Monet supports native Google OAuth from the desktop app.

1. Open Monet and unlock the vault.
2. Go to `Settings -> Email Sync`.
3. Click `Sign in with Google` and complete consent in your browser.

Credential resolution order:

1. `MONET_GOOGLE_CLIENT_ID` / `MONET_GOOGLE_CLIENT_SECRET`
2. local OAuth file (`client_secret_*.json` or `credentials.json`) in project root

- In debug runs, runtime environment values are read (including `.env` when present).
- In packaged builds, compile-time environment values are used as fallback.

### Background Sync Script (Encrypted Queue)

For local testing, use `sync_script.py` to pull Gmail messages and write encrypted `.enc` queue files.

```bash
pip install google-auth google-auth-oauthlib google-api-python-client cryptography
python sync_script.py --watch --interval 30
```

Key points:

- The script only uses Monet's **public key** (`monet_sync.pub`) to encrypt payloads.
- Monet decrypts with the **private key** stored in SQLCipher and imports queue files.
- Trusted domain filtering is enforced during Monet import using sender rules from `Settings -> Email Sync`.

## Notes For Developers

- The current biometric passkey relying party defaults to `localhost` during development.
- In debug builds, you can override passkey relying-party values with `MONET_RP_ID` and `MONET_RP_ORIGIN`.
- `MONET_RP_ID` and `MONET_RP_ORIGIN` must match each other and the actual app origin for passkey registration/auth to work.
- The displayed passkey name is generated from the Monet user name in the form `monet-<user_name>`.

## Why The App Feels This Way

Monet is intentionally opinionated:

- The dashboard should stay compact and readable.
- Deeper analysis belongs on a separate page instead of being stuffed into the home screen.
- Security-related UX should be explicit, calm, and hard to misuse.

That balance matters more here than adding every possible finance feature as fast as possible.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
