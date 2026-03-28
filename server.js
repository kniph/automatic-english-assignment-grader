require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const path = require('path');
const mammoth = require('mammoth');
const Anthropic = require('@anthropic-ai/sdk');

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

    // ---- New tables for student workflow ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS assignments (
        id SERIAL PRIMARY KEY,
        howdy_level INTEGER NOT NULL CHECK (howdy_level BETWEEN 1 AND 10),
        unit INTEGER NOT NULL CHECK (unit BETWEEN 1 AND 8),
        book_type VARCHAR(1) NOT NULL CHECK (book_type IN ('A','B','C')),
        assignment_image TEXT NOT NULL,
        answer_key_image TEXT NOT NULL,
        audio_files JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(howdy_level, unit, book_type)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_submissions (
        id SERIAL PRIMARY KEY,
        assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
        student_name VARCHAR(100),
        submission_image TEXT NOT NULL,
        answers JSONB,
        total_score INTEGER,
        total_possible INTEGER,
        percentage INTEGER,
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
// Claude Vision grading
// ============================================================

function getAnthropicClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');
  return new Anthropic({ apiKey: key });
}

async function gradeWithClaude(answerKeyBase64, studentBase64, assignmentName) {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20251022',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Grade children's English homework: "${assignmentName}".

Image 1 = ANSWER KEY (correct answers shown)
Image 2 = STUDENT'S WORK

Compare every question. Return ONLY valid JSON (no markdown, no explanation):
{"questions":[{"number":1,"correct_answer":"...","student_answer":"...","correct":true}],"total_possible":N}

Rules:
- Ignore case and trailing punctuation
- T / F accepted as True / False in any form
- 1-character typo still counts as correct
- Blank or illegible → correct:false, student_answer:"(blank)"
- Number questions from 1`
        },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: answerKeyBase64 }
        },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: studentBase64 }
        }
      ]
    }]
  });

  const raw = response.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
}

// ============================================================
// Core grading logic (shared by single + batch)
// ============================================================

async function gradeStudent({ answerKey, studentImage, studentName }) {
  const questions = answerKey.questions;
  const settings = { case_sensitive: false, ignore_punctuation: true, fuzzy_default_threshold: 0.7, ...answerKey.settings };
  const mode = answerKey.mode || 'simple';

  const studentBuffer = Buffer.from(studentImage, 'base64');
  // Use JPEG for both Claude vision and full-page OCR (smaller, compatible)
  const processedBuffer = await sharp(studentBuffer).rotate().jpeg({ quality: 88 }).toBuffer();
  const processedBase64 = processedBuffer.toString('base64');

  const answers = [];
  let totalScore = 0;
  let claudeQuestions = null;

  if (mode === 'claude') {
    if (!answerKey.template_image) throw new Error('No answer key image saved for this assignment');
    const claudeResult = await gradeWithClaude(answerKey.template_image, processedBase64, answerKey.name);
    claudeQuestions = claudeResult.questions;
    for (const q of claudeResult.questions) {
      const score = q.correct ? 1 : 0;
      answers.push({
        question_number: q.number,
        correct: q.correct,
        score,
        detected_text: q.student_answer,
        correct_answer: q.correct_answer,
        match_type: 'claude'
      });
      totalScore += score;
    }
    return { answers, totalScore, totalPossible: claudeResult.total_possible, claudeQuestions };
  }

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

    // For Claude mode: normalise answer key image to JPEG for consistent Vision API calls
    let storedImage = template_image || null;
    if (mode === 'claude' && storedImage) {
      try {
        const buf = Buffer.from(storedImage, 'base64');
        const jpegBuf = await sharp(buf).rotate().jpeg({ quality: 90 }).toBuffer();
        storedImage = jpegBuf.toString('base64');
      } catch (_) { /* keep original if conversion fails */ }
    }

    const result = await pool.query(
      `INSERT INTO answer_keys (teacher_name, name, mode, template_image, image_width, image_height, questions, settings, total_points)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [teacher_name, name, mode, storedImage, image_width, image_height, JSON.stringify(questions), JSON.stringify(settings || {}), total_points]
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

    const { answers, totalScore, totalPossible, claudeQuestions } = await gradeStudent({ answerKey, studentImage: student_image, studentName: student_name });

    // First Claude grading: write back questions + total_points to answer key
    if (answerKey.mode === 'claude' && answerKey.total_points === 0 && claudeQuestions?.length) {
      const qs = claudeQuestions.map(q => ({ number: q.number, correct_answer: q.correct_answer, type: 'fill_blank', points: 1, alt_answers: [] }));
      await pool.query('UPDATE answer_keys SET total_points=$1, questions=$2 WHERE id=$3',
        [totalPossible, JSON.stringify(qs), answer_key_id]).catch(() => {});
    }

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
        const { answers, totalScore, totalPossible, claudeQuestions } = await gradeStudent({ answerKey, studentImage: student.image, studentName: student.name });
        if (answerKey.mode === 'claude' && answerKey.total_points === 0 && claudeQuestions?.length) {
          const qs = claudeQuestions.map(q => ({ number: q.number, correct_answer: q.correct_answer, type: 'fill_blank', points: 1, alt_answers: [] }));
          await pool.query('UPDATE answer_keys SET total_points=$1, questions=$2 WHERE id=$3',
            [totalPossible, JSON.stringify(qs), answer_key_id]).catch(() => {});
          answerKey.total_points = totalPossible;
        }
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
    let questions = answerKey.questions || [];

    const resultsData = await pool.query(
      'SELECT student_name, answers, total_score, total_possible FROM grading_results WHERE answer_key_id = $1 ORDER BY total_score DESC',
      [req.params.answerKeyId]
    );
    const results = resultsData.rows;

    if (results.length === 0) return res.json({ question_stats: [], student_stats: [], total_students: 0, class_average: 0 });

    // For Claude mode: questions array may be empty until first grading — rebuild from answers
    if (questions.length === 0 && results.length > 0) {
      const firstAnswers = results[0].answers || [];
      questions = firstAnswers.map(a => ({
        number: a.question_number,
        correct_answer: a.correct_answer || '',
        type: 'fill_blank',
        points: 1
      })).sort((a, b) => a.number - b.number);
    }

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

// ============================================================
// Assignments API (student workflow)
// ============================================================

// List available assignments (no images/audio, just metadata)
app.get('/api/assignments', async (req, res) => {
  try {
    const { howdy, unit, book } = req.query;
    let query = `SELECT id, howdy_level, unit, book_type,
                   jsonb_array_length(audio_files) AS audio_count, created_at
                 FROM assignments`;
    const params = [];
    const conds = [];
    if (howdy) { conds.push(`howdy_level = $${params.length+1}`); params.push(parseInt(howdy)); }
    if (unit)  { conds.push(`unit = $${params.length+1}`);         params.push(parseInt(unit)); }
    if (book)  { conds.push(`book_type = $${params.length+1}`);    params.push(book.toUpperCase()); }
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY howdy_level, unit, book_type';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list assignments' });
  }
});

// Get which (howdy, unit, book) combinations exist — for UI cascade dropdowns
app.get('/api/assignments/available', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT howdy_level, unit, book_type FROM assignments ORDER BY howdy_level, unit, book_type'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get available assignments' });
  }
});

// Get single assignment WITH images and audio (used when student opens workbook)
app.get('/api/assignments/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM assignments WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    const row = result.rows[0];
    // Return assignment_image and audio, but NOT answer_key_image (don't expose to student)
    res.json({
      id: row.id,
      howdy_level: row.howdy_level,
      unit: row.unit,
      book_type: row.book_type,
      assignment_image: row.assignment_image,
      audio_files: row.audio_files,
      created_at: row.created_at
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get assignment' });
  }
});

// Create or update assignment (teacher upload)
// UPSERT on (howdy_level, unit, book_type)
app.post('/api/assignments', async (req, res) => {
  try {
    const { howdy_level, unit, book_type, assignment_image, answer_key_image, audio_files = [] } = req.body;
    if (!howdy_level || !unit || !book_type || !assignment_image || !answer_key_image) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Compress images server-side for storage efficiency
    // 只限制寬度（max 2000px），高度不限——支援多頁 PDF 垂直拼接的長圖
    const compressImg = async (b64) => {
      const buf = Buffer.from(b64, 'base64');
      return (await sharp(buf).rotate()
        .resize({ width: 2000, withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer()).toString('base64');
    };

    const [storedAssign, storedAnswer] = await Promise.all([
      compressImg(assignment_image),
      compressImg(answer_key_image)
    ]);

    const result = await pool.query(`
      INSERT INTO assignments (howdy_level, unit, book_type, assignment_image, answer_key_image, audio_files)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (howdy_level, unit, book_type) DO UPDATE SET
        assignment_image = EXCLUDED.assignment_image,
        answer_key_image = EXCLUDED.answer_key_image,
        audio_files = EXCLUDED.audio_files,
        created_at = NOW()
      RETURNING id, howdy_level, unit, book_type, created_at`,
      [parseInt(howdy_level), parseInt(unit), book_type.toUpperCase(), storedAssign, storedAnswer, JSON.stringify(audio_files)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create assignment error:', err);
    res.status(500).json({ error: 'Failed to save assignment: ' + err.message });
  }
});

app.delete('/api/assignments/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM assignments WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

// ============================================================
// Student Submissions — submit handwritten work, grade with Claude
// ============================================================

app.post('/api/submissions', async (req, res) => {
  try {
    const { assignment_id, student_name, submission_image } = req.body;
    if (!assignment_id || !submission_image) {
      return res.status(400).json({ error: 'Missing assignment_id or submission_image' });
    }

    // Fetch assignment (need answer key image)
    const asgResult = await pool.query('SELECT * FROM assignments WHERE id=$1', [assignment_id]);
    if (asgResult.rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    const asg = asgResult.rows[0];

    // Compress submission image (width-only limit to preserve multi-page height)
    const submBuf = Buffer.from(submission_image, 'base64');
    const submJpeg = (await sharp(submBuf).rotate()
      .resize({ width: 2000, withoutEnlargement: true })
      .jpeg({ quality: 88 }).toBuffer()).toString('base64');

    // Grade with Claude
    const assignmentLabel = `Howdy ${asg.howdy_level} Unit ${asg.unit} 習作${asg.book_type}本`;
    const claudeResult = await gradeHandwriting(asg.answer_key_image, submJpeg, assignmentLabel);

    const answers = claudeResult.questions.map(q => ({
      question_number: q.number,
      section: q.section || '',
      correct: q.correct,
      score: q.correct ? 1 : 0,
      detected_text: q.student_answer,
      correct_answer: q.correct_answer,
      match_type: 'claude'
    }));
    const totalScore = answers.filter(a => a.correct).length;
    const totalPossible = claudeResult.total_possible;
    const percentage = Math.round((totalScore / totalPossible) * 100);

    const saveResult = await pool.query(`
      INSERT INTO student_submissions
        (assignment_id, student_name, submission_image, answers, total_score, total_possible, percentage)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, graded_at`,
      [assignment_id, student_name || null, submJpeg, JSON.stringify(answers),
       totalScore, totalPossible, percentage]
    );

    res.json({
      id: saveResult.rows[0].id,
      graded_at: saveResult.rows[0].graded_at,
      student_name: student_name || null,
      answers,
      total_score: totalScore,
      total_possible: totalPossible,
      percentage
    });
  } catch (err) {
    console.error('Submission error:', err);
    res.status(500).json({ error: '批改失敗：' + err.message });
  }
});

// List submissions for an assignment (teacher view)
app.get('/api/submissions', async (req, res) => {
  try {
    const { assignment_id } = req.query;
    if (!assignment_id) return res.status(400).json({ error: 'Missing assignment_id' });
    const result = await pool.query(`
      SELECT id, student_name, total_score, total_possible, percentage, graded_at
      FROM student_submissions WHERE assignment_id=$1 ORDER BY graded_at DESC`,
      [assignment_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// Get single submission with answers (for results display)
app.get('/api/submissions/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM student_submissions WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Submission not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get submission' });
  }
});

// ============================================================
// Claude grading for handwritten workbook pages
// ============================================================

async function gradeHandwriting(answerKeyBase64, studentBase64, assignmentLabel) {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20251022',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `You are a precise grader for a children's English workbook: "${assignmentLabel}".

Image 1 = ANSWER KEY (shows the correct answers — pre-filled or marked by teacher)
Image 2 = STUDENT'S HANDWRITTEN WORK

════════════════════════════════════════
STEP 1 — IDENTIFY ALL SECTIONS
Look at both images carefully. List every section (A, B, C, D …) and its question type before grading.

STEP 2 — GRADE EVERY ITEM
Grade ALL answerable items across ALL sections. Do NOT skip any section.

QUESTION TYPE RULES:
──────────────────────────────────────────
【Matching — lines connecting items】
- Compare the student's drawn lines to the answer key's lines.
- For each character/word on the left: check which item on the right it connects to.
- correct_answer = "LeftItem→RightItem" (use the printed label or describe the image clearly, e.g. "Lucy→roller coaster")
- student_answer = what the student actually connected (e.g. "Lucy→merry-go-round")
- A line from the wrong item = incorrect.

【Circling words (Read and circle)】
- Each sentence has TWO blanks to circle (one word from each pair).
- CRITICAL: If the student circled EXACTLY ONE word per blank = grade that word.
- If the student circled BOTH words in a single blank (e.g. both "his" AND "he") = WRONG for that blank, student_answer="(both circled)".
- If the student circled NOTHING for a blank = WRONG, student_answer="(blank)".
- Compare each circled word to the answer key. Case-insensitive.
- Each sentence counts as ONE item; it is correct only if BOTH blanks are correctly circled.

【Fill-in blanks】
- Compare written text to the correct answer. Accept 1-character typos.
- Blank or illegible = incorrect, student_answer="(blank)".

【Checkboxes / tick marks】
- Each row = 1 item. Check if the student's tick/check is on the correct row.

【Numbering / ordering boxes】
- Each box = 1 item. The written number must match the answer key.

【True / False, Yes / No】
- Accept T/F, True/False, O/X, Yes/No equivalents.
- Blank = incorrect.

════════════════════════════════════════
Return ONLY valid JSON — no markdown, no explanation, no extra text:
{"questions":[{"number":1,"section":"A","correct_answer":"...","student_answer":"...","correct":true}],"total_possible":N}

JSON field rules:
- "number": sequential integer starting at 1 across ALL sections
- "section": section letter (A, B, C …)
- "correct_answer": the expected correct answer
- "student_answer": exactly what the student wrote/circled/drew
- "correct": true or false`
        },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: answerKeyBase64 } },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: studentBase64 } }
      ]
    }]
  });
  const raw = response.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude 未回傳有效的 JSON');
  return JSON.parse(jsonMatch[0]);
}

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
