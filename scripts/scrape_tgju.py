#!/usr/bin/env python3
"""Backward-compatible entry point for the canonical TGJU scraper.

The workflow and local runs must use the same parser and validation rules.
"""
from update_market_rates import main


if __name__ == "__main__":
    raise SystemExit(main())
