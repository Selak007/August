"""
August – Push-to-Talk Microphone Recorder

Flow:
    Press Ctrl+Space     → start recording + streaming VAD
    Speech detected      → accumulate audio
    Silence detected     → auto-stop, fire callback
    OR release manually  → stop, fire callback

The recorder runs a background thread for audio capture.
The caller provides an on_result(text: str) callback.

Usage (standalone test):
    from backend.audio.recorder import PushToTalkRecorder
    rec = PushToTalkRecorder(on_result=print)
    rec.start()           # blocks, listens for hotkey
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Optional

import numpy as np
import sounddevice as sd

from backend.audio.vad import StreamingVAD
from backend.audio.speech_to_text import WhisperSTT
from backend.config import config

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

SAMPLE_RATE    = 16_000   # Hz — Whisper native rate
CHANNELS       = 1
FRAME_MS       = 20       # VAD frame length
FRAME_SAMPLES  = int(SAMPLE_RATE * FRAME_MS / 1000)
MAX_RECORD_S   = 30       # safety cap — auto-stop after 30s
HOTKEY         = "ctrl+space"


# ── Recorder ──────────────────────────────────────────────────────────────────

class PushToTalkRecorder:
    """
    Push-to-talk voice recorder with streaming VAD and Whisper transcription.

    Parameters
    ----------
    on_result   : callback(text: str) called with transcription
    on_listening: optional callback() called when mic opens
    on_stopped  : optional callback() called when mic closes (pre-transcribe)
    model_size  : "tiny" | "base" | "small" | "medium"
    device      : "cpu" | "cuda"
    vad_silence_ms: ms of silence after speech before auto-stop
    """

    def __init__(
        self,
        on_result: Callable[[str], None],
        on_listening: Optional[Callable] = None,
        on_stopped: Optional[Callable]   = None,
        model_size: str  = "base",
        device: str      = "cpu",
        vad_silence_ms: int = 700,
    ):
        self._on_result    = on_result
        self._on_listening = on_listening or (lambda: None)
        self._on_stopped   = on_stopped   or (lambda: None)
        self._vad_silence  = vad_silence_ms

        self._stt          = WhisperSTT(model_size=model_size, device=device)
        self._recording    = False
        self._frames: list[np.ndarray] = []
        self._stream: Optional[sd.InputStream] = None
        self._vad          = StreamingVAD(
            sample_rate=SAMPLE_RATE,
            frame_ms=FRAME_MS,
            threshold_db=-38.0,
            silence_ms=vad_silence_ms,
        )
        self._stop_event   = threading.Event()
        self._lock         = threading.Lock()

    # ── Audio callback (called on audio thread) ───────────────────────────────

    def _audio_callback(
        self,
        indata: np.ndarray,
        frames: int,
        time_info,
        status,
    ) -> None:
        if status:
            logger.warning("[REC] sounddevice status: %s", status)

        if not self._recording:
            return

        # indata shape: (frames, channels) → flatten to 1-D float32
        chunk = indata[:, 0].copy()

        # Feed into VAD frame by frame
        for i in range(0, len(chunk) - FRAME_SAMPLES + 1, FRAME_SAMPLES):
            frame = chunk[i : i + FRAME_SAMPLES]
            is_speech, should_stop = self._vad.feed(frame)

        with self._lock:
            self._frames.append(chunk)

        if should_stop:
            logger.info("[REC] VAD silence threshold reached — stopping.")
            self._stop_recording(reason="vad")

    # ── Recording control ─────────────────────────────────────────────────────

    def _start_recording(self) -> None:
        with self._lock:
            if self._recording:
                return
            self._frames   = []
            self._recording = True
            self._vad.reset()

        logger.info("[REC] 🎙  Recording started")
        self._on_listening()

        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="float32",
            blocksize=FRAME_SAMPLES,
            callback=self._audio_callback,
        )
        self._stream.start()

        # Safety: auto-stop after MAX_RECORD_S
        threading.Timer(MAX_RECORD_S, lambda: self._stop_recording("timeout")).start()

    def _stop_recording(self, reason: str = "manual") -> None:
        with self._lock:
            if not self._recording:
                return
            self._recording = False
            frames = list(self._frames)

        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception as e:
                logger.warning("[REC] Error closing stream: %s", e)
            self._stream = None

        logger.info("[REC] Recording stopped (%s)  frames=%d", reason, len(frames))
        self._on_stopped()

        if not frames:
            logger.warning("[REC] No audio captured.")
            return

        # Transcribe in a background thread so the hotkey stays responsive
        audio = np.concatenate(frames)
        threading.Thread(
            target=self._transcribe,
            args=(audio,),
            daemon=True,
        ).start()

    def _transcribe(self, audio: np.ndarray) -> None:
        logger.info("[STT] Transcribing %.1fs of audio…", len(audio) / SAMPLE_RATE)
        try:
            result = self._stt.transcribe(audio, sample_rate=SAMPLE_RATE)
            text   = result.text.strip()
            logger.info("[STT] → %r  (%.0fms)", text, result.latency_ms)
            if text:
                self._on_result(text)
            else:
                logger.warning("[STT] Empty transcription — nothing to route.")
        except Exception as exc:
            logger.error("[STT] Transcription error: %s", exc)

    # ── Hotkey listener ───────────────────────────────────────────────────────

    def start(self, warm_up: bool = True) -> None:
        """
        Block and listen for Ctrl+Space hotkey.

        Press  → start recording
        Release → stop, transcribe, call on_result

        Press Ctrl+C to exit.
        """
        if warm_up:
            logger.info("[REC] Pre-loading Whisper model (warm-up)…")
            self._stt.warm_up()
            logger.info("[REC] Ready. Press Ctrl+Space to record.")

        try:
            import keyboard  # imported here so module loads without it
        except ImportError:
            raise ImportError(
                "Install the 'keyboard' package:  pip install keyboard"
            )

        print(f"\n  August — Push-to-Talk")
        print(f"  Hold {HOTKEY.upper()} to record. Ctrl+C to quit.\n")

        def on_press(event):
            if not self._recording:
                self._start_recording()

        def on_release(event):
            if self._recording:
                self._stop_recording(reason="key_release")

        keyboard.on_press_key("space", on_press,   suppress=False)
        keyboard.on_release_key("space", on_release, suppress=False)

        try:
            keyboard.wait()   # block until Ctrl+C
        except KeyboardInterrupt:
            logger.info("[REC] Exiting.")
        finally:
            keyboard.unhook_all()

    def stop_listening(self) -> None:
        """Programmatic shutdown."""
        self._stop_event.set()
        try:
            import keyboard
            keyboard.unhook_all()
        except Exception:
            pass
