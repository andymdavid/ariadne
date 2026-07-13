#!/usr/bin/env python3
"""Data-level timing check for docs/clip-timing-playbook.md (section 4).

Scans every clip with saved edits and reports violations of invariants I1-I4:
  I1: clip boundaries not grounded in (padded) word timestamps
  I2: cached caption cues outside the clip's current duration (stale offset)
  I3: cached caption segments missing word-level timing (silent karaoke downgrade)
  I4: caption coverage gap at the head/tail of the clip

Uses stdlib sqlite3 (better-sqlite3 in this repo is compiled for Electron's ABI
and cannot be loaded by plain node).

Usage: python3 scripts/check_caption_segments.py [path-to-ariadne.db]
"""

import json
import os
import sqlite3
import sys

TAIL_PAD = 0.22
TOLERANCE = 0.25  # seconds of slack before we call something a violation
COVERAGE_GAP = 0.75  # max allowed uncaptioned speech at head/tail

db_path = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.path.expanduser("~/Library/Application Support/ariadne/ariadne.db")
)
print(f"Database: {db_path}")

db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
db.row_factory = sqlite3.Row

clips = db.execute(
    """
    SELECT c.id, c.episode_id, c.start_time, c.end_time,
           e.caption_segments, e.captions_enabled
    FROM clips c LEFT JOIN clip_edits e ON e.clip_id = c.id
    WHERE c.is_active IS NULL OR c.is_active = 1
    """
).fetchall()

violations = 0


def report(clip_id: str, invariant: str, message: str) -> None:
    global violations
    violations += 1
    print(f"  [{invariant}] clip {clip_id}: {message}")


print(f"Checking {len(clips)} clips (boundaries for all, captions where edits exist)...\n")

for clip in clips:
    duration = clip["end_time"] - clip["start_time"]

    segments = db.execute(
        """
        SELECT start_time, end_time, words FROM transcript_segments
        WHERE episode_id = ? AND end_time > ? AND start_time < ?
        ORDER BY start_time ASC
        """,
        (clip["episode_id"], clip["start_time"], clip["end_time"]),
    ).fetchall()

    words = []
    for seg in segments:
        if seg["words"]:
            try:
                words.extend(
                    w
                    for w in json.loads(seg["words"])
                    if isinstance(w.get("start"), (int, float))
                    and isinstance(w.get("end"), (int, float))
                )
            except (json.JSONDecodeError, AttributeError):
                pass
    words.sort(key=lambda w: w["start"])

    # I1: boundaries grounded in padded word bounds
    def word_containing(t):
        return next(
            (w for w in words if w["start"] + 0.02 < t < w["end"] - 0.02), None
        )

    if words:
        for label, boundary in (("start_time", clip["start_time"]), ("end_time", clip["end_time"])):
            inside = word_containing(boundary)
            if inside:
                report(
                    clip["id"],
                    "I1",
                    f'{label} {boundary:.2f} cuts inside word "{inside["word"]}" '
                    f'({inside["start"]:.2f}-{inside["end"]:.2f})',
                )

    # Cached caption segment checks
    if clip["captions_enabled"] != 1 or not clip["caption_segments"]:
        continue

    try:
        cues = json.loads(clip["caption_segments"])
    except json.JSONDecodeError as error:
        report(clip["id"], "I3", f"caption_segments is not valid JSON ({error})")
        continue
    if not isinstance(cues, list) or not cues:
        continue

    # I3: word-level timing must survive
    wordless = [c for c in cues if not c.get("words")]
    if wordless:
        report(
            clip["id"],
            "I3",
            f"{len(wordless)}/{len(cues)} cached cues have no word timing "
            "(karaoke export will silently degrade)",
        )

    # I2: cue times must fit the CURRENT clip window
    out_of_range = [
        c
        for c in cues
        if c["start"] < -TOLERANCE or c["end"] > duration + TAIL_PAD + TOLERANCE
    ]
    if out_of_range:
        report(
            clip["id"],
            "I2",
            f"{len(out_of_range)}/{len(cues)} cues outside [0, {duration:.2f}s] "
            "— stale cache after boundary change?",
        )

    # I4: caption coverage at head/tail of speech
    if words:
        first_speech = max(0.0, words[0]["start"] - clip["start_time"])
        last_speech = min(duration, words[-1]["end"] - clip["start_time"])
        first_cue = min(c["start"] for c in cues)
        last_cue = max(c["end"] for c in cues)
        if first_cue - first_speech > COVERAGE_GAP:
            report(
                clip["id"],
                "I4",
                f"first caption at {first_cue:.2f}s but speech starts at "
                f"{first_speech:.2f}s (boundary-straddling segment dropped?)",
            )
        if last_speech - last_cue > COVERAGE_GAP:
            report(
                clip["id"],
                "I4",
                f"last caption ends {last_cue:.2f}s but speech runs to {last_speech:.2f}s",
            )

if violations == 0:
    print("\nOK: no timing invariant violations found.")
else:
    print(
        f"\nFound {violations} violation(s). "
        "See docs/clip-timing-playbook.md for the fix procedure."
    )
    sys.exit(1)
