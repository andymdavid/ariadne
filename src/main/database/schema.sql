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
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE CASCADE
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
CREATE INDEX IF NOT EXISTS idx_content_packages_clip_id ON content_packages (clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_titles_clip_id ON clip_titles (clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_descriptions_clip_id ON clip_descriptions (clip_id);
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
CREATE INDEX IF NOT EXISTS idx_failure_events_job ON failure_events (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failure_events_step ON failure_events (step_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failure_events_scope ON failure_events (scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_events_job ON workflow_events (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_events_step ON workflow_events (step_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_events_scope ON workflow_events (scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exports_clip_id ON exports (clip_id);
CREATE INDEX IF NOT EXISTS idx_exports_export_job ON exports (export_job_id, clip_id);
CREATE INDEX IF NOT EXISTS idx_exports_artifact ON exports (artifact_id);
CREATE INDEX IF NOT EXISTS idx_exports_status ON exports (status, created_at DESC);
