"""
check_prices.py

Runs in GitHub Actions on a schedule (see .github/workflows/price-check.yml)
so price checks keep happening even when your laptop is off. Same idea as
the extension's background.js: read the price straight out of each page's
schema.org Product JSON-LD (a plain GET, no headless browser, no private
APIs), compare to the last known price, and email a summary if anything
dropped.

Reads:
  data/tracked-items.json   - what to check (synced from the extension)
Writes:
  data/price-state.json     - last known price + history per item,
                               committed back to the repo by the workflow
"""

import json
import os
import re
import smtplib
import sys
import time
import random
from email.mime.text import MIMEText
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).parent.parent
ITEMS_FILE = ROOT / "data" / "tracked-items.json"
STATE_FILE = ROOT / "data" / "price-state.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def extract_product(html):
    """Same logic as lib/parseProduct.js, ported to Python."""
    blocks = []
    for match in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.DOTALL | re.IGNORECASE,
    ):
        try:
            blocks.append(json.loads(match.group(1).strip()))
        except (json.JSONDecodeError, ValueError):
            continue

    flat = []
    for block in blocks:
        if isinstance(block, list):
            flat.extend(block)
        elif isinstance(block, dict) and isinstance(block.get("@graph"), list):
            flat.extend(block["@graph"])
        else:
            flat.append(block)

    product = None
    for node in flat:
        if not isinstance(node, dict):
            continue
        t = node.get("@type")
        if t == "Product" or (isinstance(t, list) and "Product" in t):
            product = node
            break

    if not product:
        return None

    offer = product.get("offers")
    if isinstance(offer, list):
        offer = offer[0] if offer else {}
    offer = offer or {}

    price = offer.get("price")
    if price is None:
        spec = offer.get("priceSpecification")
        if isinstance(spec, list) and spec:
            price = spec[0].get("price")
        elif isinstance(spec, dict):
            price = spec.get("price")

    if price is None:
        return None

    try:
        price = float(price)
    except (TypeError, ValueError):
        return None

    return {"name": product.get("name"), "price": price}


def fetch_price(url):
    import urllib.request
    import urllib.error

    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as e:
        return None, str(e)

    product = extract_product(html)
    if not product:
        return None, "Could not find price on page"
    return product["price"], None


def send_summary_email(drops):
    gmail_address = os.environ.get("GMAIL_ADDRESS")
    gmail_app_password = os.environ.get("GMAIL_APP_PASSWORD")
    notify_email = os.environ.get("NOTIFY_EMAIL")

    if not (gmail_address and gmail_app_password and notify_email):
        print("Email not configured (missing GMAIL_ADDRESS / GMAIL_APP_PASSWORD / NOTIFY_EMAIL secrets) - skipping email.")
        return

    lines = [f"- {d['name']}: ${d['previous']:.2f} -> ${d['current']:.2f}\n  {d['url']}" for d in drops]
    body = "Price drops found:\n\n" + "\n\n".join(lines)

    msg = MIMEText(body)
    msg["Subject"] = f"Price drop{'s' if len(drops) > 1 else ''}: {len(drops)} item{'s' if len(drops) > 1 else ''}"
    msg["From"] = gmail_address
    msg["To"] = notify_email

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(gmail_address, gmail_app_password)
        server.sendmail(gmail_address, [notify_email], msg.as_string())

    print(f"Sent summary email for {len(drops)} drop(s) to {notify_email}")


def main():
    items = json.loads(ITEMS_FILE.read_text()) if ITEMS_FILE.exists() else []
    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}

    if not items:
        print("No tracked items in data/tracked-items.json - nothing to check.")
        return

    drops = []
    now = datetime.now(timezone.utc).isoformat()

    for item in items:
        item_id = item["id"]
        url = item["url"]
        print(f"Checking {item.get('name', item_id)} ({url}) ...")

        price, error = fetch_price(url)
        entry = state.get(item_id, {"history": []})

        if error:
            entry["lastError"] = error
            entry["lastCheckedAt"] = now
            state[item_id] = entry
            print(f"  error: {error}")
            time.sleep(2 + random.random() * 3)
            continue

        previous_price = entry.get("currentPrice", item.get("currentPrice", price))
        entry["lastError"] = None
        entry["lastCheckedAt"] = now
        entry["currentPrice"] = price
        entry["lowestPrice"] = min(entry.get("lowestPrice", price), price)
        entry.setdefault("history", []).append({"price": price, "checkedAt": now})
        entry["history"] = entry["history"][-200:]
        state[item_id] = entry

        if price < previous_price:
            drops.append({
                "name": item.get("name", item_id),
                "url": url,
                "previous": previous_price,
                "current": price,
            })
            print(f"  DROP: ${previous_price:.2f} -> ${price:.2f}")
        else:
            print(f"  ${price:.2f} (no change)")

        time.sleep(2 + random.random() * 3)

    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n")

    if drops:
        send_summary_email(drops)
    else:
        print("No price drops this run.")


if __name__ == "__main__":
    main()
