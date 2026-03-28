require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const path = require('path');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Database ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- Database Initialization ---
async function initDB() {
  const client = await pool.connect();
  try {
    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS answer_keys (
        id SERIAL PRIMARY KEY,
        teacher_name VARCHAR(100) NOT NULL,
        name VARCHAR(200) NOT NULL,
        mode VARCHAR(10) DEFAULT 'simple',
        template_image TEXT,
        image_width INTEGER DEFAULT 0,
        image_height INTEGER DEFAULT 0,
        questions JSONB NOT NULL,
        settings JSONB DEFAULT '{}',
        total_points INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS grading_results (
        id SERIAL PRIMARY KEY,
        answer_key_id INTEGER REFERENCES answer_keys(id) ON DELETE CASCADE,
        student_name VARCHAR(100),
        original_image TEXT NOT NULL,
        graded_image TEXT,
        answers JSONB NOT NULL,
        total_score INTEGER NOT NULL,
        total_possible INTEGER NOT NULL,
        graded_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Migrations (idempotent)
    await client.query(`ALTER TABLE answer_keys ALTER COLUMN image_width SET DEFAULT 0`).catch(() => {});
    await client.query(`ALTER TABLE answer_keys ALTER COLUMN image_height SET DEFAULT 0`).catch(() => {});
    await client.query(`ALTER TABLE answer_keys ALTER COLUMN image_width DROP NOT NULL`).catch(() => {});
    await client.query(`ALTER TABLE answer_keys ALTER COLUMN image_height DROP NOT NULL`).catch(() => {});
    await client.query(`ALTER TABLE answer_keys ADD COLUMN IF NOT EXISTS mode VARCHAR(10) DEFAULT 'simple'`).catch(() => {});

    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}

// ============================================================
// OCR helpers
// ============================================================

async function callVisionAPI(imageBase64) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey || apiKey === 'YOUR_KEY_HERE') throw new Error('Google Vision API key not configured');

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ image: { content: imageBase64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }] }]
    })
  });
  if (!res.ok) throw new Error('Google Vision API request failed');
  const data = await res.json();
  const annotation = data.responses?.[0];
  if (annotation?.error) throw new Error(`Vision API: ${annotation.error.message}`);
  return annotation;
}

// OCR a specific cropped region
async function ocrRegion(imageBase64, region) {
  const imageBuffer = Buffer.from(imageBase64, 'base64');
  const metadata = await sharp(imageBuffer).metadata();
  const x = Math.max(0, Math.round(region.x));
  const y = Math.max(0, Math.round(region.y));
  const width = Math.min(Math.round(region.width), metadata.width - x);
  const height = Math.min(Math.round(region.height), metadata.height - y);

  const cropped = await sharp(imageBuffer)
    .extract({ left: x, top: y, width, height })
    .sharpen().normalize().png().toBuffer();

  const annotation = await callVisionAPI(cropped.toString('base64'));
  const fullText = annotation?.fullTextAnnotation?.text || '';
  const confidence = annotation?.fullTextAnnotation?.pages?.[0]?.confidence || 0;
  return { text: fullText.trim().replace(/\n/g, ' '), confidence };
}

// OCR a full page, returns raw text
async function ocrFullPage(imageBase64) {
  // Pre-process: auto-rotate + resize to max 2400px to reduce API payload
  const buf = Buffer.from(imageBase64, 'base64');
  const processed = await sharp(buf)
    .rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();

  const annotation = await callVisionAPI(processed.toString('base64'));
  return annotation?.fullTextAnnotation?.text || '';
}

// ============================================================
// Answer extraction helpers
// ============================================================

// Detect question type from a given answer string
function detectAnswerType(answer) {
  const lower = answer.toLowerCase().trim();
  const tfValues = new Set(['t', 'f', 'true', 'false', 'yes', 'no', 'o', 'x']);
  if (tfValues.has(lower)) return 'true_false';
  if (lower.split(/\s+/).length === 1) return 'fill_blank';
  return 'short_answer';
}

// Parse a block of text into structured answers
// Handles: "1. T", "1) apple", "(1) cat", "Q1. yes", "1：answer"
function parseAnswersFromText(text) {
  const answers = [];
  const seen = new Set();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    const match = line.match(/^(?:[Qq])?[\(（]?(\d{1,3})[\)）\.：:\s、]\s*(.{1,200})$/);
    if (!match) continue;
    const num = parseInt(match[1]);
    const answer = match[2].trim().replace(/\s+/g, ' ');
    if (num < 1 || num > 200 || answer.length === 0 || seen.has(num)) continue;
    seen.add(num);
    answers.push({ number: num, correct_answer: answer, type: detectAnswerType(answer), points: 1, alt_answers: [] });
  }

  answers.sort((a, b) => a.number - b.number);
  return answers;
}

// Extract student answers from full-page OCR text, keyed by question number
function extractStudentAnswers(ocrText, questions) {
  const answers = {};
  const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const maxQ = Math.max(...questions.map(q => q.number), 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(?:[Qq])?[\(（]?(\d{1,3})[\)）\.：:\s、]\s*(.*)?$/);
    if (!match) continue;
    const num = parseInt(match[1]);
    if (num < 1 || num > maxQ || answers[num]) continue;

    const q = questions.find(q => q.number === num);
    if (!q) continue;

    const inline = (match[2] || '').trim();

    if (q.type === 'true_false') {
      // Try inline first, then next line
      const combined = inline + ' ' + (lines[i + 1] || '');
      const tf = combined.match(/\b([TtFf])\b|true|false|True|False|TRUE|FALSE/);
      if (tf) answers[num] = (tf[1] || tf[0]).trim();
    } else {
      if (inline.length > 0 && inline.length < 150) {
        answers[num] = inline;
      } else {
        // Check next 1-2 lines for a short answer that doesn't start with a question number
        for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
          const nextLine = lines[j];
          if (nextLine.length > 0 && nextLine.length < 120 && !nextLine.match(/^[\(（]?\d+[\)）\.\s]/)) {
            answers[num] = nextLine;
            break;
          }
        }
      }
    }
  }

  return answers;
}

// ============================================================
// Matching engine
// ============================================================

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function normalizeText(text, settings) {
  let s = text.trim();
  if (!settings.case_sensitive) s = s.toLowerCase();
  if (settings.ignore_punctuation) s = s.replace(/[.,!?;:'"()\-]/g, '').trim();
  return s.replace(/\s+/g, ' ');
}

const TF_TRUE = new Set(['t', 'true', 'yes', 'o', 'v', '✓', '✔']);
const TF_FALSE = new Set(['f', 'false', 'no', 'x', '✗', '✘']);

function normalizeTF(text) {
  const lower = text.toLowerCase().trim();
  if (TF_TRUE.has(lower)) return 'true';
  if (TF_FALSE.has(lower)) return 'false';
  return lower;
}

function matchAnswer(detectedText, question, settings) {
  const detected = normalizeText(detectedText, settings);
  const correct = normalizeText(question.correct_answer, settings);

  if (question.type === 'true_false') {
    const d = normalizeTF(detected), c = normalizeTF(correct);
    return { correct: d === c, score: d === c ? question.points : 0, detected_text: detectedText, match_type: 'true_false' };
  }
  if (detected === correct) {
    return { correct: true, score: question.points, detected_text: detectedText, match_type: 'exact' };
  }
  for (const alt of (question.alt_answers || [])) {
    if (detected === normalizeText(alt, settings)) {
      return { correct: true, score: question.points, detected_text: detectedText, match_type: 'alt_answer' };
    }
  }
  const threshold = question.fuzzy_threshold ?? settings.fuzzy_default_threshold ?? 0;
  if (threshold > 0) {
    const sim = similarity(detected, correct);
    if (sim >= threshold) {
      return { correct: true, score: question.points, detected_text: detectedText, match_type: 'fuzzy', similarity: sim };
    }
  }
  return { correct: false, score: 0, detected_text: detectedText, match_type: 'no_match', similarity: similarity(detected, correct) };
}

// ============================================================
// Core grading logic (shared by single + batch)
// ============================================================

async function gradeStudent({ answerKey, studentImage, studentName }) {
  const questions = answerKey.questions;
  const settings = { case_sensitive: false, ignore_punctuation: true, fuzzy_default_threshold: 0.7, ...answerKey.settings };
  const mode = answerKey.mode || 'simple';

  const studentBuffer = Buffer.from(studentImage, 'base64');
  const processedBuffer = await sharp(studentBuffer).rotate().png().toBuffer();
  const processedBase64 = processedBuffer.toString('base64');

  const answers = [];
  let totalScore = 0;

  if (mode === 'roi') {
    // Legacy ROI-based grading
    for (const question of questions) {
      try {
        const ocrResult = await ocrRegion(processedBase64, question.region);
        const matchResult = matchAnswer(ocrResult.text, question, settings);
        matchResult.confidence = ocrResult.confidence;
        matchResult.question_number = question.number;
        answers.push(matchResult);
        totalScore += matchResult.score;
      } catch (err) {
        answers.push({ correct: false, score: 0, detected_text: '[OCR failed]', match_type: 'error', question_number: question.number });
      }
    }
  } else {
    // Simple full-page OCR mode
    const ocrText = await ocrFullPage(processedBase64);
    const studentAnswers = extractStudentAnswers(ocrText, questions);

    for (const question of questions) {
      const detectedText = studentAnswers[question.number] || '';
      const matchResult = matchAnswer(detectedText, question, settings);
      matchResult.question_number = question.number;
      matchResult.needs_review = detectedText === '';
      answers.push(matchResult);
      totalScore += matchResult.score;
    }
  }

  return { answers, totalScore, totalPossible: answerKey.total_points, studentName };
}

// ============================================================
// API Routes
// ============================================================

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// --- Answer Keys CRUD ---

app.post('/api/answer-keys', async (req, res) => {
  try {
    const { teacher_name, name, mode = 'simple', template_image, image_width = 0, image_height = 0, questions, settings } = req.body;
    if (!teacher_name || !name || !questions) {
      return res.status(400).json({ error: 'Missing required fields: teacher_name, name, questions' });
    }
    const total_points = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    const result = await pool.query(
      `INSERT INTO answer_keys (teacher_name, name, mode, template_image, image_width, image_height, questions, settings, total_points)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [teacher_name, name, mode, template_image || null, image_width, image_height, JSON.stringify(questions), JSON.stringify(settings || {}), total_points]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create answer key error:', err);
    res.status(500).json({ error: 'Failed to create answer key' });
  }
});

app.get('/api/answer-keys', async (req, res) => {
  try {
    const { teacher_name } = req.query;
    let query = 'SELECT id, teacher_name, name, mode, image_width, image_height, total_points, created_at FROM answer_keys';
    const params = [];
    if (teacher_name) { query += ' WHERE teacher_name = $1'; params.push(teacher_name); }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List answer keys error:', err);
    res.status(500).json({ error: 'Failed to list answer keys' });
  }
});

app.get('/api/answer-keys/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM answer_keys WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Answer key not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get answer key' });
  }
});

app.delete('/api/answer-keys/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM answer_keys WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Answer key not found' });
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete answer key' });
  }
});

// --- Document Parsing (PDF / DOCX → structured answers) ---

app.post('/api/parse-document', async (req, res) => {
  try {
    const { data, type } = req.body;  // data: base64, type: 'pdf' | 'docx'
    if (!data || !type) return res.status(400).json({ error: 'Missing data or type' });

    const buffer = Buffer.from(data, 'base64');
    let text = '';

    if (type === 'pdf') {
      // PDF must use files:annotate (not images:annotate) with inputConfig
      const apiKey = process.env.GOOGLE_VISION_API_KEY;
      if (!apiKey || apiKey === 'YOUR_KEY_HERE') return res.status(500).json({ error: 'Google Vision API key not configured' });
      const visionRes = await fetch(`https://vision.googleapis.com/v1/files:annotate?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            inputConfig: { content: data, mimeType: 'application/pdf' },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            pages: [1, 2, 3, 4, 5]
          }]
        })
      });
      const visionData = await visionRes.json();
      const resp = visionData.responses?.[0];
      if (resp?.error) return res.status(500).json({ error: 'Vision API: ' + resp.error.message });
      // files:annotate returns responses per page; join all pages
      text = (resp?.responses || []).map(r => r.fullTextAnnotation?.text || '').join('\n');
    } else if (type === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use pdf or docx.' });
    }

    const answers = parseAnswersFromText(text);
    res.json({ text: text.slice(0, 5000), answers });
  } catch (err) {
    console.error('Parse document error:', err);
    res.status(500).json({ error: 'Failed to parse document: ' + err.message });
  }
});

// --- OCR ---

app.post('/api/ocr/region', async (req, res) => {
  try {
    const { image, region } = req.body;
    if (!image || !region) return res.status(400).json({ error: 'Missing image or region' });
    const result = await ocrRegion(image, region);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/convert-heic', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Missing image' });
    const inputBuffer = Buffer.from(image, 'base64');
    const jpegBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.9 });
    const rotated = await sharp(Buffer.from(jpegBuffer)).rotate().jpeg({ quality: 90 }).toBuffer();
    res.json({ image: rotated.toString('base64') });
  } catch (err) {
    console.error('HEIC conversion error:', err);
    res.status(500).json({ error: 'Failed to convert HEIC: ' + err.message });
  }
});

// --- Grading ---

app.post('/api/grade', async (req, res) => {
  try {
    const { answer_key_id, student_image, student_name } = req.body;
    if (!answer_key_id || !student_image) return res.status(400).json({ error: 'Missing answer_key_id or student_image' });

    const keyResult = await pool.query('SELECT * FROM answer_keys WHERE id = $1', [answer_key_id]);
    if (keyResult.rows.length === 0) return res.status(404).json({ error: 'Answer key not found' });
    const answerKey = keyResult.rows[0];

    const { answers, totalScore, totalPossible } = await gradeStudent({ answerKey, studentImage: student_image, studentName: student_name });

    const saveResult = await pool.query(
      `INSERT INTO grading_results (answer_key_id, student_name, original_image, answers, total_score, total_possible)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [answer_key_id, student_name || null, student_image, JSON.stringify(answers), totalScore, totalPossible]
    );

    res.json({
      id: saveResult.rows[0].id,
      answers,
      total_score: totalScore,
      total_possible: totalPossible,
      percentage: Math.round((totalScore / totalPossible) * 100)
    });
  } catch (err) {
    console.error('Grade error:', err);
    res.status(500).json({ error: 'Grading failed: ' + err.message });
  }
});

app.post('/api/grade/batch', async (req, res) => {
  try {
    const { answer_key_id, students } = req.body;
    if (!answer_key_id || !Array.isArray(students)) return res.status(400).json({ error: 'Missing answer_key_id or students array' });

    const keyResult = await pool.query('SELECT * FROM answer_keys WHERE id = $1', [answer_key_id]);
    if (keyResult.rows.length === 0) return res.status(404).json({ error: 'Answer key not found' });
    const answerKey = keyResult.rows[0];

    const results = [];
    for (const student of students) {
      try {
        const { answers, totalScore, totalPossible } = await gradeStudent({ answerKey, studentImage: student.image, studentName: student.name });
        const saveResult = await pool.query(
          `INSERT INTO grading_results (answer_key_id, student_name, original_image, answers, total_score, total_possible)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [answer_key_id, student.name || null, student.image, JSON.stringify(answers), totalScore, totalPossible]
        );
        results.push({ id: saveResult.rows[0].id, student_name: student.name, answers, total_score: totalScore, total_possible: totalPossible, percentage: Math.round((totalScore / totalPossible) * 100) });
      } catch (err) {
        results.push({ student_name: student.name, error: err.message });
      }
    }

    res.json({ results, graded_count: results.filter(r => !r.error).length, total_count: students.length });
  } catch (err) {
    console.error('Batch grade error:', err);
    res.status(500).json({ error: 'Batch grading failed' });
  }
});

// --- Results & Analysis ---

app.get('/api/results/:answerKeyId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, student_name, answers, total_score, total_possible, graded_at
       FROM grading_results WHERE answer_key_id = $1 ORDER BY graded_at DESC`,
      [req.params.answerKeyId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get results' });
  }
});

app.get('/api/results/:answerKeyId/analysis', async (req, res) => {
  try {
    const keyResult = await pool.query('SELECT * FROM answer_keys WHERE id = $1', [req.params.answerKeyId]);
    if (keyResult.rows.length === 0) return res.status(404).json({ error: 'Answer key not found' });
    const answerKey = keyResult.rows[0];
    const questions = answerKey.questions;

    const resultsData = await pool.query(
      'SELECT student_name, answers, total_score, total_possible FROM grading_results WHERE answer_key_id = $1 ORDER BY total_score DESC',
      [req.params.answerKeyId]
    );
    const results = resultsData.rows;

    if (results.length === 0) return res.json({ question_stats: [], student_stats: [], total_students: 0, class_average: 0 });

    // Per-question stats
    const question_stats = questions.map(q => {
      let correctCount = 0;
      const mistakes = {};
      for (const r of results) {
        const a = r.answers.find(a => a.question_number === q.number);
        if (!a) continue;
        if (a.correct) {
          correctCount++;
        } else {
          const key = (a.detected_text || '(blank)').toLowerCase().trim().slice(0, 30);
          mistakes[key] = (mistakes[key] || 0) + 1;
        }
      }
      return {
        question_number: q.number,
        correct_answer: q.correct_answer,
        type: q.type,
        points: q.points,
        correct_count: correctCount,
        total_count: results.length,
        accuracy_pct: Math.round((correctCount / results.length) * 100),
        common_mistakes: Object.entries(mistakes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([answer, count]) => ({ answer, count }))
      };
    });

    // Per-student stats
    const student_stats = results.map(r => ({
      student_name: r.student_name || 'Unknown',
      total_score: r.total_score,
      total_possible: r.total_possible,
      percentage: Math.round((r.total_score / r.total_possible) * 100),
      wrong_questions: r.answers.filter(a => !a.correct).map(a => a.question_number)
    }));

    const class_average = Math.round(student_stats.reduce((s, st) => s + st.percentage, 0) / student_stats.length);

    res.json({
      assignment_name: answerKey.name,
      total_students: results.length,
      class_average,
      question_stats,
      student_stats
    });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: 'Failed to generate analysis' });
  }
});

// CSV export of all results for an assignment
app.get('/api/results/:answerKeyId/export', async (req, res) => {
  try {
    const keyResult = await pool.query('SELECT * FROM answer_keys WHERE id = $1', [req.params.answerKeyId]);
    if (keyResult.rows.length === 0) return res.status(404).json({ error: 'Answer key not found' });
    const answerKey = keyResult.rows[0];
    const questions = answerKey.questions;

    const resultsData = await pool.query(
      'SELECT student_name, answers, total_score, total_possible, graded_at FROM grading_results WHERE answer_key_id = $1 ORDER BY student_name',
      [req.params.answerKeyId]
    );

    // Build CSV header
    const headers = ['Student', 'Score', 'Total', 'Percentage', 'Date', ...questions.map(q => `Q${q.number}`)];
    const rows = [headers.join(',')];

    for (const r of resultsData.rows) {
      const pct = Math.round((r.total_score / r.total_possible) * 100);
      const date = new Date(r.graded_at).toLocaleDateString('zh-TW');
      const qCols = questions.map(q => {
        const a = r.answers.find(a => a.question_number === q.number);
        return a ? (a.correct ? 'O' : 'X') : '?';
      });
      const row = [
        `"${(r.student_name || 'Unknown').replace(/"/g, '""')}"`,
        r.total_score, r.total_possible, `${pct}%`, date, ...qCols
      ];
      rows.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(answerKey.name)}_results.csv"`);
    res.send('\uFEFF' + rows.join('\n')); // BOM for Excel UTF-8
  } catch (err) {
    res.status(500).json({ error: 'Export failed' });
  }
});

// --- Start Server ---
async function start() {
  try {
    await initDB();
    console.log('Connected to PostgreSQL');
  } catch (err) {
    console.error('Database init failed:', err.message);
    console.log('Server will start without database - some features may not work');
  }
  app.listen(PORT, () => console.log(`Homework Grader server running on port ${PORT}`));
}

start();
