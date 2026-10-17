#!/usr/bin/env python3
"""Fetch market prices from public TGJU profile pages without a paid API."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "market-rates.json"
BASE = "https://www.tgju.org/profile/"
TIMEOUT = 18
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ArtinMarketPriceBot/1.0; +https://github.com/ArtinBamooei/Artin-to-do-list)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.7",
}
ITEMS = {
    "usd": {"label": "دلار آزاد", "slug": "price_dollar_rl", "unit": "تومان"},
    "gold": {"label": "طلای ۱۸ عیار", "slug": "geram18", "unit": "تومان / گرم"},
    "eur": {"label": "یورو", "slug": "price_eur", "unit": "تومان"},
    "oil": {"label": "نفت برنت", "slug": "energy-brent-oil", "unit": "دلار / بشکه", "oil": True},
}

def latin_digits(value: str) -> str:
    return value.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))

class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"script", "style", "noscript", "svg"}:
            self.hidden += 1
    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"} and self.hidden:
            self.hidden -= 1
        if tag in {"tr", "td", "th", "p", "div", "h1", "h2", "h3", "li", "br"}:
            self.parts.append("\n")
    def handle_data(self, data):
        if not self.hidden:
            text = " ".join(data.split())
            if text:
                self.parts.append(text)

def parse_price(page: str, item: dict) -> tuple[float, str | None]:
    parser = TextExtractor()
    parser.feed(page)
    text = latin_digits("".join(parser.parts))
    # Prefer the explicit current-rate field, not historical/previous-day rows.
    matches = list(re.finditer(r"نرخ\s*فعلی\s*:?\s*([0-9][0-9,٬،.]*)(?:\s*[-−—])?", text))
    if not matches:
        # Some TGJU profiles expose the current value only in the overview table.
        m = re.search(r"نرخ\s*فعلی\s+([0-9][0-9,٬،.]*)", text)
        if m:
            matches = [m]
    price = None
    for match in matches:
        raw = re.sub(r"[,٬،]", "", match.group(1))
        try:
            number = float(raw)
        except ValueError:
            continue
        if number > 0:
            price = number
            break
    if price is None:
        raise ValueError("Could not identify a positive current price in TGJU page")
    # The page's profile metadata often includes a source update label; keep it
    # separate from fetchedAt so the UI never confuses fetch time with quote time.
    source_time = None
    m = re.search(r"زمان\s+ثبت\s+آخرین\s+نرخ\s*([^\n]{1,45})", text)
    if m:
        source_time = m.group(1).strip(" :-")
    # Keep TGJU's raw quote. The frontend converts rial-denominated markets to toman.
    return price, source_time or None

def load_existing() -> dict:
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"source": "TGJU", "checkedAt": None, "scheduleMinutes": 5, "successfulItems": [], "failedItems": {}, "items": {}}

def main() -> None:
    data = load_existing()
    data.setdefault("source", "TGJU")
    data.setdefault("items", {})
    data.setdefault("successfulItems", [])
    data.setdefault("failedItems", {})
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    successes = 0
    errors = {}
    for key, item in ITEMS.items():
        url = BASE + item["slug"]
        try:
            req = Request(url, headers=HEADERS)
            with urlopen(req, timeout=TIMEOUT) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}")
                page = response.read().decode("utf-8", errors="replace")
            price, source_time = parse_price(page, item)
            # Basic sanity limits guard against accidentally scraping a wrong field.
            if item.get("oil") and not (10 <= price <= 300):
                raise ValueError(f"Brent price outside sanity bounds: {price}")
            if key == "gold" and not (100_000 <= price <= 1_000_000_000):
                raise ValueError(f"Gold price outside sanity bounds: {price}")
            if key in {"usd", "eur"} and not (1_000 <= price <= 100_000_000):
                raise ValueError(f"FX price outside sanity bounds: {price}")
            previous = data["items"].get(key, {})
            # Refuse extreme jumps; keep the last known quote and report the scrape error.
            old = previous.get("price")
            if isinstance(old, (int, float)) and old > 0 and abs(price - old) / old > 0.45:
                raise ValueError("Price changed by more than 45%; refusing suspicious update")
            data["items"][key] = {
                "label": item["label"],
                "price": round(price, 4 if item.get("oil") else 2),
                "unit": item["unit"],
                "source": "TGJU",
                "sourceUrl": url,
                "sourceDate": source_time,
                "fetchedAt": fetched_at,
                "stale": False,
            }
            successes += 1
            print(f"OK {key}: {price} ({source_time or 'source time unavailable'})")
        except Exception as exc:
            errors[key] = str(exc)
            print(f"ERROR {key}: {exc}")
            # Preserve old quote and its original fetchedAt; the UI can mark it stale.
            if key in data["items"]:
                data["items"][key]["stale"] = True
                data["items"][key]["lastError"] = str(exc)[:180]
    data["checkedAt"] = fetched_at if successes else data.get("checkedAt")
    data["lastAttemptAt"] = fetched_at
    data["scheduleMinutes"] = 5
    data["successfulItems"] = [key for key in ITEMS if key in data["items"] and key not in errors]
    data["failedItems"] = errors
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Partial successes are useful, but fail the job when all upstream pages fail.
    if successes == 0:
        raise SystemExit("All TGJU pages failed; retained last known data.")

if __name__ == "__main__":
    main()
