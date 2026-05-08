#!/usr/bin/env node
require('dotenv').config();

const { Pool } = require('pg');
const r2Storage = require('../lib/r2-storage');

function getDatabaseSslConfig(connectionString) {
  const raw = String(connectionString || '').trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const host = String(url.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return false;
    if (host.endsWith('.railway.internal') || host.endsWith('.rlwy.net') || process.env.NODE_ENV === 'production') {
      return { rejectUnauthorized: false };
    }
  } catch (_) {
    if (process.env.NODE_ENV === 'production') return { rejectUnauthorized: false };
  }
  return false;
}

function audioContentType(fileName = '') {
  const lower = String(fileName).toLowerCase();
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  return 'audio/mpeg';
}

function safeAudioName(file, index) {
  const raw = String(file?.name || file?.label || `audio-${index + 1}`)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9._-]/gi, '-')
    .slice(0, 80);
  return raw || `audio-${index + 1}`;
}

async function migrateAssignments(pool, dryRun) {
  const result = await pool.query(`
    SELECT id, assignment_image, answer_key_image, assignment_image_key, answer_key_image_key, audio_files
    FROM assignments
    ORDER BY id
  `);
  let migrated = 0;

  for (const row of result.rows) {
    const updates = {};
    if (!row.assignment_image_key && row.assignment_image) {
      updates.assignment_image_key = `assignments/${row.id}/blank.jpg`;
      if (!dryRun) await r2Storage.putBase64(updates.assignment_image_key, row.assignment_image, 'image/jpeg');
    }
    if (!row.answer_key_image_key && row.answer_key_image) {
      updates.answer_key_image_key = `assignments/${row.id}/answer-key.jpg`;
      if (!dryRun) await r2Storage.putBase64(updates.answer_key_image_key, row.answer_key_image, 'image/jpeg');
    }

    const audioFiles = Array.isArray(row.audio_files) ? row.audio_files : [];
    const storedAudio = [];
    let audioChanged = false;
    for (let index = 0; index < audioFiles.length; index++) {
      const file = audioFiles[index];
      if (file?.key) {
        storedAudio.push(file);
        continue;
      }
      if (!file?.data) {
        storedAudio.push(file);
        continue;
      }
      audioChanged = true;
      const name = safeAudioName(file, index);
      const key = `assignments/${row.id}/audio/${name}.mp3`;
      if (!dryRun) await r2Storage.putBase64(key, file.data, audioContentType(name));
      storedAudio.push({
        name: file.name || name,
        label: file.label || file.name || name,
        key,
        content_type: audioContentType(name)
      });
    }

    if (Object.keys(updates).length || audioChanged) {
      migrated += 1;
      if (!dryRun) {
        await pool.query(`
          UPDATE assignments
          SET assignment_image = CASE WHEN $1::text IS NULL THEN assignment_image ELSE '' END,
              answer_key_image = CASE WHEN $2::text IS NULL THEN answer_key_image ELSE '' END,
              assignment_image_key = COALESCE($1, assignment_image_key),
              answer_key_image_key = COALESCE($2, answer_key_image_key),
              audio_files = $3
          WHERE id = $4`,
          [
            updates.assignment_image_key || null,
            updates.answer_key_image_key || null,
            JSON.stringify(audioChanged ? storedAudio : audioFiles),
            row.id
          ]
        );
      }
    }
  }

  return migrated;
}

async function migrateVocabPages(pool, dryRun) {
  const result = await pool.query(`
    SELECT id, exam_id, page_number, blank_image, answer_key_image, blank_image_key, answer_key_image_key
    FROM vocab_exam_pages
    ORDER BY exam_id, page_number
  `);
  let migrated = 0;

  for (const row of result.rows) {
    const blankKey = !row.blank_image_key && row.blank_image
      ? `vocab/exams/${row.exam_id}/pages/${row.page_number}/blank.jpg`
      : null;
    const answerKey = !row.answer_key_image_key && row.answer_key_image
      ? `vocab/exams/${row.exam_id}/pages/${row.page_number}/answer-key.jpg`
      : null;

    if (!blankKey && !answerKey) continue;
    migrated += 1;
    if (!dryRun) {
      if (blankKey) await r2Storage.putBase64(blankKey, row.blank_image, 'image/jpeg');
      if (answerKey) await r2Storage.putBase64(answerKey, row.answer_key_image, 'image/jpeg');
      await pool.query(`
        UPDATE vocab_exam_pages
        SET blank_image = CASE WHEN $1::text IS NULL THEN blank_image ELSE '' END,
            answer_key_image = CASE WHEN $2::text IS NULL THEN answer_key_image ELSE '' END,
            blank_image_key = COALESCE($1, blank_image_key),
            answer_key_image_key = COALESCE($2, answer_key_image_key)
        WHERE id = $3`,
        [blankKey, answerKey, row.id]
      );
    }
  }

  return migrated;
}

async function clearHistoricalSubmissionImages(pool, dryRun) {
  if (dryRun) {
    const [main, legacy, vocab] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM student_submissions WHERE COALESCE(submission_image, '') <> ''"),
      pool.query("SELECT COUNT(*)::int AS count FROM grading_results WHERE COALESCE(original_image, '') <> ''"),
      pool.query("SELECT COUNT(*)::int AS count FROM vocab_submissions WHERE jsonb_array_length(submission_images) > 0")
    ]);
    return {
      studentSubmissions: main.rows[0].count,
      gradingResults: legacy.rows[0].count,
      vocabSubmissions: vocab.rows[0].count
    };
  }

  const [main, legacy, vocab] = await Promise.all([
    pool.query("UPDATE student_submissions SET submission_image = NULL WHERE COALESCE(submission_image, '') <> ''"),
    pool.query("UPDATE grading_results SET original_image = NULL WHERE COALESCE(original_image, '') <> ''"),
    pool.query("UPDATE vocab_submissions SET submission_images = '[]'::jsonb WHERE jsonb_array_length(submission_images) > 0")
  ]);
  return {
    studentSubmissions: main.rowCount,
    gradingResults: legacy.rowCount,
    vocabSubmissions: vocab.rowCount
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  if (!r2Storage.isConfigured()) {
    throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: getDatabaseSslConfig(process.env.DATABASE_URL)
  });

  try {
    console.log(`${dryRun ? '[dry-run] ' : ''}Migrating assignment assets...`);
    const assignments = await migrateAssignments(pool, dryRun);
    console.log(`${dryRun ? '[dry-run] ' : ''}Assignments needing migration: ${assignments}`);

    console.log(`${dryRun ? '[dry-run] ' : ''}Migrating vocab page assets...`);
    const vocabPages = await migrateVocabPages(pool, dryRun);
    console.log(`${dryRun ? '[dry-run] ' : ''}Vocab pages needing migration: ${vocabPages}`);

    console.log(`${dryRun ? '[dry-run] ' : ''}Clearing historical submission images...`);
    const cleared = await clearHistoricalSubmissionImages(pool, dryRun);
    console.log(`${dryRun ? '[dry-run] ' : ''}Historical submission image rows:`, cleared);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
