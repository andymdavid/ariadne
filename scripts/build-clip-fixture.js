#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

function main() {
  const transcriptPath = process.argv[2]
  const outputPath = process.argv[3]
  const seedResultPath = process.argv[4]

  if (!transcriptPath || !outputPath) {
    console.error('Usage: node scripts/build-clip-fixture.js <transcript.json> <output-fixture.json> [seed-result.json]')
    process.exit(1)
  }

  const transcriptInput = readJson(transcriptPath)
  const transcriptSegments = normalizeTranscriptSegments(transcriptInput)

  if (!transcriptSegments.length) {
    console.error('No transcript segments found in input.')
    process.exit(1)
  }

  const fixture = {
    name: path.basename(outputPath, path.extname(outputPath)),
    transcriptSegments,
    expectedGoodClips: [],
    expectedBadRanges: [],
    seedCandidateClips: seedResultPath ? normalizeClips(readJson(seedResultPath)) : []
  }

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(fixture, null, 2)}\n`)

  console.log(`Wrote fixture skeleton to ${outputPath}`)
  console.log(`Transcript segments: ${transcriptSegments.length}`)
  console.log(`Seed candidate clips: ${fixture.seedCandidateClips.length}`)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'))
}

function normalizeTranscriptSegments(input) {
  const segments = Array.isArray(input)
    ? input
    : Array.isArray(input.segments)
      ? input.segments
      : Array.isArray(input.transcriptSegments)
        ? input.transcriptSegments
        : []

  return segments
    .map(segment => ({
      start: asNumber(segment.start ?? segment.start_time),
      end: asNumber(segment.end ?? segment.end_time),
      text: String(segment.text || '').trim()
    }))
    .filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.text.length > 0)
}

function normalizeClips(input) {
  const clips = Array.isArray(input)
    ? input
    : Array.isArray(input.clips)
      ? input.clips
      : Array.isArray(input.potentialClips)
        ? input.potentialClips
        : []

  return clips
    .map((clip, index) => ({
      id: clip.id || `clip_${index + 1}`,
      startTime: asNumber(clip.startTime ?? clip.start_time),
      endTime: asNumber(clip.endTime ?? clip.end_time),
      duration: asNumber(clip.duration ?? ((clip.endTime ?? clip.end_time) - (clip.startTime ?? clip.start_time))),
      keyQuote: String(clip.keyQuote ?? clip.key_quote ?? '').trim()
    }))
    .filter(clip => Number.isFinite(clip.startTime) && Number.isFinite(clip.endTime))
}

function asNumber(value) {
  return typeof value === 'number' ? value : Number(value)
}

main()
