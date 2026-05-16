# LLM Thread Selector Technical Plan

## Decision

Ariadne's next production clipping path is `llm_thread_v1`.

`llm_thread_v1` replaces brute-force boundary search as the primary rough-cut selector. It must not quietly coexist with legacy selectors or hidden fallback paths. If a fallback runs, run metadata must name it, explain why it ran, and preserve the configured selector mode.

The product goal remains Coherent Rough Cuts v1: produce conversational rough cuts that may be loose or padded, but do not start mid-thought, require missing context, or end before the current thought lands.

## Production Path

The intended production flow is:

1. Build a canonical conversational timeline.
2. Ask the LLM to discover coherent conversational threads by transcript line range.
3. Mechanically verify line ranges against media timing and provenance.
4. If verification finds a repairable coherence issue, ask the LLM to repair the line range using nearby context.
5. Snap accepted line ranges to word/media boundaries.
6. Deduplicate and rank the final rough-cut portfolio.
7. Persist accepted and rejected candidates with exact stage and reason.

Code handles media physics. The LLM handles editorial judgment.

## Selector Modes

Supported selector modes:

- `llm_thread_v1`: new production path. No hidden fallback.
- `arc_v1`: current arc path, retained during migration.
- `legacy`: existing legacy selector stack, retained only for explicit fallback/testing.

Mode rules:

- `llm_thread_v1` may call its own LLM repair loop.
- `llm_thread_v1` may not silently call word-span, candidate ranking, transcript-line agent, heuristic, or resolved-clip legacy fallbacks.
- If fallback is explicitly enabled, metadata must include `configuredSelectorMode`, `primarySelectorMode`, `fallbackAttempted`, `fallbackSource`, `fallbackReason`, and `finalSelectionSource`.
- A run configured as `llm_thread_v1` must complete as `llm_thread_v1` even if it returns zero clips.

## Canonical Conversational Timeline

Ariadne does not need a single "transcript." It needs a canonical conversational timeline assembled from available sources.

Canonical timeline shape:

```ts
type CanonicalConversationalTimeline = {
  mediaDuration: number
  lines: CanonicalTranscriptLine[]
  words: CanonicalTimedWord[]
  sourceMetadata: TranscriptSourceMetadata
  quality: TranscriptQualityReport
}

type CanonicalTranscriptLine = {
  id: string
  index: number
  startTime: number | null
  endTime: number | null
  speaker: string | null
  text: string
  wordIds: string[]
  semanticSource: 'whisper' | 'uploaded_srt' | 'uploaded_vtt' | 'uploaded_txt' | 'aligned_txt'
  timingSource: 'whisper' | 'uploaded_word_timing' | 'uploaded_segment_timing' | 'whisper_alignment' | 'interpolated' | 'none'
}

type CanonicalTimedWord = {
  id: string
  lineId: string | null
  word: string
  startTime: number
  endTime: number
  speaker: string | null
  timingSource: string
}
```

The selector consumes only this canonical timeline. It must not care whether text came from Whisper, upload, or alignment.

## Transcript Import Modes

Transcript upload is a foundation layer, not selector logic.

Supported v1 formats:

- `.srt`
- `.vtt`
- `.txt`

Import classifications:

- `timed_word_transcript`: reliable word-level timing; can skip transcription after validation.
- `timed_segment_transcript`: line/caption/paragraph timing; can skip full transcription but may need interpolation or alignment inside segments.
- `untimed_verbatim_transcript`: run guided alignment to recover timings.
- `untimed_cleaned_transcript`: run Whisper, then fuzzy-align uploaded text to Whisper timing.
- `speaker_notes_or_summary`: attach as metadata only; do not use as transcript.
- `mismatched_transcript`: reject for transcript use or fall back to auto-transcription.

Rules:

- Plain `.txt` is useful, but it cannot skip transcription by itself.
- An LLM may structure, clean, classify, or explain transcript alignment.
- An LLM must not invent timestamps.
- Timestamp assignment must come from uploaded timings, forced alignment, Whisper timings, or deterministic/fuzzy alignment to audio-derived timings.

For `.txt` v1:

1. Parse uploaded text into paragraphs, possible speaker turns, and lines.
2. Run Whisper to get timed words.
3. Fuzzy-align uploaded text to the Whisper word stream.
4. If confidence is high, use uploaded text/speakers for semantic lines and Whisper timings for cuts.
5. If confidence is medium, use uploaded text as semantic guidance and Whisper text for exact cutting.
6. If confidence is low, ignore uploaded text for timing and use normal Whisper transcript.

## LLM Thread Discovery Interface

The LLM discovers thread candidates from canonical transcript lines.

Input:

```ts
type ThreadDiscoveryInput = {
  timelineId: string
  chunkId: string
  mediaDuration: number
  lines: Array<{
    index: number
    startTime: number | null
    endTime: number | null
    speaker: string | null
    text: string
  }>
  target: {
    minDurationSeconds: number
    maxDurationSeconds: number
    goal: 'find_all_usable_coherent_rough_cuts'
  }
}
```

Output:

```ts
type ThreadCandidate = {
  id: string
  startLineIndex: number
  endLineIndex: number
  title: string
  reason: string
  selfContained: boolean
  expectedContext: string | null
  expectedPayoff: string | null
  confidence: number
}
```

Discovery rules:

- Do not request a fixed clip count like "1-3."
- Ask for all usable coherent rough cuts above the quality bar.
- Return none if no usable clip exists in the chunk.
- For long videos, process overlapping chunks and deduplicate later.
- The model chooses line ranges, not exact word timestamps.

## Mechanical Verification Interface

Verification confirms whether a model-selected line range can become a media clip.

```ts
type MechanicalClipVerification = {
  candidateId: string
  status: 'accepted' | 'needs_repair' | 'rejected'
  startTime: number | null
  endTime: number | null
  duration: number | null
  issues: Array<
    | 'missing_timing'
    | 'duration_too_short'
    | 'duration_too_long'
    | 'ungrounded_text'
    | 'leading_continues_previous_thought'
    | 'lookahead_continues_current_ending'
    | 'overlap_suppressed'
  >
  repairPromptContext?: {
    previousLines: number[]
    currentLines: number[]
    nextLines: number[]
  }
}
```

Verification may flag obvious boundary issues, but it should not try to replace LLM editorial judgment with hundreds of thousands of variants.

## LLM Repair Interface

If verification returns `needs_repair`, send the candidate back to the LLM with the issue list and surrounding lines.

```ts
type ThreadRepairInput = {
  candidate: ThreadCandidate
  issues: MechanicalClipVerification['issues']
  surroundingLines: ThreadDiscoveryInput['lines']
  instruction: 'repair_line_range_or_mark_unrecoverable'
}

type ThreadRepairOutput = {
  status: 'repaired' | 'unrecoverable'
  startLineIndex: number | null
  endLineIndex: number | null
  reason: string
}
```

Repair rules:

- Maximum repair attempts: 2.
- If both `leading_continues_previous_thought` and `lookahead_continues_current_ending` appear, classify as `needs_parent_thread_expansion`.
- Parent-thread expansion should use adjacent transcript lines, editorial units, and speaker turns when available.
- If repaired range exceeds duration cap, return `unrecoverable` with `duration_too_long`.

## Boundary Variants

`llm_thread_v1` must not generate arbitrary Cartesian products of start and end anchors.

Allowed mechanical variants are limited to a small set around model-selected boundaries:

- selected line start/end
- previous line start
- next line end
- nearest word boundary
- nearest pause boundary
- speaker-turn boundary when available

Variant count target:

- Normal candidate: fewer than 20 variants.
- Repaired candidate: fewer than 50 variants.
- Whole run target: fewer than 2,000 mechanical variants for a 10-minute file.

The 600k variant behavior is explicitly retired for `llm_thread_v1`.

## Files To Keep

Keep and adapt:

- `src/main/workers/pipelineWorker.ts`
- `src/main/services/processingPipeline.ts`
- `src/main/services/finalClipValidationService.ts`
- `src/main/services/boundaryRepairPrimitives.ts`
- `src/shared/transcriptLines.ts`
- `src/shared/types/pipelineWorker.ts`
- `src/renderer/src/components/PipelineRunInspector.tsx`

Keep as migration/reference only:

- `src/main/services/coherentRoughCutService.ts`
- `src/main/services/arcSelectionService.ts`
- `src/main/services/clipSelectionAgentService.ts`

## Files Or Paths To Retire From Production

Retire from `llm_thread_v1` production flow:

- brute-force boundary variant generation in `coherentRoughCutService.ts`
- hidden word-span fallback
- hidden resolved-clip fallback
- hidden candidate-ranking fallback
- heuristic supplementation unless explicit `legacy` mode is selected

These paths may remain temporarily for comparison, but they must not run inside `llm_thread_v1` unless an explicit fallback flag is set and metadata records it.

## Feature Flags

Required config:

```ts
productionSelectorMode: 'legacy' | 'arc_v1' | 'llm_thread_v1'
enableExplicitFallbacks: boolean
enableTranscriptUpload: boolean
enableTxtGuidedAlignment: boolean
```

Rules:

- `enableExplicitFallbacks` defaults to `false` for `llm_thread_v1`.
- Transcript upload can be enabled independently of selector mode.
- `.txt` guided alignment can ship after `.srt` / `.vtt` import if needed.

## Run Metadata

Every run must persist:

```ts
type SelectionRunMetadata = {
  configuredSelectorMode: string
  primarySelectorMode: string
  finalSelectionSource: string
  fallbackAttempted: boolean
  fallbackSource: string | null
  fallbackReason: string | null
  transcriptInputMode: string
  semanticTextSource: string
  timingSource: string
  speakerSource: string | null
  threadCandidatesDiscovered: number
  threadCandidatesRepaired: number
  mechanicalVariantsGenerated: number
  finalClipsAccepted: number
  finalClipsRejected: number
  zeroOutputStage: string | null
}
```

Zero-output reasons must resolve to one of:

- `llm_discovery_no_candidates`
- `llm_discovery_failed`
- `repair_failed`
- `mechanical_validation_failed`
- `portfolio_suppression`
- `fallback_unavailable`
- `unknown`

## Acceptance Criteria

For known file `TGS053_SHOULDER_CLIP_1.mp4` using the same transcript:

- `llm_thread_v1` identifies conversational thread candidates by line range.
- At least one candidate overlaps a human-obvious clip region.
- If final output is zero clips, the reason is traceable to LLM discovery, repair failure, mechanical validation, or portfolio suppression.
- The run does not generate hundreds of thousands of boundary variants.
- Mechanical variants generated for the full run are below 2,000.
- Run metadata preserves configured mode and actual final source separately.
- No hidden fallback runs unless explicitly enabled.

For transcript upload:

- `.srt` and `.vtt` imports create canonical timeline lines with timings.
- `.txt` import is classified and preserved as semantic input.
- Untimed `.txt` does not skip transcription unless guided alignment produces sufficient timing confidence.
- Low-confidence or mismatched transcript import falls back to normal transcription and records why.

For code quality:

- One production selector path is active per configured mode.
- Old selectors do not bleed into `llm_thread_v1`.
- New interfaces are typed and stored in shared/service-level modules.
- Pipeline inspector exposes selector mode, transcript source mode, candidate counts, repair counts, variant counts, and zero-output reason.
