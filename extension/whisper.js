/**
 * August Extension — In-Browser Whisper Controller (whisper.js)
 *
 * Captures microphone audio using Web Audio API at 16kHz mono, performs local
 * Voice Activity Detection (VAD), and communicates with whisper-worker.js for
 * 100% offline, on-device automatic speech recognition.
 *
 * Privacy Guarantee:
 *   - Audio stays in-memory inside the browser tab/panel.
 *   - No audio stream or samples ever leave this machine.
 *   - Chrome Web Speech API is completely bypassed in this mode.
 */

const SAMPLE_RATE = 16000;
const DEFAULT_MODEL = "Xenova/whisper-tiny.en";
const SILENCE_THRESHOLD = 0.012;   // RMS threshold for speech vs silence
const SILENCE_DURATION_MS = 850;   // Silence after speech before auto-stop
const MIN_SPEECH_DURATION_MS = 350;// Ignore clicks/noise shorter than this
const MAX_RECORDING_MS = 25000;    // Safety cap

function resampleTo16k(audioBuffer, fromSampleRate) {
  if (fromSampleRate === SAMPLE_RATE) return audioBuffer;
  const ratio = fromSampleRate / SAMPLE_RATE;
  const newLength = Math.round(audioBuffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const origin = i * ratio;
    const index = Math.floor(origin);
    const frac = origin - index;
    const s0 = audioBuffer[index] || 0;
    const s1 = audioBuffer[index + 1] || s0;
    result[i] = s0 + frac * (s1 - s0);
  }
  return result;
}

export class InBrowserWhisper {
  constructor(options = {}) {
    this.modelName = options.model || DEFAULT_MODEL;
    this.onStatus = options.onStatus || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onError = options.onError || (() => {});
    this.onVolume = options.onVolume || (() => {});

    this.worker = null;
    this.modelReady = false;
    this.isRecording = false;

    this.audioCtx = null;
    this.mediaStream = null;
    this.processorNode = null;
    this.sourceNode = null;

    this.audioChunks = [];
    this.speechDetected = false;
    this.recordingStartTime = 0;
    this.lastSpeechTime = 0;
    this.silenceTimer = null;
    this.safetyTimer = null;

    this.initWorker();
  }

  initWorker() {
    try {
      const workerUrl = chrome.runtime.getURL("whisper-worker.js");
      this.worker = new Worker(workerUrl, { type: "module" });

      this.worker.addEventListener("message", event => {
        const data = event.data || {};
        switch (data.status) {
          case "loading":
            this.modelReady = false;
            this.onStatus("loading", { message: `Loading Whisper (${this.modelName})…` });
            break;
          case "progress":
            this.onStatus("progress", { progress: data.progress });
            break;
          case "ready":
            this.modelReady = true;
            this.onStatus("ready", { message: "Offline Whisper ready" });
            break;
          case "transcribing":
            this.onStatus("transcribing", { message: "Transcribing on-device…" });
            break;
          case "complete":
            this.onTranscript(data.text || "", data.latencyMs || 0);
            this.onStatus("ready", { message: "Ready" });
            break;
          case "error":
            console.error("[Whisper] Worker error:", data.error);
            this.onError(data.error);
            this.onStatus("error", { message: data.error });
            break;
        }
      });

      // Send initial wasm path and load model
      const wasmPath = chrome.runtime.getURL("vendor/");
      this.worker.postMessage({
        type: "init",
        wasmPath,
        model: this.modelName
      });
    } catch (err) {
      console.error("[Whisper] Failed to initialize worker:", err);
      this.onError(err?.message || String(err));
    }
  }

  preload() {
    if (!this.worker) this.initWorker();
    this.worker?.postMessage({
      type: "load",
      model: this.modelName,
      wasmPath: chrome.runtime.getURL("vendor/")
    });
  }

  async startRecording(autoStopOnSilence = true) {
    if (this.isRecording) return;

    this.audioChunks = [];
    this.speechDetected = false;
    this.recordingStartTime = Date.now();
    this.lastSpeechTime = Date.now();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass({ sampleRate: SAMPLE_RATE });

      this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
      // Use standard ScriptProcessorNode for wide cross-browser audio buffer capture
      this.processorNode = this.audioCtx.createScriptProcessor(4096, 1, 1);

      this.processorNode.onaudioprocess = event => {
        if (!this.isRecording) return;
        const inputData = event.inputBuffer.getChannelData(0);
        // Clone samples
        this.audioChunks.push(new Float32Array(inputData));

        // Calculate RMS for VAD and live volume UI
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        this.onVolume(rms);

        // VAD
        const now = Date.now();
        if (rms >= SILENCE_THRESHOLD) {
          this.speechDetected = true;
          this.lastSpeechTime = now;
        } else if (autoStopOnSilence && this.speechDetected) {
          if (now - this.lastSpeechTime >= SILENCE_DURATION_MS) {
            const speechDuration = now - this.recordingStartTime;
            if (speechDuration >= MIN_SPEECH_DURATION_MS) {
              this.stopRecording();
            }
          }
        }
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioCtx.destination);

      this.isRecording = true;
      this.onStatus("listening", { message: "Listening (Whisper Offline)…" });

      // Safety timeout
      clearTimeout(this.safetyTimer);
      this.safetyTimer = setTimeout(() => {
        if (this.isRecording) this.stopRecording();
      }, MAX_RECORDING_MS);

    } catch (err) {
      console.error("[Whisper] Failed to open microphone:", err);
      this.cleanupAudio();
      this.onError(err?.message || "Microphone access failed");
    }
  }

  stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;
    clearTimeout(this.safetyTimer);

    // Stop audio stream and nodes
    const sampleRate = this.audioCtx?.sampleRate || SAMPLE_RATE;
    const rawChunks = this.audioChunks;
    this.cleanupAudio();

    if (!rawChunks.length) {
      this.onStatus("ready", { message: "Ready" });
      return;
    }

    // Concatenate chunks
    let totalLength = 0;
    for (const c of rawChunks) totalLength += c.length;
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const c of rawChunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    // Resample to 16kHz if needed
    const finalAudio = resampleTo16k(merged, sampleRate);

    // Send to worker for on-device Whisper transcription
    this.onStatus("transcribing", { message: "Transcribing on-device with Whisper…" });
    this.worker?.postMessage({
      type: "transcribe",
      audio: finalAudio,
      model: this.modelName
    });
  }

  cleanupAudio() {
    this.isRecording = false;
    try {
      this.processorNode?.disconnect();
      this.sourceNode?.disconnect();
      this.mediaStream?.getTracks().forEach(t => t.stop());
      this.audioCtx?.close();
    } catch (e) {
      console.warn("[Whisper] Cleanup warning:", e);
    }
    this.processorNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.audioCtx = null;
    this.onVolume(0);
  }

  destroy() {
    this.cleanupAudio();
    this.worker?.terminate();
    this.worker = null;
  }
}
