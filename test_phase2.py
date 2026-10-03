"""
August — Phase 2 standalone STT test.

Run this script directly to test the full audio pipeline
WITHOUT connecting to Chrome.

    python test_phase2.py

Press Ctrl+Space → speak → see transcription.
Press Ctrl+C to quit.

Requirements:
    - Microphone connected
    - faster-whisper, sounddevice, numpy, keyboard installed
    - Run as Administrator on Windows (keyboard library requirement)
      OR use: python test_phase2.py --no-admin  (uses alternative)
"""

import sys
import os
import time
import logging

# Ensure project root is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("august.test_phase2")


# ── Latency tracker ───────────────────────────────────────────────────────────

_t_listen_start: float = 0.0

def on_listening():
    global _t_listen_start
    _t_listen_start = time.perf_counter()
    print("\n  🎙  Listening…  (release Ctrl+Space or wait for silence)")

def on_stopped():
    print("  ⏹  Processing…")

def on_result(text: str):
    total_ms = (time.perf_counter() - _t_listen_start) * 1000
    print(f"\n  ┌─────────────────────────────────────────")
    print(f"  │  Transcript : \"{text}\"")
    print(f"  │  Total time : {total_ms:.0f}ms (from key press)")
    print(f"  └─────────────────────────────────────────")
    print(f"\n  Press Ctrl+Space again to record. Ctrl+C to quit.\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    model_size = "base"

    # Parse simple CLI arg
    if "--tiny" in sys.argv:
        model_size = "tiny"
    elif "--small" in sys.argv:
        model_size = "small"
    elif "--medium" in sys.argv:
        model_size = "medium"

    print(f"""
╔══════════════════════════════════════╗
║   August — Phase 2 STT Test          ║
║   Model : Whisper {model_size:<6}             ║
║   Device: CPU (int8)                 ║
╚══════════════════════════════════════╝
    """)

    # Check microphone availability
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        input_dev = sd.query_devices(kind="input")
        print(f"  Microphone : {input_dev['name']}")
        print(f"  Sample rate: {int(input_dev['default_samplerate'])} Hz")
    except Exception as e:
        print(f"  ⚠  Microphone check failed: {e}")
        print(f"  Make sure a microphone is connected and accessible.")
        sys.exit(1)

    print()

    from backend.audio.recorder import PushToTalkRecorder

    recorder = PushToTalkRecorder(
        on_result    = on_result,
        on_listening = on_listening,
        on_stopped   = on_stopped,
        model_size   = model_size,
        device       = "cpu",
        vad_silence_ms = 700,
    )

    # This blocks — loads Whisper, then waits for hotkey
    recorder.start(warm_up=True)


if __name__ == "__main__":
    main()
