/**
 * August Extension — Web Worker for In-Browser Whisper (whisper-worker.js)
 *
 * Runs Whisper automatic-speech-recognition completely inside the browser using
 * Transformers.js (ONNX Runtime WebAssembly).
 *
 * Privacy guarantee:
 * Audio samples never leave this browser process. Zero audio is sent to Google,
 * cloud servers, or any external service.
 */

import { pipeline, env } from "./vendor/transformers.js";

// Disable local model filesystem check; allow fetching from HuggingFace Hub on first run
env.allowLocalModels = false;
env.allowRemoteModels = true;

// Configure ONNX Runtime Web WebAssembly paths
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = 1;

let transcriber = null;
let currentModel = "Xenova/whisper-tiny.en";
let isLoading = false;

async function getTranscriber(modelName = currentModel, wasmPath = null) {
  if (wasmPath) {
    env.backends.onnx.wasm.wasmPaths = wasmPath;
  }

  if (transcriber && currentModel === modelName) {
    return transcriber;
  }

  if (isLoading) {
    // Wait for in-flight load
    while (isLoading) {
      await new Promise(r => setTimeout(r, 50));
    }
    if (transcriber && currentModel === modelName) return transcriber;
  }

  isLoading = true;
  currentModel = modelName;
  self.postMessage({ status: "loading", model: modelName });

  try {
    transcriber = await pipeline("automatic-speech-recognition", modelName, {
      quantized: true,
      progress_callback: progress => {
        self.postMessage({ status: "progress", progress });
      }
    });
    self.postMessage({ status: "ready", model: modelName });
    return transcriber;
  } catch (err) {
    transcriber = null;
    self.postMessage({ status: "error", error: err?.message || String(err) });
    throw err;
  } finally {
    isLoading = false;
  }
}

self.addEventListener("message", async event => {
  const { type, audio, model, wasmPath } = event.data || {};

  if (type === "init" || type === "load") {
    try {
      await getTranscriber(model || currentModel, wasmPath);
    } catch {
      // Error already posted
    }
    return;
  }

  if (type === "transcribe") {
    try {
      const pipe = await getTranscriber(model || currentModel, wasmPath);
      if (!audio || !audio.length) {
        self.postMessage({ status: "complete", text: "" });
        return;
      }

      self.postMessage({ status: "transcribing" });

      const startTime = performance.now();
      const output = await pipe(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: "english",
        task: "transcribe",
        return_timestamps: false
      });

      const latencyMs = Math.round(performance.now() - startTime);
      const text = typeof output === "string" ? output : (output?.text || "");

      self.postMessage({
        status: "complete",
        text: text.trim(),
        latencyMs
      });
    } catch (err) {
      self.postMessage({ status: "error", error: err?.message || String(err) });
    }
  }
});
