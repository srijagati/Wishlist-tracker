# Wishlist Price Tracker

A personal Chrome extension that tracks prices on items you add to your
cart or wishlist at online clothing retailers, and notifies you when the
price drops.

Currently supported: **Hollister**. Built to make adding another store
(Urban Outfitters, H&M, ...) a matter of adding one adapter, not a rewrite.

## How it works

There's no official price API for these retailers, so instead of scraping
rendered pages with a headless browser (the kind of automation that tends
to trip bot detection), this reads the structured product data stores
already embed in their plain HTML for Google/Facebook/Pinterest to read -
`schema.org` `Product`/`Offer` JSON-LD, with a meta-tag fallback for stores
that use that instead. See `lib/parseProduct.js`.

- **content-scripts/hollister.js** runs on hollisterco.com and watches for
  clicks on "Add To Bag" / "Add to List". When you click one, it reads the
  price straight off the page you're already viewing - no network request
  at all - and sends it to the background script to track.
- **background.js** is the service worker. Once a day (configurable), it
  re-fetches each tracked product's page and re-parses the price, a couple
  of seconds apart per item so it behaves like a normal, slow browsing
  session rather than a bot. If a price dropped, you get a native Chrome
  notification.
- Everything is stored locally via `chrome.storage.local` - no server, no
  database file, no account.

This is an unofficial method reading pages the way a search-engine bot
does, not a sanctioned integration - if a store changes its page markup,
the parser may need a small update (that's what `lib/parseProduct.js` is
for).

## Loading the extension in Chrome

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Browse to a Hollister product page and click **Add To Bag** or
   **Add to List** - you'll see a small confirmation toast, and the item
   will show up in the extension's popup

## Project layout

```
manifest.json               MV3 manifest
background.js                service worker: daily price checks, notifications
lib/parseProduct.js          shared product/price parser (JSON-LD + meta tag fallback)
lib/storage.js                chrome.storage.local data layer
content-scripts/hollister.js  detects Add To Bag / Add to List clicks on hollisterco.com
popup/                        the toolbar popup UI (cart / wishlist lists)
icons/                        toolbar icon
```

## Adding another store

1. Open a product page on the new store, view source (or fetch it) and
   check whether it embeds `application/ld+json` `Product` data, or an
   `og:price:amount` / `product:price:amount` meta tag. `lib/parseProduct.js`
   already handles both patterns.
2. Add the store's domain to `host_permissions` and a new entry in
   `content_scripts` in `manifest.json`.
3. Copy `content-scripts/hollister.js` to `content-scripts/<store>.js`,
   and update `isCartButton` / `isWishlistButton` to match that store's
   actual "add to cart" / "add to wishlist" buttons (open the page,
   right-click the button -> Inspect, and look for a stable class or
   `data-testid`).

## Notes / limitations

- Price checks depend on the retailer continuing to embed this structured
  data. If a check starts failing for an item, the popup will show
  "check failed" next to it.
- This only tracks items added *after* the extension is installed (or
  added manually going forward) - it can't retroactively see your existing
  cart/wishlist history.

## Testing without waiting for a real sale

There's a fake local product page under `test-site/` wired into the
extension the same way Hollister is, so you can test the whole flow -
tracking, re-checking, and the price-drop notification - on demand.

1. In a terminal, start a local server for it:
   ```
   cd test-site
   python3 -m http.server 8000
   ```
   Leave that running. Then open `http://localhost:8000/product.html` in
   the same Chrome profile you loaded the extension into.
2. Click **Add To Bag** or **Add to List** on that page - same toast,
   same popup entry as a real store.
3. Change the price:
   ```
   python3 set_price.py 39.99
   ```
   (run from the `test-site/` folder, or `python3 test-site/set_price.py 39.99`
   from the repo root)
4. Reload `http://localhost:8000/product.html` in the browser if you want
   to see the new price on the page itself (optional - not required for
   the test).
5. Open the extension popup and click **Check Now**. It re-fetches
   `product.html` and re-parses the price, exactly like it would for a
   real tracked item.

Note: right now the extension only sends a notification when a price
*drops* - a price *increase* is still recorded (you'll see it reflected
in the popup and in price history) but won't trigger a notification,
since the point of the tracker is catching deals, not price hikes. Set a
lower price with `set_price.py` to see the drop notification fire; set a
higher one to confirm it updates silently without notifying.

## Cloud checking (works even with your laptop off)

The extension alone can only check prices while Chrome is running. There's
an optional second layer under `.github/workflows/` and `scripts/` that
runs the same kind of check on GitHub's servers once a day via GitHub
Actions - free, no server to maintain, works whether or not your laptop is
on. Since it can't show a Chrome notification, it emails you instead
(plain Gmail SMTP, not EmailJS - GitHub can safely hold a real credential
as an encrypted Secret, which client-side extension code can't).

**One-time setup:**

1. Turn on 2-Step Verification on your Google account (required for the
   next step), then create a Gmail **App Password**:
   https://myaccount.google.com/apppasswords
2. In your repo on github.com: **Settings -> Secrets and variables ->
   Actions -> New repository secret**, and add three:
   - `GMAIL_ADDRESS` - the Gmail address sending the email
   - `GMAIL_APP_PASSWORD` - the app password from step 1
   - `NOTIFY_EMAIL` - the address you want notified (can be the same one)
3. That's it - the workflow in `.github/workflows/price-check.yml` runs
   daily at 13:00 UTC automatically. You can also trigger it manually
   from the repo's **Actions** tab (Daily price check -> Run workflow) to
   test it without waiting for the schedule.

**Keeping it in sync with what you're tracking:**

The cloud job reads `data/tracked-items.json`, which is separate from the
extension's own local storage - it only knows about items you've
explicitly synced. Whenever you want the cloud job to pick up new items:

1. Open the extension popup and click **Sync to GitHub** (bottom right) -
   this downloads `tracked-items.json`.
2. Move that downloaded file into `data/tracked-items.json` in your repo
   folder (overwriting the old one).
3. Commit and push:
   ```
   git add data/tracked-items.json
   git commit -m "Sync tracked items"
   git push
   ```

`data/price-state.json` is different - the workflow updates and commits
that one itself after every run, so you don't need to touch it.
