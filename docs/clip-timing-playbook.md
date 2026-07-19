# Clip Timing Playbook

**Purpose:** a repeatable method for diagnosing and fixing the two recurring failure modes in
podcast-to-reel pipelines — **audio cut mid-word** and **captions out of sync** — written so a
smaller/cheaper model (or a new contributor) can follow it without re-deriving the system.

Everything below is checkable. When a symptom appears, do not debug by intuition: walk the
invariants in §2 against the timing chain in §1 until one fails. The failure is always an
invariant violation; the fix is always "restore the invariant at the point it breaks".

---

## 1. The timing chain (single source of truth)

There is exactly one authoritative clock: **Whisper word-level timestamps in episode time**
(seconds from the start of the source file). Every other number is derived from it.

```
source media file
  → extractAudio (ffmpegService.extractAudio): full-length decode, 16kHz mono WAV.
    NO seeking, NO trimming → Whisper timestamps map 1:1 onto source time.
    Whisper runs with --condition_on_previous_text False plus a punctuated
    --initial_prompt: audio that opens mid-sentence otherwise seeds a lowercase,
    punctuation-free style that propagates through the whole file, and punctuation
    is what thought-line building depends on. Files >20MB split at silences near
    the 10-minute marks (never exactly on them — hard splits cut words in half).
  → punctuation restoration (transcriptPunctuationService, LLM pass): decorates the
    word-token stream with punctuation and case; every restored line is validated
    token-by-token against the original and kept raw on any word change, so the
    model can decorate tokens but never alter them. Word timing untouched. Part of
    the cache fingerprint (TRANSCRIPT_ENRICHMENT_SIGNATURE). Everything downstream
    — thought lines, dangling veto, ending repairs, read-back quotes, captions —
    reads the decorated tokens automatically.
  → silence map (ffmpegService.detectSilences, −26dB / 0.12s): the acoustic truth
    about pauses. Whisper words are contiguous by construction and absorb real
    pauses into word spans, so cut placement must consult silences, not word gaps.
    Carried on CanonicalConversationalTimeline.silences.
  → transcript_segments / transcript_lines tables (words stored as JSON in `words` column,
    parsed by database.getTranscriptSegments / getClipTranscriptSegments — note the clip
    queries filter by OVERLAP: end_time > clipStart AND start_time < clipEnd).
    Lines are THOUGHT lines (sentence/pause-shaped, `whisper_thought_lines_v1`) —
    never raw Whisper segments, which split sentences mid-phrase.
  → clip boundaries (episode time)
      - llm_thread_v1: WHERE a quote ends is a language judgment, not an acoustic
        one — in conversation there is rarely silence to cut in. Every shipping
        candidate gets an ending read-back: an LLM reads the selected lines as the
        clip's literal final words and either accepts, contracts the end to the
        latest line that lands (suggested_end_line_index), or ships it flagged.
        THE REVIEWER IS NOT THE LAST LINE OF DEFENSE: it has approved endings like
        "...you know and i just" while quoting them verbatim. Objectively dangling
        endings are vetoed mechanically (endsWithDanglingPhrase) and contracted
        BEFORE review — the reviewer chooses among defensible endings; it does not
        get to bless indefensible ones.
        Media-edge trims run BEFORE the read-back so the reviewed ending is the
        shipped ending. Silence then only micro-places the cut:
        finalizeMechanicalClips cuts inside the silence adjacent to the boundary
        word when one exists (pause_cut); otherwise guarded word-snap pads + export
        fades (hard_handoff_faded). Per-boundary cut mode and silences land in
        provenance via validatorResultJson.
      - manual trim: ClipEditModal applyBoundaryWithSnap (word / frame / free snap modes)
  → caption cues (CLIP-RELATIVE time = episode time − clip start_time)
      - cached: clip_edits.caption_segments JSON ({text, start, end, words[]})
      - derived: exportService.buildCaptionSegmentsFromTranscript (word-accurate fallback,
        used only when the cache is empty)
  → render
      - preview clip: mediaWorker → ffmpegService.createClip (re-encode, -ss before -i)
      - export: ffmpegService.exportReelClip (re-encode; ASS subtitles or overlay assets;
        overlay enable='between(t,…)' and ASS Dialogue times are clip-relative, which is
        correct because seek+re-encode resets output t to 0 at clip start)
```

## 2. Invariants

Any timing bug in this app is a violation of one of these six rules.

- **I1 — Word grounding.** Every clip boundary must be grounded in a word timestamp:
  `start ≤ firstWord.start` and `end ≥ lastWord.end`, with a small pad
  (~0.15 s head, ~0.22 s tail). Whisper word times regularly land *inside* the spoken word,
  so a cut at exactly `word.start` clips the first phoneme — that is what "audio cut
  mid-word" almost always is. A boundary that is a raw LLM-suggested time, a raw
  `video.currentTime`, or a frame-rounded number is not grounded.
  **Pads may only extend into silence.** A fixed-size pad applied where speech is
  continuous lands inside the *neighbouring* word — the clip carries the previous
  speaker's last syllables or the next speaker's onset, which listeners hear as an
  abrupt mid-sentence cut. Clamp: `start ≥ previousWord.end`, `end ≤ nextWord.start`
  (with a small guard, see `resolveClipEndWithTrailingPad`), where previous/next are
  the timeline words adjacent to the selected span.
  **At a zero-gap handoff, no cut placement is clean** — clamping produces a
  knife-edge cut that chops the final word's decay (Whisper end-times run early in
  continuous speech). Know your pause data: Whisper words are contiguous *within* a
  segment, so real pauses only surface at segment boundaries; in crosstalk-heavy
  audio, long stretches have no pause at all. The remedies are layered:
  1. audio micro-fades at every cut (~40 ms in, ~120 ms out — `exportReelClip` and
     `createClip`), which make even knife-edge cuts read as deliberate edits;
  2. a best-effort polish pass (`polishBoundaryHandoffs`) that shifts an accepted
     candidate's line range slightly to a boundary with a real pause — strictly
     improving, never a gate: if no nearby pause verifies, the original stands;
  3. `hardHandoffStart/End` + gap seconds recorded in the finalizer provenance so
     rough boundaries are visible in review instead of discovered by ear.

- **I2 — One offset, applied once.** Caption cue time = episode time − **current**
  `clip.start_time`. Never apply the offset twice, never apply a stale one. Any persisted
  clip-relative data (`clip_edits.caption_segments`) is invalid the moment boundaries change
  and must be rebuilt with the new start or nulled (ClipEditorPage nulls it; ClipEditModal
  rebuilds it on save — any new boundary-writing code path must do one of the two).

- **I3 — Words survive every hop.** Word-level timing must survive every serialization
  (DB → JSON → renderer → `saveClipEdits` → export). The degradation is *silent*: the ASS
  generator (`ffmpegService.generateASSSubtitles`) falls back from word-highlight karaoke to
  whole-segment cues when `segment.words` is missing, and `alignWordsToTranscriptText`
  falls back to evenly interpolated timing — both render fine but drift against speech.
  Whisper segments are 5–15 s long, so segment-level captions look "seconds out of sync".

- **I4 — Overlap, never containment.** Filtering segments/words into a clip window must use
  `end > clipStart && start < clipEnd`, then clamp times into the window. A containment
  filter (`start >= clipStart && end <= clipEnd`) drops every boundary-straddling segment —
  and because boundaries deliberately land mid-segment (I1 snaps to words, not segments),
  straddling is the common case, not the edge case. Symptom: no captions over the first/last
  words of the clip.

- **I5 — Accurate cuts only.** All cutting re-encodes (`-ss` before `-i` **with**
  `libx264/aac`). Never introduce `-c copy` stream-copy cuts: they snap to the previous
  keyframe, shifting the whole clip by up to several seconds and desyncing every
  clip-relative caption time.

- **I6 — Preview must not lie.** The preview and the export must read timing from the same
  data. Today the modal preview reads live transcript words while the export reads cached
  `caption_segments`; whenever those two disagree, users report "it looked fine in preview".
  If you change one side's data source, change the other.

## 3. Diagnosis by symptom

**"Audio cuts off mid-word" (start or end of clip)** → I1 violation.
1. Find where that clip's boundary was written: pipeline
   (`finalizeMechanicalClips`), manual trim (`applyBoundaryWithSnap` → `handleSave` →
   `updateClipBoundaries`), or legacy candidate mapping (`clipCandidateService`,
   char-index→word heuristics).
2. Compare `clip.start_time`/`end_time` against the nearest word timestamps (SQL in §4).
   If the boundary sits strictly inside `[word.start, word.end)` of a spoken word, or at
   exactly `word.start` with no pad, you've found it.
3. Fix at the writer, not the renderer: snap to word bounds and pad.

**"Captions offset by a constant amount for the whole clip"** → I2 (usually) or I5.
1. Check `clip_edits.updated_at` vs `clips.updated_at`: were boundaries changed after
   `caption_segments` was saved by a path that neither rebuilt nor nulled it?
2. If the offset exists even with a fresh cache: check the container start offset
   (`ffprobe -show_entries format=start_time`) and check no stream-copy cut crept in.

**"Captions drift progressively / appear as long multi-second blocks"** → I3.
1. Dump the clip's `caption_segments` (SQL in §4). If segments have no `words` array,
   some save path stripped them. Find every writer of `caption_segments`
   (`grep -rn "caption_segments" src`) and check each one carries `words`.

**"No captions over the first/last words"** → I4. Grep the caption-building filters for
`>=` / `<=` containment comparisons against clip boundaries.

## 4. Verification recipe (run after any fix — do not trust the code read)

Data-level check (fast, no render):

```bash
python3 scripts/check_caption_segments.py         # I1–I4 violations + boundary QA results
```

Automated boundary QA (`clipBoundaryQaService`) runs in the background after every
pipeline run: it re-transcribes each clip's first/last ~2s from the source and fails
the clip if the expected boundary word is missing (chopped) or other speech intrudes.
Results land in the `clip_boundary_qa` table and in the checker output above.
Detection floor: onset clips under ~100ms still transcribe recognizably and pass —
those are masked by the export fades.

Render-level check (the ground truth — inspect what was actually rendered):

```bash
# 1. Export one clip through the real pipeline, then:
ffprobe -v error -show_entries format=start_time,duration -of json out.mp4

# 2. Boundary audio: listen to the first/last second for clipped phonemes
ffmpeg -y -i out.mp4 -t 1.2 head.wav && ffmpeg -y -sseof -1.2 -i out.mp4 tail.wav

# 3. Caption timing: extract frames at a cue's start/end (times from caption_segments)
#    and confirm the highlighted word matches what is being spoken at that instant
ffmpeg -y -ss <cue.start> -i out.mp4 -frames:v 1 cue_start.png

# 4. ASS inspection: the export writes subtitles_<ts>.ass to the temp dir and deletes it
#    after render — comment out the unlink in ffmpegService exportReelClip handlers (or
#    copy it mid-render) and diff Dialogue times against Whisper word times.
```

Acceptance: first and last words fully audible; every word-highlight cue changes within
~120 ms of the spoken word; captions present across the entire speech range of the clip.

## 5. Known writers and readers of timing data

| Data | Writers | Readers |
|---|---|---|
| `clips.start_time/end_time` | `llmThreadSelectorService.finalizeMechanicalClips`, `updateClipBoundaries` (ClipEditModal, ClipEditorPage), legacy `clipCandidateService` | everything |
| `clip_edits.caption_segments` | `ClipEditModal.buildEditsObject` (save + apply-to-all), `CaptionEditor.handleSave`, ClipEditorPage (nulls on trim) | `exportService.buildCaptionSegments` (preferred over transcript), `CaptionEditor.loadCaptionData` |
| `transcript_segments.words` | Whisper ingestion | export fallback, trim word-snap, caption rebuilds |

Rules when touching these:
- New writer of `caption_segments` → must include clamped, clip-relative `words` (I3, I4).
- New writer of clip boundaries → must rebuild or null `caption_segments` (I2) and snap to
  padded word bounds (I1).
- User-edited caption text → drop that segment's `words` (stale words would override the
  edited text in word-highlight mode); export falls back to phrase timing for that segment.

## 6. Worked example (July 2026)

Symptoms matching Becky Isjwara's in the Every article (mid-word cuts, caption drift) were
diagnosed with exactly the walk in §3 and turned out to be:

1. **I3:** `ClipEditModal.buildEditsObject` and `CaptionEditor`'s transcript fallback saved
   `caption_segments` as `{text, start, end}` only — every modal save silently downgraded
   exports from word-karaoke to 5–15 s segment blocks.
2. **I4:** the same function filtered segments by containment, dropping boundary-straddling
   segments → no captions over the clip's opening/closing words.
3. **I1:** `finalizeMechanicalClips` padded the tail (+0.22 s) but cut the head at exactly
   `firstWord.startTime`, clipping first-phoneme onsets.

All three were fixed at the writers; the renderers were already correct.

A follow-up run exposed the second-order lesson: clamping pads at neighbouring words
(the naive I1 fix) turned pad-bleed into knife-edge cuts at zero-gap speaker handoffs
— *arguably worse*, because the final word of the clip then sounds chopped instead of
the next word intruding. That is what motivated the layered remedy now encoded in I1
(micro-fades + pause-seeking polish + hard-handoff provenance): in continuous speech
there is no cut position that fixes this, so placement, rendering, and review must
share the job.
