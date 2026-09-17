// background.js (MV3 service worker)
//
// Jobs:
//   1. Listen for "item added" messages from content scripts and start
//      tracking that product.
//   2. Once a day, re-fetch every tracked product's page and see if the
//      price dropped. Plain fetch() from the extension - your own browser,
//      your own network, once/day per item, a couple seconds apart. No
//      headless browser, no rendering, no private API calls.
//   3. If you weren't looking when a drop was found, re-surface it the
//      next time you come back to Chrome (window focus) instead of
//      relying on a single notification you might have missed.
//   4. Optionally, email you when a drop happens (see lib/email.js) -
//      inactive until you configure EmailJS credentials in options.

import { extractProduct } from "./lib/parseProduct.js";
import {
  upsertItem,
  removeItem,
  recordPriceCheck,
  getAllItems,
  getSettings,
  saveSettings,
  addUnseenDrop,
  getUnseenDropIds,
  clearUnseenDrops,
} from "./lib/storage.js";
import { sendDropEmail } from "./lib/email.js";

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
    checkAllPrices({ manual: true })
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

  if (message?.type === "MARK_DROPS_SEEN") {
    clearUnseenDrops()
      .then(async () => {
        const items = Object.values(await getAllItems());
        updateBadge(items.length);
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gap between checks on the SAME store, so repeated requests to one site
 * don't fire back-to-back like a bot. A manual "Check Now" click is a
 * one-off human action, not an unattended background loop, so it doesn't
 * need the same caution - shorter gap, mostly just to avoid a burst.
 */
function politeDelay(manual) {
  return manual ? sleep(300 + Math.random() * 700) : sleep(2000 + Math.random() * 3000);
}

function broadcastProgress(current, total, itemName) {
  chrome.runtime.sendMessage({ type: "CHECK_PROGRESS", current, total, itemName }).catch(() => {
    /* no popup open to receive it - fine, ignore */
  });
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

/**
 * Different stores are checked in parallel - each site only ever sees one
 * request from us regardless of what else is running. Items on the SAME
 * store are still checked one at a time with a polite gap, since hitting
 * one site repeatedly and quickly is the actual risk we're avoiding.
 */
export async function checkAllPrices({ manual = false } = {}) {
  const items = Object.values(await getAllItems());
  const total = items.length;
  let completed = 0;

  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.store)) groups.set(item.store, []);
    groups.get(item.store).push(item);
  }

  async function runGroup(groupItems) {
    const groupResults = [];
    for (const item of groupItems) {
      const outcome = await checkOnePrice(item);
      const recorded = await recordPriceCheck(item.id, outcome);
      groupResults.push(recorded);

      if (recorded?.dropped) {
        await onPriceDropped(recorded.item, recorded.previousPrice);
      }

      completed += 1;
      broadcastProgress(completed, total, item.name);

      await politeDelay(manual);
    }
    return groupResults;
  }

  const resultsByGroup = await Promise.all([...groups.values()].map(runGroup));
  const results = resultsByGroup.flat();

  updateBadge(items.length);
  return results;
}

async function onPriceDropped(item, previousPrice) {
  notifyPriceDrop(item, previousPrice);
  await addUnseenDrop(item.id);
  sendDropEmail(item, previousPrice).catch(() => {
    /* email is best-effort - a failure here shouldn't break price checking */
  });
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

function updateBadge(trackedCount) {
  getUnseenDropIds().then((unseen) => {
    if (unseen.length > 0) {
      chrome.action.setBadgeText({ text: String(unseen.length) });
      chrome.action.setBadgeBackgroundColor({ color: "#dc2626" }); // red = "look at me"
    } else {
      chrome.action.setBadgeText({ text: trackedCount > 0 ? String(trackedCount) : "" });
      chrome.action.setBadgeBackgroundColor({ color: "#2f6f4f" }); // green = normal count
    }
  });
}

// --- Welcome-back: re-surface any drop you might have missed ---
//
// chrome.windows.onFocusChanged fires whenever you switch back to a Chrome
// window (including alt-tabbing back from another app). If there's a price
// drop you haven't opened the popup to see yet, remind you - but only once
// every little while, so tabbing in and out doesn't spam you.
let lastFocusNudgeAt = 0;
const FOCUS_NUDGE_COOLDOWN_MS = 20 * 60 * 1000; // 20 minutes

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // focus left Chrome entirely

  const unseen = await getUnseenDropIds();
  if (unseen.length === 0) return;

  const now = Date.now();
  if (now - lastFocusNudgeAt < FOCUS_NUDGE_COOLDOWN_MS) return;
  lastFocusNudgeAt = now;

  const items = await getAllItems();
  const names = unseen.map((id) => items[id]?.name).filter(Boolean);

  chrome.notifications.create(`welcome-back-${now}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: unseen.length === 1 ? "Welcome back - price drop waiting" : `Welcome back - ${unseen.length} price drops waiting`,
    message: names.slice(0, 3).join(", ") || "Open the extension to see what dropped.",
    priority: 2,
  });
});
