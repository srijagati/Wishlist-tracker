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
