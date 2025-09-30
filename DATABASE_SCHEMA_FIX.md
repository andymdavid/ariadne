# Database Schema Fix - Ariadne Project Structure

## Issue Summary
The current database implementation incorrectly stores each clip as a separate project entry, causing 10 duplicate "partial" projects to appear in the Library for a single processed file with 10 clips.

## Root Cause Analysis
During processing completion in `useProcessingUpdates.ts`, the system calls:
```typescript
const clips = await window.electronAPI.getEpisodeClips(data.episodeId)
```

The backend `getRecentProjects()` method appears to be returning one "project" entry per clip instead of properly aggregating clips under their parent project/episode.

## Current Problematic Behavior
- **Input**: 1 video file processed → generates 10 clips
- **Expected Database**: 1 project record with 10 associated clip records
- **Actual Database**: 10 separate project records, each with 0 clips

## Required Database Schema Corrections

### 1. Project-Episode-Clip Relationship
The database should maintain proper foreign key relationships:

```sql
-- Projects table (one per processed file)
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT,
    file_size INTEGER,
    duration INTEGER,
    transcript TEXT,
    processing_status TEXT CHECK(processing_status IN ('uploading', 'transcribing', 'analyzing', 'completed', 'failed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Episodes table (typically one per project, but allows for multi-episode projects)
CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Clips table (many per episode)
CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    duration REAL NOT NULL,
    content_type TEXT CHECK(content_type IN ('insight', 'story', 'advice', 'hot_take', 'humor', 'technical')),
    shareability_score REAL,
    key_quote TEXT,
    reason TEXT,
    context_needed TEXT CHECK(context_needed IN ('low', 'medium', 'high')),
    status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);
```

### 2. Backend Method Corrections

#### Fix `getRecentProjects()` Method
Currently returns one record per clip. Should return aggregated project data:

```typescript
// INCORRECT (current behavior)
// Returns: [clip1_as_project, clip2_as_project, ..., clip10_as_project]

// CORRECT (required behavior)
async getRecentProjects(): Promise<ProjectSummary[]> {
    return await db.query(`
        SELECT 
            p.id,
            p.name,
            p.filename,
            p.created_at,
            p.updated_at,
            p.duration,
            p.file_size,
            p.processing_status,
            COUNT(c.id) as clip_count,
            LENGTH(p.transcript) as transcript_length
        FROM projects p
        LEFT JOIN episodes e ON p.id = e.project_id
        LEFT JOIN clips c ON e.id = c.episode_id
        GROUP BY p.id
        ORDER BY p.updated_at DESC
        LIMIT 50
    `);
}
```

#### Fix `getEpisodeClips()` Method
Should return clips with proper episode metadata:

```typescript
async getEpisodeClips(episodeId: string): Promise<ClipWithEpisode[]> {
    return await db.query(`
        SELECT 
            c.*,
            e.title as episode_title,
            e.description as episode_description,
            e.project_id,
            p.name as project_name,
            p.filename as project_filename
        FROM clips c
        JOIN episodes e ON c.episode_id = e.id
        JOIN projects p ON e.project_id = p.id
        WHERE c.episode_id = ?
        ORDER BY c.start_time ASC
    `, [episodeId]);
}
```

### 3. Processing Pipeline Corrections

#### Fix Project Creation in Processing Pipeline
Ensure single project creation during processing:

```typescript
// In processingPipeline.ts - during project setup
async function createProject(filePath: string, projectName?: string): Promise<{projectId: string, episodeId: string}> {
    // Create single project record
    const projectId = generateId();
    await db.insert('projects', {
        id: projectId,
        name: projectName || path.basename(filePath),
        filename: path.basename(filePath),
        file_path: filePath,
        processing_status: 'uploading'
    });
    
    // Create single episode record
    const episodeId = generateId();
    await db.insert('episodes', {
        id: episodeId,
        project_id: projectId,
        title: projectName || path.basename(filePath),
        description: 'Generated from uploaded content'
    });
    
    return { projectId, episodeId };
}

// During clip storage - store ALL clips under the SAME episode
async function storeClips(episodeId: string, clips: Clip[]): Promise<void> {
    for (const clip of clips) {
        await db.insert('clips', {
            ...clip,
            episode_id: episodeId // Same episode for all clips!
        });
    }
}
```

### 4. Data Migration Script

To fix existing corrupted data:

```sql
-- Step 1: Identify corrupted projects (projects with 0 clips)
SELECT p.id, p.name, COUNT(c.id) as clip_count 
FROM projects p 
LEFT JOIN episodes e ON p.id = e.project_id 
LEFT JOIN clips c ON e.id = c.episode_id 
GROUP BY p.id 
HAVING clip_count = 0;

-- Step 2: Delete corrupted empty projects
DELETE FROM projects 
WHERE id IN (
    SELECT p.id FROM projects p 
    LEFT JOIN episodes e ON p.id = e.project_id 
    LEFT JOIN clips c ON e.id = c.episode_id 
    GROUP BY p.id 
    HAVING COUNT(c.id) = 0
);

-- Step 3: Clean up orphaned episodes and clips
DELETE FROM episodes WHERE project_id NOT IN (SELECT id FROM projects);
DELETE FROM clips WHERE episode_id NOT IN (SELECT id FROM episodes);
```

### 5. Validation Queries

After fixing, these queries should return expected results:

```sql
-- Should return 1 project with 10 clips (not 10 projects with 0 clips)
SELECT 
    p.name,
    COUNT(DISTINCT e.id) as episode_count,
    COUNT(c.id) as clip_count
FROM projects p
LEFT JOIN episodes e ON p.id = e.project_id
LEFT JOIN clips c ON e.id = c.episode_id
GROUP BY p.id;

-- Should show proper clip distribution
SELECT 
    p.name,
    c.id as clip_id,
    c.start_time,
    c.end_time,
    c.content_type
FROM projects p
JOIN episodes e ON p.id = e.project_id
JOIN clips c ON e.id = c.episode_id
ORDER BY p.name, c.start_time;
```

## Implementation Priority

1. **High Priority**: Fix `getRecentProjects()` aggregation
2. **High Priority**: Fix processing pipeline to create single project
3. **Medium Priority**: Run data migration script to clean corrupted data
4. **Low Priority**: Add database constraints to prevent future issues

## Testing Plan

1. Process a new file and verify single project is created
2. Verify clips are properly associated with the project
3. Verify Library page shows 1 project with correct clip count
4. Verify navigation to project shows all clips properly

## Re-enabling Database Loading

Once fixed, re-enable in `LibraryPage.tsx` line 33:
```typescript
// Change from:
if (false && window.electronAPI?.getRecentProjects) {
// Back to:
if (window.electronAPI?.getRecentProjects) {
```

This will restore full database integration with proper project aggregation.