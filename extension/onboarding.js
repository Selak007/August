/**
 * August Onboarding Walkthrough (onboarding.js)
 *
 * Guides new users through:
 * 1. Privacy promise
 * 2. Microphone permission grant + live VU meter test
 * 3. Pinning & keyboard shortcuts
 * 4. Interactive voice command playground (using router.js)
 * 5. Completion & launching the side panel
 */

import { routeCommand } from "./router.js";

let currentStep = 1;
const TOTAL_STEPS = 5;

// Audio context & VU meter
let audioCtx = null;
let micStream = null;
let analyser = null;
let animFrameId = null;

// Speech recognition for playground
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListeningPlayground = false;

function $(id) {
  return document.getElementById(id);
}

function showStep(step) {
  if (step < 1 || step > TOTAL_STEPS) return;
  currentStep = step;

  // Update tabs
  document.querySelectorAll(".step-tab").forEach(tab => {
    const tabStep = Number(tab.getAttribute("data-step"));
    tab.classList.toggle("active", tabStep === currentStep);
    tab.classList.toggle("completed", tabStep < currentStep);
  });

  // Update cards
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const card = $(`step-card-${i}`);
    if (card) card.style.display = i === currentStep ? "flex" : "none";
  }

  // Auto-check mic if entering step 2
  if (currentStep === 2) {
    checkExistingMicPermission();
  }
}

// ── Step Navigation Events ────────────────────────────────────────────────────

document.querySelectorAll(".step-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const targetStep = Number(tab.getAttribute("data-step"));
    showStep(targetStep);
  });
});

$("btn-next-1")?.addEventListener("click", () => showStep(2));
$("btn-prev-2")?.addEventListener("click", () => showStep(1));
$("btn-next-2")?.addEventListener("click", () => showStep(3));
$("btn-prev-3")?.addEventListener("click", () => showStep(2));
$("btn-next-3")?.addEventListener("click", () => showStep(4));
$("btn-prev-4")?.addEventListener("click", () => showStep(3));
$("btn-next-4")?.addEventListener("click", () => showStep(5));

// ── Step 2: Microphone Permission & VU Meter ──────────────────────────────────

async function checkExistingMicPermission() {
  if (!navigator.permissions?.query) return;
  try {
    const perm = await navigator.permissions.query({ name: "microphone" });
    if (perm.state === "granted") {
      onMicGranted();
    }
  } catch {}
}

async function requestMic() {
  const statusEl = $("mic-perm-status");
  const btn = $("btn-grant-mic");

  try {
    statusEl.textContent = "Requesting permission…";
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    onMicGranted();
  } catch (err) {
    statusEl.innerHTML = `<span style="color:#ef4444">Permission denied: ${err.message}. Please allow microphone in Chrome's address bar.</span>`;
  }
}

function onMicGranted() {
  const statusEl = $("mic-perm-status");
  const btn = $("btn-grant-mic");
  const nextBtn = $("btn-next-2");
  const vuWrap = $("vu-wrap");

  statusEl.innerHTML = '<span style="color:var(--emerald); font-weight:700;">✓ Microphone access granted!</span>';
  btn.style.display = "none";
  nextBtn.disabled = false;
  vuWrap.style.display = "flex";

  startVuMeter();
}

async function startVuMeter() {
  if (!micStream) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }
  }

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const vuFill = $("vu-fill");

    function renderVu() {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength;
      const pct = Math.min(100, Math.round((avg / 128) * 100 * 1.5));
      if (vuFill) vuFill.style.width = `${pct}%`;

      animFrameId = requestAnimationFrame(renderVu);
    }

    renderVu();
  } catch (e) {
    console.warn("VU meter init error:", e);
  }
}

$("btn-grant-mic")?.addEventListener("click", requestMic);

// ── Step 4: Voice Playground ──────────────────────────────────────────────────

function initPlaygroundSpeech() {
  if (!SpeechRecognition) {
    $("play-substatus").textContent = "Speech recognition unavailable in this tab context. Click an example chip below to test.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isListeningPlayground = true;
    $("play-mic-btn").classList.add("recording");
    $("play-status").textContent = "Listening…";
    $("play-substatus").textContent = "Speak a command now (e.g. 'open youtube' or 'zoom in')";
  };

  recognition.onresult = e => {
    let transcript = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    transcript = transcript.trim();
    if (transcript) {
      handlePlaygroundCommand(transcript);
    }
  };

  recognition.onerror = e => {
    isListeningPlayground = false;
    $("play-mic-btn").classList.remove("recording");
    $("play-status").textContent = "Microphone error";
    $("play-substatus").textContent = e.error === "not-allowed" ? "Microphone access blocked." : `Error: ${e.error}`;
  };

  recognition.onend = () => {
    isListeningPlayground = false;
    $("play-mic-btn").classList.remove("recording");
    $("play-status").textContent = "Click to speak again";
  };
}

function handlePlaygroundCommand(text) {
  const result = routeCommand(text);
  const outCard = $("play-output");
  const outText = $("play-out-text");

  outCard.style.display = "flex";
  if (result.action === "UNKNOWN") {
    outText.innerHTML = `
      <div style="color:var(--text)">Recognized: <em>"${escapeHtml(text)}"</em></div>
      <div style="color:#f59e0b; margin-top:4px;">No standard browser rule matched. (August can use local LLM fallback for freeform queries).</div>
    `;
  } else {
    const paramStr = Object.entries(result.params || {})
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    outText.innerHTML = `
      <div style="color:var(--text)">Recognized: <em>"${escapeHtml(text)}"</em></div>
      <div style="color:var(--emerald); margin-top:4px;">
        Action: <strong>${result.action}</strong> ${paramStr ? `(${escapeHtml(paramStr)})` : ""} ✓
      </div>
    `;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

$("play-mic-btn")?.addEventListener("click", () => {
  if (!recognition) initPlaygroundSpeech();
  if (isListeningPlayground) {
    recognition?.stop();
  } else {
    try {
      recognition?.start();
    } catch {
      initPlaygroundSpeech();
      recognition?.start();
    }
  }
});

// Interactive sample chips
document.querySelectorAll(".chip-btn").forEach(chip => {
  chip.addEventListener("click", () => {
    const text = chip.getAttribute("data-text");
    handlePlaygroundCommand(text);
  });
});

// ── Step 5: Finish & Launch ───────────────────────────────────────────────────

function markOnboardingComplete() {
  chrome.storage?.local?.set({ hasCompletedOnboarding: true });
}

$("btn-launch-sidepanel")?.addEventListener("click", async () => {
  markOnboardingComplete();
  // Try opening side panel if supported
  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (chrome.sidePanel?.open && currentTab?.windowId) {
      await chrome.sidePanel.open({ windowId: currentTab.windowId });
      window.close();
      return;
    }
  } catch (err) {
    console.log("Direct sidePanel.open not allowed without user gesture on action, closing tab:", err);
  }
  alert("Press Ctrl+Shift+Space (or click August's toolbar icon) to open the side panel!");
  window.close();
});

$("btn-close-onboarding")?.addEventListener("click", () => {
  markOnboardingComplete();
  window.close();
});

// Init
initPlaygroundSpeech();
checkExistingMicPermission();
