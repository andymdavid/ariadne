import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { Layout } from './components/Layout'
import { NavigationDock } from './components/NavigationDock'
import { HomePage } from './pages/HomePage'
import { ReviewPage } from './pages/ReviewPage'
import { ContentPage } from './pages/ContentPage'
import { ExportPage } from './pages/ExportPage'
import { LibraryPage } from './pages/LibraryPage'
import { useViewport, setupNoScrollViewport } from './hooks/useViewport'
import { useProcessingUpdates } from './hooks/useProcessingUpdates'
import { CommandProcessor, createCommandProcessor, CommandContext } from './services/commandProcessor'
import { ScreenFlowManager } from './services/screenFlowManager'
import { StatusMessage } from './components/CommandDisplay'
import { useProcessingStore } from './stores/processingStore'
import { useProjectStore } from './stores/projectStore'
import { ErrorBoundary, ProcessingErrorBoundary, NavigationErrorBoundary, LibraryErrorBoundary } from './components/ErrorBoundary'
import { quickValidation } from './utils/systemValidation'
import { IoFlash, IoCheckmarkCircle, IoCreate, IoCloudUpload, IoAnalytics } from 'react-icons/io5'

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const { availableHeight } = useViewport()
  const [commandResult, setCommandResult] = useState<string>('')
  const [sessionData, setSessionData] = useState<{[key: string]: any}>({})
  const [isCommandMode, setIsCommandMode] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [sessionMessages, setSessionMessages] = useState<StatusMessage[]>([])
  const [hasActivatedAriadne, setHasActivatedAriadne] = useState(false)
  
  // Get processing state from store
  const { isProcessing, stage, message: processingMessage } = useProcessingStore()
  
  // Get project state
  const { 
    clips: projectClips, 
    currentEpisode,
    fileInfo,
    markScreenCompleted,
    setFileInfo,
    validateState,
    recoverSession
  } = useProjectStore()
  
  // Set up processing update listeners
  useProcessingUpdates()
  
  // Initialize managers
  const screenFlowManager = useRef<ScreenFlowManager>()
  const commandProcessor = useRef<CommandProcessor>()

  // Determine current screen for command context
  const getCurrentScreen = () => {
    const path = location.pathname
    if (path === '/') return 'upload'
    if (path.startsWith('/review/')) return 'review'
    if (path.startsWith('/content/')) return 'content'
    if (path.startsWith('/export/')) return 'export'
    if (path === '/library') return 'library'
    return 'upload'
  }

  // Extract episode ID from URL
  const getEpisodeId = (): string | undefined => {
    const match = location.pathname.match(/\/(review|content|export)\/([^/]+)/)
    return match ? match[2] : undefined
  }

  // Initialize managers when navigation changes
  useEffect(() => {
    const currentScreen = getCurrentScreen()
    const episodeId = getEpisodeId()

    // Initialize screen flow manager
    if (!screenFlowManager.current) {
      screenFlowManager.current = new ScreenFlowManager(navigate, currentScreen)
    } else {
      screenFlowManager.current.setCurrentScreen(currentScreen)
    }

    if (episodeId) {
      screenFlowManager.current.setEpisodeId(episodeId)
    }

    // Update session data in screen flow manager
    Object.keys(sessionData).forEach(key => {
      screenFlowManager.current?.setSessionData(key, sessionData[key])
    })

    // Initialize command processor with updated context
    const context: CommandContext = {
      currentScreen,
      navigate,
      episodeId,
      clips: projectClips.length > 0 ? projectClips : sessionData.clips,
      setClipsFilter: (filter) => {
        console.log('Setting clips filter:', filter)
        // TODO: Implement filter logic
      },
      onApproveAll: () => {
        console.log('Approving all clips')
        // TODO: Implement approve all logic
      },
      onRejectLowScores: () => {
        console.log('Rejecting low scores')
        // TODO: Implement reject low scores logic
      },
      onExport: (format) => {
        console.log('Exporting with format:', format)
        // TODO: Implement export logic
      }
    }

    if (!commandProcessor.current) {
      commandProcessor.current = createCommandProcessor(context)
    } else {
      commandProcessor.current.updateContext(context)
    }
  }, [location.pathname, navigate, sessionData])

  // Add message to session history
  const addSessionMessage = (message: StatusMessage) => {
    console.log('Adding session message:', message)
    setSessionMessages(prev => {
      const newMessages = [...prev, message]
      console.log('Updated session messages:', newMessages)
      return newMessages
    })
  }

  // Initialize session with welcome messages and validation
  useEffect(() => {
    if (sessionMessages.length === 0) {
      // Run session validation and recovery first
      console.log('App startup: Running session validation...')
      const isValidState = validateState()
      
      if (!isValidState) {
        console.log('App startup: Invalid state detected, attempting recovery...')
        recoverSession()
      }
      
      // Run quick system validation (Phase 4.3 integration test)
      console.log('App startup: Running system integrity check...')
      const systemHealthy = true // quickValidation() // Temporarily disabled
      
      const welcomeMessage: StatusMessage = {
        id: '1',
        type: 'info',
        message: 'Welcome to Ariadne - Your thread through content',
        timestamp: new Date()
      }
      const readyMessage: StatusMessage = {
        id: '2', 
        type: 'status',
        message: 'Ready to process your podcast content',
        timestamp: new Date()
      }
      const statusMessage: StatusMessage = {
        id: '3',
        type: 'info', 
        message: 'Press ⌘K to access commands and session history',
        timestamp: new Date()
      }
      
      // Add recovery message if we had to fix things
      const messages = [welcomeMessage, readyMessage, statusMessage]
      if (!isValidState) {
        const recoveryMessage: StatusMessage = {
          id: '4',
          type: 'success',
          message: 'Session recovered - previous work restored',
          timestamp: new Date()
        }
        messages.push(recoveryMessage)
      }
      
      // Add system health message
      if (!systemHealthy) {
        const healthWarning: StatusMessage = {
          id: Date.now().toString(),
          type: 'info',
          message: '⚠️ System validation detected issues - run "validate system" for details',
          timestamp: new Date()
        }
        messages.push(healthWarning)
      }
      
      setSessionMessages(messages)
    }
  }, [])

  // Add navigation messages to session history
  useEffect(() => {
    const currentScreen = getCurrentScreen()
    if (currentScreen !== 'upload' && sessionMessages.length > 0) {
      const navMessage: StatusMessage = {
        id: Date.now().toString(),
        type: 'info',
        message: `Navigated to ${currentScreen} screen`,
        timestamp: new Date()
      }
      addSessionMessage(navMessage)
    }
  }, [location.pathname])

  // AI Companion: Auto-open status display and add messages when processing starts
  useEffect(() => {
    if (isProcessing && !hasActivatedAriadne) {
      // Automatically open command mode to show status display
      setIsCommandMode(true)
      setHasActivatedAriadne(true)
      setPreviousStage('') // Reset stage tracking
      
      // Add initial processing message - only once
      const startMessage: StatusMessage = {
        id: Date.now().toString(),
        type: 'info',
        message: '🤖 Activating Ariadne...',
        timestamp: new Date(),
        icon: IoAnalytics
      }
      console.log('Adding Ariadne activation message:', startMessage)
      addSessionMessage(startMessage)

      // Add stage-specific AI companion messages with delays
      const addCompanionMessage = (message: string, delay: number, icon?: React.ComponentType<any>) => {
        setTimeout(() => {
          const companionMessage: StatusMessage = {
            id: Date.now().toString(),
            type: 'status',
            message,
            timestamp: new Date(),
            icon
          }
          console.log('Adding AI companion message:', companionMessage)
          addSessionMessage(companionMessage)
        }, delay)
      }

      // Initial file analysis message
      addCompanionMessage('Analyzing your podcast file...', 500, IoCloudUpload)
      
    } else if (!isProcessing && hasActivatedAriadne) {
      // When processing ends, add final completion message and reset
      const completionMessage: StatusMessage = {
        id: Date.now().toString(), 
        type: 'success',
        message: '🎉 All clips generated successfully! Ready to review your content.',
        timestamp: new Date(),
        icon: IoCheckmarkCircle
      }
      addSessionMessage(completionMessage)
      setHasActivatedAriadne(false) // Reset for next processing session
      setPreviousStage('') // Reset stage tracking
    }
  }, [isProcessing, hasActivatedAriadne, addSessionMessage])

  // Track previous stage to detect stage changes and add completion messages
  const [previousStage, setPreviousStage] = useState<string>('')
  
  // Update AI companion messages based on processing stage changes
  useEffect(() => {
    if (isProcessing && hasActivatedAriadne) {
      // Add completion message for previous stage
      if (previousStage && previousStage !== stage) {
        const completionMessages = {
          extracting: 'Audio extraction complete ✅',
          transcribing: 'Transcription complete ✅',
          analyzing: 'Content analysis complete ✅'
        }
        
        const completionMsg = completionMessages[previousStage as keyof typeof completionMessages]
        if (completionMsg) {
          const completionMessage: StatusMessage = {
            id: Date.now().toString(),
            type: 'success',
            message: completionMsg,
            timestamp: new Date(),
            icon: IoCheckmarkCircle
          }
          console.log('Adding stage completion message:', completionMessage)
          addSessionMessage(completionMessage)
        }
      }
      
      // Add start message for current stage
      const stageMessages = {
        extracting: { message: 'Extracting audio track...', icon: IoFlash },
        transcribing: { message: 'Transcribing audio with AI...', icon: IoCreate },
        analyzing: { message: 'Analyzing content for clips...', icon: IoAnalytics },
        generating: { message: 'Generating clip recommendations...', icon: IoCheckmarkCircle }
      }
      
      const stageData = stageMessages[stage as keyof typeof stageMessages]
      if (stageData && previousStage !== stage) {
        const stageMessage: StatusMessage = {
          id: Date.now().toString(),
          type: 'status',
          message: stageData.message,
          timestamp: new Date(),
          icon: stageData.icon
        }
        console.log('Adding stage-based AI companion message:', stageMessage)
        addSessionMessage(stageMessage)
      }
      
      // Update previous stage
      setPreviousStage(stage)
    }
  }, [stage, isProcessing, hasActivatedAriadne, addSessionMessage, previousStage])

  // Handle search trigger (enter command mode)
  const handleSearchTrigger = () => {
    setIsCommandMode(true)
    setCommandInput('')
  }

  // Handle command mode exit
  const handleCommandModeExit = () => {
    setIsCommandMode(false)
    setCommandInput('')
  }

  // Handle command execution
  const handleCommand = async (command: string) => {
    if (!commandProcessor.current) return

    console.log('Processing command:', command)
    
    // Add command to session history
    const commandMessage: StatusMessage = {
      id: Date.now().toString(),
      type: 'info',
      message: `> ${command}`,
      timestamp: new Date()
    }
    addSessionMessage(commandMessage)
    
    try {
      const result = await commandProcessor.current.processCommand(command)
      
      if (result.success) {
        setCommandResult(result.message)
        
        // Add success message to session history
        const successMessage: StatusMessage = {
          id: (Date.now() + 1).toString(),
          type: 'success',
          message: result.message,
          timestamp: new Date()
        }
        addSessionMessage(successMessage)
        
        // Handle specific actions
        if (result.data?.action) {
          await handleCommandAction(result.data)
        }
      } else {
        setCommandResult(result.message)
        
        // Add error message to session history
        const errorMessage: StatusMessage = {
          id: (Date.now() + 1).toString(),
          type: 'error',
          message: result.message,
          timestamp: new Date()
        }
        addSessionMessage(errorMessage)
      }
    } catch (error) {
      console.error('Command processing error:', error)
      const errorMsg = 'Command failed to execute'
      setCommandResult(errorMsg)
      
      // Add error to session history
      const errorMessage: StatusMessage = {
        id: (Date.now() + 1).toString(),
        type: 'error',
        message: errorMsg,
        timestamp: new Date()
      }
      addSessionMessage(errorMessage)
    } finally {
      setIsCommandMode(false)
      setCommandInput('')
      
      // Clear result message after delay
      setTimeout(() => setCommandResult(''), 3000)
    }
  }

  // Handle specific command actions
  const handleCommandAction = async (actionData: any) => {
    switch (actionData.action) {
      case 'selectFile':
        // Trigger file selection
        if (window.electronAPI?.selectFile) {
          const filePath = await window.electronAPI.selectFile()
          if (filePath) {
            console.log('File selected:', filePath)
            
            // Save file info to project store
            const fileName = filePath.split('/').pop() || ''
            setFileInfo({
              name: fileName,
              path: filePath,
              size: 0, // Will be populated by processing
              duration: 0, // Will be populated by processing
              uploadDate: new Date().toISOString()
            })
            
            // Mark upload screen as completed
            markScreenCompleted('upload')
            
            // TODO: Start processing
          }
        }
        break
      
      case 'searchClips':
        // Filter clips by topic
        console.log('Searching clips for:', actionData.topic)
        // TODO: Implement search logic
        break
        
      case 'filterByDuration':
        // Filter clips by duration
        console.log('Filtering by duration:', actionData.maxDuration)
        // TODO: Implement duration filter
        break
        
      case 'approveHighScores':
        // Approve clips with high scores
        console.log('Approving high scores:', actionData.minScore)
        // TODO: Implement bulk approve
        break
        
      case 'export':
        // Export with specific format
        console.log('Exporting as:', actionData.format)
        // TODO: Implement export
        break
      
      case 'cancelProcessing':
        // Cancel current processing
        console.log('Cancelling processing...')
        const { reset } = useProcessingStore.getState()
        reset()
        setHasActivatedAriadne(false)
        
        // Add cancellation message
        const cancelMessage: StatusMessage = {
          id: Date.now().toString(),
          type: 'info',
          message: '⏹️ Processing cancelled by user',
          timestamp: new Date()
        }
        addSessionMessage(cancelMessage)
        break
        
      case 'test navigation':
      case 'test-navigation':
      case 'testnavigation':
        // Temporary command to test navigation by marking screens completed
        console.log('Testing navigation - marking screens as completed')
        markScreenCompleted('upload')
        markScreenCompleted('processing')
        
        // Add test message
        const testMessage: StatusMessage = {
          id: Date.now().toString(),
          type: 'success',
          message: '✅ Navigation test - screens marked as completed',
          timestamp: new Date()
        }
        addSessionMessage(testMessage)
        break
        
      default:
        console.log('Unhandled action:', actionData.action)
    }
  }

  // Setup no-scroll viewport on mount
  useEffect(() => {
    setupNoScrollViewport()
  }, [])

  // Enhanced keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if any input/textarea is currently focused
      const isInputFocused = (): boolean => {
        const activeElement = document.activeElement
        return activeElement instanceof HTMLInputElement || 
               activeElement instanceof HTMLTextAreaElement ||
               (activeElement instanceof HTMLElement && activeElement.contentEditable === 'true')
      }

      // Only handle navigation dock shortcuts - let CommandDisplay handle its own
      const currentScreen = getCurrentScreen()
      
      // Cmd/Ctrl + K to toggle navigation dock command mode (only for non-home screens)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && currentScreen !== 'upload') {
        e.preventDefault()
        if (isCommandMode) {
          handleCommandModeExit()
        } else {
          handleSearchTrigger()
        }
        return
      }
      
      // Escape to exit navigation dock command mode (only when active)
      if (e.key === 'Escape' && isCommandMode) {
        e.preventDefault()
        handleCommandModeExit()
        return
      }
      
      // Forward slash to trigger navigation dock command mode (only for non-home screens)
      if (e.key === '/' && !isCommandMode && !isInputFocused() && currentScreen !== 'upload') {
        e.preventDefault()
        handleSearchTrigger()
        return
      }
      
      // Quick navigation shortcuts (only when not in command mode)
      if (!isCommandMode && !isInputFocused()) {
        switch (e.key) {
          case '1':
            navigate('/')
            break
          case '2':
            if (getEpisodeId()) navigate(`/review/${getEpisodeId()}`)
            break
          case '3':
            if (getEpisodeId()) navigate(`/content/${getEpisodeId()}`)
            break
          case '4':
            if (getEpisodeId()) navigate(`/export/${getEpisodeId()}`)
            break
          case '5':
            navigate('/library')
            break
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isCommandMode, navigate])

  return (
    <>
      <Layout>
        <div 
          className="main-content"
          style={{ 
            height: `${availableHeight}px`,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={
                <ProcessingErrorBoundary>
                  <HomePage />
                </ProcessingErrorBoundary>
              } />
              <Route path="/review/:id" element={<ReviewPage />} />
              <Route path="/content/:id" element={<ContentPage />} />
              <Route path="/export/:id" element={<ExportPage />} />
              <Route path="/library" element={
                <LibraryErrorBoundary>
                  <LibraryPage />
                </LibraryErrorBoundary>
              } />
            </Routes>
          </ErrorBoundary>
        </div>
      </Layout>
      
      {/* Navigation Dock and Command Interface */}
      <NavigationErrorBoundary>
        <NavigationDock
          onSearchTrigger={handleSearchTrigger}
          onCommandModeExit={handleCommandModeExit}
          onCommand={handleCommand}
          isCommandMode={isCommandMode}
          episodeId={getEpisodeId()}
          isProcessing={isProcessing}
          sessionMessages={sessionMessages}
          onAddMessage={addSessionMessage}
          showStatusMode={sessionMessages.length >= 3} // Show status mode when there are initial messages
        />
      </NavigationErrorBoundary>

      {/* Command Result Feedback */}
      {commandResult && (
        <div className="command-result">
          {commandResult}
        </div>
      )}

    </>
  )
}

export default App