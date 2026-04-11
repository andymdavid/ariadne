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
      const timedChunks = splitCaptionWords(
        timedWords.map((word) => word.word),
        maxWordsPerCue,
        maxTextWidth,
        fontSize,
        fontFamily,
        fontWeight
      )
      let timedWordIndex = 0

      timedChunks.forEach((chunk, chunkIndex) => {
        if (!chunk.length) return
        const timedChunk = timedWords.slice(timedWordIndex, timedWordIndex + chunk.length)
        timedWordIndex += chunk.length
        cues.push({
          id: `${line.id}-cue-${chunkIndex}`,
          lineId: line.id,
          start: timedChunk[0].start,
          end: timedChunk[timedChunk.length - 1].end,
          text: normalizeCaptionText(chunk.join(' ')),
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
