// One-shot script: read /tmp/migrations.json (downloaded from Supabase Management API)
// and write each migration as a separate file under supabase/migrations/.
// File name format: {version}_{name}.sql

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || '/tmp/migrations.json';
const DEST = process.argv[3] || 'supabase/migrations';

const raw = fs.readFileSync(SRC, 'utf8');
const migrations = JSON.parse(raw);

if (!Array.isArray(migrations)) {
  console.error('Expected array, got:', typeof migrations);
  process.exit(1);
}

console.log(`Loaded ${migrations.length} migrations`);

let written = 0;
for (const m of migrations) {
  if (!m.version || !m.name || !Array.isArray(m.statements)) {
    console.warn(`Skipping invalid entry: ${JSON.stringify(m).slice(0, 100)}`);
    continue;
  }
  // Sanitize name for filename (replace special chars)
  const safeName = String(m.name).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${m.version}_${safeName}.sql`;
  const filepath = path.join(DEST, filename);

  // Concatenate statements with separator
  const sql = m.statements.join('\n\n-- ── statement separator ──\n\n');
  const header = `-- Migration: ${m.name}\n-- Version: ${m.version}\n-- Source: production schema_migrations (auto-extracted ${new Date().toISOString().slice(0,10)})\n\n`;

  fs.writeFileSync(filepath, header + sql);
  written++;
}

console.log(`Wrote ${written} migration files to ${DEST}`);
