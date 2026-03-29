import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync, mkdirSync, statSync } from 'fs'
import type { ClipTrimState, TrimBoundaryAnchor } from '@shared/types'

type WorkflowJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'pending_resume'

type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

type ArtifactStatus =
  | 'pending'
  | 'writing'
  | 'complete'
  | 'invalid'
  | 'deleted'

type ExportJobStatus = WorkflowJobStatus

type ExportOutputStatus =
  | 'pending'
  | 'rendering'
  | 'completed'
  | 'failed'
  | 'cancelled'

interface WorkflowJobRecord {
  id: string
  jobType: string
  status: WorkflowJobStatus
  workerKind: string
  projectId: string | null
  episodeId: string | null
  clipId: string | null
  parentJobId: string | null
  progress: number
  stage: string | null
  message: string | null
  inputJson: string
  configSnapshotJson: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  heartbeatAt: string | null
  attemptCount: number
  maxAttempts: number
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

interface WorkflowStepRunRecord {
  id: string
  jobId: string
  stepKey: string
  status: WorkflowStepStatus
  stepOrder: number
  clipId: string | null
  attempt: number
  progress: number
  message: string | null
  inputJson: string | null
  outputJson: string | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

interface ArtifactRecord {
  id: string
  artifactType: string
  status: ArtifactStatus
  projectId: string | null
  episodeId: string | null
  clipId: string | null
  workflowJobId: string | null
  filePath: string
  tempFilePath: string | null
  mimeType: string | null
  sizeBytes: number | null
  checksum: string | null
  metadataJson: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

interface ExportJobRecord {
  id: string
  workflowJobId: string
  episodeId: string
  status: ExportJobStatus
  outputDirectory: string
  aspectRatio: string
  includeCaptions: boolean
  currentClipIndex: number
  totalClips: number
  progress: number
  clipIdsJson: string
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

interface ExportOutputRecord {
  id: string
  exportJobId: string | null
  clipId: string
  artifactId: string | null
  filePath: string
  format: string
  resolution: string
  metadata: string
  status: ExportOutputStatus
  errorMessage: string | null
  createdAt: string
}

class DatabaseManager {
  private db: Database.Database
  
  constructor() {
    const dbPath = join(app.getPath('userData'), 'ariadne.db')
    this.db = new Database(dbPath, { verbose: console.log })

    // Apply schema if database is new
    const userVersion = this.db.pragma('user_version') as number
    if (userVersion === 0) {
      const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
      this.db.exec(schema)
      this.db.pragma('user_version = 1') // Set initial version
    }

    // New: Run migrations for existing databases
    this.migrateSchema();
  }

  private hasColumn(tableName: string, columnName: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
    return columns.some((column) => column.name === columnName)
  }

  private addColumnIfMissing(tableName: string, columnName: string, columnDefinition: string) {
    if (this.hasColumn(tableName, columnName)) {
      return
    }

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`)
  }

  private mapWorkflowJob(row: any): WorkflowJobRecord {
    return {
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      workerKind: row.worker_kind,
      projectId: row.project_id ?? null,
      episodeId: row.episode_id ?? null,
      clipId: row.clip_id ?? null,
      parentJobId: row.parent_job_id ?? null,
      progress: row.progress,
      stage: row.stage ?? null,
      message: row.message ?? null,
      inputJson: row.input_json,
      configSnapshotJson: row.config_snapshot_json ?? null,
      leaseOwner: row.lease_owner ?? null,
      leaseExpiresAt: row.lease_expires_at ?? null,
      heartbeatAt: row.heartbeat_at ?? null,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      startedAt: row.started_at ?? null,
      completedAt: row.completed_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapWorkflowStepRun(row: any): WorkflowStepRunRecord {
    return {
      id: row.id,
      jobId: row.job_id,
      stepKey: row.step_key,
      status: row.status,
      stepOrder: row.step_order,
      clipId: row.clip_id ?? null,
      attempt: row.attempt,
      progress: row.progress,
      message: row.message ?? null,
      inputJson: row.input_json ?? null,
      outputJson: row.output_json ?? null,
      errorCode: row.error_code ?? null,
      errorMessage: row.error_message ?? null,
      startedAt: row.started_at ?? null,
      completedAt: row.completed_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private mapArtifact(row: any): ArtifactRecord {
    return {
      id: row.id,
      artifactType: row.artifact_type,
      status: row.status,
      projectId: row.project_id ?? null,
      episodeId: row.episode_id ?? null,
      clipId: row.clip_id ?? null,
      workflowJobId: row.workflow_job_id ?? null,
      filePath: row.file_path,
      tempFilePath: row.temp_file_path ?? null,
      mimeType: row.mime_type ?? null,
      sizeBytes: row.size_bytes ?? null,
      checksum: row.checksum ?? null,
      metadataJson: row.metadata_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? null
    }
  }

  private mapExportJob(row: any): ExportJobRecord {
    return {
      id: row.id,
      workflowJobId: row.workflow_job_id,
      episodeId: row.episode_id,
      status: row.status,
      outputDirectory: row.output_directory,
      aspectRatio: row.aspect_ratio,
      includeCaptions: row.include_captions === 1,
      currentClipIndex: row.current_clip_index,
      totalClips: row.total_clips,
      progress: row.progress,
      clipIdsJson: row.clip_ids_json,
      errorMessage: row.error_message ?? null,
      createdAt: row.created_at,
      startedAt: row.started_at ?? null,
      completedAt: row.completed_at ?? null,
      updatedAt: row.updated_at
    }
  }

  private mapExportOutput(row: any): ExportOutputRecord {
    return {
      id: row.id,
      exportJobId: row.export_job_id ?? null,
      clipId: row.clip_id,
      artifactId: row.artifact_id ?? null,
      filePath: row.file_path,
      format: row.format,
      resolution: row.resolution,
      metadata: row.metadata,
      status: row.status,
      errorMessage: row.error_message ?? null,
      createdAt: row.created_at
    }
  }

  private migrateSchema() {
    // Version 1: Add any new tables (example for content_packages, exports, etc.)
    const migrations = [
      `CREATE TABLE IF NOT EXISTS content_packages (
        id TEXT PRIMARY KEY,
        clip_id TEXT NOT NULL,
        titles TEXT NOT NULL,
        description TEXT NOT NULL,
        thumbnail_timestamp REAL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS exports (
        id TEXT PRIMARY KEY,
        clip_id TEXT NOT NULL,
        export_job_id TEXT,
        artifact_id TEXT,
        file_path TEXT NOT NULL,
        format TEXT NOT NULL,
        resolution TEXT NOT NULL,
        metadata TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS workflow_jobs (
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
      );`,
      `CREATE TABLE IF NOT EXISTS workflow_step_runs (
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
      );`,
      `CREATE TABLE IF NOT EXISTS artifacts (
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
      );`,
      `CREATE TABLE IF NOT EXISTS export_jobs (
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
      );`,
      `CREATE TABLE IF NOT EXISTS clip_titles (
        id TEXT PRIMARY KEY,
        clip_id TEXT NOT NULL,
        title TEXT NOT NULL,
        is_selected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS clip_descriptions (
        id TEXT PRIMARY KEY,
        clip_id TEXT NOT NULL,
        description TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'general',
        is_selected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS clip_thumbnails (
        id TEXT PRIMARY KEY,
        clip_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        timestamp REAL NOT NULL,
        is_selected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS clip_trim_state (
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
      );`,
      `CREATE TABLE IF NOT EXISTS clip_edits (
        clip_id TEXT PRIMARY KEY,

        captions_enabled INTEGER DEFAULT 1,
        caption_segments TEXT,
        caption_font TEXT DEFAULT 'Inter',
        caption_size INTEGER DEFAULT 48,
        caption_color TEXT DEFAULT '#FFFFFF',
        caption_position TEXT DEFAULT 'center',
        caption_bold INTEGER DEFAULT 1,
        caption_italic INTEGER DEFAULT 0,
        caption_outline INTEGER DEFAULT 0,
        caption_outline_color TEXT DEFAULT '#000000',
        caption_outline_width INTEGER DEFAULT 2,
        caption_shadow INTEGER DEFAULT 0,
        caption_highlight_style TEXT DEFAULT 'word',
        caption_background INTEGER DEFAULT 0,
        caption_background_color TEXT DEFAULT '#000000',
        caption_background_opacity REAL DEFAULT 0.5,

        logo_enabled INTEGER DEFAULT 0,
        logo_path TEXT,
        logo_position TEXT DEFAULT 'bottom-right',
        logo_scale REAL DEFAULT 0.15,
        logo_opacity REAL DEFAULT 0.8,

        music_enabled INTEGER DEFAULT 0,
        music_path TEXT,
        music_volume REAL DEFAULT 0.3,
        music_duck_volume REAL DEFAULT 0.1,
        music_fade_in REAL DEFAULT 1.0,
        music_fade_out REAL DEFAULT 1.0,

        aspect_ratio TEXT DEFAULT '9:16',
        crop_mode TEXT DEFAULT 'center',
        crop_position_x REAL DEFAULT 50,
        crop_position_y REAL DEFAULT 50,
        zoom_level REAL DEFAULT 1.0,
        video_offset_x REAL DEFAULT 0,
        video_offset_y REAL DEFAULT 0,

        updated_at TEXT NOT NULL,

        FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
      );`,
      // Add more migrations as needed for future versions
    ];

    migrations.forEach(sql => {
      try {
        this.db.exec(sql);
      } catch (error) {
        console.error('Migration failed:', error);
      }
    });

    // Get version BEFORE setting it to 3
    const preVersion = this.db.pragma('user_version', { simple: true }) as number
    console.log('Current database version:', preVersion)

    if (preVersion < 3) {
      this.db.pragma('user_version = 3');
    }

    // Add custom position fields to clip_edits if we're upgrading from v3 or below (v4)
    if (preVersion <= 3) {
      try {
        this.db.exec(`
          ALTER TABLE clip_edits ADD COLUMN caption_custom_x REAL;
          ALTER TABLE clip_edits ADD COLUMN caption_custom_y REAL;
        `);
        console.log('✅ Added caption custom position columns (v4)');
        this.db.pragma('user_version = 4');
      } catch (error) {
        // Columns might already exist
        console.log('Caption custom position columns migration skipped (may already exist)');
        this.db.pragma('user_version = 4');
      }
    }

    // Add logo position fields to clip_edits if we're upgrading from v4 or below (v5)
    if (preVersion <= 4) {
      try {
        this.db.exec(`
          ALTER TABLE clip_edits ADD COLUMN logo_position_x REAL DEFAULT 85;
          ALTER TABLE clip_edits ADD COLUMN logo_position_y REAL DEFAULT 85;
        `);
        console.log('✅ Added logo position columns (v5)');
        this.db.pragma('user_version = 5');
      } catch (error) {
        // Columns might already exist
        console.log('Logo position columns migration skipped (may already exist)');
        this.db.pragma('user_version = 5');
      }
    }

    // Add music duck and loop fields to clip_edits if we're upgrading from v5 or below (v6)
    if (preVersion <= 5) {
      try {
        this.db.exec(`
          ALTER TABLE clip_edits ADD COLUMN music_duck_enabled INTEGER DEFAULT 1;
          ALTER TABLE clip_edits ADD COLUMN music_loop INTEGER DEFAULT 1;
        `);
        console.log('✅ Added music duck and loop columns (v6)');
        this.db.pragma('user_version = 6');
      } catch (error) {
        // Columns might already exist
        console.log('Music duck and loop columns migration skipped (may already exist)');
        this.db.pragma('user_version = 6');
      }
    }

    // Add crop position fields to clip_edits if we're upgrading from v6 or below (v7)
    if (preVersion <= 6) {
      try {
        this.db.exec(`
          ALTER TABLE clip_edits ADD COLUMN crop_position_x REAL DEFAULT 50;
          ALTER TABLE clip_edits ADD COLUMN crop_position_y REAL DEFAULT 50;
        `);
        console.log('✅ Added crop position columns (v7)');
        this.db.pragma('user_version = 7');
      } catch (error) {
        // Columns might already exist
        console.log('Crop position columns migration skipped (may already exist)');
        this.db.pragma('user_version = 7');
      }
    }

    // Add caption text case field to clip_edits if we're upgrading from v7 or below (v8)
    if (preVersion <= 7) {
      try {
        this.db.exec(`
          ALTER TABLE clip_edits ADD COLUMN caption_text_case TEXT DEFAULT 'normal';
        `);
        console.log('✅ Added caption text case column (v8)');
        this.db.pragma('user_version = 8');
      } catch (error) {
        // Column might already exist
        console.log('Caption text case column migration skipped (may already exist)');
        this.db.pragma('user_version = 8');
      }
    }

    // Add caption words per caption field to clip_edits if we're upgrading from v8 or below (v9)
    if (preVersion <= 8) {
      try {
        this.db.exec(`
          ALTER TABLE clip_edits ADD COLUMN caption_words_per_caption INTEGER DEFAULT 3;
        `);
        console.log('✅ Added caption words per caption column (v9)');
        this.db.pragma('user_version = 9');
      } catch (error) {
        // Column might already exist
        console.log('Caption words per caption column migration skipped (may already exist)');
        this.db.pragma('user_version = 9');
      }
    }

    // Add caption layout fields to clip_edits if we're upgrading from v9 or below (v10)
    if (preVersion <= 9) {
      try {
        this.db.exec(`
          ALTER TABLE clip_edits ADD COLUMN caption_max_width INTEGER DEFAULT 90;
          ALTER TABLE clip_edits ADD COLUMN caption_line_height REAL DEFAULT 1.2;
          ALTER TABLE clip_edits ADD COLUMN caption_letter_spacing INTEGER DEFAULT 0;
        `);
        console.log('✅ Added caption layout columns (v10)');
        this.db.pragma('user_version = 10');
      } catch (error) {
        // Columns might already exist
        console.log('Caption layout columns migration skipped (may already exist)');
        this.db.pragma('user_version = 10');
      }
    }

    // Add words column to transcript_segments if we're upgrading from v10 or below (v11)
    if (preVersion <= 10) {
      try {
        this.db.exec(`
          ALTER TABLE transcript_segments ADD COLUMN words TEXT;
        `);
        console.log('✅ Added words column to transcript_segments for word-level timestamps (v11)');
        this.db.pragma('user_version = 11');
      } catch (error) {
        // Column might already exist
        console.log('Words column migration skipped (may already exist)');
        this.db.pragma('user_version = 11');
      }
    }

    // Add caption_weight to clip_edits if we're upgrading from v11 or below (v12)
    // This replaces the boolean caption_bold with a numeric weight (100-900)
    if (preVersion <= 11) {
      try {
        this.db.exec(`
          ALTER TABLE clip_edits ADD COLUMN caption_weight INTEGER DEFAULT 700;
        `);
        console.log('✅ Added caption_weight column (v12) - font weights 100-900');

        // Migrate existing caption_bold values to caption_weight
        // bold=1 → weight=700, bold=0 → weight=400
        this.db.exec(`
          UPDATE clip_edits SET caption_weight = CASE WHEN caption_bold = 1 THEN 700 ELSE 400 END;
        `);
        console.log('✅ Migrated caption_bold values to caption_weight');

        this.db.pragma('user_version = 12');
      } catch (error) {
        console.log('Caption weight column migration skipped (may already exist)');
        this.db.pragma('user_version = 12');
      }
    }

    // Add zoom level to clip_edits if we're upgrading from v12 or below (v13)
    if (preVersion <= 12) {
      try {
        this.db.exec(`
          ALTER TABLE clip_edits ADD COLUMN zoom_level REAL DEFAULT 1.0;
        `)
        console.log('✅ Added zoom_level column (v13)')
        this.db.pragma('user_version = 13')
      } catch (error) {
        console.log('Zoom level column migration skipped (may already exist)')
        this.db.pragma('user_version = 13')
      }
    }

    // Add Canvas Fit offset columns to clip_edits (v14)
    if (preVersion <= 13) {
      try {
        this.db.exec(`
          ALTER TABLE clip_edits ADD COLUMN video_offset_x REAL DEFAULT 0;
          ALTER TABLE clip_edits ADD COLUMN video_offset_y REAL DEFAULT 0;
        `)
        console.log('✅ Added Canvas Fit offset columns (v14)')
        this.db.pragma('user_version = 14')
      } catch (error) {
        console.log('Canvas Fit offset columns migration skipped (may already exist)')
        this.db.pragma('user_version = 14')
      }
    }

    // Add video dimension columns to clips table (v15)
    if (preVersion <= 14) {
      try {
        this.db.exec(`
          ALTER TABLE clips ADD COLUMN video_width INTEGER;
          ALTER TABLE clips ADD COLUMN video_height INTEGER;
        `)
        console.log('✅ Added clip video dimension columns (v15)')
        this.db.pragma('user_version = 15')
      } catch (error) {
        console.log('Clip video dimension columns migration skipped (may already exist)')
        this.db.pragma('user_version = 15')
      }
    }

    if (preVersion <= 15) {
      try {
        this.db.exec(`
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
          CREATE INDEX IF NOT EXISTS idx_clip_trim_state_updated_at ON clip_trim_state (updated_at);
        `)
        console.log('✅ Added clip trim state table (v16)')
        this.db.pragma('user_version = 16')
      } catch (error) {
        console.log('Clip trim state migration skipped (may already exist)')
        this.db.pragma('user_version = 16')
      }
    }

    if (preVersion <= 16) {
      try {
        this.db.exec(`
          ALTER TABLE episodes ADD COLUMN frame_rate REAL;
        `)
        console.log('✅ Added episode frame rate column (v17)')
        this.db.pragma('user_version = 17')
      } catch (error) {
        console.log('Episode frame rate column migration skipped (may already exist)')
        this.db.pragma('user_version = 17')
      }
    }

    if (preVersion <= 17) {
      try {
        this.db.exec(`
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
        `)
        console.log('✅ Added export durability tables (v18)')
        this.db.pragma('user_version = 18')
      } catch (error) {
        console.log('Export durability table migration skipped (may already exist)')
        this.db.pragma('user_version = 18')
      }
    }

    if (preVersion <= 18) {
      try {
        this.addColumnIfMissing('exports', 'export_job_id', 'TEXT')
        this.addColumnIfMissing('exports', 'artifact_id', 'TEXT')
        this.addColumnIfMissing('exports', 'status', "TEXT NOT NULL DEFAULT 'completed'")
        this.addColumnIfMissing('exports', 'error_message', 'TEXT')
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_exports_export_job ON exports (export_job_id, clip_id);
          CREATE INDEX IF NOT EXISTS idx_exports_artifact ON exports (artifact_id);
          CREATE INDEX IF NOT EXISTS idx_exports_status ON exports (status, created_at DESC);
        `)
        console.log('✅ Added export durability columns to exports (v19)')
        this.db.pragma('user_version = 19')
      } catch (error) {
        console.log('Export durability column migration skipped (may already exist)')
        this.db.pragma('user_version = 19')
      }
    }
  }
  
  private initializeSchema() {
    // Try multiple possible schema locations
    const possiblePaths = [
      join(__dirname, 'schema.sql'),
      join(__dirname, 'database', 'schema.sql'),
      join(__dirname, '..', 'database', 'schema.sql'),
      join(__dirname, '..', '..', 'src', 'main', 'database', 'schema.sql')
    ]
    
    let schemaPath: string | null = null
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        schemaPath = path
        break
      }
    }
    
    if (schemaPath) {
      const schema = readFileSync(schemaPath, 'utf-8')
      this.db.exec(schema)
    } else {
      console.warn('Database schema file not found. Checked paths:', possiblePaths)
      // Create basic schema inline as fallback
      this.createFallbackSchema()
    }
  }
  
  private createFallbackSchema() {
    // Inline schema as fallback
    const schema = `
      CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
      );
      
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
      
      CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
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
          updated_at TEXT NOT NULL
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
          updated_at TEXT NOT NULL
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
          completed_at TEXT
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
          updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exports (
          id TEXT PRIMARY KEY,
          clip_id TEXT NOT NULL,
          export_job_id TEXT,
          artifact_id TEXT,
          file_path TEXT NOT NULL,
          format TEXT NOT NULL,
          resolution TEXT NOT NULL,
          metadata TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'completed',
          error_message TEXT,
          created_at TEXT NOT NULL
      );
    `

    this.db.exec(schema)
  }
  
  // Project operations
  createProject(project: { id: string; name: string }) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `)
    return stmt.run(project.id, project.name, now, now)
  }
  
  getProject(id: string) {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?')
    return stmt.get(id)
  }
  
  getAllProjects() {
    const stmt = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    return stmt.all()
  }

  getRecentProjects() {
    const stmt = this.db.prepare(`
      SELECT
        p.id,
        p.name,
        p.created_at,
        p.updated_at,
        e.id as episode_id,
        e.file_name,
        e.file_path,
        (
          SELECT ct.file_path
          FROM clip_thumbnails ct
          INNER JOIN clips clip_thumb ON clip_thumb.id = ct.clip_id
          WHERE clip_thumb.episode_id = e.id
          ORDER BY ct.is_selected DESC, ct.timestamp ASC
          LIMIT 1
        ) as thumbnail_path,
        e.duration,
        e.processing_status,
        COUNT(c.id) as clip_count,
        COUNT(CASE WHEN c.status = 'approved' THEN 1 END) as approved_count,
        COUNT(CASE WHEN c.status = 'rejected' THEN 1 END) as rejected_count
      FROM projects p
      LEFT JOIN episodes e ON p.id = e.project_id
      LEFT JOIN clips c ON e.id = c.episode_id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      LIMIT 50
    `)
    return stmt.all()
  }
  
  // Episode operations
  createEpisode(episode: {
    id: string
    projectId: string
    fileName: string
    filePath: string
    duration?: number
  }) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO episodes (id, project_id, file_name, file_path, duration, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    return stmt.run(
      episode.id,
      episode.projectId,
      episode.fileName,
      episode.filePath,
      episode.duration || 0,
      now
    )
  }
  
  updateEpisodeStatus(id: string, status: string) {
    const stmt = this.db.prepare(`
      UPDATE episodes 
      SET processing_status = ?
      WHERE id = ?
    `)
    return stmt.run(status, id)
  }

  updateEpisodeFrameRate(id: string, frameRate: number) {
    const stmt = this.db.prepare(`
      UPDATE episodes
      SET frame_rate = ?
      WHERE id = ?
    `)
    return stmt.run(frameRate, id)
  }
  
  getEpisode(id: string) {
    const stmt = this.db.prepare('SELECT * FROM episodes WHERE id = ?')
    return stmt.get(id)
  }
  
  getAllEpisodes() {
    const stmt = this.db.prepare('SELECT id, file_name FROM episodes')
    return stmt.all()
  }

  getEpisodesMissingFrameRate(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT id, file_path
      FROM episodes
      WHERE frame_rate IS NULL
      LIMIT ?
    `)
    return stmt.all(limit)
  }
  
  // Transcript operations
  insertTranscriptSegments(segments: Array<{
    id: string
    episodeId: string
    startTime: number
    endTime: number
    text: string
    confidence: number
    speaker?: string
    words?: Array<{
      word: string
      start: number
      end: number
    }>
  }>) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO transcript_segments
      (id, episode_id, start_time, end_time, text, confidence, speaker, words, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = this.db.transaction((segmentsToInsert: typeof segments) => {
      for (const segment of segmentsToInsert) {
        stmt.run(
          segment.id,
          segment.episodeId,
          segment.startTime,
          segment.endTime,
          segment.text,
          segment.confidence,
          segment.speaker || null,
          segment.words ? JSON.stringify(segment.words) : null,
          now
        )
      }
    })
    
    return insertMany(segments)
  }
  
  getTranscriptSegments(episodeId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM transcript_segments
      WHERE episode_id = ?
      ORDER BY start_time ASC
    `)
    const segments = stmt.all(episodeId) as any[]

    // Parse words JSON if present
    return segments.map(segment => ({
      ...segment,
      words: segment.words ? JSON.parse(segment.words) : undefined
    }))
  }

  getClipTranscriptSegments(clipId: string) {
    // First get the clip to find its episode and time range
    const clip = this.getClip(clipId) as any
    if (!clip) return []

    const stmt = this.db.prepare(`
      SELECT * FROM transcript_segments
      WHERE episode_id = ?
        AND end_time > ?
        AND start_time < ?
      ORDER BY start_time ASC
    `)
    const segments = stmt.all(clip.episode_id, clip.start_time, clip.end_time) as any[]

    // Parse words JSON if present
    return segments.map(segment => ({
      ...segment,
      words: segment.words ? JSON.parse(segment.words) : undefined
    }))
  }

  updateTranscriptSegment(episodeId: string, segmentIndex: number, text: string) {
    // Get all segments for the episode to find the segment by index
    const segments = this.getTranscriptSegments(episodeId)
    if (!segments || segmentIndex >= segments.length) {
      throw new Error('Segment index out of bounds')
    }

    const segment = segments[segmentIndex] as any
    const stmt = this.db.prepare(`
      UPDATE transcript_segments
      SET text = ?
      WHERE episode_id = ? AND start_time = ? AND end_time = ?
    `)
    return stmt.run(text, episodeId, segment.start_time, segment.end_time)
  }

  // Clip operations
  insertClips(clips: Array<{
    id: string
    episodeId: string
    startTime: number
    endTime: number
    duration: number
    contentType: string
    shareabilityScore: number
    keyQuote: string
    reason: string
    contextNeeded: string
    status?: string
    videoWidth?: number | null
    videoHeight?: number | null
  }>) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO clips 
      (id, episode_id, start_time, end_time, duration, content_type, shareability_score, 
       key_quote, reason, context_needed, status, video_width, video_height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    const insertMany = this.db.transaction((clipsToInsert: typeof clips) => {
      for (const clip of clipsToInsert) {
        stmt.run(
          clip.id,
          clip.episodeId,
          clip.startTime,
          clip.endTime,
          clip.duration,
          clip.contentType,
          clip.shareabilityScore,
          clip.keyQuote,
          clip.reason,
          clip.contextNeeded,
          clip.status || 'pending',
          clip.videoWidth ?? null,
          clip.videoHeight ?? null,
          now
        )
      }
    })
    
    return insertMany(clips)
  }
  
  updateClipStatus(id: string, status: string) {
    const stmt = this.db.prepare('UPDATE clips SET status = ? WHERE id = ?')
    return stmt.run(status, id)
  }

  updateClipBoundaries(id: string, startTime: number, endTime: number) {
    const duration = endTime - startTime
    const stmt = this.db.prepare(`
      UPDATE clips
      SET start_time = ?, end_time = ?, duration = ?
      WHERE id = ?
    `)
    return stmt.run(startTime, endTime, duration, id)
  }

  getClipsMissingVideoDimensions(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT c.id, c.episode_id, e.file_path
      FROM clips c
      INNER JOIN episodes e ON c.episode_id = e.id
      WHERE c.video_width IS NULL OR c.video_height IS NULL
      LIMIT ?
    `)
    return stmt.all(limit)
  }

  updateClipVideoDimensions(clipId: string, width: number, height: number) {
    const stmt = this.db.prepare(`
      UPDATE clips
      SET video_width = ?, video_height = ?
      WHERE id = ?
    `)
    return stmt.run(width, height, clipId)
  }

  getClips(episodeId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM clips
      WHERE episode_id = ?
      ORDER BY shareability_score DESC, start_time ASC
    `)
    return stmt.all(episodeId)
  }

  getClip(clipId: string) {
    const stmt = this.db.prepare('SELECT * FROM clips WHERE id = ?')
    return stmt.get(clipId)
  }

  getApprovedClips(episodeId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM clips
      WHERE episode_id = ? AND status = 'approved'
      ORDER BY start_time ASC
    `)
    return stmt.all(episodeId)
  }

  // Content package operations
  insertClipTitles(clipId: string, titles: string[]) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO clip_titles (id, clip_id, title, is_selected, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    const insertMany = this.db.transaction((titlesToInsert: string[]) => {
      titlesToInsert.forEach((title, index) => {
        stmt.run(
          `${clipId}-title-${index}`,
          clipId,
          title,
          index === 0 ? 1 : 0, // First title is selected by default
          now
        )
      })
    })

    return insertMany(titles)
  }

  getClipTitles(clipId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM clip_titles
      WHERE clip_id = ?
      ORDER BY is_selected DESC, created_at ASC
    `)
    return stmt.all(clipId)
  }

  selectClipTitle(titleId: string, clipId: string) {
    // Deselect all titles for this clip
    const deselectStmt = this.db.prepare('UPDATE clip_titles SET is_selected = 0 WHERE clip_id = ?')
    deselectStmt.run(clipId)

    // Select the chosen title
    const selectStmt = this.db.prepare('UPDATE clip_titles SET is_selected = 1 WHERE id = ?')
    return selectStmt.run(titleId)
  }

  insertClipDescription(clipId: string, description: string, platform: string = 'general') {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO clip_descriptions (id, clip_id, description, platform, is_selected, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    return stmt.run(
      `${clipId}-desc-${platform}`,
      clipId,
      description,
      platform,
      1, // Selected by default
      now
    )
  }

  getClipDescriptions(clipId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM clip_descriptions
      WHERE clip_id = ?
      ORDER BY is_selected DESC, platform ASC
    `)
    return stmt.all(clipId)
  }

  selectClipDescription(descriptionId: string, clipId: string) {
    // Deselect all descriptions for this clip
    const deselectStmt = this.db.prepare('UPDATE clip_descriptions SET is_selected = 0 WHERE clip_id = ?')
    deselectStmt.run(clipId)

    // Select the chosen description
    const selectStmt = this.db.prepare('UPDATE clip_descriptions SET is_selected = 1 WHERE id = ?')
    return selectStmt.run(descriptionId)
  }

  // Clip edits operations (for Editor screen)
  getClipEdits(clipId: string) {
    const stmt = this.db.prepare('SELECT * FROM clip_edits WHERE clip_id = ?')
    return stmt.get(clipId)
  }

  getClipTrimState(clipId: string): ClipTrimState | undefined {
    const stmt = this.db.prepare('SELECT * FROM clip_trim_state WHERE clip_id = ?')
    return stmt.get(clipId) as ClipTrimState | undefined
  }

  saveClipTrimState(
    clipId: string,
    inPoint: number,
    outPoint: number,
    inAnchor?: TrimBoundaryAnchor | null,
    outAnchor?: TrimBoundaryAnchor | null
  ) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO clip_trim_state (
        clip_id,
        in_point,
        out_point,
        in_anchor_type,
        in_anchor_source_id,
        in_anchor_label,
        in_anchor_confidence,
        out_anchor_type,
        out_anchor_source_id,
        out_anchor_label,
        out_anchor_confidence,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(clip_id) DO UPDATE SET
        in_point = excluded.in_point,
        out_point = excluded.out_point,
        in_anchor_type = excluded.in_anchor_type,
        in_anchor_source_id = excluded.in_anchor_source_id,
        in_anchor_label = excluded.in_anchor_label,
        in_anchor_confidence = excluded.in_anchor_confidence,
        out_anchor_type = excluded.out_anchor_type,
        out_anchor_source_id = excluded.out_anchor_source_id,
        out_anchor_label = excluded.out_anchor_label,
        out_anchor_confidence = excluded.out_anchor_confidence,
        updated_at = excluded.updated_at
    `)

    return stmt.run(
      clipId,
      inPoint,
      outPoint,
      inAnchor?.type ?? null,
      inAnchor?.sourceId ?? null,
      inAnchor?.label ?? null,
      inAnchor?.confidence ?? null,
      outAnchor?.type ?? null,
      outAnchor?.sourceId ?? null,
      outAnchor?.label ?? null,
      outAnchor?.confidence ?? null,
      now
    )
  }

  saveClipEdits(clipId: string, edits: any) {
    const now = new Date().toISOString()

    // Check if edits already exist
    const existing = this.getClipEdits(clipId)

    if (existing) {
      // Update existing
      const stmt = this.db.prepare(`
        UPDATE clip_edits SET
          captions_enabled = ?,
          caption_segments = ?,
          caption_font = ?,
          caption_size = ?,
          caption_color = ?,
          caption_position = ?,
          caption_custom_x = ?,
          caption_custom_y = ?,
          caption_bold = ?,
          caption_weight = ?,
          caption_italic = ?,
          caption_outline = ?,
          caption_outline_color = ?,
          caption_outline_width = ?,
          caption_shadow = ?,
          caption_highlight_style = ?,
          caption_background = ?,
          caption_background_color = ?,
          caption_background_opacity = ?,
          caption_text_case = ?,
          caption_words_per_caption = ?,
          caption_max_width = ?,
          caption_line_height = ?,
          caption_letter_spacing = ?,
          logo_enabled = ?,
          logo_path = ?,
          logo_position = ?,
          logo_position_x = ?,
          logo_position_y = ?,
          logo_scale = ?,
          logo_opacity = ?,
          music_enabled = ?,
          music_path = ?,
          music_volume = ?,
          music_duck_volume = ?,
          music_duck_enabled = ?,
          music_fade_in = ?,
          music_fade_out = ?,
          music_loop = ?,
          aspect_ratio = ?,
          crop_mode = ?,
          crop_position_x = ?,
          crop_position_y = ?,
          zoom_level = ?,
          video_offset_x = ?,
          video_offset_y = ?,
          updated_at = ?
        WHERE clip_id = ?
      `)

      const logoPositionX = edits.logo_position_x ?? 85
      const logoPositionY = edits.logo_position_y ?? 85

      const result = stmt.run(
        edits.captions_enabled ?? 1,
        edits.caption_segments ?? null,
        edits.caption_font ?? 'Inter',
        edits.caption_size ?? 48,
        edits.caption_color ?? '#FFFFFF',
        edits.caption_position ?? 'bottom',
        edits.caption_custom_x ?? null,
        edits.caption_custom_y ?? null,
        edits.caption_bold ?? 1, // Keep for backward compatibility
        edits.caption_weight ?? (edits.caption_bold ? 700 : 400), // Default based on bold
        edits.caption_italic ?? 0,
        edits.caption_outline ?? 1,
        edits.caption_outline_color ?? '#000000',
        edits.caption_outline_width ?? 2,
        edits.caption_shadow ?? 0,
        edits.caption_highlight_style ?? 'word',
        edits.caption_background ?? 0,
        edits.caption_background_color ?? '#000000',
        edits.caption_background_opacity ?? 0.5,
        edits.caption_text_case ?? 'none',
        edits.caption_words_per_caption ?? 1,
        edits.caption_max_width ?? 90,
        edits.caption_line_height ?? 1.2,
        edits.caption_letter_spacing ?? 0,
        edits.logo_enabled ?? 0,
        edits.logo_path ?? null,
        edits.logo_position ?? 'bottom-right',
        logoPositionX,
        logoPositionY,
        edits.logo_scale ?? 0.15,
        edits.logo_opacity ?? 0.8,
        edits.music_enabled ?? 0,
        edits.music_path ?? null,
        edits.music_volume ?? 0.3,
        edits.music_duck_volume ?? 0.1,
        edits.music_duck_enabled ?? 1,
        edits.music_fade_in ?? 1.0,
        edits.music_fade_out ?? 1.0,
        edits.music_loop ?? 1,
        edits.aspect_ratio ?? '9:16',
        edits.crop_mode ?? 'center',
        edits.crop_position_x ?? 50,
        edits.crop_position_y ?? 50,
        edits.zoom_level ?? 1,
        edits.video_offset_x ?? 0,
        edits.video_offset_y ?? 0,
        now,
        clipId
      )
      return result
    } else {
      // Insert new
      const stmt = this.db.prepare(`
        INSERT INTO clip_edits (
          clip_id, captions_enabled, caption_segments, caption_font, caption_size,
          caption_color, caption_position, caption_custom_x, caption_custom_y, caption_bold, caption_weight, caption_italic, caption_outline,
          caption_outline_color, caption_outline_width, caption_shadow, caption_highlight_style,
          caption_background, caption_background_color, caption_background_opacity,
          caption_text_case, caption_words_per_caption, caption_max_width, caption_line_height, caption_letter_spacing,
          logo_enabled, logo_path, logo_position, logo_position_x, logo_position_y, logo_scale, logo_opacity,
          music_enabled, music_path, music_volume, music_duck_volume, music_duck_enabled, music_fade_in, music_fade_out, music_loop,
          aspect_ratio, crop_mode, crop_position_x, crop_position_y, zoom_level, video_offset_x, video_offset_y, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?
        )
      `)

      const logoPositionX = edits.logo_position_x ?? 85
      const logoPositionY = edits.logo_position_y ?? 85

      const result = stmt.run(
        clipId,
        edits.captions_enabled ?? 1,
        edits.caption_segments ?? null,
        edits.caption_font ?? 'Inter',
        edits.caption_size ?? 48,
        edits.caption_color ?? '#FFFFFF',
        edits.caption_position ?? 'bottom',
        edits.caption_custom_x ?? null,
        edits.caption_custom_y ?? null,
        edits.caption_bold ?? 1, // Keep for backward compatibility
        edits.caption_weight ?? (edits.caption_bold ? 700 : 400), // Default based on bold
        edits.caption_italic ?? 0,
        edits.caption_outline ?? 1,
        edits.caption_outline_color ?? '#000000',
        edits.caption_outline_width ?? 2,
        edits.caption_shadow ?? 0,
        edits.caption_highlight_style ?? 'word',
        edits.caption_background ?? 0,
        edits.caption_background_color ?? '#000000',
        edits.caption_background_opacity ?? 0.5,
        edits.caption_text_case ?? 'none',
        edits.caption_words_per_caption ?? 1,
        edits.caption_max_width ?? 90,
        edits.caption_line_height ?? 1.2,
        edits.caption_letter_spacing ?? 0,
        edits.logo_enabled ?? 0,
        edits.logo_path ?? null,
        edits.logo_position ?? 'bottom-right',
        logoPositionX,
        logoPositionY,
        edits.logo_scale ?? 0.15,
        edits.logo_opacity ?? 0.8,
        edits.music_enabled ?? 0,
        edits.music_path ?? null,
        edits.music_volume ?? 0.3,
        edits.music_duck_volume ?? 0.1,
        edits.music_duck_enabled ?? 1,
        edits.music_fade_in ?? 1.0,
        edits.music_fade_out ?? 1.0,
        edits.music_loop ?? 1,
        edits.aspect_ratio ?? '9:16',
        edits.crop_mode ?? 'center',
        edits.crop_position_x ?? 50,
        edits.crop_position_y ?? 50,
        edits.zoom_level ?? 1,
        edits.video_offset_x ?? 0,
        edits.video_offset_y ?? 0,
        now
      )
      return result
    }
  }

  deleteClipEdits(clipId: string) {
    const stmt = this.db.prepare('DELETE FROM clip_edits WHERE clip_id = ?')
    return stmt.run(clipId)
  }

  insertClipThumbnail(clipId: string, filePath: string, timestamp: number) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO clip_thumbnails (id, clip_id, file_path, timestamp, is_selected, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    return stmt.run(
      `${clipId}-thumb-${timestamp}`,
      clipId,
      filePath,
      timestamp,
      0,
      now
    )
  }

  getClipThumbnails(clipId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM clip_thumbnails
      WHERE clip_id = ?
      ORDER BY is_selected DESC, timestamp ASC
    `)
    return stmt.all(clipId)
  }

  selectClipThumbnail(thumbnailId: string, clipId: string) {
    // Deselect all thumbnails for this clip
    const deselectStmt = this.db.prepare('UPDATE clip_thumbnails SET is_selected = 0 WHERE clip_id = ?')
    deselectStmt.run(clipId)

    // Select the chosen thumbnail
    const selectStmt = this.db.prepare('UPDATE clip_thumbnails SET is_selected = 1 WHERE id = ?')
    return selectStmt.run(thumbnailId)
  }

  createWorkflowJob(record: WorkflowJobRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_jobs (
        id, job_type, status, worker_kind, project_id, episode_id, clip_id, parent_job_id,
        progress, stage, message, input_json, config_snapshot_json, lease_owner,
        lease_expires_at, heartbeat_at, attempt_count, max_attempts, started_at,
        completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    return stmt.run(
      record.id,
      record.jobType,
      record.status,
      record.workerKind,
      record.projectId,
      record.episodeId,
      record.clipId,
      record.parentJobId,
      record.progress,
      record.stage,
      record.message,
      record.inputJson,
      record.configSnapshotJson,
      record.leaseOwner,
      record.leaseExpiresAt,
      record.heartbeatAt,
      record.attemptCount,
      record.maxAttempts,
      record.startedAt,
      record.completedAt,
      record.createdAt,
      record.updatedAt
    )
  }

  getWorkflowJob(jobId: string): WorkflowJobRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM workflow_jobs WHERE id = ?')
    const row = stmt.get(jobId)
    return row ? this.mapWorkflowJob(row) : undefined
  }

  updateWorkflowJob(jobId: string, patch: Partial<WorkflowJobRecord>) {
    const stmt = this.db.prepare(`
      UPDATE workflow_jobs
      SET status = COALESCE(?, status),
          worker_kind = COALESCE(?, worker_kind),
          project_id = COALESCE(?, project_id),
          episode_id = COALESCE(?, episode_id),
          clip_id = COALESCE(?, clip_id),
          parent_job_id = COALESCE(?, parent_job_id),
          progress = COALESCE(?, progress),
          stage = COALESCE(?, stage),
          message = COALESCE(?, message),
          input_json = COALESCE(?, input_json),
          config_snapshot_json = COALESCE(?, config_snapshot_json),
          lease_owner = COALESCE(?, lease_owner),
          lease_expires_at = COALESCE(?, lease_expires_at),
          heartbeat_at = COALESCE(?, heartbeat_at),
          attempt_count = COALESCE(?, attempt_count),
          max_attempts = COALESCE(?, max_attempts),
          started_at = COALESCE(?, started_at),
          completed_at = COALESCE(?, completed_at),
          updated_at = COALESCE(?, updated_at)
      WHERE id = ?
    `)

    return stmt.run(
      patch.status ?? null,
      patch.workerKind ?? null,
      patch.projectId ?? null,
      patch.episodeId ?? null,
      patch.clipId ?? null,
      patch.parentJobId ?? null,
      patch.progress ?? null,
      patch.stage ?? null,
      patch.message ?? null,
      patch.inputJson ?? null,
      patch.configSnapshotJson ?? null,
      patch.leaseOwner ?? null,
      patch.leaseExpiresAt ?? null,
      patch.heartbeatAt ?? null,
      patch.attemptCount ?? null,
      patch.maxAttempts ?? null,
      patch.startedAt ?? null,
      patch.completedAt ?? null,
      patch.updatedAt ?? null,
      jobId
    )
  }

  listRecoverableExportWorkflowJobs(): WorkflowJobRecord[] {
    const stmt = this.db.prepare(`
      SELECT *
      FROM workflow_jobs
      WHERE job_type = 'export'
        AND status IN ('pending', 'running', 'cancel_requested', 'pending_resume')
      ORDER BY created_at ASC
    `)
    return (stmt.all() as any[]).map((row) => this.mapWorkflowJob(row))
  }

  getActivePipelineWorkflowJob(episodeId?: string, projectId?: string): WorkflowJobRecord | undefined {
    let row: unknown

    if (episodeId) {
      const stmt = this.db.prepare(`
        SELECT *
        FROM workflow_jobs
        WHERE job_type = 'pipeline'
          AND episode_id = ?
          AND status IN ('pending', 'running')
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `)
      row = stmt.get(episodeId)
    } else if (projectId) {
      const stmt = this.db.prepare(`
        SELECT *
        FROM workflow_jobs
        WHERE job_type = 'pipeline'
          AND project_id = ?
          AND status IN ('pending', 'running')
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `)
      row = stmt.get(projectId)
    } else {
      const stmt = this.db.prepare(`
        SELECT *
        FROM workflow_jobs
        WHERE job_type = 'pipeline'
          AND status IN ('pending', 'running')
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `)
      row = stmt.get()
    }

    return row ? this.mapWorkflowJob(row) : undefined
  }

  createWorkflowStepRun(record: WorkflowStepRunRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_step_runs (
        id, job_id, step_key, status, step_order, clip_id, attempt, progress,
        message, input_json, output_json, error_code, error_message, started_at,
        completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    return stmt.run(
      record.id,
      record.jobId,
      record.stepKey,
      record.status,
      record.stepOrder,
      record.clipId,
      record.attempt,
      record.progress,
      record.message,
      record.inputJson,
      record.outputJson,
      record.errorCode,
      record.errorMessage,
      record.startedAt,
      record.completedAt,
      record.createdAt,
      record.updatedAt
    )
  }

  updateWorkflowStepRun(stepRunId: string, patch: Partial<WorkflowStepRunRecord>) {
    const stmt = this.db.prepare(`
      UPDATE workflow_step_runs
      SET status = COALESCE(?, status),
          step_order = COALESCE(?, step_order),
          clip_id = COALESCE(?, clip_id),
          attempt = COALESCE(?, attempt),
          progress = COALESCE(?, progress),
          message = COALESCE(?, message),
          input_json = COALESCE(?, input_json),
          output_json = COALESCE(?, output_json),
          error_code = COALESCE(?, error_code),
          error_message = COALESCE(?, error_message),
          started_at = COALESCE(?, started_at),
          completed_at = COALESCE(?, completed_at),
          updated_at = COALESCE(?, updated_at)
      WHERE id = ?
    `)

    return stmt.run(
      patch.status ?? null,
      patch.stepOrder ?? null,
      patch.clipId ?? null,
      patch.attempt ?? null,
      patch.progress ?? null,
      patch.message ?? null,
      patch.inputJson ?? null,
      patch.outputJson ?? null,
      patch.errorCode ?? null,
      patch.errorMessage ?? null,
      patch.startedAt ?? null,
      patch.completedAt ?? null,
      patch.updatedAt ?? null,
      stepRunId
    )
  }

  updateWorkflowStepRunByJobAndClip(jobId: string, clipId: string, patch: Partial<WorkflowStepRunRecord>) {
    const stmt = this.db.prepare(`
      UPDATE workflow_step_runs
      SET status = COALESCE(?, status),
          step_order = COALESCE(?, step_order),
          attempt = COALESCE(?, attempt),
          progress = COALESCE(?, progress),
          message = COALESCE(?, message),
          input_json = COALESCE(?, input_json),
          output_json = COALESCE(?, output_json),
          error_code = COALESCE(?, error_code),
          error_message = COALESCE(?, error_message),
          started_at = COALESCE(?, started_at),
          completed_at = COALESCE(?, completed_at),
          updated_at = COALESCE(?, updated_at)
      WHERE job_id = ? AND clip_id = ?
    `)

    return stmt.run(
      patch.status ?? null,
      patch.stepOrder ?? null,
      patch.attempt ?? null,
      patch.progress ?? null,
      patch.message ?? null,
      patch.inputJson ?? null,
      patch.outputJson ?? null,
      patch.errorCode ?? null,
      patch.errorMessage ?? null,
      patch.startedAt ?? null,
      patch.completedAt ?? null,
      patch.updatedAt ?? null,
      jobId,
      clipId
    )
  }

  getWorkflowStepRunsByJob(jobId: string): WorkflowStepRunRecord[] {
    const stmt = this.db.prepare(`
      SELECT *
      FROM workflow_step_runs
      WHERE job_id = ?
      ORDER BY step_order ASC, created_at ASC
    `)
    return (stmt.all(jobId) as any[]).map((row) => this.mapWorkflowStepRun(row))
  }

  createArtifact(record: ArtifactRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO artifacts (
        id, artifact_type, status, project_id, episode_id, clip_id, workflow_job_id,
        file_path, temp_file_path, mime_type, size_bytes, checksum, metadata_json,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    return stmt.run(
      record.id,
      record.artifactType,
      record.status,
      record.projectId,
      record.episodeId,
      record.clipId,
      record.workflowJobId,
      record.filePath,
      record.tempFilePath,
      record.mimeType,
      record.sizeBytes,
      record.checksum,
      record.metadataJson,
      record.createdAt,
      record.updatedAt,
      record.completedAt
    )
  }

  updateArtifact(artifactId: string, patch: Partial<ArtifactRecord>) {
    const stmt = this.db.prepare(`
      UPDATE artifacts
      SET artifact_type = COALESCE(?, artifact_type),
          status = COALESCE(?, status),
          project_id = COALESCE(?, project_id),
          episode_id = COALESCE(?, episode_id),
          clip_id = COALESCE(?, clip_id),
          workflow_job_id = COALESCE(?, workflow_job_id),
          file_path = COALESCE(?, file_path),
          temp_file_path = COALESCE(?, temp_file_path),
          mime_type = COALESCE(?, mime_type),
          size_bytes = COALESCE(?, size_bytes),
          checksum = COALESCE(?, checksum),
          metadata_json = COALESCE(?, metadata_json),
          updated_at = COALESCE(?, updated_at),
          completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `)

    return stmt.run(
      patch.artifactType ?? null,
      patch.status ?? null,
      patch.projectId ?? null,
      patch.episodeId ?? null,
      patch.clipId ?? null,
      patch.workflowJobId ?? null,
      patch.filePath ?? null,
      patch.tempFilePath ?? null,
      patch.mimeType ?? null,
      patch.sizeBytes ?? null,
      patch.checksum ?? null,
      patch.metadataJson ?? null,
      patch.updatedAt ?? null,
      patch.completedAt ?? null,
      artifactId
    )
  }

  findArtifactByPath(filePath: string): ArtifactRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM artifacts WHERE file_path = ? LIMIT 1')
    const row = stmt.get(filePath)
    return row ? this.mapArtifact(row) : undefined
  }

  getArtifactById(artifactId: string): ArtifactRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM artifacts WHERE id = ? LIMIT 1')
    const row = stmt.get(artifactId)
    return row ? this.mapArtifact(row) : undefined
  }

  createExportJob(record: ExportJobRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO export_jobs (
        id, workflow_job_id, episode_id, status, output_directory, aspect_ratio,
        include_captions, current_clip_index, total_clips, progress, clip_ids_json,
        error_message, created_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    return stmt.run(
      record.id,
      record.workflowJobId,
      record.episodeId,
      record.status,
      record.outputDirectory,
      record.aspectRatio,
      record.includeCaptions ? 1 : 0,
      record.currentClipIndex,
      record.totalClips,
      record.progress,
      record.clipIdsJson,
      record.errorMessage,
      record.createdAt,
      record.startedAt,
      record.completedAt,
      record.updatedAt
    )
  }

  getExportJobRecord(exportJobId: string): ExportJobRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM export_jobs WHERE id = ?')
    const row = stmt.get(exportJobId)
    return row ? this.mapExportJob(row) : undefined
  }

  getExportJobByWorkflowJobId(workflowJobId: string): ExportJobRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM export_jobs WHERE workflow_job_id = ? LIMIT 1')
    const row = stmt.get(workflowJobId)
    return row ? this.mapExportJob(row) : undefined
  }

  getActiveExportJobForEpisode(episodeId: string): ExportJobRecord | undefined {
    const stmt = this.db.prepare(`
      SELECT *
      FROM export_jobs
      WHERE episode_id = ?
        AND status IN ('pending', 'running', 'pending_resume', 'cancel_requested')
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `)
    const row = stmt.get(episodeId)
    return row ? this.mapExportJob(row) : undefined
  }

  updateExportJob(exportJobId: string, patch: Partial<ExportJobRecord>) {
    const stmt = this.db.prepare(`
      UPDATE export_jobs
      SET workflow_job_id = COALESCE(?, workflow_job_id),
          episode_id = COALESCE(?, episode_id),
          status = COALESCE(?, status),
          output_directory = COALESCE(?, output_directory),
          aspect_ratio = COALESCE(?, aspect_ratio),
          include_captions = COALESCE(?, include_captions),
          current_clip_index = COALESCE(?, current_clip_index),
          total_clips = COALESCE(?, total_clips),
          progress = COALESCE(?, progress),
          clip_ids_json = COALESCE(?, clip_ids_json),
          error_message = COALESCE(?, error_message),
          started_at = COALESCE(?, started_at),
          completed_at = COALESCE(?, completed_at),
          updated_at = COALESCE(?, updated_at)
      WHERE id = ?
    `)

    return stmt.run(
      patch.workflowJobId ?? null,
      patch.episodeId ?? null,
      patch.status ?? null,
      patch.outputDirectory ?? null,
      patch.aspectRatio ?? null,
      typeof patch.includeCaptions === 'boolean' ? (patch.includeCaptions ? 1 : 0) : null,
      patch.currentClipIndex ?? null,
      patch.totalClips ?? null,
      patch.progress ?? null,
      patch.clipIdsJson ?? null,
      patch.errorMessage ?? null,
      patch.startedAt ?? null,
      patch.completedAt ?? null,
      patch.updatedAt ?? null,
      exportJobId
    )
  }

  createExportOutput(record: ExportOutputRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO exports (
        id, clip_id, export_job_id, artifact_id, file_path, format, resolution,
        metadata, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    return stmt.run(
      record.id,
      record.clipId,
      record.exportJobId,
      record.artifactId,
      record.filePath,
      record.format,
      record.resolution,
      record.metadata,
      record.status,
      record.errorMessage,
      record.createdAt
    )
  }

  updateExportOutput(outputId: string, patch: Partial<ExportOutputRecord>) {
    const stmt = this.db.prepare(`
      UPDATE exports
      SET clip_id = COALESCE(?, clip_id),
          export_job_id = COALESCE(?, export_job_id),
          artifact_id = COALESCE(?, artifact_id),
          file_path = COALESCE(?, file_path),
          format = COALESCE(?, format),
          resolution = COALESCE(?, resolution),
          metadata = COALESCE(?, metadata),
          status = COALESCE(?, status),
          error_message = COALESCE(?, error_message)
      WHERE id = ?
    `)

    return stmt.run(
      patch.clipId ?? null,
      patch.exportJobId ?? null,
      patch.artifactId ?? null,
      patch.filePath ?? null,
      patch.format ?? null,
      patch.resolution ?? null,
      patch.metadata ?? null,
      patch.status ?? null,
      patch.errorMessage ?? null,
      outputId
    )
  }

  updateExportOutputByJobAndClip(exportJobId: string, clipId: string, patch: Partial<ExportOutputRecord>) {
    const stmt = this.db.prepare(`
      UPDATE exports
      SET artifact_id = COALESCE(?, artifact_id),
          file_path = COALESCE(?, file_path),
          format = COALESCE(?, format),
          resolution = COALESCE(?, resolution),
          metadata = COALESCE(?, metadata),
          status = COALESCE(?, status),
          error_message = COALESCE(?, error_message)
      WHERE export_job_id = ? AND clip_id = ?
    `)

    return stmt.run(
      patch.artifactId ?? null,
      patch.filePath ?? null,
      patch.format ?? null,
      patch.resolution ?? null,
      patch.metadata ?? null,
      patch.status ?? null,
      patch.errorMessage ?? null,
      exportJobId,
      clipId
    )
  }

  getExportOutputs(exportJobId: string): ExportOutputRecord[] {
    const stmt = this.db.prepare(`
      SELECT *
      FROM exports
      WHERE export_job_id = ?
      ORDER BY created_at ASC
    `)
    return (stmt.all(exportJobId) as any[]).map((row) => this.mapExportOutput(row))
  }

  getDurableExportView(exportJobId: string) {
    const job = this.getExportJobRecord(exportJobId)
    const outputs = this.getExportOutputs(exportJobId)
    return {
      job,
      outputs
    }
  }
  
  // Settings operations
  getSetting(key: string) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?')
    const result = stmt.get(key) as { value: string } | undefined
    return result ? result.value : null
  }
  
  setSetting(key: string, value: string) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `)
    return stmt.run(key, value, now)
  }
  
  // Data migration and cleanup methods
  cleanupDuplicateProjects() {
    console.log('Starting database cleanup for duplicate projects...')

    // Step 1: Find projects with no clips
    const stmt = this.db.prepare(`
      SELECT p.id, p.name, COUNT(c.id) as clip_count
      FROM projects p
      LEFT JOIN episodes e ON p.id = e.project_id
      LEFT JOIN clips c ON e.id = c.episode_id
      GROUP BY p.id
      HAVING clip_count = 0
    `)
    const emptyProjects = stmt.all()
    console.log(`Found ${emptyProjects.length} projects with no clips`)

    // Step 1.5: Find duplicate projects (same name, keep only the most recent)
    const duplicateStmt = this.db.prepare(`
      SELECT p.id, p.name, p.created_at,
             ROW_NUMBER() OVER (PARTITION BY p.name ORDER BY p.updated_at DESC) as row_num
      FROM projects p
    `)
    const allProjects = duplicateStmt.all() as any[]
    const duplicatesToDelete = allProjects.filter((p: any) => p.row_num > 1)
    console.log(`Found ${duplicatesToDelete.length} duplicate projects (keeping most recent of each name)`)

    // Step 1.6: Find projects with missing or zero-size episode files
    const projectsWithFilesStmt = this.db.prepare(`
      SELECT DISTINCT p.id, p.name, e.file_path
      FROM projects p
      JOIN episodes e ON p.id = e.project_id
    `)
    const projectsWithFiles = projectsWithFilesStmt.all() as any[]
    const projectsWithInvalidFiles = projectsWithFiles.filter((p: any) => {
      if (!p.file_path) {
        console.log(`Project ${p.name} has no file path`)
        return true
      }
      if (!existsSync(p.file_path)) {
        console.log(`Project ${p.name} file does not exist: ${p.file_path}`)
        return true
      }
      try {
        const stats = statSync(p.file_path)
        if (stats.size === 0) {
          console.log(`Project ${p.name} file has zero size: ${p.file_path}`)
          return true
        }
      } catch (error) {
        console.log(`Project ${p.name} file cannot be accessed: ${p.file_path}`)
        return true
      }
      return false
    })
    console.log(`Found ${projectsWithInvalidFiles.length} projects with missing/invalid source files`)

    // Step 2: Delete empty projects, duplicates, AND projects with invalid files
    const deleteProjectStmt = this.db.prepare('DELETE FROM projects WHERE id = ?')
    const deleteManyProjects = this.db.transaction((projectIds: string[]) => {
      for (const projectId of projectIds) {
        deleteProjectStmt.run(projectId)
      }
    })

    const projectsToDelete = [
      ...emptyProjects.map((p: any) => p.id),
      ...duplicatesToDelete.map((p: any) => p.id),
      ...projectsWithInvalidFiles.map((p: any) => p.id)
    ]

    // Remove duplicates from the deletion list
    const uniqueProjectsToDelete = [...new Set(projectsToDelete)]

    if (uniqueProjectsToDelete.length > 0) {
      deleteManyProjects(uniqueProjectsToDelete)
      console.log(`Deleted ${emptyProjects.length} empty projects, ${duplicatesToDelete.length} duplicates, and ${projectsWithInvalidFiles.length} projects with invalid files`)
    }

    // Step 3: Clean up orphaned episodes
    const deleteOrphanedEpisodes = this.db.prepare(`
      DELETE FROM episodes WHERE project_id NOT IN (SELECT id FROM projects)
    `)
    const orphanedEpisodesResult = deleteOrphanedEpisodes.run()
    console.log(`Deleted ${orphanedEpisodesResult.changes} orphaned episodes`)

    // Step 4: Clean up orphaned clips
    const deleteOrphanedClips = this.db.prepare(`
      DELETE FROM clips WHERE episode_id NOT IN (SELECT id FROM episodes)
    `)
    const orphanedClipsResult = deleteOrphanedClips.run()
    console.log(`Deleted ${orphanedClipsResult.changes} orphaned clips`)

    // Step 5: Clean up orphaned transcript segments
    const deleteOrphanedSegments = this.db.prepare(`
      DELETE FROM transcript_segments WHERE episode_id NOT IN (SELECT id FROM episodes)
    `)
    const orphanedSegmentsResult = deleteOrphanedSegments.run()
    console.log(`Deleted ${orphanedSegmentsResult.changes} orphaned transcript segments`)

    console.log('Database cleanup completed')

    return {
      deletedProjects: emptyProjects.length,
      deletedDuplicates: duplicatesToDelete.length,
      deletedInvalidFiles: projectsWithInvalidFiles.length,
      deletedEpisodes: orphanedEpisodesResult.changes,
      deletedClips: orphanedClipsResult.changes,
      deletedSegments: orphanedSegmentsResult.changes
    }
  }

  // Get episode by project ID (fallback for ID confusion)
  getEpisodeByProjectId(projectId: string) {
    const stmt = this.db.prepare('SELECT * FROM episodes WHERE project_id = ? LIMIT 1')
    return stmt.get(projectId)
  }

  nukeAllProjects() {
    const tables = [
      'transcript_segments',
      'content_packages',
      'exports',
      'clips',
      'episodes',
      'projects'
    ];

    let deletedCount = 0;
    tables.forEach(table => {
      try {
        this.db.exec(`DELETE FROM ${table}`);
        deletedCount++;
        console.log(`Deleted from ${table}`);
      } catch (error) {
        console.warn(`Table ${table} does not exist, skipping...`);
      }
    });

    return { success: true, message: `Nuked ${deletedCount} tables successfully` };
  }

  // Delete a single project (cascades to episodes, clips, transcripts)
  deleteProject(projectId: string) {
    const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?');
    const result = stmt.run(projectId);
    console.log(`Deleted project ${projectId}, affected rows: ${result.changes}`);
    return { success: true, deletedRows: result.changes };
  }

  // Utility methods
  close() {
    this.db.close()
  }

  vacuum() {
    this.db.exec('VACUUM')
  }
}

// Export singleton instance
export const database = new DatabaseManager()
