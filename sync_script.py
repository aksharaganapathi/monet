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
AMOUNT_RE = re.compile(r"(?:USD|US\$|\$)\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)")
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


def candidate_trusted_senders_paths() -> List[Path]:
    candidates: List[Path] = []

    env_value = os.getenv("MONET_TRUSTED_SENDERS_JSON")
    if env_value:
        candidates.append(Path(env_value))

    appdata = os.getenv("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "com.monet.finance" / "trusted_senders.json")

    local_appdata = os.getenv("LOCALAPPDATA")
    if local_appdata:
        candidates.append(Path(local_appdata) / "com.monet.finance" / "trusted_senders.json")

    home = Path.home()
    candidates.append(home / "AppData" / "Roaming" / "com.monet.finance" / "trusted_senders.json")

    candidates.append(Path.cwd() / "trusted_senders.json")
    candidates.append(Path("trusted_senders.json"))

    deduped: List[Path] = []
    seen = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def resolve_trusted_senders_path(arg_value: Optional[str]) -> Optional[Path]:
    if arg_value:
        requested = Path(arg_value)
        if requested.exists():
            return requested

    for candidate in candidate_trusted_senders_paths():
        if candidate.exists():
            return candidate

    return Path(arg_value) if arg_value else None


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
    value = abs(float(match.group(1).replace(",", "")))
    lowered = text.lower()

    income_hints = (
        "deposit",
        "refund",
        "reversal",
        "payment received",
        "credited to your",
        "cashback",
        "salary",
        "received",
    )
    expense_hints = (
        "purchase",
        "spent",
        "charged",
        "debited",
        "withdrawn",
        "bill payment",
        "payment sent",
        "paid",
    )

    if any(word in lowered for word in income_hints):
        return value
    if any(word in lowered for word in expense_hints):
        return -value

    # Default to expense for card alerts when direction is unclear.
    return -value


def parse_amount_from_sources(subject: str, snippet: str, body_text: str) -> Optional[float]:
    # Prefer subject/snippet to avoid matching unrelated footer amounts in long bodies.
    for source in (subject, snippet, f"{subject}\n{snippet}", body_text):
        amount = parse_amount(source)
        if amount is not None:
            return amount
    return None


def looks_like_transaction_email(text: str) -> bool:
    lowered = text.lower()

    anti_hints = (
        # Ignore Discover's duplicate secondary alert variants.
        "your discover card was used for a purchase online, by phone, or by mail",
        "a purchase was made online, by phone, or by mail",
    )

    if any(hint in lowered for hint in anti_hints):
        return False

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


def sender_is_trusted(sender_email: str, trusted_entries: List[str], debug: bool = False) -> bool:
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
                if debug:
                    print(f"[debug-ai] TRUSTED: {sender_email} matches entry {normalized}")
                return True
            continue
        domain = normalized.lstrip("@")
        if sender_domain == domain or sender_domain.endswith(f".{domain}"):
            if debug:
                print(f"[debug-ai] TRUSTED: {sender_email} (domain {sender_domain}) matches entry {domain}")
            return True

    if debug:
        print(f"[debug-ai] REJECTED: {sender_email} not in trusted list ({len(trusted_entries)} entries)")
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


def _canonical_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _note_redundant_with_merchant(note: str, merchant: str) -> bool:
    if not note or not merchant:
        return False

    note_norm = _canonical_text(note)
    merchant_norm = _canonical_text(merchant)
    if not note_norm or not merchant_norm:
        return False

    if note_norm == merchant_norm:
        return True

    if merchant_norm not in note_norm:
        return False

    remainder = note_norm.replace(merchant_norm, " ")
    remainder = re.sub(r"\s+", " ", remainder).strip()
    if not remainder:
        return True

    weak_tokens = {
        "a",
        "was",
        "made",
        "purchase",
        "purchased",
        "transaction",
        "alert",
        "payment",
        "card",
        "debit",
        "credit",
        "online",
        "store",
        "at",
        "from",
        "to",
        "for",
        "on",
    }
    tokens = [token for token in remainder.split() if token not in weak_tokens]
    return len(tokens) == 0


def _is_generic_note(note: str) -> bool:
    normalized = _canonical_text(note)
    if not normalized:
        return True

    generic_phrases = (
        "credit card transaction exceeds alert limit you set",
        "credit card purchase exceeds alert limit you set",
        "debit card transaction exceeds alert limit you set",
        "transaction exceeds alert limit you set",
        "a transaction above the limit you set has been initiated",
        "transaction alert",
        "account alert",
        "your statement is available",
        "a purchase was made online by phone or by mail",
        "was used for a purchase online by phone or by mail",
        "online bill payment over your requested alert limit",
        "no action is needed",
        "synced from email",
    )
    if any(phrase in normalized for phrase in generic_phrases):
        return True

    generic_tokens = {"alert", "transaction", "payment", "purchase", "card", "account"}
    tokens = [token for token in normalized.split() if token]
    if len(tokens) <= 3 and any(token in generic_tokens for token in tokens):
        return True

    return False


def _is_unhelpful_merchant(merchant: str) -> bool:
    normalized = _canonical_text(merchant)
    if not normalized:
        return True

    bad_phrases = (
        "transaction",
        "alert limit",
        "credit card",
        "debit card",
        "card ending",
        "online by phone or by mail",
        "no action is needed",
    )
    if any(phrase in normalized for phrase in bad_phrases):
        return True

    return len(normalized.split()) <= 1 and normalized in {"purchase", "payment", "transaction", "alert"}


def _extract_merchant_from_context(raw_context: Dict[str, Any]) -> str:
    sources = [
        str(raw_context.get("snippet", "")),
        str(raw_context.get("body_preview", "")),
        str(raw_context.get("subject", "")),
    ]

    regexes = [
        r"merchant\s*:\s*([^\n\r]+)",
        r"(?:purchase|payment|transaction|spent|charged|debited)\s+(?:at|from|to)\s+([^\n\r,.]+)",
        r"\b(?:at|from|to)\s+([A-Za-z0-9][A-Za-z0-9&'./\- ]{2,80})\s+(?:for|on|using|via|ending|\$|usd)",
    ]

    for source in sources:
        if not source:
            continue
        for regex in regexes:
            match = re.search(regex, source, flags=re.IGNORECASE)
            if not match:
                continue
            candidate = match.group(1)
            candidate = re.split(r"\bdate\s*:|\bamount\s*:|\bavailable\s+balance\b", candidate, maxsplit=1, flags=re.IGNORECASE)[0]
            candidate = re.sub(r"\s+", " ", candidate).strip(" .,:;|-")
            candidate = _clean_merchant_label(candidate[:120])
            if not candidate:
                continue
            if _is_unhelpful_merchant(candidate):
                continue
            return candidate

    return ""


def _clean_merchant_label(merchant: str) -> str:
    cleaned = re.sub(r"\s+", " ", merchant).strip(" .,:;|-")
    # Drop trailing store/location identifiers like "#25576" or "25576".
    cleaned = re.sub(r"\s+#?\d{3,8}$", "", cleaned).strip(" .,:;|-")
    if not cleaned:
        return ""
    if cleaned.upper() == cleaned:
        cleaned = cleaned.title()
    return cleaned[:120]


def _looks_like_bank_merchant(merchant: str) -> bool:
    normalized = _canonical_text(merchant)
    if not normalized:
        return False

    bank_markers = (
        "bank of america",
        "discover",
        "chase",
        "wells fargo",
        "capital one",
        "american express",
        "amex",
        "citibank",
        "citi",
        "us bank",
        "pnc",
    )
    return any(marker in normalized for marker in bank_markers)


def _fallback_note_from_context(merchant: str, amount: float, original: Dict[str, Any]) -> str:
    raw_context = original.get("raw_context") if isinstance(original.get("raw_context"), dict) else {}
    context_text = "\n".join(
        [
            str(raw_context.get("subject", "")),
            str(raw_context.get("snippet", "")),
            str(raw_context.get("body_preview", "")),
        ]
    ).lower()

    resolved_merchant = _clean_merchant_label(merchant)
    if not resolved_merchant or _looks_like_bank_merchant(resolved_merchant):
        extracted = _extract_merchant_from_context(raw_context)
        if extracted:
            resolved_merchant = _clean_merchant_label(extracted)

    if any(token in context_text for token in ("zelle", "venmo", "cash app", "cashapp", "paypal")):
        return f"P2P transfer via {resolved_merchant}" if resolved_merchant else "P2P transfer"

    if "bill payment" in context_text:
        return f"Bill payment to {resolved_merchant}" if resolved_merchant else "Bill payment"

    if amount < 0:
        return f"Card purchase at {resolved_merchant}" if resolved_merchant else "Card purchase"

    if amount > 0:
        return f"Deposit from {resolved_merchant}" if resolved_merchant else "Deposit"

    return "Account activity"


def choose_distinct_note(note: str, merchant: str, original: Dict[str, Any], amount: float) -> str:
    raw_context = original.get("raw_context") if isinstance(original.get("raw_context"), dict) else {}
    candidates = [
        note,
        str(raw_context.get("subject", "")),
        str(raw_context.get("snippet", "")),
        str(original.get("note", "")),
    ]

    for candidate in candidates:
        trimmed = re.sub(r"\s+", " ", candidate).strip()[:500]
        if not trimmed:
            continue
        if _is_generic_note(trimmed):
            continue
        if not _note_redundant_with_merchant(trimmed, merchant):
            return trimmed

    return _fallback_note_from_context(merchant, amount, original)


def call_groq_json(candidates: List[Dict[str, Any]], categories: List[str], model: str, api_key: str, debug: bool = False) -> Optional[List[Dict[str, Any]]]:
    prompt = {
        "task": "Normalize parsed bank transaction candidates into Monet transaction JSON.",
        "rules": [
            "Return only JSON array. No markdown.",
            "Each output object must contain: external_id, source_email, amount, date, note, merchant, category, account.",
            "CRITICAL: You MUST return exactly one output object for EVERY candidate provided. Do NOT drop or skip any candidates.",
            "CRITICAL: If the candidate is a job alert or non-financial newsletter, set its category to 'IGNORE'.",
            "CRITICAL: If the 'merchant' is the name of a bank (e.g., Bank of America, Chase), you MUST read the 'raw_context' to find the actual entity where the purchase or transfer was made.",
            "CRITICAL: Normalize 'merchant' names to their clean, recognizable brand names. Strip out store numbers, location codes, and corporate suffixes (e.g., 'WM SUPERCENTER #3482' or 'WAL-MART' MUST become just 'Walmart', 'AMZN Mktp' becomes 'Amazon').",
            "CRITICAL: For P2P transfers (Zelle, Venmo, CashApp, PayPal), set the 'merchant' to include the service name (e.g., 'Zelle'). Do NOT use just the person's name as the merchant.",
            "CRITICAL: If the 'note' is generic boilerplate (e.g., 'A credit card purchase...'), generate a clean, concise note describing the actual transaction based on the 'raw_context'.",
            "CRITICAL: The note must add context and MUST NOT repeat the merchant name verbatim with only generic words.",
            "date must be YYYY-MM-DD.",
            "category must be one of allowed_categories; use Other if uncertain.",
            "Preserve sign on amount (negative expense, positive income). Ensure 'credit card purchase' is a negative expense.",
            "Use account = Email Sync."
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

    if debug:
        print("\n--- AI REQUEST PAYLOAD ---")
        print(json.dumps(payload, indent=2))
        print("--------------------------\n")

    request = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Monet/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            resp_body = response.read().decode("utf-8")
            if debug:
                print("\n--- AI RESPONSE BODY ---")
                print(resp_body)
                print("------------------------\n")
            body = json.loads(resp_body)
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


def normalize_with_groq(transactions: List[Dict[str, Any]], categories: List[str], debug: bool = False) -> List[Dict[str, Any]]:
    api_key = (
        os.getenv("GROQ_API_KEY")
    )
    if not api_key:
        return transactions

    models = [
        "llama-3.3-70b-versatile",
    ]
    # Allow override from env
    env_model = os.getenv("GROQ_MODEL")
    if env_model:
        models = [env_model] + [m for m in models if m != env_model]

    # Process one candidate at a time to reduce malformed grouped outputs.
    BATCH_SIZE = 1
    all_enriched: List[Dict[str, Any]] = []

    for i in range(0, len(transactions), BATCH_SIZE):
        batch = transactions[i : i + BATCH_SIZE]
        enriched = None
        
        for model in models:
            if debug:
                print(f"Attempting normalization with model: {model}")
            try:
                enriched = call_groq_json(batch, categories, model, api_key, debug)
                if enriched:
                    break
            except Exception as e:
                if debug:
                    print(f"Model {model} failed: {e}")
                continue
        
        if enriched:
            all_enriched.extend(enriched)
        else:
            # If all models fail for this batch, keep original data
            all_enriched.extend(batch)

    if not all_enriched:
        return transactions

    enriched = all_enriched

    allowed = {c.lower(): c for c in categories}
    fallback_category = allowed.get("other", "Other")

    result: List[Dict[str, Any]] = []
    by_id = {tx.get("external_id", ""): tx for tx in transactions}
    enriched_by_id: Dict[str, Dict[str, Any]] = {}

    for item in enriched:
        if not isinstance(item, dict):
            continue

        ext = str(item.get("external_id", "")).strip()
        if not ext or ext not in by_id:
            continue
        enriched_by_id[ext] = item

    # Keep result cardinality stable: every parsed candidate yields one normalized output.
    for original in transactions:
        ext = str(original.get("external_id", "")).strip()
        if not ext:
            continue

        item = enriched_by_id.get(ext, original)

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

        note = choose_distinct_note(note, merchant, original, amount)

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
            "raw_context": original.get("raw_context", {}),
        }
        result.append(normalized)

    return result if result else transactions


def post_process_transactions(transactions: List[Dict[str, Any]], categories: List[str]) -> List[Dict[str, Any]]:
    allowed = {c.lower(): c for c in categories}
    fallback_category = allowed.get("other", "Other")

    result: List[Dict[str, Any]] = []
    for tx in transactions:
        if not isinstance(tx, dict):
            continue

        external_id = str(tx.get("external_id", "")).strip() or str(uuid.uuid4())
        source_email = normalize_sender(str(tx.get("source_email", "")))

        try:
            amount = float(tx.get("amount", 0.0))
        except Exception:
            amount = 0.0

        date = str(tx.get("date", "")).strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        raw_context = tx.get("raw_context") if isinstance(tx.get("raw_context"), dict) else {}
        merchant = _clean_merchant_label(str(tx.get("merchant", "")).strip())
        if not merchant or _looks_like_bank_merchant(merchant) or _is_unhelpful_merchant(merchant):
            merchant = _extract_merchant_from_context(raw_context)
        if not merchant:
            merchant = source_email.split("@", 1)[0].replace(".", " ").title() if "@" in source_email else "Unknown"

        note_seed = str(tx.get("note", "")).strip()[:500]
        note = choose_distinct_note(note_seed, merchant, tx, amount)

        category_raw = str(tx.get("category", "")).strip()
        category = allowed.get(category_raw.lower(), fallback_category)

        normalized = {
            "external_id": external_id,
            "source_email": source_email,
            "amount": amount,
            "date": date,
            "note": note or "Account activity",
            "merchant": merchant,
            "category": category,
            "account": "Email Sync",
        }
        result.append(normalized)

    return result


def is_current_month(date_iso: str) -> bool:
    current_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
    return date_iso.startswith(current_prefix)


def extract_transaction(message: Dict[str, Any], trusted_entries: List[str], debug: bool = False) -> Optional[Dict[str, Any]]:
    payload = message.get("payload", {})
    headers = payload.get("headers", [])

    sender_raw = extract_header(headers, "From")
    sender_email = normalize_sender(sender_raw)

    if not sender_is_trusted(sender_email, trusted_entries, debug):
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

    tx_date = parse_tx_date(date_header)
    raw_context = {
        "subject": subject,
        "snippet": snippet,
        "body_preview": body_text[:1200],
    }

    merchant = _extract_merchant_from_context(raw_context)
    if not merchant:
        merchant = sender_email.split("@")[0].replace(".", " ").title()

    note_seed = subject.strip() or snippet.strip() or ""
    note = choose_distinct_note(note_seed, merchant, {"raw_context": raw_context, "note": note_seed}, amount)

    return {
        "external_id": message.get("id") or str(uuid.uuid4()),
        "source_email": sender_email,
        "amount": amount,
        "date": tx_date,
        "note": note or "Account activity",
        "merchant": merchant,
        "category": "Other",
        "account": "Email Sync",
        "raw_context": raw_context,
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
    trusted_senders_path = resolve_trusted_senders_path(args.trusted_senders_json)
    if args.debug_ai and trusted_senders_path:
        print(f"[debug-ai] Using trusted senders from: {trusted_senders_path}")
        
    trusted_entries = load_trusted_entries(trusted_senders_path)
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

    if args.debug_ai:
        print(f"[debug-ai] Gmail returned {len(messages)} messages (max-results={args.max_results})")

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
        tx = extract_transaction(message, trusted_entries, debug=args.debug_ai)
        if not tx:
            continue
        if args.current_month_only and not is_current_month(tx.get("date", "")):
            continue
        parsed.append(tx)

    if not parsed:
        print("No transaction-like emails matched parsing rules for current month/trusted senders.")
        return 0

    if args.debug_ai:
        print(f"[debug-ai] Sending {len(parsed)} trusted transaction candidates to AI normalizer")

    normalized = normalize_with_groq(parsed, categories, debug=args.debug_ai)
    finalized = post_process_transactions(normalized, categories)
    cleaned = remove_internal_fields(finalized)

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
    parser.add_argument("--max-results", type=int, default=100, help="Max emails to inspect per run")
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
        "--debug-ai",
        action="store_true",
        help="Print raw AI requests and responses for debugging.",
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
