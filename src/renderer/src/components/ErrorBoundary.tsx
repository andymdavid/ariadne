import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: ErrorInfo
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error Boundary caught an error:', error, errorInfo)
    
    this.setState({
      error,
      errorInfo
    })

    // Call optional error handler
    this.props.onError?.(error, errorInfo)
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined
    })
  }

  private handleReload = () => {
    window.location.reload()
  }

  public render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default error UI
      return (
        <div className="error-boundary-container">
          <div className="error-boundary-content">
            <div className="error-icon">⚠️</div>
            <h2 className="error-title">Something went wrong</h2>
            <p className="error-message">
              The application encountered an unexpected error. Your work has been saved automatically.
            </p>
            
            <div className="error-actions">
              <button 
                className="btn-primary"
                onClick={this.handleReset}
              >
                Try Again
              </button>
              <button 
                className="btn-secondary"
                onClick={this.handleReload}
              >
                Reload App
              </button>
            </div>

            {/* Error details (development only) */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="error-details">
                <summary>Error Details (Development)</summary>
                <pre className="error-stack">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// Specialized error boundaries for different parts of the app

export const ProcessingErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary
    onError={(error, errorInfo) => {
      console.error('Processing Error Boundary:', error, errorInfo)
      // Could send to error reporting service
    }}
    fallback={
      <div className="processing-error-fallback">
        <div className="error-icon">🔄</div>
        <h3>Processing Error</h3>
        <p>There was an issue with the processing pipeline. Your transcript has been saved.</p>
        <button 
          className="btn-primary"
          onClick={() => window.location.reload()}
        >
          Reload and Continue
        </button>
      </div>
    }
  >
    {children}
  </ErrorBoundary>
)

export const NavigationErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary
    onError={(error, errorInfo) => {
      console.error('Navigation Error Boundary:', error, errorInfo)
    }}
    fallback={
      <div className="navigation-error-fallback">
        <div className="error-icon">🧭</div>
        <h3>Navigation Error</h3>
        <p>Navigation is temporarily unavailable. Try refreshing the app.</p>
        <div className="emergency-actions">
          <button 
            className="btn-secondary"
            onClick={() => {
              // Emergency navigation reset
              const store = (window as any).useProjectStore?.getState?.()
              store?.emergencyUnlockAll?.()
              window.location.reload()
            }}
          >
            Emergency Reset
          </button>
        </div>
      </div>
    }
  >
    {children}
  </ErrorBoundary>
)

export const LibraryErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => (
  <ErrorBoundary
    onError={(error, errorInfo) => {
      console.error('Library Error Boundary:', error, errorInfo)
    }}
    fallback={
      <div className="library-error-fallback">
        <div className="error-icon">📚</div>
        <h3>Library Error</h3>
        <p>The project library is temporarily unavailable. Your projects are still saved.</p>
        <button 
          className="btn-primary"
          onClick={() => window.location.reload()}
        >
          Reload Library
        </button>
      </div>
    }
  >
    {children}
  </ErrorBoundary>
)