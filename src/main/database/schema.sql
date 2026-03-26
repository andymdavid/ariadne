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

-- Exports table
CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    format TEXT NOT NULL,
    resolution TEXT NOT NULL,
    metadata TEXT NOT NULL, -- JSON object with export settings
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
CREATE INDEX IF NOT EXISTS idx_exports_clip_id ON exports (clip_id);
