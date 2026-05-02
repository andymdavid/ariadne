# Clip Evaluation Harness

## Purpose

Provide a repeatable way to compare clip-selection outputs across:

- models
- prompt changes
- ranking changes
- validation changes

This harness is intentionally lightweight. It does not run the app directly. It scores saved clip-selection outputs against a fixture.

The harness should evolve with the editorial-arc architecture in `Design-docs/18-World-Class-Editorial-Arc-Clipping-Implementation-Plan.md`. Final clip scoring remains useful, but the primary offline checks should move toward:

- editorial unit quality
- candidate arc coverage
- arc score breakdowns
- selected arc provenance
- bad-window rejection before final boundary validation

## Files

- script: `scripts/evaluate-clip-selection.js`
- builder: `scripts/build-clip-fixture.js`
- fixture template: `docs/clip-evaluation-fixture-template.json`

## Usage

Run:

```bash
npm run eval:clips -- docs/clip-evaluation-fixture-template.json path/to/result.json
```

Example:

```bash
npm run eval:clips -- docs/clip-evaluation-fixture-template.json docs/clip-evaluation-result-example.json
```

Where `result.json` has this shape:

```json
{
  "clips": [
    {
      "id": "clip_1",
      "startTime": 12.4,
      "endTime": 54.8,
      "duration": 42.4,
      "keyQuote": "exact quote from the clip"
    }
  ]
}
```

## Fixture Format

Each fixture should contain:

- `name`
- `transcriptSegments`
- `expectedGoodClips`
- `expectedBadRanges`

The expected-good ranges represent human-approved target windows.
The expected-bad ranges represent regions that should be avoided.

## Metrics

The harness scores:

- overlap with expected-good clips
- overlap with expected-bad ranges
- boundary cleanliness against transcript boundaries
- quote grounding in transcript text
- duplicate overlap across selected clips

Next version should also score:

- whether selected clips reference candidate arc IDs
- whether candidate arcs contain coherent unit sequences
- hook, context, flow, payoff, and density scores
- whether known bad windows score poorly before final validation

## Recommended Workflow

1. Export transcript segments to JSON.
2. Generate a fixture skeleton:

```bash
npm run build:clip-fixture -- path/to/transcript.json eval/fixtures/episode-001.json path/to/result.json
```

3. Open the generated fixture and mark:
   - `expectedGoodClips`
   - `expectedBadRanges`
4. Save model outputs as JSON files.
5. Score each output with the harness.
6. Track:
   - average clip score
   - expected-good coverage
   - bad-range intrusion
   - qualitative notes

## What Good Looks Like

Prefer outputs with:

- higher average clip score
- high expected-good coverage
- low bad-range intrusion
- low duplicate overlap

This harness is not a substitute for human judgment, but it creates a stable baseline for regression checking and model comparisons.
