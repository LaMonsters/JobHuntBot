/* Reuse only the configured dashboard, preserving its document and unsaved form. */
async function deliverOfferTrackJob(destination, data) {
  const key = value => {
    try {
      const url = new URL(value);
      url.hash = ''; url.search = '';
      return url.href;
    } catch { return ''; }
  };
  const destinationKey = key(destination);
  const fragment = 'offertrack-import=' + encodeURIComponent(JSON.stringify(data));
  // A target may be closed between query and update. Retry only that race.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [tabs, currentWindow] = await Promise.all([
      chrome.tabs.query({}), chrome.windows.getCurrent()
    ]);
    const matches = tabs.filter(tab => tab.id != null && key(tab.pendingUrl || tab.url) === destinationKey && tab.incognito === currentWindow.incognito);
    matches.sort((a, b) => Number(b.windowId === currentWindow.id) - Number(a.windowId === currentWindow.id) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
    const existing = matches[0];
    if (!existing) {
      const url = new URL(destination);
      url.hash = fragment;
      await chrome.tabs.create({ url: url.href });
      return { reused: false };
    }
    // Preserve any query string so only the fragment changes: no page reload.
    const url = new URL(existing.pendingUrl || existing.url);
    url.hash = fragment;
    try {
      await chrome.tabs.update(existing.id, { url: url.href, active: true });
    } catch (error) {
      if (attempt === 0 && /No tab with id|Invalid tab ID/i.test(error.message)) continue;
      throw error;
    }
    if (existing.windowId !== currentWindow.id) await chrome.windows.update(existing.windowId, { focused: true });
    return { reused: true };
  }
}
