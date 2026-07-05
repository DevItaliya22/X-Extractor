// Content script: extract posts + metrics from the current X/Twitter page.
// Listens for `startExtraction` / `stopExtraction` / `getExtraction` messages.

(function () {
  if (window.__xExtractorInstalled) return;
  window.__xExtractorInstalled = true;

  let active = false;
  let intervalId = null;
  let stagnationCount = 0;
  let lastCount = 0;
  const seenIds = new Set();
  let posts = [];

  function pageContext() {
    const path = location.pathname;
    const repliesMatch = path.match(/^\/([A-Za-z0-9_]{1,15})\/with_replies\/?$/);
    const mediaMatch = path.match(/^\/([A-Za-z0-9_]{1,15})\/media\/?$/);
    const likesMatch = path.match(/^\/([A-Za-z0-9_]{1,15})\/likes\/?$/);
    const handleMatch = path.match(/^\/([A-Za-z0-9_]{1,15})(\/|$)/);
    let pageType = 'feed';
    let handle = null;
    if (/^\/home/.test(path)) pageType = 'home';
    else if (/^\/search/.test(path)) pageType = 'search';
    else if (/\/lists\//.test(path)) pageType = 'list';
    else if (/\/i\/communities\//.test(path)) pageType = 'community';
    else if (/\/status\//.test(path)) pageType = 'status';
    else if (repliesMatch) {
      pageType = 'profile_replies';
      handle = repliesMatch[1];
    } else if (mediaMatch) {
      pageType = 'profile_media';
      handle = mediaMatch[1];
    } else if (likesMatch) {
      pageType = 'profile_likes';
      handle = likesMatch[1];
    } else if (handleMatch) {
      pageType = 'profile';
      handle = handleMatch[1];
    }
    return {
      url: location.href,
      pageType,
      handle,
      capturedAt: new Date().toISOString()
    };
  }

  function parseMetric(str) {
    if (str == null) return 0;
    let cleaned = String(str).replace(/[, \s]/g, '').trim();
    if (!cleaned) return 0;
    const match = cleaned.match(/([\d.]+)([KMB])?/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    if (Number.isNaN(num)) return 0;
    const suffix = (match[2] || '').toUpperCase();
    if (suffix === 'K') return Math.round(num * 1_000);
    if (suffix === 'M') return Math.round(num * 1_000_000);
    if (suffix === 'B') return Math.round(num * 1_000_000_000);
    return Math.round(num);
  }

  // Pull a metric token (e.g., "1,234", "12.5K", "3M") that precedes a keyword.
  function parseMetricFromLabel(label, keywordPattern) {
    if (!label) return null;
    const re = new RegExp(`([\\d.,]+\\s*[KMB]?)\\s*${keywordPattern}`, 'i');
    const m = label.match(re);
    if (!m) return null;
    return parseMetric(m[1]);
  }

  // X exposes a single accessibility label on [role="group"] that summarizes
  // every counter (e.g., "12 replies, 1.2K reposts, 50K likes, 200 bookmarks, 3M views").
  // This is the single most reliable source — parse it first.
  function extractGroupMetrics(article) {
    const groups = article.querySelectorAll('[role="group"][aria-label]');
    let label = '';
    for (const g of groups) {
      const l = g.getAttribute('aria-label') || '';
      if (/repl|repost|retweet|like|view|bookmark/i.test(l) && l.length > label.length) {
        label = l;
      }
    }
    if (!label) return null;
    return {
      replies: parseMetricFromLabel(label, 'repl(?:y|ies)') ?? 0,
      retweets:
        parseMetricFromLabel(label, '(?:repost|retweet)s?') ?? 0,
      likes: parseMetricFromLabel(label, 'likes?') ?? 0,
      bookmarks: parseMetricFromLabel(label, 'bookmarks?') ?? 0,
      views: parseMetricFromLabel(label, 'views?') ?? 0,
      _label: label
    };
  }

  // Per-button fallback: read live counter span, aria-label, or innerText.
  function extractMetricByTestids(article, testids) {
    for (const testid of testids) {
      const el = article.querySelector(`[data-testid="${testid}"]`);
      if (!el) continue;
      const counter = el.querySelector('[data-testid="app-text-transition-container"]');
      if (counter) {
        const v = parseMetric(counter.innerText || counter.textContent || '');
        if (v > 0) return v;
      }
      const label = el.getAttribute('aria-label') || '';
      const labelMatch = label.match(/([\d.,]+\s*[KMB]?)/i);
      if (labelMatch) {
        const v = parseMetric(labelMatch[1]);
        if (v > 0) return v;
      }
      const inner = (el.innerText || el.textContent || '').trim();
      const innerMatch = inner.match(/([\d.,]+\s*[KMB]?)/i);
      if (innerMatch) {
        const v = parseMetric(innerMatch[1]);
        if (v > 0) return v;
      }
    }
    return 0;
  }

  function extractViews(article) {
    // 1. The analytics link aria-label, e.g. "1,234 views. View post analytics"
    const analyticsLink = article.querySelector('a[href$="/analytics"], a[href*="/analytics"]');
    if (analyticsLink) {
      const label = analyticsLink.getAttribute('aria-label') || '';
      const fromKeyword = parseMetricFromLabel(label, 'views?');
      if (fromKeyword) return fromKeyword;
      const counter = analyticsLink.querySelector('[data-testid="app-text-transition-container"]');
      if (counter) {
        const v = parseMetric(counter.innerText || counter.textContent || '');
        if (v > 0) return v;
      }
      const inner = (analyticsLink.innerText || analyticsLink.textContent || '').trim();
      if (inner) {
        const v = parseMetric(inner);
        if (v > 0) return v;
      }
    }
    // 2. Any element whose aria-label mentions views
    const viewEls = article.querySelectorAll('[aria-label*="view" i]');
    for (const el of viewEls) {
      const fromKeyword = parseMetricFromLabel(el.getAttribute('aria-label') || '', 'views?');
      if (fromKeyword) return fromKeyword;
    }
    return 0;
  }

  function extractImages(article) {
    const urls = new Set();
    article.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="cardPhoto"] img').forEach(img => {
      let u = img.currentSrc || img.src || '';
      if (!u || u.includes('profile_images')) return;
      u = u.split('&name=')[0].split('?')[0];
      urls.add(u);
    });
    article.querySelectorAll('video[poster]').forEach(v => {
      const p = v.getAttribute('poster');
      if (p) urls.add(p.split('?')[0]);
    });
    return Array.from(urls).slice(0, 4);
  }

  function extractAuthor(article) {
    const userBlock = article.querySelector('[data-testid="User-Name"]');
    if (!userBlock) return { displayName: '', handle: '' };
    const links = userBlock.querySelectorAll('a[href^="/"]');
    let handle = '';
    for (const a of links) {
      const m = a.getAttribute('href').match(/^\/([A-Za-z0-9_]+)$/);
      if (m) { handle = '@' + m[1]; break; }
    }
    const spans = userBlock.querySelectorAll('span');
    const displayName = spans.length ? (spans[0].innerText || '').trim() : '';
    return { displayName, handle };
  }

  function extractPermalink(article) {
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (/\/status\/\d+$/.test(href)) {
        return 'https://x.com' + href;
      }
    }
    return '';
  }

  function extractTimestamp(article) {
    const time = article.querySelector('time');
    return time ? time.getAttribute('datetime') || '' : '';
  }

  // "Replying to @x, @y" — captured from the block X renders above tweetText.
  function extractReplyContext(article) {
    const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
    const articleText = article.innerText || '';
    if (!/Replying to/i.test(articleText)) return { isReply: false, replyingTo: [] };

    const handles = [];
    const links = article.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      if (tweetTextEl) {
        const pos = tweetTextEl.compareDocumentPosition(link);
        if (!(pos & Node.DOCUMENT_POSITION_PRECEDING)) continue;
      }
      const text = (link.innerText || link.textContent || '').trim();
      if (/^@[A-Za-z0-9_]{1,15}$/.test(text) && !handles.includes(text)) {
        handles.push(text);
      }
    }
    return { isReply: handles.length > 0, replyingTo: handles };
  }

  // Did this article still have an unexpanded "Show more" button?
  function isArticleTruncated(article) {
    return Boolean(article.querySelector('[data-testid="tweet-text-show-more-link"]'));
  }

  // X uses [data-testid="tweet-text-show-more-link"] for the inline expansion
  // button (NOT a navigation link). Clicking it expands the tweet text in place;
  // React then removes the button once the full text is rendered. The call is
  // idempotent — if a button somehow survives, the next tick re-clicks it.
  function expandTruncatedPosts(limit) {
    const buttons = document.querySelectorAll('[data-testid="tweet-text-show-more-link"]');
    let clicked = 0;
    for (const btn of buttons) {
      if (clicked >= limit) break;
      try {
        btn.click();
        clicked += 1;
      } catch (err) {
        // Best-effort — keep going.
      }
    }
    return clicked;
  }

  function extractArticle(article, ctx) {
    // Skip articles that still need expansion — pick them up after the click
    // has rendered on a later tick. This is what prevents truncated text from
    // being persisted as the final value.
    if (isArticleTruncated(article)) return null;

    const textEl = article.querySelector('[data-testid="tweetText"]');
    const text = textEl ? (textEl.innerText || textEl.textContent || '').trim() : '';
    const images = extractImages(article);
    if (!text && !images.length) return null;

    const permalink = extractPermalink(article);
    const id = permalink || (text || '').slice(0, 80) + ':' + (images[0] || '');
    if (seenIds.has(id)) return null;

    const { displayName, handle } = extractAuthor(article);

    // On the replies / media / likes tabs, X renders the parent tweet that the
    // user is replying to as a separate article above the user's own reply.
    // Filter to the profile owner only so we capture *their* replying style.
    if (
      ctx &&
      (ctx.pageType === 'profile_replies' || ctx.pageType === 'profile_media') &&
      ctx.handle
    ) {
      const ownerHandle = '@' + ctx.handle.toLowerCase();
      if ((handle || '').toLowerCase() !== ownerHandle) return null;
    }

    const replyCtx = extractReplyContext(article);

    // First try the role=group aria-label (most reliable on modern X).
    const group = extractGroupMetrics(article);

    const likes = (group && group.likes) || extractMetricByTestids(article, ['like', 'unlike']);
    const retweets =
      (group && group.retweets) ||
      extractMetricByTestids(article, ['retweet', 'unretweet']);
    const replies = (group && group.replies) || extractMetricByTestids(article, ['reply']);
    const bookmarks =
      (group && group.bookmarks) ||
      extractMetricByTestids(article, ['bookmark', 'removeBookmark']);
    const views = (group && group.views) || extractViews(article);
    const engagement = likes + retweets + replies + bookmarks;
    const engagementRatio = views > 0 ? engagement / views : 0;

    return {
      id,
      text,
      author: displayName,
      handle,
      permalink,
      postedAt: extractTimestamp(article),
      views,
      likes,
      retweets,
      replies,
      bookmarks,
      engagement,
      engagementRatio,
      images,
      isReply: replyCtx.isReply,
      replyingTo: replyCtx.replyingTo,
      capturedAt: new Date().toISOString()
    };
  }

  function harvest() {
    const ctx = pageContext();
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    articles.forEach(a => {
      try {
        const post = extractArticle(a, ctx);
        if (!post) return;
        seenIds.add(post.id);
        posts.push(post);
      } catch (err) {
        // Single-article failures shouldn't kill the loop.
        console.warn('[X Extractor] article parse error:', err);
      }
    });
  }

  function persist() {
    try {
      chrome.storage.local.set({
        extractedPosts: posts,
        extractionContext: pageContext(),
        extractionDone: !active
      });
    } catch {}
  }

  async function tick() {
    if (!active) return;

    // Inline-expand any truncated tweets so we capture their full text.
    // Cap per-tick clicks to avoid bombarding X with rapid-fire events.
    const expandedNow = expandTruncatedPosts(8);
    if (expandedNow > 0) {
      // Let React commit the expanded text before we read it.
      await new Promise(r => setTimeout(r, 450));
    }

    harvest();

    // Cap to keep memory in check on long sessions.
    if (posts.length > 2000) {
      posts.sort((a, b) => (b.views || 0) - (a.views || 0));
      posts = posts.slice(0, 2000);
    }

    persist();

    // Scroll to load more posts.
    window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });

    // Detect "we hit the bottom and stopped loading new posts".
    if (posts.length === lastCount) {
      stagnationCount += 1;
    } else {
      stagnationCount = 0;
      lastCount = posts.length;
    }

    if (stagnationCount >= 6) {
      stop();
    }
  }

  function start() {
    if (active) return;
    active = true;
    stagnationCount = 0;
    lastCount = 0;
    seenIds.clear();
    posts = [];
    persist();
    harvest();
    persist();
    intervalId = setInterval(tick, 2500);
  }

  function stop() {
    active = false;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    persist();
  }

  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (req.action === 'startExtraction') {
      start();
      sendResponse({ ok: true, context: pageContext() });
      return true;
    }
    if (req.action === 'stopExtraction') {
      stop();
      sendResponse({ ok: true });
      return true;
    }
    if (req.action === 'getExtraction') {
      sendResponse({
        ok: true,
        posts,
        active,
        context: pageContext()
      });
      return true;
    }
    return false;
  });
})();
