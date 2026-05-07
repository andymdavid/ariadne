-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Episodes table
CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    duration REAL NOT NULL DEFAULT 0,
    frame_rate REAL,
    processing_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

-- Transcript segments table
CREATE TABLE IF NOT EXISTS transcript_segments (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    text TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    speaker TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_transcripts (
    media_fingerprint TEXT PRIMARY KEY,
    fingerprint_version TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT,
    file_size INTEGER NOT NULL,
    file_mtime_ms INTEGER NOT NULL,
    duration REAL NOT NULL,
    frame_rate REAL,
    resolution_width INTEGER,
    resolution_height INTEGER,
    language TEXT,
    transcription_json TEXT NOT NULL,
    transcript_lines_json TEXT NOT NULL DEFAULT '[]',
    transcription_model TEXT,
    source_strategy TEXT NOT NULL DEFAULT 'local_whisper_service_v1',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_transcripts_updated_at
ON media_transcripts (updated_at DESC);

-- Clips table
CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    duration REAL NOT NULL,
    content_type TEXT NOT NULL,
    shareability_score REAL NOT NULL DEFAULT 0,
    key_quote TEXT NOT NULL,
    reason TEXT NOT NULL,
    context_needed TEXT NOT NULL DEFAULT 'low',
    video_width INTEGER,
    video_height INTEGER,
    workflow_job_id TEXT,
    selection_run_id TEXT,
    source_arc_id TEXT,
    selection_source TEXT,
    selection_confidence REAL,
    approval_source TEXT,
    replaced_by_clip_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    provenance_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_job_id) REFERENCES workflow_jobs (id) ON DELETE SET NULL,
    FOREIGN KEY (selection_run_id) REFERENCES pipeline_selection_runs (id) ON DELETE SET NULL,
    FOREIGN KEY (source_arc_id) REFERENCES candidate_arcs (id) ON DELETE SET NULL,
    FOREIGN KEY (replaced_by_clip_id) REFERENCES clips (id) ON DELETE SET NULL
);

-- Content packages table
CREATE TABLE IF NOT EXISTS content_packages (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL,
    titles TEXT NOT NULL, -- JSON array of title options
    description TEXT NOT NULL,
    thumbnail_timestamp REAL,
    metadata TEXT NOT NULL, -- JSON object with additional metadata
    created_at TEXT NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clip_titles (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL,
    title TEXT NOT NULL,
    is_selected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clip_descriptions (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL,
    description TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'general',
    is_selected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clip_metadata_analysis (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL UNIQUE,
    primary_topic TEXT NOT NULL,
    core_claim TEXT NOT NULL,
    supporting_points_json TEXT NOT NULL DEFAULT '[]',
    audience_angle TEXT NOT NULL,
    why_it_matters TEXT NOT NULL,
    tone TEXT NOT NULL,
    key_entities_json TEXT NOT NULL DEFAULT '[]',
    risk_flags_json TEXT NOT NULL DEFAULT '[]',
    source_excerpt_refs_json TEXT NOT NULL DEFAULT '[]',
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    raw_response_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clip_thumbnails (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    timestamp REAL NOT NULL,
    is_selected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clip_trim_state (
    clip_id TEXT PRIMARY KEY,
    in_point REAL NOT NULL,
    out_point REAL NOT NULL,
    in_anchor_type TEXT,
    in_anchor_source_id TEXT,
    in_anchor_label TEXT,
    in_anchor_confidence REAL,
    out_anchor_type TEXT,
    out_anchor_source_id TEXT,
    out_anchor_label TEXT,
    out_anchor_confidence REAL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    worker_kind TEXT NOT NULL,
    project_id TEXT,
    episode_id TEXT,
    clip_id TEXT,
    parent_job_id TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    stage TEXT,
    message TEXT,
    input_json TEXT NOT NULL,
    config_snapshot_json TEXT,
    lease_owner TEXT,
    lease_expires_at TEXT,
    heartbeat_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 1,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE SET NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE SET NULL,
    FOREIGN KEY (parent_job_id) REFERENCES workflow_jobs (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_step_runs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    step_key TEXT NOT NULL,
    status TEXT NOT NULL,
    step_order INTEGER NOT NULL DEFAULT 0,
    clip_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 1,
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    input_json TEXT,
    output_json TEXT,
    error_code TEXT,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES workflow_jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    artifact_type TEXT NOT NULL,
    status TEXT NOT NULL,
    project_id TEXT,
    episode_id TEXT,
    clip_id TEXT,
    workflow_job_id TEXT,
    file_path TEXT NOT NULL,
    temp_file_path TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    checksum TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE SET NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE SET NULL,
    FOREIGN KEY (workflow_job_id) REFERENCES workflow_jobs (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    workflow_job_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    status TEXT NOT NULL,
    output_directory TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,
    include_captions INTEGER NOT NULL DEFAULT 1,
    current_clip_index INTEGER NOT NULL DEFAULT 0,
    total_clips INTEGER NOT NULL DEFAULT 0,
    progress INTEGER NOT NULL DEFAULT 0,
    clip_ids_json TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workflow_job_id) REFERENCES workflow_jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS publishing_accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    channel_handle TEXT,
    timezone TEXT NOT NULL,
    auth_status TEXT NOT NULL,
    access_token_ref TEXT,
    refresh_token_ref TEXT,
    token_expires_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posting_plans (
    id TEXT PRIMARY KEY,
    publishing_account_id TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 1,
    posts_per_day INTEGER NOT NULL,
    active_days_json TEXT NOT NULL,
    primary_timezone TEXT NOT NULL,
    target_regions_json TEXT NOT NULL,
    publishing_window_start TEXT NOT NULL,
    publishing_window_end TEXT NOT NULL,
    slot_strategy TEXT NOT NULL,
    recycling_enabled INTEGER NOT NULL DEFAULT 0,
    minimum_recycle_gap_days INTEGER NOT NULL DEFAULT 30,
    max_recycles_per_clip INTEGER NOT NULL DEFAULT 3,
    fresh_inventory_threshold INTEGER NOT NULL DEFAULT 10,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (publishing_account_id) REFERENCES publishing_accounts (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_slots (
    id TEXT PRIMARY KEY,
    posting_plan_id TEXT NOT NULL,
    scheduled_for_utc TEXT NOT NULL,
    scheduled_timezone TEXT NOT NULL,
    slot_label TEXT NOT NULL,
    slot_region TEXT,
    status TEXT NOT NULL,
    scheduled_publication_id TEXT,
    blocked_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (posting_plan_id) REFERENCES posting_plans (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scheduled_publications (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL,
    publishing_account_id TEXT NOT NULL,
    calendar_slot_id TEXT,
    export_artifact_id TEXT,
    content_package_id TEXT,
    selected_title_id TEXT,
    selected_description_id TEXT,
    selected_thumbnail_id TEXT,
    platform TEXT NOT NULL,
    scheduled_for_utc TEXT NOT NULL,
    scheduled_timezone TEXT NOT NULL,
    status TEXT NOT NULL,
    is_recycled INTEGER NOT NULL DEFAULT 0,
    source_publication_id TEXT,
    youtube_video_id TEXT,
    youtube_video_url TEXT,
    youtube_upload_status TEXT,
    platform_confirmed_publish_at_utc TEXT,
    last_error_code TEXT,
    last_error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE,
    FOREIGN KEY (publishing_account_id) REFERENCES publishing_accounts (id) ON DELETE CASCADE,
    FOREIGN KEY (calendar_slot_id) REFERENCES calendar_slots (id) ON DELETE SET NULL,
    FOREIGN KEY (export_artifact_id) REFERENCES artifacts (id) ON DELETE SET NULL,
    FOREIGN KEY (content_package_id) REFERENCES content_packages (id) ON DELETE SET NULL,
    FOREIGN KEY (selected_title_id) REFERENCES clip_titles (id) ON DELETE SET NULL,
    FOREIGN KEY (selected_description_id) REFERENCES clip_descriptions (id) ON DELETE SET NULL,
    FOREIGN KEY (selected_thumbnail_id) REFERENCES clip_thumbnails (id) ON DELETE SET NULL,
    FOREIGN KEY (source_publication_id) REFERENCES scheduled_publications (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS publication_history (
    id TEXT PRIMARY KEY,
    scheduled_publication_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (scheduled_publication_id) REFERENCES scheduled_publications (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clip_publish_preferences (
    clip_id TEXT PRIMARY KEY,
    recycle_enabled INTEGER NOT NULL DEFAULT 1,
    priority_score REAL NOT NULL DEFAULT 0,
    exclude_until_utc TEXT,
    last_published_at TEXT,
    last_recycled_at TEXT,
    recycle_count INTEGER NOT NULL DEFAULT 0,
    performance_score REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generated_video_assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    style_prompt TEXT,
    negative_prompt TEXT,
    reference_image_path TEXT,
    source_job_id TEXT,
    file_path TEXT,
    thumbnail_path TEXT,
    duration_seconds REAL,
    aspect_ratio TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generated_video_jobs (
    id TEXT PRIMARY KEY,
    asset_id TEXT,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    style_prompt TEXT,
    negative_prompt TEXT,
    reference_image_path TEXT,
    aspect_ratio TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    input_json TEXT NOT NULL DEFAULT '{}',
    output_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (asset_id) REFERENCES generated_video_assets (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS clip_visual_sources (
    clip_id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    generated_video_asset_id TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE,
    FOREIGN KEY (generated_video_asset_id) REFERENCES generated_video_assets (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS failure_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    step_run_id TEXT,
    scope TEXT NOT NULL,
    error_code TEXT NOT NULL,
    message TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES workflow_jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (step_run_id) REFERENCES workflow_step_runs (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    step_run_id TEXT,
    scope TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES workflow_jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (step_run_id) REFERENCES workflow_step_runs (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pipeline_run_evaluations (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL,
    baseline_job_id TEXT NOT NULL,
    candidate_job_id TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE CASCADE,
    FOREIGN KEY (baseline_job_id) REFERENCES workflow_jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_job_id) REFERENCES workflow_jobs (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pipeline_selection_runs (
    id TEXT PRIMARY KEY,
    workflow_job_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    selector_version TEXT NOT NULL,
    status TEXT NOT NULL,
    production_mode TEXT NOT NULL,
    summary_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (workflow_job_id) REFERENCES workflow_jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS editorial_units (
    id TEXT PRIMARY KEY,
    selection_run_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    start_word_index INTEGER,
    end_word_index INTEGER,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    text TEXT NOT NULL,
    role TEXT,
    starts_cleanly INTEGER NOT NULL DEFAULT 0,
    ends_cleanly INTEGER NOT NULL DEFAULT 0,
    continues_previous INTEGER NOT NULL DEFAULT 0,
    continues_next INTEGER NOT NULL DEFAULT 0,
    pause_before_seconds REAL,
    pause_after_seconds REAL,
    speech_rate REAL,
    confidence REAL,
    source TEXT,
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (selection_run_id) REFERENCES pipeline_selection_runs (id) ON DELETE CASCADE,
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS candidate_arcs (
    id TEXT PRIMARY KEY,
    selection_run_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    start_word_index INTEGER,
    end_word_index INTEGER,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    duration REAL NOT NULL,
    unit_ids_json TEXT NOT NULL DEFAULT '[]',
    topic TEXT,
    summary TEXT,
    hook_text TEXT,
    payoff_text TEXT,
    key_quote TEXT,
    scores_json TEXT NOT NULL DEFAULT '{}',
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (selection_run_id) REFERENCES pipeline_selection_runs (id) ON DELETE CASCADE,
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS selection_decisions (
    id TEXT PRIMARY KEY,
    selection_run_id TEXT NOT NULL,
    candidate_arc_id TEXT,
    decision TEXT NOT NULL,
    rank_order INTEGER,
    model_score REAL,
    final_score REAL,
    rejection_code TEXT,
    reason TEXT,
    validator_result_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (selection_run_id) REFERENCES pipeline_selection_runs (id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_arc_id) REFERENCES candidate_arcs (id) ON DELETE SET NULL
);

-- Exports table
CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL,
    export_job_id TEXT,
    artifact_id TEXT,
    file_path TEXT NOT NULL,
    format TEXT NOT NULL,
    resolution TEXT NOT NULL,
    metadata TEXT NOT NULL, -- JSON object with export settings
    status TEXT NOT NULL DEFAULT 'completed',
    error_message TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
);

-- Settings table for app configuration
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_episodes_project_id ON episodes (project_id);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_episode_id ON transcript_segments (episode_id);
CREATE INDEX IF NOT EXISTS idx_clips_episode_id ON clips (episode_id);
CREATE INDEX IF NOT EXISTS idx_clips_status ON clips (status);
CREATE INDEX IF NOT EXISTS idx_clips_selection_run ON clips (selection_run_id, is_active);
CREATE INDEX IF NOT EXISTS idx_clips_workflow_job ON clips (workflow_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_source_arc ON clips (source_arc_id);
CREATE INDEX IF NOT EXISTS idx_content_packages_clip_id ON content_packages (clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_titles_clip_id ON clip_titles (clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_descriptions_clip_id ON clip_descriptions (clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_metadata_analysis_clip_id ON clip_metadata_analysis (clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_thumbnails_clip_id ON clip_thumbnails (clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_trim_state_updated_at ON clip_trim_state (updated_at);
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_type_status ON workflow_jobs (job_type, status);
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_episode ON workflow_jobs (episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_lease ON workflow_jobs (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_job ON workflow_step_runs (job_id, step_order);
CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_job_status ON workflow_step_runs (job_id, status);
CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts (workflow_job_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_clip ON artifacts (clip_id, artifact_type, status);
CREATE INDEX IF NOT EXISTS idx_artifacts_path ON artifacts (file_path);
CREATE INDEX IF NOT EXISTS idx_export_jobs_episode ON export_jobs (episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_publishing_accounts_platform ON publishing_accounts (platform, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_posting_plans_account_default ON posting_plans (publishing_account_id, is_default, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_slots_plan_time ON calendar_slots (posting_plan_id, scheduled_for_utc ASC);
CREATE INDEX IF NOT EXISTS idx_calendar_slots_status ON calendar_slots (status, scheduled_for_utc ASC);
CREATE INDEX IF NOT EXISTS idx_scheduled_publications_clip ON scheduled_publications (clip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_publications_account_time ON scheduled_publications (publishing_account_id, scheduled_for_utc ASC);
CREATE INDEX IF NOT EXISTS idx_scheduled_publications_status ON scheduled_publications (status, scheduled_for_utc ASC);
CREATE INDEX IF NOT EXISTS idx_publication_history_publication ON publication_history (scheduled_publication_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_video_assets_status ON generated_video_assets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_video_assets_model ON generated_video_assets (model_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_video_jobs_asset ON generated_video_jobs (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_video_jobs_status ON generated_video_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clip_visual_sources_asset ON clip_visual_sources (generated_video_asset_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_failure_events_job ON failure_events (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failure_events_step ON failure_events (step_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failure_events_scope ON failure_events (scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_events_job ON workflow_events (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_events_step ON workflow_events (step_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_events_scope ON workflow_events (scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_evaluations_episode ON pipeline_run_evaluations (episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_evaluations_baseline ON pipeline_run_evaluations (baseline_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_evaluations_candidate ON pipeline_run_evaluations (candidate_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_selection_runs_episode ON pipeline_selection_runs (episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_selection_runs_workflow_job ON pipeline_selection_runs (workflow_job_id);
CREATE INDEX IF NOT EXISTS idx_editorial_units_run ON editorial_units (selection_run_id, start_time ASC);
CREATE INDEX IF NOT EXISTS idx_editorial_units_episode ON editorial_units (episode_id, start_time ASC);
CREATE INDEX IF NOT EXISTS idx_candidate_arcs_run ON candidate_arcs (selection_run_id, start_time ASC);
CREATE INDEX IF NOT EXISTS idx_candidate_arcs_episode ON candidate_arcs (episode_id, start_time ASC);
CREATE INDEX IF NOT EXISTS idx_selection_decisions_run ON selection_decisions (selection_run_id, rank_order ASC);
CREATE INDEX IF NOT EXISTS idx_selection_decisions_arc ON selection_decisions (candidate_arc_id);
CREATE INDEX IF NOT EXISTS idx_exports_clip_id ON exports (clip_id);
CREATE INDEX IF NOT EXISTS idx_exports_export_job ON exports (export_job_id, clip_id);
CREATE INDEX IF NOT EXISTS idx_exports_artifact ON exports (artifact_id);
CREATE INDEX IF NOT EXISTS idx_exports_status ON exports (status, created_at DESC);
