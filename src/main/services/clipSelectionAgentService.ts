import type { APIConfig } from '@shared/types'
import type { PipelineWorkerPotentialClip } from '@shared/types/pipelineWorker'
import {
  CLIP_SELECTION_AGENT_PRINCIPLES,
  CLIP_SELECTION_AGENT_SPEC_VERSION,
  CLIP_SELECTION_AGENT_SYSTEM_MESSAGE
} from './clipSelectionAgentSpec'

export interface ClipSelectionTranscriptLine {
  lineIndex: number
  start: number
  end: number
  text: string
}

export interface ClipSelectionAgentResult {
  clips: PipelineWorkerPotentialClip[]
  metadata: {
    executor: 'clip_selection_agent'
    modelAlias: APIConfig['model']
    modelId: string
    specVersion: string
    transcriptLineCount: number
    requestedClipCount: number
    returnedClipCount: number
    usedRetry: boolean
  }
}

export class ClipSelectionAgentError extends Error {
  constructor(
    message: string,
    public readonly details: {
      requestedClipCount: number
      transcriptLineCount: number
      attempts: Array<{
        attempt: number
        rawClipBlockCount: number
        parsedClipCount: number
        rawResponsePreview: string
        errorMessage: string
      }>
    }
  ) {
    super(message)
    this.name = 'ClipSelectionAgentError'
  }
}

type ParsedAgentClip = {
  startLineIndex: number
  endLineIndex: number
  contentType: PipelineWorkerPotentialClip['contentType']
  shareabilityScore: number
  contextNeeded: PipelineWorkerPotentialClip['contextNeeded']
  hook?: string
  reason?: string
}

class ClipSelectionAgentService {
  constructor(private readonly config: APIConfig) {}

  async selectClips(options: {
    transcriptLines: ClipSelectionTranscriptLine[]
    mediaDuration: number
    targetClipCount?: number
  }): Promise<ClipSelectionAgentResult> {
    const transcriptLines = options.transcriptLines
      .filter((line) => line.text.trim().length > 0)
      .sort((left, right) => left.lineIndex - right.lineIndex)

    if (transcriptLines.length === 0) {
      return {
        clips: [],
        metadata: {
          executor: 'clip_selection_agent',
          modelAlias: this.config.model,
          modelId: this.getModelId(this.config.model),
          specVersion: CLIP_SELECTION_AGENT_SPEC_VERSION,
          transcriptLineCount: 0,
          requestedClipCount: options.targetClipCount ?? 8,
          returnedClipCount: 0,
          usedRetry: false
        }
      }
    }

    const targetClipCount = Math.max(3, Math.min(8, options.targetClipCount ?? 8))
    const strategies = [
      {
        prompt: this.buildPrompt(transcriptLines, options.mediaDuration, targetClipCount, false),
        maxTokens: 2600
      },
      {
        prompt: this.buildPrompt(transcriptLines, options.mediaDuration, Math.max(3, targetClipCount - 2), true),
        maxTokens: 1800
      }
    ]

    let lastError: unknown = null
    const attemptSummaries: ClipSelectionAgentError['details']['attempts'] = []

    for (let attempt = 0; attempt < strategies.length; attempt++) {
      const strategy = strategies[attempt]

      try {
        const response = await this.callOpenRouter({
          model: this.getModelId(this.config.model),
          messages: [
            {
              role: 'system',
              content: CLIP_SELECTION_AGENT_SYSTEM_MESSAGE
            },
            {
              role: 'user',
              content: strategy.prompt
            }
          ],
          max_tokens: strategy.maxTokens,
          temperature: 0.2
        })

        const rawClipBlockCount = (response.content.match(/^CLIP\|/gm) || []).length
        const parsed = this.parseSelectionResponse(response.content, transcriptLines)
        if (parsed.length === 0) {
          attemptSummaries.push({
            attempt: attempt + 1,
            rawClipBlockCount,
            parsedClipCount: 0,
            rawResponsePreview: response.content.slice(0, 600),
            errorMessage: 'Clip selection agent returned no usable clips'
          })
          throw new Error('Clip selection agent returned no usable clips')
        }

        return {
          clips: parsed.map((clip, index) => this.toPotentialClip(clip, transcriptLines, index)),
          metadata: {
            executor: 'clip_selection_agent',
            modelAlias: this.config.model,
            modelId: this.getModelId(this.config.model),
            specVersion: CLIP_SELECTION_AGENT_SPEC_VERSION,
            transcriptLineCount: transcriptLines.length,
            requestedClipCount: targetClipCount,
            returnedClipCount: parsed.length,
            usedRetry: attempt > 0
          }
        }
      } catch (error) {
        if (!(error instanceof ClipSelectionAgentError)) {
          attemptSummaries.push({
            attempt: attempt + 1,
            rawClipBlockCount: 0,
            parsedClipCount: 0,
            rawResponsePreview: '',
            errorMessage: error instanceof Error ? error.message : 'Unknown error'
          })
        }
        lastError = error
      }
    }

    throw new ClipSelectionAgentError(
      lastError instanceof Error ? lastError.message : 'Clip selection agent failed',
      {
        requestedClipCount: targetClipCount,
        transcriptLineCount: transcriptLines.length,
        attempts: attemptSummaries
      }
    )
  }

  private buildPrompt(
    transcriptLines: ClipSelectionTranscriptLine[],
    mediaDuration: number,
    targetClipCount: number,
    simplified: boolean
  ) {
    const transcriptBlock = transcriptLines
      .map((line) => `LINE ${line.lineIndex} [${line.start.toFixed(2)}-${line.end.toFixed(2)}] ${line.text}`)
      .join('\n')

    return [
      `TRANSCRIPT_DURATION: ${mediaDuration.toFixed(2)}s`,
      `TARGET_PLATFORM: youtube_shorts`,
      `TARGET_CLIP_COUNT: ${targetClipCount}`,
      'DURATION_GUIDANCE: ideal 35-75s, acceptable 20-95s when needed for coherence',
      '',
      'SELECTION PRINCIPLES:',
      ...CLIP_SELECTION_AGENT_PRINCIPLES.map((principle) => `- ${principle}`),
      '',
      'TRANSCRIPT_LINES:',
      transcriptBlock,
      '',
      'TASK:',
      'Select the strongest clip-worthy spans from the transcript.',
      'Choose exact start and end line indexes.',
      'Prefer coherent endings over exact duration targets.',
      simplified
        ? 'Return 3-6 strong clips only. Be conservative.'
        : 'Return up to the target count, but only if each clip is genuinely strong.',
      '',
      'OUTPUT CONTRACT:',
      'For each clip, return at minimum one CLIP line.',
      'Optional HOOK and WHY lines may follow it, but they are not required.',
      'CLIP|<rank>|start_line=<index>|end_line=<index>|type=<insight|story|advice|hot_take|humor|technical>|score=<1.0-10.0>|context=<low|medium|high>',
      'Optional: HOOK|<short compelling hook or key quote>',
      'Optional: WHY|<one sentence on why this clip works or why the ending is coherent>',
      '',
      'Rules:',
      '- Use only provided line indexes.',
      '- Do not output JSON.',
      '- Do not add commentary before or after the clip blocks.',
      '- Focus on coherent interesting snippets from the transcript.',
      '- Do not force artificial packaging if the transcript itself is already interesting.'
    ].join('\n')
  }

  private parseSelectionResponse(content: string, transcriptLines: ClipSelectionTranscriptLine[]): ParsedAgentClip[] {
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    const parsed: ParsedAgentClip[] = []

    for (let index = 0; index < lines.length; index++) {
      const clipLine = lines[index]
      if (!clipLine.startsWith('CLIP|')) {
        continue
      }

      const hookLine = lines[index + 1]?.startsWith('HOOK|') ? lines[index + 1] : ''
      const whyLine = lines[index + 1]?.startsWith('WHY|')
        ? lines[index + 1]
        : lines[index + 2]?.startsWith('WHY|')
          ? lines[index + 2]
          : ''
      const clip = this.parseClipBlock(clipLine, hookLine, whyLine, transcriptLines)
      if (clip) {
        parsed.push(clip)
      }
    }

    return parsed
      .filter((clip, index, array) =>
        array.findIndex((candidate) =>
          candidate.startLineIndex === clip.startLineIndex &&
          candidate.endLineIndex === clip.endLineIndex
        ) === index
      )
      .sort((left, right) => left.startLineIndex - right.startLineIndex)
  }

  private parseClipBlock(
    clipLine: string,
    hookLine: string,
    whyLine: string,
    transcriptLines: ClipSelectionTranscriptLine[]
  ): ParsedAgentClip | null {
    const startMatch = clipLine.match(/start_line=(\d+)/i)
    const endMatch = clipLine.match(/end_line=(\d+)/i)
    const typeMatch = clipLine.match(/type=([a-z_]+)/i)
    const scoreMatch = clipLine.match(/score=([0-9.]+)/i)
    const contextMatch = clipLine.match(/context=(low|medium|high)/i)

    if (!startMatch || !endMatch) {
      return null
    }

    const startLineIndex = Number(startMatch[1])
    const endLineIndex = Number(endMatch[1])
    if (!Number.isInteger(startLineIndex) || !Number.isInteger(endLineIndex) || endLineIndex < startLineIndex) {
      return null
    }

    const startLine = transcriptLines.find((line) => line.lineIndex === startLineIndex)
    const endLine = transcriptLines.find((line) => line.lineIndex === endLineIndex)
    if (!startLine || !endLine || endLine.end <= startLine.start) {
      return null
    }

    const duration = endLine.end - startLine.start
    if (duration < 20 || duration > 95) {
      return null
    }

    const contentType = this.parseContentType(typeMatch?.[1])
    const contextNeeded = this.parseContextNeeded(contextMatch?.[1])
    const shareabilityScore = Math.max(1, Math.min(10, Number(scoreMatch?.[1] ?? 8.5)))
    const hook = hookLine.replace(/^HOOK\|/i, '').trim() || undefined
    const reason = whyLine.replace(/^WHY\|/i, '').trim() || undefined

    return {
      startLineIndex,
      endLineIndex,
      contentType,
      shareabilityScore,
      contextNeeded,
      hook,
      reason
    }
  }

  private toPotentialClip(
    clip: ParsedAgentClip,
    transcriptLines: ClipSelectionTranscriptLine[],
    index: number
  ): PipelineWorkerPotentialClip {
    const startLine = transcriptLines.find((line) => line.lineIndex === clip.startLineIndex)!
    const endLine = transcriptLines.find((line) => line.lineIndex === clip.endLineIndex)!
    const clipText = transcriptLines
      .filter((line) => line.lineIndex >= clip.startLineIndex && line.lineIndex <= clip.endLineIndex)
      .map((line) => line.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    const fallbackKeyQuote = clipText.slice(0, 180)
    const fallbackReason = this.buildFallbackReason(clipText)

    return {
      id: `agent_${index + 1}`,
      startTime: startLine.start,
      endTime: endLine.end,
      duration: Number((endLine.end - startLine.start).toFixed(3)),
      contentType: clip.contentType,
      shareabilityScore: Number(clip.shareabilityScore.toFixed(1)),
      keyQuote: (clip.hook || fallbackKeyQuote).slice(0, 180),
      reason: clip.reason || fallbackReason,
      contextNeeded: clip.contextNeeded
    }
  }

  private buildFallbackReason(clipText: string) {
    const normalized = clipText.replace(/\s+/g, ' ').trim()
    if (!normalized) {
      return 'Selected as a coherent transcript snippet.'
    }

    const firstSentence = normalized
      .split(/[.!?]+/)
      .map((sentence) => sentence.trim())
      .find(Boolean)

    if (firstSentence && firstSentence.length >= 24) {
      return `Selected as a coherent transcript snippet about ${firstSentence.slice(0, 120)}`
    }

    return 'Selected as a coherent transcript snippet.'
  }

  private parseContentType(raw: string | undefined): PipelineWorkerPotentialClip['contentType'] {
    switch ((raw || '').toLowerCase()) {
      case 'story':
      case 'advice':
      case 'hot_take':
      case 'humor':
      case 'technical':
        return raw!.toLowerCase() as PipelineWorkerPotentialClip['contentType']
      case 'insight':
      default:
        return 'insight'
    }
  }

  private parseContextNeeded(raw: string | undefined): PipelineWorkerPotentialClip['contextNeeded'] {
    switch ((raw || '').toLowerCase()) {
      case 'medium':
      case 'high':
        return raw!.toLowerCase() as PipelineWorkerPotentialClip['contextNeeded']
      case 'low':
      default:
        return 'low'
    }
  }

  private getModelId(model: APIConfig['model']): string {
    switch (model) {
      case 'google-gemini-2.5-flash':
        return 'google/gemini-2.5-flash'
      case 'google-gemini-2.5-pro':
        return 'google/gemini-2.5-pro'
      case 'anthropic-claude-sonnet-4.6':
        return 'anthropic/claude-sonnet-4.6'
      case 'openai-gpt-5.4':
        return 'openai/gpt-5.4'
      case 'google-gemini-2.5-flash-lite':
        return 'google/gemini-2.5-flash-lite'
      case 'deepseek-r1':
      default:
        return 'deepseek/deepseek-r1'
    }
  }

  private async callOpenRouter(payload: any): Promise<{ content: string }> {
    if (!this.config.openRouterKey) {
      throw new Error('OpenRouter API key not configured')
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ariadne.app',
        'X-Title': 'Ariadne'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${await response.text()}`)
    }

    const data = await response.json() as any
    const message = data?.choices?.[0]?.message
    let content = ''

    if (typeof message?.content === 'string') {
      content = message.content
    } else if (Array.isArray(message?.content)) {
      content = message.content
        .map((part: any) => {
          if (typeof part === 'string') return part
          if (typeof part?.text === 'string') return part.text
          if (typeof part?.content === 'string') return part.content
          return ''
        })
        .join('\n')
        .trim()
    }

    if (!content) {
      throw new Error('Empty clip selection agent response')
    }

    return { content }
  }
}

export default ClipSelectionAgentService
