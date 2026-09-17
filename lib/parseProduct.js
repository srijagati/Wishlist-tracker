// lib/parseProduct.js
//
// Pulls product info (name, price, image, availability) out of a page's
// HTML. We do NOT render JavaScript or call any private/internal API here -
// we just read the structured data retailers already embed in their raw
// HTML for Google/Facebook/Pinterest to read (schema.org "Product" JSON-LD,
// and a couple of common fallback <meta> tags). That means:
//   - A plain fetch() of the page is enough - no headless browser needed.
//   - It's the same lightweight request a search engine bot makes, so it
//     doesn't look like the kind of scraping that trips bot detection.
//
// Each store can have quirks, so this is structured as a list of "adapters"
// tried in order. Add a new one to support a new store.

/**
 * @typedef {Object} ParsedProduct
 * @property {string} name
 * @property {number} price
 * @property {string} currency
 * @property {string|null} image
 * @property {string|null} sku
 * @property {string|null} availability
 */

/** Pull every <script type="application/ld+json">...</script> block out of raw HTML. */
function extractLdJsonBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch (err) {
      // Some sites emit slightly malformed JSON-LD (trailing commas, etc).
      // Skip anything we can't parse rather than crashing the whole check.
    }
  }
  return blocks;
}

/** JSON-LD can nest the Product under @graph, or as a single object, or an array. */
function findProductNode(blocks) {
  const flat = [];
  for (const block of blocks) {
    if (Array.isArray(block)) flat.push(...block);
    else if (block && Array.isArray(block["@graph"])) flat.push(...block["@graph"]);
    else flat.push(block);
  }
  return flat.find((node) => node && (node["@type"] === "Product" || (Array.isArray(node["@type"]) && node["@type"].includes("Product"))));
}

function firstOffer(offers) {
  if (!offers) return null;
  if (Array.isArray(offers)) return offers[0] || null;
  return offers;
}

function priceFromOffer(offer) {
  if (!offer) return null;
  if (offer.price != null) return Number(offer.price);
  if (Array.isArray(offer.priceSpecification) && offer.priceSpecification.length) {
    return Number(offer.priceSpecification[0].price);
  }
  if (offer.priceSpecification && offer.priceSpecification.price != null) {
    return Number(offer.priceSpecification.price);
  }
  return null;
}

function fromJsonLd(html) {
  const blocks = extractLdJsonBlocks(html);
  const product = findProductNode(blocks);
  if (!product) return null;

  const offer = firstOffer(product.offers);
  const price = priceFromOffer(offer);
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
    availability: offer?.availability || null,
  };
}

/** Fallback for stores that only expose Open Graph / Twitter card price meta tags. */
function fromMetaTags(html) {
  const metaValue = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
    const m = html.match(re);
    return m ? m[1] : null;
  };

  const priceStr = metaValue("product:price:amount") || metaValue("og:price:amount");
  if (!priceStr) return null;
  const price = Number(priceStr);
  if (Number.isNaN(price)) return null;

  return {
    name: metaValue("og:title"),
    price,
    currency: metaValue("product:price:currency") || metaValue("og:price:currency") || "USD",
    image: metaValue("og:image"),
    sku: null,
    availability: metaValue("product:availability"),
  };
}

/**
 * Extract product info from a page's full HTML.
 * @param {string} html
 * @returns {ParsedProduct|null}
 */
export function extractProduct(html) {
  return fromJsonLd(html) || fromMetaTags(html);
}
