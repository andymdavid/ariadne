/**
 * System Validation Utilities
 * Validates the processing pipeline and state management integrity
 * Part of Phase 4.3: Integration tests and validation
 */

import { useProjectStore } from '../stores/projectStore'
import { useProcessingStore } from '../stores/processingStore'

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  details: {
    storeIntegrity: boolean
    navigationFlow: boolean
    processingPipeline: boolean
    errorRecovery: boolean
    dataPersistence: boolean
  }
}

/**
 * Comprehensive system validation
 */
export function validateSystem(): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  
  // Test 1: Store Integrity
  const storeIntegrity = validateStoreIntegrity(errors, warnings)
  
  // Test 2: Navigation Flow
  const navigationFlow = validateNavigationFlow(errors, warnings)
  
  // Test 3: Processing Pipeline
  const processingPipeline = validateProcessingPipeline(errors, warnings)
  
  // Test 4: Error Recovery
  const errorRecovery = validateErrorRecovery(errors, warnings)
  
  // Test 5: Data Persistence
  const dataPersistence = validateDataPersistence(errors, warnings)
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    details: {
      storeIntegrity,
      navigationFlow,
      processingPipeline,
      errorRecovery,
      dataPersistence
    }
  }
}

function validateStoreIntegrity(errors: string[], warnings: string[]): boolean {
  try {
    // Test project store
    const projectStore = useProjectStore.getState()
    
    if (typeof projectStore.saveCurrentProject !== 'function') {
      errors.push('Project store missing saveCurrentProject method')
      return false
    }
    
    if (typeof projectStore.markScreenCompleted !== 'function') {
      errors.push('Project store missing markScreenCompleted method')
      return false
    }
    
    if (typeof projectStore.emergencyReset !== 'function') {
      errors.push('Project store missing emergencyReset method')
      return false
    }
    
    // Test processing store
    const processingStore = useProcessingStore.getState()
    
    if (typeof processingStore.setProcessing !== 'function') {
      errors.push('Processing store missing setProcessing method')
      return false
    }
    
    if (typeof processingStore.updateProgress !== 'function') {
      errors.push('Processing store missing updateProgress method')
      return false
    }
    
    // Test state persistence
    const testState = projectStore.validateState()
    if (testState === undefined) {
      warnings.push('State validation method exists but returned undefined')
    }
    
    return true
  } catch (error) {
    errors.push(`Store integrity check failed: ${error}`)
    return false
  }
}

function validateNavigationFlow(errors: string[], warnings: string[]): boolean {
  try {
    const projectStore = useProjectStore.getState()
    
    // Test screen access logic
    const screens = ['upload', 'processing', 'review', 'content', 'export', 'library']
    const canAccessMethods = screens.map(screen => 
      projectStore.canAccessScreen ? projectStore.canAccessScreen(screen as any) : undefined
    )
    
    if (canAccessMethods.some(result => result === undefined)) {
      errors.push('canAccessScreen method missing or not working')
      return false
    }
    
    // Test emergency navigation helpers
    if (typeof projectStore.emergencyUnlockAll !== 'function') {
      warnings.push('Emergency unlock helper not available')
    }
    
    return true
  } catch (error) {
    errors.push(`Navigation flow validation failed: ${error}`)
    return false
  }
}

function validateProcessingPipeline(errors: string[], warnings: string[]): boolean {
  try {
    // Test IPC API availability
    if (!window.electronAPI) {
      errors.push('Electron API not available')
      return false
    }
    
    // Test required IPC methods
    const requiredMethods = [
      'selectFile',
      'processEpisode', 
      'onProcessingUpdate',
      'onProcessingComplete',
      'onProcessingError',
      'getEpisodeClips',
      'getProject'
    ]
    
    for (const method of requiredMethods) {
      if (typeof (window.electronAPI as any)[method] !== 'function') {
        errors.push(`Missing IPC method: ${method}`)
        return false
      }
    }
    
    // Test processing hooks
    try {
      // This will be handled by useProcessingUpdates hook in actual usage
      const mockCallback = () => {}
      const cleanup = window.electronAPI.onProcessingUpdate?.(mockCallback)
      if (typeof cleanup !== 'function') {
        warnings.push('Processing update listener may not have proper cleanup')
      } else {
        cleanup() // Clean up test listener
      }
    } catch (error) {
      warnings.push(`Processing update hook test failed: ${error}`)
    }
    
    return true
  } catch (error) {
    errors.push(`Processing pipeline validation failed: ${error}`)
    return false
  }
}

function validateErrorRecovery(errors: string[], warnings: string[]): boolean {
  try {
    const projectStore = useProjectStore.getState()
    
    // Test emergency recovery methods
    if (typeof projectStore.emergencyReset !== 'function') {
      errors.push('Emergency reset method missing')
      return false
    }
    
    if (typeof projectStore.emergencyUnlockAll !== 'function') {
      errors.push('Emergency unlock method missing')
      return false
    }
    
    if (typeof projectStore.recoverSession !== 'function') {
      errors.push('Session recovery method missing')
      return false
    }
    
    // Test error boundary components exist (they should be imported)
    const errorBoundaryExists = document.querySelector('.error-boundary-container, .processing-error-fallback, .navigation-error-fallback, .library-error-fallback')
    if (!errorBoundaryExists) {
      warnings.push('Error boundary UI components may not be properly rendered')
    }
    
    return true
  } catch (error) {
    errors.push(`Error recovery validation failed: ${error}`)
    return false
  }
}

function validateDataPersistence(errors: string[], warnings: string[]): boolean {
  try {
    // Test localStorage access
    try {
      const testKey = 'ariadne-validation-test'
      const testData = { test: true, timestamp: Date.now() }
      localStorage.setItem(testKey, JSON.stringify(testData))
      const retrieved = JSON.parse(localStorage.getItem(testKey) || '{}')
      localStorage.removeItem(testKey)
      
      if (retrieved.test !== true) {
        errors.push('localStorage persistence test failed')
        return false
      }
    } catch (error) {
      errors.push(`localStorage access failed: ${error}`)
      return false
    }
    
    // Test project store persistence
    const projectStore = useProjectStore.getState()
    if (!projectStore.savedProjects || !Array.isArray(projectStore.savedProjects)) {
      warnings.push('Project store may not be properly persisting saved projects')
    }
    
    // Test auto-save functionality (this is handled by useProcessingUpdates hook)
    if (typeof projectStore.saveCurrentProject !== 'function') {
      errors.push('Auto-save functionality missing - saveCurrentProject method not found')
      return false
    }
    
    return true
  } catch (error) {
    errors.push(`Data persistence validation failed: ${error}`)
    return false
  }
}

/**
 * Run validation and log results to console
 */
export function runSystemValidation(): ValidationResult {
  console.log('🔍 SYSTEM VALIDATION: Running comprehensive system checks...')
  
  const result = validateSystem()
  
  console.log('📊 VALIDATION RESULTS:', {
    overall: result.isValid ? '✅ PASSED' : '❌ FAILED',
    details: result.details,
    errorCount: result.errors.length,
    warningCount: result.warnings.length
  })
  
  if (result.errors.length > 0) {
    console.error('❌ VALIDATION ERRORS:', result.errors)
  }
  
  if (result.warnings.length > 0) {
    console.warn('⚠️ VALIDATION WARNINGS:', result.warnings)
  }
  
  return result
}

/**
 * Quick validation for development - safe for startup
 */
export function quickValidation(): boolean {
  try {
    // Only validate basic system components that don't require React context
    // Test 1: Basic API availability
    if (!window.electronAPI) {
      console.warn('Electron API not available during startup validation')
      return false
    }
    
    // Test 2: localStorage access
    try {
      const testKey = 'ariadne-startup-test'
      localStorage.setItem(testKey, 'test')
      localStorage.removeItem(testKey)
    } catch (error) {
      console.error('localStorage not accessible:', error)
      return false
    }
    
    // Test 3: Store availability (basic check without getState)
    if (typeof useProjectStore === 'undefined' || typeof useProcessingStore === 'undefined') {
      console.error('Stores not properly imported')
      return false
    }
    
    console.log('Quick startup validation passed')
    return true
  } catch (error) {
    console.error('Quick validation failed:', error)
    return false
  }
}
