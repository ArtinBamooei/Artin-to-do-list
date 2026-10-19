#!/usr/bin/env python3
"""Reliable, validated TGJU market snapshot scraper."""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "market-rates.json"
TIMEOUT = (8, 18)
MIN_PAGE_BYTES = 5000
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ArtinMarketSnapshot/2.0; +https://github.com/ArtinBamooei/Artin-to-do-list)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.7",
}
SOURCES = {
    "usd": {"url": "https://www.tgju.org/profile/price_dollar_rl", "min": 10000, "max": 100000000, "max_jump": 0.45},
    "eur": {"url": "https://www.tgju.org/profile/price_eur", "min": 10000, "max": 100000000, "max_jump": 0.45},
    "gold": {"url": "https://www.tgju.org/profile/geram18", "min": 1000000, "max": 10000000000, "max_jump": 0.45},
    "oil": {"url": "https://www.tgju.org/profile/energy-brent-oil", "min": 10, "max": 300, "max_jump": 0.40},
}
LABEL_CURRENT = "نرخ فعلی"
LABEL_TIME = "زمان ثبت آخرین نرخ"
DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
CURRENT_RATE_RE = re.compile(
    r"نرخ\s*فعلی\s*[:：]?\s*([0-9][0-9,٬،٫.\u00a0\u202f ]{0,40})"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.translate(DIGITS).replace("\u00a0", " ").replace("\u202f", " ")).strip()


def parse_number(value: str) -> float | None:
    """Parse TGJU numbers with Latin/Persian/Arabic digits and separators."""
    value = normalize_text(value)
    value = value.replace(",", "").replace("٬", "").replace("،", "").replace("٫", ".")
    match = re.search(r"(?<![\w])\d+(?:\.\d+)?", value)
    if not match:
        return None
    try:
        number = float(match.group(0))
    except ValueError:
        return None
    return number if number > 0 else None


def make_session() -> requests.Session:
    retry = Retry(
        total=2,
        connect=2,
        read=2,
        status=2,
        backoff_factor=0.6,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    session = requests.Session()
    session.headers.update(HEADERS)
    adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=4)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def extract_quote(html: str, config: dict[str, Any]) -> tuple[float, str | None]:
    """Prefer a table cell explicitly labelled 'current rate'; use text as fallback."""
    soup = BeautifulSoup(html, "html.parser")
    candidates: list[str] = []
    source_time: str | None = None

    for row in soup.find_all("tr"):
        cells = row.find_all(["td", "th"], recursive=False)
        if len(cells) < 2:
            cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue
        label = normalize_text(cells[0].get_text(" ", strip=True))
        value_text = cells[1].get_text(" ", strip=True)
        if LABEL_TIME in label and source_time is None:
            source_time = normalize_text(value_text)[:60] or None
        if LABEL_CURRENT in label:
            candidates.append(value_text)

    # Some page variants show the current rate outside the summary table.
    if not candidates:
        visible_text = soup.get_text(" ", strip=True)
        candidates.extend(match.group(1) for match in CURRENT_RATE_RE.finditer(normalize_text(visible_text)))

    for candidate in candidates:
        price = parse_number(candidate)
        if price is not None and config["min"] <= price <= config["max"]:
            return price, source_time

    raise ValueError("Could not identify a plausible current rate labelled 'نرخ فعلی'")


def load_existing() -> dict[str, Any]:
    try:
        data = json.loads(OUT.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("items"), dict):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {
        "source": "TGJU",
        "checkedAt": None,
        "scheduleMinutes": 5,
        "successfulItems": [],
        "failedItems": {},
        "items": {},
    }


def _previous_quote_is_recent(row: dict[str, Any], now: datetime) -> bool:
    try:
        parsed = datetime.fromisoformat(str(row.get("fetchedAt", "")).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        age = (now - parsed.astimezone(timezone.utc)).total_seconds()
        return 0 <= age <= 6 * 60 * 60
    except (TypeError, ValueError):
        return False


def scrape_one(session: requests.Session, key: str, config: dict[str, Any]) -> dict[str, Any]:
    response = session.get(config["url"], timeout=TIMEOUT)
    response.raise_for_status()
    if len(response.content) < MIN_PAGE_BYTES:
        raise ValueError("TGJU response is too short; possible block or incomplete page")
    response.encoding = response.apparent_encoding or "utf-8"
    price, source_date = extract_quote(response.text, config)
    return {
        "price": round(price, 4 if key == "oil" else 2),
        "unit": "USD/barrel" if key == "oil" else "IRR",
        "source": "TGJU",
        "sourceUrl": config["url"],
        "sourceDate": source_date,
        "fetchedAt": utc_now(),
        "stale": False,
    }


def write_snapshot(data: dict[str, Any]) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT.with_suffix(OUT.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(OUT)


def main() -> int:
    data = load_existing()
    items = data.setdefault("items", {})
    if not isinstance(items, dict):
        items = {}
        data["items"] = items

    attempt_at = utc_now()
    attempt_dt = datetime.fromisoformat(attempt_at.replace("Z", "+00:00"))
    session = make_session()
    successes: list[str] = []
    failures: dict[str, str] = {}

    try:
        for key, config in SOURCES.items():
            previous = items.get(key, {})
            try:
                fresh = scrape_one(session, key, config)
                old_price = previous.get("price") if isinstance(previous, dict) else None
                if (
                    isinstance(old_price, (int, float))
                    and old_price > 0
                    and _previous_quote_is_recent(previous, attempt_dt)
                    and abs(fresh["price"] - old_price) / old_price > config["max_jump"]
                ):
                    raise ValueError("Suspicious price jump; last known value retained")
                fresh["label"] = {
                    "usd": "دلار آزاد",
                    "eur": "یورو",
                    "gold": "طلای ۱۸ عیار",
                    "oil": "نفت برنت",
                }[key]
                items[key] = fresh
                successes.append(key)
                print("OK {}: {} ({})".format(key, fresh["price"], fresh.get("sourceDate") or "source time unavailable"))
            except Exception as exc:
                message = "{}: {}".format(type(exc).__name__, exc)[:180]
                failures[key] = message
                print("ERROR {}: {}".format(key, message), file=sys.stderr)
                if isinstance(previous, dict) and previous:
                    previous["stale"] = True
                    previous["lastError"] = message
                    previous["lastAttemptAt"] = attempt_at
                    items[key] = previous
    finally:
        session.close()

    data["source"] = "TGJU"
    data["lastAttemptAt"] = attempt_at
    data["scheduleMinutes"] = 5
    data["successfulItems"] = successes
    data["failedItems"] = failures
    # checkedAt is the most recent successful scrape, never a failed attempt.
    if successes:
        successful_times = [items[key].get("fetchedAt") for key in successes if items.get(key, {}).get("fetchedAt")]
        data["checkedAt"] = max(successful_times) if successful_times else attempt_at
    # Write even when every source fails so the UI can report the failed attempt
    # while retaining the last valid prices and their original timestamps.
    write_snapshot(data)
    print("Updated {}/{} prices.".format(len(successes), len(SOURCES)))
    return 0 if successes else 1


if __name__ == "__main__":
    raise SystemExit(main())
