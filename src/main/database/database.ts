import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync, mkdirSync } from 'fs'

class DatabaseManager {
  private db: Database.Database
  
  constructor() {
    const userDataPath = app.getPath('userData')
    const dbPath = join(userDataPath, 'ariadne.db')
    
    // Ensure the directory exists
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }
    
    // Initialize database
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    
    this.initializeSchema()
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