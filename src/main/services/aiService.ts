import { APIConfig } from '@shared/types'

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
    
    const maxRetries = 3
    const strategies = [
      { 
        name: 'standard', 
        prompt: this.buildAnalysisPrompt(transcriptData, duration),
        systemMessage: 'You are an expert content analyst specializing in identifying self-contained, shareable segments from long-form conversations for social media.'
      },
      { 
        name: 'simplified', 
        prompt: this.buildSimplifiedAnalysisPrompt(transcriptData, duration),
        systemMessage: 'You are a content analyst. Find interesting clips in this transcript. Always respond with valid JSON.'
      },
      { 
        name: 'structured', 
        prompt: this.buildStructuredAnalysisPrompt(transcriptData, duration),
        systemMessage: 'Extract clips from transcript. Respond only with JSON object containing potential_clips array.'
      }
    ]
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        onProgress?.(30 + (attempt * 15))
        
        const strategy = strategies[attempt] || strategies[0]
        console.log(`AI Analysis attempt ${attempt + 1}/${maxRetries} using ${strategy.name} strategy`)
        
        const response = await this.callOpenRouter({
          model: this.config.model === 'deepseek-r1' ? 'deepseek/deepseek-r1' : 'anthropic/claude-3-5-sonnet-20241022',
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
        
        const analysis = this.parseAnalysisResponse(response.content)
        
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
        model: this.config.model === 'deepseek-r1' ? 'deepseek/deepseek-r1' : 'anthropic/claude-3-5-sonnet-20241022',
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
  
  private buildAnalysisPrompt(transcriptData: { text: string; segments: Array<{ id: number; start: number; end: number; text: string }> }, duration: number): string {
    // Build timestamped transcript for better AI analysis
    const timestampedText = transcriptData.segments.map(segment => 
      `[${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s]: ${segment.text}`
    ).join('\n')

    return `
CONTEXT: This is a timestamped transcript from a podcast episode that is ${Math.round(duration / 60)} minutes long.

⚠️ CRITICAL DURATION REQUIREMENT ⚠️
EVERY CLIP MUST BE BETWEEN 35-60 SECONDS LONG
- MINIMUM: 35 seconds (anything shorter will be REJECTED)
- MAXIMUM: 60 seconds (anything longer will be REJECTED)
- COMBINE multiple consecutive segments to reach the minimum 35 seconds
- DO NOT suggest any clips shorter than 35 seconds

Your task is to identify potential clip segments that:
1. Contain complete thoughts or narratives
2. Are engaging and shareable on social media
3. Make sense without additional context
4. Have natural conversation boundaries
5. Are EXACTLY 35-60 seconds in length

TIMESTAMPED TRANSCRIPT:
${timestampedText}

TASK: Identify 10-15 potential clip segments using the EXACT timestamps from the transcript above. For each segment:
- Use PRECISE start/end times from the transcript segments (e.g., 180.5, 245.2)
- MUST combine multiple consecutive segments to reach AT LEAST 35 seconds
- Calculate the duration: (end_time - start_time) must be between 35-60 seconds
- Explain why this segment is clip-worthy
- Categorize the content type
- Rate the shareability potential (1-10)
- Extract the most memorable quote from the actual transcript text

IMPORTANT:
- Use only the exact timestamps shown in the transcript above
- Every clip MUST be 35-60 seconds - NO EXCEPTIONS
- If a thought is shorter than 35 seconds, include more context before/after to reach 35 seconds

OUTPUT FORMAT (JSON):
{
  "potential_clips": [
    {
      "id": "clip_1",
      "start_time": 120.0,
      "end_time": 160.0,
      "duration": 40.0,
      "content_type": "insight",
      "shareability_score": 8.5,
      "reason": "Complete explanation with good hook",
      "key_quote": "Exact quote from the transcript text",
      "context_needed": "low"
    },
    {
      "id": "clip_2",
      "start_time": 200.5,
      "end_time": 255.5,
      "duration": 55.0,
      "content_type": "story",
      "shareability_score": 9.0,
      "reason": "Engaging narrative arc",
      "key_quote": "Another exact quote",
      "context_needed": "low"
    }
  ]
}

⚠️ DURATION VALIDATION EXAMPLES ⚠️
✅ VALID: duration = 35.0 seconds (minimum)
✅ VALID: duration = 45.5 seconds (good)
✅ VALID: duration = 60.0 seconds (maximum)
❌ REJECTED: duration = 25.0 seconds (TOO SHORT - must be at least 35)
❌ REJECTED: duration = 70.0 seconds (TOO LONG - must be at most 60)

BEFORE SUBMITTING YOUR RESPONSE:
1. Check EVERY clip duration: (end_time - start_time) >= 35 AND <= 60
2. Remove any clips that don't meet this requirement
3. If you can't find 10 clips that meet the duration requirement, submit fewer clips

Focus on finding clips that would make someone stop scrolling and want to hear more from this creator.
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
  
  private parseAnalysisResponse(content: string): TranscriptAnalysis {
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
      console.log('Parsed AI clips:', parsed.potential_clips?.length, 'clips found')
      
      if (!parsed.potential_clips || !Array.isArray(parsed.potential_clips)) {
        throw new Error('Invalid response format: missing potential_clips array')
      }
      
      // Log timestamp analysis
      parsed.potential_clips.forEach((clip: any, index: number) => {
        console.log(`Clip ${index + 1} timestamps: ${clip.start_time} - ${clip.end_time} (duration: ${clip.duration || (clip.end_time - clip.start_time)})`)
      })

      console.log('⚠️⚠️⚠️ ABOUT TO START DURATION FILTERING ⚠️⚠️⚠️')

      const MIN_CLIP_DURATION = 35 // seconds
      const MAX_CLIP_DURATION = 60 // seconds

      console.log(`\n========== CLIP DURATION FILTERING ==========`)
      console.log(`Total clips from AI: ${parsed.potential_clips.length}`)
      console.log(`Required duration: ${MIN_CLIP_DURATION}-${MAX_CLIP_DURATION} seconds`)

      const filteredClips = parsed.potential_clips
        .map((clip: any, index: number) => ({
          id: clip.id || `clip_${index + 1}`,
          startTime: clip.start_time,
          endTime: clip.end_time,
          duration: clip.duration || (clip.end_time - clip.start_time),
          contentType: clip.content_type,
          shareabilityScore: clip.shareability_score,
          keyQuote: clip.key_quote,
          reason: clip.reason,
          contextNeeded: clip.context_needed || 'low'
        }))
        .filter((clip: any) => {
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
  
  private buildSimplifiedAnalysisPrompt(transcriptData: { text: string; segments?: any[] }, duration: number): string {
    return `Find interesting clips in this ${Math.round(duration/60)} minute transcript.

TRANSCRIPT:
${transcriptData.text}

Return JSON with this exact format:
{
  "potential_clips": [
    {
      "id": "clip_1",
      "start_time": 120.5,
      "end_time": 180.0,
      "duration": 59.5,
      "content_type": "insight",
      "shareability_score": 8.5,
      "reason": "Why this is interesting",
      "key_quote": "Main quote from the clip"
    }
  ]
}`
  }
  
  private buildStructuredAnalysisPrompt(transcriptData: { text: string; segments?: any[] }, duration: number): string {
    return `TASK: Extract clips from transcript
DURATION: ${Math.round(duration/60)} minutes

TRANSCRIPT:
${transcriptData.text.substring(0, 8000)} // Truncate for structured approach

RESPOND WITH JSON ONLY:
{"potential_clips":[{"id":"clip_1","start_time":0,"end_time":30,"duration":30,"content_type":"insight","shareability_score":8.0,"reason":"explanation","key_quote":"quote"}]}`
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

}

export default AIService