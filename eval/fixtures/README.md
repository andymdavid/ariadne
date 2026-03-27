# Eval Fixtures

Store real clip-selection benchmark fixtures here.

Suggested workflow:

1. Export transcript segments to JSON.
2. Export a candidate clip result set to JSON.
3. Build a fixture skeleton:

```bash
npm run build:clip-fixture -- path/to/transcript.json eval/fixtures/episode-001.json path/to/result.json
```

4. Open the generated fixture and fill in:
   - `expectedGoodClips`
   - `expectedBadRanges`
5. Run evaluation:

```bash
npm run eval:clips -- eval/fixtures/episode-001.json path/to/result.json
```
