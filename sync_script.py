#!/usr/bin/env python3
"""Gmail -> encrypted sync queue producer for Monet.

Security model:
- This script only needs Monet's public key.
- It cannot decrypt previously produced payloads.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except Exception:
    print(
        "Missing dependency: cryptography. Install with: pip install cryptography",
        file=sys.stderr,
    )
    raise

try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
except Exception:
    print(
        "Missing Google dependencies. Install with: "
        "pip install google-auth google-auth-oauthlib google-api-python-client",
        file=sys.stderr,
    )
    raise

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
AMOUNT_RE = re.compile(r"(?:USD|US\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)")
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")


def load_env_file_if_present(path: Path) -> None:
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


def find_default_credentials_file() -> Optional[Path]:
    # Restrict discovery to the current script directory only
    script_dir = Path(__file__).parent
    candidates = sorted(script_dir.glob("client_secret_*.json"))
    if candidates:
        return candidates[0]
    fallback = script_dir / "credentials.json"
    return fallback if fallback.exists() else None


def candidate_public_key_paths() -> List[Path]:
    candidates: List[Path] = []

    for env_name in ("MONET_SYNC_PUBLIC_KEY", "MONET_PUBLIC_KEY_PATH"):
        env_value = os.getenv(env_name)
        if env_value:
            candidates.append(Path(env_value))

    appdata = os.getenv("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "com.monet.finance" / "monet_sync.pub")

    local_appdata = os.getenv("LOCALAPPDATA")
    if local_appdata:
        candidates.append(Path(local_appdata) / "com.monet.finance" / "monet_sync.pub")

    home = Path.home()
    candidates.append(home / "AppData" / "Roaming" / "com.monet.finance" / "monet_sync.pub")

    candidates.append(Path.cwd() / "monet_sync.pub")
    candidates.append(Path("monet_sync.pub"))

    deduped: List[Path] = []
    seen = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def resolve_public_key_path(arg_value: str) -> Path:
    requested = Path(arg_value)
    if requested.exists():
        return requested

    if arg_value != "monet_sync.pub":
        return requested

    for candidate in candidate_public_key_paths():
        if candidate.exists():
            return candidate

    return requested


def decode_b64url(data: str) -> str:
    padded = data + "=" * ((4 - len(data) % 4) % 4)
    raw = base64.urlsafe_b64decode(padded.encode("utf-8"))
    return raw.decode("utf-8", errors="ignore")


def extract_header(headers: Iterable[Dict[str, str]], name: str) -> str:
    lname = name.lower()
    for header in headers:
        if header.get("name", "").lower() == lname:
            return header.get("value", "")
    return ""


def extract_body_text(part: Dict[str, Any]) -> str:
    mime_type = (part.get("mimeType") or "").lower()
    body_data = (part.get("body") or {}).get("data")

    if body_data and mime_type in {"text/plain", "text/html", ""}:
        return decode_b64url(body_data)

    text_segments: List[str] = []
    for child in part.get("parts", []) or []:
        text_segments.append(extract_body_text(child))
    return "\n".join(seg for seg in text_segments if seg)


def normalize_sender(sender_raw: str) -> str:
    match = EMAIL_RE.search(sender_raw)
    return (match.group(0) if match else sender_raw).strip().lower()


def parse_tx_date(header_value: str) -> str:
    if not header_value:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        parsed = parsedate_to_datetime(header_value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def parse_amount(text: str) -> Optional[float]:
    match = AMOUNT_RE.search(text)
    if not match:
        return None
    value = float(match.group(1).replace(",", ""))
    lowered = text.lower()
    if any(word in lowered for word in ("credit", "deposit", "refund", "reversal", "received")):
        return value
    return -value


def parse_amount_from_sources(subject: str, snippet: str, body_text: str) -> Optional[float]:
    # Prefer subject/snippet to avoid matching unrelated footer amounts in long bodies.
    for source in (subject, snippet, f"{subject}\n{snippet}", body_text):
        amount = parse_amount(source)
        if amount is not None:
            return amount
    return None


def guess_category(text: str) -> str:
    lowered = text.lower()
    if any(word in lowered for word in ("grocery", "supermarket", "walmart", "target")):
        return "Groceries"
    if any(word in lowered for word in ("uber", "lyft", "transport", "fuel", "gas", "shell", "chevron")):
        return "Transport"
    if any(word in lowered for word in ("restaurant", "dining", "cafe", "food", "starbucks", "mcdonald")):
        return "Dining"
    if any(word in lowered for word in ("salary", "payroll", "income", "deposit", "direct dep")):
        return "Salary"
    if any(word in lowered for word in ("rent", "mortgage", "housing")):
        return "Rent"
    if any(word in lowered for word in ("electric", "water", "utility", "internet", "comcast", "verizon")):
        return "Utilities"
    return "Other"


def clean_merchant_name(candidate: str) -> str:
    cleaned = re.sub(r"\s+", " ", candidate).strip(" .,:;|-")
    if not cleaned:
        return ""
    return cleaned[:120]


def merchant_from_sender(sender_email: str) -> Optional[str]:
    if "@" not in sender_email:
        return None
    domain = sender_email.split("@", 1)[1].lower()
    labels = [label for label in domain.split(".") if label and label not in {"com", "org", "net", "co", "in", "io", "app"}]
    if not labels:
        return None
    noisy = {"mail", "alerts", "alert", "no", "noreply", "notify", "notification", "updates", "transactions", "banking", "secure"}
    core = [label for label in labels if label not in noisy] or labels
    value = " ".join(core[:2]).replace("-", " ")
    title = " ".join(part.capitalize() for part in value.split() if part)
    return clean_merchant_name(title) or None


def extract_merchant(subject: str, snippet: str, body_text: str, sender_email: str) -> Optional[str]:
    source = " ".join([subject, snippet, body_text[:500]]).strip()
    patterns = [
        r"(?:at|from|to)\s+([A-Za-z0-9&'./ -]{3,60})(?:\s+on\s|\s+for\s|\.|,|$)",
        r"merchant\s*[:\-]\s*([A-Za-z0-9&'./ -]{3,60})",
        r"paid\s+to\s+([A-Za-z0-9&'./ -]{3,60})(?:\.|,|$)",
    ]

    for pattern in patterns:
        match = re.search(pattern, source, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = clean_merchant_name(match.group(1))
        if candidate and not re.fullmatch(r"(?i)(card|account|bank|transaction|payment)", candidate):
            return candidate

    return merchant_from_sender(sender_email)


def looks_like_transaction_email(text: str) -> bool:
    lowered = text.lower()
    hints = (
        "transaction",
        "txn",
        "spent",
        "purchase",
        "charged",
        "debited",
        "credited",
        "withdrawn",
        "deposit",
        "payment",
        "received",
        "upi",
        "pos",
        "card ending",
    )
    return any(hint in lowered for hint in hints)


def sender_is_trusted(sender_email: str, trusted_entries: List[str]) -> bool:
    if not trusted_entries:
        return True

    sender_email = normalize_sender(sender_email)
    sender_domain = sender_email.split("@", 1)[1] if "@" in sender_email else ""

    for entry in trusted_entries:
        normalized = entry.strip().lower()
        if not normalized:
            continue
        if "@" in normalized:
            if sender_email == normalized:
                return True
            continue
        domain = normalized.lstrip("@")
        if sender_domain == domain or sender_domain.endswith(f".{domain}"):
            return True

    return False


def load_trusted_entries(path: Optional[Path]) -> List[str]:
    if not path or not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw]


def ensure_credentials(credentials_path: Optional[Path], token_path: Path) -> Credentials:
    creds: Optional[Credentials] = None

    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not credentials_path or not credentials_path.exists():
                raise FileNotFoundError(
                    "Google credentials JSON not found. Provide --credentials or place client_secret_*.json in repo root."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
            creds = flow.run_local_server(port=0)

        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(creds.to_json(), encoding="utf-8")

    return creds


def get_category_options() -> List[str]:
    return [
        "Salary", "Freelance", "Investment", "Income", "Groceries",
        "Dining", "Transport", "Shopping", "Healthcare", "Rent",
        "Utilities", "Entertainment", "Travel", "Transfer", "Other"
    ]


def parse_json_from_text(text: str) -> Optional[Any]:
    raw = text.strip()
    if not raw:
        return None

    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

    try:
        return json.loads(raw)
    except Exception:
        pass

    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except Exception:
            return None
    return None


def call_groq_json(candidates: List[Dict[str, Any]], categories: List[str], model: str, api_key: str) -> Optional[List[Dict[str, Any]]]:
    prompt = {
        "task": "Normalize parsed bank transaction candidates into Monet transaction JSON.",
        "rules": [
            "Return only JSON array. No markdown.",
            "Each output object must contain: external_id, source_email, amount, date, note, merchant, category, account.",
            "date must be YYYY-MM-DD.",
            "category must be one of allowed_categories; use Other if uncertain.",
            "Preserve sign on amount (negative expense, positive income).",
            "Use account = Email Sync.",
            "Preserve original note/category unless there is strong evidence to improve them.",
            "Do not invent transactions.",
        ],
        "allowed_categories": categories,
        "candidates": candidates,
    }

    payload = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": "You are a strict financial data normalizer. Output valid JSON only.",
            },
            {
                "role": "user",
                "content": (
                    "Return JSON object with key \"transactions\" as an array of normalized transactions. "
                    f"Input:\n{json.dumps(prompt, separators=(',', ':'))}"
                ),
            },
        ],
    }

    request = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="ignore")
        print(f"Groq HTTP error: {exc.code} {details}", file=sys.stderr)
        return None
    except Exception as exc:
        print(f"Groq request failed: {exc}", file=sys.stderr)
        return None

    content = (
        body.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )

    parsed = parse_json_from_text(content)
    if not isinstance(parsed, dict):
        return None

    txns = parsed.get("transactions")
    if not isinstance(txns, list):
        return None
    return txns


def normalize_with_groq(transactions: List[Dict[str, Any]], categories: List[str]) -> List[Dict[str, Any]]:
    api_key = (
        os.getenv("MONET_GROQ_API_KEY")
        or os.getenv("GROQ_API_KEY")
        or os.getenv("MONET_AI_API_KEY")
    )
    if not api_key:
        return transactions

    model = os.getenv("MONET_GROQ_MODEL") or os.getenv("GROQ_MODEL") or "llama-3.1-8b-instant"

    enriched = call_groq_json(transactions, categories, model, api_key)
    if not enriched:
        return transactions

    allowed = {c.lower(): c for c in categories}
    fallback_category = allowed.get("other", "Other")

    result: List[Dict[str, Any]] = []
    by_id = {tx.get("external_id", ""): tx for tx in transactions}

    for item in enriched:
        if not isinstance(item, dict):
            continue

        ext = str(item.get("external_id", "")).strip()
        if not ext or ext not in by_id:
            continue

        original = by_id[ext]

        category_raw = str(item.get("category", "")).strip()
        category = allowed.get(category_raw.lower(), fallback_category)

        amount = item.get("amount", original.get("amount"))
        try:
            amount = float(amount)
        except Exception:
            amount = float(original.get("amount", 0.0))

        date = str(item.get("date", original.get("date", ""))).strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            date = str(original.get("date", ""))

        note = str(item.get("note", original.get("note", "Synced from email"))).strip()[:500]
        if not note:
            note = str(original.get("note", "Synced from email")).strip()[:500]

        merchant = str(item.get("merchant", original.get("merchant", ""))).strip()[:120]
        if not merchant:
            merchant = str(original.get("merchant", "")).strip()[:120]

        if category == "Other" and str(original.get("category", "")) not in {"", "Other"}:
            category = str(original.get("category"))

        normalized = {
            "external_id": ext,
            "source_email": str(original.get("source_email", "")).strip().lower(),
            "amount": amount,
            "date": date,
            "note": note or "Synced from email",
            "merchant": merchant,
            "category": category,
            "account": "Email Sync",
        }
        result.append(normalized)

    return result if result else transactions


def is_current_month(date_iso: str) -> bool:
    current_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
    return date_iso.startswith(current_prefix)


def extract_transaction(message: Dict[str, Any], trusted_entries: List[str]) -> Optional[Dict[str, Any]]:
    payload = message.get("payload", {})
    headers = payload.get("headers", [])

    sender_raw = extract_header(headers, "From")
    sender_email = normalize_sender(sender_raw)

    if not sender_is_trusted(sender_email, trusted_entries):
        return None

    subject = extract_header(headers, "Subject")
    date_header = extract_header(headers, "Date")
    body_text = extract_body_text(payload)
    snippet = message.get("snippet", "")

    combined = "\n".join([subject, snippet, body_text])
    if not looks_like_transaction_email(combined):
        return None

    amount = parse_amount_from_sources(subject, snippet, body_text)
    if amount is None:
        return None

    note = subject.strip() or snippet.strip() or "Synced from email"
    merchant = extract_merchant(subject, snippet, body_text, sender_email)
    tx_date = parse_tx_date(date_header)

    return {
        "external_id": message.get("id") or str(uuid.uuid4()),
        "source_email": sender_email,
        "amount": amount,
        "date": tx_date,
        "note": note[:500],
        "merchant": merchant or "",
        "category": guess_category(combined),
        "account": "Email Sync",
        "raw_context": {
            "subject": subject,
            "snippet": snippet,
            "body_preview": body_text[:1200],
        },
    }


def encrypt_payload(transactions: List[Dict[str, Any]], public_key_path: Path) -> Dict[str, str]:
    public_key = serialization.load_pem_public_key(public_key_path.read_bytes())

    data = json.dumps(transactions, separators=(",", ":")).encode("utf-8")
    aes_key = os.urandom(32)
    nonce = os.urandom(12)

    ciphertext = AESGCM(aes_key).encrypt(nonce, data, None)
    encrypted_key = public_key.encrypt(
        aes_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )

    return {
        "encrypted_key": base64.b64encode(encrypted_key).decode("utf-8"),
        "nonce": base64.b64encode(nonce).decode("utf-8"),
        "ciphertext": base64.b64encode(ciphertext).decode("utf-8"),
    }


def write_encrypted_blob(envelope: Dict[str, str], queue_dir: Path) -> Path:
    queue_dir.mkdir(parents=True, exist_ok=True)

    file_id = f"sync_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex}"
    tmp_path = queue_dir / f"{file_id}.tmp"
    out_path = queue_dir / f"{file_id}.enc"

    tmp_path.write_text(json.dumps(envelope, separators=(",", ":")), encoding="utf-8")
    tmp_path.replace(out_path)
    return out_path


def remove_internal_fields(transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    for tx in transactions:
        copied = {k: v for k, v in tx.items() if k != "raw_context"}
        cleaned.append(copied)
    return cleaned


def sync_once(args: argparse.Namespace) -> int:
    load_env_file_if_present(Path(".env"))

    credentials_path = Path(args.credentials) if args.credentials else find_default_credentials_file()
    token_path = Path(args.token)
    if (not credentials_path or not credentials_path.exists()) and not token_path.exists():
        raise FileNotFoundError(
            "Google credentials JSON not found. Provide --credentials or place client_secret_*.json in repo root."
        )

    public_key_path = resolve_public_key_path(args.public_key)
    if not public_key_path.exists():
        fallback_note = ""
        appdata = os.getenv("APPDATA")
        if appdata:
            fallback_note = f" Expected Monet key at {Path(appdata) / 'com.monet.finance' / 'monet_sync.pub'}."
        raise FileNotFoundError(
            f"Public key not found at {public_key_path}. Use the path shown by Monet after Google connect, or pass --public-key.{fallback_note}"
        )

    queue_dir = Path(args.queue_dir)
    trusted_entries = load_trusted_entries(Path(args.trusted_senders_json) if args.trusted_senders_json else None)
    categories = get_category_options()

    creds = ensure_credentials(credentials_path, token_path)
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)

    msg_list = (
        service.users()
        .messages()
        .list(userId="me", q=args.query, maxResults=args.max_results)
        .execute()
    )
    messages = msg_list.get("messages", [])

    if not messages:
        print("No Gmail messages matched the current query.")
        return 0

    parsed: List[Dict[str, Any]] = []
    for msg in messages:
        message = (
            service.users()
            .messages()
            .get(userId="me", id=msg["id"], format="full")
            .execute()
        )
        tx = extract_transaction(message, trusted_entries)
        if not tx:
            continue
        if args.current_month_only and not is_current_month(tx.get("date", "")):
            continue
        parsed.append(tx)

    if not parsed:
        print("No transaction-like emails matched parsing rules for current month/trusted senders.")
        return 0

    normalized = normalize_with_groq(parsed, categories)
    cleaned = remove_internal_fields(normalized)

    envelope = encrypt_payload(cleaned, public_key_path)
    out_file = write_encrypted_blob(envelope, queue_dir)
    print(f"Wrote {len(cleaned)} transactions to encrypted queue file: {out_file}")
    return len(cleaned)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Monet Gmail encrypted sync producer")
    parser.add_argument("--credentials", help="Path to Google OAuth client JSON")
    parser.add_argument("--token", default="token.json", help="Path to OAuth token cache JSON")
    parser.add_argument(
        "--public-key",
        default="monet_sync.pub",
        help="Path to Monet public key PEM (monet_sync.pub)",
    )
    parser.add_argument(
        "--queue-dir",
        default="sync_queue",
        help="Directory where encrypted .enc files are written",
    )
    parser.add_argument(
        "--trusted-senders-json",
        help="Optional JSON array file of trusted emails/domains for producer-side filtering",
    )
    parser.add_argument(
        "--query",
        default="newer_than:31d",
        help="Gmail search query",
    )
    parser.add_argument("--max-results", type=int, default=50, help="Max emails to inspect per run")
    parser.add_argument("--config", type=str, help="Path to a JSON configuration file")
    parser.add_argument("--watch", action="store_true", help="Run continuously")
    parser.add_argument("--interval", type=int, default=30, help="Watch interval in seconds")
    parser.add_argument(
        "--current-month-only",
        action="store_true",
        default=True,
        help="Only include transactions from current month (default).",
    )
    parser.add_argument(
        "--all-months",
        action="store_false",
        dest="current_month_only",
        help="Disable current-month-only filter.",
    )
    return parser


def main() -> int:
    parser = parse_args()
    args = parser.parse_args()

    # If a config file is provided, override defaults and CLI args
    if args.config:
        config_path = Path(args.config)
        if config_path.exists():
            try:
                config_data = json.loads(config_path.read_text(encoding="utf-8"))
                for key, value in config_data.items():
                    # Map config keys to arg names if different, otherwise set directly
                    setattr(args, key.replace("-", "_"), value)
            except Exception as e:
                print(f"Error loading config file: {e}", file=sys.stderr)

    if not args.watch:
        sync_once(args)
        return 0

    print(f"Starting watch mode. Polling every {args.interval} seconds...")
    while True:
        try:
            sync_once(args)
        except Exception as exc:
            print(f"Sync iteration failed: {exc}", file=sys.stderr)
        time.sleep(max(args.interval, 1))


if __name__ == "__main__":
    raise SystemExit(main())
