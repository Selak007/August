/**
 * August Extension — Content Script (content.js)
 *
 * Executes DOM-level actions requested by background.js via chrome.runtime
 * messaging (pages cannot forge these, unlike window.postMessage).
 *
 *   AUGUST_CLICK   semantic / text / CSS target resolution, then click
 *   AUGUST_TYPE    type, clear, submit (React/Vue-safe)
 *   AUGUST_KEY     synthesize a key press on the focused element
 *   AUGUST_SCROLL  scroll the page or the main scrollable container
 *   AUGUST_MEDIA   play / pause / seek / speed on the page's main <video>/<audio>
 *   AUGUST_HINTS   numbered click labels ("show numbers", "click 7")
 *   AUGUST_EXTRACT readable page text or current selection
 *   AUGUST_FIND    find elements by text
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

    sign_in:        () => findFirst(["a[href*='signin' i]", "a[href*='login' i]", "button[aria-label*='sign in' i]"]) || findByText("a, button", ["sign in", "log in", "login"]),
    skip_ad:        () => findFirst([".ytp-skip-ad-button", ".ytp-ad-skip-button", "button[class*='skip' i]"]),

    // Page navigation
    next_page:      () => findFirst(["a[rel=next]", "a[aria-label*='next' i]"]) || findByText("a", "next"),
    prev_page:      () => findFirst(["a[rel=prev]", "a[aria-label*='previous' i]"]) || findByText("a", ["prev", "previous"]),
  };

  // ── DOM helpers ───────────────────────────────────────────────────────────

  const CLICKABLE = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    "[role=button]", "[role=link]", "[role=tab]", "[role=menuitem]", "[role=checkbox]",
    "[role=option]", "[role=switch]", "[contenteditable=true]", "[onclick]", "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  function findFirst(selectors) {
    for (const sel of selectors) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          if (isVisible(el)) return el;
        }
      } catch { /* invalid selector — skip */ }
    }
    return null;
  }

  function querySelectorAll_nth(selector, n) {
    const all = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    return all[n] || null;
  }

  function labelOf(el) {
    return (
      el.getAttribute?.("aria-label") ||
      el.innerText ||
      el.value ||
      el.getAttribute?.("title") ||
      el.getAttribute?.("placeholder") ||
      el.getAttribute?.("alt") ||
      ""
    ).replace(/\s+/g, " ").trim();
  }

  /** Best text match: exact label > starts-with > contains; shorter labels win ties. */
  function findByText(selector, texts) {
    const list = (Array.isArray(texts) ? texts : [texts]).map(t => t.toLowerCase());
    let best = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll(selector)) {
      if (!isVisible(el)) continue;
      const label = labelOf(el).toLowerCase();
      if (!label || label.length > 200) continue;
      for (const t of list) {
        let score = 0;
        if (label === t) score = 3;
        else if (label.startsWith(t)) score = 2;
        else if (label.includes(t)) score = 1;
        if (score) score += 1 / (1 + label.length);
        if (score > bestScore) { best = el; bestScore = score; }
      }
    }
    return best;
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  function getCurrentSiteKey() {
    const host = location.hostname;
    const keys = Object.keys(SITE_SELECTORS).sort((a, b) => b.length - a.length);
    return keys.find(key => host === key || host.endsWith("." + key)) || null;
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      return !/^(?:button|submit|checkbox|radio|file|image|reset|hidden|range|color)$/i.test(el.type);
    }
    return false;
  }

  // ── Target resolver ───────────────────────────────────────────────────────

  function resolveTarget(target, { editable = false } = {}) {
    if (!target) return document.activeElement || document.body;

    const t = target.toLowerCase().trim();
    const spoken = t.replace(/_/g, " ");

    // 1. Direct CSS selector
    if (/^[#.]/.test(t) || t.includes("[")) {
      try { return document.querySelector(target); } catch { return null; }
    }

    // 2. Site-specific selector
    const siteKey = getCurrentSiteKey();
    if (siteKey && SITE_SELECTORS[siteKey][t]) {
      const el = findFirst([SITE_SELECTORS[siteKey][t]]);
      if (el) return el;
    }

    // 3. Generic semantic target ("search_box" → search_input, etc.)
    const aliases = [t, t.replace(/_(?:box|bar|field)$/, "_input")];
    for (const key of aliases) {
      if (GENERIC_TARGETS[key]) {
        const el = GENERIC_TARGETS[key]();
        if (el) return el;
      }
      if (siteKey && SITE_SELECTORS[siteKey][key]) {
        const el = findFirst([SITE_SELECTORS[siteKey][key]]);
        if (el) return el;
      }
    }

    // 4. Ordinal: "video 2", "result 3"
    const ordinalMatch = spoken.match(/^(video|result|link|item)\s+(\d+)$/);
    if (ordinalMatch) {
      const selectorMap = {
        video:  "ytd-video-renderer a#video-title, a[href*='/watch']",
        result: "#search .g a h3, #search a h3, h3 > a",
        link:   "a[href]",
        item:   "li a, [role='listitem'] a",
      };
      const el = querySelectorAll_nth(selectorMap[ordinalMatch[1]] || "a", parseInt(ordinalMatch[2], 10) - 1);
      return el?.closest("a") || el;
    }

    // 5. Form fields by label/placeholder/name ("email", "password", "message")
    if (editable) {
      const words = spoken.replace(/\b(?:box|bar|field|input|area)\b/g, "").trim() || spoken;
      const fields = Array.from(document.querySelectorAll("input, textarea, [contenteditable=true], [role=textbox], [role=searchbox], [role=combobox]"))
        .filter(el => isVisible(el) && isEditable(el) || el.getAttribute("role"));
      const match = fields.find(el => {
        const label = [
          el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.name, el.id, el.type,
          el.labels?.[0]?.innerText,
        ].filter(Boolean).join(" ").toLowerCase();
        return label.includes(words);
      });
      if (match) return match;
    }

    // 6. Visible text / aria-label / title match (multi-word: "sign in", "add to cart")
    return findByText(editable ? "input, textarea, [contenteditable=true]" : CLICKABLE, spoken);
  }

  function activate(el) {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    flash(el);
    if (isEditable(el)) {
      el.focus();
      return;
    }
    el.focus?.({ preventScroll: true });
    el.click();
  }

  function flash(el) {
    const prev = el.style.outline;
    el.style.outline = "3px solid #8b5cf6";
    setTimeout(() => { el.style.outline = prev; }, 700);
  }

  // ── Action handlers ───────────────────────────────────────────────────────

  function handleClick(target) {
    const el = resolveTarget(target);
    if (!el) return { ok: false, message: `Couldn't find "${target.replace(/_/g, " ")}". Try "show numbers".` };
    activate(el);
    const label = labelOf(el).slice(0, 60) || el.tagName.toLowerCase();
    return { ok: true, message: `Clicked ${label}` };
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findTypeTarget(target) {
    if (target) return resolveTarget(target, { editable: true });
    const active = document.activeElement;
    if (isEditable(active)) return active;
    return GENERIC_TARGETS.search_input() || findFirst(["input[type=text]", "textarea", "[contenteditable=true]"]);
  }

  function handleType({ text = "", target, clear, submit }) {
    const el = findTypeTarget(target);
    if (!el) return { ok: false, message: target ? `Couldn't find the ${target.replace(/_/g, " ")}` : "No text field is focused" };
    if (!isEditable(el)) return { ok: false, message: `That element isn't a text field (${el.tagName.toLowerCase()})` };

    el.focus();
    if (el.isContentEditable) {
      if (clear) {
        document.execCommand("selectAll", false);
        document.execCommand("delete", false);
      }
      if (text) document.execCommand("insertText", false, text);
    } else {
      const base = clear ? "" : (el.value || "");
      const sep = base && text && !/\s$/.test(base) ? " " : "";
      setNativeValue(el, base + sep + text);
    }

    if (submit) submitField(el);
    const verb = text ? `Typed "${text.slice(0, 40)}"` : "Cleared field";
    return { ok: true, message: submit ? `${verb} and submitted` : verb };
  }

  function submitField(el) {
    pressKey(el, "Enter");
    const form = el.form || el.closest?.("form");
    if (form) {
      setTimeout(() => {
        if (!document.contains(form)) return;
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      }, 50);
    }
  }

  const KEY_CODES = {
    Enter: 13, Escape: 27, Tab: 9, Space: 32, Backspace: 8, Delete: 46,
    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
    PageUp: 33, PageDown: 34, Home: 36, End: 35,
  };

  function pressKey(el, key) {
    const init = {
      key: key === "Space" ? " " : key,
      code: key,
      keyCode: KEY_CODES[key],
      which: KEY_CODES[key],
      bubbles: true,
      cancelable: true,
    };
    const notCancelled = el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    return notCancelled;
  }

  function handleKey(key) {
    const el = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : document.body;
    const notCancelled = pressKey(el, key);

    // Synthetic events don't trigger browser defaults; emulate the useful ones.
    if (notCancelled) {
      const scroller = getScroller();
      const page = innerHeight * 0.85;
      const scrollKeys = {
        PageDown: [0, page], PageUp: [0, -page], Space: [0, page],
        ArrowDown: [0, 80], ArrowUp: [0, -80], ArrowRight: [80, 0], ArrowLeft: [-80, 0],
      };
      if (!isEditable(el) && scrollKeys[key]) {
        const [x, y] = scrollKeys[key];
        scroller.scrollBy({ left: x, top: y, behavior: "smooth" });
      } else if (!isEditable(el) && key === "Home") {
        scroller.scrollTo({ top: 0, behavior: "smooth" });
      } else if (!isEditable(el) && key === "End") {
        scroller.scrollTo({ top: scroller.scrollHeight || document.body.scrollHeight, behavior: "smooth" });
      } else if (key === "Tab") {
        focusNext(el);
      } else if (key === "Enter" && el !== document.body) {
        if (isEditable(el) && el.tagName !== "TEXTAREA") submitField(el);
        else if (!isEditable(el)) el.click?.();
      } else if (key === "Escape") {
        el.blur?.();
        removeHints();
      }
    }
    return { ok: true, message: `Pressed ${key}` };
  }

  function focusNext(from) {
    const focusable = Array.from(document.querySelectorAll(CLICKABLE)).filter(isVisible);
    const idx = focusable.indexOf(from);
    const next = focusable[(idx + 1) % focusable.length];
    next?.focus();
  }

  /** The element that actually scrolls (many apps scroll an inner container). */
  function getScroller() {
    const doc = document.scrollingElement || document.documentElement;
    if (doc.scrollHeight > innerHeight + 20) return { el: doc, scrollBy: o => window.scrollBy(o), scrollTo: o => window.scrollTo(o), scrollHeight: doc.scrollHeight };
    const candidates = Array.from(document.querySelectorAll("main, [role=main], div, section"))
      .filter(el => el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))
      .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    const el = candidates[0] || doc;
    return { el, scrollBy: o => el.scrollBy(o), scrollTo: o => el.scrollTo(o), scrollHeight: el.scrollHeight };
  }

  function handleScroll(direction, amount) {
    const scroller = getScroller();
    const big = amount >= 9999;
    if (big && direction === "UP") scroller.scrollTo({ top: 0, behavior: "smooth" });
    else if (big && direction === "DOWN") scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    else {
      const d = { UP: [0, -amount], DOWN: [0, amount], LEFT: [-amount, 0], RIGHT: [amount, 0] }[direction] || [0, amount];
      scroller.scrollBy({ left: d[0], top: d[1], behavior: "smooth" });
    }
    return { ok: true, message: big ? `Scrolled to ${direction === "UP" ? "top" : "bottom"}` : `Scrolled ${direction.toLowerCase()}` };
  }

  // ── Media ─────────────────────────────────────────────────────────────────

  function findMedia() {
    const media = Array.from(document.querySelectorAll("video, audio"));
    if (!media.length) return null;
    const playing = media.find(m => !m.paused && !m.ended);
    if (playing) return playing;
    return media
      .filter(m => m.tagName === "AUDIO" || isVisible(m))
      .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || media[0];
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }

  async function handleMedia({ op, seconds = 10, rate = 1 }) {
    const m = findMedia();
    if (!m) return { ok: false, message: "No video or audio found on this page" };
    switch (op) {
      case "play":    await m.play().catch(() => {}); return { ok: true, message: "Playing" };
      case "pause":   m.pause(); return { ok: true, message: "Paused" };
      case "toggle":
        if (m.paused) { await m.play().catch(() => {}); return { ok: true, message: "Playing" }; }
        m.pause(); return { ok: true, message: "Paused" };
      case "forward":
        m.currentTime = Math.min((m.duration || Infinity), m.currentTime + seconds);
        return { ok: true, message: `Skipped ahead ${seconds}s (${fmtTime(m.currentTime)})` };
      case "rewind":
        m.currentTime = Math.max(0, m.currentTime - seconds);
        return { ok: true, message: `Rewound ${seconds}s (${fmtTime(m.currentTime)})` };
      case "restart":
        m.currentTime = 0;
        await m.play().catch(() => {});
        return { ok: true, message: "Restarted" };
      case "speed":   m.playbackRate = rate; return { ok: true, message: `Speed ${rate}x` };
      case "faster":  m.playbackRate = Math.min(4, +(m.playbackRate + 0.25).toFixed(2)); return { ok: true, message: `Speed ${m.playbackRate}x` };
      case "slower":  m.playbackRate = Math.max(0.25, +(m.playbackRate - 0.25).toFixed(2)); return { ok: true, message: `Speed ${m.playbackRate}x` };
      default:        return { ok: false, message: `Unknown media op: ${op}` };
    }
  }

  // ── Numbered hints ("show numbers" → "click 7") ───────────────────────────

  let hintTargets = [];
  let hintLayer = null;

  function removeHints() {
    hintLayer?.remove();
    hintLayer = null;
  }

  function showHints() {
    removeHints();
    hintTargets = Array.from(document.querySelectorAll(CLICKABLE))
      .filter(el => isVisible(el) && inViewport(el) && !el.disabled)
      .filter((el, _, all) => !all.some(other => other !== el && other.contains(el) && other.matches("a[href], button")))
      .slice(0, 300);

    hintLayer = document.createElement("div");
    hintLayer.id = "__august_hints";
    const root = hintLayer.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      .h{position:fixed;z-index:2147483647;background:#7c3aed;color:#fff;font:700 11px/1.2 system-ui,sans-serif;
         padding:1px 4px;border-radius:4px;border:1px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);pointer-events:none}
    </style>`;
    hintTargets.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const tag = document.createElement("span");
      tag.className = "h";
      tag.textContent = String(i + 1);
      tag.style.top = `${Math.max(0, r.top - 4)}px`;
      tag.style.left = `${Math.max(0, r.left - 4)}px`;
      root.appendChild(tag);
    });
    document.documentElement.appendChild(hintLayer);
    return { ok: true, message: `Showing ${hintTargets.length} numbers — say "click" and a number` };
  }

  function clickHint(n) {
    const el = hintTargets[n - 1];
    if (!hintLayer || !el || !document.contains(el)) {
      if (!hintLayer) showHints();
      return { ok: false, message: hintLayer ? `No element numbered ${n}. Say "show numbers" to refresh.` : "Numbers shown — say the number again" };
    }
    removeHints();
    activate(el);
    return { ok: true, message: `Clicked ${n}: ${labelOf(el).slice(0, 50) || el.tagName.toLowerCase()}` };
  }

  function handleHints({ op, number }) {
    if (op === "show") return showHints();
    if (op === "hide") { removeHints(); return { ok: true, message: "Numbers hidden" }; }
    return clickHint(number);
  }

  addEventListener("scroll", () => { if (hintLayer) removeHints(); }, { passive: true, capture: true });

  // ── Reading ───────────────────────────────────────────────────────────────

  function readableText() {
    const root =
      document.querySelector("article") ||
      document.querySelector("main, [role=main]") ||
      document.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, nav, header, footer, aside, form, iframe, svg, [aria-hidden=true]")
      .forEach(n => n.remove());
    const text = (clone.innerText || clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
    return text.length > 200 ? text : (document.body.innerText || "").trim();
  }

  function handleExtract({ selector, source }) {
    let text;
    if (source === "selection") {
      text = window.getSelection()?.toString().trim() || "";
      if (!text) return { ok: false, message: "Nothing is selected" };
    } else if (selector) {
      let el = null;
      try { el = document.querySelector(selector); } catch { /* invalid selector */ }
      text = (el || document.body).innerText || "";
    } else {
      text = readableText();
    }
    return {
      ok: true,
      message: `Extracted ${text.length} characters`,
      data: { text: text.slice(0, 20000), url: location.href, title: document.title },
    };
  }

  function handleFind(query) {
    const q = (query || "").toLowerCase();
    const matches = Array.from(document.querySelectorAll("a, button, input, [role='button']"))
      .filter(el => isVisible(el) && labelOf(el).toLowerCase().includes(q));
    if (!matches.length) return { ok: false, message: `No elements found matching "${query}"` };
    matches[0].scrollIntoView({ behavior: "smooth", block: "center" });
    return {
      ok: true,
      message: `Found ${matches.length} elements matching "${query}"`,
      data: { count: matches.length, matches: matches.slice(0, 5).map(el => labelOf(el).slice(0, 40)) },
    };
  }

  // ── Message listener (extension-only channel) ─────────────────────────────

  async function handle(msg) {
    switch (msg.type) {
      case "AUGUST_PING":    return { ok: true, message: "pong" };
      case "AUGUST_CLICK":   return handleClick(msg.target);
      case "AUGUST_TYPE":    return handleType(msg);
      case "AUGUST_KEY":     return handleKey(msg.key);
      case "AUGUST_SCROLL":  return handleScroll(msg.direction, msg.amount);
      case "AUGUST_MEDIA":   return handleMedia(msg);
      case "AUGUST_HINTS":   return handleHints(msg);
      case "AUGUST_EXTRACT": return handleExtract(msg);
      case "AUGUST_FIND":    return handleFind(msg.query);
      default:               return { ok: false, message: `Unknown: ${msg.type}` };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg?.type?.startsWith("AUGUST_")) return false;
    if (msg.type === "AUGUST_SELECTION") return false;
    Promise.resolve()
      .then(() => handle(msg))
      .catch(e => ({ ok: false, message: e?.message || String(e) }))
      .then(sendResponse);
    return true;
  });

  // ── Text selection tracking (debounced) ───────────────────────────────────

  let _selectionTimer = null;
  document.addEventListener("selectionchange", () => {
    clearTimeout(_selectionTimer);
    _selectionTimer = setTimeout(() => {
      const text = window.getSelection()?.toString().trim() || "";
      try {
        chrome.runtime.sendMessage({ type: "AUGUST_SELECTION", text: text.slice(0, 5000) }).catch(() => {});
      } catch { /* extension reloaded — this orphaned script can't talk anymore */ }
    }, 400);
  });
})();
