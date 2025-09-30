import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync, mkdirSync, statSync } from 'fs'

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
        file_path TEXT NOT NULL,
        format TEXT NOT NULL,
        resolution TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
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

    // Update user_version if needed
    this.db.pragma('user_version = 2'); // Bump version after migration
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
  
  getEpisode(id: string) {
    const stmt = this.db.prepare('SELECT * FROM episodes WHERE id = ?')
    return stmt.get(id)
  }
  
  getAllEpisodes() {
    const stmt = this.db.prepare('SELECT id, file_name FROM episodes')
    return stmt.all()
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
  }>) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO transcript_segments 
      (id, episode_id, start_time, end_time, text, confidence, speaker, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    return stmt.all(episodeId)
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
  }>) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO clips 
      (id, episode_id, start_time, end_time, duration, content_type, shareability_score, 
       key_quote, reason, context_needed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  
  getClips(episodeId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM clips 
      WHERE episode_id = ? 
      ORDER BY shareability_score DESC, start_time ASC
    `)
    return stmt.all(episodeId)
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
      INSERT INTO clip_titles (id, clip_id, title, is_selected, created_at)
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
      INSERT INTO clip_descriptions (id, clip_id, description, platform, is_selected, created_at)
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