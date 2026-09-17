// background.js (MV3 service worker)
//
// Two jobs:
//   1. Listen for "item added" messages from content scripts and start
//      tracking that product.
//   2. Once a day, re-fetch every tracked product's page and see if the
//      price dropped. This is a plain fetch() from the extension - it runs
//      in your own browser, with your own network, at a low, human-scale
//      frequency (once/day per item, a couple seconds apart). No headless
//      browser, no rendering, no private API calls.

import { extractProduct } from "./lib/parseProduct.js";
import { upsertItem, removeItem, recordPriceCheck, getAllItems, getSettings, saveSettings } from "./lib/storage.js";

const ALARM_NAME = "price-check";

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.checkFrequencyMinutes });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkAllPrices();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ITEM_ADDED") {
    upsertItem(message.product)
      .then((item) => sendResponse({ ok: true, item }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the message channel open for the async response
  }

  if (message?.type === "REMOVE_ITEM") {
    removeItem(message.id)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message?.type === "CHECK_NOW") {
    checkAllPrices()
      .then((results) => sendResponse({ ok: true, results }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message?.type === "UPDATE_FREQUENCY") {
    saveSettings({ checkFrequencyMinutes: message.minutes })
      .then((settings) => {
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: settings.checkFrequencyMinutes });
        sendResponse({ ok: true, settings });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Small random delay between checks so requests don't fire back-to-back like a bot. */
function politeDelay() {
  return sleep(2000 + Math.random() * 3000);
}

async function checkOnePrice(item) {
  try {
    const res = await fetch(item.url, { credentials: "omit" });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const product = extractProduct(html);
    if (!product) {
      return { error: "Could not find price on page (site may have changed its layout)" };
    }
    return { price: product.price };
  } catch (err) {
    return { error: String(err) };
  }
}

export async function checkAllPrices() {
  const items = Object.values(await getAllItems());
  const results = [];

  for (const item of items) {
    const outcome = await checkOnePrice(item);
    const recorded = await recordPriceCheck(item.id, outcome);
    results.push(recorded);

    if (recorded?.dropped) {
      notifyPriceDrop(recorded.item, recorded.previousPrice);
    }

    await politeDelay();
  }

  updateBadge(items.length);
  return results;
}

function notifyPriceDrop(item, previousPrice) {
  chrome.notifications.create(`price-drop-${item.id}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Price drop!",
    message: `${item.name}: $${previousPrice.toFixed(2)} -> $${item.currentPrice.toFixed(2)}`,
    priority: 2,
  });
}

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("price-drop-")) return;
  const id = notificationId.replace("price-drop-", "");
  getAllItems().then((items) => {
    const item = items[id];
    if (item) chrome.tabs.create({ url: item.url });
  });
});

function updateBadge(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#2f6f4f" });
}
