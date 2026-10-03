/**
 * August Extension — Enhanced Content Script (content.js)
 *
 * Handles DOM-level actions dispatched from background.js.
 * Features:
 *   - Semantic target resolution (site-aware)
 *   - Multi-strategy fallback (aria, role, text, CSS)
 *   - Scroll, click, type, extract, find
 *   - Reports results back via postMessage
 */

(function () {
  "use strict";

  if (window.__augustInjected) return;
  window.__augustInjected = true;

  // ── Site-specific selector maps ───────────────────────────────────────────

  const SITE_SELECTORS = {
    // YouTube
    "youtube.com": {
      first_video:      "ytd-video-renderer a#video-title, ytd-rich-item-renderer a#video-title",
      second_video:     "ytd-video-renderer:nth-of-type(2) a#video-title",
      third_video:      "ytd-video-renderer:nth-of-type(3) a#video-title",
      search_input:     "input#search",
      search_button:    "button#search-icon-legacy",
      play_button:      "button.ytp-play-button",
      pause_button:     "button.ytp-play-button",
      next_video:       "a.ytp-next-button",
      skip_ad:          "button.ytp-skip-ad-button, .ytp-ad-skip-button",
      subscribe:        "#subscribe-button tp-yt-paper-button",
      like_button:      "like-button-view-model button",
      fullscreen:       "button.ytp-fullscreen-button",
      mute:             "button.ytp-mute-button",
      first_result:     "ytd-video-renderer:first-of-type a#video-title",
      first_short:      "ytd-reel-shelf-renderer ytd-reel-item-renderer:first-of-type",
    },

    // Google Search
    "google.com": {
      search_input:     "textarea[name=q], input[name=q]",
      search_button:    "input[name=btnK], button[type=submit]",
      first_result:     "#search .g:first-of-type a[href]:not([href='#'])",
      second_result:    "#search .g:nth-of-type(2) a[href]:not([href='#'])",
      third_result:     "#search .g:nth-of-type(3) a[href]:not([href='#'])",
      images_tab:       "a[href*='tbm=isch']",
      news_tab:         "a[href*='tbm=nws']",
      videos_tab:       "a[href*='tbm=vid']",
    },

    // GitHub
    "github.com": {
      search_input:     "input[placeholder*='Search'], input[aria-label*='Search']",
      first_repo:       "li.repo-list-item a[href]:first-of-type",
      star_button:      "button[aria-label*='Star']",
      fork_button:      "button[aria-label*='Fork'], a[href*='/fork']",
      issues_tab:       "a[href$='/issues']",
      pr_tab:           "a[href$='/pulls']",
      code_tab:         "a[href$='#readme'], a[data-tab-item='code']",
    },

    // Reddit
    "reddit.com": {
      first_post:       "[data-testid='post-container']:first-of-type a[data-click-id='body']",
      search_input:     "input[placeholder*='Search']",
      upvote:           "button[aria-label='upvote']",
      next_page:        "a[rel='next']",
    },

    // Twitter / X
    "twitter.com": {
      tweet_input:      "[data-testid='tweetTextarea_0'], div[role='textbox']",
      search_input:     "input[data-testid='SearchBox_Search_Input']",
      first_tweet:      "article[data-testid='tweet']:first-of-type",
      like_button:      "[data-testid='like']:first-of-type",
      retweet:          "[data-testid='retweet']:first-of-type",
    },
    "x.com": {
      tweet_input:      "[data-testid='tweetTextarea_0'], div[role='textbox']",
      search_input:     "input[data-testid='SearchBox_Search_Input']",
      first_tweet:      "article[data-testid='tweet']:first-of-type",
      like_button:      "[data-testid='like']:first-of-type",
    },

    // Stack Overflow
    "stackoverflow.com": {
      search_input:     "input#q",
      first_answer:     ".answer:first-of-type",
      accept_answer:    ".js-accepted-answer",
      first_result:     ".question-summary:first-of-type a.question-hyperlink",
    },

    // Gmail
    "mail.google.com": {
      compose:          "[gh='cm'], div[data-tooltip='Compose']",
      search_input:     "input[aria-label='Search mail'], input[placeholder='Search mail']",
      first_email:      "tr.zA:first-of-type td.y6 span",
      inbox:            "a[href*='#inbox']",
    },
  };

  // ── Generic semantic targets (work on any site) ───────────────────────────

  const GENERIC_TARGETS = {
    // Inputs
    search_input:   () => findFirst([
      "input[type=search]", "input[name=q]",
      "textarea[name=q]", "input[placeholder*='search' i]",
      "input[aria-label*='search' i]",
    ]),
    text_input:     () => findFirst(["input[type=text]", "textarea"]),
    email_input:    () => findFirst(["input[type=email]"]),
    password_input: () => findFirst(["input[type=password]"]),
    url_input:      () => findFirst(["input[type=url]", "input[name=url]"]),

    // Buttons
    submit_button:  () => findFirst(["button[type=submit]", "input[type=submit]"]),
    search_button:  () => findFirst(["button[type=submit]", "[aria-label*='search' i]"]),
    close_button:   () => findFirst(["button[aria-label*='close' i]", "button[title*='close' i]", ".close"]),
    cancel_button:  () => findByText("button", "cancel"),
    confirm_button: () => findByText("button", ["confirm", "ok", "yes", "submit"]),
    back_button:    () => findFirst(["button[aria-label*='back' i]", "a[aria-label*='back' i]"]),
    next_button:    () => findFirst(["button[aria-label*='next' i]"]) || findByText("button", "next"),
    play_button:    () => findFirst(["button[aria-label*='play' i]", "button.play", "[class*='play']"]),
    pause_button:   () => findFirst(["button[aria-label*='pause' i]", "button.pause"]),
    menu_button:    () => findFirst(["button[aria-label*='menu' i]", "button[aria-haspopup]"]),

    // Navigation
    first_link:     () => document.querySelector("main a, article a, #content a") || document.querySelector("a"),
    first_result:   () => findFirst([
      "#search .g a", "[data-testid='result-title-a']",
      ".result__a", ".r a", "h3 > a",
    ]),
    second_result:  () => querySelectorAll_nth("#search .g a, h3 > a", 1),
    third_result:   () => querySelectorAll_nth("#search .g a, h3 > a", 2),
    first_video:    () => findFirst([
      "ytd-video-renderer a#video-title",
      "a[href*='/watch']",
      "[class*='video'] a",
    ]),
    first_image:    () => findFirst(["img[src]:not([src=''])", ".image a", "[class*='thumb'] a"]),

    // Page navigation
    next_page:      () => findFirst(["a[rel=next]", "a[aria-label*='next' i]"]) || findByText("a", "next"),
    prev_page:      () => findFirst(["a[rel=prev]", "a[aria-label*='previous' i]"]) || findByText("a", ["prev", "previous"]),
  };

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function findFirst(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) return el;
      } catch { /* invalid selector — skip */ }
    }
    return null;
  }

  function querySelectorAll_nth(selector, n) {
    const all = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    return all[n] || null;
  }

  function findByText(tag, texts) {
    const list = Array.isArray(texts) ? texts : [texts];
    const els  = Array.from(document.querySelectorAll(tag));
    for (const el of els) {
      const text = el.textContent.trim().toLowerCase();
      if (list.some(t => text.includes(t)) && isVisible(el)) return el;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getCurrentSiteKey() {
    const host = location.hostname;
    for (const key of Object.keys(SITE_SELECTORS)) {
      if (host.includes(key)) return key;
    }
    return null;
  }

  // ── Target resolver ───────────────────────────────────────────────────────

  function resolveTarget(target) {
    if (!target) return document.activeElement || document.body;

    const t = target.toLowerCase().trim();

    // 1. Direct CSS selector
    if (t.startsWith("#") || t.startsWith(".") || t.includes("[")) {
      return document.querySelector(target);
    }

    // 2. Site-specific selector
    const siteKey = getCurrentSiteKey();
    if (siteKey && SITE_SELECTORS[siteKey][t]) {
      const sel = SITE_SELECTORS[siteKey][t];
      const el  = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }

    // 3. Generic semantic target
    if (GENERIC_TARGETS[t]) {
      const el = GENERIC_TARGETS[t]();
      if (el) return el;
    }

    // 4. Ordinal: "video 2", "result 3"
    const ordinalMatch = t.match(/^(video|result|link|item)\s+(\d+)$/);
    if (ordinalMatch) {
      const type = ordinalMatch[1];
      const n    = parseInt(ordinalMatch[2]) - 1;
      const selectorMap = {
        video:  "ytd-video-renderer a#video-title, a[href*='/watch']",
        result: "#search .g a, h3 > a",
        link:   "a[href]",
        item:   "li a, [role='listitem'] a",
      };
      return querySelectorAll_nth(selectorMap[type] || "a", n);
    }

    // 5. Aria/title attribute fuzzy match
    const ariaEl = document.querySelector(
      `[aria-label*="${target}" i], [title*="${target}" i], [placeholder*="${target}" i]`
    );
    if (ariaEl && isVisible(ariaEl)) return ariaEl;

    // 6. Text content fuzzy match (buttons & links)
    return findByText("button, a", t);
  }

  // ── Action handlers ───────────────────────────────────────────────────────

  function handleClick(target) {
    const el = resolveTarget(target);
    if (!el) {
      return { ok: false, message: `Element not found: "${target}"` };
    }
    el.focus();
    el.click();
    // Scroll into view
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const label = el.textContent?.trim().slice(0, 60) || el.tagName;
    console.log("[August] Clicked:", label, el);
    return { ok: true, message: `Clicked: ${label}` };
  }

  function handleType(text, target) {
    const el = target ? resolveTarget(target) : document.activeElement;
    if (!el) {
      return { ok: false, message: `Type target not found: "${target}"` };
    }

    el.focus();

    // Support React/Vue controlled inputs
    const nativeInputSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement?.prototype, "value"
    )?.set;
    const nativeTextSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement?.prototype, "value"
    )?.set;

    if ("value" in el) {
      const setter = el.tagName === "TEXTAREA" ? nativeTextSetter : nativeInputSetter;
      if (setter) setter.call(el, (el.value || "") + text);
      else el.value = (el.value || "") + text;
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      document.execCommand("insertText", false, text);
    } else {
      return { ok: false, message: `Element is not typeable: ${el.tagName}` };
    }

    console.log("[August] Typed into:", el);
    return { ok: true, message: `Typed "${text}"` };
  }

  function handleClearAndType(text, target) {
    const el = target ? resolveTarget(target) : document.activeElement;
    if (!el) return { ok: false, message: `Target not found: "${target}"` };
    el.focus();
    if ("value" in el) el.value = "";
    return handleType(text, target);
  }

  function handleExtract(selector) {
    let el = selector ? document.querySelector(selector) : document.body;
    if (!el) el = document.body;
    const text = el.innerText || el.textContent || "";
    return {
      ok: true,
      message: `Extracted ${text.length} characters`,
      data: { text: text.slice(0, 5000), url: location.href, title: document.title },
    };
  }

  function handleFind(query) {
    // Find elements matching a text query — returns count + first element info
    const matches = Array.from(document.querySelectorAll("a, button, input, [role='button']"))
      .filter(el => {
        const text = (el.textContent || el.value || el.placeholder || el.getAttribute("aria-label") || "")
          .toLowerCase();
        return text.includes(query.toLowerCase()) && isVisible(el);
      });

    if (matches.length === 0) {
      return { ok: false, message: `No elements found matching "${query}"` };
    }

    matches[0].scrollIntoView({ behavior: "smooth", block: "center" });
    const info = matches.map(el => el.textContent?.trim().slice(0, 40) || el.tagName).slice(0, 5);
    return {
      ok: true,
      message: `Found ${matches.length} elements matching "${query}"`,
      data: { count: matches.length, matches: info },
    };
  }

  // ── Message listener ──────────────────────────────────────────────────────

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg?.type?.startsWith("AUGUST_")) return;

    let result;

    switch (msg.type) {
      case "AUGUST_CLICK":
        result = handleClick(msg.target);
        break;
      case "AUGUST_TYPE":
        result = handleType(msg.text, msg.target);
        break;
      case "AUGUST_CLEAR_TYPE":
        result = handleClearAndType(msg.text, msg.target);
        break;
      case "AUGUST_EXTRACT":
        result = handleExtract(msg.selector);
        break;
      case "AUGUST_FIND":
        result = handleFind(msg.query);
        break;
      default:
        result = { ok: false, message: `Unknown: ${msg.type}` };
    }

    // Post result back to background.js via executeScript callback pattern
    if (msg.msgId) {
      window.postMessage({ type: "AUGUST_RESULT", msgId: msg.msgId, result }, "*");
    }
  });

  // ── Text selection listener ───────────────────────────────────────────────
  // Debounced: only send after user stops selecting for 400ms

  let _selectionTimer = null;
  document.addEventListener("selectionchange", () => {
    clearTimeout(_selectionTimer);
    _selectionTimer = setTimeout(() => {
      const text = window.getSelection()?.toString().trim() || "";
      if (text.length > 2) {
        chrome.runtime.sendMessage({ type: "AUGUST_SELECTION", text });
      }
    }, 400);
  });

  console.log("[August] Content script v2 ready —", location.hostname);
})();

