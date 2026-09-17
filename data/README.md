# data/

- `tracked-items.json` - the list of items to watch. **You own this file.**
  It's replaced whenever you click "Sync to GitHub" in the extension popup
  and manually move the downloaded file here, then commit/push. This is
  the only manual step - everything else (checking, emailing) is automatic
  once it's synced.
- `price-state.json` - **the GitHub Action owns this file.** It records the
  last known price and history per item, and commits updates back to the
  repo after every scheduled run. You shouldn't need to edit it by hand.
