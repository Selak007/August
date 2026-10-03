"""
August – faster-whisper Speech-to-Text wrapper.

Design goals:
  - Lazy model loading (first transcription triggers load)
  - CPU-first with optional CUDA
  - Configurable model size (tiny/base/small/medium)
  - Returns plain text + latency metadata
  - Thread-safe (model is loaded once, transcription is synchronous)
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Result type ───────────────────────────────────────────────────────────────

@dataclass
class STTResult:
    text: str
    language: str
    language_probability: float
    duration_s: float          # length of audio processed
    latency_ms: float          # time taken to transcribe
    model_size: str


# ── Whisper STT ───────────────────────────────────────────────────────────────

class WhisperSTT:
    """
    Thin wrapper around faster-whisper.WhisperModel.

    Usage:
        stt = WhisperSTT(model_size="base", device="cpu")
        result = stt.transcribe(audio_float32, sample_rate=16000)
        print(result.text)
    """

    def __init__(
        self,
        model_size: str = "base",
        device: str     = "cpu",
        compute_type: Optional[str] = None,
    ):
        self.model_size   = model_size
        self.device       = device
        # cpu → int8 is fastest on CPU; cuda → float16
        self.compute_type = compute_type or ("int8" if device == "cpu" else "float16")
        self._model       = None
        self._lock        = threading.Lock()

    # ── Lazy loader ───────────────────────────────────────────────────────────

    def _ensure_model(self) -> None:
        if self._model is not None:
            return

        with self._lock:
            if self._model is not None:
                return

            logger.info(
                "[STT] Loading Whisper model  size=%s  device=%s  compute=%s",
                self.model_size, self.device, self.compute_type,
            )
            t0 = time.perf_counter()

            from faster_whisper import WhisperModel  # noqa: PLC0415
            self._model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
            )

            elapsed = (time.perf_counter() - t0) * 1000
            logger.info("[STT] Model loaded in %.0fms", elapsed)

    # ── Transcription ─────────────────────────────────────────────────────────

    def transcribe(
        self,
        audio: np.ndarray,
        sample_rate: int = 16_000,
        language: Optional[str] = None,
        initial_prompt: Optional[str] = None,
    ) -> STTResult:
        """
        Transcribe *audio* (float32, 1-D, any sample_rate).

        Audio is resampled to 16 kHz if necessary.
        Returns STTResult with the transcribed text.
        """
        self._ensure_model()

        # Ensure float32
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32) / 32768.0

        # Resample to 16 kHz if needed
        if sample_rate != 16_000:
            audio = _resample(audio, sample_rate, 16_000)

        audio_duration = len(audio) / 16_000

        t0 = time.perf_counter()
        segments, info = self._model.transcribe(
            audio,
            language=language,
            initial_prompt=initial_prompt,
            beam_size=1,           # fastest; bump to 5 for accuracy
            vad_filter=False,      # we do our own VAD
            without_timestamps=True,
        )

        # Collect all segments
        text_parts = [seg.text for seg in segments]
        text       = " ".join(text_parts).strip()

        latency_ms = (time.perf_counter() - t0) * 1000

        logger.info(
            "[STT] Transcribed  text=%r  lang=%s(%.0f%%)  audio=%.1fs  latency=%.0fms",
            text, info.language, info.language_probability * 100,
            audio_duration, latency_ms,
        )

        return STTResult(
            text=text,
            language=info.language,
            language_probability=info.language_probability,
            duration_s=audio_duration,
            latency_ms=latency_ms,
            model_size=self.model_size,
        )

    def warm_up(self) -> None:
        """
        Force model load + run one silent transcription so the first real
        command has no cold-start delay.
        """
        logger.info("[STT] Warming up model…")
        silence = np.zeros(16_000, dtype=np.float32)  # 1s of silence
        self.transcribe(silence)
        logger.info("[STT] Warm-up complete.")


# ── Simple linear resampler ───────────────────────────────────────────────────

def _resample(audio: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Naive linear interpolation resampler (no scipy needed)."""
    if src_rate == dst_rate:
        return audio
    ratio    = dst_rate / src_rate
    new_len  = int(len(audio) * ratio)
    indices  = np.linspace(0, len(audio) - 1, new_len)
    return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)


# ── Module-level singleton (lazy) ─────────────────────────────────────────────

_stt_instance: Optional[WhisperSTT] = None


def get_stt(model_size: str = "base", device: str = "cpu") -> WhisperSTT:
    """Return the shared WhisperSTT singleton, creating it if needed."""
    global _stt_instance
    if _stt_instance is None:
        _stt_instance = WhisperSTT(model_size=model_size, device=device)
    return _stt_instance
