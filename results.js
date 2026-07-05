// Results dashboard: pulls extracted posts from the target X tab + storage,
// renders cards, supports sort / export / clear.

const els = {
  contextLine: document.getElementById('contextLine'),
  stopBtn: document.getElementById('stopBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  statPosts: document.getElementById('statPosts'),
  statViews: document.getElementById('statViews'),
  statEng: document.getElementById('statEng'),
  statRate: document.getElementById('statRate'),
  sortSelect: document.getElementById('sortSelect'),
  exportBtn: document.getElementById('exportBtn'),
  copyJsonBtn: document.getElementById('copyJsonBtn'),
  clearBtn: document.getElementById('clearBtn'),
  postsList: document.getElementById('postsList'),
  emptyState: document.getElementById('emptyState')
};

let posts = [];
let context = null;
let active = false;
let pollHandle = null;

function fmt(n) {
  n = Number(n || 0);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
}

function pct(n) {
  return (Number(n || 0) * 100).toFixed(2) + '%';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function describeContext(ctx) {
  if (!ctx) return 'No tab linked.';
  const parts = [];
  if (ctx.pageType === 'profile' && ctx.handle) parts.push(`Profile · @${ctx.handle}`);
  else if (ctx.pageType === 'profile_replies' && ctx.handle) parts.push(`Replies · @${ctx.handle}`);
  else if (ctx.pageType === 'profile_media' && ctx.handle) parts.push(`Media · @${ctx.handle}`);
  else if (ctx.pageType === 'profile_likes' && ctx.handle) parts.push(`Likes · @${ctx.handle}`);
  else if (ctx.pageType === 'community') parts.push('Community');
  else if (ctx.pageType === 'home') parts.push('Home feed');
  else if (ctx.pageType === 'list') parts.push('List');
  else if (ctx.pageType === 'search') parts.push('Search results');
  else if (ctx.pageType === 'status') parts.push('Single post');
  else parts.push('X page');
  try {
    parts.push(new URL(ctx.url).pathname);
  } catch {}
  return parts.join(' · ');
}

function renderStats() {
  const totalViews = posts.reduce((a, p) => a + (p.views || 0), 0);
  const totalEng = posts.reduce((a, p) => a + (p.engagement || 0), 0);
  const rate = totalViews ? totalEng / totalViews : 0;
  els.statPosts.textContent = posts.length;
  els.statViews.textContent = fmt(totalViews);
  els.statEng.textContent = fmt(totalEng);
  els.statRate.textContent = pct(rate);
}

function renderPosts() {
  const sortKey = els.sortSelect.value;
  const sorted = [...posts].sort((a, b) => {
    if (sortKey === 'postedAt') {
      return (b.postedAt || '').localeCompare(a.postedAt || '');
    }
    return (b[sortKey] || 0) - (a[sortKey] || 0);
  });

  if (!sorted.length) {
    els.postsList.innerHTML = '';
    els.emptyState.style.display = 'block';
    return;
  }
  els.emptyState.style.display = 'none';
  els.postsList.innerHTML = sorted.map((p, i) => cardHtml(p, i + 1)).join('');
  els.postsList.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const txt = btn.getAttribute('data-copy');
      navigator.clipboard.writeText(txt).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => (btn.textContent = orig), 1500);
      });
    });
  });
}

function cardHtml(p, rank) {
  const ratio = pct(p.engagementRatio || 0);
  const postedAt = p.postedAt ? new Date(p.postedAt).toLocaleString() : '';
  const handle = p.handle || '';
  return `
    <article class="post">
      <header class="post-head">
        <div>
          <span class="post-author">${esc(p.author || handle || 'Unknown')}</span>
          ${handle ? `<span class="post-handle">${esc(handle)}</span>` : ''}
        </div>
        <span class="post-rank">#${rank}</span>
      </header>
      ${p.isReply && p.replyingTo && p.replyingTo.length ? `<div class="post-reply-ctx">↪ Replying to ${esc(p.replyingTo.join(', '))}</div>` : ''}
      <div class="post-text">${esc(p.text || '(no text — media only)')}</div>
      <div class="post-meta">
        ${postedAt ? `<span>🕒 ${esc(postedAt)}</span>` : ''}
        ${p.images && p.images.length ? `<span>🖼️ ${p.images.length} image(s)</span>` : ''}
        ${p.isReply ? `<span>💬 Reply</span>` : ''}
      </div>
      <div class="post-metrics">
        <div class="metric views">
          <div class="metric-label">Views</div>
          <div class="metric-value">${fmt(p.views)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Likes</div>
          <div class="metric-value">${fmt(p.likes)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Reposts</div>
          <div class="metric-value">${fmt(p.retweets)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Replies</div>
          <div class="metric-value">${fmt(p.replies)}</div>
        </div>
        <div class="metric engagement">
          <div class="metric-label">Eng. rate</div>
          <div class="metric-value">${ratio}</div>
        </div>
      </div>
      <div class="post-actions">
        ${p.permalink ? `<a class="link" href="${esc(p.permalink)}" target="_blank" rel="noopener">Open on X →</a>` : '<span></span>'}
        <button class="btn btn-ghost" data-copy="${esc(p.text || '').replace(/"/g, '&quot;')}">Copy text</button>
      </div>
    </article>
  `;
}

function setLiveLabel() {
  const ctxDesc = describeContext(context);
  els.contextLine.innerHTML = active
    ? `<span class="pulse"></span>Extracting — ${ctxDesc}`
    : ctxDesc;
  els.stopBtn.style.display = active ? 'inline-flex' : 'none';
}

async function loadFromStorage() {
  const data = await chrome.storage.local.get([
    'extractedPosts',
    'extractionContext',
    'extractionDone',
    'targetTabId'
  ]);
  posts = data.extractedPosts || [];
  context = data.extractionContext || null;
  active = !data.extractionDone && Boolean(data.targetTabId);
  renderStats();
  renderPosts();
  setLiveLabel();
}

async function pollLive() {
  const { targetTabId } = await chrome.storage.local.get(['targetTabId']);
  if (!targetTabId) {
    active = false;
    setLiveLabel();
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(targetTabId, { action: 'getExtraction' });
    if (res && res.ok) {
      posts = res.posts || posts;
      context = res.context || context;
      active = Boolean(res.active);
      await chrome.storage.local.set({
        extractedPosts: posts,
        extractionContext: context,
        extractionDone: !active
      });
      renderStats();
      renderPosts();
      setLiveLabel();
    }
  } catch {
    // Tab closed / navigated away — fall back to storage data.
    active = false;
    setLiveLabel();
  }
}

function startPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(pollLive, 2500);
  pollLive();
}

els.sortSelect.addEventListener('change', renderPosts);

els.refreshBtn.addEventListener('click', pollLive);

els.stopBtn.addEventListener('click', async () => {
  const { targetTabId } = await chrome.storage.local.get(['targetTabId']);
  if (targetTabId) {
    try { await chrome.tabs.sendMessage(targetTabId, { action: 'stopExtraction' }); } catch {}
  }
  active = false;
  await chrome.storage.local.set({ extractionDone: true });
  setLiveLabel();
});

els.clearBtn.addEventListener('click', async () => {
  if (!confirm('Clear all extracted posts?')) return;
  posts = [];
  await chrome.storage.local.set({
    extractedPosts: [],
    extractionContext: null,
    extractionDone: true,
    targetTabId: null
  });
  context = null;
  active = false;
  renderStats();
  renderPosts();
  setLiveLabel();
});

els.copyJsonBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(JSON.stringify(posts, null, 2)).then(() => {
    const orig = els.copyJsonBtn.textContent;
    els.copyJsonBtn.textContent = 'Copied!';
    setTimeout(() => (els.copyJsonBtn.textContent = orig), 1500);
  });
});

els.exportBtn.addEventListener('click', () => {
  const headers = [
    'rank', 'author', 'handle', 'text', 'permalink',
    'postedAt', 'isReply', 'replyingTo',
    'views', 'likes', 'retweets', 'replies', 'bookmarks',
    'engagement', 'engagementRatio', 'images'
  ];
  const sortKey = els.sortSelect.value;
  const sorted = [...posts].sort((a, b) => {
    if (sortKey === 'postedAt') return (b.postedAt || '').localeCompare(a.postedAt || '');
    return (b[sortKey] || 0) - (a[sortKey] || 0);
  });
  const rows = sorted.map((p, i) => [
    i + 1,
    p.author || '',
    p.handle || '',
    p.text || '',
    p.permalink || '',
    p.postedAt || '',
    p.isReply ? 'yes' : 'no',
    (p.replyingTo || []).join(' '),
    p.views || 0,
    p.likes || 0,
    p.retweets || 0,
    p.replies || 0,
    p.bookmarks || 0,
    p.engagement || 0,
    ((p.engagementRatio || 0) * 100).toFixed(3) + '%',
    (p.images || []).join(' | ')
  ]);
  const csv = [headers, ...rows].map(r =>
    r.map(c => `"${String(c ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`).join(',')
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const handle = context && context.handle ? context.handle : 'x';
  a.href = url;
  a.download = `x-extract-${handle}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

document.addEventListener('DOMContentLoaded', async () => {
  await loadFromStorage();
  startPolling();
});
