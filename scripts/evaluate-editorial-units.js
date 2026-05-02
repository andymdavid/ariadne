#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

function main() {
  const fixturePath = process.argv[2]
  if (!fixturePath) {
    console.error('Usage: node scripts/evaluate-editorial-units.js <fixture.json>')
    process.exit(1)
  }

  const fixture = JSON.parse(fs.readFileSync(path.resolve(fixturePath), 'utf8'))
  const segments = Array.isArray(fixture.transcriptSegments) ? fixture.transcriptSegments : []
  const units = buildEditorialUnits(segments)
  const arcs = generateCandidateArcs(units)
  const failures = []

  const thereforeEnding = units.find((unit) => /\btherefore\s*$/i.test(unit.text))
  if (thereforeEnding) {
    failures.push(`Unit ${thereforeEnding.id} ends on forward-pointing marker: "${thereforeEnding.text}"`)
  }

  const repairAside = units.find((unit) => /^i\s*m\s+sorry\b|^sorry\b/i.test(normalize(unit.text)))
  if (!repairAside) {
    failures.push('No repair-aside unit found for "I\'m sorry..." window')
  } else if (repairAside.role !== 'aside') {
    failures.push(`Repair-aside unit was classified as ${repairAside.role}, expected aside`)
  }

  const ownershipPayoff = units.find((unit) =>
    /you need to be able to own that/i.test(unit.text) ||
    /you still need you need your business to operate/i.test(unit.text)
  )
  if (!ownershipPayoff) {
    failures.push('No ownership/payoff unit found')
  }

  if (arcs.length === 0) {
    failures.push('No candidate arcs generated from editorial units')
  }

  const badBoundaryMatch = arcs
    .slice(0, 5)
    .some((arc) => matchesBadBoundary(arc, fixture.expectedBadRanges || []))
  if (badBoundaryMatch) {
    failures.push('Top candidate arcs still reproduce known bad accepted boundaries')
  }

  console.log(`Fixture: ${fixture.name || path.basename(fixturePath)}`)
  console.log(`Editorial units: ${units.length}`)
  console.log(`Candidate arcs: ${arcs.length}`)
  console.log(`Clean starts: ${units.filter((unit) => unit.startsCleanly).length}`)
  console.log(`Clean ends: ${units.filter((unit) => unit.endsCleanly).length}`)
  console.log('')
  console.log('Preview:')
  for (const unit of units.slice(0, 10)) {
    console.log(`- ${unit.id} ${unit.start.toFixed(2)}-${unit.end.toFixed(2)} ${unit.role} start=${unit.startsCleanly ? 'clean' : unit.leadingIssue} end=${unit.endsCleanly ? 'clean' : unit.trailingIssue}: ${unit.text.slice(0, 140)}`)
  }
  console.log('')
  console.log('Top arcs:')
  for (const arc of arcs.slice(0, 5)) {
    console.log(`- ${arc.id} ${arc.start.toFixed(2)}-${arc.end.toFixed(2)} score=${arc.score.toFixed(3)} units=${arc.unitIds.join(',')}: ${arc.hookText.slice(0, 90)} -> ${arc.payoffText.slice(0, 90)}`)
  }

  if (failures.length > 0) {
    console.log('')
    console.log('Failures:')
    for (const failure of failures) {
      console.log(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log('')
  console.log('Editorial unit checks passed.')
}

function generateCandidateArcs(units) {
  const arcs = []
  for (let startIndex = 0; startIndex < units.length; startIndex += 1) {
    for (let endIndex = startIndex; endIndex < units.length; endIndex += 1) {
      const arcUnits = units.slice(startIndex, endIndex + 1)
      const first = arcUnits[0]
      const last = arcUnits[arcUnits.length - 1]
      const duration = last.end - first.start
      if (duration > 120) break
      if (duration < 25) continue
      if (!first.startsCleanly || first.role === 'aside' || first.role === 'filler') continue
      if (!last.endsCleanly) continue
      if (arcUnits.some((unit) => unit.role === 'aside')) continue
      const score = scoreArc(arcUnits, duration)
      arcs.push({
        id: `arc_${arcs.length + 1}`,
        start: first.start,
        end: last.end,
        duration,
        unitIds: arcUnits.map((unit) => unit.id),
        hookText: first.text,
        payoffText: last.text,
        score
      })
    }
  }
  return arcs.sort((left, right) => right.score - left.score).map((arc, index) => ({ ...arc, id: `arc_${index + 1}` }))
}

function scoreArc(units, duration) {
  const text = units.map((unit) => unit.text).join(' ')
  const first = units[0]
  const last = units[units.length - 1]
  const hasPayoff = units.some((unit) => unit.role === 'payoff')
  const hasEscalation = units.some((unit) => unit.role === 'escalation' || unit.role === 'example')
  const hook = (first.startsCleanly ? 0.35 : 0) + (['hook', 'claim', 'escalation'].includes(first.role) ? 0.3 : 0) + (/\b(why|what|how|should|need|problem|question|control|own)\b/i.test(first.text) ? 0.25 : 0)
  const flow = (units.length >= 2 ? 0.25 : 0) + (units.length >= 3 ? 0.2 : 0) + (hasEscalation ? 0.2 : 0) + (hasPayoff ? 0.25 : 0)
  const payoff = (last.endsCleanly ? 0.3 : 0) + (last.role === 'payoff' ? 0.3 : 0) + (hasPayoff ? 0.2 : 0) + (/\b(need|should|ridiculous|operate|control|own)\b/i.test(last.text) ? 0.1 : 0)
  const density = Math.min(1, Math.max(0, (text.split(/\s+/).length / duration - 1.2) / 1.25))
  const durationFit = duration >= 35 && duration <= 85 ? 1 : duration < 35 ? Math.max(0, (duration - 25) / 10) : Math.max(0, 1 - (duration - 85) / 35)
  return Math.max(0, Math.min(1, hook * 0.22 + flow * 0.28 + payoff * 0.28 + density * 0.1 + durationFit * 0.12))
}

function matchesBadBoundary(arc, ranges) {
  return ranges.some((range) => {
    return Math.abs(arc.start - range.startTime) <= 0.75 && Math.abs(arc.end - range.endTime) <= 0.75
  })
}

function buildEditorialUnits(segments) {
  const words = buildWords(segments)
  const units = []
  let current = []

  for (let index = 0; index < words.length; index += 1) {
    current.push(words[index])
    if (!shouldBreak(current, words[index + 1])) continue

    units.push(buildUnit(units.length, current, words[index + 1]))
    current = []
  }

  if (current.length) {
    units.push(buildUnit(units.length, current, undefined))
  }

  return units
}

function buildWords(segments) {
  const words = []
  for (const segment of segments) {
    const segmentWords = String(segment.text || '').split(/\s+/).filter(Boolean)
    const duration = Math.max(0.01, Number(segment.end) - Number(segment.start))
    const wordDuration = duration / Math.max(1, segmentWords.length)
    segmentWords.forEach((word, index) => {
      words.push({
        word,
        start: Number(segment.start) + wordDuration * index,
        end: Number(segment.start) + wordDuration * (index + 1)
      })
    })
  }
  return words.sort((left, right) => left.start - right.start)
}

function buildUnit(index, words, nextWord) {
  const text = normalizeText(words.map((word) => word.word).join(' '))
  const leadingIssue = getLeadingIssue(text)
  const trailingIssue = getTrailingIssue(text)
  const startsCleanly = !leadingIssue
  const endsCleanly = !trailingIssue && looksComplete(text)
  return {
    id: `unit_${index + 1}`,
    start: words[0].start,
    end: words[words.length - 1].end,
    text,
    role: classifyRole(text, leadingIssue),
    startsCleanly,
    endsCleanly,
    leadingIssue,
    trailingIssue,
    continuesNext: Boolean(trailingIssue || (nextWord && startsLikeContinuation(nextWord.word)))
  }
}

function shouldBreak(words, nextWord) {
  if (!nextWord) return true
  const text = normalizeText(words.map((word) => word.word).join(' '))
  const duration = words[words.length - 1].end - words[0].start
  const gap = Math.max(0, nextWord.start - words[words.length - 1].end)
  const trailingIssue = getTrailingIssue(text)
  const complete = looksComplete(text)
  const nextContinues = startsLikeContinuation(nextWord.word)

  if (trailingIssue) return false
  if (gap >= 1.1 && complete) return true
  if (/[.!?]["']?\s*$/.test(text) && !nextContinues) return true
  if (gap >= 0.45 && complete && !nextContinues) return true
  if ((duration >= 26 || words.length >= 86) && complete && !nextContinues) return true
  if (duration >= 42 || words.length >= 140) return complete
  return false
}

function classifyRole(text, leadingIssue) {
  const normalized = normalize(text)
  if (leadingIssue === 'leading_repair_aside' || /\b(who knows|either way|i\s*m sorry|sorry)\b/.test(normalized)) return 'aside'
  if (/\b(therefore|that s why|that s how|so that s|you need to|we should|we shouldn t|don t need to)\b/.test(normalized)) return 'payoff'
  if (/\b(but|however|instead|the problem|the question|evil|ridiculous)\b/.test(normalized)) return 'escalation'
  if (/\b(for example|for instance|because|if you|when you)\b/.test(normalized)) return 'example'
  if (/\b(why|what|how|should|could|would|do you|can you)\b/.test(normalized)) return 'hook'
  return 'claim'
}

function getLeadingIssue(text) {
  const normalized = normalize(text)
  if (!normalized) return 'empty'
  if (/^(yeah|yep|yes|no|right|okay|ok|well|like|so|um|uh|ah|you know|i mean)\b/.test(normalized)) return null
  if (/^(and|but|so|because|then|which|that|it|this|these|those|or|if|when|where|while|who|what|how|than|as|to|for|with|of|in|on|at|from|by|about|into|over|after|before)\b/.test(normalized)) return 'leading_continuation'
  if (/^(i\s*m\s+sorry|im\s+sorry|sorry)\b/.test(normalized)) return 'leading_repair_aside'
  if (/^(who knows|either way|anyway|for some reason)\b/.test(normalized)) return 'leading_aside'
  return null
}

function getTrailingIssue(text) {
  const normalized = stripTerminal(normalize(text))
  if (!normalized) return 'empty'
  if (/\b(and|but|or|so|because|then|which|that|if|when|while|where|to|for|with|of|in|on|at|from|as|than)\s*$/.test(normalized)) return 'trailing_connector'
  if (/\b(therefore|and so|so then|which means|that means|this means)\s*$/.test(normalized)) return 'trailing_inference_marker'
  if (/\b(that s|there s|it s|what s|who s|where s|when s|why s|how s)\s*$/.test(normalized)) return 'trailing_unresolved_reference'
  if (/\b(a|an|the|my|your|our|their|his|her|its|this|that|these|those|some|any|each|every|no)\s*$/.test(normalized)) return 'trailing_determiner'
  if (/\b(is|are|was|were|been|being|have|has|had|do|does|did|will|would|could|should|might|must|can)\s*$/.test(normalized)) return 'trailing_auxiliary'
  return null
}

function looksComplete(text) {
  if (getTrailingIssue(text)) return false
  if (/[.!?]["']?\s*$/.test(text)) return true
  const normalized = normalize(text)
  return text.split(/\s+/).length >= 18 && /\b(works|matters|helps|changes|solves|defines|controls|owns|operate|operates|need|should|shouldn t|don t need|that s why|that s how|which means|the point is|bottom line|so basically)\b/.test(normalized)
}

function startsLikeContinuation(text) {
  return /^(and|but|so|because|then|which|that|it|this|these|those|or|if|when|where|while|who|what|how|than|as|to|for|with|of|in|on|at|from|by|about|into|over|after|before)\b/i.test(String(text || '').trim())
}

function normalizeText(text) {
  return String(text || '').replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim()
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripTerminal(text) {
  return text.replace(/[.!?]+["']?\s*$/g, '').trim()
}

main()
