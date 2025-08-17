import { createReadStream, statSync } from 'fs'
import FormData from 'form-data'

export interface WhisperResponse {
  text: string
  segments: Array<{
    id: number
    start: number
    end: number
    text: string
    words?: Array<{
      word: string
      start: number
      end: number
    }>
  }>
  language?: string
}

export interface TranscriptionOptions {
  language?: string
  responseFormat?: 'json' | 'verbose_json'
  timestampGranularities?: Array<'word' | 'segment'>
  model?: 'whisper-1'
}

class WhisperService {
  private apiKey: string
  private baseUrl: string = 'https://openrouter.ai/api/v1/audio'
  
  constructor(apiKey: string) {
    this.apiKey = apiKey
  }
  
  /**
   * Transcribe audio file using Whisper API
   */
  async transcribe(
    audioFilePath: string,
    options: TranscriptionOptions = {},
    onProgress?: (progress: number) => void
  ): Promise<WhisperResponse> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key not configured')
    }
    
    // Validate file exists and get size
    const fileStats = statSync(audioFilePath)
    if (!fileStats.isFile()) {
      throw new Error('Audio file not found')
    }
    
    // Check file size (Whisper limit is 25MB)
    const maxSize = 25 * 1024 * 1024 // 25MB
    if (fileStats.size > maxSize) {
      throw new Error('Audio file too large. Maximum size is 25MB.')
    }
    
    onProgress?.(10)
    
    try {
      const formData = new FormData()
      
      // Add the audio file
      formData.append('file', createReadStream(audioFilePath))
      
      // Add model (default to whisper-1)
      formData.append('model', options.model || 'whisper-1')
      
      // Add optional parameters
      if (options.language) {
        formData.append('language', options.language)
      }
      
      if (options.responseFormat) {
        formData.append('response_format', options.responseFormat)
      }
      
      if (options.timestampGranularities) {
        formData.append('timestamp_granularities[]', options.timestampGranularities.join(','))
      }
      
      // Default to verbose JSON for detailed timestamps
      if (!options.responseFormat) {
        formData.append('response_format', 'verbose_json')
      }
      
      onProgress?.(20)
      
      const response = await fetch(`${this.baseUrl}/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders()
        },
        body: formData
      })
      
      onProgress?.(80)
      
      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = `OpenRouter Whisper API error: ${response.status}`
        
        try {
          const errorData = JSON.parse(errorText)
          errorMessage = errorData.error?.message || errorMessage
        } catch {
          errorMessage += ` ${errorText}`
        }
        
        throw new Error(errorMessage)
      }
      
      const result = await response.json()
      
      onProgress?.(100)
      
      return this.processWhisperResponse(result)
      
    } catch (error) {
      console.error('Transcription failed:', error)
      throw new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  
  /**
   * Transcribe audio in chunks for larger files
   */
  async transcribeInChunks(
    audioChunks: string[],
    options: TranscriptionOptions = {},
    onProgress?: (chunkIndex: number, chunkProgress: number, totalProgress: number) => void
  ): Promise<WhisperResponse> {
    const results: WhisperResponse[] = []
    let cumulativeOffset = 0
    
    for (let i = 0; i < audioChunks.length; i++) {
      const chunkPath = audioChunks[i]
      
      try {
        const chunkResult = await this.transcribe(
          chunkPath,
          options,
          (progress) => {
            onProgress?.(i, progress, ((i + progress / 100) / audioChunks.length) * 100)
          }
        )
        
        // Adjust timestamps to account for previous chunks
        const adjustedResult = this.adjustTimestamps(chunkResult, cumulativeOffset)
        results.push(adjustedResult)
        
        // Update cumulative offset for next chunk
        if (adjustedResult.segments.length > 0) {
          const lastSegment = adjustedResult.segments[adjustedResult.segments.length - 1]
          cumulativeOffset = lastSegment.end
        }
        
      } catch (error) {
        console.error(`Failed to transcribe chunk ${i}:`, error)
        throw new Error(`Failed to transcribe chunk ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
    
    return this.mergeTranscriptionResults(results)
  }
  
  private processWhisperResponse(response: any): WhisperResponse {
    // Handle different response formats
    if (response.segments) {
      // Verbose JSON format
      return {
        text: response.text,
        segments: response.segments.map((segment: any) => ({
          id: segment.id,
          start: segment.start,
          end: segment.end,
          text: segment.text.trim(),
          words: segment.words?.map((word: any) => ({
            word: word.word,
            start: word.start,
            end: word.end
          }))
        })),
        language: response.language
      }
    } else {
      // Simple JSON format - create single segment
      return {
        text: response.text,
        segments: [{
          id: 0,
          start: 0,
          end: 0, // Unknown duration
          text: response.text.trim()
        }],
        language: response.language
      }
    }
  }
  
  private adjustTimestamps(result: WhisperResponse, offset: number): WhisperResponse {
    return {
      ...result,
      segments: result.segments.map(segment => ({
        ...segment,
        start: segment.start + offset,
        end: segment.end + offset,
        words: segment.words?.map(word => ({
          ...word,
          start: word.start + offset,
          end: word.end + offset
        }))
      }))
    }
  }
  
  private mergeTranscriptionResults(results: WhisperResponse[]): WhisperResponse {
    const mergedText = results.map(r => r.text).join(' ')
    const mergedSegments = results.flatMap(r => r.segments)
    
    // Re-index segments
    const indexedSegments = mergedSegments.map((segment, index) => ({
      ...segment,
      id: index
    }))
    
    return {
      text: mergedText,
      segments: indexedSegments,
      language: results[0]?.language
    }
  }
  
  /**
   * Estimate transcription cost
   */
  estimateCost(audioFileSizeInBytes: number): number {
    // OpenRouter Whisper pricing: $0.006 per minute
    // Rough estimation: 1MB ≈ 1 minute of audio (varies by quality)
    const estimatedMinutes = audioFileSizeInBytes / (1024 * 1024)
    return estimatedMinutes * 0.006
  }
  
  /**
   * Update API key
   */
  updateApiKey(apiKey: string) {
    this.apiKey = apiKey
  }
}

export default WhisperService