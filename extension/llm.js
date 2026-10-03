/**
 * August Extension — In-Browser Local LLM Fallback (llm.js)
 *
 * Tier 2 Intelligence:
 *   1. Tries Chrome Built-in AI (Gemini Nano via window.ai) if available.
 *   2. Or queries local Ollama (http://127.0.0.1:11434) directly from browser.
 *
 * Runs 100% client-side with zero Python requirement.
 */

const ALLOWED_ACTIONS = [
  "OPEN_URL", "NEW_TAB", "TAB_CLOSE", "TAB_NEXT", "TAB_PREVIOUS",
  "RELOAD", "GO_BACK", "GO_FORWARD", "SCROLL", "SEARCH", "CLICK", "TYPE", "EXTRACT_TEXT"
];

const SYSTEM_PROMPT = `You are August, a Chrome browser voice agent.
Convert the user's voice command into a single JSON object.
RULES:
1. Output ONLY a single valid JSON object. No explanation, no markdown.
2. Allowed actions: ${ALLOWED_ACTIONS.join(", ")}.
3. Allowed search engines: google, youtube, bing, duckduckgo.
4. If unknown: {"action": "UNKNOWN"}

Examples:
"find jazz videos on youtube" -> {"action": "SEARCH", "engine": "youtube", "query": "jazz videos"}
"open chatgpt" -> {"action": "OPEN_URL", "url": "https://chat.openai.com"}
"scroll down" -> {"action": "SCROLL", "direction": "DOWN", "amount": 600}
"click the first video" -> {"action": "CLICK", "target": "first_video"}
"type hello into search" -> {"action": "TYPE", "text": "hello", "target": "search_input"}`;

export async function queryLocalLLM(text, context = {}) {
  const t0 = performance.now();

  let contextSnippet = "";
  if (context.title || context.url) {
    contextSnippet = `\nContext: Page "${context.title || ''}" (${context.url || ''})`;
  }

  // 1. Try Chrome Built-in AI (Gemini Nano)
  if (typeof window !== "undefined" && window.ai?.languageModel) {
    try {
      const session = await window.ai.languageModel.create({
        systemPrompt: SYSTEM_PROMPT,
      });
      const raw = await session.prompt(`Command: "${text}"${contextSnippet}\nJSON:`);
      session.destroy();
      const command = parseLLMResponse(raw);
      if (command) {
        return {
          command,
          tier: "gemini_nano",
          latencyMs: Math.round(performance.now() - t0),
        };
      }
    } catch (e) {
      console.warn("[August] Built-in AI error:", e);
    }
  }

  // 2. Fallback: Direct Local Ollama HTTP fetch (if running locally)
  try {
    const res = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2:1b",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Command: "${text}"${contextSnippet}\nJSON:` }
        ],
        stream: false,
        options: { temperature: 0.0 }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.message?.content || "";
      const command = parseLLMResponse(content);
      if (command) {
        return {
          command,
          tier: "ollama",
          latencyMs: Math.round(performance.now() - t0),
        };
      }
    }
  } catch (e) {
    // Ollama not running — that's fine, Tier 1 handled most
  }

  return { command: null, tier: "none", latencyMs: Math.round(performance.now() - t0) };
}

function parseLLMResponse(raw) {
  try {
    const cleaned = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const json = JSON.parse(match[0]);
    if (json.action && ALLOWED_ACTIONS.includes(json.action)) {
      return json;
    }
  } catch {}
  return null;
}
