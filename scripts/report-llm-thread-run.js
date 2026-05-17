#!/usr/bin/env node

const path = require('path')
const Database = require('better-sqlite3')

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.db) {
    printUsage()
    process.exit(1)
  }

  const dbPath = path.resolve(args.db)
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  const selectionRun = resolveSelectionRun(db, args)
  if (!selectionRun) {
    console.error('No matching selection run found.')
    process.exit(1)
  }

  const decisions = getSelectionDecisions(db, selectionRun.id)
  const clips = getClips(db, selectionRun.id)
  const summary = safeJson(selectionRun.summary_json, {})
  const metadata = summary.metadata || summary.selectionMetadata || summary

  printRunSummary(selectionRun, metadata, decisions, clips)
  printDiscovery(metadata)
  printDecisionTable(decisions)
  printDetailedDecisions(decisions)
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--db') args.db = argv[++index]
    else if (arg === '--selection-run') args.selectionRunId = argv[++index]
    else if (arg === '--job') args.workflowJobId = argv[++index]
    else if (arg === '--episode') args.episodeId = argv[++index]
    else if (arg === '--latest') args.latest = true
    else if (arg === '--help' || arg === '-h') args.help = true
  }
  if (args.help) {
    printUsage()
    process.exit(0)
  }
  return args
}

function printUsage() {
  console.log('Usage:')
  console.log('  node scripts/report-llm-thread-run.js --db <ariadne.db> --selection-run <id>')
  console.log('  node scripts/report-llm-thread-run.js --db <ariadne.db> --job <workflow_job_id>')
  console.log('  node scripts/report-llm-thread-run.js --db <ariadne.db> --episode <episode_id>')
  console.log('  node scripts/report-llm-thread-run.js --db <ariadne.db> --latest')
}

function resolveSelectionRun(db, args) {
  if (args.selectionRunId) {
    return db.prepare('SELECT * FROM pipeline_selection_runs WHERE id = ? LIMIT 1').get(args.selectionRunId)
  }
  if (args.workflowJobId) {
    return db.prepare(`
      SELECT * FROM pipeline_selection_runs
      WHERE workflow_job_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(args.workflowJobId)
  }
  if (args.episodeId) {
    return db.prepare(`
      SELECT * FROM pipeline_selection_runs
      WHERE episode_id = ? AND production_mode = 'llm_thread_v1'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(args.episodeId)
  }
  return db.prepare(`
    SELECT * FROM pipeline_selection_runs
    WHERE production_mode = 'llm_thread_v1'
    ORDER BY created_at DESC
    LIMIT 1
  `).get()
}

function getSelectionDecisions(db, selectionRunId) {
  return db.prepare(`
    SELECT *
    FROM selection_decisions
    WHERE selection_run_id = ?
    ORDER BY rank_order ASC, created_at ASC
  `).all(selectionRunId)
}

function getClips(db, selectionRunId) {
  return db.prepare(`
    SELECT *
    FROM clips
    WHERE selection_run_id = ? AND is_active = 1
    ORDER BY start_time ASC
  `).all(selectionRunId)
}

function printRunSummary(selectionRun, metadata, decisions, clips) {
  console.log('LLM Thread Run Report')
  console.log('=====================')
  console.log(`Selection run: ${selectionRun.id}`)
  console.log(`Workflow job:  ${selectionRun.workflow_job_id}`)
  console.log(`Episode:       ${selectionRun.episode_id}`)
  console.log(`Mode:          ${selectionRun.production_mode}`)
  console.log(`Status:        ${selectionRun.status}`)
  console.log(`Created:       ${selectionRun.created_at}`)
  console.log(`Completed:     ${selectionRun.completed_at || 'null'}`)
  console.log('')
  console.log('Top-level metrics:')
  console.log(`- decisions: ${decisions.length}`)
  console.log(`- clips persisted: ${clips.length}`)
  console.log(`- zeroOutputStage: ${value(metadata.zeroOutputStage)}`)
  console.log(`- threadCandidatesDiscovered: ${value(metadata.threadCandidatesDiscovered)}`)
  console.log(`- threadCandidatesAccepted: ${value(metadata.threadCandidatesAccepted)}`)
  console.log(`- threadCandidatesRepaired: ${value(metadata.threadCandidatesRepaired)}`)
  console.log(`- threadCandidatesRejected: ${value(metadata.threadCandidatesRejected)}`)
  console.log(`- llmDiscoveryError: ${value(metadata.llmDiscoveryError)}`)
  console.log(`- llmRepairError: ${value(metadata.llmRepairError)}`)
  console.log(`- llmCoherenceReviewError: ${value(metadata.llmCoherenceReviewError)}`)
  console.log(`- repairAttemptsExhausted: ${value(metadata.llmRepairAttemptsExhausted)}`)
  console.log(`- coherenceReviewsAttempted: ${value(metadata.coherenceReviewsAttempted)}`)
  console.log(`- coherenceReviewsAccepted: ${value(metadata.coherenceReviewsAccepted)}`)
  console.log(`- mechanicalVariantsGenerated: ${value(metadata.mechanicalVariantsGenerated)}`)
  console.log('')
}

function printDiscovery(metadata) {
  const diagnostics = Array.isArray(metadata.discoveryDiagnostics) ? metadata.discoveryDiagnostics : []
  if (!diagnostics.length) return
  console.log('Discovery diagnostics:')
  for (const item of diagnostics) {
    console.log(`- ${item.chunkId}: raw=${item.rawCandidateCount} valid=${item.validCandidateCount} invalid=${item.invalidCandidateCount}`)
    if (Array.isArray(item.invalidReasons) && item.invalidReasons.length) {
      console.log(`  invalidReasons: ${item.invalidReasons.join('; ')}`)
    }
    if (item.responsePreview) {
      console.log(`  preview: ${truncate(item.responsePreview, 220)}`)
    }
  }
  console.log('')
}

function printDecisionTable(decisions) {
  console.log('Decision table:')
  if (!decisions.length) {
    console.log('- no selection decisions persisted')
    console.log('')
    return
  }
  for (const decision of decisions) {
    const detail = safeJson(decision.validator_result_json, {})
    const candidate = detail.candidate || {}
    const verification = detail.verification || {}
    const review = detail.coherenceReview || null
    const range = detail.finalLineRange
      ? `${detail.finalLineRange.startLineIndex}-${detail.finalLineRange.endLineIndex}`
      : `${candidate.startLineIndex ?? '?'}-${candidate.endLineIndex ?? '?'}`
    console.log([
      `- #${decision.rank_order ?? '?'}`,
      decision.decision,
      candidate.id || decision.id,
      JSON.stringify(candidate.title || ''),
      `range=${range}`,
      `status=${verification.status || '?'}`,
      `issues=${(verification.issues || []).join('|') || 'none'}`,
      `coherence=${review ? `${review.status}:${review.confidence}` : 'not_run'}`
    ].join(' '))
  }
  console.log('')
}

function printDetailedDecisions(decisions) {
  console.log('Decision details:')
  for (const decision of decisions) {
    const detail = safeJson(decision.validator_result_json, {})
    const candidate = detail.candidate || {}
    const originalRange = detail.originalLineRange || {}
    const finalRange = detail.finalLineRange || {}
    const verification = detail.verification || {}
    console.log(`\n#${decision.rank_order ?? '?'} ${candidate.id || decision.id}: ${candidate.title || 'untitled'}`)
    console.log(`decision=${decision.decision} rejectionCode=${value(decision.rejection_code)} finalScore=${value(decision.final_score)}`)
    console.log(`originalRange=${originalRange.startLineIndex ?? '?'}-${originalRange.endLineIndex ?? '?'} finalRange=${finalRange.startLineIndex ?? '?'}-${finalRange.endLineIndex ?? '?'}`)
    console.log(`verification=${verification.status || '?'} duration=${value(verification.duration)} issues=${(verification.issues || []).join(', ') || 'none'}`)
    console.log(`repairAttempts=${value(detail.repairAttempts)} repairError=${value(detail.repairError)}`)
    console.log(`deterministicRepairApplied=${value(detail.deterministicRepairApplied)} deterministicRepairFailureCode=${value(detail.deterministicRepairFailureCode)}`)
    if (detail.deterministicRepairReason) {
      console.log(`deterministicRepairReason=${truncate(detail.deterministicRepairReason, 300)}`)
    }
    if (detail.coherenceReview) {
      console.log(`coherenceReview=${detail.coherenceReview.status} confidence=${detail.coherenceReview.confidence}`)
      console.log(`coherenceReason=${truncate(detail.coherenceReview.reason, 420)}`)
      if (Array.isArray(detail.coherenceReview.fatalIssues) && detail.coherenceReview.fatalIssues.length) {
        console.log(`coherenceFatalIssues=${detail.coherenceReview.fatalIssues.join(', ')}`)
      }
    }
    if (detail.coherenceReviewError) {
      console.log(`coherenceReviewError=${truncate(detail.coherenceReviewError, 420)}`)
    }
  }
  console.log('')
}

function safeJson(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function value(input) {
  return input === undefined || input === null || input === '' ? 'null' : String(input)
}

function truncate(input, maxLength) {
  const text = String(input || '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

main()
