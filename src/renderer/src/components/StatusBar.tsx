import { useProcessingStore } from '../stores/processingStore'

export function StatusBar() {
  const { progress, message, isProcessing } = useProcessingStore()

  if (!isProcessing) {
    return (
      <div className="h-8 bg-bg-secondary border-b border-border-default flex items-center justify-center">
        <div className="text-sm text-text-muted">Ready</div>
      </div>
    )
  }

  return (
    <div className="h-8 bg-bg-secondary border-b border-border-default flex items-center px-4">
      <div className="flex items-center space-x-3 flex-1">
        {/* Processing indicator */}
        <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse" />
        
        {/* Status message */}
        <div className="text-sm text-text-secondary">
          {message}
        </div>
        
        {/* Progress bar */}
        <div className="flex-1 max-w-xs">
          <div className="w-full bg-bg-tertiary rounded-full h-1">
            <div 
              className="bg-accent-primary h-1 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        
        {/* Progress percentage */}
        <div className="text-xs text-text-muted min-w-[3rem] text-right">
          {Math.round(progress)}%
        </div>
      </div>
    </div>
  )
}