# Clip Selection Spec

## Purpose

Define how Ariadne should identify, rank, and validate clips for short-form platforms.

This document is the product contract for clip selection. Runtime prompts, candidate generation, validators, and ranking should all align with it.

## Primary Objective

Select clips that maximize retention and shareability without sacrificing coherence.

The clip must:

- open cleanly
- communicate one strong idea
- resolve cleanly
- make sense without prior context

## Platform Priorities

### YouTube Shorts

Optimize for:

- immediate hook in first 1 to 3 seconds
- one self-contained insight, story beat, or opinion
- clean ending or payoff
- high replay or curiosity value

Penalize:

- slow setup
- context-heavy references
- cut-off endings
- vague conversation fragments

### Instagram Reels

Optimize for:

- emotionally legible moments
- concise, polished delivery
- memorable quotable lines
- low-friction comprehension

Penalize:

- rambling setup
- overlong explanation
- dependence on episode-wide context

### TikTok

Optimize for:

- strong opening line
- tension, novelty, or surprise
- fast payoff
- punchy language

Penalize:

- weak first sentence
- explanatory filler
- flat or unfinished endings

## Hard Requirements

Every accepted clip must:

- be between 35 and 60 seconds
- begin on a natural transcript boundary
- end on a completed sentence or clear payoff
- contain a complete thought or narrative unit
- stand alone without requiring major prior context
- be traceable to actual transcript segments

## Disallowed Cuts

Reject clips that:

- start mid-sentence
- end mid-sentence
- depend on unresolved references like "as I said before"
- are mostly setup with no payoff
- repeat the same idea as another selected clip
- contain a key quote that does not exist in the selected transcript span

## Candidate Generation Rules

Generate candidates from transcript structure before model ranking.

Prefer windows that:

- start after a pause or topic transition
- begin with a strong declarative sentence, question, or story setup
- end at a sentence boundary or punchline
- contain high information density
- avoid extended filler, hesitation, or housekeeping

Candidate set should:

- target ideal windows around 40 to 55 seconds
- allow 35 to 60 seconds for final acceptance
- include diverse content types
- avoid heavy overlap unless ranking alternatives intentionally

## Ranking Dimensions

Each candidate should be scored on:

- hook strength
- coherence
- ending quality
- context independence
- quote quality
- novelty vs other selected candidates
- platform fit

## Selection Diversity

The final selected set should avoid redundancy.

Penalize:

- multiple clips saying the same thing
- repeated examples of the same theme
- near-duplicate adjacent windows

Prefer:

- topic variety
- tonal variety
- a mix of insight, story, hot take, and advice where appropriate

## Validation Rules

After model ranking, Ariadne must validate that each clip:

- maps to real transcript segments
- contains the quoted text
- satisfies duration bounds
- satisfies overlap thresholds
- has a clean opening and ending

Any clip that fails validation should be rejected or snapped to the nearest valid boundaries and revalidated.

## Model Role

The model should not invent timestamps freely.

Preferred model role:

- evaluate grounded candidate windows
- explain why a candidate is strong or weak
- assign structured scores
- propose a better candidate only by referencing transcript segments or candidate IDs

## Output Expectations

For each accepted clip, produce:

- grounded start and end boundaries
- content type
- shareability score
- key quote taken exactly from the transcript span
- rationale tied to hook, payoff, and context independence

## Quality Bar

A good Ariadne clip should feel like:

- a complete short-form post
- not an excerpt that obviously came from the middle of a longer conversation

If the clip feels like the middle of a theme, it should fail selection.
