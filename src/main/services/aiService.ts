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
    
    const prompt = this.buildAnalysisPrompt(transcriptData, duration)
    
    try {
      onProgress?.(30)
      
      const response = await this.callOpenRouter({
        model: this.config.model === 'deepseek-r1' ? 'deepseek/deepseek-r1' : 'anthropic/claude-3-5-sonnet-20241022',
        messages: [
          {
            role: 'system',
            content: 'You are an expert content analyst specializing in identifying self-contained, shareable segments from long-form conversations for social media.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.3
      })
      
      onProgress?.(70)
      
      const analysis = this.parseAnalysisResponse(response.content)
      
      console.log(`AI Analysis completed: Found ${analysis.potentialClips.length} clips`)
      console.log('Clips summary:', analysis.potentialClips.map(c => ({ 
        id: c.id, 
        contentType: c.contentType, 
        score: c.shareabilityScore,
        duration: c.duration 
      })))
      
      onProgress?.(100)
      
      return analysis
      
    } catch (error) {
      console.error('AI Analysis failed:', error)
      throw new Error(`AI Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
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
CONTEXT: This is a timestamped transcript from a podcast episode that is ${Math.round(duration / 60)} minutes long. Your task is to identify potential clip segments that:
1. Contain complete thoughts or narratives
2. Are engaging and shareable on social media
3. Make sense without additional context
4. Have natural conversation boundaries
5. Are between 30-90 seconds in length

TIMESTAMPED TRANSCRIPT:
${timestampedText}

TASK: Identify 15-25 potential clip segments using the EXACT timestamps from the transcript above. For each segment:
- Use PRECISE start/end times from the transcript segments (e.g., 180.5, 245.2)
- Combine multiple consecutive segments if needed for complete thoughts
- Explain why this segment is clip-worthy
- Categorize the content type
- Rate the shareability potential (1-10)
- Extract the most memorable quote from the actual transcript text

IMPORTANT: Use only the exact timestamps shown in the transcript above. Do not invent or round timestamps.

OUTPUT FORMAT (JSON):
{
  "potential_clips": [
    {
      "id": "clip_1",
      "start_time": 180.5,
      "end_time": 245.2,
      "duration": 64.7,
      "content_type": "insight|story|advice|hot_take|humor|technical",
      "shareability_score": 8.5,
      "reason": "Complete explanation of...",
      "key_quote": "Exact quote from the transcript text",
      "context_needed": "low|medium|high"
    }
  ]
}

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
      throw new Error(`OpenRouter API error: ${response.status} ${errorText}`)
    }
    
    const data = await response.json() as any
    
    if (data.error) {
      throw new Error(`OpenRouter API error: ${data.error.message}`)
    }
    
    return data.choices[0].message
  }
  
  private parseAnalysisResponse(content: string): TranscriptAnalysis {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }
      
      console.log('Raw AI response:', content)
      const parsed = JSON.parse(jsonMatch[0])
      console.log('Parsed AI clips:', parsed.potential_clips)
      
      if (!parsed.potential_clips || !Array.isArray(parsed.potential_clips)) {
        throw new Error('Invalid response format: missing potential_clips array')
      }
      
      // Log timestamp analysis
      parsed.potential_clips.forEach((clip: any, index: number) => {
        console.log(`Clip ${index + 1} timestamps: ${clip.start_time} - ${clip.end_time} (duration: ${clip.duration || (clip.end_time - clip.start_time)})`)
      })
      
      return {
        potentialClips: parsed.potential_clips.map((clip: any, index: number) => ({
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
      }
    } catch (error) {
      console.error('Failed to parse analysis response:', error)
      console.error('Content:', content)
      throw new Error('Failed to parse AI analysis response')
    }
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