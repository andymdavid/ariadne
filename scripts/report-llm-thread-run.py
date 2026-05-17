#!/usr/bin/env python3

import argparse
import json
import sqlite3
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='Report persisted llm_thread_v1 selector output from an Ariadne SQLite DB.')
    parser.add_argument('--db', required=True)
    parser.add_argument('--selection-run')
    parser.add_argument('--job')
    parser.add_argument('--episode')
    parser.add_argument('--latest', action='store_true')
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    selection_run = resolve_selection_run(conn, args)
    if selection_run:
        report_selection_run(conn, selection_run)
        return

    workflow_job, clip_ranking = resolve_workflow_clip_ranking(conn, args)
    if not workflow_job or not clip_ranking:
        raise SystemExit('No matching llm_thread_v1 selection run or clip_ranking step output found.')
    report_clip_ranking_step(workflow_job, clip_ranking)


def resolve_selection_run(conn, args):
    if args.selection_run:
        return conn.execute('SELECT * FROM pipeline_selection_runs WHERE id = ? LIMIT 1', (args.selection_run,)).fetchone()
    if args.job:
        return conn.execute(
            '''
            SELECT * FROM pipeline_selection_runs
            WHERE workflow_job_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            ''',
            (args.job,),
        ).fetchone()
    if args.episode:
        return conn.execute(
            '''
            SELECT * FROM pipeline_selection_runs
            WHERE episode_id = ? AND production_mode = 'llm_thread_v1'
            ORDER BY created_at DESC
            LIMIT 1
            ''',
            (args.episode,),
        ).fetchone()
    return conn.execute(
        '''
        SELECT * FROM pipeline_selection_runs
        WHERE production_mode = 'llm_thread_v1'
        ORDER BY created_at DESC
        LIMIT 1
        '''
    ).fetchone()


def resolve_workflow_clip_ranking(conn, args):
    if args.job:
        job = conn.execute('SELECT * FROM workflow_jobs WHERE id = ? LIMIT 1', (args.job,)).fetchone()
    elif args.episode:
        job = conn.execute(
            '''
            SELECT * FROM workflow_jobs
            WHERE episode_id = ? OR input_json LIKE ?
            ORDER BY created_at DESC
            LIMIT 1
            ''',
            (args.episode, f'%{args.episode}%'),
        ).fetchone()
    else:
        job = conn.execute(
            '''
            SELECT *
            FROM workflow_jobs
            WHERE job_type = 'pipeline'
            ORDER BY created_at DESC
            LIMIT 1
            '''
        ).fetchone()

    if not job:
        return None, None

    step = conn.execute(
        '''
        SELECT *
        FROM workflow_step_runs
        WHERE job_id = ? AND step_key = 'clip_ranking'
        ORDER BY updated_at DESC
        LIMIT 1
        ''',
        (job['id'],),
    ).fetchone()

    if step:
        return job, step

    completed_job = conn.execute(
        '''
        SELECT w.*
        FROM workflow_jobs w
        JOIN workflow_step_runs s ON s.job_id = w.id
        WHERE w.job_type = 'pipeline'
          AND s.step_key = 'clip_ranking'
          AND s.output_json IS NOT NULL
          AND s.output_json != ''
        ORDER BY w.created_at DESC
        LIMIT 1
        '''
    ).fetchone()
    if not completed_job:
        return job, None
    step = conn.execute(
        '''
        SELECT *
        FROM workflow_step_runs
        WHERE job_id = ? AND step_key = 'clip_ranking'
        ORDER BY updated_at DESC
        LIMIT 1
        ''',
        (completed_job['id'],),
    ).fetchone()
    return completed_job, step


def report_selection_run(conn, run):
    decisions = conn.execute(
        '''
        SELECT *
        FROM selection_decisions
        WHERE selection_run_id = ?
        ORDER BY rank_order ASC, created_at ASC
        ''',
        (run['id'],),
    ).fetchall()
    clips = conn.execute(
        '''
        SELECT *
        FROM clips
        WHERE selection_run_id = ? AND is_active = 1
        ORDER BY start_time ASC
        ''',
        (run['id'],),
    ).fetchall()
    summary = safe_json(run['summary_json'], {})
    metadata = summary.get('metadata') or summary.get('selectionMetadata') or summary
    clip_ranking_step = conn.execute(
        '''
        SELECT *
        FROM workflow_step_runs
        WHERE job_id = ? AND step_key = 'clip_ranking'
        ORDER BY updated_at DESC
        LIMIT 1
        ''',
        (run['workflow_job_id'],),
    ).fetchone()
    if clip_ranking_step:
        step_output = safe_json(clip_ranking_step['output_json'], {})
        step_metadata = step_output.get('metadata') or {}
        if step_metadata:
            metadata = {**metadata, **step_metadata}
    print_header('LLM Thread Selection Run Report')
    print(f'Selection run: {run["id"]}')
    print(f'Workflow job:  {run["workflow_job_id"]}')
    print(f'Episode:       {run["episode_id"]}')
    print(f'Mode:          {run["production_mode"]}')
    print(f'Status:        {run["status"]}')
    print(f'Created:       {run["created_at"]}')
    print(f'Completed:     {run["completed_at"]}')
    if clip_ranking_step:
        print(f'Clip ranking step: {clip_ranking_step["status"]} updated {clip_ranking_step["updated_at"]}')
    print('')
    print_summary(metadata, len(decisions), len(clips))
    print_discovery(metadata)
    print_decisions([row_to_camel(decision) for decision in decisions])


def report_clip_ranking_step(job, step):
    output = safe_json(step['output_json'], {})
    metadata = output.get('metadata') or {}
    decisions = output.get('selectionDecisions') or []
    clips = output.get('analysis', {}).get('potentialClips') or []
    print_header('LLM Thread Clip Ranking Step Report')
    print(f'Workflow job: {job["id"]}')
    print(f'Job status:   {job["status"]}')
    print(f'Created:      {job["created_at"]}')
    print(f'Completed:    {job["completed_at"]}')
    print(f'Step status:  {step["status"]}')
    print(f'Step updated: {step["updated_at"]}')
    print(f'Mode:         {output.get("mode")}')
    print('')
    print_summary(metadata, len(decisions), len(clips))
    print_discovery(metadata)
    print_decisions(decisions)


def print_header(title):
    print(title)
    print('=' * len(title))


def print_summary(metadata, decision_count, clip_count):
    print('Top-level metrics:')
    fields = [
        ('decisions', decision_count),
        ('clips persisted/output', clip_count),
        ('zeroOutputStage', metadata.get('zeroOutputStage')),
        ('threadCandidatesDiscovered', metadata.get('threadCandidatesDiscovered')),
        ('threadCandidatesAccepted', metadata.get('threadCandidatesAccepted')),
        ('threadCandidatesRepaired', metadata.get('threadCandidatesRepaired')),
        ('threadCandidatesRejected', metadata.get('threadCandidatesRejected')),
        ('llmDiscoveryError', metadata.get('llmDiscoveryError')),
        ('llmRepairError', metadata.get('llmRepairError')),
        ('llmCoherenceReviewError', metadata.get('llmCoherenceReviewError')),
        ('repairAttemptsExhausted', metadata.get('llmRepairAttemptsExhausted')),
        ('coherenceReviewsAttempted', metadata.get('coherenceReviewsAttempted')),
        ('coherenceReviewsAccepted', metadata.get('coherenceReviewsAccepted')),
        ('mechanicalVariantsGenerated', metadata.get('mechanicalVariantsGenerated')),
    ]
    for label, value in fields:
        print(f'- {label}: {format_value(value)}')
    print('')


def print_discovery(metadata):
    diagnostics = metadata.get('discoveryDiagnostics') or []
    if not diagnostics:
        return
    print('Discovery diagnostics:')
    for item in diagnostics:
        print(
            f'- {item.get("chunkId")}: raw={item.get("rawCandidateCount")} '
            f'valid={item.get("validCandidateCount")} invalid={item.get("invalidCandidateCount")}'
        )
        invalid = item.get('invalidReasons') or []
        if invalid:
            print(f'  invalidReasons: {"; ".join(map(str, invalid))}')
        if item.get('responsePreview'):
            print(f'  preview: {truncate(item["responsePreview"], 220)}')
    print('')


def print_decisions(decisions):
    print('Decision table:')
    if not decisions:
        print('- no selection decisions found')
        print('')
        return

    for decision in decisions:
        detail = get_validator_detail(decision)
        candidate = detail.get('candidate') or {}
        verification = detail.get('verification') or {}
        review = detail.get('coherenceReview')
        final_range = detail.get('finalLineRange') or {}
        range_label = f'{final_range.get("startLineIndex", candidate.get("startLineIndex", "?"))}-{final_range.get("endLineIndex", candidate.get("endLineIndex", "?"))}'
        review_label = 'not_run'
        if review:
            review_label = f'{review.get("status")}:{review.get("confidence")}'
        print(
            f'- #{decision.get("rankOrder") or "?"} {decision.get("decision")} '
            f'{candidate.get("id") or decision.get("id")} "{candidate.get("title", "")}" '
            f'range={range_label} status={verification.get("status")} '
            f'issues={"|".join(verification.get("issues") or []) or "none"} coherence={review_label}'
        )

    print('')
    print('Decision details:')
    for decision in decisions:
        detail = get_validator_detail(decision)
        candidate = detail.get('candidate') or {}
        verification = detail.get('verification') or {}
        print(f'\n#{decision.get("rankOrder") or "?"} {candidate.get("id") or decision.get("id")}: {candidate.get("title", "untitled")}')
        print(f'decision={decision.get("decision")} rejectionCode={format_value(decision.get("rejectionCode"))} finalScore={format_value(decision.get("finalScore"))}')
        print(f'originalRange={format_range(detail.get("originalLineRange"))} finalRange={format_range(detail.get("finalLineRange"))}')
        print(f'verification={verification.get("status")} duration={format_value(verification.get("duration"))} issues={", ".join(verification.get("issues") or []) or "none"}')
        print(f'repairAttempts={format_value(detail.get("repairAttempts"))} repairError={format_value(detail.get("repairError"))}')
        print(f'deterministicRepairApplied={format_value(detail.get("deterministicRepairApplied"))} deterministicRepairFailureCode={format_value(detail.get("deterministicRepairFailureCode"))}')
        if detail.get('deterministicRepairReason'):
            print(f'deterministicRepairReason={truncate(detail["deterministicRepairReason"], 300)}')
        if detail.get('coherenceReview'):
            review = detail['coherenceReview']
            print(f'coherenceReview={review.get("status")} confidence={review.get("confidence")}')
            print(f'coherenceReason={truncate(review.get("reason"), 420)}')
            if review.get('fatalIssues'):
                print(f'coherenceFatalIssues={", ".join(review["fatalIssues"])}')
        if detail.get('coherenceReviewError'):
            print(f'coherenceReviewError={truncate(detail["coherenceReviewError"], 420)}')
    print('')


def get_validator_detail(decision):
    raw = decision.get('validatorResultJson') or decision.get('validator_result_json') or '{}'
    if isinstance(raw, dict):
        return raw
    return safe_json(raw, {})


def row_to_camel(row):
    return {
        'id': row['id'],
        'selectionRunId': row['selection_run_id'],
        'candidateArcId': row['candidate_arc_id'],
        'decision': row['decision'],
        'rankOrder': row['rank_order'],
        'modelScore': row['model_score'],
        'finalScore': row['final_score'],
        'rejectionCode': row['rejection_code'],
        'reason': row['reason'],
        'validatorResultJson': row['validator_result_json'],
        'createdAt': row['created_at'],
    }


def safe_json(raw, fallback):
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def format_value(value):
    if value is None or value == '':
        return 'null'
    return str(value)


def format_range(value):
    value = value or {}
    return f'{value.get("startLineIndex", "?")}-{value.get("endLineIndex", "?")}'


def truncate(value, max_length):
    text = ' '.join(str(value or '').split())
    return text if len(text) <= max_length else text[:max_length] + '...'


if __name__ == '__main__':
    main()
