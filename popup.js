// Popup: list open X/Twitter tabs, let the user pick one, kick off extraction.

const tabSelect = document.getElementById('tabSelect');
const noTabsHint = document.getElementById('noTabsHint');
const extractBtn = document.getElementById('extractBtn');
const openResultsBtn = document.getElementById('openResultsBtn');
const statusDiv = document.getElementById('status');
const errorDiv = document.getElementById('error');

function isX(url) {
  if (!url) return false;
  return url.includes('x.com') || url.includes('twitter.com');
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/$/, '');
    if (!path) path = '/home';
    return u.hostname + path;
  } catch {
    return url;
  }
}

async function loadTabs() {
  const tabs = await chrome.tabs.query({});
  const xTabs = tabs.filter(t => isX(t.url));

  if (!xTabs.length) {
    tabSelect.innerHTML = '<option value="">No open X tab</option>';
    tabSelect.disabled = true;
    extractBtn.disabled = true;
    noTabsHint.style.display = 'block';
    return;
  }

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeId = active && isX(active.url) ? active.id : xTabs[0].id;

  tabSelect.innerHTML = '';
  xTabs.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    const label = (t.title || '').replace(/ \/ X$/, '').replace(/ \/ Twitter$/, '') || shortenUrl(t.url);
    opt.textContent = label.length > 50 ? label.slice(0, 47) + '…' : label;
    opt.title = `${t.title || ''}\n${t.url}`;
    if (t.id === activeId) opt.selected = true;
    tabSelect.appendChild(opt);
  });
}

function showStatus(msg) {
  errorDiv.style.display = 'none';
  statusDiv.textContent = msg;
  statusDiv.style.display = 'block';
}

function showError(msg) {
  statusDiv.style.display = 'none';
  errorDiv.textContent = msg;
  errorDiv.style.display = 'block';
}

extractBtn.addEventListener('click', async () => {
  const tabId = parseInt(tabSelect.value, 10);
  if (!tabId) {
    showError('Pick an X tab first.');
    return;
  }

  extractBtn.disabled = true;
  showStatus('Opening results page…');

  // Persist target tab so the results page knows which tab to read from.
  await chrome.storage.local.set({
    targetTabId: tabId,
    extractionStartedAt: Date.now(),
    extractedPosts: []
  });

  // Make sure content script is injected.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    // Likely already injected — safe to ignore.
  }

  // Tell the content script to start scrolling + extracting.
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'startExtraction' });
  } catch (err) {
    showError('Could not reach that tab — try refreshing it on x.com and retry.');
    extractBtn.disabled = false;
    return;
  }

  // Open the results dashboard.
  await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
  window.close();
});

openResultsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
});

document.addEventListener('DOMContentLoaded', loadTabs);
