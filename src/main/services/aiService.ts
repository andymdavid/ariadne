import { APIConfig } from '@shared/types'
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
  async generateContentPackage(
    clipTranscript: string,
    contentType: string,
    brandVoiceExamples?: string[],
    onProgress?: (progress: number) => void,
    keyQuote?: string
  ): Promise<ContentPackage> {
    onProgress?.(10)
    
    const strategies = [
      {
        name: 'standard',
        systemMessage:
          'You are an expert YouTube Shorts content strategist. Generate short, accurate, high-curiosity titles and concise descriptions that match the creator\'s authentic voice. Never return transcript sentences as titles.',
        prompt: this.buildContentGenerationPrompt(clipTranscript, contentType, brandVoiceExamples)
      },
      {
        name: 'strict-json',
        systemMessage:
          'Return valid JSON only. Generate short YouTube Shorts titles and one concise description. Never return transcript sentences as titles.',
        prompt: `${this.buildContentGenerationPrompt(clipTranscript, contentType, brandVoiceExamples)}\n\nRespond with JSON only. No markdown, no commentary.`
      },
      {
        name: 'minimal',
        systemMessage:
          'Return valid JSON only with 3 short YouTube Shorts titles and 1 concise description.',
        prompt: `
CLIP TRANSCRIPT:
${clipTranscript}

RETURN JSON ONLY:
{
  "titles": ["title one", "title two", "title three"],
  "description": "two concise sentences"
}
        `.trim()
      }
    ]

    const maxRetries = strategies.length

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        onProgress?.(30 + attempt * 15)

        const strategy = strategies[attempt]
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
          max_tokens: 1000,
          temperature: attempt === 0 ? 0.7 : 0.2
        })

        onProgress?.(70 + attempt * 5)

        const contentPackage = this.parseContentResponse(response.content)
        const fallbackPackage = this.buildFallbackContentPackage(clipTranscript, contentType, keyQuote)
        const finalizedPackage = this.finalizeContentPackage(contentPackage, fallbackPackage, clipTranscript, keyQuote)
        onProgress?.(100)
        return finalizedPackage
      } catch (error) {
        console.error(`Content generation attempt ${attempt + 1}/${maxRetries} failed:`, error)
        if (attempt === maxRetries - 1) {
          console.error('Content generation failed, using fallback package:', error)
          onProgress?.(100)
          return this.buildFallbackContentPackage(clipTranscript, contentType, keyQuote)
        }
      }
    }

    return this.buildFallbackContentPackage(clipTranscript, contentType, keyQuote)
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
  
  private buildContentGenerationPrompt(
    clipTranscript: string,
    contentType: string,
    brandVoiceExamples?: string[]
  ): string {
    const voiceSection = brandVoiceExamples && brandVoiceExamples.length > 0 
      ? `\nBRAND VOICE EXAMPLES:\n${brandVoiceExamples.join('\n\n')}`
      : ''
    
    return `
TASK: Generate a content package for this ${contentType} clip.

CLIP TRANSCRIPT: ${clipTranscript}${voiceSection}

REQUIREMENTS:
1. Create 5 title options that are:
   - Accurate to the content (no clickbait)
   - Written for YouTube Shorts
   - High-curiosity and skimmable
   - Under 55 characters
   - Ideally 3-8 words
   - Not a verbatim transcript sentence
   - No full stops at the end
   - No quotation marks
   - Match the creator's authentic voice

2. Write a natural, engaging description that:
   - Summarizes the key point without spoiling it
   - Uses the creator's authentic voice and tone
   - Avoids marketing speak or excessive emojis
   - Provides context for why this matters
   - Encourages engagement without being pushy
   - 2-3 sentences, under 120 words

3. Prefer titles in patterns like:
   - strong claim
   - contrarian insight
   - surprising takeaway
   - direct framing of the topic

4. Avoid titles that:
   - start mid-thought
   - read like a paragraph
   - depend on missing context
   - include filler phrases

OUTPUT FORMAT (JSON):
{
  "titles": [
    "Direct/Descriptive: exact topic discussed",
    "Question-Based: Why do relevant question?",
    "Statement: key insight or takeaway",
    "Personal: My take on topic",
    "Conversational: Here's what most people get wrong about topic"
  ],
  "description": "Natural, engaging description in creator's voice...",
  "thumbnail_timestamp": 30.5
}
    `.trim()
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
        const recoveredClips = this.extractCandidateSelectionsFromText(content, candidates)
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
      const recoveredClips = this.extractCandidateSelectionsFromText(content, candidates)
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

  private buildFallbackContentPackage(clipTranscript: string, contentType: string, keyQuote?: string): ContentPackage {
    const signals = this.buildMetadataSignals(clipTranscript, keyQuote)
    const titles = this.rankTitleCandidates(
      [
        signals.focusSentence,
        signals.topicPhrase ? `Why ${signals.topicPhrase}` : '',
        signals.topicPhrase ? `The Truth About ${signals.topicPhrase}` : '',
        signals.themePhrase,
        signals.topicPhrase && /claude/i.test(clipTranscript) ? `Don't Build Your Business Inside Claude` : '',
        signals.topicPhrase && /network effects?/i.test(clipTranscript) ? `Network Effects Are Breaking Down` : '',
        signals.topicPhrase && /econom(?:y|ies) of scale/i.test(clipTranscript) ? `The Lie Of Economies Of Scale` : '',
        signals.topicPhrase && /controls? your business/i.test(clipTranscript) ? `Who Really Controls Your Business` : ''
      ],
      clipTranscript,
      keyQuote
    ).slice(0, 5)
    const description = this.buildFallbackDescription(
      clipTranscript,
      titles[0] || signals.themePhrase || signals.topicPhrase,
      signals
    )

    return {
      titles: titles.length > 0 ? titles : ['Clip Breakdown'],
      description,
      thumbnailTimestamp: undefined
    }
  }

  private finalizeContentPackage(
    aiPackage: ContentPackage,
    fallbackPackage: ContentPackage,
    clipTranscript: string,
    keyQuote?: string
  ): ContentPackage {
    const titles = this.rankTitleCandidates(
      [...(aiPackage.titles || []), ...(fallbackPackage.titles || [])],
      clipTranscript,
      keyQuote
    ).slice(0, 5)

    const aiDescription = (aiPackage.description || '').trim()
    const description = this.isUsableDescription(aiDescription)
      ? aiDescription
      : this.buildFallbackDescription(clipTranscript, titles[0], this.buildMetadataSignals(clipTranscript, keyQuote))

    return {
      titles: titles.length > 0 ? titles : fallbackPackage.titles,
      description,
      thumbnailTimestamp: aiPackage.thumbnailTimestamp ?? fallbackPackage.thumbnailTimestamp
    }
  }

  private buildMetadataSignals(clipTranscript: string, keyQuote?: string): MetadataSignals {
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
    const allCandidates = [normalizeLeadClause(keyQuote || ''), ...normalizedSentences].filter(Boolean)
    const topicPhrase = this.extractTopicPhrase([normalizeLeadClause(keyQuote || ''), ...normalizedSentences, clipTranscript])

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
    signals?: MetadataSignals
  ): string {
    const sentences = clipTranscript
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)

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
      if (/[.!?]$/.test(clean)) score += 2
      if (/\b(ai|business|privacy|data|cloud|local|models?|open source|anthropic|claude|twitter|network effects?|econom(?:y|ies) of scale|switching costs?)\b/i.test(lower)) score += 8
      if (/\b(controls?|matters?|means|beats|wins|destroys?|changing|dead|dying|better|problem|tradeoff|risk|convenience)\b/i.test(lower)) score += 6
      if (/^(and|but|so|because)\b/i.test(lower)) score -= 6
      if (/\b(i think|it'?s like|to me|we'?re going to|gonna|kind of|sort of)\b/i.test(lower)) score -= 8
      if (/\b(barrels?|forest fire|acorns?|soil)\b/i.test(lower)) score -= 10
      if (signals?.topicPhrase && lower.includes(signals.topicPhrase.toLowerCase())) score += 4
      if (signals?.themePhrase && lower.includes(signals.themePhrase.toLowerCase())) score += 4

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
      return (signals?.focusSentence || clipTranscript)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220)
    }

    return selected
      .join(' ')
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
