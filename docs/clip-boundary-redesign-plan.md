# Clip Boundary Redesign Plan

**Date:** 2026-07-13.
**Status:** proposed — written after three rounds of boundary fixes (see
`docs/clip-timing-playbook.md` §6) still left clips sounding unpolished.

## Why small tweaks stopped working

Three iterations each fixed a real defect (word-less caption caches, pad bleed,
knife-edge clamps) and each round of output still sounded rough. Diagnosis on episode
`5d5a46dc` (TGS053, 2026-07-13 10:31 run) shows the remaining problems are *inputs to*
the boundary logic, not the boundary logic itself:

1. **The unit of selection is wrong.** Timeline "lines" are built 1:1 from Whisper
   segments (`canonicalTimelineService.buildFromWhisperTranscription` with
   `preserveSegmentBoundaries: true`). Whisper segments are ~5 s *acoustic* chunks:
   they start and end mid-sentence and mix speakers within one line. The LLM selects
   line ranges, so its clips inherit mid-sentence boundaries no matter how precisely
   the finalizer snaps words. Observed: clips starting at "…as like a **| harness**
   for the other agents" (124.56) and "…this decisioning **| is** done by the
   business" (431.68); a clip ending "…without thinking about **|**" with the
   sentence's final word ("it") cut off (407.16).

2. **Cut placement is blind to the actual audio.** All placement logic uses Whisper
   word timestamps, but Whisper words are contiguous by construction *and absorb real
   pauses into word spans* (observed: the word "if" spanning 276.04–277.22 across a
   measured 0.53 s silence). `ffmpeg silencedetect` at −26 dB/0.1 s finds usable
   pauses all over the recording that word-gap analysis reports as 0.00 s — e.g. a
   0.20 s pause at 123.14, 1.3 s before the mid-phrase 124.56 cut, right before the
   natural sentence start "interesting idea to run it as…". The pause-seeking polish
   pass added on 2026-07-13 therefore looks at the wrong signal and almost never fires.

3. **No speaker model.** `speaker` is null throughout the canonical timeline. The
   editorial rule the user actually wants — "end this clip just before the other
   speaker starts" — is inexpressible without turn boundaries, and lines freely mix
   two speakers ("…and off you go **yeah this is the conversation we had**").

4. **No post-render verification.** Nothing listens to what was actually rendered, so
   every regression above shipped silently and was discovered by the user's ear.
   (This is the "inspect the render" step of the reference method that the pipeline
   never implemented.)

5. **Observability plumbing bug:** the finalizer's `leadingGapSeconds` /
   `hardHandoffStart/End` fields never reach `clips.provenance_json` — the
   selection-decision writer drops the finalizer object.

## What actually needs to be done

In priority order; 1 and 2 are the substance, and neither is a tweak to existing
boundary code — they change its inputs.

### 1. Sentence-aligned selection units (highest leverage)

Re-line the canonical timeline into *sentences*, not Whisper segments. Whisper text
already carries punctuation and capitalization; words carry timestamps. Split the
word stream at terminal punctuation (. ? !) plus capitalized-next-word confirmation,
ignoring segment boundaries entirely (`preserveSegmentBoundaries: false` path, or a
new `sentence_lines_v1` strategy in `transcriptLineService`). Every line then starts
and ends at a grammatical boundary, so *any* line range the LLM picks is
sentence-clean by construction. Expected to eliminate the mid-phrase starts/ends
outright.

### 2. Acoustic silence map as cut-placement authority

Build a silence map per episode at ingest (one ffmpeg pass, `silencedetect` at
−26 dB/0.1 s, or an energy-percentile scan reusing the PCM decode in
`generateWaveformPeaks` so the threshold adapts to the recording). Store it
(episode-level table or JSON artifact). Then:

- **Finalizer:** place the actual cut at the midpoint of the nearest silence within
  an editorial tolerance (~1.5 s) of the chosen sentence boundary; fall back to
  guarded word-snap + fade when no silence exists (genuine crosstalk).
- **Polish pass:** replace word-gap `getLineRangeBoundaryGaps` scoring with
  silence-map lookups — its current signal is provably wrong.
- **Provenance:** record which mode each boundary used (`pause_cut` vs
  `hard_handoff_faded`) — and fix the plumbing so finalizer fields actually land in
  `provenance_json` (defect 5).

### 3. Post-render boundary QA (closes the loop)

After export (and after pipeline finalization, on the source), transcribe the first
and last ~2 s of each clip with the already-integrated Whisper and check: first/last
words are complete words matching the expected transcript, and no foreign
(neighbouring-speaker) words appear. Write pass/fail + details into the clip record
and surface it in review UI. Cheap, mechanical, and would have caught every defect in
this saga automatically.

### 4. Speaker turns (bigger lift, unlocks the real editorial rule)

Local-first diarization options: sherpa-onnx speaker segmentation (CPU, bundleable),
whisper.cpp tinydiarize, or an opt-in cloud STT with diarization. With turns on the
timeline: lines never span speakers, clip ends prefer turn ends, and "end just before
the next speaker starts" becomes a checkable invariant rather than a hope. Do this
after 1–3; sentence alignment plus silence cuts fix most audible roughness without it.

## What stays

The invariants in `docs/clip-timing-playbook.md` all still hold — word-grounded
boundaries, single offset, words-survive-serialization, overlap filters, re-encode
cuts, micro-fades. This plan changes what the boundary machinery is *given*:
sentence-shaped units, real acoustic pauses, and a feedback loop.
