import type { APIConfig, ClipMetadataAnalysisDraft } from '@shared/types'
import type { CandidateArc } from '../../shared/editorialUnits'
import clipValidationService from './clipValidationService'
import type { ClipCandidate, RankedClipSelection } from './clipSelectionTypes'

export interface TranscriptAnalysis {
  potentialClips: Array<{
    id: string
    startTime: number
    endTime: number
    duration: number
    contentType: 'insight' | 'story' | 'advice' | 'hot_take' | 'humor' | 'technical'
    shareabilityScore: number
    keyQuote: string
    reason: string
    contextNeeded: 'low' | 'medium' | 'high'
  }>
}

export interface ContentPackage {
  titles: string[]
  description: string
  thumbnailTimestamp?: number
}

export interface StructuredConversationLine {
  startSegmentId: number
  endSegmentId: number
  speaker: string | null
  text: string
  boundaryType: 'setup' | 'claim' | 'example' | 'payoff' | 'transition' | 'aside' | 'unknown'
  completeThought: boolean
}

export interface TranscriptBoundaryLine {
  lineIndex: number
  start: number
  end: number
  text: string
}

export interface ClipBoundaryReview {
  clipId: string
  startLineIndex: number
  endLineIndex: number
  reason: string
}

export interface ProposedClip {
  startTime: number
  endTime: number
  duration: number
  contentType: 'insight' | 'story' | 'advice' | 'hot_take' | 'humor' | 'technical'
  shareabilityScore: number
  reason: string
  keyQuote: string
  validated: boolean
  validationErrors: string[]
}

export interface ResolvedClipProposal {
  startSegmentId: number
  endSegmentId: number
  hookSegmentId: number
  payoffSegmentId: number
  contentType: 'insight' | 'story' | 'advice' | 'hot_take' | 'humor' | 'technical'
  shareabilityScore: number
  keyQuote: string
  reason: string
  endResolutionReason: string
  nextSegmentRelation: 'new_topic' | 'same_idea' | 'optional_context' | 'unknown'
}

export interface RankedCandidateArcSelection {
  arcId: string
  shareabilityScore: number
  contentType: 'insight' | 'story' | 'advice' | 'hot_take' | 'humor' | 'technical'
  contextNeeded: 'low' | 'medium' | 'high'
  keyQuote: string
  reason: string
}

export interface RoughCutVariantForJudging {
  variantId: string
  momentId: string
  threadLabel: string
  duration: number
  transcriptText: string
  previousContext: string
  nextContext: string
  deterministicIssues: string[]
}

export interface RoughCutVariantJudgment {
  variantId: string
  isReviewable: boolean
  startStatus: 'clean' | 'abrupt'
  endStatus: 'rounded' | 'unresolved'
  contextStatus: 'sufficient' | 'missing_previous' | 'needs_next'
  threadPreserved: boolean
  tooPadded: boolean
  fatalIssues: string[]
  score: number
  rationale: string
}

export interface WordSpanClipSelection {
  startWordIndex: number
  endWordIndex: number
  hookWordIndex: number
  payoffWordIndex: number
  shareabilityScore: number
  contentType: 'insight' | 'story' | 'advice' | 'hot_take' | 'humor' | 'technical'
  contextNeeded: 'low' | 'medium' | 'high'
  keyQuote: string
  reason: string
}

export interface ThreadDiscoveryLine {
  index: number
  startTime: number | null
  endTime: number | null
  speaker: string | null
  text: string
}

export interface ThreadCandidateSelection {
  id: string
  startLineIndex: number
  endLineIndex: number
  title: string
  reason: string
  selfContained: boolean
  expectedContext: string | null
  expectedPayoff: string | null
  confidence: number
}

export interface ThreadDiscoveryDiagnostics {
  responsePreview: string
  rawCandidateCount: number
  validCandidateCount: number
  invalidCandidateCount: number
  invalidReasons: string[]
}

export interface ThreadSemanticGuide {
  source: 'uploaded_txt' | 'openrouter_audio'
  fileName: string | null
  textPreview: string
  speakerLabels: string[]
}

export interface ThreadDiscoveryResult {
  candidates: ThreadCandidateSelection[]
  diagnostics: ThreadDiscoveryDiagnostics
}

export interface ThreadRepairSelection {
  status: 'repaired' | 'unrecoverable'
  startLineIndex: number | null
  endLineIndex: number | null
  reason: string
}

export interface ThreadRepairFeedback {
  attemptedStartLineIndex: number
  attemptedEndLineIndex: number
  attemptedDurationSeconds: number | null
  issues: string[]
}

export interface ThreadCoherenceReview {
  status: 'accepted' | 'rejected'
  reason: string
  fatalIssues: string[]
  confidence: number
}

export interface TranscriptDataWithWords {
  text: string
  segments: Array<{
    id: number
    start: number
    end: number
    text: string
    words?: Array<{ word: string; start: number; end: number }>
  }>
}

type MetadataSignals = {
  focusSentence: string
  supportingSentence: string
  topicPhrase: string
  themePhrase: string
}

class AIService {
  private config: APIConfig
  
  constructor(config: APIConfig) {
    this.config = config
  }
  
  /**
   * Analyze transcript to identify potential clips
   */
  async analyzeTranscript(
    transcriptData: { text: string; segments: Array<{ id: number; start: number; end: number; text: string }> },
    duration: number,
    precomputedCandidates?: ClipCandidate[],
    onProgress?: (progress: number) => void
  ): Promise<TranscriptAnalysis> {
    onProgress?.(10)
    const candidates = (precomputedCandidates ?? []).slice(0, 36)

    if (candidates.length === 0) {
      return { potentialClips: [] }
    }
    
    const maxRetries = 3
    const strategies = [
      { 
        name: 'standard', 
        prompt: this.buildCandidateRankingPrompt(candidates, duration, 'balanced'),
        systemMessage: 'You are an expert short-form content analyst. Rank only the grounded clip candidates provided. Never invent timestamps or candidate IDs.'
      },
      { 
        name: 'strict-json', 
        prompt: this.buildCandidateRankingPrompt(candidates, duration, 'strict'),
        systemMessage: 'Select the best grounded candidates for short-form video. Respond with valid JSON only.'
      },
      { 
        name: 'minimal', 
        prompt: this.buildCandidateRankingPrompt(candidates, duration, 'minimal'),
        systemMessage: 'Choose the best candidate IDs from the provided grounded clip list. Respond only with JSON.'
      }
    ]
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        onProgress?.(30 + (attempt * 15))
        
        const strategy = strategies[attempt] || strategies[0]
        console.log(`AI Analysis attempt ${attempt + 1}/${maxRetries} using ${strategy.name} strategy`)
        
        const response = await this.callOpenRouter({
          model: this.getModelId(this.config.model),
          messages: [
            {
              role: 'system',
              content: strategy.systemMessage
            },
            {
              role: 'user',
              content: strategy.prompt
            }
          ],
          max_tokens: 4000,
          temperature: attempt === 0 ? 0.3 : 0.1 // Lower temperature on retries
        })
        
        onProgress?.(70 + (attempt * 5))
        
        const analysis = this.parseAnalysisResponse(response.content, candidates)
        
        console.log(`AI Analysis completed on attempt ${attempt + 1}: Found ${analysis.potentialClips.length} clips`)
        console.log('Clips summary:', analysis.potentialClips.map(c => ({ 
          id: c.id, 
          contentType: c.contentType, 
          score: c.shareabilityScore,
          duration: c.duration 
        })))
        
        onProgress?.(100)
        
        return analysis
        
      } catch (error) {
        console.error(`AI Analysis attempt ${attempt + 1} failed:`, error)
        
        // If this was the last attempt, throw the error
        if (attempt === maxRetries - 1) {
          console.error('All AI analysis attempts failed')
          throw new Error(`AI Analysis failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
        
        // Wait before retry (exponential backoff)
        const waitTime = Math.pow(2, attempt) * 1000
        console.log(`Waiting ${waitTime}ms before retry...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
    
    // This should never be reached, but TypeScript needs it
    throw new Error('Unexpected error in AI analysis retry loop')
  }

  async structureTranscriptForEditing(
    transcriptData: TranscriptDataWithWords,
    semanticGuide?: ThreadSemanticGuide | null,
    onProgress?: (progress: number) => void
  ): Promise<StructuredConversationLine[]> {
    onProgress?.(10)

    const segments = transcriptData.segments
      .filter((segment) => segment.text.trim().length > 0)
      .sort((left, right) => left.start - right.start)

    if (segments.length === 0) {
      return []
    }

    const prompt = this.buildConversationStructuringPrompt(segments, semanticGuide)
    const response = await this.callOpenRouter({
      model: this.getModelId(this.config.model),
      messages: [
        {
          role: 'system',
          content: [
            'You are an expert podcast transcript editor.',
            'Structure raw ASR transcript segments into readable conversational lines for clip selection.',
            'Preserve meaning, keep line ranges grounded to provided segment IDs, and do not invent timestamps.',
            'Speaker labels may be inferred only when the turn change is clear; otherwise use null.',
            'Return valid JSON only.'
          ].join(' ')
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 8000,
      temperature: 0.1
    })

    onProgress?.(80)
    const lines = this.parseConversationStructuringResponse(response.content, segments)
    onProgress?.(100)
    return lines
  }

  async transcribeAudioForSemanticGuide(input: {
    fileName: string
    audioBase64: string
    audioFormat: string
    mediaDuration: number
  }): Promise<ThreadSemanticGuide> {
    const response = await this.callOpenRouter({
      model: this.getModelId(this.config.model),
      messages: [
        {
          role: 'system',
          content: [
            'You are a careful podcast transcription assistant.',
            'Transcribe audio for semantic editing only.',
            'Use speaker labels when turns are clear. Do not invent timestamps.',
            'Return one valid JSON object only.'
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `Audio file: ${input.fileName}`,
                `Approximate duration: ${Math.round(input.mediaDuration)} seconds`,
                '',
                'Return JSON with this shape:',
                '{"transcript_text":"plain transcript","speaker_labeled_transcript":"Speaker 1: ...\\nSpeaker 2: ...","speakers":["Speaker 1"],"notes":"brief confidence notes"}',
                '',
                'Focus on readable conversational text and speaker turns. Do not include timestamps.'
              ].join('\n')
            },
            {
              type: 'input_audio',
              input_audio: {
                data: input.audioBase64,
                format: input.audioFormat
              },
              inputAudio: {
                data: input.audioBase64,
                format: input.audioFormat
              }
            }
          ]
        }
      ],
      max_tokens: 10000,
      temperature: 0.05
    })

    const guide = this.parseAudioSemanticGuideResponse(response.content, input.fileName)
    if (guide.textPreview.trim().length === 0) {
      throw new Error('OpenRouter audio transcript guide returned no transcript text')
    }

    return guide
  }

  async proposeResolvedClips(
    transcriptData: TranscriptDataWithWords,
    duration: number,
    onProgress?: (progress: number) => void
  ): Promise<ResolvedClipProposal[]> {
    onProgress?.(10)

    const segments = transcriptData.segments
      .filter((segment) => segment.text.trim().length > 0)
      .sort((left, right) => left.start - right.start)

    if (segments.length === 0) {
      return []
    }

    const prompt = this.buildResolvedClipProposalPrompt(segments, duration)
    const response = await this.callOpenRouter({
      model: this.getModelId(this.config.model),
      messages: [
        {
          role: 'system',
          content: [
            'You are a senior podcast clip editor.',
            'Select only complete standalone clip arcs with a hook, development, and resolved payoff.',
            'Prefer extending a clip over ending mid-idea.',
            'Return valid JSON only.'
          ].join(' ')
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 5000,
      temperature: 0.15
    })

    onProgress?.(80)
    const proposals = this.parseResolvedClipProposalResponse(response.content, segments)
    onProgress?.(100)
    return proposals
  }

  async rankCandidateArcs(
    arcs: CandidateArc[],
    mediaDuration: number,
    targetClipCount: number,
    onProgress?: (progress: number) => void
  ): Promise<RankedCandidateArcSelection[]> {
    onProgress?.(10)

    const rankedArcs = arcs
      .slice()
      .sort((left, right) => right.scores.overall - left.scores.overall)
      .slice(0, 24)

    if (rankedArcs.length === 0) {
      return []
    }

    const prompt = this.buildCandidateArcRankingPrompt(rankedArcs, mediaDuration, targetClipCount)
    const response = await this.callOpenRouter({
      model: this.getModelId(this.config.model),
      messages: [
        {
          role: 'system',
          content: [
            'You are a senior short-form video editor.',
            'Rank only the provided candidate arc IDs.',
            'Do not invent timestamps, clip boundaries, transcript lines, or new arc IDs.',
            'Optimize for hook, standalone context, narrative flow, value, and resolved payoff.',
            'Return valid JSON only.'
          ].join(' ')
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 4500,
      temperature: 0.15
    })

    onProgress?.(75)
    const selections = this.parseCandidateArcRankingResponse(response.content, rankedArcs)
    onProgress?.(100)
    return selections
  }

  async selectWordSpanClips(
    transcriptData: TranscriptDataWithWords,
    duration: number,
    targetClipCount: number,
    onProgress?: (progress: number) => void
  ): Promise<WordSpanClipSelection[]> {
    onProgress?.(10)
    const words = this.buildIndexedTranscriptWords(transcriptData)
    if (words.length === 0) {
      return []
    }

    const prompt = this.buildWordSpanClipSelectionPrompt(words, duration, targetClipCount)
    const response = await this.callOpenRouter({
      model: this.getModelId(this.config.model),
      messages: [
        {
          role: 'system',
          content: [
            'You are a senior short-form podcast editor.',
            'Choose exact transcript word ranges that can be clipped directly.',
            'Never invent words or timestamps. Return valid JSON only.'
          ].join(' ')
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 4500,
      temperature: 0.15
    })

    onProgress?.(80)
    const selections = this.parseWordSpanClipSelectionResponse(response.content, words)
    onProgress?.(100)
    return selections
  }

  async judgeRoughCutVariants(
    variants: RoughCutVariantForJudging[],
    onProgress?: (progress: number) => void
  ): Promise<RoughCutVariantJudgment[]> {
    if (variants.length === 0) {
      return []
    }

    onProgress?.(10)
    const payload = variants.slice(0, 72).map((variant) => ({
      variant_id: variant.variantId,
      moment_id: variant.momentId,
      thread: variant.threadLabel,
      duration: Number(variant.duration.toFixed(1)),
      transcript: variant.transcriptText.slice(0, 1800),
      previous_context: variant.previousContext.slice(-500),
      next_context: variant.nextContext.slice(0, 500),
      deterministic_issues: variant.deterministicIssues
    }))

    const response = await this.callOpenRouter({
      model: this.getModelId(this.config.model),
      messages: [
        {
          role: 'system',
          content: [
            'You are a senior podcast rough-cut editor.',
            'Judge only the prepared transcript variants. Do not invent timestamps.',
            'A clip can be loose, but it cannot be broken.',
            'Return valid JSON only.'
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            'Evaluate each prepared clip variant as a reviewable rough cut.',
            'A reviewable rough cut starts naturally, preserves one conversational thread, has enough context, and ends after the current thought lands.',
            'Do not reject for weak virality, minor filler, or slight padding.',
            'Reject if it needs the previous sentence, needs the next sentence, starts abruptly, or ends unresolved.',
            '',
            'Return JSON with this shape:',
            '{"judgments":[{"variant_id":"string","is_reviewable":true,"start_status":"clean|abrupt","end_status":"rounded|unresolved","context_status":"sufficient|missing_previous|needs_next","thread_preserved":true,"too_padded":false,"fatal_issues":["string"],"score":0-100,"rationale":"string"}]}',
            '',
            JSON.stringify({ variants: payload }, null, 2)
          ].join('\n')
        }
      ],
      max_tokens: 4500,
      temperature: 0.05
    })

    onProgress?.(80)
    const judgments = this.parseRoughCutVariantJudgments(response.content, new Set(payload.map((variant) => variant.variant_id)))
    onProgress?.(100)
    return judgments
  }

  async discoverThreadCandidates(input: {
    chunkId: string
    mediaDuration: number
    minDurationSeconds: number
    maxDurationSeconds: number
    lines: ThreadDiscoveryLine[]
    broadDiscovery?: boolean
    semanticGuide?: ThreadSemanticGuide | null
  }): Promise<ThreadDiscoveryResult> {
    if (input.lines.length === 0) {
      return {
        candidates: [],
        diagnostics: {
          responsePreview: '',
          rawCandidateCount: 0,
          validCandidateCount: 0,
          invalidCandidateCount: 0,
          invalidReasons: ['empty_line_chunk']
        }
      }
    }

    const response = await this.callOpenRouter({
      model: this.getModelId(this.config.model),
      messages: [
        {
          role: 'system',
          content: [
            'You are a senior podcast editor selecting coherent rough cuts from transcript lines.',
            'Find usable bounded excerpts above the quality bar, not broad topic summaries.',
            'A good excerpt may live inside a larger conversation, but its selected line range must have its own understandable opening and landing.',
            'Return line indexes only. Do not invent timestamps.',
            'Return one valid JSON object only, with no Markdown, no code fence, and no explanatory prose.'
          ].join(' ')
        },
        {
          role: 'user',
          content: this.buildThreadDiscoveryPrompt(input)
        }
      ],
      max_tokens: 5000,
      temperature: 0.2
    })

    return this.parseThreadCandidateResponse(response.content, input.lines)
  }

  async repairThreadCandidate(input: {
    candidate: ThreadCandidateSelection
    issues: string[]
    surroundingLines: ThreadDiscoveryLine[]
    minDurationSeconds: number
    maxDurationSeconds: number
    previousRepairFeedback?: ThreadRepairFeedback | null
  }): Promise<ThreadRepairSelection> {
    const response = await this.callOpenRouter({
      model: this.getModelId(this.config.model),
      messages: [
        {
          role: 'system',
          content: [
            'You are a senior podcast editor repairing a rough-cut transcript line range.',
            'Choose a better line range or mark it unrecoverable.',
            'Return line indexes only. Do not invent timestamps.',
            'Return one valid JSON object only, with no Markdown, no code fence, and no explanatory prose.'
          ].join(' ')
        },
        {
          role: 'user',
          content: this.buildThreadRepairPrompt(input)
        }
      ],
      max_tokens: 1800,
      temperature: 0.15
    })

    return this.parseThreadRepairResponse(response.content, input.surroundingLines)
  }

  async reviewThreadCandidateCoherence(input: {
    candidate: ThreadCandidateSelection
    issues: string[]
    selectedLines: ThreadDiscoveryLine[]
    surroundingLines: ThreadDiscoveryLine[]
    minDurationSeconds: number
    maxDurationSeconds: number
  }): Promise<ThreadCoherenceReview> {
    const response = await this.callOpenRouter({
      model: this.getModelId(this.config.model),
      messages: [
        {
          role: 'system',
          content: [
            'You are a senior podcast editor judging whether a rough-cut transcript line range is coherent enough for review.',
            'Accept loose or slightly padded rough cuts. Reject broken cuts that require missing previous context or end before the thought lands.',
            'Return one valid JSON object only, with no Markdown, no code fence, and no explanatory prose.'
          ].join(' ')
        },
        {
          role: 'user',
          content: this.buildThreadCoherenceReviewPrompt(input)
        }
      ],
      max_tokens: 1200,
      temperature: 0.1
    })

    return this.parseThreadCoherenceReviewResponse(response.content)
  }

  /**
   * Propose clip boundaries directly using AI (not limited to pre-computed candidates)
   * This gives the AI freedom to propose arbitrary start/end times based on word-level timing
   */
  async proposeBoundaries(
    transcriptData: TranscriptDataWithWords,
    duration: number,
    onProgress?: (progress: number) => void
  ): Promise<ProposedClip[]> {
    onProgress?.(10)

    const prompt = this.buildBoundaryProposalPrompt(transcriptData, duration)

    const maxRetries = 2
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        onProgress?.(20 + attempt * 20)

        const response = await this.callOpenRouter({
          model: this.getModelId(this.config.model),
          messages: [
            {
              role: 'system',
              content: `You are an expert video editor who identifies the best clip moments from podcast transcripts.

CRITICAL RULES:
1. Clips MUST end on complete thoughts with terminal punctuation (. ! ?)
2. Clips MUST NOT end mid-sentence, on conjunctions (and, but, so, because), or on hanging phrases
3. Start times should begin at sentence starts or natural pause points
4. Prefer clips 35-75 seconds, but allow 30-90 if needed for thought completion
5. Use ONLY timestamps from the provided word-level timing data - do not invent timestamps
6. Return precise timestamps rounded to 2 decimal places
7. Each clip must stand alone without needing context from before or after`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 6000,
          temperature: attempt === 0 ? 0.2 : 0.1
        })

        onProgress?.(70)

        const proposedClips = this.parseBoundaryProposalResponse(response.content, transcriptData)

        console.log(`AI Boundary Proposal attempt ${attempt + 1}: ${proposedClips.length} clips proposed, ${proposedClips.filter(c => c.validated).length} validated`)

        onProgress?.(100)
        return proposedClips

      } catch (error) {
        console.error(`AI Boundary Proposal attempt ${attempt + 1} failed:`, error)
        if (attempt === maxRetries - 1) {
          throw new Error(`AI Boundary Proposal failed after ${maxRetries} attempts`)
        }
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      }
    }

    throw new Error('Unexpected error in boundary proposal')
  }

  async reviewClipBoundaries(
    transcriptLines: TranscriptBoundaryLine[],
    clips: Array<{ id: string; startTime: number; endTime: number; duration: number; keyQuote: string; reason: string }>,
    duration: number
  ): Promise<ClipBoundaryReview[]> {
    if (transcriptLines.length === 0 || clips.length === 0) {
      return []
    }

    const strategies = [
      {
        systemMessage: 'You are an expert podcast clip editor. Choose coherent transcript line boundaries. Return plain text only using the requested REVIEW format.',
        prompt: this.buildClipBoundaryReviewPrompt(transcriptLines, clips, duration, 'plain'),
        maxTokens: 1400
      },
      {
        systemMessage: 'You are an expert podcast clip editor. Choose coherent transcript line boundaries. Return valid JSON only.',
        prompt: this.buildClipBoundaryReviewPrompt(transcriptLines, clips, duration, 'json'),
        maxTokens: 2200
      }
    ]

    let lastError: unknown = null

    for (const strategy of strategies) {
      try {
        const response = await this.callOpenRouter({
          model: this.getModelId(this.config.model),
          messages: [
            {
              role: 'system',
              content: strategy.systemMessage
            },
            {
              role: 'user',
              content: strategy.prompt
            }
          ],
          max_tokens: strategy.maxTokens,
          temperature: 0.2
        })

        const reviews = this.parseClipBoundaryReviewResponse(response.content, transcriptLines, clips)
        if (reviews.length > 0) {
          return reviews
        }

        lastError = new Error('Boundary review returned no usable reviews')
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to generate clip boundary review')
  }

  private buildBoundaryProposalPrompt(
    transcriptData: TranscriptDataWithWords,
    duration: number
  ): string {
    // Build sentence index with timing for AI reference
    const sentenceIndex = this.buildSentenceIndexForPrompt(transcriptData.segments)

    // Build word-level timing reference (condensed format)
    const wordTimingRef = transcriptData.segments
      .filter(seg => seg.words && seg.words.length > 0)
      .flatMap(seg => seg.words!.map(w =>
        `${w.start.toFixed(2)}: ${w.word}`
      ))
      .join('\n')

    const platformLabel = this.getPlatformLabel()

    return `
TRANSCRIPT DURATION: ${Math.round(duration / 60)} minutes (${duration.toFixed(0)} seconds)
TARGET PLATFORM: ${platformLabel}

SENTENCE INDEX (sentences with their ending timestamps):
${sentenceIndex}

WORD-LEVEL TIMING (start_time: word):
${wordTimingRef}

TASK: Propose 8-12 viral clip moments with PRECISE timestamps.

For each clip:
1. START at a sentence beginning or natural pause (avoid starting with "and", "but", "so", etc.)
2. END EXACTLY at a sentence-ending word (must have . ! or ? punctuation)
3. Ensure the clip tells a complete story/thought that stands alone
4. Verify duration is between 30-90 seconds (prefer 35-75s)

OUTPUT FORMAT (JSON only):
{
  "proposed_clips": [
    {
      "start_time": 12.34,
      "end_time": 67.89,
      "content_type": "insight",
      "shareability_score": 8.5,
      "reason": "Strong hook, complete thought, actionable takeaway",
      "key_quote": "The most quotable phrase from this clip"
    }
  ]
}

VALIDATION CHECKLIST (apply to each clip before including):
- [ ] Start time corresponds to a word in the timing reference
- [ ] End time corresponds to a word ending with . ! or ?
- [ ] Duration is 30-90 seconds
- [ ] Clip doesn't start with: and, but, so, because, then, it, this, that
- [ ] Clip ends on a complete thought, not mid-explanation

Return JSON only. No explanations outside the JSON structure.
    `.trim()
  }

  private buildThreadDiscoveryPrompt(input: {
    chunkId: string
    mediaDuration: number
    minDurationSeconds: number
    maxDurationSeconds: number
    lines: ThreadDiscoveryLine[]
    broadDiscovery?: boolean
    semanticGuide?: ThreadSemanticGuide | null
  }) {
    const lineText = input.lines.map((line) => (
      `LINE ${line.index} [${line.startTime?.toFixed(2) ?? 'no-start'}-${line.endTime?.toFixed(2) ?? 'no-end'}]${line.speaker ? ` ${line.speaker}:` : ''} ${line.text}`
    )).join('\n')

    return `
CHUNK_ID: ${input.chunkId}
MEDIA_DURATION: ${input.mediaDuration.toFixed(2)}s
TARGET_DURATION: ${input.minDurationSeconds}-${input.maxDurationSeconds}s
DISCOVERY_MODE: ${input.broadDiscovery ? 'broad_repairable_threads' : 'standard_coherent_threads'}
${input.semanticGuide ? `
UPLOADED_TRANSCRIPT_GUIDE:
Source file: ${input.semanticGuide.fileName ?? 'uploaded transcript'}
Detected speakers: ${input.semanticGuide.speakerLabels.length > 0 ? input.semanticGuide.speakerLabels.join(', ') : 'none detected'}
Use this as semantic/speaker guidance only. Choose line indexes from TRANSCRIPT_LINES, because those are timing-grounded.
${input.semanticGuide.textPreview}
` : ''}

TASK:
Find all usable or repairable coherent rough-cut excerpts in these transcript lines.

A usable rough cut:
- starts where a listener has enough context
- preserves one conversational thread
- ends after the thought lands
- may be loose or padded
- should not be selected just to fill a quota
- may be a bounded sub-arc inside a longer topic

A repairable candidate:
- has a strong conversational thread but may need nearby start/end line adjustment
- should set self_contained to false when it needs boundary repair
- should explain the missing context or payoff in expected_context / expected_payoff

Avoid broad topic windows that begin mid-explanation and end while the same explanation continues.
If a whole topic is too long, select a smaller self-contained excerpt with a local setup and payoff.
Prefer natural pivots, questions, claims, examples, objections, and conclusions as boundaries.
Do not select a range whose first line starts by completing the previous line.
Do not select a range whose final line leaves an obvious sentence or thought unfinished.

Do not return a fixed number. Return every usable or repairable candidate above the bar, or return an empty list only when the chunk has no coherent thread worth repairing.
Choose transcript line indexes only.
${input.broadDiscovery ? 'This is a retry after zero candidates. Lower the topical-interest threshold, but still require a coherent conversational thread that can plausibly be repaired into a rough cut.' : ''}

OUTPUT JSON:
{
  "candidates": [
    {
      "id": "thread_1",
      "start_line_index": 1,
      "end_line_index": 8,
      "title": "Short descriptive title",
      "reason": "Why this is a coherent rough cut",
      "self_contained": true,
      "expected_context": null,
      "expected_payoff": "Where the thought lands",
      "confidence": 0.82
    }
  ]
}

TRANSCRIPT_LINES:
${lineText}

Return one JSON object only. The first character must be "{" and the last character must be "}".
    `.trim()
  }

  private parseAudioSemanticGuideResponse(content: string, fileName: string): ThreadSemanticGuide {
    const jsonString = this.extractJSON(content)
    let transcriptText = content.trim()
    let speakerLabels: string[] = []

    if (jsonString) {
      try {
        const parsed = JSON.parse(jsonString) as {
          transcript_text?: unknown
          transcriptText?: unknown
          speaker_labeled_transcript?: unknown
          speakerLabeledTranscript?: unknown
          speakers?: unknown
        }
        const labeled = typeof parsed.speaker_labeled_transcript === 'string'
          ? parsed.speaker_labeled_transcript
          : typeof parsed.speakerLabeledTranscript === 'string'
            ? parsed.speakerLabeledTranscript
            : ''
        const plain = typeof parsed.transcript_text === 'string'
          ? parsed.transcript_text
          : typeof parsed.transcriptText === 'string'
            ? parsed.transcriptText
            : ''
        transcriptText = (labeled || plain || transcriptText).trim()
        if (Array.isArray(parsed.speakers)) {
          speakerLabels = parsed.speakers
            .map((speaker) => String(speaker ?? '').trim())
            .filter(Boolean)
            .slice(0, 12)
        }
      } catch {
        transcriptText = content.trim()
      }
    }

    if (speakerLabels.length === 0) {
      speakerLabels = Array.from(new Set(
        transcriptText
          .split('\n')
          .map((line) => line.match(/^\s*([^:\n]{1,48})\s*:\s+\S/))
          .filter((match): match is RegExpMatchArray => Boolean(match))
          .map((match) => match[1].trim())
          .filter((label) => !/^\d+$/.test(label))
      )).slice(0, 12)
    }

    return {
      source: 'openrouter_audio',
      fileName,
      textPreview: transcriptText.slice(0, 12000),
      speakerLabels
    }
  }

  private buildConversationStructuringPrompt(
    segments: Array<{ id: number; start: number; end: number; text: string }>,
    semanticGuide?: ThreadSemanticGuide | null
  ) {
    const segmentText = segments.map((segment) => (
      `SEGMENT ${segment.id} [${segment.start.toFixed(2)}-${segment.end.toFixed(2)}]: ${segment.text}`
    )).join('\n')
    const guideText = semanticGuide?.textPreview?.trim()
    const guideSource = semanticGuide?.source ?? 'unknown'
    const guideSpeakers = semanticGuide?.speakerLabels?.length
      ? semanticGuide.speakerLabels.join(', ')
      : 'unknown'

    return `
TASK:
Convert these raw ASR segments into conversational transcript lines for rough-cut selection.

Goals:
- create readable line units that usually correspond to a sentence, speaker turn, claim, example, or payoff
- keep each output line grounded to consecutive input segment IDs
- preserve the original meaning and order
- do not invent timestamps or segment IDs
- infer simple speaker labels only when a turn change is clear; otherwise use null
- prefer shorter usable editing atoms over broad topic blocks
- avoid output lines that start by completing a previous line when you can include the setup
- avoid output lines that end before the sentence or thought lands
${guideText ? `
SEMANTIC_GUIDE:
This guide may have cleaner wording and speaker labels, but it has no trusted timestamps.
Use it only to clarify speaker turns and sentence boundaries. Ground every output line to RAW_SEGMENTS.
Source: ${guideSource}
Speakers: ${guideSpeakers}

${guideText}
` : ''}

OUTPUT JSON:
{
  "lines": [
    {
      "start_segment_id": 0,
      "end_segment_id": 2,
      "speaker": "Speaker 1",
      "text": "Clean readable transcript text for this conversational line.",
      "boundary_type": "claim",
      "complete_thought": true
    }
  ]
}

Allowed boundary_type values: setup, claim, example, payoff, transition, aside, unknown.

RAW_SEGMENTS:
${segmentText}

Return one JSON object only. The first character must be "{" and the last character must be "}".
    `.trim()
  }

  private buildThreadRepairPrompt(input: {
    candidate: ThreadCandidateSelection
    issues: string[]
    surroundingLines: ThreadDiscoveryLine[]
    minDurationSeconds: number
    maxDurationSeconds: number
    previousRepairFeedback?: ThreadRepairFeedback | null
  }) {
    const lineText = input.surroundingLines.map((line) => (
      `LINE ${line.index} [${line.startTime?.toFixed(2) ?? 'no-start'}-${line.endTime?.toFixed(2) ?? 'no-end'}]${line.speaker ? ` ${line.speaker}:` : ''} ${line.text}`
    )).join('\n')

    return `
CURRENT_CANDIDATE:
${JSON.stringify(input.candidate, null, 2)}

ISSUES:
${input.issues.join(', ')}

TARGET_DURATION: ${input.minDurationSeconds}-${input.maxDurationSeconds}s
${input.previousRepairFeedback ? `
PREVIOUS_REPAIR_FAILED:
${JSON.stringify(input.previousRepairFeedback, null, 2)}
Use this feedback. If the previous repair was too long, choose a shorter coherent excerpt inside or near that parent thread. If it still needed previous context, move the start earlier. If it still ended unresolved, move the end later without exceeding max duration.
` : ''}

TASK:
Repair this rough cut by choosing a better start_line_index and end_line_index from the surrounding lines.
If the candidate is embedded in a larger thread, first identify the parent conversational thread, then choose the strongest self-contained excerpt inside or near it.
Do not return a broad parent range just because it contains context.
If the parent thread is too long, select a narrower excerpt with its own local setup and payoff rather than returning an overlong range.
If it cannot be repaired within duration limits, mark it unrecoverable.

OUTPUT JSON:
{
  "status": "repaired",
  "start_line_index": 1,
  "end_line_index": 8,
  "reason": "Expanded to include the question and final payoff."
}

For unrecoverable:
{
  "status": "unrecoverable",
  "start_line_index": null,
  "end_line_index": null,
  "reason": "The complete thread exceeds the duration cap."
}

SURROUNDING_LINES:
${lineText}

Return one JSON object only. The first character must be "{" and the last character must be "}".
    `.trim()
  }

  private buildThreadCoherenceReviewPrompt(input: {
    candidate: ThreadCandidateSelection
    issues: string[]
    selectedLines: ThreadDiscoveryLine[]
    surroundingLines: ThreadDiscoveryLine[]
    minDurationSeconds: number
    maxDurationSeconds: number
  }) {
    const selectedLineText = input.selectedLines.map((line) => (
      `LINE ${line.index} [${line.startTime?.toFixed(2) ?? 'no-start'}-${line.endTime?.toFixed(2) ?? 'no-end'}]${line.speaker ? ` ${line.speaker}:` : ''} ${line.text}`
    )).join('\n')
    const surroundingLineText = input.surroundingLines.map((line) => (
      `LINE ${line.index} [${line.startTime?.toFixed(2) ?? 'no-start'}-${line.endTime?.toFixed(2) ?? 'no-end'}]${line.speaker ? ` ${line.speaker}:` : ''} ${line.text}`
    )).join('\n')

    return `
CURRENT_CANDIDATE:
${JSON.stringify(input.candidate, null, 2)}

MECHANICAL_WARNINGS:
${input.issues.join(', ')}

TARGET_DURATION: ${input.minDurationSeconds}-${input.maxDurationSeconds}s

TASK:
Judge whether SELECTED_LINES are coherent enough to show as a rough cut.
The warnings are heuristics, not a final decision.

Accept when:
- the selected lines include enough context for a listener
- one conversational thread is preserved
- the ending lands well enough for a rough cut
- filler, padding, or imperfect pacing is acceptable

Reject when:
- the opening depends on a previous sentence or prompt not included
- the ending clearly needs the next line to make sense
- the range is only the middle of a larger thought

OUTPUT JSON:
{
  "status": "accepted",
  "reason": "Why this is coherent enough or why it is broken.",
  "fatal_issues": [],
  "confidence": 0.82
}

SELECTED_LINES:
${selectedLineText}

SURROUNDING_CONTEXT:
${surroundingLineText}

Return one JSON object only. The first character must be "{" and the last character must be "}".
    `.trim()
  }

  private parseThreadCandidateResponse(content: string, lines: ThreadDiscoveryLine[]): ThreadDiscoveryResult {
    const jsonString = this.extractJSON(content)
    if (!jsonString) {
      throw new Error(`No JSON found in thread discovery response. Preview: ${this.previewResponse(content)}`)
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonString)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
      throw new Error(`Invalid JSON in thread discovery response: ${message}. Preview: ${this.previewResponse(content)}`)
    }
    const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : []
    const validLineIndexes = new Set(lines.map((line) => line.index))
    const invalidReasons: string[] = []

    const candidates = rawCandidates
      .map((candidate: any, index: number): ThreadCandidateSelection | null => {
        const rawStartLineIndex = candidate.start_line_index ?? candidate.startLineIndex
        const rawEndLineIndex = candidate.end_line_index ?? candidate.endLineIndex
        const startLineIndex = Number(rawStartLineIndex)
        const endLineIndex = Number(rawEndLineIndex)
        if (!validLineIndexes.has(startLineIndex) || !validLineIndexes.has(endLineIndex) || endLineIndex < startLineIndex) {
          invalidReasons.push(`candidate_${index + 1}_invalid_line_range:${String(rawStartLineIndex)}-${String(rawEndLineIndex)}`)
          return null
        }

        return {
          id: String(candidate.id || `thread_${index + 1}`),
          startLineIndex,
          endLineIndex,
          title: String(candidate.title || 'Conversational thread').trim(),
          reason: String(candidate.reason || '').trim(),
          selfContained: Boolean(candidate.self_contained),
          expectedContext: candidate.expected_context == null ? null : String(candidate.expected_context).trim(),
          expectedPayoff: candidate.expected_payoff == null ? null : String(candidate.expected_payoff).trim(),
          confidence: Math.max(0, Math.min(1, Number(candidate.confidence ?? 0.5)))
        }
      })
      .filter((candidate: ThreadCandidateSelection | null): candidate is ThreadCandidateSelection => Boolean(candidate))

    return {
      candidates,
      diagnostics: {
        responsePreview: this.previewResponse(content),
        rawCandidateCount: rawCandidates.length,
        validCandidateCount: candidates.length,
        invalidCandidateCount: rawCandidates.length - candidates.length,
        invalidReasons
      }
    }
  }

  private parseConversationStructuringResponse(
    content: string,
    segments: Array<{ id: number; start: number; end: number; text: string }>
  ): StructuredConversationLine[] {
    const jsonString = this.extractJSON(content)
    if (!jsonString) {
      throw new Error(`No JSON found in conversation structuring response. Preview: ${this.previewResponse(content)}`)
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonString)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
      throw new Error(`Invalid JSON in conversation structuring response: ${message}. Preview: ${this.previewResponse(content)}`)
    }

    const validSegmentIds = new Set(segments.map((segment) => Number(segment.id)))
    const allowedBoundaryTypes = new Set(['setup', 'claim', 'example', 'payoff', 'transition', 'aside', 'unknown'])
    const rawLines = Array.isArray(parsed.lines) ? parsed.lines : []

    return rawLines
      .map((line: any): StructuredConversationLine | null => {
        const startSegmentId = Number(line.start_segment_id ?? line.startSegmentId)
        const endSegmentId = Number(line.end_segment_id ?? line.endSegmentId)
        if (
          !Number.isFinite(startSegmentId) ||
          !Number.isFinite(endSegmentId) ||
          !validSegmentIds.has(startSegmentId) ||
          !validSegmentIds.has(endSegmentId) ||
          endSegmentId < startSegmentId
        ) {
          return null
        }

        const boundaryType = String(line.boundary_type ?? line.boundaryType ?? 'unknown')
        return {
          startSegmentId,
          endSegmentId,
          speaker: line.speaker == null || String(line.speaker).trim() === ''
            ? null
            : String(line.speaker).trim(),
          text: String(line.text || '').replace(/\s+/g, ' ').trim(),
          boundaryType: allowedBoundaryTypes.has(boundaryType)
            ? boundaryType as StructuredConversationLine['boundaryType']
            : 'unknown',
          completeThought: Boolean(line.complete_thought ?? line.completeThought)
        }
      })
      .filter((line: StructuredConversationLine | null): line is StructuredConversationLine => Boolean(line && line.text))
  }

  private parseThreadRepairResponse(content: string, lines: ThreadDiscoveryLine[]): ThreadRepairSelection {
    const jsonString = this.extractJSON(content)
    if (!jsonString) {
      const recovered = this.parseThreadRepairTextFallback(content, lines)
      if (recovered) {
        return recovered
      }
      throw new Error(`No JSON found in thread repair response. Preview: ${this.previewResponse(content)}`)
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonString)
    } catch (error) {
      const recovered = this.parseThreadRepairTextFallback(content, lines)
      if (recovered) {
        return recovered
      }
      const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
      throw new Error(`Invalid JSON in thread repair response: ${message}. Preview: ${this.previewResponse(content, 800)}`)
    }
    const status = parsed.status === 'unrecoverable' ? 'unrecoverable' : 'repaired'
    const validLineIndexes = new Set(lines.map((line) => line.index))
    const rawStartLineIndex = parsed.start_line_index ?? parsed.startLineIndex
    const rawEndLineIndex = parsed.end_line_index ?? parsed.endLineIndex
    const startLineIndex = rawStartLineIndex == null ? null : Number(rawStartLineIndex)
    const endLineIndex = rawEndLineIndex == null ? null : Number(rawEndLineIndex)

    if (status === 'unrecoverable') {
      return {
        status,
        startLineIndex: null,
        endLineIndex: null,
        reason: String(parsed.reason || 'Marked unrecoverable by thread repair.').trim()
      }
    }

    if (
      startLineIndex == null ||
      endLineIndex == null ||
      !validLineIndexes.has(startLineIndex) ||
      !validLineIndexes.has(endLineIndex) ||
      endLineIndex < startLineIndex
    ) {
      return {
        status: 'unrecoverable',
        startLineIndex: null,
        endLineIndex: null,
        reason: 'Thread repair returned invalid line indexes.'
      }
    }

    return {
      status: 'repaired',
      startLineIndex,
      endLineIndex,
      reason: String(parsed.reason || 'Repaired line range.').trim()
    }
  }

  private parseThreadCoherenceReviewResponse(content: string): ThreadCoherenceReview {
    const jsonString = this.extractJSON(content)
    if (!jsonString) {
      const recovered = this.parseThreadCoherenceReviewTextFallback(content)
      if (recovered) {
        return recovered
      }
      throw new Error(`No JSON found in thread coherence review response. Preview: ${this.previewResponse(content)}`)
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonString)
    } catch (error) {
      const recovered = this.parseThreadCoherenceReviewTextFallback(content)
      if (recovered) {
        return recovered
      }
      const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
      throw new Error(`Invalid JSON in thread coherence review response: ${message}. Preview: ${this.previewResponse(content)}`)
    }

    return this.normalizeThreadCoherenceReview(parsed)
  }

  private normalizeThreadCoherenceReview(parsed: any): ThreadCoherenceReview {
    const fatalIssues = parsed.fatal_issues ?? parsed.fatalIssues
    return {
      status: parsed.status === 'accepted' ? 'accepted' : 'rejected',
      reason: String(parsed.reason || 'No coherence review rationale provided.').trim(),
      fatalIssues: Array.isArray(fatalIssues)
        ? fatalIssues.map((issue: unknown) => String(issue)).filter(Boolean)
        : [],
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)))
    }
  }

  private parseThreadCoherenceReviewTextFallback(content: string): ThreadCoherenceReview | null {
    const normalized = content
      .replace(/```json/gi, ' ')
      .replace(/```/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!normalized) {
      return null
    }

    const statusMatch = normalized.match(/["']?status["']?\s*[:=]\s*["']?(accepted|rejected)["']?/i)
    if (!statusMatch) {
      return null
    }

    const reasonMatch = normalized.match(/["']?reason["']?\s*[:=]\s*["']([^"']{1,1200})/i)
    const confidenceMatch = normalized.match(/["']?confidence["']?\s*[:=]\s*([01](?:\.\d+)?|\.\d+)/i)
    const fatalIssuesMatch = normalized.match(/["']?fatal[_\s-]*issues["']?\s*[:=]\s*\[([^\]]*)\]/i)
    const fatalIssues = fatalIssuesMatch
      ? fatalIssuesMatch[1]
        .split(',')
        .map((issue) => issue.replace(/["']/g, '').trim())
        .filter(Boolean)
      : []

    return {
      status: statusMatch[1].toLowerCase() === 'accepted' ? 'accepted' : 'rejected',
      reason: reasonMatch?.[1]?.trim() || `Recovered coherence review from partial response: ${this.previewResponse(content)}`,
      fatalIssues,
      confidence: confidenceMatch ? Math.max(0, Math.min(1, Number(confidenceMatch[1]))) : 0.5
    }
  }

  private parseThreadRepairTextFallback(content: string, lines: ThreadDiscoveryLine[]): ThreadRepairSelection | null {
    const normalized = content
      .replace(/```json/gi, ' ')
      .replace(/```/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!normalized) {
      return null
    }

    if (/\bunrecoverable\b|\bnot recoverable\b|\bno viable\b/i.test(normalized)) {
      return {
        status: 'unrecoverable',
        startLineIndex: null,
        endLineIndex: null,
        reason: this.previewResponse(content)
      }
    }

    const validLineIndexes = new Set(lines.map((line) => line.index))
    const startField = normalized.match(/["']?start[_\s-]*line[_\s-]*(?:index)?["']?\s*[:=]\s*["']?(\d+)["']?/i)
    const endField = normalized.match(/["']?end[_\s-]*line[_\s-]*(?:index)?["']?\s*[:=]\s*["']?(\d+)["']?/i)
    if (startField && endField) {
      const startLineIndex = Number(startField[1])
      const endLineIndex = Number(endField[1])
      if (
        Number.isFinite(startLineIndex) &&
        Number.isFinite(endLineIndex) &&
        validLineIndexes.has(startLineIndex) &&
        validLineIndexes.has(endLineIndex) &&
        endLineIndex >= startLineIndex
      ) {
        return {
          status: 'repaired',
          startLineIndex,
          endLineIndex,
          reason: `Recovered repair line range from partial JSON fields: ${this.previewResponse(content)}`
        }
      }
    }

    const patterns = [
      /["']?start[_\s-]*line[_\s-]*(?:index)?["']?\s*[:=]\s*["']?(\d+)["']?[\s,;]+["']?end[_\s-]*line[_\s-]*(?:index)?["']?\s*[:=]\s*["']?(\d+)["']?/i,
      /lines?\s+(\d+)\s*(?:-|to|through|until|\u2013)\s*(\d+)/i,
      /line[_\s-]*range\s*[:=]\s*(\d+)\s*(?:-|to|through|until|\u2013)\s*(\d+)/i
    ]

    for (const pattern of patterns) {
      const match = normalized.match(pattern)
      if (!match) continue
      const startLineIndex = Number(match[1])
      const endLineIndex = Number(match[2])
      if (
        Number.isFinite(startLineIndex) &&
        Number.isFinite(endLineIndex) &&
        validLineIndexes.has(startLineIndex) &&
        validLineIndexes.has(endLineIndex) &&
        endLineIndex >= startLineIndex
      ) {
        return {
          status: 'repaired',
          startLineIndex,
          endLineIndex,
          reason: `Recovered repair line range from non-JSON response: ${this.previewResponse(content)}`
        }
      }
    }

    return null
  }

  private previewResponse(content: string, maxLength = 800): string {
    return content.replace(/\s+/g, ' ').trim().slice(0, maxLength)
  }

  private buildClipBoundaryReviewPrompt(
    transcriptLines: TranscriptBoundaryLine[],
    clips: Array<{ id: string; startTime: number; endTime: number; duration: number; keyQuote: string; reason: string }>,
    duration: number,
    format: 'plain' | 'json'
  ) {
    const findLineSpan = (clip: { startTime: number; endTime: number }) => {
      const startLineIndex = transcriptLines.findIndex((line) => clip.startTime >= line.start && clip.startTime < line.end + 0.01)
      const endLineIndex = [...transcriptLines].reverse().findIndex((line) => clip.endTime > line.start - 0.01 && clip.endTime <= line.end + 0.01)
      const normalizedEndIndex = endLineIndex >= 0 ? transcriptLines.length - 1 - endLineIndex : Math.max(0, transcriptLines.length - 1)
      return {
        startLineIndex: Math.max(0, startLineIndex),
        endLineIndex: Math.max(0, normalizedEndIndex)
      }
    }

    const clipSections = clips.map((clip) => {
      const span = findLineSpan(clip)
      const contextStart = Math.max(0, span.startLineIndex - 1)
      const contextEnd = Math.min(transcriptLines.length - 1, span.endLineIndex + 3)
      const contextLines = transcriptLines
        .slice(contextStart, contextEnd + 1)
        .map((line) => {
          const marker = line.lineIndex >= span.startLineIndex && line.lineIndex <= span.endLineIndex ? '*' : ' '
          return `${marker} LINE ${line.lineIndex} [${line.start.toFixed(2)}-${line.end.toFixed(2)}]: ${line.text}`
        })
        .join('\n')

      return [
        `CLIP_ID: ${clip.id}`,
        `CURRENT_RANGE: lines ${span.startLineIndex}-${span.endLineIndex}`,
        `CURRENT_DURATION: ${clip.duration.toFixed(2)}s`,
        `KEY_QUOTE: ${clip.keyQuote}`,
        `CURRENT_REASON: ${clip.reason}`,
        'CONTEXT_LINES:',
        contextLines
      ].join('\n')
    }).join('\n\n')

    return `
TRANSCRIPT_DURATION: ${duration.toFixed(2)}s

TASK:
For each clip, choose the best START and END line indexes so the clip stands alone and ends coherently.

PRIORITIES:
1. End on a complete thought, even if the transcript has no punctuation.
2. Preserve the theme/hook of the current clip.
3. Start cleanly and do not begin on obvious continuation if avoidable.
4. Prefer 35-75 seconds, but allow roughly 25-120 seconds if needed for coherence.
5. Use ONLY provided line indexes.

OUTPUT FORMAT:
${format === 'plain'
  ? `One line per clip:
REVIEW|clip_id|start_line_index|end_line_index|reason

Example:
REVIEW|fallback_2|2|6|Extends through the completed argument instead of ending on a continuation.`
  : `{
  "boundary_reviews": [
    {
      "clip_id": "fallback_2",
      "start_line_index": 2,
      "end_line_index": 6,
      "reason": "Extends through the completed argument instead of ending on a continuation."
    }
  ]
}`}

CLIPS:
${clipSections}

Return only the requested format. No markdown.
    `.trim()
  }

  private buildSentenceIndexForPrompt(
    segments: Array<{ id: number; start: number; end: number; text: string; words?: Array<{ word: string; start: number; end: number }> }>
  ): string {
    const sentences: Array<{ text: string; endTime: number }> = []

    for (const segment of segments) {
      const text = segment.text.trim()
      // Find sentence endings
      const matches = [...text.matchAll(/[^.!?]*[.!?]["']?/g)]

      for (const match of matches) {
        const sentenceText = match[0].trim()
        if (!sentenceText) continue

        // Calculate end time for this sentence
        let endTime = segment.end
        if (segment.words && segment.words.length > 0) {
          const textUpToMatch = text.slice(0, (match.index ?? 0) + match[0].length)
          const wordCount = textUpToMatch.split(/\s+/).filter(Boolean).length
          const wordIndex = Math.min(wordCount - 1, segment.words.length - 1)
          if (wordIndex >= 0) {
            endTime = segment.words[wordIndex].end
          }
        }

        sentences.push({ text: sentenceText, endTime })
      }
    }

    return sentences
      .map(s => `[${s.endTime.toFixed(2)}s] ${s.text}`)
      .join('\n')
  }

  private parseBoundaryProposalResponse(
    content: string,
    transcriptData: TranscriptDataWithWords
  ): ProposedClip[] {
    const jsonString = this.extractJSON(content)
    if (!jsonString) {
      throw new Error('No JSON found in boundary proposal response')
    }

    const parsed = JSON.parse(jsonString)
    const rawClips = Array.isArray(parsed.proposed_clips) ? parsed.proposed_clips : []

    // Build word lookup for validation
    const allWords = transcriptData.segments
      .flatMap(seg => seg.words ?? [])
      .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end))

    return rawClips
      .map((clip: any) => this.validateProposedClip(clip, allWords, transcriptData))
      .filter((clip: ProposedClip | null): clip is ProposedClip => clip !== null)
  }

  private parseClipBoundaryReviewResponse(
    content: string,
    transcriptLines: TranscriptBoundaryLine[],
    clips: Array<{ id: string }>
  ): ClipBoundaryReview[] {
    const validClipIds = new Set(clips.map((clip) => clip.id))
    const maxLineIndex = transcriptLines.length - 1
    const normalized = content.trim()

    const fromJson = (() => {
      const jsonString = this.extractJSON(normalized)
      if (!jsonString) return [] as ClipBoundaryReview[]

      try {
        const parsed = JSON.parse(jsonString)
        const rawReviews = Array.isArray(parsed.boundary_reviews) ? parsed.boundary_reviews : []
        return rawReviews
          .map((review: any) => this.normalizeClipBoundaryReview(review, validClipIds, maxLineIndex))
          .filter((review: ClipBoundaryReview | null): review is ClipBoundaryReview => Boolean(review))
      } catch {
        return [] as ClipBoundaryReview[]
      }
    })()

    if (fromJson.length > 0) {
      return fromJson
    }

    const fromPlainText = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^REVIEW\|([^|]+)\|(\d+)\|(\d+)\|(.*)$/i)
        if (!match) {
          return null
        }

        return this.normalizeClipBoundaryReview({
          clip_id: match[1],
          start_line_index: Number(match[2]),
          end_line_index: Number(match[3]),
          reason: match[4]
        }, validClipIds, maxLineIndex)
      })
      .filter((review: ClipBoundaryReview | null): review is ClipBoundaryReview => Boolean(review))

    if (fromPlainText.length > 0) {
      return fromPlainText
    }

    console.warn('[AIService] Failed to parse clip boundary review response', {
      preview: normalized.slice(0, 500)
    })
    throw new Error('No usable boundary review found in response')
  }

  private normalizeClipBoundaryReview(
    review: any,
    validClipIds: Set<string>,
    maxLineIndex: number
  ): ClipBoundaryReview | null {
    const clipId = String(review.clip_id ?? '').trim()
    const startLineIndex = Number(review.start_line_index)
    const endLineIndex = Number(review.end_line_index)

    if (!validClipIds.has(clipId)) {
      return null
    }

    if (!Number.isInteger(startLineIndex) || !Number.isInteger(endLineIndex)) {
      return null
    }

    if (startLineIndex < 0 || endLineIndex < startLineIndex || endLineIndex > maxLineIndex) {
      return null
    }

    return {
      clipId,
      startLineIndex,
      endLineIndex,
      reason: String(review.reason ?? 'Adjusted to a more coherent transcript-line boundary').trim()
    }
  }

  private validateProposedClip(
    clip: any,
    allWords: Array<{ word: string; start: number; end: number }>,
    transcriptData: TranscriptDataWithWords
  ): ProposedClip | null {
    const errors: string[] = []

    const startTime = Number(clip.start_time)
    const endTime = Number(clip.end_time)

    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return null
    }

    const duration = endTime - startTime

    // Duration validation
    if (duration < 30) {
      errors.push(`Duration too short: ${duration.toFixed(1)}s`)
    }
    if (duration > 90) {
      errors.push(`Duration too long: ${duration.toFixed(1)}s`)
    }

    // Find nearest words to proposed timestamps
    const startWord = this.findNearestWord(allWords, startTime, 'start')
    const endWord = this.findNearestWord(allWords, endTime, 'end')

    // Validate start alignment
    if (!startWord || Math.abs(startWord.start - startTime) > 1.0) {
      errors.push('Start time does not align with word boundary')
    }

    // Validate end alignment
    if (!endWord || Math.abs(endWord.end - endTime) > 1.0) {
      errors.push('End time does not align with word boundary')
    }

    // Validate ending has terminal punctuation
    if (endWord && !/[.!?]["']?$/.test(endWord.word)) {
      // Check if there's punctuation in the text around this timestamp
      const hasTerminalPunctuation = this.checkTerminalPunctuationNearTimestamp(
        transcriptData,
        endTime
      )
      if (!hasTerminalPunctuation) {
        errors.push(`End word "${endWord.word}" missing terminal punctuation`)
      }
    }

    // Use aligned timestamps if available
    const alignedStart = startWord ? startWord.start : startTime
    const alignedEnd = endWord ? endWord.end : endTime

    return {
      startTime: alignedStart,
      endTime: alignedEnd,
      duration: alignedEnd - alignedStart,
      contentType: this.normalizeContentType(clip.content_type),
      shareabilityScore: Number(clip.shareability_score) || 7.0,
      reason: clip.reason || 'AI-proposed clip boundary',
      keyQuote: clip.key_quote || '',
      validated: errors.length === 0,
      validationErrors: errors
    }
  }

  private findNearestWord(
    words: Array<{ word: string; start: number; end: number }>,
    time: number,
    edge: 'start' | 'end'
  ): { word: string; start: number; end: number } | null {
    let nearest: typeof words[0] | null = null
    let minDistance = Infinity

    for (const word of words) {
      const wordTime = edge === 'start' ? word.start : word.end
      const distance = Math.abs(wordTime - time)

      if (distance < minDistance) {
        minDistance = distance
        nearest = word
      }
    }

    return nearest
  }

  private checkTerminalPunctuationNearTimestamp(
    transcriptData: TranscriptDataWithWords,
    timestamp: number
  ): boolean {
    // Check if any segment near this timestamp ends with terminal punctuation
    for (const segment of transcriptData.segments) {
      if (timestamp >= segment.start - 1 && timestamp <= segment.end + 1) {
        // Check if segment text near this timestamp has punctuation
        if (/[.!?]["']?\s*$/.test(segment.text.trim())) {
          return true
        }
      }
    }
    return false
  }

  private normalizeContentType(
    type: string | undefined
  ): 'insight' | 'story' | 'advice' | 'hot_take' | 'humor' | 'technical' {
    const validTypes = ['insight', 'story', 'advice', 'hot_take', 'humor', 'technical']
    const normalized = (type || 'insight').toLowerCase().replace(/\s+/g, '_')
    return validTypes.includes(normalized) ? normalized as any : 'insight'
  }

  /**
   * Generate content package for a clip
   */
  async extractClipMetadataMeaning(
    clipTranscript: string,
    contentType: string,
    brandVoiceExamples?: string[],
    keyQuote?: string
  ): Promise<ClipMetadataAnalysisDraft> {
    const fallback = this.buildDeterministicMetadataAnalysis(clipTranscript, contentType, keyQuote)

    const strategies = [
      {
        systemMessage:
          'You extract the central meaning from short-form transcript clips. Return valid JSON only.',
        prompt: this.buildMetadataExtractionPrompt(clipTranscript, contentType, brandVoiceExamples, keyQuote)
      },
      {
        systemMessage:
          'Return valid JSON only. Identify the primary topic, core claim, supporting points, audience angle, why it matters, tone, entities, risks, and source excerpt references.',
        prompt: `${this.buildMetadataExtractionPrompt(clipTranscript, contentType, brandVoiceExamples, keyQuote)}\n\nRespond with JSON only. No markdown, no commentary.`
      }
    ]

    for (const strategy of strategies) {
      try {
        const response = await this.callOpenRouter({
          model: this.getModelId(this.config.model),
          messages: [
            { role: 'system', content: strategy.systemMessage },
            { role: 'user', content: strategy.prompt }
          ],
          max_tokens: 700,
          temperature: 0.2
        })

        const parsed = this.parseMetadataAnalysisResponse(response.content)
        return {
          ...fallback,
          ...parsed,
          provider: 'openrouter',
          modelId: this.getModelId(this.config.model),
          rawResponseJson: response.content
        }
      } catch (error) {
        console.error('Metadata meaning extraction attempt failed:', error)
      }
    }

    return fallback
  }

  async generateContentPackage(
    clipTranscript: string,
    contentType: string,
    brandVoiceExamples?: string[],
    onProgress?: (progress: number) => void,
    keyQuote?: string,
    metadataAnalysis?: ClipMetadataAnalysisDraft
  ): Promise<ContentPackage> {
    onProgress?.(10)
    const fallbackPackage = this.buildSimpleFallbackContentPackage(clipTranscript, contentType, keyQuote)

    const strategies = [
      {
        systemMessage:
          'You write YouTube Shorts titles and descriptions. Be concise, accurate, and clear. Do not quote or copy transcript sentences.',
        prompt: this.buildSimpleContentPrompt(clipTranscript, contentType, brandVoiceExamples, keyQuote),
        temperature: 0.4
      },
      {
        systemMessage:
          'Return plain text only in the requested format. Write one strong title, two alternate titles, and one concise description.',
        prompt: this.buildSimpleContentPrompt(clipTranscript, contentType, brandVoiceExamples, keyQuote),
        temperature: 0.2
      }
    ]

    for (let index = 0; index < strategies.length; index += 1) {
      try {
        onProgress?.(30 + index * 20)
        const strategy = strategies[index]
        const response = await this.callOpenRouter({
          model: this.getModelId(this.config.model),
          messages: [
            { role: 'system', content: strategy.systemMessage },
            { role: 'user', content: strategy.prompt }
          ],
          max_tokens: 500,
          temperature: strategy.temperature
        })

        const parsed = this.parseSimpleContentResponse(response.content)
        const titles = this.rankTitleCandidates(
          [...parsed.titles, ...fallbackPackage.titles],
          clipTranscript,
          keyQuote
        ).slice(0, 5)

        const description = this.isUsableDescription(parsed.description)
          ? parsed.description
          : fallbackPackage.description

        onProgress?.(100)
        return {
          titles: titles.length > 0 ? titles : fallbackPackage.titles,
          description,
          thumbnailTimestamp: undefined
        }
      } catch (error) {
        console.error(`Simple content generation attempt ${index + 1}/${strategies.length} failed:`, error)
      }
    }

    onProgress?.(100)
    return fallbackPackage
  }
  
  private buildCandidateRankingPrompt(candidates: ClipCandidate[], duration: number, mode: 'balanced' | 'strict' | 'minimal'): string {
    const candidateText = candidates.map(candidate => `
ID: ${candidate.id}
TIME: ${candidate.startTime.toFixed(1)}-${candidate.endTime.toFixed(1)} (${candidate.duration.toFixed(1)}s)
OPEN: ${candidate.openingLine}
CLOSE: ${candidate.closingLine}
TEXT: ${this.truncateText(candidate.text, 420)}
HEURISTIC_SCORE: ${candidate.heuristicScore.toFixed(2)}
    `.trim()).join('\n\n')

    const extraGuidance = mode === 'balanced'
      ? `Prioritize candidates with a clean hook, one strong idea, low context dependence, and a satisfying ending.`
      : mode === 'strict'
        ? `Only select candidates that feel complete and coherent as standalone short-form clips.`
        : `Choose the best candidate IDs only from this list.`

    const platformLabel = this.getPlatformLabel()

    return `
CONTEXT: These are pre-generated, grounded clip candidates from a ${Math.round(duration / 60)} minute transcript.
PRIMARY PLATFORM: ${platformLabel}

RULES:
- You must choose only from the candidate IDs provided.
- Do not invent timestamps.
- Prefer clips that start cleanly, end cleanly, and stand alone.
- Reject clips that feel like the middle of a longer explanation.
- Favor moments suitable for ${platformLabel}.
- Favor the strongest candidates near the top of the list unless a lower candidate is clearly better.
- ${extraGuidance}

CANDIDATES:
${candidateText}

OUTPUT FORMAT (JSON):
{
  "selected_candidates": [
    {
      "candidate_id": "candidate_1_4",
      "content_type": "insight",
      "shareability_score": 8.7,
      "reason": "Why this candidate works as a standalone clip",
      "key_quote": "Exact quote from the candidate text",
      "context_needed": "low"
    }
  ]
}

Return 8-12 candidates if possible. Respond with JSON only.
    `.trim()
  }

  private buildSimpleContentPrompt(
    clipTranscript: string,
    contentType: string,
    brandVoiceExamples?: string[],
    keyQuote?: string
  ): string {
    const voiceSection = brandVoiceExamples && brandVoiceExamples.length > 0
      ? `\nVOICE EXAMPLES:\n${brandVoiceExamples.join('\n\n')}`
      : ''
    const keyQuoteSection = keyQuote ? `\nKEY QUOTE:\n${keyQuote}` : ''

    return `
You are writing metadata for a ${contentType} YouTube clip.

Read the full transcript and work out:
- what the clip is actually about
- what the speaker's main point is
- why that point matters

Then write:
- 1 best title
- 2 alternate titles
- 1 concise description

Rules:
- do not copy transcript sentences
- do not anchor on metaphors or filler language
- make the title clear and compelling
- keep titles under 55 characters
- keep description under 120 words
- description should summarize the point, not repeat the transcript

Return exactly in this format:
TITLE: <best title>
ALT 1: <alternate title>
ALT 2: <alternate title>
DESCRIPTION: <description>

FULL TRANSCRIPT:
${clipTranscript}${keyQuoteSection}${voiceSection}
    `.trim()
  }
  
  private buildTitlePackagingPrompt(
    contentType: string,
    metadataAnalysis: ClipMetadataAnalysisDraft,
    brandVoiceExamples?: string[]
  ): string {
    const voiceSection = brandVoiceExamples && brandVoiceExamples.length > 0 
      ? `\nBRAND VOICE EXAMPLES:\n${brandVoiceExamples.join('\n\n')}`
      : ''
    const analysisSection = `\nEXTRACTED MEANING:\n${JSON.stringify({
      primary_topic: metadataAnalysis.primaryTopic,
      core_claim: metadataAnalysis.coreClaim,
      supporting_points: metadataAnalysis.supportingPoints,
      audience_angle: metadataAnalysis.audienceAngle,
      why_it_matters: metadataAnalysis.whyItMatters,
      tone: metadataAnalysis.tone,
      key_entities: metadataAnalysis.keyEntities
    }, null, 2)}`
    
    return `
TASK: Generate title candidates for this ${contentType} clip.

${analysisSection}${voiceSection}

REQUIREMENTS:
1. Create 5 title options that are:
   - Accurate to the extracted meaning
   - Written for YouTube Shorts
   - High-curiosity and skimmable
   - Under 55 characters
   - Ideally 3-8 words
   - Not a transcript sentence
   - No full stops at the end
   - No quotation marks
   - Match the creator's authentic voice

2. Prefer titles in patterns like:
   - strong claim
   - contrarian insight
   - surprising takeaway
   - direct framing of the topic

3. Avoid titles that:
   - start mid-thought
   - read like a paragraph
   - depend on missing context
   - include filler phrases
   - anchor on decorative metaphors instead of the core claim

OUTPUT FORMAT (JSON):
{
  "titles": [
    "Direct/Descriptive: exact topic discussed",
    "Question-Based: Why do relevant question?",
    "Statement: key insight or takeaway",
    "Personal: My take on topic",
    "Conversational: Here's what most people get wrong about topic"
  ]
}
    `.trim()
  }

  private buildDescriptionPackagingPrompt(
    contentType: string,
    metadataAnalysis: ClipMetadataAnalysisDraft,
    brandVoiceExamples?: string[]
  ): string {
    const voiceSection = brandVoiceExamples && brandVoiceExamples.length > 0
      ? `\nBRAND VOICE EXAMPLES:\n${brandVoiceExamples.join('\n\n')}`
      : ''

    return `
TASK: Generate one concise YouTube description for this ${contentType} clip.

EXTRACTED MEANING:
${JSON.stringify({
  primary_topic: metadataAnalysis.primaryTopic,
  core_claim: metadataAnalysis.coreClaim,
  supporting_points: metadataAnalysis.supportingPoints,
  audience_angle: metadataAnalysis.audienceAngle,
  why_it_matters: metadataAnalysis.whyItMatters,
  tone: metadataAnalysis.tone,
  key_entities: metadataAnalysis.keyEntities
}, null, 2)}${voiceSection}

REQUIREMENTS:
- 2 short sentences
- under 120 words
- summarize the core claim clearly
- explain why it matters
- do not copy transcript phrasing
- do not mention irrelevant metaphors or setup language
- no marketing fluff

OUTPUT FORMAT (JSON):
{
  "description": "Two concise sentences."
}
    `.trim()
  }

  private buildMetadataExtractionPrompt(
    clipTranscript: string,
    contentType: string,
    brandVoiceExamples?: string[],
    keyQuote?: string
  ): string {
    const voiceSection = brandVoiceExamples && brandVoiceExamples.length > 0
      ? `\nCREATOR VOICE HINTS:\n${brandVoiceExamples.join('\n\n')}`
      : ''
    const keyQuoteSection = keyQuote ? `\nKEY QUOTE:\n${keyQuote}` : ''

    return `
TASK: Extract the core meaning of this ${contentType} clip.

CLIP TRANSCRIPT:
${clipTranscript}${keyQuoteSection}${voiceSection}

RULES:
- Focus on the main idea of the clip, not decorative metaphors or opening filler.
- Identify what the speaker is really arguing.
- Ignore setup language that is not the core point.
- Keep all fields grounded in the transcript.

RETURN JSON ONLY:
{
  "primary_topic": "short phrase",
  "core_claim": "one sentence capturing the central argument",
  "supporting_points": ["point one", "point two"],
  "audience_angle": "who should care about this and why",
  "why_it_matters": "why this point matters in practice",
  "tone": "direct|contrarian|analytical|conversational",
  "key_entities": ["entity one", "entity two"],
  "risk_flags": ["optional risk or ambiguity"],
  "source_excerpt_refs": ["exact short excerpt", "another short excerpt"]
}
    `.trim()
  }

  private async generateMetadataPackaging(
    clipTranscript: string,
    contentType: string,
    metadataAnalysis: ClipMetadataAnalysisDraft,
    brandVoiceExamples?: string[]
  ): Promise<ContentPackage> {
    const titleCandidates = await this.generateMetadataTitles(contentType, metadataAnalysis, brandVoiceExamples)
    const description = await this.generateMetadataDescription(contentType, metadataAnalysis, brandVoiceExamples)

    return {
      titles: this.rankTitleCandidates(titleCandidates, clipTranscript, metadataAnalysis.coreClaim).slice(0, 5),
      description,
      thumbnailTimestamp: undefined
    }
  }

  private async generateMetadataTitles(
    contentType: string,
    metadataAnalysis: ClipMetadataAnalysisDraft,
    brandVoiceExamples?: string[]
  ): Promise<string[]> {
    const strategies = [
      {
        systemMessage: 'You generate short-form video titles. Return valid JSON only.',
        prompt: this.buildTitlePackagingPrompt(contentType, metadataAnalysis, brandVoiceExamples),
        temperature: 0.6
      },
      {
        systemMessage: 'Return valid JSON only with a titles array.',
        prompt: `${this.buildTitlePackagingPrompt(contentType, metadataAnalysis, brandVoiceExamples)}\n\nRespond with JSON only. No markdown, no commentary.`,
        temperature: 0.2
      }
    ]

    for (const strategy of strategies) {
      try {
        const response = await this.callOpenRouter({
          model: this.getModelId(this.config.model),
          messages: [
            { role: 'system', content: strategy.systemMessage },
            { role: 'user', content: strategy.prompt }
          ],
          max_tokens: 500,
          temperature: strategy.temperature
        })

        const packaged = this.parseContentResponse(response.content)
        return this.filterTitlesAgainstAnalysis(packaged.titles, metadataAnalysis)
      } catch (error) {
        console.error('Metadata title packaging attempt failed:', error)
      }
    }

    return []
  }

  private async generateMetadataDescription(
    contentType: string,
    metadataAnalysis: ClipMetadataAnalysisDraft,
    brandVoiceExamples?: string[]
  ): Promise<string> {
    const strategies = [
      {
        systemMessage: 'You generate concise YouTube descriptions. Return valid JSON only.',
        prompt: this.buildDescriptionPackagingPrompt(contentType, metadataAnalysis, brandVoiceExamples),
        temperature: 0.4
      },
      {
        systemMessage: 'Return valid JSON only with a description field.',
        prompt: `${this.buildDescriptionPackagingPrompt(contentType, metadataAnalysis, brandVoiceExamples)}\n\nRespond with JSON only. No markdown, no commentary.`,
        temperature: 0.2
      }
    ]

    for (const strategy of strategies) {
      try {
        const response = await this.callOpenRouter({
          model: this.getModelId(this.config.model),
          messages: [
            { role: 'system', content: strategy.systemMessage },
            { role: 'user', content: strategy.prompt }
          ],
          max_tokens: 300,
          temperature: strategy.temperature
        })

        const description = this.parseDescriptionResponse(response.content)
        if (this.isSemanticallyAlignedDescription(description, metadataAnalysis)) {
          return description
        }
      } catch (error) {
        console.error('Metadata description packaging attempt failed:', error)
      }
    }

    return ''
  }

  private buildCandidateArcRankingPrompt(
    arcs: CandidateArc[],
    mediaDuration: number,
    targetClipCount: number
  ) {
    const arcText = arcs
      .map((arc) => {
        const score = arc.scores
        return [
          `ARC ${arc.id} [${arc.startTime.toFixed(2)}-${arc.endTime.toFixed(2)}] duration=${arc.duration.toFixed(1)}s topic=${arc.topic}`,
          `scores overall=${score.overall} hook=${score.hookStrength} context=${score.contextIndependence} flow=${score.narrativeFlow} payoff=${score.payoffStrength} density=${score.density} boundary=${score.audioBoundaryQuality}`,
          `units=${arc.unitIds.join(',')}`,
          `hook: ${arc.hookText}`,
          `payoff: ${arc.payoffText}`,
          `key_quote: ${arc.keyQuote}`,
          `summary: ${arc.summary}`
        ].join('\n')
      })
      .join('\n\n')

    return `
TRANSCRIPT_DURATION: ${mediaDuration.toFixed(2)}s
TARGET_PLATFORM: youtube_shorts
TARGET_CLIP_COUNT: ${targetClipCount}

TASK:
Choose the best publishable candidate arcs from the list below.

You are not selecting timestamps. The timestamps and boundaries have already been generated.
You may only select ARC IDs that appear in the list.

Evaluate each arc for:
- hook strength in the opening
- standalone context
- one dominant idea
- narrative flow from setup to development to payoff
- value, novelty, disagreement, or practical insight
- whether the payoff feels complete
- whether the clip is too rambling or too context-dependent

Prefer fewer high-confidence clips over padding weak clips.
Avoid near-duplicates unless the framing/payoff is materially different.

OUTPUT JSON ONLY:
{
  "selected_arcs": [
    {
      "arc_id": "arc_1",
      "shareability_score": 8.6,
      "content_type": "insight",
      "context_needed": "low",
      "key_quote": "Exact quote from the arc transcript.",
      "reason": "Why this arc works as a short-form clip."
    }
  ]
}

Allowed content_type values: insight, story, advice, hot_take, humor, technical.
Allowed context_needed values: low, medium, high.

CANDIDATE_ARCS:
${arcText}

Return JSON only. Do not add commentary.
    `.trim()
  }

  private buildIndexedTranscriptWords(transcriptData: TranscriptDataWithWords) {
    return transcriptData.segments
      .flatMap((segment) => segment.words ?? [])
      .map((word, index) => ({
        index,
        word: String(word.word ?? '').replace(/\s+/g, ' ').trim(),
        start: Number(word.start),
        end: Number(word.end)
      }))
      .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
  }

  private buildWordSpanClipSelectionPrompt(
    words: Array<{ index: number; word: string; start: number; end: number }>,
    duration: number,
    targetClipCount: number
  ) {
    const wordRows: string[] = []
    for (let index = 0; index < words.length; index += 40) {
      const chunk = words.slice(index, index + 40)
      wordRows.push(
        `[${chunk[0].index}-${chunk[chunk.length - 1].index}] ` +
        chunk.map((word) => `${word.index}:${word.word}`).join(' ')
      )
    }

    return `
TRANSCRIPT_DURATION: ${duration.toFixed(2)}s
TARGET_PLATFORM: youtube_shorts
TARGET_CLIP_COUNT: ${targetClipCount}

TASK:
Select exact word-index ranges for publishable short-form clips.

You are choosing editable clip spans, not ranking prebuilt blocks. A valid span must:
- start at the first word needed for a clean standalone setup
- include small lead-ins like "and I think" or "you know" when needed
- end after the idea resolves, not before the next necessary clause
- contain one dominant idea with hook, development, and payoff
- be roughly 25-120 seconds after word indexes are mapped to timestamps

Prefer fewer strong clips over weak filler. If there is only one good clip, return one.
Avoid overlapping or near-duplicate spans.
Use ONLY word indexes that appear below.

OUTPUT JSON ONLY:
{
  "word_span_clips": [
    {
      "start_word_index": 120,
      "end_word_index": 310,
      "hook_word_index": 132,
      "payoff_word_index": 298,
      "shareability_score": 8.6,
      "content_type": "insight",
      "context_needed": "low",
      "key_quote": "Exact quote from inside the selected words.",
      "reason": "Why this exact word span works as a standalone clip."
    }
  ]
}

Allowed content_type values: insight, story, advice, hot_take, humor, technical.
Allowed context_needed values: low, medium, high.

INDEXED_WORDS:
${wordRows.join('\n')}

Return JSON only. Do not add commentary.
    `.trim()
  }

  private buildResolvedClipProposalPrompt(
    segments: Array<{ id: number; start: number; end: number; text: string }>,
    duration: number
  ) {
    const segmentText = segments
      .map((segment) => {
        const text = segment.text.replace(/\s+/g, ' ').trim()
        return `SEGMENT ${segment.id} [${segment.start.toFixed(2)}-${segment.end.toFixed(2)}] ${text}`
      })
      .join('\n')

    return `
TRANSCRIPT_DURATION: ${duration.toFixed(2)}s
TARGET_PLATFORM: youtube_shorts

TASK:
Find complete, publishable podcast clip arcs. A valid clip must have:
- a clean setup or hook,
- enough development to make the idea understandable,
- a resolved payoff/end,
- no required continuation in the next segment.

Choose segment IDs, not timestamps. Only use provided segment IDs.

IMPORTANT:
- If the next segment continues the same idea, include it instead of ending early.
- If including continuation would push the clip over 120s or drift into a different topic, omit the clip.
- Prefer 35-90s, but allow 25-120s only when the idea needs that span to resolve.
- Return fewer clips if needed. Quality is more important than count.
- Do not select a clip whose end is just a pause, aside, incomplete example, or setup for the next line.

For each proposal, include:
- start_segment_id: first segment of the standalone setup.
- end_segment_id: last segment where the idea actually resolves.
- hook_segment_id: segment containing the strongest opening/hook.
- payoff_segment_id: segment containing the actual resolution/payoff.
- next_segment_relation: "new_topic", "optional_context", "same_idea", or "unknown".
- end_resolution_reason: explain why the end is complete and why the next segment is not required.

OUTPUT JSON:
{
  "resolved_clips": [
    {
      "start_segment_id": 12,
      "end_segment_id": 20,
      "hook_segment_id": 12,
      "payoff_segment_id": 20,
      "content_type": "insight",
      "shareability_score": 8.7,
      "key_quote": "Short grounded quote from inside the span",
      "reason": "Why this clip works",
      "end_resolution_reason": "Why this endpoint resolves the idea",
      "next_segment_relation": "new_topic"
    }
  ]
}

SEGMENTS:
${segmentText}

Return JSON only.
    `.trim()
  }
  
  private async callOpenRouter(payload: any): Promise<any> {
    if (!this.config.openRouterKey) {
      throw new Error('OpenRouter API key not configured')
    }
    
    console.log('Calling OpenRouter API with model:', payload.model)
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ariadne.app',
        'X-Title': 'Ariadne'
      },
      body: JSON.stringify(payload)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenRouter API error response:', response.status, errorText)
      throw new Error(`OpenRouter API error: ${response.status} ${errorText}`)
    }
    
    const data = await response.json() as any
    
    if (data.error) {
      console.error('OpenRouter API error:', data.error)
      throw new Error(`OpenRouter API error: ${data.error.message}`)
    }
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('Invalid OpenRouter response structure:', data)
      throw new Error('Invalid API response structure')
    }
    
    const message = data.choices[0].message
    let content = ''

    if (typeof message.content === 'string') {
      content = message.content
    } else if (Array.isArray(message.content)) {
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

    if (!content && typeof message.reasoning === 'string') {
      content = message.reasoning.trim()
    }

    if (!content) {
      console.warn('[AIService] OpenRouter returned empty content', {
        model: payload.model,
        finishReason: data.choices?.[0]?.finish_reason,
        hasMessage: Boolean(message),
        messageKeys: message ? Object.keys(message) : [],
        usage: data.usage
      })
    }

    return { content }
  }
  
  private parseAnalysisResponse(content: string, candidates: ClipCandidate[]): TranscriptAnalysis {
    try {
      if (!content || content.trim().length === 0) {
        console.error('Empty response content from AI API')
        throw new Error('Empty response content from AI API')
      }
      
      console.log('Attempting to parse AI response. Content length:', content.length)
      console.log('Content preview:', content.substring(0, 200))
      
      // Strategy 1: Try multiple JSON extraction patterns
      let jsonString = this.extractJSON(content)
      if (!jsonString) {
        console.error('All JSON extraction strategies failed. Full content:', content)
        throw new Error('No JSON found in response')
      }
      
      console.log('Extracted JSON:', jsonString.substring(0, 200) + '...')
      const parsed = JSON.parse(jsonString)
      const selectedCandidates = Array.isArray(parsed.selected_candidates)
        ? parsed.selected_candidates
        : Array.isArray(parsed.potential_clips)
          ? parsed.potential_clips
          : null
      
      if (!selectedCandidates) {
        const recoveredClips = this.extractValidatedCandidateSelectionsFromText(content, candidates)
        if (recoveredClips.length > 0) {
          return { potentialClips: recoveredClips }
        }
        throw new Error('Invalid response format: missing selected_candidates array')
      }

      console.log('⚠️⚠️⚠️ ABOUT TO START DURATION FILTERING ⚠️⚠️⚠️')

      const MIN_CLIP_DURATION = 30 // seconds
      const MAX_CLIP_DURATION = 90 // seconds

      console.log(`\n========== CLIP DURATION FILTERING ==========`)
      console.log(`Total clips from AI: ${selectedCandidates.length}`)
      console.log(`Required duration: ${MIN_CLIP_DURATION}-${MAX_CLIP_DURATION} seconds`)

      const candidateMap = new Map(candidates.map(candidate => [candidate.id, candidate]))

      const resolvedClips = selectedCandidates
        .map((clip: any, index: number) => this.resolveCandidateSelection(clip, index, candidateMap))
        .filter((clip: any): clip is NonNullable<typeof clip> => Boolean(clip))
        .filter((clip: RankedClipSelection) => {
          const isValid = clip.duration >= MIN_CLIP_DURATION && clip.duration <= MAX_CLIP_DURATION
          if (!isValid) {
            if (clip.duration < MIN_CLIP_DURATION) {
              console.log(`❌ REJECTED ${clip.id}: ${clip.duration.toFixed(1)}s (TOO SHORT - minimum is ${MIN_CLIP_DURATION}s)`)
            } else {
              console.log(`❌ REJECTED ${clip.id}: ${clip.duration.toFixed(1)}s (TOO LONG - maximum is ${MAX_CLIP_DURATION}s)`)
            }
          } else {
            console.log(`✅ ACCEPTED ${clip.id}: ${clip.duration.toFixed(1)}s`)
          }
          return isValid
        })

      let filteredClips = clipValidationService.validateAndRank(resolvedClips, candidates)

      if (filteredClips.length < 5) {
        console.warn(`Validation left only ${filteredClips.length} clips. Supplementing from heuristic candidates.`)
        filteredClips = this.supplementFromHeuristics(filteredClips, candidates, 8)
      }

      console.log(`\nFINAL RESULT: ${filteredClips.length} clips passed duration filter`)
      console.log(`==========================================\n`)

      if (filteredClips.length < 5) {
        console.warn(`⚠️ WARNING: Only ${filteredClips.length} clips meet duration requirements. AI should generate clips between 35-75 seconds.`)
      }

      return {
        potentialClips: filteredClips
      }
    } catch (error) {
      const recoveredClips = this.extractValidatedCandidateSelectionsFromText(content, candidates)
      if (recoveredClips.length > 0) {
        console.warn('Recovered AI analysis from non-JSON response using candidate-id extraction.')
        return { potentialClips: recoveredClips }
      }
      console.error('Failed to parse analysis response:', error)
      console.error('Content:', content)
      throw new Error('Failed to parse AI analysis response')
    }
  }
  
  private extractJSON(content: string): string | null {
    console.log('Attempting JSON extraction with multiple strategies...')
    
    // Strategy 1: Look for ```json code blocks
    let match = content.match(/```json\s*([\s\S]*?)\s*```/i)
    if (match) {
      console.log('Strategy 1 SUCCESS: Found JSON in code block')
      return match[1].trim()
    }

    // Strategy 1b: Handle an unclosed fenced JSON response if the object itself is complete.
    match = content.match(/```json\s*([\s\S]*)/i)
    if (match) {
      const balancedObject = this.extractFirstBalancedJSONObject(match[1].trim())
      if (balancedObject) {
        console.log('Strategy 1b SUCCESS: Found JSON in unclosed code block')
        return balancedObject
      }
    }
    
    // Strategy 2: Look for ``` code blocks (without json specifier)
    match = content.match(/```\s*([\s\S]*?)\s*```/)
    if (match) {
      const block = match[1].trim().replace(/^json\s*/i, '').trim()
      if (block.startsWith('{')) {
        const balancedObject = this.extractFirstBalancedJSONObject(block)
        if (balancedObject) {
          console.log('Strategy 2 SUCCESS: Found JSON-like content in code block')
          return balancedObject
        }
      }
    }

    // Strategy 2b: Some models omit fences but prefix the object with a language label.
    const labelStripped = content.trim().replace(/^json\s*/i, '').trim()
    if (labelStripped.startsWith('{')) {
      const balancedObject = this.extractFirstBalancedJSONObject(labelStripped)
      if (balancedObject) {
        console.log('Strategy 2b SUCCESS: Found JSON after language label')
        return balancedObject
      }
    }
    
    // Strategy 3: Look for standalone JSON object (balanced braces)
    const jsonPattern = /(\{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*\})/g
    const matches = [...content.matchAll(jsonPattern)]
    for (const jsonMatch of matches) {
      try {
        const candidate = jsonMatch[1]
        // Quick validation - try to parse
        JSON.parse(candidate)
        console.log('Strategy 3 SUCCESS: Found valid JSON object')
        return candidate
      } catch {
        // Continue to next match
      }
    }
    
    // Strategy 4: Look for potential_clips array specifically
    match = content.match(/"potential_clips"\s*:\s*\[([\s\S]*?)\]/i)
    if (match) {
      const clipsArray = match[0]
      // Try to build a minimal valid object around it
      const minimalJSON = `{"potential_clips": [${match[1]}]}`
      try {
        JSON.parse(minimalJSON)
        console.log('Strategy 4 SUCCESS: Extracted clips array')
        return minimalJSON
      } catch {
        // Fall through
      }
    }
    
    // Strategy 5: Clean and retry original greedy pattern
    const cleaned = content
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control chars
      .replace(/\\n/g, '\n') // Normalize newlines
      .trim()
    
    match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        JSON.parse(match[0])
        console.log('Strategy 5 SUCCESS: Cleaned content parsing')
        return match[0]
      } catch {
        // Fall through
      }
    }
    
    // Strategy 6: Look for any JSON-like structure
    const lines = content.split('\n')
    let jsonStart = -1
    let jsonEnd = -1
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('{') && jsonStart === -1) {
        jsonStart = i
      }
      if (lines[i].trim().endsWith('}') && jsonStart !== -1) {
        jsonEnd = i
        break
      }
    }
    
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const jsonCandidate = lines.slice(jsonStart, jsonEnd + 1).join('\n')
      try {
        JSON.parse(jsonCandidate)
        console.log('Strategy 6 SUCCESS: Line-based extraction')
        return jsonCandidate
      } catch {
        // Final fallback failed
      }
    }
    
    console.log('All JSON extraction strategies failed')
    return null
  }

  private extractFirstBalancedJSONObject(content: string): string | null {
    const start = content.indexOf('{')
    if (start === -1) {
      return null
    }

    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < content.length; index += 1) {
      const character = content[index]
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '"') {
        inString = !inString
        continue
      }
      if (inString) {
        continue
      }
      if (character === '{') {
        depth += 1
      } else if (character === '}') {
        depth -= 1
        if (depth === 0) {
          const candidate = content.slice(start, index + 1)
          try {
            JSON.parse(candidate)
            return candidate
          } catch {
            return null
          }
        }
      }
    }

    return null
  }
  
  private parseContentResponse(content: string): ContentPackage {
    try {
      if (!content || content.trim().length === 0) {
        throw new Error('Empty content response')
      }

      const jsonString = this.extractJSON(content)
      let sanitizedTitles: string[] = []
      let description = ''
      let thumbnailTimestamp: number | undefined

      if (jsonString) {
        const parsed = JSON.parse(jsonString)
        sanitizedTitles = this.sanitizeGeneratedTitles(Array.isArray(parsed.titles) ? parsed.titles : [])
        description =
          typeof parsed.description === 'string' && parsed.description.trim().length > 0
            ? parsed.description.trim()
            : ''
        thumbnailTimestamp = parsed.thumbnail_timestamp
      } else {
        const salvaged = this.salvagePartialContentResponse(content)
        sanitizedTitles = salvaged.titles
        description = salvaged.description
        thumbnailTimestamp = salvaged.thumbnailTimestamp
      }

      if (sanitizedTitles.length === 0) {
        throw new Error('Structured content response did not contain usable titles')
      }

      if (/^(i('|’)ve just finished generating|here are|title options)/i.test(description)) {
        description = ''
      }
      
      return {
        titles: sanitizedTitles,
        description,
        thumbnailTimestamp
      }
    } catch (error) {
      console.error('Failed to parse content response:', error)
      console.error('Content:', content)
      throw new Error('Failed to parse content generation response')
    }
  }

  private parseMetadataAnalysisResponse(content: string): Partial<ClipMetadataAnalysisDraft> {
    if (!content || !content.trim()) {
      throw new Error('Empty metadata analysis response')
    }

    const jsonString = this.extractJSON(content)
    if (jsonString) {
      const parsed = JSON.parse(jsonString)
      const asTrimmedString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
      const asStringArray = (value: unknown) =>
        Array.isArray(value)
          ? value.map((item) => asTrimmedString(item)).filter(Boolean)
          : []

      const primaryTopic = asTrimmedString(parsed.primary_topic)
      const coreClaim = asTrimmedString(parsed.core_claim)

      if (!primaryTopic || !coreClaim) {
        throw new Error('Metadata analysis missing required fields')
      }

      return {
        primaryTopic,
        coreClaim,
        supportingPoints: asStringArray(parsed.supporting_points).slice(0, 4),
        audienceAngle: asTrimmedString(parsed.audience_angle),
        whyItMatters: asTrimmedString(parsed.why_it_matters),
        tone: asTrimmedString(parsed.tone) || 'direct',
        keyEntities: asStringArray(parsed.key_entities).slice(0, 8),
        riskFlags: asStringArray(parsed.risk_flags).slice(0, 6),
        sourceExcerptRefs: asStringArray(parsed.source_excerpt_refs).slice(0, 6)
      }
    }

    const salvaged = this.salvagePartialMetadataAnalysisResponse(content)
    if (!salvaged.primaryTopic || !salvaged.coreClaim) {
      throw new Error('No JSON found in metadata analysis response')
    }

    console.warn('[AIService] Salvaged partial metadata analysis response', {
      primaryTopic: salvaged.primaryTopic,
      hasWhyItMatters: Boolean(salvaged.whyItMatters)
    })

    return salvaged
  }

  private parseDescriptionResponse(content: string): string {
    if (!content || !content.trim()) {
      throw new Error('Empty description response')
    }

    const jsonString = this.extractJSON(content)
    if (jsonString) {
      const parsed = JSON.parse(jsonString)
      const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
      if (description) {
        return description
      }
    }

    const match = content.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)/i)
    if (match?.[1]) {
      return match[1].replace(/\\"/g, '"').replace(/\s+/g, ' ').trim()
    }

    throw new Error('No usable description found in response')
  }

  private parseSimpleContentResponse(content: string): ContentPackage {
    if (!content || !content.trim()) {
      throw new Error('Empty simple content response')
    }

    const normalized = content.replace(/\r/g, '').trim()
    const title = normalized.match(/^TITLE:\s*(.+)$/im)?.[1]?.trim() || ''
    const alt1 = normalized.match(/^ALT 1:\s*(.+)$/im)?.[1]?.trim() || ''
    const alt2 = normalized.match(/^ALT 2:\s*(.+)$/im)?.[1]?.trim() || ''
    const description = normalized.match(/^DESCRIPTION:\s*([\s\S]+)$/im)?.[1]?.replace(/\s+/g, ' ').trim() || ''

    const titles = this.sanitizeGeneratedTitles([title, alt1, alt2])
      .filter((candidate) => !this.looksLikeTranscriptFragment(candidate))

    if (titles.length === 0 && !description) {
      throw new Error('Simple content response missing title and description')
    }

    return {
      titles,
      description: this.looksLikeTranscriptFragment(description) ? '' : description,
      thumbnailTimestamp: undefined
    }
  }

  private extractDescriptionFromText(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim()
    if (!normalized) return 'Generated description'

    const descriptionMatch = normalized.match(/description["']?\s*[:\-]\s*(.+)$/i)
    if (descriptionMatch?.[1]) {
      return descriptionMatch[1].trim()
    }

    return normalized.slice(0, 240)
  }

  private sanitizeGeneratedTitles(titles: unknown[]): string[] {
    return Array.from(
      new Set(
        titles
          .map((title: unknown) => (typeof title === 'string' ? title.trim() : ''))
          .map((title: string) => title.replace(/\s+/g, ' ').replace(/[.]+$/, '').trim())
          .filter(
            (title: string) =>
              title.length > 0 &&
              title.length <= 70 &&
              title.split(' ').length <= 12 &&
              !/^generated title$/i.test(title)
          )
      )
    )
  }

  private salvagePartialMetadataAnalysisResponse(content: string): Partial<ClipMetadataAnalysisDraft> {
    const block = this.extractJSONishBlock(content)
    const primaryTopic = this.extractPossiblyTruncatedStringField(block, 'primary_topic')
    const coreClaim = this.extractPossiblyTruncatedStringField(block, 'core_claim')
    const audienceAngle = this.extractPossiblyTruncatedStringField(block, 'audience_angle')
    const whyItMatters = this.extractPossiblyTruncatedStringField(block, 'why_it_matters')
    const tone = this.extractPossiblyTruncatedStringField(block, 'tone')

    return {
      primaryTopic: primaryTopic ? this.cleanMetadataField(primaryTopic) : '',
      coreClaim: coreClaim ? this.cleanMetadataField(coreClaim) : '',
      supportingPoints: this.extractQuotedArrayValues(block, 'supporting_points').map((value) => this.cleanMetadataField(value)).filter(Boolean).slice(0, 4),
      audienceAngle: audienceAngle ? this.cleanMetadataField(audienceAngle) : '',
      whyItMatters: whyItMatters ? this.cleanMetadataField(whyItMatters) : '',
      tone: tone ? this.cleanMetadataField(tone) : 'direct',
      keyEntities: this.extractQuotedArrayValues(block, 'key_entities').map((value) => this.cleanMetadataField(value)).filter(Boolean).slice(0, 8),
      riskFlags: this.extractQuotedArrayValues(block, 'risk_flags').map((value) => this.cleanMetadataField(value)).filter(Boolean).slice(0, 6),
      sourceExcerptRefs: this.extractQuotedArrayValues(block, 'source_excerpt_refs').map((value) => this.cleanMetadataField(value)).filter(Boolean).slice(0, 6)
    }
  }

  private extractPossiblyTruncatedStringField(content: string, key: string): string {
    const quotedMatch = content.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, 'i'))
    if (quotedMatch?.[1]) {
      return quotedMatch[1].replace(/\\"/g, '"').trim()
    }

    const lineMatch = content.match(new RegExp(`"${key}"\\s*:\\s*([^\\n\\r,}]+)`, 'i'))
    return lineMatch?.[1]?.replace(/^"/, '').trim() || ''
  }

  private cleanMetadataField(value: string): string {
    return value
      .replace(/\s+/g, ' ')
      .replace(/^[^a-zA-Z0-9]+/, '')
      .replace(/[",\]}]+$/, '')
      .trim()
  }

  private filterTitlesAgainstAnalysis(
    titles: string[],
    metadataAnalysis: ClipMetadataAnalysisDraft
  ): string[] {
    return titles.filter((title) => this.isSemanticallyAlignedTitle(title, metadataAnalysis))
  }

  private looksLikeTranscriptFragment(value: string): boolean {
    if (!value) return true
    const lower = value.toLowerCase().trim()
    if (lower.length < 12) return true
    if (/^(and|but|so|because|if|when|while)\b/.test(lower)) return true
    if (/\b(barrels?|forest fire|acorns?|soil)\b/.test(lower)) return true
    if (/\b(it'?s like|to me|i think|we'?re going to|gonna|kind of|sort of)\b/.test(lower)) return true
    return false
  }

  private salvagePartialContentResponse(content: string): ContentPackage {
    const block = this.extractJSONishBlock(content)
    const titleCandidates = this.extractQuotedArrayValues(block, 'titles')
    const sanitizedTitles = this.sanitizeGeneratedTitles(titleCandidates)

    const descriptionMatch = block.match(
      /"description"\s*:\s*"((?:[^"\\]|\\.)*)/i
    )
    const description = descriptionMatch?.[1]
      ? descriptionMatch[1].replace(/\\"/g, '"').replace(/\s+/g, ' ').trim()
      : ''

    if (sanitizedTitles.length === 0) {
      throw new Error('No JSON found in content response')
    }

    console.warn('[AIService] Salvaged partial content response', {
      titleCount: sanitizedTitles.length,
      hasDescription: Boolean(description)
    })

    return {
      titles: sanitizedTitles,
      description,
      thumbnailTimestamp: undefined
    }
  }

  private extractJSONishBlock(content: string): string {
    const fenced =
      content.match(/```json\s*([\s\S]*)$/i)?.[1] ??
      content.match(/```\s*([\s\S]*)$/)?.[1]

    return (fenced ?? content).trim()
  }

  private extractQuotedArrayValues(content: string, key: string): string[] {
    const keyIndex = content.search(new RegExp(`"${key}"\\s*:\\s*\\[`, 'i'))
    if (keyIndex === -1) return []

    const arrayStart = content.indexOf('[', keyIndex)
    if (arrayStart === -1) return []

    const arrayBody = content.slice(arrayStart + 1)
    const values: string[] = []
    const valuePattern = /"((?:[^"\\]|\\.)*)"/g

    for (const match of arrayBody.matchAll(valuePattern)) {
      const fullMatch = match[0]
      const value = match[1]
      values.push(value.replace(/\\"/g, '"'))

      const afterMatchIndex = (match.index ?? 0) + fullMatch.length
      const tail = arrayBody.slice(afterMatchIndex)
      if (/^\s*\]/.test(tail)) {
        break
      }
    }

    return values
  }

  private buildFallbackContentPackage(
    clipTranscript: string,
    contentType: string,
    keyQuote?: string,
    metadataAnalysis?: ClipMetadataAnalysisDraft
  ): ContentPackage {
    const analysis = metadataAnalysis ?? this.buildDeterministicMetadataAnalysis(clipTranscript, contentType, keyQuote)
    const signals = this.buildMetadataSignals(clipTranscript, keyQuote, analysis)
    const titles = this.rankTitleCandidates(
      [
        analysis.coreClaim,
        analysis.primaryTopic ? `Why ${analysis.primaryTopic}` : '',
        analysis.primaryTopic ? `The Real Tradeoff In ${analysis.primaryTopic}` : '',
        signals.focusSentence,
        signals.themePhrase,
        analysis.whyItMatters,
        analysis.primaryTopic && /claude/i.test(clipTranscript) ? `Don't Build Your Business Inside Claude` : '',
        analysis.primaryTopic && /network effects?/i.test(clipTranscript) ? `Network Effects Are Breaking Down` : '',
        analysis.primaryTopic && /econom(?:y|ies) of scale/i.test(clipTranscript) ? `The Lie Of Economies Of Scale` : '',
        analysis.primaryTopic && /controls? your business/i.test(clipTranscript) ? `Who Really Controls Your Business` : ''
      ],
      clipTranscript,
      keyQuote
    ).slice(0, 5)
    const description = this.buildFallbackDescription(
      clipTranscript,
      titles[0] || signals.themePhrase || signals.topicPhrase,
      signals,
      analysis
    )

    return {
      titles: titles.length > 0 ? titles : ['Clip Breakdown'],
      description,
      thumbnailTimestamp: undefined
    }
  }

  private buildSimpleFallbackContentPackage(
    clipTranscript: string,
    contentType: string,
    keyQuote?: string
  ): ContentPackage {
    const lower = clipTranscript.toLowerCase()
    const topic = this.deriveSimpleTopic(clipTranscript, contentType)
    const claim = this.deriveSimpleClaim(clipTranscript, keyQuote)
    const whyItMatters = this.deriveSimpleWhyItMatters(clipTranscript)

    const titleCandidates = this.rankTitleCandidates(
      [
        /claude|anthropic|provider|cloud|local|open source|ai/.test(lower) ? 'Cloud AI Vs. Local Control' : '',
        /business/.test(lower) ? 'Who Controls Your Business?' : '',
        topic ? `The Real Tradeoff In ${topic}` : '',
        topic ? `Why ${topic} Matters` : '',
        claim
      ],
      clipTranscript,
      keyQuote
    ).slice(0, 5)

    const description = `${claim} ${whyItMatters}`
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220)

    return {
      titles: titleCandidates.length > 0 ? titleCandidates : ['Clip Breakdown'],
      description,
      thumbnailTimestamp: undefined
    }
  }

  private finalizeContentPackage(
    aiPackage: ContentPackage,
    fallbackPackage: ContentPackage,
    clipTranscript: string,
    keyQuote?: string,
    metadataAnalysis?: ClipMetadataAnalysisDraft
  ): ContentPackage {
    const titles = this.rankTitleCandidates(
      [...(aiPackage.titles || []), ...(fallbackPackage.titles || [])],
      clipTranscript,
      keyQuote
    )
      .filter((title) => !metadataAnalysis || this.isSemanticallyAlignedTitle(title, metadataAnalysis))
      .slice(0, 5)

    const aiDescription = (aiPackage.description || '').trim()
    const description = this.isUsableDescription(aiDescription)
      && (!metadataAnalysis || this.isSemanticallyAlignedDescription(aiDescription, metadataAnalysis))
      ? aiDescription
      : this.buildFallbackDescription(
          clipTranscript,
          titles[0],
          this.buildMetadataSignals(clipTranscript, keyQuote, metadataAnalysis),
          metadataAnalysis
        )

    return {
      titles: titles.length > 0 ? titles : fallbackPackage.titles,
      description,
      thumbnailTimestamp: aiPackage.thumbnailTimestamp ?? fallbackPackage.thumbnailTimestamp
    }
  }

  private buildDeterministicMetadataAnalysis(
    clipTranscript: string,
    contentType: string,
    keyQuote?: string
  ): ClipMetadataAnalysisDraft {
    const meaning = this.extractDeterministicMeaning(clipTranscript, contentType, keyQuote)
    const signals = this.buildMetadataSignals(clipTranscript, keyQuote, {
      primaryTopic: meaning.primaryTopic,
      coreClaim: meaning.coreClaim,
      supportingPoints: meaning.supportingPoints,
      audienceAngle: meaning.audienceAngle,
      whyItMatters: meaning.whyItMatters,
      tone: meaning.tone,
      keyEntities: meaning.keyEntities,
      riskFlags: meaning.riskFlags,
      sourceExcerptRefs: meaning.sourceExcerptRefs,
      provider: 'deterministic',
      modelId: 'fallback',
      rawResponseJson: null
    })
    const keyEntities = Array.from(
      new Set(
        [
          meaning.primaryTopic,
          ...meaning.keyEntities
        ].filter(Boolean)
      )
    ).slice(0, 8)

    return {
      primaryTopic: meaning.primaryTopic || signals.topicPhrase || this.smartTitleCase(contentType),
      coreClaim: meaning.coreClaim || signals.focusSentence || clipTranscript.replace(/\s+/g, ' ').trim().slice(0, 180),
      supportingPoints: meaning.supportingPoints.length > 0 ? meaning.supportingPoints : [signals.supportingSentence].filter(Boolean),
      audienceAngle: meaning.audienceAngle || this.inferAudienceAngle(clipTranscript, contentType, signals.topicPhrase),
      whyItMatters: meaning.whyItMatters || this.inferWhyItMatters(clipTranscript, signals),
      tone: meaning.tone || this.inferMetadataTone(clipTranscript),
      keyEntities,
      riskFlags: meaning.riskFlags.length > 0 ? meaning.riskFlags : this.inferRiskFlags(clipTranscript),
      sourceExcerptRefs: meaning.sourceExcerptRefs.length > 0 ? meaning.sourceExcerptRefs : [keyQuote || '', signals.focusSentence, signals.supportingSentence].filter(Boolean).slice(0, 4),
      provider: 'deterministic',
      modelId: 'fallback',
      rawResponseJson: null
    }
  }

  private extractDeterministicMeaning(
    clipTranscript: string,
    contentType: string,
    keyQuote?: string
  ): Omit<ClipMetadataAnalysisDraft, 'provider' | 'modelId' | 'rawResponseJson'> {
    const units = clipTranscript
      .split(/\n+/)
      .map((unit) => unit.trim())
      .filter(Boolean)
      .flatMap((unit) =>
        unit
          .split(/(?<=[.!?])\s+|,\s+(?=[A-ZI][a-z]|(but|and|so|because|if|when|while)\b)/)
          .map((part) => part.trim())
          .filter(Boolean)
      )

    const metaphorPattern = /\b(barrels?|forest fire|acorns?|soil)\b/i
    const signalPattern = /\b(ai|business|provider|anthropic|claude|open source|cloud|local|privacy|data|models?|network effects?|econom(?:y|ies) of scale|twitter|web 2\.?0|switching costs?)\b/i
    const claimPattern = /\b(controls?|matters?|means|beats|wins|destroys?|changing|dead|dying|better|problem|tradeoff|risk|convenience|should|shouldn'?t|all in)\b/i

    const scoreUnit = (unit: string) => {
      const lower = unit.toLowerCase()
      const words = unit.split(/\s+/).filter(Boolean)
      let score = 0
      if (words.length >= 6 && words.length <= 24) score += 5
      if (signalPattern.test(lower)) score += 10
      if (claimPattern.test(lower)) score += 8
      if (/^(and|but|so|because)\b/i.test(lower)) score -= 6
      if (/\b(i think|it'?s like|to me|we'?re going to|gonna|kind of|sort of)\b/i.test(lower)) score -= 10
      if (metaphorPattern.test(lower)) score -= 15
      if (keyQuote && lower.includes(keyQuote.toLowerCase())) score += 4
      return score
    }

    const rankedUnits = [...units].sort((a, b) => scoreUnit(b) - scoreUnit(a))
    const bestClaim = rankedUnits.find((unit) => scoreUnit(unit) >= 8) || ''
    const supporting = rankedUnits.filter((unit) => unit !== bestClaim && scoreUnit(unit) >= 6).slice(0, 2)

    const entities = this.extractKeyEntities(clipTranscript)
    const strongEntity = entities.find((entity) => !metaphorPattern.test(entity)) || ''
    const primaryTopic = strongEntity || this.deriveTopicFromClaim(bestClaim, contentType)

    return {
      primaryTopic,
      coreClaim: this.cleanMetadataField(bestClaim || clipTranscript.replace(/\s+/g, ' ').trim().slice(0, 180)),
      supportingPoints: supporting.map((value) => this.cleanMetadataField(value)).filter(Boolean),
      audienceAngle: this.inferAudienceAngle(clipTranscript, contentType, primaryTopic),
      whyItMatters: this.cleanMetadataField(this.inferWhyItMatters(clipTranscript, {
        focusSentence: bestClaim,
        supportingSentence: supporting[0] || '',
        topicPhrase: primaryTopic,
        themePhrase: this.buildThemePhrase(bestClaim, primaryTopic)
      })),
      tone: this.inferMetadataTone(clipTranscript),
      keyEntities: entities.filter((entity) => !metaphorPattern.test(entity)).slice(0, 8),
      riskFlags: this.inferRiskFlags(clipTranscript),
      sourceExcerptRefs: [keyQuote || '', bestClaim, supporting[0] || ''].filter(Boolean).slice(0, 4)
    }
  }

  private deriveTopicFromClaim(claim: string, contentType: string): string {
    const cleaned = claim
      .replace(/\b(i think|it'?s like|to me|we'?re going to|gonna|kind of|sort of)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()

    const explicitMatches = cleaned.match(/\b(AI|Anthropic|Claude|Twitter|Web 2\.?0|network effects?|econom(?:y|ies) of scale|switching costs?|cloud|local models?|open source|provider|business)\b/gi)
    if (explicitMatches?.length) {
      return this.smartTitleCase(explicitMatches[0])
    }

    return this.smartTitleCase(contentType)
  }

  private deriveSimpleTopic(clipTranscript: string, contentType: string): string {
    const lower = clipTranscript.toLowerCase()
    if (/\b(anthropic|claude)\b/.test(lower) && /\b(provider|business|cloud)\b/.test(lower)) {
      return 'AI Providers'
    }
    if (/\b(cloud|local|open source|privacy|data)\b/.test(lower)) {
      return 'AI Tradeoffs'
    }
    if (/\b(network effects?)\b/.test(lower)) {
      return 'Network Effects'
    }
    if (/\b(econom(?:y|ies) of scale)\b/.test(lower)) {
      return 'Economies Of Scale'
    }
    if (/\b(business|company|founder|startup)\b/.test(lower)) {
      return 'Business Strategy'
    }
    return this.smartTitleCase(contentType)
  }

  private deriveSimpleClaim(clipTranscript: string, keyQuote?: string): string {
    const lower = clipTranscript.toLowerCase()
    if (/\b(anthropic|claude)\b/.test(lower) && /\b(provider|business)\b/.test(lower)) {
      return 'This clip argues that relying too heavily on a single AI provider gives away control.'
    }
    if (/\b(cloud|local|open source|privacy|data)\b/.test(lower)) {
      return 'This clip is about the tradeoff between convenience, privacy, and control in AI tooling.'
    }
    if (/\b(network effects?)\b/.test(lower)) {
      return 'This clip argues that old network effects are weakening and no longer protect products in the same way.'
    }
    if (/\b(econom(?:y|ies) of scale)\b/.test(lower)) {
      return 'This clip challenges the idea that scale automatically creates advantage.'
    }
    const cleanedQuote = (keyQuote || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (cleanedQuote && !this.looksLikeTranscriptFragment(cleanedQuote)) {
      return cleanedQuote.replace(/[.]+$/, '') + '.'
    }
    return 'This clip explains the speaker’s main argument and why it matters.'
  }

  private deriveSimpleWhyItMatters(clipTranscript: string): string {
    const lower = clipTranscript.toLowerCase()
    if (/\b(provider|business|control|cloud|local|privacy|data)\b/.test(lower)) {
      return 'It matters because it affects who controls your data, leverage, and long-term downside.'
    }
    if (/\b(network effects?)\b/.test(lower)) {
      return 'It matters because it changes where defensibility really comes from.'
    }
    if (/\b(econom(?:y|ies) of scale)\b/.test(lower)) {
      return 'It matters because it changes how you think about growth and advantage.'
    }
    return 'It matters because it changes how you should think about the decision being discussed.'
  }

  private buildMetadataSignals(
    clipTranscript: string,
    keyQuote?: string,
    metadataAnalysis?: ClipMetadataAnalysisDraft
  ): MetadataSignals {
    const cleanSentence = (value: string) =>
      value
        .replace(/^[^a-zA-Z0-9]+/, '')
        .replace(/\b(um+|uh+|ah+|like)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()

    const normalizeLeadClause = (value: string) =>
      cleanSentence(value)
        .replace(/^that\s+(was|is)\s+/i, '')
        .replace(/^it('?s)?\s+like\s+/i, '')
        .replace(/^i\s+(just\s+)?think\s+/i, '')
        .replace(/^to\s+me\s+/i, '')
        .replace(/^(own and|and|but|so)\s+/i, '')
        .replace(/\s+(and|but|because|so)\s+.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()

    const sentences = clipTranscript
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => cleanSentence(sentence))
      .filter(Boolean)

    const normalizedSentences = sentences.map(normalizeLeadClause).filter(Boolean)
    const allCandidates = [
      metadataAnalysis?.coreClaim || '',
      normalizeLeadClause(keyQuote || ''),
      ...normalizedSentences
    ].filter(Boolean)
    const topicPhrase =
      metadataAnalysis?.primaryTopic ||
      this.extractTopicPhrase([normalizeLeadClause(keyQuote || ''), ...normalizedSentences, clipTranscript])

    const scoreSentence = (sentence: string) => {
      const lower = sentence.toLowerCase()
      const words = sentence.split(/\s+/).filter(Boolean)
      let score = 0
      if (words.length >= 4 && words.length <= 14) score += 4
      if (topicPhrase && lower.includes(topicPhrase.toLowerCase())) score += 8
      if (/(econom(?:y|ies) of scale|network effects?|controls? your business|inside claude|switching costs?)/i.test(lower)) score += 10
      if (/(is a lie|are getting destroyed|controls? your business|shouldn'?t|matters|changing|dead|dying|better to|always better)/i.test(lower)) score += 6
      if (/^(why|how|what|who)\b/i.test(sentence)) score += 2
      if (/^(it|this|that|you|we)\b/i.test(sentence)) score -= 4
      if (/\b(very|nice|thing|stuff|someone|something|forest fire|acorns|soil)\b/i.test(lower)) score -= 4
      if (/\b(to me|i think|it'?s like|that was like|we'?re going to)\b/i.test(lower)) score -= 5
      return score
    }

    const focusSentence = allCandidates.sort((a, b) => scoreSentence(b) - scoreSentence(a))[0] || cleanSentence(clipTranscript)
    const supportingSentence =
      sentences
        .map(normalizeLeadClause)
        .filter((sentence) => sentence && sentence !== focusSentence)
        .sort((a, b) => scoreSentence(b) - scoreSentence(a))[0] || ''

    const themePhrase = this.buildThemePhrase(focusSentence, topicPhrase)

    return {
      focusSentence,
      supportingSentence,
      topicPhrase,
      themePhrase
    }
  }

  private extractTopicPhrase(candidates: string[]): string {
    const joined = candidates.join(' ')
    const namedPatterns = [
      /who really controls your business/i,
      /econom(?:y|ies) of scale/i,
      /network effects?/i,
      /inside claude/i,
      /switching costs?/i,
      /local models?/i,
      /silicon valley/i,
      /web 2\.?0/i,
      /twitter/i
    ]

    for (const pattern of namedPatterns) {
      const match = joined.match(pattern)
      if (match?.[0]) {
        return this.smartTitleCase(match[0])
      }
    }

    const source = candidates.find(Boolean) || joined
    const tokens = source
      .split(/\s+/)
      .map((token) => token.replace(/[^\w.]/g, '').trim())
      .filter(Boolean)

    const stopWords = new Set([
      'a', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'been', 'being', 'but', 'by', 'for',
      'from', 'have', 'here', 'into', 'is', 'it', 'its', 'just', 'like', 'more', 'much', 'of',
      'on', 'or', 'our', 'really', 'right', 'so', 'some', 'than', 'that', 'the', 'their', 'them',
      'there', 'they', 'this', 'to', 'used', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
      'while', 'with', 'would', 'your', 'very', 'nice'
    ])

    const phrases: string[] = []
    for (let index = 0; index < tokens.length - 1; index += 1) {
      const slice = tokens.slice(index, index + 3)
      if (slice.filter((token) => token.length > 2 && !stopWords.has(token.toLowerCase())).length >= 2) {
        phrases.push(slice.join(' '))
      }
    }

    return this.smartTitleCase(phrases[0] || source.split(/\s+/).slice(0, 5).join(' '))
  }

  private extractKeyEntities(clipTranscript: string): string[] {
    const matches = clipTranscript.match(/\b(AI|Claude|Anthropic|Twitter|Web 2\.?0|network effects?|econom(?:y|ies) of scale|switching costs?|cloud|local models?|open source)\b/gi) || []
    return matches.map((match) => this.smartTitleCase(match))
  }

  private inferAudienceAngle(clipTranscript: string, contentType: string, topicPhrase: string): string {
    const lower = clipTranscript.toLowerCase()
    if (/\b(business|founder|company|product|operator|startup)\b/.test(lower)) {
      return `Founders and operators deciding how to handle ${topicPhrase.toLowerCase() || 'this tradeoff'}`
    }
    if (/\b(ai|models?|claude|anthropic|open source|local)\b/.test(lower)) {
      return 'People making practical AI adoption decisions'
    }
    return `People interested in this ${contentType} insight`
  }

  private inferWhyItMatters(clipTranscript: string, signals: MetadataSignals): string {
    const lower = clipTranscript.toLowerCase()
    if (/\b(controls? your business)\b/.test(lower)) {
      return 'It changes who owns the leverage, risk, and long-term upside in your business.'
    }
    if (/\b(network effects?)\b/.test(lower)) {
      return 'It changes how defensibility works and what kinds of products can hold value over time.'
    }
    if (/\b(privacy|cloud|local|open source|claude|anthropic)\b/.test(lower)) {
      return 'It changes the tradeoff between convenience, control, and data risk.'
    }
    return signals.supportingSentence || signals.focusSentence
  }

  private inferMetadataTone(clipTranscript: string): string {
    const lower = clipTranscript.toLowerCase()
    if (/\b(lie|destroyed|dead|dying|problem|wrong)\b/.test(lower)) return 'contrarian'
    if (/\b(think|maybe|probably|kind of|sort of)\b/.test(lower)) return 'conversational'
    if (/\b(because|means|therefore|better|matters)\b/.test(lower)) return 'analytical'
    return 'direct'
  }

  private inferRiskFlags(clipTranscript: string): string[] {
    const flags: string[] = []
    const lower = clipTranscript.toLowerCase()
    if (/\b(it'?s like|to me|i think|kind of|sort of)\b/.test(lower)) flags.push('contains_metaphor_or_softening')
    if (/\b(uh|um|ah)\b/.test(lower)) flags.push('contains_filler')
    if (/\b(this|that|it)\b/.test(lower)) flags.push('may_need_context')
    return flags
  }

  private buildThemePhrase(focusSentence: string, topicPhrase: string): string {
    if (/controls? your business/i.test(focusSentence)) {
      return 'Who Really Controls Your Business'
    }
    if (/econom(?:y|ies) of scale/i.test(focusSentence) && /lie/i.test(focusSentence)) {
      return 'The Lie Of Economies Of Scale'
    }
    if (/network effects?/i.test(focusSentence) && /(destroyed|dying|dead|changing)/i.test(focusSentence)) {
      return 'Network Effects Are Dying'
    }
    if (/inside claude/i.test(focusSentence)) {
      return "Don't Build Your Business Inside Claude"
    }
    if (/web 2\.?0/i.test(focusSentence) && /network effects?/i.test(focusSentence)) {
      return 'Web 2.0 Network Effects Are Breaking'
    }
    if (/always better/i.test(focusSentence) && /small scale/i.test(focusSentence)) {
      return 'Why Small Scale Wins'
    }

    return this.smartTitleCase(focusSentence || topicPhrase)
  }

  private smartTitleCase(value: string): string {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => {
        if (/[0-9]/.test(word) || /^[A-Z0-9.]+$/.test(word)) return word
        if (word.toLowerCase() === 'web') return 'Web'
        if (word.toLowerCase() === 'twitter') return 'Twitter'
        if (word.toLowerCase() === 'claude') return 'Claude'
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 55)
      .trim()
  }

  private rankTitleCandidates(candidates: string[], clipTranscript: string, keyQuote?: string): string[] {
    const transcriptLower = clipTranscript.toLowerCase()
    const keyQuoteLower = (keyQuote || '').toLowerCase()
    const normalizedTranscript = clipTranscript.replace(/\s+/g, ' ').trim()

    const compressTitle = (title: string) =>
      title
        .replace(/^that\s+(was|is)\s+/i, '')
        .replace(/^it('?s)?\s+like\s+/i, '')
        .replace(/^to\s+me\s+/i, '')
        .replace(/^i\s+(just\s+)?think\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim()

    const scoreTitle = (title: string) => {
      const normalized = compressTitle(title)
      const lower = normalized.toLowerCase()
      const words = normalized.split(/\s+/).filter(Boolean)
      const uniqueWordCount = new Set(words.map((word) => word.toLowerCase())).size

      let score = 0
      if (normalized.length >= 12 && normalized.length <= 55) score += 4
      if (words.length >= 3 && words.length <= 8) score += 4
      if (uniqueWordCount / Math.max(words.length, 1) > 0.8) score += 3
      if (transcriptLower.includes(lower)) score += 3
      if (keyQuoteLower && keyQuoteLower.includes(lower)) score += 4
      if (/(econom(?:y|ies) of scale|network effects?|controls? your business|claude|twitter|web 2\.?0)/i.test(lower)) score += 6
      if (/^(why it|why this|why that|you |it |this |that |and |but )/i.test(normalized)) score -= 8
      if (/\b(very|nice|thing|stuff|something|someone|forest fire|acorns|soil)\b/i.test(lower)) score -= 5
      if (/(i'm|i am|i just|to me|we're going to)/i.test(lower)) score -= 5
      if (/generated title/i.test(lower)) score -= 10
      return score
    }

    return Array.from(
      new Set(
        candidates
          .map((candidate) => this.smartTitleCase(compressTitle(candidate)))
          .filter((candidate) => candidate.length > 0)
          .sort((a, b) => scoreTitle(b) - scoreTitle(a))
          .filter((candidate) => scoreTitle(candidate) >= 6)
      )
    )
  }

  private buildFallbackDescription(
    clipTranscript: string,
    preferredTitle?: string,
    signals?: MetadataSignals,
    metadataAnalysis?: ClipMetadataAnalysisDraft
  ): string {
    const transcriptUnits = clipTranscript
      .split(/\n+/)
      .map((unit) => unit.trim())
      .filter(Boolean)

    const sentences = transcriptUnits
      .flatMap((unit) =>
        unit
          .split(/(?<=[.!?])\s+|,\s+(?=[A-ZI][a-z]|(but|and|so|because|if|when|while)\b)/)
          .map((sentence) => sentence.trim())
          .filter(Boolean)
      )

    const titleKeywords = new Set(
      (preferredTitle || '')
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.replace(/[^\w.]/g, ''))
        .filter((token) => token.length > 2)
        .filter((token) => !new Set([
          'the', 'and', 'for', 'with', 'your', 'this', 'that', 'from', 'into', 'about', 'what',
          'when', 'why', 'how', 'does', 'need', 'very', 'big'
        ]).has(token))
    )

    const scoreSentence = (sentence: string) => {
      const clean = sentence.replace(/\s+/g, ' ').trim()
      const lower = clean.toLowerCase()
      const words = clean.split(/\s+/).filter(Boolean)
      let score = 0

      if (words.length >= 8 && words.length <= 26) score += 5
      if (words.length > 30) score -= 8
      if (/[.!?]$/.test(clean)) score += 2
      if (/\b(ai|business|privacy|data|cloud|local|models?|open source|anthropic|claude|twitter|network effects?|econom(?:y|ies) of scale|switching costs?)\b/i.test(lower)) score += 8
      if (/\b(controls?|matters?|means|beats|wins|destroys?|changing|dead|dying|better|problem|tradeoff|risk|convenience)\b/i.test(lower)) score += 6
      if (/^(and|but|so|because)\b/i.test(lower)) score -= 6
      if (/\b(i think|it'?s like|to me|we'?re going to|gonna|kind of|sort of)\b/i.test(lower)) score -= 8
      if (/\b(barrels?|forest fire|acorns?|soil)\b/i.test(lower)) score -= 10
      if (signals?.topicPhrase && lower.includes(signals.topicPhrase.toLowerCase())) score += 4
      if (signals?.themePhrase && lower.includes(signals.themePhrase.toLowerCase())) score += 4
      if (metadataAnalysis?.primaryTopic && lower.includes(metadataAnalysis.primaryTopic.toLowerCase())) score += 5
      if (metadataAnalysis?.coreClaim && lower.includes(metadataAnalysis.coreClaim.toLowerCase().slice(0, 20))) score += 4

      for (const keyword of titleKeywords) {
        if (lower.includes(keyword)) score += 3
      }

      return score
    }

    const selected = Array.from(
      new Set(
        sentences
          .sort((a, b) => scoreSentence(b) - scoreSentence(a))
          .filter((sentence) => scoreSentence(sentence) >= 6)
          .slice(0, 2)
          .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
      )
    )

    if (selected.length === 0) {
      return (
        metadataAnalysis?.whyItMatters ||
        signals?.supportingSentence ||
        signals?.focusSentence ||
        transcriptUnits[0] ||
        clipTranscript
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220)
    }

    const composed = [
      metadataAnalysis?.coreClaim || '',
      metadataAnalysis?.whyItMatters || '',
      ...selected
    ]
      .filter(Boolean)
      .slice(0, 2)
      .filter((value, index, array) => array.indexOf(value) === index)
      .join(' ')

    return composed
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220)
  }

  private isUsableDescription(description: string): boolean {
    if (!description || description.length < 40) return false
    if (/^(i('|’)ve just finished generating|here are|title options)/i.test(description)) return false
    if (/^(and|but|so|because)\b/i.test(description)) return false
    return true
  }

  private isSemanticallyAlignedTitle(
    title: string,
    metadataAnalysis: ClipMetadataAnalysisDraft
  ): boolean {
    const lower = title.toLowerCase()
    const signalTerms = [
      metadataAnalysis.primaryTopic,
      metadataAnalysis.coreClaim,
      metadataAnalysis.audienceAngle,
      metadataAnalysis.whyItMatters,
      ...metadataAnalysis.keyEntities,
      ...metadataAnalysis.supportingPoints
    ]
      .join(' ')
      .toLowerCase()

    if (/\b(barrels?|forest fire|acorns?|soil)\b/i.test(lower)) return false
    if (/\b(ai|anthropic|claude|business|provider|privacy|cloud|local|models?|open source)\b/i.test(lower)) {
      return true
    }
    return lower.split(/\s+/).some((token) => token.length > 3 && signalTerms.includes(token))
  }

  private isSemanticallyAlignedDescription(
    description: string,
    metadataAnalysis: ClipMetadataAnalysisDraft
  ): boolean {
    if (!this.isUsableDescription(description)) return false
    const lower = description.toLowerCase()
    if (/\b(barrels?|forest fire|acorns?|soil)\b/i.test(lower)) return false
    if (/\b(ai|anthropic|claude|business|provider|privacy|cloud|local|models?|open source)\b/i.test(lower)) {
      return true
    }

    const signalTerms = [
      metadataAnalysis.primaryTopic,
      metadataAnalysis.coreClaim,
      metadataAnalysis.audienceAngle,
      metadataAnalysis.whyItMatters,
      ...metadataAnalysis.keyEntities,
      ...metadataAnalysis.supportingPoints
    ]
      .join(' ')
      .toLowerCase()

    const matchingSignals = lower
      .split(/\s+/)
      .filter((token) => token.length > 4 && signalTerms.includes(token))

    return matchingSignals.length >= 2
  }

  private parseResolvedClipProposalResponse(
    content: string,
    segments: Array<{ id: number; start: number; end: number }>
  ): ResolvedClipProposal[] {
    const jsonString = this.extractJSON(content)
    if (!jsonString) {
      throw new Error('No JSON found in resolved clip proposal response')
    }

    const parsed = JSON.parse(jsonString)
    const rawClips = Array.isArray(parsed.resolved_clips) ? parsed.resolved_clips : null
    if (!rawClips) {
      throw new Error('Invalid resolved clip proposal response: missing resolved_clips')
    }

    const segmentIds = new Set(segments.map((segment) => segment.id))
    const validContentTypes = new Set(['insight', 'story', 'advice', 'hot_take', 'humor', 'technical'])
    const validRelations = new Set(['new_topic', 'same_idea', 'optional_context', 'unknown'])

    return rawClips
      .map((clip: any) => {
        const startSegmentId = Number(clip.start_segment_id)
        const endSegmentId = Number(clip.end_segment_id)
        const hookSegmentId = Number(clip.hook_segment_id ?? startSegmentId)
        const payoffSegmentId = Number(clip.payoff_segment_id ?? endSegmentId)

        if (
          !Number.isInteger(startSegmentId) ||
          !Number.isInteger(endSegmentId) ||
          !Number.isInteger(hookSegmentId) ||
          !Number.isInteger(payoffSegmentId) ||
          !segmentIds.has(startSegmentId) ||
          !segmentIds.has(endSegmentId) ||
          !segmentIds.has(hookSegmentId) ||
          !segmentIds.has(payoffSegmentId) ||
          endSegmentId < startSegmentId ||
          hookSegmentId < startSegmentId ||
          hookSegmentId > endSegmentId ||
          payoffSegmentId < startSegmentId ||
          payoffSegmentId > endSegmentId
        ) {
          return null
        }

        const contentType = String(clip.content_type ?? 'insight').toLowerCase()
        const nextSegmentRelation = String(clip.next_segment_relation ?? 'unknown').toLowerCase()
        const rawScore = Number(clip.shareability_score ?? 7)

        return {
          startSegmentId,
          endSegmentId,
          hookSegmentId,
          payoffSegmentId,
          contentType: validContentTypes.has(contentType)
            ? contentType as ResolvedClipProposal['contentType']
            : 'insight',
          shareabilityScore: Math.max(1, Math.min(10, rawScore <= 10 ? rawScore : rawScore / 10)),
          keyQuote: String(clip.key_quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
          reason: String(clip.reason ?? 'Selected as a complete standalone clip arc.').replace(/\s+/g, ' ').trim(),
          endResolutionReason: String(clip.end_resolution_reason ?? '').replace(/\s+/g, ' ').trim(),
          nextSegmentRelation: validRelations.has(nextSegmentRelation)
            ? nextSegmentRelation as ResolvedClipProposal['nextSegmentRelation']
            : 'unknown'
        }
      })
      .filter((clip: ResolvedClipProposal | null): clip is ResolvedClipProposal => Boolean(clip))
      .sort((left: ResolvedClipProposal, right: ResolvedClipProposal) => {
        if (right.shareabilityScore !== left.shareabilityScore) {
          return right.shareabilityScore - left.shareabilityScore
        }
        return left.startSegmentId - right.startSegmentId
      })
  }

  private parseCandidateArcRankingResponse(
    content: string,
    arcs: CandidateArc[]
  ): RankedCandidateArcSelection[] {
    const jsonString = this.extractJSON(content)
    if (!jsonString) {
      throw new Error('No JSON found in candidate arc ranking response')
    }

    const parsed = JSON.parse(jsonString)
    const rawSelections = this.resolveCandidateArcSelectionArray(parsed, arcs) ?? this.extractCandidateArcSelectionsFromText(content, arcs)
    if (!rawSelections) {
      throw new Error('Invalid candidate arc ranking response: missing selected_arcs')
    }

    const arcIds = new Set(arcs.map((arc) => arc.id))
    const validContentTypes = new Set(['insight', 'story', 'advice', 'hot_take', 'humor', 'technical'])
    const validContextNeeded = new Set(['low', 'medium', 'high'])
    const seen = new Set<string>()

    return rawSelections
      .map((selection: any) => {
        const selectionObject = typeof selection === 'string' ? { arc_id: selection } : selection
        const arcId = String(
          selectionObject.arc_id ??
          selectionObject.arcId ??
          selectionObject.id ??
          selectionObject.candidate_arc_id ??
          selectionObject.candidateArcId ??
          ''
        ).trim()
        if (!arcIds.has(arcId) || seen.has(arcId)) {
          return null
        }
        seen.add(arcId)

        const rawScore = Number(selectionObject.shareability_score ?? selectionObject.shareabilityScore ?? selectionObject.score ?? 7)
        const contentType = String(selectionObject.content_type ?? selectionObject.contentType ?? 'insight').toLowerCase()
        const contextNeeded = String(selectionObject.context_needed ?? selectionObject.contextNeeded ?? 'low').toLowerCase()

        return {
          arcId,
          shareabilityScore: Number(Math.max(1, Math.min(10, rawScore <= 10 ? rawScore : rawScore / 10)).toFixed(1)),
          contentType: validContentTypes.has(contentType)
            ? contentType as RankedCandidateArcSelection['contentType']
            : 'insight',
          contextNeeded: validContextNeeded.has(contextNeeded)
            ? contextNeeded as RankedCandidateArcSelection['contextNeeded']
            : 'low',
          keyQuote: String(selectionObject.key_quote ?? selectionObject.keyQuote ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
          reason: String(selectionObject.reason ?? selectionObject.rationale ?? 'Selected from a precomputed editorial arc.').replace(/\s+/g, ' ').trim()
        }
      })
      .filter((selection: RankedCandidateArcSelection | null): selection is RankedCandidateArcSelection => Boolean(selection))
  }

  private resolveCandidateArcSelectionArray(parsed: any, arcs: CandidateArc[]): any[] | null {
    if (Array.isArray(parsed)) {
      return parsed
    }

    const arcIds = new Set(arcs.map((arc) => arc.id))
    const objectEntries = Object.entries(parsed ?? {})
      .filter(([key]) => arcIds.has(key))
      .map(([key, value]) => typeof value === 'object' && value !== null
        ? { ...(value as Record<string, unknown>), arc_id: key }
        : { arc_id: key, score: value }
      )

    if (objectEntries.length > 0) {
      return objectEntries
    }

    const directKeys = [
      'selected_arcs',
      'selectedArcs',
      'selected',
      'selections',
      'clips',
      'arcs',
      'ranked_arcs',
      'rankedArcs'
    ]

    for (const key of directKeys) {
      if (Array.isArray(parsed?.[key])) {
        return parsed[key]
      }
    }

    if (Array.isArray(parsed?.result?.selected_arcs)) {
      return parsed.result.selected_arcs
    }
    if (Array.isArray(parsed?.result?.selectedArcs)) {
      return parsed.result.selectedArcs
    }
    if (Array.isArray(parsed?.data?.selected_arcs)) {
      return parsed.data.selected_arcs
    }
    if (Array.isArray(parsed?.data?.selectedArcs)) {
      return parsed.data.selectedArcs
    }

    return null
  }

  private extractCandidateArcSelectionsFromText(content: string, arcs: CandidateArc[]): any[] | null {
    const arcIds = new Set(arcs.map((arc) => arc.id))
    const seen = new Set<string>()
    const selections: any[] = []
    const pattern = /\barc_[a-zA-Z0-9_-]+\b/g
    let match: RegExpExecArray | null

    while ((match = pattern.exec(content)) !== null) {
      const arcId = match[0]
      if (!arcIds.has(arcId) || seen.has(arcId)) {
        continue
      }

      seen.add(arcId)
      selections.push({
        arc_id: arcId,
        reason: 'Selected from arc IDs mentioned in the candidate arc ranking response.'
      })
    }

    return selections.length > 0 ? selections : null
  }

  private parseWordSpanClipSelectionResponse(
    content: string,
    words: Array<{ index: number; start: number; end: number }>
  ): WordSpanClipSelection[] {
    const jsonString = this.extractJSON(content)
    if (!jsonString) {
      throw new Error('No JSON found in word span clip selection response')
    }

    const parsed = JSON.parse(jsonString)
    const rawSelections = Array.isArray(parsed.word_span_clips) ? parsed.word_span_clips : null
    if (!rawSelections) {
      throw new Error('Invalid word span clip selection response: missing word_span_clips')
    }

    const wordIndexes = new Set(words.map((word) => word.index))
    const wordByIndex = new Map(words.map((word) => [word.index, word]))
    const validContentTypes = new Set(['insight', 'story', 'advice', 'hot_take', 'humor', 'technical'])
    const validContextNeeded = new Set(['low', 'medium', 'high'])
    const seenRanges = new Set<string>()

    return rawSelections
      .map((selection: any) => {
        const startWordIndex = Number(selection.start_word_index ?? selection.startWordIndex)
        const endWordIndex = Number(selection.end_word_index ?? selection.endWordIndex)
        const hookWordIndex = Number(selection.hook_word_index ?? selection.hookWordIndex ?? startWordIndex)
        const payoffWordIndex = Number(selection.payoff_word_index ?? selection.payoffWordIndex ?? endWordIndex)

        if (
          !Number.isInteger(startWordIndex) ||
          !Number.isInteger(endWordIndex) ||
          !Number.isInteger(hookWordIndex) ||
          !Number.isInteger(payoffWordIndex) ||
          !wordIndexes.has(startWordIndex) ||
          !wordIndexes.has(endWordIndex) ||
          !wordIndexes.has(hookWordIndex) ||
          !wordIndexes.has(payoffWordIndex) ||
          endWordIndex <= startWordIndex ||
          hookWordIndex < startWordIndex ||
          hookWordIndex > endWordIndex ||
          payoffWordIndex < startWordIndex ||
          payoffWordIndex > endWordIndex
        ) {
          return null
        }

        const startWord = wordByIndex.get(startWordIndex)
        const endWord = wordByIndex.get(endWordIndex)
        if (!startWord || !endWord) {
          return null
        }

        const duration = endWord.end - startWord.start
        if (duration < 25 || duration > 120) {
          return null
        }

        const rangeKey = `${startWordIndex}-${endWordIndex}`
        if (seenRanges.has(rangeKey)) {
          return null
        }
        seenRanges.add(rangeKey)

        const rawScore = Number(selection.shareability_score ?? selection.shareabilityScore ?? selection.score ?? 7)
        const contentType = String(selection.content_type ?? selection.contentType ?? 'insight').toLowerCase()
        const contextNeeded = String(selection.context_needed ?? selection.contextNeeded ?? 'low').toLowerCase()

        return {
          startWordIndex,
          endWordIndex,
          hookWordIndex,
          payoffWordIndex,
          shareabilityScore: Number(Math.max(1, Math.min(10, rawScore <= 10 ? rawScore : rawScore / 10)).toFixed(1)),
          contentType: validContentTypes.has(contentType)
            ? contentType as WordSpanClipSelection['contentType']
            : 'insight',
          contextNeeded: validContextNeeded.has(contextNeeded)
            ? contextNeeded as WordSpanClipSelection['contextNeeded']
            : 'low',
          keyQuote: String(selection.key_quote ?? selection.keyQuote ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
          reason: String(selection.reason ?? 'Selected as an exact word-level clip span.').replace(/\s+/g, ' ').trim()
        }
      })
      .filter((selection: WordSpanClipSelection | null): selection is WordSpanClipSelection => Boolean(selection))
      .sort((left: WordSpanClipSelection, right: WordSpanClipSelection) => {
        if (right.shareabilityScore !== left.shareabilityScore) {
          return right.shareabilityScore - left.shareabilityScore
        }
        return left.startWordIndex - right.startWordIndex
      })
  }

  private parseRoughCutVariantJudgments(
    content: string,
    validVariantIds: Set<string>
  ): RoughCutVariantJudgment[] {
    const jsonString = this.extractJSON(content)
    if (!jsonString) {
      throw new Error('No JSON found in rough cut variant judgment response')
    }

    const parsed = JSON.parse(jsonString)
    if (!Array.isArray(parsed.judgments)) {
      throw new Error('Invalid rough cut variant judgment response: missing judgments')
    }

    return parsed.judgments
      .map((item: any): RoughCutVariantJudgment | null => {
        const variantId = String(item.variant_id ?? item.variantId ?? '').trim()
        if (!variantId || !validVariantIds.has(variantId)) {
          return null
        }

        const rawContextStatus = String(item.context_status ?? item.contextStatus ?? 'sufficient')
        const contextStatus: RoughCutVariantJudgment['contextStatus'] =
          rawContextStatus === 'missing_previous' || rawContextStatus === 'needs_next'
            ? rawContextStatus
            : 'sufficient'
        const fatalIssues = Array.isArray(item.fatal_issues ?? item.fatalIssues)
          ? (item.fatal_issues ?? item.fatalIssues)
              .map((issue: unknown) => String(issue ?? '').trim())
              .filter(Boolean)
          : []
        const score = Number(item.score)

        return {
          variantId,
          isReviewable: Boolean(item.is_reviewable ?? item.isReviewable),
          startStatus: (item.start_status ?? item.startStatus) === 'abrupt' ? 'abrupt' : 'clean',
          endStatus: (item.end_status ?? item.endStatus) === 'unresolved' ? 'unresolved' : 'rounded',
          contextStatus,
          threadPreserved: Boolean(item.thread_preserved ?? item.threadPreserved),
          tooPadded: Boolean(item.too_padded ?? item.tooPadded),
          fatalIssues,
          score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
          rationale: String(item.rationale ?? '').replace(/\s+/g, ' ').trim()
        }
      })
      .filter((item: RoughCutVariantJudgment | null): item is RoughCutVariantJudgment => Boolean(item))
  }
  
  updateConfig(config: APIConfig) {
    this.config = config
  }

  private resolveCandidateSelection(
    clip: any,
    index: number,
    candidateMap: Map<string, ClipCandidate>
  ): RankedClipSelection | null {
    const candidateId = clip.candidate_id || clip.id
    const candidate = candidateMap.get(candidateId)

    if (!candidate) {
      console.warn(`Skipping unknown candidate from AI response: ${candidateId}`)
      return null
    }

    return {
      id: `clip_${index + 1}`,
      candidateId,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      duration: candidate.duration,
      contentType: clip.content_type || 'insight',
      shareabilityScore: Number(clip.shareability_score) || this.heuristicToShareability(candidate.heuristicScore),
      keyQuote: this.resolveKeyQuote(clip.key_quote, candidate.text),
      reason: clip.reason || 'Strong standalone clip candidate',
      contextNeeded: clip.context_needed || 'low',
      transcriptText: candidate.text,
      naturalStart: candidate.naturalStart,
      naturalEnd: candidate.naturalEnd,
      heuristicScore: candidate.heuristicScore,
      validationScore: 0
    }
  }

  private resolveKeyQuote(rawQuote: string | undefined, candidateText: string): string {
    if (rawQuote && this.normalizedIncludes(candidateText, rawQuote)) {
      return rawQuote.trim()
    }

    const sentences = candidateText
      .split(/[.!?]+/)
      .map(sentence => sentence.trim())
      .filter(Boolean)

    return sentences.find(sentence => sentence.length >= 20)?.slice(0, 180) || candidateText.slice(0, 180)
  }

  private normalizedIncludes(haystack: string, needle: string): boolean {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    return normalize(haystack).includes(normalize(needle))
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text
    }
    return `${text.slice(0, maxLength - 3).trim()}...`
  }

  private extractCandidateSelectionsFromText(
    content: string,
    candidates: ClipCandidate[]
  ): TranscriptAnalysis['potentialClips'] {
    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]))
    const matches = [...content.matchAll(/candidate_\d+_\d+/g)].map((match) => match[0])
    const uniqueIds = Array.from(new Set(matches))

    return uniqueIds
      .map((candidateId, index) => {
        const candidate = candidateMap.get(candidateId)
        if (!candidate) {
          return null
        }

        return {
          id: `ai_recovered_${index + 1}`,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          duration: candidate.duration,
          contentType: 'insight' as const,
          shareabilityScore: this.heuristicToShareability(candidate.heuristicScore),
          keyQuote: this.resolveKeyQuote(undefined, candidate.text),
          reason: 'Recovered from non-JSON AI ranking response.',
          contextNeeded: 'low' as const
        }
      })
      .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip))
  }

  private extractValidatedCandidateSelectionsFromText(
    content: string,
    candidates: ClipCandidate[]
  ): TranscriptAnalysis['potentialClips'] {
    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]))
    const matches = [...content.matchAll(/candidate_\d+_\d+|candidate_seg_\d+_\d+_\d+|candidate_sb_\d+_\d+_\d+_\d+/g)]
      .map((match) => match[0])
    const uniqueIds = Array.from(new Set(matches))

    const recoveredSelections: RankedClipSelection[] = uniqueIds
      .map((candidateId, index) => {
        const candidate = candidateMap.get(candidateId)
        if (!candidate) {
          return null
        }

        const selection: RankedClipSelection = {
          id: `recovered_${index + 1}`,
          candidateId,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          duration: candidate.duration,
          contentType: 'insight' as const,
          shareabilityScore: this.heuristicToShareability(candidate.heuristicScore),
          keyQuote: this.resolveKeyQuote(undefined, candidate.text),
          reason: 'Recovered from non-JSON AI ranking response.',
          contextNeeded: 'low' as const,
          transcriptText: candidate.text,
          naturalStart: candidate.naturalStart,
          naturalEnd: candidate.naturalEnd,
          heuristicScore: candidate.heuristicScore,
          validationScore: 0
        }

        return selection
      })
      .filter((clip): clip is RankedClipSelection => Boolean(clip))
      .filter((clip) => clip.duration >= 30 && clip.duration <= 90)

    let filteredClips = clipValidationService.validateAndRank(recoveredSelections, candidates)
    if (filteredClips.length < 5) {
      filteredClips = this.supplementFromHeuristics(filteredClips, candidates, 8)
    }

    return filteredClips
  }

  private supplementFromHeuristics(
    existingClips: TranscriptAnalysis['potentialClips'],
    candidates: ClipCandidate[],
    targetCount: number
  ): TranscriptAnalysis['potentialClips'] {
    const usedCandidateKeys = new Set(existingClips.map(clip => `${clip.startTime}-${clip.endTime}`))
    const supplemented = [...existingClips]

    for (const candidate of candidates) {
      if (supplemented.length >= targetCount) {
        break
      }

      const candidateKey = `${candidate.startTime}-${candidate.endTime}`
      const overlapsTooMuch = supplemented.some(clip => {
        const overlapStart = Math.max(clip.startTime, candidate.startTime)
        const overlapEnd = Math.min(clip.endTime, candidate.endTime)
        if (overlapEnd <= overlapStart) {
          return false
        }
        const overlap = overlapEnd - overlapStart
        return overlap / Math.min(clip.duration, candidate.duration) > 0.5
      })

      if (
        usedCandidateKeys.has(candidateKey) ||
        overlapsTooMuch ||
        !candidate.naturalStart ||
        !candidate.naturalEnd
      ) {
        continue
      }

      supplemented.push({
        id: `fallback_${supplemented.length + 1}`,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        duration: candidate.duration,
        contentType: 'insight',
        shareabilityScore: this.heuristicToShareability(candidate.heuristicScore),
        keyQuote: this.resolveKeyQuote(undefined, candidate.text),
        reason: 'Fallback heuristic candidate selected due to low validated AI yield.',
        contextNeeded: 'low'
      })
      usedCandidateKeys.add(candidateKey)
    }

    return supplemented
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

  private getPlatformLabel(): string {
    switch (this.config.clipSelectionPlatform) {
      case 'instagram_reels':
        return 'Instagram Reels'
      case 'tiktok':
        return 'TikTok'
      case 'youtube_shorts':
      default:
        return 'YouTube Shorts'
    }
  }

  private heuristicToShareability(heuristicScore: number): number {
    return Math.max(1, Math.min(10, Number((heuristicScore * 1.8).toFixed(1))))
  }

}

export default AIService
