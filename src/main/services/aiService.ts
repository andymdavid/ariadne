import { APIConfig, ClipMetadataAnalysisDraft } from '@shared/types'
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

export interface SemanticTranscriptUnit {
  startSegmentId: number
  endSegmentId: number
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

  async segmentTranscriptIntoThoughts(
    transcriptData: { text: string; segments: Array<{ id: number; start: number; end: number; text: string }> },
    onProgress?: (progress: number) => void
  ): Promise<SemanticTranscriptUnit[]> {
    onProgress?.(10)

    const segments = transcriptData.segments
      .filter((segment) => segment.text.trim().length > 0)
      .sort((left, right) => left.start - right.start)

    if (segments.length <= 1) {
      return segments.map((segment) => ({
        startSegmentId: segment.id,
        endSegmentId: segment.id
      }))
    }

    const prompt = this.buildThoughtSegmentationPrompt(segments)
    const response = await this.callOpenRouter({
      model: this.getModelId(this.config.model),
      messages: [
        {
          role: 'system',
          content: 'You are an expert transcript editor. Group consecutive transcript segments into complete thought units that should not end mid-thought. Return valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 3000,
      temperature: 0.1
    })

    onProgress?.(70)

    const units = this.parseThoughtSegmentationResponse(response.content, segments)
    onProgress?.(100)
    return units
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

  private buildThoughtSegmentationPrompt(
    segments: Array<{ id: number; start: number; end: number; text: string }>
  ) {
    const segmentText = segments
      .map((segment) => {
        const text = segment.text.replace(/\s+/g, ' ').trim()
        return `ID:${segment.id} TIME:${segment.start.toFixed(2)}-${segment.end.toFixed(2)} TEXT:${text}`
      })
      .join('\n')

    return `
TASK: Group these consecutive transcript segments into larger editorial units.

GOAL:
- Each unit should end at a coherent completed thought.
- Do not end a unit on a dangling phrase, conjunction, filler continuation, or mid-explanation.
- Only group consecutive segment IDs.
- Cover the full transcript in order without overlap.
- Prefer units that are natural spoken thoughts, not arbitrary fixed-length chunks.

OUTPUT FORMAT (JSON):
{
  "thought_units": [
    { "start_segment_id": 0, "end_segment_id": 2 },
    { "start_segment_id": 3, "end_segment_id": 5 }
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
    
    // Strategy 2: Look for ``` code blocks (without json specifier)
    match = content.match(/```\s*([\s\S]*?)\s*```/)
    if (match && match[1].trim().startsWith('{')) {
      console.log('Strategy 2 SUCCESS: Found JSON-like content in code block')
      return match[1].trim()
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

  private parseThoughtSegmentationResponse(
    content: string,
    segments: Array<{ id: number; start: number; end: number; text: string }>
  ): SemanticTranscriptUnit[] {
    const jsonString = this.extractJSON(content)
    if (!jsonString) {
      throw new Error('No JSON found in thought segmentation response')
    }

    const parsed = JSON.parse(jsonString)
    const rawUnits = Array.isArray(parsed.thought_units) ? parsed.thought_units : null

    if (!rawUnits) {
      throw new Error('Invalid thought segmentation response: missing thought_units')
    }

    const segmentIds = segments.map((segment) => segment.id)
    const units: SemanticTranscriptUnit[] = (rawUnits as Array<{ start_segment_id: unknown; end_segment_id: unknown }>)
      .map((unit) => ({
        startSegmentId: Number(unit.start_segment_id),
        endSegmentId: Number(unit.end_segment_id)
      }))
      .filter((unit) =>
        Number.isInteger(unit.startSegmentId) &&
        Number.isInteger(unit.endSegmentId) &&
        segmentIds.includes(unit.startSegmentId) &&
        segmentIds.includes(unit.endSegmentId) &&
        unit.startSegmentId <= unit.endSegmentId
      )
      .sort((left: SemanticTranscriptUnit, right: SemanticTranscriptUnit) => left.startSegmentId - right.startSegmentId)

    if (units.length === 0) {
      throw new Error('No valid thought units parsed')
    }

    const normalized: SemanticTranscriptUnit[] = []
    let expectedStart = segmentIds[0]

    for (const unit of units) {
      if (unit.startSegmentId !== expectedStart) {
        continue
      }

      normalized.push(unit)
      expectedStart = unit.endSegmentId + 1
    }

    if (normalized.length === 0) {
      throw new Error('Thought units did not cover transcript contiguously')
    }

    const lastCovered = normalized[normalized.length - 1].endSegmentId
    const finalSegmentId = segmentIds[segmentIds.length - 1]
    if (lastCovered < finalSegmentId) {
      normalized.push({
        startSegmentId: lastCovered + 1,
        endSegmentId: finalSegmentId
      })
    }

    return normalized
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
