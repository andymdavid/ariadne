import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { IoCheckmarkCircle, IoChevronForward, IoChevronBack, IoWarning, IoEllipseOutline } from 'react-icons/io5'
import { MainContentPanel } from '../components/MainContentPanel'
import { CaptionEditor } from '../components/CaptionEditor'

interface Clip {
  id: string
  startTime: number
  endTime: number
  duration: number
  contentType: string
  shareabilityScore: number
  keyQuote: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
}

type EditorTab = 'captions' | 'logo' | 'music' | 'frame'

export function ContentPage() {
  const { id: episodeId } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [approvedClips, setApprovedClips] = useState<Clip[]>([])
  const [selectedClipIndex, setSelectedClipIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<EditorTab>('captions')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!episodeId) {
      setError('No episode ID provided')
      setLoading(false)
      return
    }

    loadApprovedClips()
  }, [episodeId])

  const loadApprovedClips = async () => {
    try {
      setLoading(true)

      const rawClips = await window.electronAPI?.getApprovedClips(episodeId!)

      // Map database snake_case to camelCase
      const clips: Clip[] = rawClips.map((clip: any) => ({
        id: clip.id,
        startTime: Number(clip.start_time) || 0,
        endTime: Number(clip.end_time) || 0,
        duration: Number(clip.duration) || 0,
        contentType: clip.content_type || 'unknown',
        shareabilityScore: Number(clip.shareability_score) || 0,
        keyQuote: clip.key_quote || '',
        reason: clip.reason || '',
        status: clip.status || 'approved'
      }))

      setApprovedClips(clips)
      setLoading(false)
    } catch (err) {
      console.error('Failed to load approved clips:', err)
      setError(err instanceof Error ? err.message : 'Failed to load clips')
      setLoading(false)
    }
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const selectedClip = approvedClips[selectedClipIndex]

  if (loading) {
    return (
      <MainContentPanel>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="animate-spin text-4xl mb-4">⏳</div>
            <div className="text-text-secondary">Loading approved clips...</div>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  if (error) {
    return (
      <MainContentPanel>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <IoWarning className="text-5xl text-accent-danger mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">Error</h2>
            <p className="text-text-secondary mb-6">{error}</p>
            <button className="btn-primary" onClick={() => navigate(`/review/${episodeId}`)}>
              Back to Review
            </button>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  if (approvedClips.length === 0) {
    return (
      <MainContentPanel>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-2xl w-full space-y-8 text-center">
            <div className="space-y-4">
              <div className="text-6xl text-text-muted">✏️</div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-text-primary">
                  No Approved Clips
                </h1>
                <p className="text-text-muted">
                  You need to approve clips in the Review page before generating content.
                </p>
              </div>
              <button className="btn-primary" onClick={() => navigate(`/review/${episodeId}`)}>
                Go to Review
              </button>
            </div>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  return (
    <MainContentPanel>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Main Content: Two-Panel Layout */}
        <div className="flex-1 flex overflow-hidden h-full">
          {/* Left Panel: Clip List */}
          <div className="w-80 border-r border-border-default overflow-y-auto flex-shrink-0">
            <div className="p-4 space-y-2">
              {approvedClips.map((clip, index) => {
                const isSelected = index === selectedClipIndex

                return (
                  <div
                    key={clip.id}
                    className={`settings-card p-3 cursor-pointer transition-all ${
                      isSelected ? 'ring-2 ring-accent-primary' : ''
                    }`}
                    onClick={() => setSelectedClipIndex(index)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-medium uppercase tracking-wide ${
                        clip.contentType === 'insight' ? 'text-purple-400' :
                        clip.contentType === 'story' ? 'text-blue-400' :
                        clip.contentType === 'advice' ? 'text-green-400' :
                        'text-gray-400'
                      }`}>
                        {clip.contentType}
                      </span>
                      {/* Completion badge - will be hooked up to database in later phase */}
                      <IoEllipseOutline className="text-text-muted text-sm" />
                    </div>
                    <p className="text-sm text-text-primary line-clamp-2 mb-2">
                      "{clip.keyQuote}"
                    </p>
                    <div className="text-xs text-text-muted">
                      {formatTime(clip.duration)} • Score: {clip.shareabilityScore}★
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right Panel: Editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedClip && (
              <>
                {/* Tab Navigation */}
                <div className="border-b border-border-default">
                  <div className="flex justify-center space-x-1">
                    <button
                      onClick={() => setActiveTab('captions')}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'captions'
                          ? 'text-accent-primary border-b-2 border-accent-primary'
                          : 'text-gray-400 hover:text-text-primary'
                      }`}
                    >
                      Captions
                    </button>
                    <button
                      onClick={() => setActiveTab('logo')}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'logo'
                          ? 'text-accent-primary border-b-2 border-accent-primary'
                          : 'text-gray-400 hover:text-text-primary'
                      }`}
                    >
                      Logo
                    </button>
                    <button
                      onClick={() => setActiveTab('music')}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'music'
                          ? 'text-accent-primary border-b-2 border-accent-primary'
                          : 'text-gray-400 hover:text-text-primary'
                      }`}
                    >
                      Music
                    </button>
                    <button
                      onClick={() => setActiveTab('frame')}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'frame'
                          ? 'text-accent-primary border-b-2 border-accent-primary'
                          : 'text-gray-400 hover:text-text-primary'
                      }`}
                    >
                      Frame
                    </button>
                  </div>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto p-6">
                  {activeTab === 'captions' && (
                    <CaptionEditor
                      clipId={selectedClip.id}
                      episodeId={episodeId!}
                      clipStartTime={selectedClip.startTime}
                      clipEndTime={selectedClip.endTime}
                      onSave={() => {
                        // TODO: Optionally update completion badge
                        console.log('Caption edits saved for clip:', selectedClip.id)
                      }}
                    />
                  )}

                  {activeTab === 'logo' && (
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-text-primary">Logo & Watermark</h3>
                      <p className="text-text-muted text-sm">
                        Add and position a logo or watermark overlay
                      </p>
                    </div>
                  )}

                  {activeTab === 'music' && (
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-text-primary">Background Music</h3>
                      <p className="text-text-muted text-sm">
                        Add background music with auto-ducking during speech
                      </p>
                    </div>
                  )}

                  {activeTab === 'frame' && (
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-text-primary">Aspect Ratio & Cropping</h3>
                      <p className="text-text-muted text-sm">
                        Configure aspect ratio and video cropping behavior
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}