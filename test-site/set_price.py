"""
set_price.py
Changes the price on the local test product page, so you can simulate a
price drop (or increase) without waiting for a real sale.

Usage:
    python3 set_price.py 39.99

Then in the extension popup, click "Check Now" - the background script will
re-fetch product.html and should pick up the new price.
"""

import re
import sys
from pathlib import Path

PRODUCT_HTML = Path(__file__).parent / "product.html"


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 set_price.py <new_price>")
        print("Example: python3 set_price.py 39.99")
        sys.exit(1)

    try:
        new_price = float(sys.argv[1])
    except ValueError:
        print(f"'{sys.argv[1]}' doesn't look like a number.")
        sys.exit(1)

    html = PRODUCT_HTML.read_text()
    updated, count = re.subn(r'"price":\s*[\d.]+', f'"price": {new_price}', html)

    if count == 0:
        print("Couldn't find a price field to update - is product.html unchanged from the original?")
        sys.exit(1)

    PRODUCT_HTML.write_text(updated)
    print(f"Price set to ${new_price:.2f} in product.html")


if __name__ == "__main__":
    main()
