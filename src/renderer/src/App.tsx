import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { Layout } from './components/Layout'
import { NavigationDock } from './components/NavigationDock'
import { HomePage } from './pages/HomePage'
import { ProjectPage } from './pages/ProjectPage'
import { ReviewPage } from './pages/ReviewPage'
import { ExportPage } from './pages/ExportPage'
import { SettingsPage } from './pages/SettingsPage'
import { useViewport, setupNoScrollViewport } from './hooks/useViewport'
import { CommandProcessor, createCommandProcessor, CommandContext } from './services/commandProcessor'
import { ScreenFlowManager } from './services/screenFlowManager'

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const { availableHeight } = useViewport()
  const [isProcessing, setIsProcessing] = useState(false)
  const [commandResult, setCommandResult] = useState<string>('')
  const [sessionData, setSessionData] = useState<{[key: string]: any}>({})
  const [isCommandMode, setIsCommandMode] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  
  // Initialize managers
  const screenFlowManager = useRef<ScreenFlowManager>()
  const commandProcessor = useRef<CommandProcessor>()

  // Determine current screen for command context
  const getCurrentScreen = () => {
    const path = location.pathname
    if (path === '/') return 'upload'
    if (path.startsWith('/project/')) return 'processing'
    if (path.startsWith('/review/')) return 'review'
    if (path.startsWith('/export/')) return 'export'
    if (path === '/settings') return 'settings'
    return 'upload'
  }

  // Extract episode ID from URL
  const getEpisodeId = (): string | undefined => {
    const match = location.pathname.match(/\/(project|review|export)\/([^/]+)/)
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
      clips: sessionData.clips,
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
    setIsProcessing(true)
    
    try {
      const result = await commandProcessor.current.processCommand(command)
      
      if (result.success) {
        setCommandResult(result.message)
        
        // Handle specific actions
        if (result.data?.action) {
          await handleCommandAction(result.data)
        }
      } else {
        setCommandResult(result.message)
      }
    } catch (error) {
      console.error('Command processing error:', error)
      setCommandResult('Command failed to execute')
    } finally {
      setIsProcessing(false)
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

      // Cmd/Ctrl + K to toggle command mode (global shortcut)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isCommandMode) {
          handleCommandModeExit()
        } else {
          handleSearchTrigger()
        }
        return
      }
      
      // Escape to exit command mode (only when active)
      if (e.key === 'Escape' && isCommandMode) {
        e.preventDefault()
        handleCommandModeExit()
        return
      }
      
      // Forward slash to trigger command mode with slash commands
      if (e.key === '/' && !isCommandMode && !isInputFocused()) {
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
            if (getEpisodeId()) navigate(`/project/${getEpisodeId()}`)
            break
          case '3':
            if (getEpisodeId()) navigate(`/review/${getEpisodeId()}`)
            break
          case '4':
            if (getEpisodeId()) navigate(`/content/${getEpisodeId()}`)
            break
          case '5':
            if (getEpisodeId()) navigate(`/export/${getEpisodeId()}`)
            break
          case '6':
            navigate('/settings')
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
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/project/:id" element={<ProjectPage />} />
            <Route path="/review/:id" element={<ReviewPage />} />
            <Route path="/export/:id" element={<ExportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </Layout>
      
      {/* Navigation Dock and Command Interface */}
      <NavigationDock
        onSearchTrigger={handleSearchTrigger}
        onCommandModeExit={handleCommandModeExit}
        onCommand={handleCommand}
        isCommandMode={isCommandMode}
        episodeId={getEpisodeId()}
        isProcessing={isProcessing}
      />

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