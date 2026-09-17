// content-scripts/hollister.js
//
// Runs on every hollisterco.com page. Watches for clicks on "Add To Bag"
// and "Add to List" (wishlist) so we can capture the product the instant
// you add it - reading data straight off the page you're already on, with
// no extra network request at all.
//
// Note: content scripts can't cleanly share an ES module with the
// background service worker without a build step, so extractProduct() is
// duplicated here (kept in sync with lib/parseProduct.js by hand - if you
// change how prices are parsed, update both).

const STORE = "hollister";

function extractProduct(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch (err) {
      /* skip malformed blocks */
    }
  }

  const flat = [];
  for (const block of blocks) {
    if (Array.isArray(block)) flat.push(...block);
    else if (block && Array.isArray(block["@graph"])) flat.push(...block["@graph"]);
    else flat.push(block);
  }
  const product = flat.find(
    (node) => node && (node["@type"] === "Product" || (Array.isArray(node["@type"]) && node["@type"].includes("Product")))
  );
  if (!product) return null;

  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  let price = null;
  if (offer?.price != null) price = Number(offer.price);
  else if (Array.isArray(offer?.priceSpecification) && offer.priceSpecification.length) {
    price = Number(offer.priceSpecification[0].price);
  }
  if (price == null || Number.isNaN(price)) return null;

  let image = product.image || null;
  if (Array.isArray(image)) image = image[0] || null;
  if (image && typeof image === "object" && image.url) image = image.url;

  return {
    name: product.name || null,
    price,
    currency: offer?.priceCurrency || "USD",
    image,
    sku: product.sku || product.SKU || null,
  };
}

function isCartButton(el) {
  const btn = el.closest("button");
  if (!btn) return false;
  if (/add[\s-]?to[\s-]?bag/i.test(btn.textContent || "")) return true;
  return (btn.className || "").includes("add-to-bag-button");
}

function isWishlistButton(el) {
  const btn = el.closest('[data-testid="add-to-list-button"]');
  if (btn) return true;
  const fallback = el.closest("button");
  return !!fallback && /add to list/i.test(fallback.textContent || "");
}

function canonicalUrl() {
  const u = new URL(window.location.href);
  return `${u.origin}${u.pathname}`;
}

function showToast(text) {
  const toast = document.createElement("div");
  toast.textContent = text;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    background: "#1f2937",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "14px",
    fontFamily: "sans-serif",
    zIndex: 2147483647,
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function handleAdd(listType) {
  const product = extractProduct(document.documentElement.outerHTML);
  if (!product) return;

  chrome.runtime.sendMessage(
    {
      type: "ITEM_ADDED",
      product: {
        store: STORE,
        listType,
        url: canonicalUrl(),
        name: product.name,
        image: product.image,
        price: product.price,
        sku: product.sku,
      },
    },
    (response) => {
      if (response?.ok) {
        showToast(listType === "cart" ? "Tracking price in your cart list" : "Tracking price in your wishlist");
      }
    }
  );
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (isWishlistButton(target)) {
      setTimeout(() => handleAdd("wishlist"), 150);
    } else if (isCartButton(target)) {
      setTimeout(() => handleAdd("cart"), 150);
    }
  },
  true
);
