# Ariadne Quality And Performance Plan

## Goals

Improve:

- clip quality and coherence
- timestamp accuracy across long files
- end-to-end performance for transcription and analysis
- reliability of the processing pipeline
- trustworthiness of exports, captions, and content packages

This plan is ordered by impact and dependency. Execute top to bottom unless there is a clear reason to parallelize.

## Current State Summary

Transcription flow:

- FFmpeg extracts mono 16kHz WAV audio
- local `whisper` CLI transcribes
- transcript segments and optional word timestamps are stored in SQLite

Clip selection flow:

- OpenRouter chat completion is asked to select clips from the transcript
- current model is:
  - `deepseek/deepseek-r1` when config model is `deepseek-r1`
  - `anthropic/claude-3-5-sonnet-20241022` otherwise
- the app accepts AI-proposed clips if duration is between 35 and 60 seconds

Known weaknesses:

- chunk timestamp merging uses a hard-coded 600-second offset
- fallback prompts lose timestamp grounding
- clip transcript extraction for content generation is approximate
- clip-local transcript queries miss overlapping segments
- fresh databases likely do not create `clip_titles` and `clip_descriptions`
- repo is not typecheck-clean

## Design Direction

The system should move from:

- "LLM invents clip timestamps and we lightly filter"

To:

- "deterministic candidate windows are generated from transcript structure"
- "LLM evaluates, labels, and ranks grounded candidates"
- "post-processing validators reject incoherent or weak cuts"

This is the single biggest quality improvement available.

## Phase 1: Correctness And Data Integrity

### 1. Fix chunk timestamp alignment

Files:

- `src/main/services/localWhisperService.ts`
- `src/main/services/processingPipeline.ts`

Tasks:

- replace hard-coded `cumulativeOffset += 600`
- pass real chunk durations into chunk merge logic
- add tests covering:
  - full 10-minute chunk
  - short final chunk
  - non-10-minute future chunk sizes

Success criteria:

- merged transcript timestamps match original media timeline exactly

### 2. Fix clip transcript overlap queries

Files:

- `src/main/database/database.ts`

Tasks:

- change clip transcript query from fully-contained segment matching to overlap matching
- include segments where:
  - `segment.end_time > clip.start_time`
  - `segment.start_time < clip.end_time`
- add tests for:
  - clip starts inside a segment
  - clip ends inside a segment
  - clip fully covers multiple segments

Success criteria:

- captions and transcript editing remain complete even when clip boundaries cut through segment edges

### 3. Replace approximate clip text extraction

Files:

- `src/main/services/processingPipeline.ts`
- `src/main/database/database.ts`

Tasks:

- remove the word-count approximation used for `extractClipText`
- build clip text from stored transcript segments and, when possible, word timestamps
- use transcript slices as the source of truth for content generation

Success criteria:

- titles and descriptions are generated from the actual clip transcript, not a rough estimate

### 4. Fix missing schema objects and idempotency

Files:

- `src/main/database/database.ts`
- `src/main/database/schema.sql`

Tasks:

- add migrations for:
  - `clip_titles`
  - `clip_descriptions`
  - `clip_thumbnails` if needed for consistency
- make inserts idempotent or upsert-based for generated content rows
- verify fresh install and existing DB upgrade paths

Success criteria:

- fresh databases can generate titles and descriptions without runtime failures

## Phase 2: Clip Selection Quality

### 5. Remove ungrounded fallback timestamp prompts

Files:

- `src/main/services/aiService.ts`

Tasks:

- remove fallback prompts that ask for timestamps without transcript segment grounding
- if fallback is needed, make the model return:
  - segment IDs
  - candidate indices
  - or quoted text spans
- do not accept freeform timestamps unless they can be resolved against actual segments

Success criteria:

- every clip suggestion is traceable to transcript structure

### 6. Introduce deterministic candidate generation

Files:

- new service recommended: `src/main/services/clipCandidateService.ts`
- integrate in `src/main/services/processingPipeline.ts`

Tasks:

- generate candidate windows from transcript structure before calling the LLM
- use heuristics such as:
  - sentence and segment boundaries
  - silence or pause gaps
  - Q&A turns
  - narrative transitions
  - high-information-density spans
  - avoidance of clips that begin or end mid-thought
- produce candidate windows in the target length band, for example:
  - ideal: 40 to 55 seconds
  - acceptable: 35 to 60 seconds

Success criteria:

- the LLM ranks and explains grounded candidates instead of inventing cuts from scratch

### 7. Add post-LLM validators

Files:

- new validator recommended: `src/main/services/clipValidationService.ts`
- integrate in `src/main/services/aiService.ts` or pipeline layer

Tasks:

- validate that each selected clip:
  - aligns to real segment boundaries
  - contains the claimed `key_quote`
  - starts cleanly and ends cleanly
  - is not too context-dependent
  - does not duplicate another selected clip
  - does not overlap excessively with another selected clip
- either reject bad clips or snap them to the nearest acceptable boundaries

Success criteria:

- no accepted clip starts or ends mid-sentence without a strong reason

### 8. Add local re-ranking

Files:

- new service recommended: `src/main/services/clipRankingService.ts`

Tasks:

- compute a local quality score from grounded features:
  - opening hook strength
  - ending completeness
  - sentence completeness
  - quote density
  - novelty vs already-selected clips
  - context dependence
  - transcript cleanliness
- combine local score with model score instead of trusting `shareability_score` directly

Success criteria:

- selected clips are coherent, non-redundant, and consistently high quality

## Phase 3: Performance

### 9. Reduce transcription cost and latency

Files:

- `src/main/services/processingPipeline.ts`
- `src/main/services/localWhisperService.ts`
- `src/main/services/ffmpegService.ts`

Tasks:

- make Whisper model configurable by quality tier
- consider defaulting to a faster model for exploratory processing
- avoid inflating files unnecessarily when preparing audio for transcription
- cache transcript outputs by media hash

Success criteria:

- repeated runs on the same file avoid re-transcription
- long-form ingest is meaningfully faster

### 10. Parallelize chunk transcription safely

Files:

- `src/main/services/localWhisperService.ts`

Tasks:

- support bounded parallel chunk transcription
- maintain ordered merge
- gate concurrency by CPU/GPU capability
- keep a sequential fallback for weak machines

Success criteria:

- long files process faster without breaking timestamp integrity

## Phase 4: Reliability And Developer Velocity

### 11. Make the repo typecheck-clean

Files:

- `src/renderer/src/types/electron.d.ts`
- `src/main/preload.ts`
- renderer components and stores with current compile failures

Tasks:

- reconcile preload API types with renderer declarations
- remove stale components or exclude unused backup files from typecheck
- fix current renderer type errors systematically

Success criteria:

- `npm run typecheck` passes cleanly

### 12. Add focused tests

Recommended coverage:

- chunk merge alignment
- transcript overlap selection
- candidate window generation
- AI response parsing
- clip validation and de-duplication
- schema migration boot on fresh and upgraded databases

Success criteria:

- core clip-selection behavior is testable without running the full app manually

## Prompt And Skill Strategy

### Recommendation

Use both:

- a repo-local clip-selection specification document
- a strong system prompt in code for runtime behavior

Do not rely on a Codex `SKILL.md` alone for production clip selection.

Reason:

- `SKILL.md` is useful for development workflows, review standards, or how agents should modify this repo
- it does not control the runtime behavior of the app when Ariadne calls OpenRouter
- the production clip-selection behavior must live in the application prompt and validator pipeline

### What To Add

1. Add a repo document such as:

- `docs/clip-selection-spec.md`

This should define:

- platform-specific success criteria
- clip anatomy
- disallowed cuts
- scoring rubric
- candidate generation rules
- validation rules

2. Refactor runtime prompting so the system prompt is explicit and durable:

- define a single clip-selection prompt builder with strict instructions
- make the model score candidates, not invent timestamps
- include platform goal as input:
  - YouTube Shorts
  - TikTok
  - Instagram Reels

3. Treat prompt quality as one layer, not the whole solution:

- deterministic candidate generation
- prompt-based scoring
- post-LLM validation

### Add A Clip Selection Spec

Recommended file:

- `docs/clip-selection-spec.md`

This spec should define:

- target platforms and ranking goals
- what counts as a strong hook
- what counts as a complete ending
- coherence rules
- context-independence rules
- duplicate and overlap penalties
- selection diversity rules
- examples of good and bad clips

This spec is the product contract. The runtime prompt should implement it, and validators should enforce it.

### Add A Model Selection Workstream

The plan should explicitly include model suitability, latency, and cost as a tracked workstream.

Tasks:

- benchmark current and candidate models on the same grounded candidate set
- measure:
  - clip coherence
  - hook strength
  - boundary cleanliness
  - context independence
  - duplicate rate
  - latency
  - token usage
  - cost per processed episode
- support per-stage model routing:
  - cheap model for candidate labeling or initial scoring
  - stronger model for final ranking of top candidates

Recommended evaluation output:

- `docs/model-evaluation-march-2026.md`

This should be refreshed periodically and used to choose defaults.

## How To Think About Clip Selection

The right mental model is not "find viral moments."

The right mental model is:

- find complete, high-retention moments
- whose first 1 to 3 seconds hook attention
- whose final seconds resolve the thought
- whose body stands alone without missing setup

For YouTube Shorts specifically, optimize for:

- clean hook in the opening line
- one idea per clip
- early payoff
- minimal required context
- strong rewatchability or curiosity gap
- no mid-sentence starts
- no cut-off ending

Practical selection rules:

- prefer clips that begin at a natural transcript boundary
- prefer clips that end on a completed sentence or punchline
- prefer one strong idea over a broad theme montage
- penalize any clip that needs prior context to make sense
- penalize clips with repeated filler, hesitation, or long setup
- penalize duplicate topic coverage across selected clips

## Model Guidance

Current clip-selection model:

- `deepseek/deepseek-r1` or
- `anthropic/claude-3-5-sonnet-20241022`

Recommendation:

- use the stronger model for ranking and reasoning-heavy selection
- keep prompts structured and low-temperature
- benchmark both models on the same grounded candidate set
- stop treating the current model choice as permanent; make it a benchmarked default

### March 2026 Candidate Shortlist

Pricing snapshot as of 2026-03-26 should be treated as time-sensitive and refreshed before changing defaults.

Candidates to evaluate for clip selection and ranking:

- `anthropic/claude-sonnet-4.6`
- `anthropic/claude-sonnet-4`
- `google/gemini-2.5-pro`
- `google/gemini-2.5-flash`
- `deepseek/deepseek-r1`
- `openai/gpt-5.4`

Suggested default strategy:

- default quality mode:
  - use a stronger model for final ranking, likely Sonnet 4.6, Gemini 2.5 Pro, or GPT-5.4 depending benchmark results
- default balanced mode:
  - use Gemini 2.5 Flash or Claude Sonnet 4
- default budget mode:
  - use DeepSeek R1 or Gemini 2.5 Flash-Lite only for candidate scoring, not freeform timestamp selection

Indicative OpenRouter list pricing snapshot to benchmark against:

- `google/gemini-2.5-flash-lite`: $0.10/M input, $0.40/M output
- `google/gemini-2.5-flash`: $0.30/M input, $2.50/M output
- `deepseek/deepseek-r1`: $0.70/M input, $2.50/M output
- `google/gemini-2.5-pro`: from $1.25/M input, from $10/M output
- `openai/gpt-5.4`: $2.50/M input, $15/M output
- `anthropic/claude-sonnet-4` and `anthropic/claude-sonnet-4.6`: $3/M input, $15/M output

Evaluation set to build:

- 20 to 30 real podcast episodes or excerpts
- human-rated good and bad clips
- measure:
  - coherence
  - hook strength
  - context independence
  - duplicate rate
  - sentence-boundary cleanliness

## Suggested Execution Order

1. Fix chunk offsets
2. Fix overlap transcript queries
3. Replace approximate clip transcript extraction
4. Add missing schema migrations
5. Remove ungrounded timestamp fallback prompts
6. Implement deterministic candidate generation
7. Implement clip validators
8. Add local re-ranking
9. Make typecheck pass
10. Add regression tests

## Immediate Next Slice

Recommended first implementation batch:

1. timestamp alignment fix
2. overlap query fix
3. transcript-slice fix for content generation
4. schema migration fix

This batch improves correctness immediately and lowers risk before changing selection behavior.
