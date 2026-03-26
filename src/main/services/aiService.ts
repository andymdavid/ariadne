import { APIConfig } from '@shared/types'
import clipCandidateService from './clipCandidateService'
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
    onProgress?: (progress: number) => void
  ): Promise<TranscriptAnalysis> {
    onProgress?.(10)
    const candidates = clipCandidateService.generateCandidates(transcriptData.segments).slice(0, 36)

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
  
  /**
   * Generate content package for a clip
   */
  async generateContentPackage(
    clipTranscript: string,
    contentType: string,
    brandVoiceExamples?: string[],
    onProgress?: (progress: number) => void
  ): Promise<ContentPackage> {
    onProgress?.(10)
    
    const prompt = this.buildContentGenerationPrompt(clipTranscript, contentType, brandVoiceExamples)
    
    try {
      onProgress?.(30)
      
      const response = await this.callOpenRouter({
        model: this.getModelId(this.config.model),
        messages: [
          {
            role: 'system',
            content: 'You are an expert social media content strategist who creates engaging titles and descriptions that match the creator\'s authentic voice.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      })
      
      onProgress?.(70)
      
      const contentPackage = this.parseContentResponse(response.content)
      
      onProgress?.(100)
      
      return contentPackage
      
    } catch (error) {
      console.error('Content generation failed:', error)
      throw new Error(`Content generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
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
   - Intriguing enough to encourage viewing
   - Under 60 characters
   - Match the creator's authentic voice

2. Write a natural, engaging description that:
   - Summarizes the key point without spoiling it
   - Uses the creator's authentic voice and tone
   - Avoids marketing speak or excessive emojis
   - Provides context for why this matters
   - Encourages engagement without being pushy
   - 2-3 sentences, under 150 words

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
    
    return { content: data.choices[0].message.content }
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
        throw new Error('Invalid response format: missing selected_candidates array')
      }

      console.log('⚠️⚠️⚠️ ABOUT TO START DURATION FILTERING ⚠️⚠️⚠️')

      const MIN_CLIP_DURATION = 35 // seconds
      const MAX_CLIP_DURATION = 60 // seconds

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
        console.warn(`⚠️ WARNING: Only ${filteredClips.length} clips meet duration requirements. AI should generate clips between 35-60 seconds.`)
      }

      return {
        potentialClips: filteredClips
      }
    } catch (error) {
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
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }
      
      const parsed = JSON.parse(jsonMatch[0])
      
      return {
        titles: parsed.titles || ['Generated title'],
        description: parsed.description || 'Generated description',
        thumbnailTimestamp: parsed.thumbnail_timestamp
      }
    } catch (error) {
      console.error('Failed to parse content response:', error)
      console.error('Content:', content)
      throw new Error('Failed to parse content generation response')
    }
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
