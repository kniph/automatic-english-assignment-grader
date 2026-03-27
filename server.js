require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const path = require('path');

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
    await client.query(`
      CREATE TABLE IF NOT EXISTS answer_keys (
        id SERIAL PRIMARY KEY,
        teacher_name VARCHAR(100) NOT NULL,
        name VARCHAR(200) NOT NULL,
        template_image TEXT,
        image_width INTEGER NOT NULL,
        image_height INTEGER NOT NULL,
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
    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}

// --- Google Cloud Vision OCR ---
async function ocrRegion(imageBase64, region) {
  // Decode the base64 image
  const imageBuffer = Buffer.from(imageBase64, 'base64');

  // Crop the region using Sharp
  let cropped;
  try {
    const metadata = await sharp(imageBuffer).metadata();

    // Clamp region to image bounds
    const x = Math.max(0, Math.round(region.x));
    const y = Math.max(0, Math.round(region.y));
    const width = Math.min(Math.round(region.width), metadata.width - x);
    const height = Math.min(Math.round(region.height), metadata.height - y);

    cropped = await sharp(imageBuffer)
      .extract({ left: x, top: y, width, height })
      .sharpen()
      .normalize()
      .png()
      .toBuffer();
  } catch (err) {
    console.error('Sharp crop error:', err.message);
    throw new Error('Failed to crop image region');
  }

  // Send to Google Cloud Vision
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey || apiKey === 'YOUR_KEY_HERE') {
    throw new Error('Google Vision API key not configured');
  }

  const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
  const requestBody = {
    requests: [{
      image: { content: cropped.toString('base64') },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }]
    }]
  };

  const response = await fetch(visionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Vision API error:', errText);
    throw new Error('Google Vision API request failed');
  }

  const data = await response.json();
  const annotation = data.responses?.[0];

  if (annotation?.error) {
    throw new Error(`Vision API: ${annotation.error.message}`);
  }

  const fullText = annotation?.fullTextAnnotation?.text || '';
  const confidence = annotation?.fullTextAnnotation?.pages?.[0]?.confidence || 0;

  return {
    text: fullText.trim().replace(/\n/g, ' '),
    confidence
  };
}

// --- Matching Engine ---
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
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function normalizeText(text, settings) {
  let normalized = text.trim();
  if (!settings.case_sensitive) {
    normalized = normalized.toLowerCase();
  }
  if (settings.ignore_punctuation) {
    normalized = normalized.replace(/[.,!?;:'"()]/g, '').trim();
  }
  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');
  return normalized;
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

  // T/F special handling
  if (question.type === 'true_false') {
    const detectedTF = normalizeTF(detected);
    const correctTF = normalizeTF(correct);
    return {
      correct: detectedTF === correctTF,
      score: detectedTF === correctTF ? question.points : 0,
      detected_text: detectedText,
      match_type: 'true_false'
    };
  }

  // Exact match
  if (detected === correct) {
    return {
      correct: true,
      score: question.points,
      detected_text: detectedText,
      match_type: 'exact'
    };
  }

  // Alt answers
  const altAnswers = question.alt_answers || [];
  for (const alt of altAnswers) {
    if (detected === normalizeText(alt, settings)) {
      return {
        correct: true,
        score: question.points,
        detected_text: detectedText,
        match_type: 'alt_answer'
      };
    }
  }

  // Fuzzy match
  const threshold = question.fuzzy_threshold || settings.fuzzy_default_threshold || 0;
  if (threshold > 0) {
    const sim = similarity(detected, correct);
    if (sim >= threshold) {
      return {
        correct: true,
        score: question.points,
        detected_text: detectedText,
        match_type: 'fuzzy',
        similarity: sim
      };
    }
  }

  return {
    correct: false,
    score: 0,
    detected_text: detectedText,
    match_type: 'no_match',
    similarity: similarity(detected, correct)
  };
}

// --- API Routes ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Answer Keys CRUD ---

// Create answer key
app.post('/api/answer-keys', async (req, res) => {
  try {
    const { teacher_name, name, template_image, image_width, image_height, questions, settings } = req.body;

    if (!teacher_name || !name || !questions || !image_width || !image_height) {
      return res.status(400).json({ error: 'Missing required fields: teacher_name, name, questions, image_width, image_height' });
    }

    const total_points = questions.reduce((sum, q) => sum + (q.points || 1), 0);

    const result = await pool.query(
      `INSERT INTO answer_keys (teacher_name, name, template_image, image_width, image_height, questions, settings, total_points)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [teacher_name, name, template_image, image_width, image_height, JSON.stringify(questions), JSON.stringify(settings || {}), total_points]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create answer key error:', err);
    res.status(500).json({ error: 'Failed to create answer key' });
  }
});

// List answer keys
app.get('/api/answer-keys', async (req, res) => {
  try {
    const { teacher_name } = req.query;
    let query = 'SELECT id, teacher_name, name, image_width, image_height, total_points, created_at FROM answer_keys';
    const params = [];

    if (teacher_name) {
      query += ' WHERE teacher_name = $1';
      params.push(teacher_name);
    }

    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List answer keys error:', err);
    res.status(500).json({ error: 'Failed to list answer keys' });
  }
});

// Get answer key by ID
app.get('/api/answer-keys/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM answer_keys WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Answer key not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get answer key error:', err);
    res.status(500).json({ error: 'Failed to get answer key' });
  }
});

// Delete answer key
app.delete('/api/answer-keys/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM answer_keys WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Answer key not found' });
    }
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Delete answer key error:', err);
    res.status(500).json({ error: 'Failed to delete answer key' });
  }
});

// --- OCR ---

// OCR a single region
app.post('/api/ocr/region', async (req, res) => {
  try {
    const { image, region } = req.body;
    if (!image || !region) {
      return res.status(400).json({ error: 'Missing image or region' });
    }

    const result = await ocrRegion(image, region);
    res.json(result);
  } catch (err) {
    console.error('OCR region error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Convert HEIC to JPEG
app.post('/api/convert-heic', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Missing image' });

    const inputBuffer = Buffer.from(image, 'base64');

    // Use heic-convert (pure JS, no system deps) to decode HEIC
    const jpegBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.9
    });

    // Auto-rotate via Sharp (handles EXIF orientation), Sharp can read JPEG fine
    const rotated = await sharp(Buffer.from(jpegBuffer)).rotate().jpeg({ quality: 90 }).toBuffer();
    res.json({ image: rotated.toString('base64') });
  } catch (err) {
    console.error('HEIC conversion error:', err);
    res.status(500).json({ error: 'Failed to convert HEIC: ' + err.message });
  }
});

// --- Grading ---

// Grade a single student image against an answer key
app.post('/api/grade', async (req, res) => {
  try {
    const { answer_key_id, student_image, student_name } = req.body;
    if (!answer_key_id || !student_image) {
      return res.status(400).json({ error: 'Missing answer_key_id or student_image' });
    }

    // Get the answer key
    const keyResult = await pool.query('SELECT * FROM answer_keys WHERE id = $1', [answer_key_id]);
    if (keyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Answer key not found' });
    }

    const answerKey = keyResult.rows[0];
    const questions = answerKey.questions;
    const settings = {
      case_sensitive: false,
      ignore_punctuation: true,
      fuzzy_default_threshold: 0,
      ...answerKey.settings
    };

    // Preprocess the student image (auto-rotate, normalize)
    const studentBuffer = Buffer.from(student_image, 'base64');
    const processedBuffer = await sharp(studentBuffer).rotate().png().toBuffer();
    const processedBase64 = processedBuffer.toString('base64');

    // OCR each question region and match
    const answers = [];
    let totalScore = 0;

    for (const question of questions) {
      try {
        const ocrResult = await ocrRegion(processedBase64, question.region);
        const matchResult = matchAnswer(ocrResult.text, question, settings);
        matchResult.confidence = ocrResult.confidence;
        matchResult.question_number = question.number;
        answers.push(matchResult);
        totalScore += matchResult.score;
      } catch (ocrErr) {
        console.error(`OCR failed for question ${question.number}:`, ocrErr.message);
        answers.push({
          correct: false,
          score: 0,
          detected_text: '[OCR failed]',
          match_type: 'error',
          question_number: question.number,
          error: ocrErr.message
        });
      }
    }

    // Save result
    const saveResult = await pool.query(
      `INSERT INTO grading_results (answer_key_id, student_name, original_image, answers, total_score, total_possible)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [answer_key_id, student_name || null, student_image, JSON.stringify(answers), totalScore, answerKey.total_points]
    );

    res.json({
      id: saveResult.rows[0].id,
      answers,
      total_score: totalScore,
      total_possible: answerKey.total_points,
      percentage: Math.round((totalScore / answerKey.total_points) * 100)
    });
  } catch (err) {
    console.error('Grade error:', err);
    res.status(500).json({ error: 'Grading failed: ' + err.message });
  }
});

// Batch grade multiple student images
app.post('/api/grade/batch', async (req, res) => {
  try {
    const { answer_key_id, students } = req.body;
    if (!answer_key_id || !students || !Array.isArray(students)) {
      return res.status(400).json({ error: 'Missing answer_key_id or students array' });
    }

    const results = [];
    for (const student of students) {
      try {
        // Re-use the single grade logic by making an internal call
        const gradeReq = {
          body: {
            answer_key_id,
            student_image: student.image,
            student_name: student.name
          }
        };

        // Inline grading (same logic as /api/grade)
        const keyResult = await pool.query('SELECT * FROM answer_keys WHERE id = $1', [answer_key_id]);
        if (keyResult.rows.length === 0) {
          results.push({ student_name: student.name, error: 'Answer key not found' });
          continue;
        }

        const answerKey = keyResult.rows[0];
        const questions = answerKey.questions;
        const settings = { case_sensitive: false, ignore_punctuation: true, fuzzy_default_threshold: 0, ...answerKey.settings };

        const studentBuffer = Buffer.from(student.image, 'base64');
        const processedBuffer = await sharp(studentBuffer).rotate().png().toBuffer();
        const processedBase64 = processedBuffer.toString('base64');

        const answers = [];
        let totalScore = 0;

        for (const question of questions) {
          try {
            const ocrResult = await ocrRegion(processedBase64, question.region);
            const matchResult = matchAnswer(ocrResult.text, question, settings);
            matchResult.confidence = ocrResult.confidence;
            matchResult.question_number = question.number;
            answers.push(matchResult);
            totalScore += matchResult.score;
          } catch (ocrErr) {
            answers.push({ correct: false, score: 0, detected_text: '[OCR failed]', match_type: 'error', question_number: question.number });
          }
        }

        const saveResult = await pool.query(
          `INSERT INTO grading_results (answer_key_id, student_name, original_image, answers, total_score, total_possible)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [answer_key_id, student.name || null, student.image, JSON.stringify(answers), totalScore, answerKey.total_points]
        );

        results.push({
          id: saveResult.rows[0].id,
          student_name: student.name,
          answers,
          total_score: totalScore,
          total_possible: answerKey.total_points,
          percentage: Math.round((totalScore / answerKey.total_points) * 100)
        });
      } catch (studentErr) {
        results.push({ student_name: student.name, error: studentErr.message });
      }
    }

    res.json({ results, graded_count: results.filter(r => !r.error).length, total_count: students.length });
  } catch (err) {
    console.error('Batch grade error:', err);
    res.status(500).json({ error: 'Batch grading failed' });
  }
});

// Get results for an answer key
app.get('/api/results/:answerKeyId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, student_name, answers, total_score, total_possible, graded_at
       FROM grading_results WHERE answer_key_id = $1 ORDER BY graded_at DESC`,
      [req.params.answerKeyId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get results error:', err);
    res.status(500).json({ error: 'Failed to get results' });
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

  app.listen(PORT, () => {
    console.log(`Homework Grader server running on port ${PORT}`);
  });
}

start();
