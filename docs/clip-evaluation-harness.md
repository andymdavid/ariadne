# Clip Evaluation Harness

## Purpose

Provide a repeatable way to compare clip-selection outputs across:

- models
- prompt changes
- ranking changes
- validation changes

This harness is intentionally lightweight. It does not run the app directly. It scores saved clip-selection outputs against a fixture.

## Files

- script: `scripts/evaluate-clip-selection.js`
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

## Recommended Workflow

1. Build a small benchmark set of real episodes.
2. Save model outputs as JSON files.
3. Score each output with the harness.
4. Track:
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
