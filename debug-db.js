// Quick script to check if clip edits are in the database
const Database = require('better-sqlite3');
const { app } = require('electron');
const path = require('path');

// This will show you what's in the clip_edits table
const dbPath = path.join(process.env.HOME, 'Library/Application Support/ariadne/ariadne.db');
console.log('Database path:', dbPath);

const db = new Database(dbPath, { readonly: true });

// Get all clip edits
const edits = db.prepare('SELECT * FROM clip_edits').all();
console.log('\n=== CLIP EDITS IN DATABASE ===');
console.log(`Found ${edits.length} clips with edits\n`);

edits.forEach((edit, i) => {
  console.log(`Clip ${i + 1}: ${edit.clip_id}`);
  console.log(`  Captions enabled: ${edit.captions_enabled}`);
  console.log(`  Caption font: ${edit.caption_font}`);
  console.log(`  Caption size: ${edit.caption_size}`);
  console.log(`  Caption segments: ${edit.caption_segments ? `${JSON.parse(edit.caption_segments).length} segments` : 'none'}`);
  console.log(`  Logo enabled: ${edit.logo_enabled}`);
  console.log(`  Logo path: ${edit.logo_path}`);
  console.log(`  Music enabled: ${edit.music_enabled}`);
  console.log(`  Music path: ${edit.music_path}`);
  console.log(`  Aspect ratio: ${edit.aspect_ratio}`);
  console.log(`  Crop mode: ${edit.crop_mode}`);
  console.log('');
});

db.close();
