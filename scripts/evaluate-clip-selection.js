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
    const boundaryCoherence = scoreBoundaryCoherence(clip, transcriptSegments)
    const quoteGrounded = isQuoteGrounded(clip, transcriptSegments)

    const score = round(
      matchedGood.overlap * 35 +
      boundaryScore * 15 +
      boundaryCoherence.score * 20 +
      (quoteGrounded ? 15 : 0) +
      (1 - matchedBad.overlap) * 15 +
      (1 - duplicateRatio) * 5
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
      boundaryCoherence: round(boundaryCoherence.score),
      startsCleanly: boundaryCoherence.startsCleanly,
      endsCleanly: boundaryCoherence.endsCleanly,
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

function scoreBoundaryCoherence(clip, segments) {
  const clipText = getClipText(clip, segments)
  if (!clipText) {
    return {
      score: 0,
      startsCleanly: false,
      endsCleanly: false
    }
  }

  const startsCleanly = !startsLikeContinuation(clipText)
  const endsCleanly = looksLikeCompleteThought(clipText)

  return {
    score: (startsCleanly ? 0.4 : 0) + (endsCleanly ? 0.6 : 0),
    startsCleanly,
    endsCleanly
  }
}

function nearestBoundaryDistance(time, boundaries) {
  return boundaries.reduce((closest, boundary) => Math.min(closest, Math.abs(boundary - time)), Number.POSITIVE_INFINITY)
}

function isQuoteGrounded(clip, segments) {
  if (!clip.keyQuote) return false

  const clipText = getClipText(clip, segments)

  return normalize(clipText).includes(normalize(clip.keyQuote))
}

function getClipText(clip, segments) {
  return segments
    .filter(segment => segment.end > clip.startTime && segment.start < clip.endTime)
    .map(segment => segment.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
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

function startsLikeContinuation(text) {
  return /^(and|but|so|because|then|which|that|it|this|these|those|or|if|when|where|while|who|what|how|than|as|to|for|with|of|in|on|at|from|by|about|into|over|after|before)\b/i.test(String(text || '').trim())
}

function looksLikeCompleteThought(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return false
  if (endsWithDanglingPhrase(trimmed)) return false
  if (/[.!?]["']?\s*$/.test(trimmed)) return true
  return trimmed.split(/\s+/).filter(Boolean).length >= 12
}

function endsWithDanglingPhrase(text) {
  const normalized = stripTerminalPunctuation(String(text || '').trim().toLowerCase())
  if (!normalized) return false

  if (
    /\b(and|but|or|so|because|then|which|that|if|when|while|where|to|for|with|of|in|on|at|from|as|than)\s*$/.test(normalized) ||
    /\b(that'?s|there'?s|it'?s|what'?s|who'?s|where'?s|when'?s|why'?s|how'?s)\s*$/.test(normalized) ||
    /\b(a|an|the|my|your|our|their|his|her|its|this|that|these|those|some|any|each|every|no)\s*$/.test(normalized) ||
    /\b(it'?s like|kind of|sort of|you know|i mean|going to|want to|have to|need to|trying to)\s*$/.test(normalized) ||
    /\b(is|are|was|were|been|being|have|has|had|do|does|did|will|would|could|should|might|must|can)\s*$/.test(normalized) ||
    /\b(very|really|so|quite|pretty|rather|extremely|incredibly|absolutely|totally)\s*$/.test(normalized) ||
    /\b(depending on|based on|because of|in terms of|when it comes to|as a result of|one of|part of|kind of|sort of)\s+(the|a|an|this|that|these|those|my|your|our|their)?\s*\w{0,24}\s*$/.test(normalized)
  ) {
    return true
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  const lastWord = words[words.length - 1] || ''
  return lastWord.length <= 2
}

function stripTerminalPunctuation(text) {
  return text.replace(/[.!?]+["']?\s*$/g, '').trim()
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
      `- ${clip.id}: score=${clip.totalScore}, good=${clip.matchedGoodOverlap}, bad=${clip.matchedBadOverlap}, boundary=${clip.boundaryScore}, coherence=${clip.boundaryCoherence}, start=${clip.startsCleanly ? 'clean' : 'rough'}, end=${clip.endsCleanly ? 'clean' : 'rough'}, duplicate=${clip.duplicateRatio}, quote=${clip.quoteGrounded ? 'yes' : 'no'}`
    )
  }
}

main()
