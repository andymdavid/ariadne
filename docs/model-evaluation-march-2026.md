# Model Evaluation - March 2026

## Scope

This document tracks model suitability for Ariadne clip selection and content generation as of 2026-03-26.

These recommendations are time-sensitive and should be refreshed before changing defaults.

## Current Code State

Current clip selection is now grounded candidate ranking rather than freeform timestamp invention.

This changes the model requirements:

- we need strong comparative judgment
- we need clean JSON compliance
- we do not need the model to hallucinate timestamps

That favors stable ranking models over open-ended transcript extraction behavior.

## Recommended Modes

### Balanced Default

- Model: `google/gemini-2.5-flash`
- Use for: default clip ranking and general production use
- Why:
  - strong price/performance
  - good enough ranking quality for grounded candidates
  - materially cheaper than premium models

### Quality Mode

- Model: `anthropic/claude-sonnet-4.6`
- Alternate: `openai/gpt-5.4`
- Use for:
  - premium clip ranking
  - benchmark comparisons
  - higher-stakes creator workflows
- Why:
  - better judgment on coherence, context independence, and payoff
  - better suited for final ranking than for raw timestamp generation

### Budget Mode

- Model: `google/gemini-2.5-flash-lite`
- Alternate: `deepseek/deepseek-r1`
- Use for:
  - low-cost experimentation
  - candidate pre-scoring
  - not recommended as the sole final selector for best quality

## Indicative OpenRouter Pricing Snapshot

As of 2026-03-26:

- `google/gemini-2.5-flash-lite`: about $0.10/M input, $0.40/M output
- `google/gemini-2.5-flash`: about $0.30/M input, $2.50/M output
- `deepseek/deepseek-r1`: about $0.70/M input, $2.50/M output
- `google/gemini-2.5-pro`: from about $1.25/M input, from about $10/M output
- `openai/gpt-5.4`: about $2.50/M input, $15/M output
- `anthropic/claude-sonnet-4`: about $3/M input, $15/M output
- `anthropic/claude-sonnet-4.6`: about $3/M input, $15/M output

These prices should be re-verified before changing defaults.

## Cost Intuition

Inference:

- a grounded ranking pass for a 60-minute episode is often closer to candidate evaluation than full-transcript freeform reasoning
- a typical pass may be on the order of:
  - 20k input tokens
  - 2k output tokens

Approximate per-pass cost at that size:

- `google/gemini-2.5-flash-lite`: about $0.0028
- `google/gemini-2.5-flash`: about $0.011
- `deepseek/deepseek-r1`: about $0.019
- `google/gemini-2.5-pro`: about $0.045
- `openai/gpt-5.4`: about $0.08
- `anthropic/claude-sonnet-4` / `4.6`: about $0.09

Implication:

- stronger final ranking models are affordable if Ariadne avoids repeated full-transcript retries
- architecture matters more than raw model cost

## Model Suitability Notes

### `google/gemini-2.5-flash`

Best current default for Ariadne.

Strengths:

- good price/performance
- suitable for grounded candidate ranking
- cheap enough for routine use

Weaknesses:

- not always the best final arbiter when very subtle coherence judgments matter

### `anthropic/claude-sonnet-4.6`

Best premium option for ranking quality.

Strengths:

- strong reasoning about coherence and self-containment
- good fit for final ranking and explanation quality

Weaknesses:

- materially more expensive than Flash

### `openai/gpt-5.4`

Strong premium alternative.

Strengths:

- strong structured reasoning and ranking quality
- good premium benchmark candidate

Weaknesses:

- premium pricing

### `deepseek/deepseek-r1`

Useful budget helper, not ideal as sole default.

Strengths:

- inexpensive enough for low-cost usage

Weaknesses:

- less desirable as final selector when quality issues are coherence and boundary cleanliness

### `google/gemini-2.5-flash-lite`

Good for low-cost helper passes.

Strengths:

- extremely cheap

Weaknesses:

- should not be the highest-quality default for final selection

## Routing Recommendation

If Ariadne adds multi-model routing:

- candidate scoring:
  - `google/gemini-2.5-flash-lite` or `google/gemini-2.5-flash`
- final ranking:
  - `google/gemini-2.5-flash` by default
  - `anthropic/claude-sonnet-4.6` or `openai/gpt-5.4` in quality mode
- content package generation:
  - `google/gemini-2.5-flash` for balanced mode
  - `anthropic/claude-sonnet-4.6` or `openai/gpt-5.4` for premium mode

## Evaluation Harness To Build

Benchmark on a fixed evaluation set:

- 20 to 30 real episodes or excerpts
- human-rated examples of:
  - strong clips
  - weak clips
  - mid-thought cuts
  - context-heavy cuts

Metrics:

- hook strength
- ending completeness
- coherence
- context independence
- duplicate rate
- quote grounding
- latency
- cost

## Current Repo Recommendation

Near-term default:

- clip selection model: `google-gemini-2.5-flash`
- clip selection platform default: `youtube_shorts`

Quality mode:

- `anthropic/claude-sonnet-4.6`

Budget mode:

- `google-gemini-2.5-flash-lite`

Do not keep using a 2024-vintage Sonnet model as the main default.
