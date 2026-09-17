// lib/storage.js
//
// Everything the extension knows lives in chrome.storage.local under one
// key, as a plain object keyed by item id. No server, no database file.

const ITEMS_KEY = "trackedItems";
const SETTINGS_KEY = "settings";

const DEFAULT_SETTINGS = {
  checkFrequencyMinutes: 24 * 60, // once a day
};

/**
 * @typedef {Object} TrackedItem
 * @property {string} id
 * @property {"cart"|"wishlist"} listType
 * @property {string} store        e.g. "hollister"
 * @property {string} url          canonical product URL we re-check
 * @property {string} name
 * @property {string|null} image
 * @property {number} originalPrice   price when first added
 * @property {number} currentPrice    latest known price
 * @property {number|null} lowestPrice
 * @property {string} addedAt         ISO timestamp
 * @property {string|null} lastCheckedAt
 * @property {string|null} lastCheckError
 * @property {{price:number, checkedAt:string}[]} priceHistory
 */

function makeId(store, listType, url) {
  // Stable id so re-adding the same product/list combo updates in place
  // instead of creating a duplicate row.
  return `${store}:${listType}:${url}`;
}

export async function getAllItems() {
  const data = await chrome.storage.local.get(ITEMS_KEY);
  return data[ITEMS_KEY] || {};
}

export async function getItem(id) {
  const items = await getAllItems();
  return items[id] || null;
}

async function saveAllItems(items) {
  await chrome.storage.local.set({ [ITEMS_KEY]: items });
}

/**
 * Add a freshly-seen product to tracking, or refresh it if it's already
 * tracked under the same store/list/url.
 */
export async function upsertItem({ store, listType, url, name, image, price, sku }) {
  const items = await getAllItems();
  const id = makeId(store, listType, url);
  const now = new Date().toISOString();
  const existing = items[id];

  if (existing) {
    existing.name = name || existing.name;
    existing.image = image || existing.image;
    existing.sku = sku || existing.sku;
    items[id] = existing;
  } else {
    items[id] = {
      id,
      store,
      listType,
      url,
      name: name || "Untitled item",
      image: image || null,
      sku: sku || null,
      originalPrice: price,
      currentPrice: price,
      lowestPrice: price,
      addedAt: now,
      lastCheckedAt: now,
      lastCheckError: null,
      priceHistory: [{ price, checkedAt: now }],
    };
  }

  await saveAllItems(items);
  return items[id];
}

export async function removeItem(id) {
  const items = await getAllItems();
  delete items[id];
  await saveAllItems(items);
}

/**
 * Record the result of a background price check for one item.
 * Returns { item, dropped, previousPrice } so the caller can decide
 * whether to notify.
 */
export async function recordPriceCheck(id, result) {
  const items = await getAllItems();
  const item = items[id];
  if (!item) return null;

  const now = new Date().toISOString();
  item.lastCheckedAt = now;

  if (result.error) {
    item.lastCheckError = result.error;
    await saveAllItems(items);
    return { item, dropped: false, previousPrice: item.currentPrice };
  }

  item.lastCheckError = null;
  const previousPrice = item.currentPrice;
  const dropped = result.price < previousPrice;

  item.currentPrice = result.price;
  item.lowestPrice = Math.min(item.lowestPrice ?? result.price, result.price);
  item.priceHistory.push({ price: result.price, checkedAt: now });
  // Keep history from growing forever.
  if (item.priceHistory.length > 200) item.priceHistory = item.priceHistory.slice(-200);

  items[id] = item;
  await saveAllItems(items);
  return { item, dropped, previousPrice };
}

export async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
