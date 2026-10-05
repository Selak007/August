/**
 * August Extension — Local LLM Fallback (llm.js)
 *
 * Tier 2 intelligence, only used when the deterministic router has no match:
 *   1. Chrome Built-in AI (Gemini Nano, Prompt API) when available.
 *   2. Local Ollama (http://127.0.0.1:11434) when running.
 *
 * Output is always passed through validateCommand() before execution.
 */

import { ALLOWED_ACTIONS, SEARCH_ENGINES, KEYS, MEDIA_OPS, validateCommand } from "./schema.js";

const LLM_ACTIONS = ALLOWED_ACTIONS.filter(a => a !== "STOP");

export const DEFAULT_LLM_SETTINGS = {
  llmEnabled: true,
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "llama3.2:1b",
};

const SYSTEM_PROMPT = `You are August, a Chrome browser voice agent.
Convert the user's voice command into a single JSON object.
RULES:
1. Output ONLY a single valid JSON object. No explanation, no markdown.
2. Allowed actions: ${LLM_ACTIONS.join(", ")}.
3. Allowed search engines: ${SEARCH_ENGINES.join(", ")}.
4. PRESS_KEY keys: ${KEYS.join(", ")}. MEDIA ops: ${MEDIA_OPS.join(", ")}.
5. Use the selected text from Context when the user says "this", "it" or "that".
6. If the command is not a browser action: {"action": "UNKNOWN"}

Examples:
"find jazz videos on youtube" -> {"action": "SEARCH", "engine": "youtube", "query": "jazz videos"}
"open chatgpt" -> {"action": "OPEN_URL", "url": "https://chatgpt.com"}
"scroll down" -> {"action": "SCROLL", "direction": "DOWN", "amount": 450}
"click the first video" -> {"action": "CLICK", "target": "first_video"}
"type hello into search" -> {"action": "TYPE", "text": "hello", "target": "search_input"}
"go to my second tab" -> {"action": "TAB_GOTO", "index": 2}
"jump ahead half a minute" -> {"action": "MEDIA", "op": "forward", "seconds": 30}
"make the text bigger" -> {"action": "ZOOM", "direction": "IN"}
"translate this" (selected: "bonjour") -> {"action": "SEARCH", "engine": "google", "query": "translate bonjour"}`;

function buildPrompt(text, context) {
  const lines = [`Command: "${text}"`];
  if (context.title || context.url) lines.push(`Context: page "${context.title || ""}" (${context.url || ""})`);
  if (context.selectedText) lines.push(`Selected text: "${context.selectedText.slice(0, 300)}"`);
  lines.push("JSON:");
  return lines.join("\n");
}

/** Prompt API: `LanguageModel` (Chrome 138+) or legacy `ai.languageModel`. */
function getBuiltInModel() {
  const g = globalThis;
  if (g.LanguageModel?.create) return g.LanguageModel;
  if (g.ai?.languageModel?.create) return g.ai.languageModel;
  return null;
}

async function queryBuiltIn(prompt) {
  const model = getBuiltInModel();
  if (!model) return null;
  const availability = await (model.availability?.() ?? model.capabilities?.().then(c => c.available));
  if (availability && !["available", "readily"].includes(availability)) return null;

  const session = await model.create({
    initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0,
    topK: 1,
  });
  try {
    return await session.prompt(prompt);
  } finally {
    session.destroy?.();
  }
}

async function queryOllama(prompt, settings) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${settings.ollamaUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.ollamaModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        format: "json",
        stream: false,
        options: { temperature: 0.0 },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

export async function queryLocalLLM(text, context = {}, settings = DEFAULT_LLM_SETTINGS) {
  const t0 = performance.now();
  const done = (command, tier) => ({ command, tier, latencyMs: Math.round(performance.now() - t0) });
  if (!settings.llmEnabled) return done(null, "disabled");

  const prompt = buildPrompt(text, context);

  try {
    const command = parseLLMResponse(await queryBuiltIn(prompt));
    if (command) return done(command, "gemini_nano");
  } catch (e) {
    console.warn("[August] Built-in AI error:", e);
  }

  try {
    const command = parseLLMResponse(await queryOllama(prompt, { ...DEFAULT_LLM_SETTINGS, ...settings }));
    if (command) return done(command, "ollama");
  } catch {
    // Ollama not running — fine, Tier 1 handles most commands.
  }

  return done(null, "none");
}

export function parseLLMResponse(raw) {
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```(?:json)?/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const json = JSON.parse(match[0]);
    if (!LLM_ACTIONS.includes(json.action)) return null;
    return validateCommand(json);
  } catch {
    return null;
  }
}
