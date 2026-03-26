#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

function main() {
  const fixturePath = process.argv[2]
  const resultPath = process.argv[3]

  if (!fixturePath || !resultPath) {
    console.error('Usage: node scripts/evaluate-clip-selection.js <fixture.json> <result.json>')
    process.exit(1)
  }

  const fixture = readJson(fixturePath)
  const result = readJson(resultPath)
  const clips = Array.isArray(result.clips) ? result.clips : []

  const metrics = evaluateFixture(fixture, clips)
  printReport(fixture, resultPath, metrics)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'))
}

function evaluateFixture(fixture, clips) {
  const transcriptSegments = Array.isArray(fixture.transcriptSegments) ? fixture.transcriptSegments : []
  const expectedGood = Array.isArray(fixture.expectedGoodClips) ? fixture.expectedGoodClips : []
  const expectedBad = Array.isArray(fixture.expectedBadRanges) ? fixture.expectedBadRanges : []

  const clipReports = clips.map((clip, index) => {
    const matchedGood = findBestOverlap(clip, expectedGood)
    const matchedBad = findBestOverlap(clip, expectedBad)
    const duplicateRatio = findDuplicateRatio(clip, clips, index)
    const boundaryScore = scoreBoundaries(clip, transcriptSegments)
    const quoteGrounded = isQuoteGrounded(clip, transcriptSegments)

    const score = round(
      matchedGood.overlap * 40 +
      boundaryScore * 20 +
      (quoteGrounded ? 15 : 0) +
      (1 - matchedBad.overlap) * 15 +
      (1 - duplicateRatio) * 10
    )

    return {
      id: clip.id || `clip_${index + 1}`,
      startTime: clip.startTime,
      endTime: clip.endTime,
      duration: clip.duration,
      matchedGoodOverlap: round(matchedGood.overlap),
      matchedBadOverlap: round(matchedBad.overlap),
      duplicateRatio: round(duplicateRatio),
      boundaryScore: round(boundaryScore),
      quoteGrounded,
      totalScore: score
    }
  })

  const averageScore = clipReports.length
    ? round(clipReports.reduce((sum, clip) => sum + clip.totalScore, 0) / clipReports.length)
    : 0

  const expectedGoodCoverage = expectedGood.length
    ? round(
        expectedGood.reduce((sum, goodRange) => {
          const best = clips.reduce((bestOverlap, clip) => Math.max(bestOverlap, overlapRatio(clip, goodRange)), 0)
          return sum + best
        }, 0) / expectedGood.length
      )
    : 0

  const badRangeIntrusion = expectedBad.length
    ? round(
        clips.reduce((sum, clip) => {
          const bestBad = expectedBad.reduce((bestOverlap, badRange) => Math.max(bestOverlap, overlapRatio(clip, badRange)), 0)
          return sum + bestBad
        }, 0) / Math.max(clips.length, 1)
      )
    : 0

  return {
    averageScore,
    expectedGoodCoverage,
    badRangeIntrusion,
    clipCount: clips.length,
    clipReports
  }
}

function scoreBoundaries(clip, segments) {
  if (!segments.length) return 0

  const startDistance = nearestBoundaryDistance(clip.startTime, segments.flatMap(segment => [segment.start, segment.end]))
  const endDistance = nearestBoundaryDistance(clip.endTime, segments.flatMap(segment => [segment.start, segment.end]))

  const startScore = startDistance <= 0.35 ? 1 : startDistance <= 0.8 ? 0.5 : 0
  const endScore = endDistance <= 0.35 ? 1 : endDistance <= 0.8 ? 0.5 : 0

  return (startScore + endScore) / 2
}

function nearestBoundaryDistance(time, boundaries) {
  return boundaries.reduce((closest, boundary) => Math.min(closest, Math.abs(boundary - time)), Number.POSITIVE_INFINITY)
}

function isQuoteGrounded(clip, segments) {
  if (!clip.keyQuote) return false

  const clipText = segments
    .filter(segment => segment.end > clip.startTime && segment.start < clip.endTime)
    .map(segment => segment.text)
    .join(' ')

  return normalize(clipText).includes(normalize(clip.keyQuote))
}

function findDuplicateRatio(targetClip, clips, targetIndex) {
  return clips.reduce((maxOverlap, clip, index) => {
    if (index === targetIndex) return maxOverlap
    return Math.max(maxOverlap, overlapRatio(targetClip, clip))
  }, 0)
}

function findBestOverlap(target, ranges) {
  return ranges.reduce((best, range) => {
    const overlap = overlapRatio(target, range)
    return overlap > best.overlap ? { range, overlap } : best
  }, { range: null, overlap: 0 })
}

function overlapRatio(left, right) {
  const overlapStart = Math.max(left.startTime, right.startTime)
  const overlapEnd = Math.min(left.endTime, right.endTime)
  if (overlapEnd <= overlapStart) return 0
  const overlap = overlapEnd - overlapStart
  return overlap / Math.min(left.endTime - left.startTime, right.endTime - right.startTime)
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

function printReport(fixture, resultPath, metrics) {
  console.log(`Fixture: ${fixture.name || 'Unnamed fixture'}`)
  console.log(`Result: ${resultPath}`)
  console.log(`Clip count: ${metrics.clipCount}`)
  console.log(`Average clip score: ${metrics.averageScore}/100`)
  console.log(`Expected-good coverage: ${metrics.expectedGoodCoverage}`)
  console.log(`Bad-range intrusion: ${metrics.badRangeIntrusion}`)
  console.log('')
  console.log('Per clip:')

  for (const clip of metrics.clipReports) {
    console.log(
      `- ${clip.id}: score=${clip.totalScore}, good=${clip.matchedGoodOverlap}, bad=${clip.matchedBadOverlap}, boundary=${clip.boundaryScore}, duplicate=${clip.duplicateRatio}, quote=${clip.quoteGrounded ? 'yes' : 'no'}`
    )
  }
}

main()
