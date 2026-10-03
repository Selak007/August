"""
August – Voice Activity Detection (VAD)

Lightweight, zero-dependency energy-based VAD.
No PyTorch, no heavy models — just numpy RMS on audio frames.

Design:
  - Split audio into short frames
  - Compute RMS energy per frame
  - Mark frames as speech / silence
  - Find speech start/end, pad edges
  - Return trimmed audio + metadata

For Phase 2 this is sufficient.
Phase 3+ can swap in Silero VAD by replacing this module's public API.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class VADResult:
    has_speech: bool
    speech_start: float        # seconds from start of audio
    speech_end: float          # seconds from start of audio
    trimmed_audio: np.ndarray  # float32, sample_rate=16000
    rms_db: float              # average dB of speech portion


class EnergyVAD:
    """
    Frame-level energy VAD.

    Parameters
    ----------
    sample_rate     : audio sample rate (Hz)
    frame_ms        : frame size in milliseconds
    threshold_db    : RMS threshold (dB) above which a frame is 'speech'
    min_speech_ms   : minimum total speech duration to consider valid
    pre_pad_ms      : ms of silence to keep before speech start
    post_pad_ms     : ms of silence to keep after speech end
    """

    def __init__(
        self,
        sample_rate: int   = 16_000,
        frame_ms: int      = 20,
        threshold_db: float = -35.0,
        min_speech_ms: int = 200,
        pre_pad_ms: int    = 150,
        post_pad_ms: int   = 300,
    ):
        self.sample_rate   = sample_rate
        self.frame_size    = int(sample_rate * frame_ms / 1000)
        self.threshold_db  = threshold_db
        self.min_speech_ms = min_speech_ms
        self.pre_pad_ms    = pre_pad_ms
        self.post_pad_ms   = post_pad_ms

    def _rms_db(self, frame: np.ndarray) -> float:
        """Root-mean-square of frame in dB."""
        rms = np.sqrt(np.mean(frame.astype(np.float32) ** 2))
        if rms < 1e-9:
            return -96.0
        return 20.0 * np.log10(rms)

    def process(self, audio: np.ndarray) -> VADResult:
        """
        Analyse *audio* (float32 or int16, 1-D) and return VADResult.

        Always returns a VADResult.  If no speech detected,
        has_speech=False and trimmed_audio is the original audio.
        """
        # Normalise to float32 [-1, 1]
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32) / 32768.0

        n_frames = len(audio) // self.frame_size
        if n_frames == 0:
            return VADResult(False, 0.0, 0.0, audio, -96.0)

        # Classify each frame
        speech_flags: list[bool] = []
        for i in range(n_frames):
            frame = audio[i * self.frame_size : (i + 1) * self.frame_size]
            db    = self._rms_db(frame)
            speech_flags.append(db >= self.threshold_db)

        # Find first and last speech frame
        speech_indices = [i for i, s in enumerate(speech_flags) if s]
        if not speech_indices:
            logger.debug("[VAD] No speech detected.")
            return VADResult(False, 0.0, 0.0, audio, -96.0)

        first = speech_indices[0]
        last  = speech_indices[-1]

        # Check minimum duration
        speech_frames  = last - first + 1
        speech_ms      = speech_frames * (self.frame_size / self.sample_rate) * 1000
        if speech_ms < self.min_speech_ms:
            logger.debug("[VAD] Speech too short (%.0fms < %dms), ignoring.", speech_ms, self.min_speech_ms)
            return VADResult(False, 0.0, 0.0, audio, -96.0)

        # Apply padding
        pre_frames  = int(self.pre_pad_ms  / 1000 * self.sample_rate / self.frame_size)
        post_frames = int(self.post_pad_ms / 1000 * self.sample_rate / self.frame_size)

        start_frame = max(0,        first - pre_frames)
        end_frame   = min(n_frames, last  + post_frames + 1)

        start_sample = start_frame * self.frame_size
        end_sample   = end_frame   * self.frame_size

        trimmed = audio[start_sample:end_sample]

        # Average dB of speech region
        speech_region = audio[first * self.frame_size : (last + 1) * self.frame_size]
        avg_db = float(np.mean([
            self._rms_db(speech_region[i * self.frame_size : (i + 1) * self.frame_size])
            for i in range(len(speech_region) // self.frame_size)
        ]))

        speech_start = start_sample / self.sample_rate
        speech_end   = end_sample   / self.sample_rate

        logger.debug(
            "[VAD] Speech detected  start=%.2fs  end=%.2fs  duration=%.0fms  avg=%.1fdB",
            speech_start, speech_end, speech_ms, avg_db
        )

        return VADResult(
            has_speech=True,
            speech_start=speech_start,
            speech_end=speech_end,
            trimmed_audio=trimmed,
            rms_db=avg_db,
        )


# ── Streaming VAD (frame-by-frame) ────────────────────────────────────────────

class StreamingVAD:
    """
    Stateful VAD for real-time use.

    Feed audio frames one at a time via `feed()`.
    Call `should_stop()` to check if speech ended (silence detected).
    """

    def __init__(
        self,
        sample_rate: int    = 16_000,
        frame_ms: int       = 20,
        threshold_db: float = -35.0,
        silence_ms: int     = 700,   # how long silence before we stop
    ):
        self._vad          = EnergyVAD(sample_rate, frame_ms, threshold_db)
        self._silence_ms   = silence_ms
        self._frame_ms     = frame_ms
        self._speech_seen  = False
        self._silence_frames = 0
        self._silence_thresh = int(silence_ms / frame_ms)

    def feed(self, frame: np.ndarray) -> tuple[bool, bool]:
        """
        Feed one audio frame.

        Returns (is_speech, should_stop).
        should_stop=True means speech ended — caller should finalise recording.
        """
        db = self._vad._rms_db(frame)
        is_speech = db >= self._vad.threshold_db

        if is_speech:
            self._speech_seen    = True
            self._silence_frames = 0
        elif self._speech_seen:
            self._silence_frames += 1

        should_stop = (
            self._speech_seen
            and self._silence_frames >= self._silence_thresh
        )
        return is_speech, should_stop

    def reset(self) -> None:
        self._speech_seen    = False
        self._silence_frames = 0


# ── Module-level singleton ────────────────────────────────────────────────────

default_vad = EnergyVAD()
