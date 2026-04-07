# Monet

<p align="center">
  <img src="src/monet_logo.svg" alt="Monet logo" width="240" />
</p>

Monet is a desktop personal finance app built with Tauri, React, TypeScript, and Rust. The goal is simple: keep your money data local, make the dashboard feel calm instead of crowded, and give you useful financial context without turning the app into a spreadsheet.

## What Monet Does

Monet currently focuses on the core pieces of a private finance tracker:

- Track checking and savings accounts
- Record and edit transactions
- Organize spending with categories
- View a dashboard with net worth, cash flow, spending mix, and month-end outlook
- Explore a dedicated insights page for deeper financial posture analysis
- Protect access with a password-derived database key
- Optionally unlock with Windows Hello / passkey-based biometrics

Everything is designed around local-first use. Your database lives on your machine, and the app can still function without a cloud backend.

## Security Model

Security is a first-class concern in Monet.

- The SQLite database is encrypted with SQLCipher.
- The database key is derived from the user’s password instead of being stored directly in plaintext.
- Biometric unlock is optional and currently geared toward the Windows desktop flow.
- Stored biometric/passkey material is protected locally at runtime rather than committed as raw credential JSON.
- Sensitive operations such as changing the password or enabling/disabling biometrics verify the current password before applying changes.

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

Monet includes a monthly summary widget on the dashboard. It can use Groq if credentials are available, and it falls back to a deterministic local summary when they are not.

Set these environment variables if you want the AI summary enabled:

```bash
set GROQ_API_KEY=your_groq_api_key
set GROQ_MODEL=llama-3.1-8b-instant
```

You can also store them in a local `.env` file at the project root.

## Notes For Developers

- The current biometric passkey relying party defaults to `localhost` during development.
- If you want a different passkey relying-party identity, configure `MONET_RP_ID` and `MONET_RP_ORIGIN` to a matching secure origin.
- The displayed passkey name is generated from the Monet user name in the form `monet-<user_name>`.

## Why The App Feels This Way

Monet is intentionally opinionated:

- The dashboard should stay compact and readable.
- Deeper analysis belongs on a separate page instead of being stuffed into the home screen.
- Security-related UX should be explicit, calm, and hard to misuse.

That balance matters more here than adding every possible finance feature as fast as possible.
