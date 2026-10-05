/**
 * August Extension — Deterministic Router (router.js)
 *
 * Tier 1: sub-millisecond regex-based command matching, 100% in-browser.
 * Kept in sync with backend/commands/router.py via tests/router_parity_cases.json.
 */

// ── Site Map & Aliases ────────────────────────────────────────────────────────

export const SITE_MAP = {
  "youtube":         "https://www.youtube.com",
  "youtube music":   "https://music.youtube.com",
  "google":          "https://www.google.com",
  "google docs":     "https://docs.google.com",
  "google drive":    "https://drive.google.com",
  "google maps":     "https://maps.google.com",
  "maps":            "https://maps.google.com",
  "google calendar": "https://calendar.google.com",
  "calendar":        "https://calendar.google.com",
  "github":          "https://www.github.com",
  "gmail":           "https://mail.google.com",
  "outlook":         "https://outlook.live.com",
  "twitter":         "https://www.twitter.com",
  "x":               "https://www.x.com",
  "reddit":          "https://www.reddit.com",
  "netflix":         "https://www.netflix.com",
  "twitch":          "https://www.twitch.tv",
  "wikipedia":       "https://www.wikipedia.org",
  "stackoverflow":   "https://stackoverflow.com",
  "hacker news":     "https://news.ycombinator.com",
  "linkedin":        "https://www.linkedin.com",
  "amazon":          "https://www.amazon.com",
  "chatgpt":         "https://chat.openai.com",
  "smart":           "https://chat.openai.com",   // "open smart" -> ChatGPT
  "gpt":             "https://chat.openai.com",
  "copilot":         "https://copilot.microsoft.com",
  "gemini":          "https://gemini.google.com",
  "claude":          "https://claude.ai",
  "perplexity":      "https://www.perplexity.ai",
  "notion":          "https://www.notion.so",
  "spotify":         "https://open.spotify.com",
  "discord":         "https://discord.com",
  "whatsapp":        "https://web.whatsapp.com",
  "instagram":       "https://www.instagram.com",
  "facebook":        "https://www.facebook.com",
  "figma":           "https://www.figma.com",
  "vercel":          "https://vercel.com",
  "huggingface":     "https://huggingface.co",
};

const SITE_KEYS_BY_LENGTH = Object.keys(SITE_MAP).sort((a, b) => b.length - a.length);

const ENGINES = "google|youtube|bing|duckduckgo|amazon|wikipedia|github|reddit|maps|stack ?overflow";

const KEY_NAMES = {
  "enter": "Enter", "return": "Enter",
  "escape": "Escape", "esc": "Escape",
  "tab": "Tab", "space": "Space", "spacebar": "Space",
  "backspace": "Backspace", "delete": "Delete",
  "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight",
  "arrow up": "ArrowUp", "arrow down": "ArrowDown", "arrow left": "ArrowLeft", "arrow right": "ArrowRight",
  "page up": "PageUp", "page down": "PageDown", "home": "Home", "end": "End",
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, last: -1,
  // Common speech-recognition homophones
  to: 2, too: 2, for: 4, won: 1,
};

const NUM = `(\\d+(?:st|nd|rd|th)?|${Object.keys(NUMBER_WORDS).join("|")})`;

// A "type X in Y" target must look like a form field, so "type I live in London" types the whole phrase.
const FIELD_NOUNS = "search|box|bar|field|input|textbox|text box|area|textarea|editor|form|email|password|username|name|comment|message|address|url|title|subject|description|chat";

const DEICTIC = /^(?:this|that|it|selection|the selection|selected text|the selected text|highlighted text|the highlighted text|what i selected)$/i;

export function parseNumber(raw) {
  const s = String(raw || "").trim().toLowerCase();
  const m = s.match(/^(\d+)(?:st|nd|rd|th)?$/);
  if (m) return parseInt(m[1], 10);
  return Object.prototype.hasOwnProperty.call(NUMBER_WORDS, s) ? NUMBER_WORDS[s] : null;
}

function underscore(s) {
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function engineName(raw) {
  return raw.toLowerCase().replace(/\s+/g, "");
}

// ── Utterance normalization ───────────────────────────────────────────────────

const WAKE_WORD = /^(?:(?:hey|hi|ok|okay|yo)\s+)?august\b[\s,]*/i;
const POLITE_PREFIX = /^(?:please|can you|could you|would you|will you|i want to|i'd like to|i would like to|let's|lets)\s+/i;
const POLITE_SUFFIX = /\s+(?:please|for me)$/i;
const TYPE_PREFIX = /^(?:type|write|input|enter)\s+\S/i;

export function normalizeUtterance(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!TYPE_PREFIX.test(t)) t = t.replace(/[.!?,;:]+$/, "").trim();
  let prev;
  do {
    prev = t;
    const stripped = t.replace(WAKE_WORD, "");
    if (stripped) t = stripped.trim();
    t = t.replace(POLITE_PREFIX, "").trim();
  } while (t !== prev);
  if (!TYPE_PREFIX.test(t)) {
    t = t.replace(/[.!?,;:]+$/, "").trim();
    do {
      prev = t;
      t = t.replace(POLITE_SUFFIX, "").trim();
    } while (t !== prev);
  }
  return t;
}

// ── Site resolution ───────────────────────────────────────────────────────────

export function resolveSiteUrl(target) {
  let t = String(target || "").toLowerCase().trim()
    .replace(/^(?:the|my)\s+/, "")
    .replace(/\s+(?:website|web site|site|homepage|home page|page|app)$/, "")
    .replace(/\s+dot\s+/g, ".")
    .trim();
  if (!t) return null;

  const bare = t.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  for (const candidate of [t, t.replace(/\s+/g, ""), bare.replace(/\.com$/, "")]) {
    if (Object.prototype.hasOwnProperty.call(SITE_MAP, candidate)) return SITE_MAP[candidate];
  }

  if (/^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:\/\S*)?$/.test(t)) {
    return t.startsWith("http") ? t : `https://${t}`;
  }

  for (const key of SITE_KEYS_BY_LENGTH) {
    if (key.length < 3) continue;
    if (new RegExp(`\\b${escapeRegex(key)}\\b`).test(t)) return SITE_MAP[key];
  }
  return null;
}

// ── Patterns Registry ─────────────────────────────────────────────────────────
// Order matters: first match whose handler returns a command wins.

const patterns = [
  // Meta
  {
    regex: /^(?:help|what can i say|what can you do|show (?:me )?(?:the |all )?commands|list (?:all )?commands|commands)$/i,
    handler: () => ({ action: "HELP" }),
    desc: "help",
  },
  {
    regex: /^(?:stop|stop (?:reading|talking|speaking)|be quiet|quiet|shut up|silence|cancel|never mind|nevermind)$/i,
    handler: () => ({ action: "STOP" }),
    desc: "stop",
  },

  // Click-by-number hints
  {
    regex: /^(?:show|display)(?: the)? (?:numbers|labels|hints|links|clickables|clickable elements)$/i,
    handler: () => ({ action: "HINTS", op: "show" }),
    desc: "show numbers",
  },
  {
    regex: /^(?:hide|remove|clear)(?: the)? (?:numbers|labels|hints|links)$/i,
    handler: () => ({ action: "HINTS", op: "hide" }),
    desc: "hide numbers",
  },
  {
    regex: new RegExp(`^(?:(?:click|press|tap|select|hit|choose|pick)(?: on)?(?: number)?|number|hint) ${NUM}$`, "i"),
    handler: (m) => {
      const n = parseNumber(m[1]);
      return n && n > 0 ? { action: "HINTS", op: "click", number: n } : null;
    },
    desc: "click <number>",
  },
  {
    regex: /^(\d{1,3})$/,
    handler: (m) => ({ action: "HINTS", op: "click", number: parseInt(m[1], 10) }),
    desc: "<number>",
  },

  // Tabs & windows
  {
    regex: /^(?:new tab|open new tab|open a new tab|open tab)$/i,
    handler: () => ({ action: "NEW_TAB" }),
    desc: "new tab",
  },
  {
    regex: /^(?:open )?(?:a )?(?:new )?(?:incognito|private)(?: window| mode| tab)?$/i,
    handler: () => ({ action: "NEW_WINDOW", incognito: true }),
    desc: "new incognito window",
  },
  {
    regex: /^(?:open )?(?:a )?new window$/i,
    handler: () => ({ action: "NEW_WINDOW", incognito: false }),
    desc: "new window",
  },
  {
    regex: /^(?:close (?:all )?(?:the )?other tabs|close all tabs except (?:this|this one|the current one|current))$/i,
    handler: () => ({ action: "TAB_CLOSE_OTHERS" }),
    desc: "close other tabs",
  },
  {
    regex: /^(?:close tab|close this tab|close current tab|close the tab|close the current tab)$/i,
    handler: () => ({ action: "TAB_CLOSE" }),
    desc: "close tab",
  },
  {
    regex: /^(?:reopen|restore|undo close|bring back|reopen closed|reopen last)(?: the)?(?: last)?(?: closed)? tab$/i,
    handler: () => ({ action: "TAB_REOPEN" }),
    desc: "reopen closed tab",
  },
  {
    regex: /^duplicate(?: this| the| current)?(?: tab)?$/i,
    handler: () => ({ action: "TAB_DUPLICATE" }),
    desc: "duplicate tab",
  },
  {
    regex: /^(pin|unpin)(?: this| the| current)? tab$/i,
    handler: (m) => ({ action: "TAB_PIN", pinned: m[1].toLowerCase() === "pin" }),
    desc: "pin / unpin tab",
  },
  {
    regex: /^(mute|unmute)(?: this| the| current)?(?: tab| page| site| video| audio| sound)?$/i,
    handler: (m) => ({ action: "TAB_MUTE", muted: m[1].toLowerCase() === "mute" }),
    desc: "mute / unmute tab",
  },
  {
    regex: /^(?:next tab|switch to next tab|switch to the next tab|go to next tab|go to the next tab|tab right)$/i,
    handler: () => ({ action: "TAB_NEXT" }),
    desc: "next tab",
  },
  {
    regex: /^(?:previous tab|prev tab|switch to previous tab|switch to the previous tab|go to previous tab|go to the previous tab|tab left)$/i,
    handler: () => ({ action: "TAB_PREVIOUS" }),
    desc: "previous tab",
  },
  {
    regex: new RegExp(`^(?:(?:go|switch|jump|move) to )?(?:the )?tab (?:number )?${NUM}$`, "i"),
    handler: (m) => {
      const n = parseNumber(m[1]);
      return n ? { action: "TAB_GOTO", index: n } : null;
    },
    desc: "tab <n>",
  },
  {
    regex: new RegExp(`^(?:(?:go|switch|jump|move) to )?(?:the )?${NUM} tab$`, "i"),
    handler: (m) => {
      const n = parseNumber(m[1]);
      return n ? { action: "TAB_GOTO", index: n } : null;
    },
    desc: "<nth> tab",
  },
  {
    regex: /^(?:switch|jump|change) to (?:the )?(.+?)(?: tab)?$/i,
    handler: (m) => ({ action: "TAB_GOTO", query: m[1].trim() }),
    desc: "switch to <tab name>",
  },
  {
    regex: /^(?:go to|find|show) (?:the |my )?(.+?) tab$/i,
    handler: (m) => ({ action: "TAB_GOTO", query: m[1].trim() }),
    desc: "go to <name> tab",
  },

  // History & refresh
  {
    regex: /^(?:reload|refresh)(?: the| this)?(?: page| tab)?$/i,
    handler: () => ({ action: "RELOAD" }),
    desc: "reload",
  },

  // Media (before back/forward so "go back 10 seconds" seeks)
  {
    regex: /^(?:play|resume|unpause|continue)(?: the)?(?: video| music| audio| song| media)?$/i,
    handler: () => ({ action: "MEDIA", op: "play" }),
    desc: "play",
  },
  {
    regex: /^(?:pause|pause (?:the )?(?:video|music|audio|song|media)|stop (?:the )?(?:video|music|audio|song|media|playback))$/i,
    handler: () => ({ action: "MEDIA", op: "pause" }),
    desc: "pause",
  },
  {
    regex: /^(?:play|watch|listen to) (.+?) on youtube$/i,
    handler: (m) => ({ action: "SEARCH", engine: "youtube", query: m[1].trim() }),
    desc: "play <query> on youtube",
  },
  {
    regex: new RegExp(`^(?:skip|fast forward|jump|seek)(?: ahead| forward)?(?: by)?(?: ${NUM}(?: seconds?| secs?| s)?)?$`, "i"),
    handler: (m) => ({ action: "MEDIA", op: "forward", seconds: m[1] ? parseNumber(m[1]) || 10 : 10 }),
    desc: "skip forward [n seconds]",
  },
  {
    regex: new RegExp(`^(?:go )?forward ${NUM} ?(?:seconds?|secs?|s)$`, "i"),
    handler: (m) => ({ action: "MEDIA", op: "forward", seconds: parseNumber(m[1]) || 10 }),
    desc: "forward <n> seconds",
  },
  {
    regex: new RegExp(`^(?:rewind|skip back(?:wards?)?|jump back|seek back)(?: by)?(?: ${NUM}(?: seconds?| secs?| s)?)?$`, "i"),
    handler: (m) => ({ action: "MEDIA", op: "rewind", seconds: m[1] ? parseNumber(m[1]) || 10 : 10 }),
    desc: "rewind [n seconds]",
  },
  {
    regex: new RegExp(`^(?:go )?back ${NUM} ?(?:seconds?|secs?|s)$`, "i"),
    handler: (m) => ({ action: "MEDIA", op: "rewind", seconds: parseNumber(m[1]) || 10 }),
    desc: "back <n> seconds",
  },
  {
    regex: /^(?:restart|replay|start over)(?: the)?(?: video| song)?$/i,
    handler: () => ({ action: "MEDIA", op: "restart" }),
    desc: "restart video",
  },
  {
    regex: /^(?:set )?(?:the )?(?:playback )?speed(?: to)? (\d+(?:\.\d+)?)(?: ?x| times)?$/i,
    handler: (m) => ({ action: "MEDIA", op: "speed", rate: parseFloat(m[1]) }),
    desc: "speed <rate>",
  },
  {
    regex: /^(?:normal speed|reset speed|speed normal)$/i,
    handler: () => ({ action: "MEDIA", op: "speed", rate: 1 }),
    desc: "normal speed",
  },
  {
    regex: /^(?:play )?(faster|slower)$|^speed (up)$|^slow (down)$/i,
    handler: (m) => ({ action: "MEDIA", op: (m[1] || (m[2] ? "faster" : "slower")).toLowerCase() === "faster" ? "faster" : "slower" }),
    desc: "faster / slower",
  },

  {
    regex: /^skip (?:the )?ads?$/i,
    handler: () => ({ action: "CLICK", target: "skip_ad" }),
    desc: "skip ad",
  },

  // Navigation history
  {
    regex: /^(?:go back|back|navigate back|previous page|go to (?:the )?previous page)$/i,
    handler: () => ({ action: "GO_BACK" }),
    desc: "go back",
  },
  {
    regex: /^(?:go forward|forward|navigate forward|next page|go to (?:the )?next page)$/i,
    handler: () => ({ action: "GO_FORWARD" }),
    desc: "go forward",
  },

  // Zoom & window
  {
    regex: /^zoom (in|out)$/i,
    handler: (m) => ({ action: "ZOOM", direction: m[1].toUpperCase() }),
    desc: "zoom in / out",
  },
  {
    regex: /^(?:make (?:it|the page|the text|text) )?(bigger|larger|smaller)$/i,
    handler: (m) => ({ action: "ZOOM", direction: m[1].toLowerCase() === "smaller" ? "OUT" : "IN" }),
    desc: "bigger / smaller",
  },
  {
    regex: /^(?:reset zoom|zoom reset|actual size|normal size|zoom (?:to )?(?:normal|default|100(?: percent|%)?))$/i,
    handler: () => ({ action: "ZOOM", direction: "RESET" }),
    desc: "reset zoom",
  },
  {
    regex: /^(?:exit|leave|close|stop) full ?screen(?: mode)?$/i,
    handler: () => ({ action: "FULLSCREEN", enabled: false }),
    desc: "exit fullscreen",
  },
  {
    regex: /^(?:enter |go |toggle |make it )?full ?screen(?: mode)?$/i,
    handler: () => ({ action: "FULLSCREEN" }),
    desc: "fullscreen",
  },

  // Scrolling
  {
    regex: /^(?:scroll to (?:the )?top|go to (?:the )?top|top of (?:the )?page)$/i,
    handler: () => ({ action: "SCROLL", direction: "UP", amount: 9999 }),
    desc: "scroll to top",
  },
  {
    regex: /^(?:scroll to (?:the )?bottom|go to (?:the )?bottom|bottom of (?:the )?page)$/i,
    handler: () => ({ action: "SCROLL", direction: "DOWN", amount: 9999 }),
    desc: "scroll to bottom",
  },
  {
    regex: new RegExp(`^(?:scroll|page) (down|up|left|right)(?: a bit| a little| a lot| more)?(?: by)?(?: ${NUM})?(?: times| pages| screens| pixels)?$`, "i"),
    handler: (m) => {
      const direction = m[1].toUpperCase();
      const full = m[0].toLowerCase();
      let amount = full.includes("a lot") ? 1200 : full.includes("a bit") || full.includes("a little") ? 200 : 450;
      if (m[2]) {
        const n = parseNumber(m[2]);
        if (n && n > 0) amount = n <= 20 ? n * 450 : n;
      }
      return { action: "SCROLL", direction, amount };
    },
    desc: "scroll <direction> [amount]",
  },

  // Search
  {
    regex: new RegExp(`^(?:search|google|look up|look for|find)(?: for| up)? (.+?)(?: (?:on|in|using|with) (${ENGINES}))?$`, "i"),
    handler: (m, ctx) => {
      if (!DEICTIC.test(m[1].trim())) return null;
      const sel = (ctx.selectedText || "").trim();
      if (!sel) return null;
      return { action: "SEARCH", engine: m[2] ? engineName(m[2]) : "google", query: sel.slice(0, 500) };
    },
    desc: "search for this (selected text)",
  },
  {
    regex: new RegExp(`^search (?:(?:on|in|using|with) )?(${ENGINES}) (?:for )?(.+)$`, "i"),
    handler: (m) => ({ action: "SEARCH", engine: engineName(m[1]), query: m[2].trim() }),
    desc: "search <engine> for <query>",
  },
  {
    regex: new RegExp(`^(?:search|look up|look for|find)(?: for)? (.+) (?:on|in|using|with) (${ENGINES})$`, "i"),
    handler: (m) => ({ action: "SEARCH", engine: engineName(m[2]), query: m[1].trim() }),
    desc: "search for <query> on <engine>",
  },
  {
    regex: /^(?:search youtube|youtube search) (?:for )?(.+)$/i,
    handler: (m) => ({ action: "SEARCH", engine: "youtube", query: m[1].trim() }),
    desc: "search youtube for <query>",
  },
  {
    regex: /^(?:search|google|look up)(?: for)? (.+)$/i,
    handler: (m) => (DEICTIC.test(m[1].trim()) ? null : { action: "SEARCH", engine: "google", query: m[1].trim() }),
    desc: "search <query>",
  },

  // Keys & forms (before click, since "press enter" would match click)
  {
    regex: /^(?:press|hit|tap|push)(?: the)? (enter|return|escape|esc|tab|space|spacebar|backspace|delete|up|down|left|right|arrow up|arrow down|arrow left|arrow right|page up|page down|home|end)(?: key| button)?$/i,
    handler: (m) => ({ action: "PRESS_KEY", key: KEY_NAMES[m[1].toLowerCase()] }),
    desc: "press <key>",
  },
  {
    regex: /^(?:enter|escape|submit|submit (?:the |this )?form)$/i,
    handler: (m) => ({ action: "PRESS_KEY", key: m[0].toLowerCase() === "escape" ? "Escape" : "Enter" }),
    desc: "submit / escape",
  },

  // Click & tap
  {
    regex: /^(?:click|press|tap|select|hit)(?: on)? (?:the )?(.+)$/i,
    handler: (m) => ({ action: "CLICK", target: underscore(m[1]) }),
    desc: "click <target>",
  },

  // Type & input
  {
    regex: /^(?:clear|erase|empty)(?: the| this)? (search box|search bar|search field|search input|search|input|field|text box|textbox|box)$/i,
    handler: (m) => ({ action: "TYPE", text: "", clear: true, target: underscore(m[1]) }),
    desc: "clear <field>",
  },
  {
    regex: new RegExp(`^(?:type|write|enter|input) ["']?(.+?)["']? (?:in(?:to)?|inside) (?:the )?((?:[\\w-]+ )?(?:${FIELD_NOUNS}))(?: and (?:press enter|hit enter|submit|search|send))?$`, "i"),
    handler: (m) => {
      const cmd = { action: "TYPE", text: m[1].trim(), target: underscore(m[2]) };
      if (/ and (?:press enter|hit enter|submit|search|send)$/i.test(m[0])) cmd.submit = true;
      return cmd;
    },
    desc: "type <text> in <target> [and submit]",
  },
  {
    regex: /^(?:type|write|enter|input) ["']?(.+?)["']? and (?:press enter|hit enter|submit|search|send)$/i,
    handler: (m) => ({ action: "TYPE", text: m[1].trim(), submit: true }),
    desc: "type <text> and submit",
  },
  {
    regex: /^(?:type|write|enter|input) ["']?(.+?)["']?$/i,
    handler: (m) => ({ action: "TYPE", text: m[1].trim() }),
    desc: "type <text>",
  },

  // Read / extract
  {
    regex: /^(?:read|read out|read aloud)(?: the| this| my)? (?:selection|selected text|highlighted text|what i selected)(?: aloud| out loud)?$/i,
    handler: () => ({ action: "EXTRACT_TEXT", source: "selection", speak: true }),
    desc: "read selection",
  },
  {
    regex: /^(?:read (?:this|it)|read (?:this|it) (?:aloud|out loud))$/i,
    handler: (m, ctx) => ({ action: "EXTRACT_TEXT", source: (ctx.selectedText || "").trim() ? "selection" : "page", speak: true }),
    desc: "read this",
  },
  {
    regex: /^(?:read page|read this page|read the page|read (?:the |this )?article|read aloud|read (?:the |this )?page (?:aloud|out loud)|what(?:'s| is) on (?:this|the) page)$/i,
    handler: () => ({ action: "EXTRACT_TEXT", source: "page", speak: true }),
    desc: "read page aloud",
  },
  {
    regex: /^(?:extract text|get text|get (?:the )?page text|extract (?:the )?page text)$/i,
    handler: () => ({ action: "EXTRACT_TEXT", source: "page" }),
    desc: "extract text",
  },

  // Open URL / site (last: generic "open <x>")
  {
    regex: /^(?:open|go to|navigate to|visit|launch|take me to|show me)(?: up)? (.+)$/i,
    handler: (m) => {
      const url = resolveSiteUrl(m[1]);
      return url ? { action: "OPEN_URL", url } : null;
    },
    desc: "open <site/url>",
  },
];

// ── Help text (shown in side panel for "help") ────────────────────────────────

export const COMMAND_HELP = [
  { group: "Navigate", examples: ["open youtube", "go to python.org", "go back", "reload", "search amazon for headphones", "search for this (with text selected)"] },
  { group: "Tabs", examples: ["new tab", "close tab", "next tab", "tab 3", "switch to gmail", "reopen closed tab", "close other tabs", "mute tab", "pin tab", "duplicate tab", "new incognito window"] },
  { group: "Page", examples: ["scroll down", "scroll down 3", "scroll to top", "zoom in", "reset zoom", "fullscreen", "read page", "read selection", "stop"] },
  { group: "Click & type", examples: ["show numbers", "click 12", "hide numbers", "click sign in", "click the second result", "type hello in search box", "type cats and submit", "press enter", "clear search box"] },
  { group: "Media", examples: ["play", "pause", "skip 30 seconds", "rewind", "speed 1.5", "faster", "restart video", "play lofi beats on youtube"] },
];

// ── Public Router API ─────────────────────────────────────────────────────────

/**
 * @param {string} text  Raw transcript.
 * @param {{selectedText?: string}} [context]  Live browser context.
 */
export function routeCommand(text, context = {}) {
  const t0 = performance.now();
  const normalized = normalizeUtterance(text);

  if (!normalized) {
    return { command: null, tier: "none", latencyMs: 0, normalized };
  }

  for (const pat of patterns) {
    const match = normalized.match(pat.regex);
    if (!match) continue;
    const cmd = pat.handler(match, context || {});
    if (cmd) {
      return {
        command: cmd,
        tier: "deterministic",
        latencyMs: Number((performance.now() - t0).toFixed(2)),
        description: pat.desc,
        normalized,
      };
    }
  }

  return { command: null, tier: "none", latencyMs: Number((performance.now() - t0).toFixed(2)), normalized };
}
