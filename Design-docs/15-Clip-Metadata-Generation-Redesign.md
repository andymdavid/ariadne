# Clip Metadata Generation Redesign

## Goal

Replace the current single-shot metadata generator with a reliable multi-stage system that can:

- understand the full clip transcript
- identify what the clip is actually about
- package that meaning into strong YouTube-ready titles and descriptions
- fail gracefully without collapsing into transcript-fragment sludge

This redesign applies to both:

- pipeline-time metadata generation during clip processing
- manual `Generate` / `Regenerate` in Clip Workspace

## Current Problems

The current design is not sound enough for production-quality metadata.

### Observed failure modes

- model responses are often truncated before the description field is emitted
- title generation sometimes succeeds partially, but description generation often falls through to fallback
- fallback currently works from transcript fragments rather than a structured understanding of the clip
- transcript metaphors or incidental phrases can dominate topic extraction
- one failure path affects title generation, description generation, and persistence together

### Root cause

The current path couples:

- semantic understanding
- title generation
- description generation
- JSON parsing
- fallback recovery

into one brittle request.

That makes the system hard to debug and hard to improve.

## Target Architecture

The new system should have three layers:

1. Meaning extraction
2. Packaging generation
3. Validation and selection

These layers should be separated in code and storage.

## Layer 1: Meaning Extraction

### Purpose

Determine what the clip is actually about before trying to package it.

### Inputs

- full clip transcript
- clip key quote
- clip content type
- optional brand voice examples

### Output shape

Store a structured `clip metadata analysis` object with fields like:

- `primary_topic`
- `core_claim`
- `supporting_points`
- `audience_angle`
- `why_it_matters`
- `tone`
- `key_entities`
- `risk_flags`
- `source_excerpt_refs`

### Requirements

- the extraction should be grounded in the whole transcript, not only the first few sentences
- it should prefer central claims over colorful metaphors
- it should explicitly identify the argument of the clip, not just the nouns mentioned in it
- it should be small and structured enough to validate

### Failure handling

If extraction fails:

- retry with stricter prompt
- if still failing, fall back to deterministic extraction from transcript structure
- deterministic extraction should output the same structured fields, not raw transcript phrases

## Layer 2: Packaging Generation

### Purpose

Generate titles and descriptions from the structured meaning object, not directly from the raw transcript.

### Inputs

- extracted meaning object
- optional brand voice examples
- optional platform target, initially `youtube`

### Outputs

- `titles`: 3-5 candidates
- `descriptions`: 1-2 candidates

### Title requirements

- under 55 characters preferred
- 3-8 words preferred
- high-curiosity without clickbait
- accurate to the extracted claim
- no transcript-like phrasing
- no filler-led fragments

### Description requirements

- concise and useful for YouTube
- summarize the clip’s central meaning
- explain why the point matters
- not just a sentence lifted from the transcript
- ideally 2 short sentences

### Failure handling

If packaging fails:

- retry with stricter output prompt
- if still failing, build deterministic packaging from the extracted meaning object

Deterministic packaging should use:

- `primary_topic`
- `core_claim`
- `why_it_matters`
- `audience_angle`

It should not rank raw transcript fragments directly.

## Layer 3: Validation and Selection

### Purpose

Reject weak metadata before it is persisted as selected content.

### Title validation

Reject titles that:

- are too literal to the transcript
- begin mid-thought
- contain filler framing
- anchor on irrelevant metaphors
- are generic or empty
- have weak semantic connection to `primary_topic` or `core_claim`

### Description validation

Reject descriptions that:

- are transcript fragments
- start mid-thought
- over-index on incidental phrases
- fail to explain why the clip matters
- are too short or too generic

### Selection behavior

Persist:

- one selected title
- one selected description
- alternate candidates for user choice

The selected metadata should always come from validated candidates.

## Data Model Changes

Add a new table for semantic analysis.

### `clip_metadata_analysis`

Suggested fields:

- `id`
- `clip_id`
- `primary_topic`
- `core_claim`
- `supporting_points_json`
- `audience_angle`
- `why_it_matters`
- `tone`
- `key_entities_json`
- `risk_flags_json`
- `source_excerpt_refs_json`
- `provider`
- `model_id`
- `raw_response_json`
- `created_at`
- `updated_at`

### Existing tables to keep

- `clip_titles`
- `clip_descriptions`

Those remain the packaging layer.

## Service Design

### New responsibilities

#### `AIService`

Should be split conceptually into:

- `extractClipMetadataMeaning(...)`
- `generateClipMetadataPackaging(...)`

The current `generateContentPackage(...)` path should become a coordinator rather than a single-shot generator.

### Suggested flow

1. extract meaning from transcript
2. validate the meaning object
3. generate packaging from that meaning
4. validate packaging
5. persist analysis + selected metadata + alternates

## Prompt Design

### Extraction prompt

The extraction prompt should ask for:

- main subject
- central claim
- supporting claims
- target audience relevance
- why the claim matters

It should explicitly instruct the model to ignore:

- decorative metaphors
- filler language
- setup clauses that are not the point

### Packaging prompt

The packaging prompt should receive:

- the structured meaning object
- not the raw transcript alone

It should ask for:

- title candidates
- description candidates

and require that each candidate reflect the extracted claim.

## Deterministic Fallback Design

Fallback should operate from the structured meaning object, not directly from the transcript.

### Deterministic title templates

Examples:

- `Why <primary_topic> Matters`
- `The Real Problem With <primary_topic>`
- `<core_claim>` compressed into title form

### Deterministic description template

Use:

- `core_claim`
- `why_it_matters`

Example shape:

- sentence 1: what the clip argues
- sentence 2: why that matters for the audience

This should be semantically correct even if not highly creative.

## UI and UX

No major UI redesign is required for v1 of the redesign.

### Keep

- current Title field
- current Description field
- current Generate / Regenerate / Save content controls
- current alternate option lists

### Optional later enhancement

Add a small `Analysis` drawer for debugging, showing:

- primary topic
- core claim
- why it matters

This is optional and should not block the redesign.

## Pipeline Integration

The redesigned metadata generation should run:

- during pipeline-time clip processing
- during manual regenerate in Clip Workspace

Both paths must call the same coordinator.

That means the shared metadata path should be fixed once, not separately in pipeline and UI.

## Implementation Plan

### Slice 1: Data model

- add `clip_metadata_analysis` table
- add types and DB access methods

### Slice 2: Meaning extraction

- implement `extractClipMetadataMeaning(...)`
- persist analysis object
- add deterministic meaning fallback

### Slice 3: Packaging generation

- implement `generateClipMetadataPackaging(...)`
- make it consume the meaning object
- keep alternate titles and descriptions

### Slice 4: Validation

- add title validation rules
- add description validation rules
- ensure only validated metadata becomes selected

### Slice 5: Integrate shared path

- replace current single-shot `generateContentPackage(...)`
- route both pipeline and manual regenerate through the new path

### Slice 6: Quality pass

- test on problematic existing clips
- test on fresh pipeline runs
- confirm:
  - titles are semantically relevant
  - descriptions summarize meaning rather than transcript wording

## Success Criteria

The redesign is successful when:

- titles are about the actual clip topic, not incidental metaphors
- descriptions summarize the clip’s argument and why it matters
- pipeline-time and manual regeneration produce comparable quality
- model truncation no longer destroys the whole metadata result
- fallback output is semantically useful, not embarrassing

## Non-Goals

This redesign does not aim to solve:

- clip count regression
- caption timing alignment
- export styling parity
- scheduling UI behavior

Those are separate concerns.
