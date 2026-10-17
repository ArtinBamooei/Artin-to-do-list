#!/usr/bin/env python3
"""Scrape public TGJU profile pages and maintain the public JSON snapshot."""
from __future__ import annotations
import json, os, re, sys, time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "market-rates.json"
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ArtinMarketSnapshot/1.0; +https://github.com/ArtinBamooei/Artin-to-do-list)",
    "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.7",
}
SOURCES = {
    "usd": {"url": "https://www.tgju.org/profile/price_dollar_rl", "min": 10000, "max": 100000000},
    "eur": {"url": "https://www.tgju.org/profile/price_eur", "min": 10000, "max": 100000000},
    "gold": {"url": "https://www.tgju.org/profile/geram18", "min": 1000000, "max": 10000000000},
    "oil": {"url": "https://www.tgju.org/profile/energy-brent-oil", "min": 10, "max": 2000},
}
DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

def clean_text(node):
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).translate(DIGITS)

def number(text):
    text = text.translate(DIGITS).replace(",", "").replace("٬", "").replace("٫", ".")
    match = re.search(r"(?<![\w])\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else None

def scrape(item, config):
    response = requests.get(config["url"], headers=HEADERS, timeout=25)
    response.raise_for_status()
    if len(response.text) < 10000:
        raise ValueError("TGJU response is unexpectedly short")
    soup = BeautifulSoup(response.text, "html.parser")
    price = None
    source_date = None

    # Prefer the profile's table row explicitly labelled as the current rate.
    for row in soup.find_all("tr"):
        cells = row.find_all(["td", "th"], recursive=False)
        if len(cells) < 2:
            cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue
        label = clean_text(cells[0])
        value = number(clean_text(cells[1]))
        if "زمان ثبت آخرین نرخ" in label and source_date is None:
            source_date = clean_text(cells[1])
        if "نرخ فعلی" in label and value is not None and price is None:
            price = value

    # Fallback for markup changes: parse the visible "نرخ فعلی" line.
    if price is None:
        text = clean_text(soup)
        match = re.search(r"نرخ\s*فعلی\s*[:：]?\s*([\d۰-۹٠-٩,٬]+(?:[٫.]\d+)?)", text)
        if match:
            price = number(match.group(1))

    if price is None or not (config["min"] <= price <= config["max"]):
        raise ValueError("Could not extract a plausible current price")
    return {
        "price": price,
        "fetchedAt": NOW,
        "sourceDate": source_date,
        "source": "TGJU",
        "sourceUrl": config["url"],
        "unit": "USD/barrel" if item == "oil" else "IRR",
    }

def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    try:
        old = json.loads(OUT.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        old = {"items": {}}
    items = old.get("items", {})
    successes, failures = [], {}
    session = requests.Session()
    for key, config in SOURCES.items():
        try:
            # One retry for transient network failures/rate limits.
            last_error = None
            for attempt in range(2):
                try:
                    items[key] = scrape(key, config)
                    last_error = None
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt == 0:
                        time.sleep(2)
            if last_error:
                raise last_error
            successes.append(key)
            print(f"OK {key}: {items[key]['price']}")
        except Exception as exc:
            failures[key] = str(exc)
            print(f"WARNING {key}: {exc}", file=sys.stderr)

    if not successes:
        print("No prices could be refreshed; preserving the previous JSON file.", file=sys.stderr)
        return 1

    result = {
        "source": "TGJU",
        "checkedAt": NOW,
        "scheduleMinutes": 5,
        "successfulItems": successes,
        "failedItems": failures,
        "items": items,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {len(successes)}/{len(SOURCES)} prices in {OUT}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
