/**
 * August — Popup script
 */

const badge  = document.getElementById("badge");
const status = document.getElementById("status");
const cmd    = document.getElementById("cmd");

const BACKEND_LABEL = {
  connected:  ["● Backend", "badge-ok"],
  connecting: ["◌ Connecting", "badge-warn"],
  offline:    ["○ Backend offline", "badge-err"],
  off:        ["● Standalone", "badge-ok"],
};

function render(s) {
  const [label, cls] = BACKEND_LABEL[s.backend] || BACKEND_LABEL.off;
  badge.textContent = s.listening ? "🎙 Listening" : label;
  badge.className = "badge " + (s.listening ? "badge-ok" : cls);
  status.textContent = s.lastError || s.status || "Ready";
}

chrome.runtime.sendMessage({ type: "AUGUST_GET_STATE" }, resp => {
  if (resp?.state) render(resp.state);
});
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "AUGUST_STATE" && msg.state) render(msg.state);
});

cmd.addEventListener("keydown", e => {
  if (e.key !== "Enter" || !cmd.value.trim()) return;
  chrome.runtime.sendMessage({ type: "AUGUST_VOICE_INPUT", text: cmd.value.trim(), origin: "typed" });
  cmd.value = "";
});

document.getElementById("open-panel").addEventListener("click", async () => {
  const win = await chrome.windows.getCurrent();
  await chrome.storage.session.set({ pendingListen: true });
  await chrome.sidePanel.open({ windowId: win.id });
  window.close();
});
