/**
 * August — Popup script
 */

const badge  = document.getElementById("badge");
const status = document.getElementById("status");

chrome.runtime.sendMessage({ type: "AUGUST_GET_STATE" }, (resp) => {
  const s = resp?.state;
  if (!s) return;
  badge.textContent = s.connected ? "● Connected" : "○ Off";
  badge.className   = "badge " + (s.connected ? "badge-ok" : "badge-err");
  status.textContent = s.status || "Idle";
});

document.getElementById("open-panel").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
  window.close();
});
