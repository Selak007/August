/**
 * August Extension — Pure JavaScript Deterministic Router (router.js)
 *
 * Direct port of backend/commands/router.py into JavaScript.
 * Runs 100% in-browser inside the Chrome Extension with zero external servers.
 *
 * Tier 1: Sub-millisecond regex-based command matching.
 */

// ── Site Map & Aliases ────────────────────────────────────────────────────────

export const SITE_MAP = {
  "youtube":       "https://www.youtube.com",
  "google":        "https://www.google.com",
  "github":        "https://www.github.com",
  "gmail":         "https://mail.google.com",
  "twitter":       "https://www.twitter.com",
  "x":             "https://www.x.com",
  "reddit":        "https://www.reddit.com",
  "netflix":       "https://www.netflix.com",
  "wikipedia":     "https://www.wikipedia.org",
  "stackoverflow": "https://stackoverflow.com",
  "linkedin":      "https://www.linkedin.com",
  "amazon":        "https://www.amazon.com",
  "chatgpt":       "https://chat.openai.com",
  "smart":         "https://chat.openai.com",   // "open smart" -> ChatGPT
  "gpt":           "https://chat.openai.com",   // "open gpt"
  "copilot":       "https://copilot.microsoft.com",
  "gemini":        "https://gemini.google.com",
  "claude":        "https://claude.ai",
  "perplexity":    "https://www.perplexity.ai",
  "notion":        "https://www.notion.so",
  "spotify":       "https://www.spotify.com",
  "discord":       "https://discord.com",
  "whatsapp":      "https://web.whatsapp.com",
  "instagram":     "https://www.instagram.com",
  "figma":         "https://www.figma.com",
  "vercel":        "https://vercel.com",
  "huggingface":   "https://huggingface.co",
};

// ── Patterns Registry ─────────────────────────────────────────────────────────

const patterns = [
  // Open URL / Site
  {
    regex: /^(?:open|go to|navigate to|visit)\s+(.+)$/i,
    handler: (m) => {
      const target = m[1].trim().toLowerCase();
      // Check site map
      for (const [key, url] of Object.entries(SITE_MAP)) {
        if (target.includes(key)) {
          return { action: "OPEN_URL", url };
        }
      }
      // Looks like a domain/URL
      if (/\.\w{2,}/.test(target)) {
        const fullUrl = target.startsWith("http") ? target : `https://${target}`;
        return { action: "OPEN_URL", url: fullUrl };
      }
      return null;
    },
    desc: "open <site/url>",
  },

  // Tabs
  {
    regex: /^(?:new tab|open new tab|open a new tab)$/i,
    handler: () => ({ action: "NEW_TAB" }),
    desc: "new tab",
  },
  {
    regex: /^(?:close tab|close this tab|close current tab)$/i,
    handler: () => ({ action: "TAB_CLOSE" }),
    desc: "close tab",
  },
  {
    regex: /^(?:next tab|switch to next tab|tab right)$/i,
    handler: () => ({ action: "TAB_NEXT" }),
    desc: "next tab",
  },
  {
    regex: /^(?:previous tab|prev tab|switch to previous tab|tab left)$/i,
    handler: () => ({ action: "TAB_PREVIOUS" }),
    desc: "previous tab",
  },

  // History & Refresh
  {
    regex: /^(?:reload|refresh|reload page|refresh page)$/i,
    handler: () => ({ action: "RELOAD" }),
    desc: "reload",
  },
  {
    regex: /^(?:go back|back|navigate back|previous page)$/i,
    handler: () => ({ action: "GO_BACK" }),
    desc: "go back",
  },
  {
    regex: /^(?:go forward|forward|navigate forward|next page)$/i,
    handler: () => ({ action: "GO_FORWARD" }),
    desc: "go forward",
  },

  // Scrolling
  {
    regex: /^(?:scroll to top|go to top)$/i,
    handler: () => ({ action: "SCROLL", direction: "UP", amount: 9999 }),
    desc: "scroll to top",
  },
  {
    regex: /^(?:scroll to bottom|go to bottom)$/i,
    handler: () => ({ action: "SCROLL", direction: "DOWN", amount: 9999 }),
    desc: "scroll to bottom",
  },
  {
    regex: /^(?:scroll down|scroll down a bit|page down)(?:\s+(\d+))?$/i,
    handler: (m) => ({ action: "SCROLL", direction: "DOWN", amount: m[1] ? parseInt(m[1]) : 450 }),
    desc: "scroll down",
  },
  {
    regex: /^(?:scroll up|scroll up a bit|page up)(?:\s+(\d+))?$/i,
    handler: (m) => ({ action: "SCROLL", direction: "UP", amount: m[1] ? parseInt(m[1]) : 450 }),
    desc: "scroll up",
  },

  // Search
  {
    regex: /^search\s+(?:(?:on|in|using|with)\s+)?(google|youtube|bing|duckduckgo)\s+(?:for\s+)?(.+)$/i,
    handler: (m) => ({ action: "SEARCH", engine: m[1].toLowerCase(), query: m[2].trim() }),
    desc: "search <engine> for <query>",
  },
  {
    regex: /^search\s+(?:for\s+)?(.+)\s+(?:on|in|using|with)\s+(google|youtube|bing|duckduckgo)$/i,
    handler: (m) => ({ action: "SEARCH", engine: m[2].toLowerCase(), query: m[1].trim() }),
    desc: "search for <query> on <engine>",
  },
  {
    regex: /^(?:search youtube|youtube search)\s+(?:for\s+)?(.+)$/i,
    handler: (m) => ({ action: "SEARCH", engine: "youtube", query: m[1].trim() }),
    desc: "search youtube for <query>",
  },
  {
    regex: /^(?:search|google)\s+(?:for\s+)?(.+)$/i,
    handler: (m) => ({ action: "SEARCH", engine: "google", query: m[1].trim() }),
    desc: "search <query>",
  },

  // Click & Tap
  {
    regex: /^(?:click|press|tap|select|hit)\s+(?:the\s+)?(.+)$/i,
    handler: (m) => ({ action: "CLICK", target: m[1].trim().toLowerCase().replace(/\s+/g, "_") }),
    desc: "click <target>",
  },

  // Type & Input
  {
    regex: /^(?:type|write|enter|input)\s+["']?(.+?)["']?\s+(?:in(?:to)?|inside)\s+(?:the\s+)?(.+)$/i,
    handler: (m) => ({ action: "TYPE", text: m[1].trim(), target: m[2].trim().toLowerCase().replace(/\s+/g, "_") }),
    desc: "type <text> in <target>",
  },
  {
    regex: /^(?:type|write|enter|input)\s+["']?(.+?)["']?$/i,
    handler: (m) => ({ action: "TYPE", text: m[1].trim() }),
    desc: "type <text>",
  },

  // Extract / Read Page
  {
    regex: /^(?:extract text|get text|read page|read this page|what(?:'s| is) on this page)$/i,
    handler: () => ({ action: "EXTRACT_TEXT" }),
    desc: "extract text",
  },
];

// ── Public Router API ─────────────────────────────────────────────────────────

export function routeCommand(text) {
  const t0 = performance.now();
  const trimmed = (text || "").trim();

  if (!trimmed) {
    return { command: null, tier: "none", latencyMs: 0 };
  }

  for (const pat of patterns) {
    const match = trimmed.match(pat.regex);
    if (match) {
      const cmd = pat.handler(match);
      if (cmd) {
        const latencyMs = Number((performance.now() - t0).toFixed(2));
        return {
          command: cmd,
          tier: "deterministic",
          latencyMs,
          description: pat.desc,
        };
      }
    }
  }

  const latencyMs = Number((performance.now() - t0).toFixed(2));
  return { command: null, tier: "none", latencyMs };
}
