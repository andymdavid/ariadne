# AI Pipeline Design: Content Analysis & Generation

## Overview

The AI pipeline is the core differentiator of the Reel Creator. It transforms raw podcast transcripts into curated, ready-to-publish content packages through a multi-stage AI analysis process.

## Pipeline Architecture

```
Raw Podcast Audio
    ↓
Stage 1: Transcription (Whisper)
    ↓
Stage 2: Content Segmentation (LLM)
    ↓
Stage 3: Clip Quality Scoring (LLM)
    ↓
Stage 4: Content Package Generation (LLM)
    ↓
Human Review & Approval
    ↓
Final Content Packages
```

## Stage 1: Transcription Pipeline

### Input Processing
- **Audio Extraction:** FFmpeg extracts audio track from video
- **Format Optimization:** Convert to optimal format for Whisper (16kHz WAV)
- **Chunking Strategy:** Split long files into manageable segments

### Whisper Integration
```typescript
interface TranscriptionConfig {
  model: 'whisper-large-v3'
  language: 'auto' | 'en'
  response_format: 'verbose_json'
  timestamp_granularities: ['word', 'segment']
}
```

### Output Structure
```typescript
interface TranscriptSegment {
  id: string
  start: number  // seconds
  end: number    // seconds
  text: string
  words: WordTimestamp[]
  speaker?: string  // future: speaker identification
}

interface WordTimestamp {
  word: string
  start: number
  end: number
  confidence: number
}
```

## Stage 2: Content Segmentation

### Objective
Identify potential clip boundaries based on content structure, not just arbitrary time intervals.

### Prompt Strategy
```
SYSTEM: You are an expert content analyst specializing in identifying 
self-contained, shareable segments from long-form conversations.

CONTEXT: This is a transcript from a podcast episode. Your task is to 
identify potential clip segments that:
1. Contain complete thoughts or narratives
2. Are engaging and shareable on social media
3. Make sense without additional context
4. Have natural conversation boundaries

TRANSCRIPT: {full_transcript_with_timestamps}

TASK: Identify 15-25 potential clip segments. For each segment:
- Provide precise start/end timestamps
- Explain why this segment is clip-worthy
- Categorize the content type
- Rate the shareability potential (1-10)

OUTPUT FORMAT:
{
  "potential_clips": [
    {
      "start_time": 180.5,
      "end_time": 245.2,
      "duration": 64.7,
      "content_type": "insight|story|advice|hot_take|humor",
      "shareability_score": 8,
      "reason": "Complete explanation of...",
      "key_quote": "Most memorable quote from segment",
      "context_needed": "low|medium|high"
    }
  ]
}
```

### Content Type Classification
- **Insight:** Novel perspectives or connections
- **Story:** Complete narratives with beginning/middle/end
- **Advice:** Actionable guidance or recommendations
- **Hot Take:** Controversial or provocative opinions
- **Humor:** Entertaining moments, jokes, banter
- **Technical:** Detailed explanations of complex topics

## Stage 3: Quality Scoring & Ranking

### Multi-Factor Scoring Algorithm
Each potential clip is evaluated across multiple dimensions:

#### Content Quality Factors (40%)
- **Insight Density:** Novel ideas per minute
- **Clarity:** How well the point is articulated
- **Completeness:** Self-contained narrative arc
- **Memorability:** Quotable moments or unique perspectives

#### Engagement Factors (35%)
- **Emotional Resonance:** Passion, excitement, humor in delivery
- **Controversy Potential:** Likelihood to generate discussion
- **Practical Value:** Actionable insights for audience
- **Relatability:** Universal vs. niche appeal

#### Technical Factors (25%)
- **Audio Quality:** Clear speech, minimal background noise
- **Natural Boundaries:** Clean start/stop points
- **Optimal Length:** 30-90 seconds sweet spot
- **Speaker Energy:** Engaged delivery vs. monotone

### Scoring Prompt
```
SYSTEM: You are an expert social media content strategist. Rate this 
transcript segment for its potential as a viral social media clip.

SEGMENT: {transcript_segment}
DURATION: {duration} seconds
CONTEXT: {surrounding_context}

EVALUATION CRITERIA:
1. Would this make someone stop scrolling?
2. Is it self-contained and understandable?
3. Does it provide value (insight/entertainment/advice)?
4. Would viewers want to hear more from this creator?
5. Is the length appropriate for social media?

PROVIDE:
- Overall score (1-10)
- Breakdown by criteria
- Specific strengths and weaknesses
- Suggested improvements (if any)
```

## Stage 4: Content Package Generation

### Title Generation
Create multiple title options for each approved clip:

```
SYSTEM: Generate 5 title options for this social media clip. Titles should be:
- Accurate to the content (no clickbait)
- Intriguing enough to encourage viewing
- Platform-appropriate length (under 60 characters)
- Match the creator's authentic voice

CLIP CONTENT: {transcript}
CREATOR VOICE EXAMPLES: {brand_voice_samples}

OUTPUT:
1. Direct/Descriptive: "{exact topic discussed}"
2. Question-Based: "Why do {relevant question}?"
3. Statement: "{key insight or takeaway}"
4. Personal: "My take on {topic}"
5. Conversational: "Here's what most people get wrong about {topic}"
```

### Description Generation
Platform-specific descriptions that capture the essence without buzzwords:

```
SYSTEM: Write a natural, engaging description for this clip that:
- Summarizes the key point without spoiling it
- Uses the creator's authentic voice and tone
- Avoids marketing speak or excessive emojis
- Provides context for why this matters
- Encourages engagement without being pushy

EXAMPLES OF CREATOR'S STYLE: {previous_descriptions}
CLIP TRANSCRIPT: {content}
PLATFORM: YouTube Shorts

LENGTH: 2-3 sentences, under 150 words
```

### Thumbnail Extraction
Identify optimal thumbnail moments:

```typescript
interface ThumbnailCandidate {
  timestamp: number
  reason: 'peak_engagement' | 'expressive_moment' | 'key_quote'
  frame_quality_score: number
  visual_interest_score: number
}
```

## Model Configuration & Cost Optimization

### Development vs Production Models
```typescript
interface ModelConfig {
  development: {
    transcription: 'whisper-large-v3'  // $0.006/minute
    analysis: 'deepseek-r1'           // $0.14/1M tokens
    generation: 'deepseek-r1'         // $0.14/1M tokens
  }
  production: {
    transcription: 'whisper-large-v3'  // $0.006/minute
    analysis: 'claude-sonnet-4'        // $3/1M tokens
    generation: 'claude-sonnet-4'      // $3/1M tokens
  }
}
```

### Cost Estimation (per 60-minute podcast)
- **Transcription:** ~$0.36 (60 minutes × $0.006)
- **Analysis (Development):** ~$0.50 (3,500 tokens × $0.14/1M)
- **Generation (Development):** ~$0.30 (2,000 tokens × $0.14/1M)
- **Total Development Cost:** ~$1.16 per episode

- **Analysis (Production):** ~$10.50 (3,500 tokens × $3/1M)
- **Generation (Production):** ~$6.00 (2,000 tokens × $3/1M)
- **Total Production Cost:** ~$16.86 per episode

### Optimization Strategies
- **Response Caching:** Store analysis results to avoid re-processing
- **Incremental Processing:** Process only new segments when editing
- **Batch Requests:** Combine multiple operations in single API calls
- **Quality Thresholds:** Only use expensive models for high-confidence clips

## Brand Voice Training

### Data Collection
```typescript
interface BrandVoiceProfile {
  writing_samples: string[]      // User's previous descriptions
  tone_characteristics: {
    formality: 'casual' | 'professional' | 'mixed'
    emotion: 'enthusiastic' | 'analytical' | 'conversational'
    structure: 'direct' | 'storytelling' | 'question_based'
  }
  vocabulary_patterns: string[]  // Common phrases/words
  style_guidelines: string[]     // Explicit preferences
}
```

### Training Process
1. **Sample Collection:** Gather 10-20 examples of user's writing
2. **Pattern Analysis:** Extract style characteristics using LLM
3. **Voice Profile Creation:** Codify preferences into prompts
4. **Iterative Refinement:** Improve based on user feedback

### Few-Shot Prompting
```
EXAMPLES OF CREATOR'S VOICE:

Example 1:
Clip: [transcript about AI trends]
Description: "Most people think AI will replace jobs overnight. Here's 
why that's not quite right - and what's actually happening instead."

Example 2: 
Clip: [transcript about productivity]
Description: "I used to think productivity was about doing more. 
Turns out it's about doing the right things. Here's the difference."

YOUR TASK: Write a description for this new clip in the same style:
[new_clip_transcript]
```

## Error Handling & Quality Assurance

### Transcription Quality Checks
- **Confidence Scores:** Flag low-confidence segments for manual review
- **Speaker Changes:** Detect when speakers change mid-segment
- **Audio Quality:** Identify segments with poor audio quality

### Content Analysis Validation
- **Coherence Checks:** Ensure clip boundaries make logical sense
- **Duration Validation:** Flag clips outside optimal length ranges
- **Content Completeness:** Verify clips contain complete thoughts

### Generation Quality Control
- **Brand Voice Consistency:** Check generated content against voice profile
- **Accuracy Verification:** Ensure titles/descriptions match actual content
- **Platform Compliance:** Verify content meets platform guidelines

## Performance Monitoring

### Key Metrics
- **Processing Speed:** Time from upload to clip suggestions
- **Accuracy Rate:** Percentage of AI suggestions user approves
- **Cost Per Episode:** Total API costs for full processing
- **User Satisfaction:** Quality ratings of generated content

### Continuous Improvement
- **Feedback Loop:** Learn from user approval/rejection patterns
- **Model Performance:** Track and optimize model selection
- **Prompt Iteration:** Refine prompts based on output quality
- **Cost Optimization:** Balance quality vs. API costs

## Future Enhancements

### Advanced Features
- **Multi-Speaker Recognition:** Better handling of interviews/panels
- **Emotion Detection:** Identify high-energy or emotional moments
- **Topic Modeling:** Cluster similar content across episodes
- **Performance Learning:** Improve suggestions based on engagement data

### Integration Opportunities
- **Platform Analytics:** Connect with social media performance data
- **A/B Testing:** Generate multiple versions for testing
- **Collaborative Filtering:** Learn from successful clips across users
- **Real-Time Processing:** Live clip suggestion during recording
