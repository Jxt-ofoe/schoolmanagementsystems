const fs = require('fs');
const path = require('path');

const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
const outputFile = path.resolve(__dirname, '../supabase/full_schema_backup.sql');

const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

console.log('Generating master schema backup from migrations:');
files.forEach(f => console.log(' - ' + f));

let combined = `-- =============================================================================\n`;
combined += `-- SCHOOL MANAGEMENT SYSTEM - FULL MASTER DATABASE SCHEMA BACKUP\n`;
combined += `-- Generated: ${new Date().toISOString()}\n`;
combined += `-- Contains: Core Schema, Triggers, RLS Policies, RPCs, Security, & Major Features\n`;
combined += `-- =============================================================================\n\n`;

for (const file of files) {
  const filePath = path.join(migrationsDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  combined += `\n-- -----------------------------------------------------------------------------\n`;
  combined += `-- MIGRATION: ${file}\n`;
  combined += `-- -----------------------------------------------------------------------------\n\n`;
  combined += content;
  combined += `\n\n`;
}

fs.writeFileSync(outputFile, combined, 'utf8');
console.log(`\nSuccessfully generated: ${outputFile} (${(combined.length / 1024).toFixed(1)} KB)`);
