// popup/popup.js

let activeList = "cart";

const itemListEl = document.getElementById("itemList");
const emptyStateEl = document.getElementById("emptyState");
const statusLineEl = document.getElementById("statusLine");
const checkNowBtn = document.getElementById("checkNowBtn");
const storeHintEl = document.getElementById("storeHint");

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeList = btn.dataset.list;
    render();
  });
});

checkNowBtn.addEventListener("click", () => {
  checkNowBtn.disabled = true;
  statusLineEl.textContent = "Checking prices...";
  chrome.runtime.sendMessage({ type: "CHECK_NOW" }, (response) => {
    checkNowBtn.disabled = false;
    if (response?.ok) {
      const dropped = response.results.filter((r) => r?.dropped).length;
      statusLineEl.textContent = dropped
        ? `Done - ${dropped} price drop${dropped === 1 ? "" : "s"} found!`
        : "Done - no price drops right now.";
    } else {
      statusLineEl.textContent = "Something went wrong checking prices.";
    }
    render();
  });
});

function formatPrice(n) {
  return `$${Number(n).toFixed(2)}`;
}

function timeAgo(iso) {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function itemRow(item) {
  const li = document.createElement("li");
  li.className = "item";

  const img = document.createElement("img");
  img.src = item.image || "";
  img.alt = "";
  li.appendChild(img);

  const info = document.createElement("div");
  info.className = "item-info";

  const link = document.createElement("a");
  link.className = "item-name";
  link.href = item.url;
  link.target = "_blank";
  link.textContent = item.name;
  info.appendChild(link);

  const priceLine = document.createElement("div");
  priceLine.className = "item-price";
  const dropped = item.currentPrice < item.originalPrice;
  priceLine.innerHTML = `<span class="current${dropped ? " dropped" : ""}">${formatPrice(item.currentPrice)}</span>${
    dropped ? `<span class="original">${formatPrice(item.originalPrice)}</span>` : ""
  }`;
  info.appendChild(priceLine);

  const meta = document.createElement("div");
  meta.className = "item-meta";
  meta.textContent = `checked ${timeAgo(item.lastCheckedAt)}${item.lastCheckError ? " - check failed" : ""}`;
  info.appendChild(meta);

  li.appendChild(info);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "REMOVE_ITEM", id: item.id }, () => render());
  });
  li.appendChild(removeBtn);

  return li;
}

async function render() {
  const data = await chrome.storage.local.get("trackedItems");
  const items = Object.values(data.trackedItems || {}).filter((i) => i.listType === activeList);

  itemListEl.innerHTML = "";
  if (items.length === 0) {
    emptyStateEl.hidden = false;
    return;
  }
  emptyStateEl.hidden = true;

  items
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
    .forEach((item) => itemListEl.appendChild(itemRow(item)));
}

storeHintEl.textContent = "Currently tracking: Hollister";
render();
