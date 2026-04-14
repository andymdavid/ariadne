export type CaptionCueWord = {
  word: string
  start: number
  end: number
}

export type CaptionCueLine = {
  id: string
  start: number
  end: number
  text: string
  words?: CaptionCueWord[]
}

export type CaptionCue = {
  id: string
  lineId: string
  start: number
  end: number
  text: string
  words: CaptionCueWord[]
}

export type CaptionCueBuildOptions = {
  maxWordsPerCue?: number
  maxTextWidth?: number
  fontSize?: number
  fontFamily?: string
  fontWeight?: number | string
}

const HARD_TIMED_WORD_GAP_SPLIT_SECONDS = 0.45
const PUNCTUATION_TIMED_WORD_GAP_SPLIT_SECONDS = 0.18

const normalizeWordToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '')

export const normalizeCaptionText = (text: string) =>
  text.replace(/\s+([,.!?;:])/g, '$1').trim()

export const estimateCaptionTextWidth = (
  text: string,
  fontSize: number,
  fontWeight = 600
) => {
  const weightFactor = fontWeight >= 700 ? 0.62 : 0.58
  return text.length * fontSize * weightFactor
}

export const splitCaptionWords = (
  words: string[],
  maxWordsPerCue: number,
  maxTextWidth?: number,
  fontSize = 16,
  _fontFamily = 'Inter',
  fontWeight: number | string = 700
) => {
  if (!words.length) return []
  if (!maxTextWidth || maxTextWidth <= 0) {
    const chunks: string[][] = []
    for (let index = 0; index < words.length; index += maxWordsPerCue) {
      chunks.push(words.slice(index, index + maxWordsPerCue))
    }
    return chunks
  }

  const chunks: string[][] = []
  let currentChunk: string[] = []

  words.forEach((rawWord) => {
    const word = rawWord.trim()
    if (!word) return

    const candidateChunk = [...currentChunk, word]
    const candidateText = normalizeCaptionText(candidateChunk.join(' '))
    const fitsWidth =
      estimateCaptionTextWidth(candidateText, fontSize, Number(fontWeight)) <= maxTextWidth

    if (
      currentChunk.length > 0 &&
      (candidateChunk.length > maxWordsPerCue || !fitsWidth)
    ) {
      chunks.push(currentChunk)
      currentChunk = [word]
      return
    }

    currentChunk = candidateChunk
  })

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

const shouldSplitTimedCue = (
  currentChunk: CaptionCueWord[],
  nextWord: CaptionCueWord,
  maxWordsPerCue: number,
  maxTextWidth?: number,
  fontSize = 16,
  fontWeight: number | string = 700
) => {
  if (!currentChunk.length) return false

  const previousWord = currentChunk[currentChunk.length - 1]
  const gap = Math.max(0, nextWord.start - previousWord.end)
  const previousToken = previousWord.word.trim()
  const punctuationBoundary =
    /[.!?]$/.test(previousToken) && gap >= PUNCTUATION_TIMED_WORD_GAP_SPLIT_SECONDS

  if (gap >= HARD_TIMED_WORD_GAP_SPLIT_SECONDS || punctuationBoundary) {
    return true
  }

  const candidateChunk = [...currentChunk, nextWord]
  if (candidateChunk.length > maxWordsPerCue) {
    return true
  }

  if (!maxTextWidth || maxTextWidth <= 0) {
    return false
  }

  const candidateText = normalizeCaptionText(candidateChunk.map((word) => word.word.trim()).join(' '))
  return estimateCaptionTextWidth(candidateText, fontSize, Number(fontWeight)) > maxTextWidth
}

const splitTimedCaptionWords = (
  words: CaptionCueWord[],
  maxWordsPerCue: number,
  maxTextWidth?: number,
  fontSize = 16,
  fontWeight: number | string = 700
) => {
  if (!words.length) return []

  const chunks: CaptionCueWord[][] = []
  let currentChunk: CaptionCueWord[] = []

  words.forEach((rawWord) => {
    const word = {
      ...rawWord,
      word: rawWord.word.trim()
    }

    if (!word.word) return

    if (shouldSplitTimedCue(currentChunk, word, maxWordsPerCue, maxTextWidth, fontSize, fontWeight)) {
      chunks.push(currentChunk)
      currentChunk = [word]
      return
    }

    currentChunk = [...currentChunk, word]
  })

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

export const alignWordsToTranscriptText = (
  text: string,
  sourceWords: CaptionCueWord[] | undefined,
  lineStart: number,
  lineEnd: number
): CaptionCueWord[] | undefined => {
  const targetWords = text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)

  if (targetWords.length === 0) return undefined

  const usableSourceWords = (sourceWords || []).filter(
    (word) =>
      word.word?.trim() &&
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start
  )

  if (usableSourceWords.length === 0) {
    const totalDuration = Math.max(lineEnd - lineStart, 0.01)
    const wordDuration = totalDuration / targetWords.length
    return targetWords.map((word, index) => ({
      word,
      start: lineStart + index * wordDuration,
      end: index === targetWords.length - 1 ? lineEnd : lineStart + (index + 1) * wordDuration
    }))
  }

  const matches = new Array<number>(targetWords.length).fill(-1)
  let sourceIndex = 0

  targetWords.forEach((word, targetIndex) => {
    const normalizedTarget = normalizeWordToken(word)
    while (sourceIndex < usableSourceWords.length) {
      const normalizedSource = normalizeWordToken(usableSourceWords[sourceIndex].word)
      const matched = normalizedTarget.length > 0 && normalizedTarget === normalizedSource
      if (matched) {
        matches[targetIndex] = sourceIndex
        sourceIndex += 1
        return
      }
      sourceIndex += 1
    }
  })

  return targetWords.map((word, targetIndex) => {
    const matchedSourceIndex = matches[targetIndex]
    if (matchedSourceIndex >= 0) {
      const matchedWord = usableSourceWords[matchedSourceIndex]
      return {
        word,
        start: matchedWord.start,
        end: matchedWord.end
      }
    }

    let previousMatchedTarget = targetIndex - 1
    while (previousMatchedTarget >= 0 && matches[previousMatchedTarget] < 0) {
      previousMatchedTarget -= 1
    }

    let nextMatchedTarget = targetIndex + 1
    while (nextMatchedTarget < matches.length && matches[nextMatchedTarget] < 0) {
      nextMatchedTarget += 1
    }

    const gapStart =
      previousMatchedTarget >= 0
        ? usableSourceWords[matches[previousMatchedTarget]].end
        : lineStart
    const gapEnd =
      nextMatchedTarget < matches.length
        ? usableSourceWords[matches[nextMatchedTarget]].start
        : lineEnd

    const unmatchedStart = previousMatchedTarget + 1
    const unmatchedEndExclusive =
      nextMatchedTarget < matches.length ? nextMatchedTarget : targetWords.length
    const unmatchedCount = Math.max(1, unmatchedEndExclusive - unmatchedStart)
    const unmatchedIndex = targetIndex - unmatchedStart
    const sliceDuration = Math.max(gapEnd - gapStart, 0.01)
    const wordDuration = sliceDuration / unmatchedCount
    const start = gapStart + unmatchedIndex * wordDuration
    const end =
      targetIndex === unmatchedEndExclusive - 1
        ? gapEnd
        : Math.min(gapEnd, start + wordDuration)

    return {
      word,
      start,
      end: Math.max(end, start + 0.01)
    }
  })
}

export const buildCaptionCues = (
  lines: CaptionCueLine[],
  options: CaptionCueBuildOptions = {}
): CaptionCue[] => {
  const {
    maxWordsPerCue = 3,
    maxTextWidth,
    fontSize = 16,
    fontFamily = 'Inter',
    fontWeight = 700
  } = options
  const cues: CaptionCue[] = []

  lines.forEach((line) => {
    const timedWords = (line.words || []).filter(
      (word) =>
        word.word?.trim() &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > word.start
    )

    if (timedWords.length > 0) {
      const timedChunks = splitTimedCaptionWords(
        timedWords,
        maxWordsPerCue,
        maxTextWidth,
        fontSize,
        fontWeight
      )

      timedChunks.forEach((timedChunk, chunkIndex) => {
        if (!timedChunk.length) return
        cues.push({
          id: `${line.id}-cue-${chunkIndex}`,
          lineId: line.id,
          start: timedChunk[0].start,
          end: timedChunk[timedChunk.length - 1].end,
          text: normalizeCaptionText(timedChunk.map((word) => word.word).join(' ')),
          words: timedChunk.map((word) => ({
            word: word.word,
            start: word.start,
            end: word.end
          }))
        })
      })
      return
    }

    const fallbackWords = line.text.split(/\s+/).filter(Boolean)
    if (!fallbackWords.length) return

    const totalDuration = Math.max(line.end - line.start, 0.01)
    const fallbackChunks = splitCaptionWords(
      fallbackWords,
      maxWordsPerCue,
      maxTextWidth,
      fontSize,
      fontFamily,
      fontWeight
    )
    const chunkCount = Math.max(fallbackChunks.length, 1)
    const chunkDuration = totalDuration / chunkCount

    fallbackChunks.forEach((chunk, chunkIndex) => {
      const start = line.start + chunkIndex * chunkDuration
      const end =
        chunkIndex === chunkCount - 1
          ? line.end
          : Math.min(line.end, start + chunkDuration)

      cues.push({
        id: `${line.id}-cue-${chunkIndex}`,
        lineId: line.id,
        start,
        end,
        text: normalizeCaptionText(chunk.join(' ')),
        words: chunk.map((word, wordIndex) => {
          const wordDuration = chunkDuration / Math.max(chunk.length, 1)
          const wordStart = start + wordIndex * wordDuration
          const wordEnd =
            chunkIndex === chunkCount - 1 && wordIndex === chunk.length - 1
              ? end
              : Math.min(end, wordStart + wordDuration)

          return {
            word,
            start: wordStart,
            end: wordEnd
          }
        })
      })
    })
  })

  return cues
}
