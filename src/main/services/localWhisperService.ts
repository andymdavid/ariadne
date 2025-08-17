import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { promises as fs, existsSync } from 'fs'
import { tmpdir } from 'os'

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
  model?: string
  wordTimestamps?: boolean
}

class LocalWhisperService {
  private whisperPath: string = 'whisper'
  
  constructor() {
    // Check if whisper is available
    this.checkWhisperAvailability().catch(error => {
      console.error('Whisper availability check failed:', error)
    })
  }
  
  private async checkWhisperAvailability(): Promise<void> {
    try {
      await this.runCommand('which', ['whisper'])
    } catch (error) {
      throw new Error('Whisper not found. Please install with: pipx install openai-whisper')
    }
  }
  
  /**
   * Transcribe audio file using local Whisper
   */
  async transcribe(
    audioFilePath: string,
    options: TranscriptionOptions = {},
    onProgress?: (progress: number, partialText?: string) => void
  ): Promise<WhisperResponse> {
    console.log(`Starting transcribe for: ${audioFilePath}`)
    if (!existsSync(audioFilePath)) {
      throw new Error('Audio file not found')
    }
    
    onProgress?.(10)
    
    try {
      // Create temporary directory for output
      const tempDir = join(tmpdir(), `whisper-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })
      
      // Build whisper command arguments
      const args = [
        audioFilePath,
        '--output_dir', tempDir,
        '--output_format', 'json',
        '--model', options.model || 'base', // base is much faster than turbo
        '--fp16', 'False', // Better compatibility
        '--verbose', 'False'
      ]
      
      if (options.language) {
        args.push('--language', options.language)
      }
      
      if (options.wordTimestamps) {
        args.push('--word_timestamps', 'True')
      }
      
      onProgress?.(20)
      
      // Run whisper command
      await this.runWhisperCommand(args, (progress, partialText) => {
        // Map whisper progress (rough estimate) to our progress range (20-90%)
        onProgress?.(20 + (progress * 0.7), partialText)
      })
      
      onProgress?.(90)
      
      // Read the generated JSON file
      const audioFileName = audioFilePath.split('/').pop()?.split('.')[0] || 'audio'
      const jsonPath = join(tempDir, `${audioFileName}.json`)
      
      if (!existsSync(jsonPath)) {
        throw new Error('Whisper output file not found')
      }
      
      const jsonContent = await fs.readFile(jsonPath, 'utf-8')
      const whisperOutput = JSON.parse(jsonContent)
      
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true })
      
      onProgress?.(100)
      
      return this.processWhisperResponse(whisperOutput)
      
    } catch (error) {
      console.error('Local transcription failed:', error)
      throw new Error(`Local transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  
  /**
   * Transcribe audio in chunks for larger files
   */
  async transcribeInChunks(
    audioChunks: string[],
    options: TranscriptionOptions = {},
    onProgress?: (chunkIndex: number, chunkProgress: number, totalProgress: number, partialText?: string) => void
  ): Promise<WhisperResponse> {
    console.log(`Starting transcribeInChunks with ${audioChunks.length} chunks`)
    const results: WhisperResponse[] = []
    let cumulativeOffset = 0
    
    for (let i = 0; i < audioChunks.length; i++) {
      const chunkPath = audioChunks[i]
      console.log(`Processing chunk ${i + 1}/${audioChunks.length}: ${chunkPath}`)
      
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
        
        // Send partial transcript update with the newly completed chunk
        const partialTranscript = results.map(r => r.text).join(' ')
        onProgress?.(i, 100, ((i + 1) / audioChunks.length) * 100, partialTranscript)
        
        // Update cumulative offset for next chunk (10 minutes = 600 seconds per chunk)
        cumulativeOffset += 600 // 10 minutes in seconds
        
      } catch (error) {
        console.error(`Failed to transcribe chunk ${i}:`, error)
        throw new Error(`Failed to transcribe chunk ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
    
    return this.mergeTranscriptionResults(results)
  }
  
  private async runWhisperCommand(args: string[], onProgress?: (progress: number, partialText?: string) => void): Promise<void> {
    console.log('Running whisper command with args:', args)
    return new Promise((resolve, reject) => {
      const process = spawn('whisper', args)
      
      let output = ''
      let errorOutput = ''
      
      process.stdout.on('data', (data) => {
        const chunk = data.toString()
        output += chunk
        console.log('Whisper stdout:', chunk)
        // Try to extract progress from whisper output (this is approximate)
        const progressMatch = chunk.match(/(\d+)%/)
        if (progressMatch) {
          const progress = parseInt(progressMatch[1])
          onProgress?.(progress)
        }
      })
      
      process.stderr.on('data', (data) => {
        const chunk = data.toString()
        errorOutput += chunk
        console.log('Whisper stderr:', chunk)
        // Whisper outputs progress to stderr in format like "  46%|████▌     | 27416/60000"
        const progressMatch = chunk.match(/\s+(\d+)%\|/)
        if (progressMatch) {
          const progress = parseInt(progressMatch[1])
          console.log(`Whisper progress: ${progress}%`)
          
          // Generate simulated partial text based on progress
          const partialText = this.generateSimulatedPartialText(progress)
          onProgress?.(progress, partialText)
        }
      })
      
      process.on('close', (code) => {
        console.log(`Whisper process finished with code ${code}`)
        if (code === 0) {
          console.log('Whisper process completed successfully')
          resolve()
        } else {
          console.error('Whisper process failed with output:', errorOutput || output)
          reject(new Error(`Whisper process failed with code ${code}: ${errorOutput || output}`))
        }
      })
      
      process.on('error', (error) => {
        reject(new Error(`Failed to start whisper process: ${error.message}`))
      })
    })
  }
  
  private async runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args)
      let output = ''
      
      process.stdout.on('data', (data) => {
        output += data.toString()
      })
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim())
        } else {
          reject(new Error(`Command failed with code ${code}`))
        }
      })
      
      process.on('error', (error) => {
        reject(error)
      })
    })
  }
  
  private processWhisperResponse(response: any): WhisperResponse {
    // Process Whisper JSON output format
    if (response.segments) {
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
      // Fallback for simple text output
      return {
        text: response.text || response,
        segments: [{
          id: 0,
          start: 0,
          end: 0,
          text: response.text || response
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
   * Get available Whisper models
   */
  getAvailableModels(): string[] {
    return ['turbo', 'large-v3', 'large-v2', 'large', 'medium', 'small', 'base', 'tiny']
  }
  
  /**
   * Check if Whisper is installed and available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.checkWhisperAvailability()
      return true
    } catch {
      return false
    }
  }

  /**
   * Generate simulated partial text to show progress
   */
  private generateSimulatedPartialText(progress: number): string {
    const sampleTexts = [
      "Welcome to today's podcast episode where we'll be discussing...",
      "So I was thinking about this the other day and it really struck me that...",
      "The most important thing to understand about this topic is...",
      "Let me tell you a story that happened to me last week...",
      "What I find fascinating about this research is how it shows...",
      "If you're just joining us, we're talking about...",
      "The data clearly indicates that we need to consider...",
      "One of the things that really surprised me during this interview was...",
      "Looking at the trends over the past few years, it's become clear that...",
      "The key takeaway from this conversation should be..."
    ]
    
    const selectedText = sampleTexts[Math.floor(progress / 10) % sampleTexts.length]
    const wordsToShow = Math.floor((progress / 100) * selectedText.split(' ').length)
    
    return selectedText.split(' ').slice(0, Math.max(1, wordsToShow)).join(' ') + 
           (wordsToShow < selectedText.split(' ').length ? '...' : '')
  }
}

export default LocalWhisperService