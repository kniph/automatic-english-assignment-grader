const sharp = require('sharp');
const howdyAnswerBank = require('./data/vocab-prompts/howdy-1-8-answer-bank.json');

const VOCAB_SOURCE_TYPES = new Set(['howdy', 'custom']);
const VOCAB_EXAM_STATUSES = new Set(['draft', 'published']);
const VOCAB_ATTEMPT_MODES = new Set(['full', 'retest', 'final']);
const HOWDY_ANSWER_BANK_MAP = (() => {
  const map = new Map();
  for (const row of Array.isArray(howdyAnswerBank) ? howdyAnswerBank : []) {
    const key = [
      Number(row.howdy_level) || 0,
      Number(row.unit) || 0,
      Number(row.unit_item_order) || 0
    ].join(':');
    if (!map.has(key)) {
      map.set(key, row);
    }
  }
  return map;
})();

async function initVocabDB(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS vocab_exams (
      id SERIAL PRIMARY KEY,
      source_type VARCHAR(20) NOT NULL DEFAULT 'custom',
      howdy_level INTEGER,
      unit INTEGER,
      book_type VARCHAR(1),
      title VARCHAR(200) NOT NULL,
      pass_score INTEGER NOT NULL DEFAULT 80,
      page_count INTEGER NOT NULL DEFAULT 1,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await client.query(`
    ALTER TABLE vocab_exams
    DROP CONSTRAINT IF EXISTS vocab_exams_source_type_check;
    ALTER TABLE vocab_exams
    ADD CONSTRAINT vocab_exams_source_type_check
    CHECK (source_type IN ('howdy', 'custom'));
  `).catch(() => {});
  await client.query(`
    ALTER TABLE vocab_exams
    DROP CONSTRAINT IF EXISTS vocab_exams_status_check;
    ALTER TABLE vocab_exams
    ADD CONSTRAINT vocab_exams_status_check
    CHECK (status IN ('draft', 'published'));
  `).catch(() => {});
  await client.query(`
    ALTER TABLE vocab_exams
    DROP CONSTRAINT IF EXISTS vocab_exams_pass_score_check;
    ALTER TABLE vocab_exams
    ADD CONSTRAINT vocab_exams_pass_score_check
    CHECK (pass_score BETWEEN 0 AND 100);
  `).catch(() => {});
  await client.query(`
    ALTER TABLE vocab_exams
    DROP CONSTRAINT IF EXISTS vocab_exams_page_count_check;
    ALTER TABLE vocab_exams
    ADD CONSTRAINT vocab_exams_page_count_check
    CHECK (page_count BETWEEN 1 AND 4);
  `).catch(() => {});
  await client.query(`ALTER TABLE vocab_exams ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`).catch(() => {});
  await client.query(`UPDATE vocab_exams SET updated_at = COALESCE(updated_at, created_at, NOW())`).catch(() => {});

  await client.query(`
    CREATE TABLE IF NOT EXISTS vocab_exam_pages (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES vocab_exams(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      blank_image TEXT NOT NULL,
      answer_key_image TEXT NOT NULL,
      UNIQUE (exam_id, page_number)
    );
  `);
  await client.query(`
    ALTER TABLE vocab_exam_pages
    DROP CONSTRAINT IF EXISTS vocab_exam_pages_page_number_check;
    ALTER TABLE vocab_exam_pages
    ADD CONSTRAINT vocab_exam_pages_page_number_check
    CHECK (page_number BETWEEN 1 AND 4);
  `).catch(() => {});

  await client.query(`
    CREATE TABLE IF NOT EXISTS vocab_questions (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES vocab_exams(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      question_number INTEGER NOT NULL,
      prompt_type VARCHAR(40) NOT NULL DEFAULT 'picture_word',
      answer_text TEXT NOT NULL,
      answer_box JSONB NOT NULL,
      points INTEGER NOT NULL DEFAULT 5,
      UNIQUE (exam_id, question_number)
    );
  `);
  await client.query(`
    ALTER TABLE vocab_questions
    DROP CONSTRAINT IF EXISTS vocab_questions_page_number_check;
    ALTER TABLE vocab_questions
    ADD CONSTRAINT vocab_questions_page_number_check
    CHECK (page_number BETWEEN 1 AND 4);
  `).catch(() => {});
  await client.query(`
    ALTER TABLE vocab_questions
    DROP CONSTRAINT IF EXISTS vocab_questions_points_check;
    ALTER TABLE vocab_questions
    ADD CONSTRAINT vocab_questions_points_check
    CHECK (points > 0);
  `).catch(() => {});

  await client.query(`
    CREATE TABLE IF NOT EXISTS vocab_submissions (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES vocab_exams(id) ON DELETE CASCADE,
      student_name VARCHAR(100) NOT NULL,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      attempt_mode VARCHAR(20) NOT NULL DEFAULT 'full',
      source_submission_id INTEGER REFERENCES vocab_submissions(id) ON DELETE SET NULL,
      submission_images JSONB NOT NULL DEFAULT '[]',
      graded_answers JSONB NOT NULL DEFAULT '[]',
      total_score INTEGER NOT NULL DEFAULT 0,
      total_possible INTEGER NOT NULL DEFAULT 0,
      percentage INTEGER NOT NULL DEFAULT 0,
      passed BOOLEAN NOT NULL DEFAULT false,
      wrong_question_ids JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await client.query(`
    ALTER TABLE vocab_submissions
    DROP CONSTRAINT IF EXISTS vocab_submissions_attempt_mode_check;
    ALTER TABLE vocab_submissions
    ADD CONSTRAINT vocab_submissions_attempt_mode_check
    CHECK (attempt_mode IN ('full', 'retest', 'final'));
  `).catch(() => {});
}

function registerVocabRoutes({ app, pool, requireTeacherAuth, hasTeacherAccess, callVisionAPI }) {
  function normalizeStatus(value) {
    const raw = String(value || '').trim().toLowerCase();
    return VOCAB_EXAM_STATUSES.has(raw) ? raw : 'draft';
  }

  function normalizeSourceType(value) {
    const raw = String(value || '').trim().toLowerCase();
    return VOCAB_SOURCE_TYPES.has(raw) ? raw : 'custom';
  }

  function normalizeAttemptMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    return VOCAB_ATTEMPT_MODES.has(raw) ? raw : 'full';
  }

  function cleanText(value) {
    return String(value || '').trim();
  }

  function resolveQuestionContent(exam, question) {
    const fallback = {
      answer_text: cleanText(question?.answer_text),
      definition_zh: '',
      prompt_en: ''
    };

    if (!exam || exam.source_type !== 'howdy') {
      return fallback;
    }

    const key = [
      Number(exam.howdy_level) || 0,
      Number(exam.unit) || 0,
      Number(question?.question_number) || 0
    ].join(':');
    const bankRow = HOWDY_ANSWER_BANK_MAP.get(key);
    if (!bankRow) {
      return fallback;
    }

    return {
      answer_text: cleanText(bankRow.answer_text) || fallback.answer_text,
      definition_zh: cleanText(bankRow.definition_zh),
      prompt_en: cleanText(bankRow.prompt_en)
    };
  }

  function canonicalizeGradedAnswers(exam, questions, gradedAnswers) {
    if (!Array.isArray(gradedAnswers) || !gradedAnswers.length) return [];

    const questionMap = new Map((questions || []).map(question => [Number(question.id), question]));
    return gradedAnswers.map(answer => {
      const question = questionMap.get(Number(answer.question_id)) || {
        question_number: answer.question_number,
        answer_text: answer.correct_answer
      };
      const canonical = resolveQuestionContent(exam, question);
      const detectedText = normalizeAnswerForCompare(answer.detected_text);
      const correct = detectedText !== '' && detectedText === canonical.answer_text;
      return {
        ...answer,
        correct_answer: canonical.answer_text,
        correct,
        score: correct ? Number(answer.points || 0) : 0
      };
    });
  }

  function normalizeAnswerForCompare(value) {
    return String(value || '')
      .replace(/\r/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parsePositiveInt(value, fallback = null) {
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) return fallback;
    return num;
  }

  async function compressPageImage(base64) {
    const buffer = Buffer.from(base64, 'base64');
    return (await sharp(buffer)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 2000, withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer()).toString('base64');
  }

  function normalizeHowdyMetadata(sourceType, howdyLevel, unit, bookType) {
    if (sourceType !== 'howdy') {
      return { howdyLevel: null, unit: null, bookType: null };
    }

    const normalizedHowdy = parsePositiveInt(howdyLevel);
    const normalizedUnit = parsePositiveInt(unit);
    const normalizedBook = String(bookType || '').trim().toUpperCase();

    if (!normalizedHowdy || normalizedHowdy < 1 || normalizedHowdy > 10) {
      throw new Error('Howdy level must be between 1 and 10');
    }
    if (!normalizedUnit || normalizedUnit < 1 || normalizedUnit > 10) {
      throw new Error('Unit must be between 1 and 10');
    }
    if (!['A', 'B', 'C'].includes(normalizedBook)) {
      throw new Error('Book type must be A, B, or C');
    }

    return {
      howdyLevel: normalizedHowdy,
      unit: normalizedUnit,
      bookType: normalizedBook
    };
  }

  async function sanitizePages(pages) {
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new Error('At least one page is required');
    }
    if (pages.length > 4) {
      throw new Error('At most 4 pages are supported');
    }

    const sorted = [...pages]
      .map(page => ({
        page_number: parsePositiveInt(page.page_number),
        blank_image: cleanText(page.blank_image),
        answer_key_image: cleanText(page.answer_key_image)
      }))
      .sort((a, b) => a.page_number - b.page_number);

    for (let index = 0; index < sorted.length; index++) {
      const page = sorted[index];
      if (page.page_number !== index + 1) {
        throw new Error('Pages must be numbered sequentially from 1');
      }
      if (!page.blank_image || !page.answer_key_image) {
        throw new Error(`Page ${page.page_number} is missing a blank or answer image`);
      }
    }

    const compressed = await Promise.all(sorted.map(async page => ({
      page_number: page.page_number,
      blank_image: await compressPageImage(page.blank_image),
      answer_key_image: await compressPageImage(page.answer_key_image)
    })));

    return compressed;
  }

  function sanitizeQuestions(questions, pageCount, options = {}) {
    const allowEmpty = Boolean(options.allowEmpty);
    if (!Array.isArray(questions)) {
      throw new Error('Questions must be an array');
    }
    if (!questions.length) {
      if (allowEmpty) return [];
      throw new Error('At least one question is required');
    }

    const usedNumbers = new Set();
    const normalized = questions.map(rawQuestion => {
      const pageNumber = parsePositiveInt(rawQuestion.page_number);
      const questionNumber = parsePositiveInt(rawQuestion.question_number);
      const promptType = cleanText(rawQuestion.prompt_type) || 'picture_word';
      const answerText = cleanText(rawQuestion.answer_text);
      const points = parsePositiveInt(rawQuestion.points, 5) || 5;
      const answerBox = rawQuestion.answer_box || {};
      const x = Number(answerBox.x);
      const y = Number(answerBox.y);
      const width = Number(answerBox.width);
      const height = Number(answerBox.height);

      if (!pageNumber || pageNumber < 1 || pageNumber > pageCount) {
        throw new Error(`Invalid page number for question ${questionNumber || '?'}`);
      }
      if (!questionNumber) {
        throw new Error('Question number is required');
      }
      if (usedNumbers.has(questionNumber)) {
        throw new Error(`Duplicate question number: ${questionNumber}`);
      }
      usedNumbers.add(questionNumber);
      if (!answerText) {
        throw new Error(`Question ${questionNumber} is missing the correct answer`);
      }
      if (![x, y, width, height].every(Number.isFinite) || width <= 5 || height <= 5) {
        throw new Error(`Question ${questionNumber} has an invalid answer box`);
      }

      return {
        page_number: pageNumber,
        question_number: questionNumber,
        prompt_type: promptType,
        answer_text: answerText,
        answer_box: {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height)
        },
        points
      };
    }).sort((a, b) => a.question_number - b.question_number);

    return normalized;
  }

  async function fetchExamWithDetails(examId) {
    const examResult = await pool.query('SELECT * FROM vocab_exams WHERE id = $1', [examId]);
    if (examResult.rows.length === 0) return null;

    const [pagesResult, questionsResult, statsResult] = await Promise.all([
      pool.query(
        'SELECT id, exam_id, page_number, blank_image, answer_key_image FROM vocab_exam_pages WHERE exam_id = $1 ORDER BY page_number',
        [examId]
      ),
      pool.query(
        'SELECT id, exam_id, page_number, question_number, prompt_type, answer_text, answer_box, points FROM vocab_questions WHERE exam_id = $1 ORDER BY question_number',
        [examId]
      ),
      pool.query(
        'SELECT COUNT(*)::int AS submission_count FROM vocab_submissions WHERE exam_id = $1',
        [examId]
      )
    ]);

    return {
      exam: examResult.rows[0],
      pages: pagesResult.rows,
      questions: questionsResult.rows,
      submissionCount: statsResult.rows[0]?.submission_count || 0
    };
  }

  function buildExamLabel(exam) {
    if (exam.source_type === 'howdy' && exam.howdy_level && exam.unit && exam.book_type) {
      return `Howdy ${exam.howdy_level} Unit ${exam.unit} ${exam.book_type} Vocabulary`;
    }
    return exam.title;
  }

  function buildQuestionGuides(questions) {
    return questions.map(question => ({
      page_number: question.page_number,
      question_number: question.question_number,
      answer_box: question.answer_box
    }));
  }

  function serializeExamForTeacher(bundle) {
    const { exam, pages, questions, submissionCount } = bundle;
    return {
      id: exam.id,
      source_type: exam.source_type,
      howdy_level: exam.howdy_level,
      unit: exam.unit,
      book_type: exam.book_type,
      title: exam.title,
      pass_score: exam.pass_score,
      page_count: exam.page_count,
      status: exam.status,
      created_at: exam.created_at,
      updated_at: exam.updated_at,
      submission_count: submissionCount,
      question_count: questions.length,
      question_guides: buildQuestionGuides(questions),
      pages,
      questions
    };
  }

  function serializeExamForPublic(bundle) {
    const { exam, pages, questions } = bundle;
    return {
      id: exam.id,
      source_type: exam.source_type,
      howdy_level: exam.howdy_level,
      unit: exam.unit,
      book_type: exam.book_type,
      title: exam.title,
      pass_score: exam.pass_score,
      page_count: exam.page_count,
      status: exam.status,
      created_at: exam.created_at,
      pages: pages.map(page => ({
        page_number: page.page_number,
        blank_image: page.blank_image
      })),
      question_count: questions.length,
      question_guides: buildQuestionGuides(questions)
    };
  }

  async function saveExam(payload, existingId = null) {
    const sourceType = normalizeSourceType(payload.source_type);
    const { howdyLevel, unit, bookType } = normalizeHowdyMetadata(
      sourceType,
      payload.howdy_level,
      payload.unit,
      payload.book_type
    );
    const fallbackTitle = buildExamLabel({
      source_type: sourceType,
      howdy_level: howdyLevel,
      unit,
      book_type: bookType,
      title: ''
    });
    const title = cleanText(payload.title) || fallbackTitle;
    if (!title) {
      throw new Error('Title is required for custom exams');
    }
    const passScore = Number.isFinite(Number(payload.pass_score))
      ? Math.max(0, Math.min(100, Math.round(Number(payload.pass_score))))
      : 80;
    const status = normalizeStatus(payload.status);
    const pages = await sanitizePages(payload.pages);
    const questions = sanitizeQuestions(payload.questions || [], pages.length, { allowEmpty: status === 'draft' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let examId = existingId;
      if (existingId) {
        const updateResult = await client.query(`
          UPDATE vocab_exams
          SET source_type = $1,
              howdy_level = $2,
              unit = $3,
              book_type = $4,
              title = $5,
              pass_score = $6,
              page_count = $7,
              status = $8,
              updated_at = NOW()
          WHERE id = $9
          RETURNING id`,
          [sourceType, howdyLevel, unit, bookType, title, passScore, pages.length, status, existingId]
        );
        if (updateResult.rows.length === 0) {
          throw new Error('Exam not found');
        }
        await client.query('DELETE FROM vocab_exam_pages WHERE exam_id = $1', [existingId]);
        await client.query('DELETE FROM vocab_questions WHERE exam_id = $1', [existingId]);
      } else {
        const insertResult = await client.query(`
          INSERT INTO vocab_exams
            (source_type, howdy_level, unit, book_type, title, pass_score, page_count, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id`,
          [sourceType, howdyLevel, unit, bookType, title, passScore, pages.length, status]
        );
        examId = insertResult.rows[0].id;
      }

      for (const page of pages) {
        await client.query(`
          INSERT INTO vocab_exam_pages (exam_id, page_number, blank_image, answer_key_image)
          VALUES ($1, $2, $3, $4)`,
          [examId, page.page_number, page.blank_image, page.answer_key_image]
        );
      }

      for (const question of questions) {
        await client.query(`
          INSERT INTO vocab_questions
            (exam_id, page_number, question_number, prompt_type, answer_text, answer_box, points)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            examId,
            question.page_number,
            question.question_number,
            question.prompt_type,
            question.answer_text,
            JSON.stringify(question.answer_box),
            question.points
          ]
        );
      }

      await client.query('COMMIT');
      return examId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function assertPublishable(examId) {
    const bundle = await fetchExamWithDetails(examId);
    if (!bundle) throw new Error('Exam not found');
    if (!bundle.pages.length) throw new Error('Exam has no pages');
    if (!bundle.questions.length) throw new Error('Exam has no questions');

    const uniquePages = new Set(bundle.pages.map(page => page.page_number));
    if (uniquePages.size !== bundle.pages.length) {
      throw new Error('Exam page numbers are invalid');
    }

    for (const question of bundle.questions) {
      if (!question.answer_text || !cleanText(question.answer_text)) {
        throw new Error(`Question ${question.question_number} is missing an answer`);
      }
      if (!question.answer_box || !Number.isFinite(Number(question.answer_box.width))) {
        throw new Error(`Question ${question.question_number} is missing a valid answer box`);
      }
    }

    return bundle;
  }

  function clampBox(box, width, height, padding = 0) {
    const x = Math.max(0, Math.floor(Number(box.x) - padding));
    const y = Math.max(0, Math.floor(Number(box.y) - padding));
    const right = Math.min(width, Math.ceil(Number(box.x) + Number(box.width) + padding));
    const bottom = Math.min(height, Math.ceil(Number(box.y) + Number(box.height) + padding));
    return {
      left: x,
      top: y,
      width: Math.max(1, right - x),
      height: Math.max(1, bottom - y)
    };
  }

  function mergeBoxes(boxA, boxB) {
    if (!boxA) return boxB || null;
    if (!boxB) return boxA;

    const left = Math.min(boxA.left, boxB.left);
    const top = Math.min(boxA.top, boxB.top);
    const right = Math.max(boxA.left + boxA.width, boxB.left + boxB.width);
    const bottom = Math.max(boxA.top + boxA.height, boxB.top + boxB.height);
    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    };
  }

  function centerAxis(start, size, limit) {
    if (size >= limit) {
      return { start: 0, size: limit };
    }

    let nextStart = Math.round(start);
    if (nextStart < 0) nextStart = 0;
    if (nextStart + size > limit) nextStart = Math.max(0, limit - size);

    return {
      start: nextStart,
      size: Math.max(1, Math.min(size, limit))
    };
  }

  function expandBoxToAspect(box, maxWidth, maxHeight, targetAspect = 1.82) {
    if (!box) {
      return {
        left: 0,
        top: 0,
        width: Math.max(1, maxWidth),
        height: Math.max(1, maxHeight)
      };
    }

    let width = Math.max(1, Math.round(box.width));
    let height = Math.max(1, Math.round(box.height));
    const currentAspect = width / height;

    if (currentAspect < targetAspect) {
      width = Math.min(maxWidth, Math.round(height * targetAspect));
    } else {
      height = Math.min(maxHeight, Math.round(width / targetAspect));
    }

    const centerX = box.left + (box.width / 2);
    const centerY = box.top + (box.height / 2);
    const xAxis = centerAxis(centerX - (width / 2), width, maxWidth);
    const yAxis = centerAxis(centerY - (height / 2), height, maxHeight);

    return {
      left: xAxis.start,
      top: yAxis.start,
      width: xAxis.size,
      height: yAxis.size
    };
  }

  async function detectPrintedContentBounds(buffer, searchBox) {
    const extracted = await sharp(buffer)
      .extract(searchBox)
      .flatten({ background: '#ffffff' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = extracted.info;
    const threshold = 244;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let hits = 0;

    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        const value = extracted.data[rowOffset + x];
        if (value >= threshold) continue;
        hits += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (hits < 120 || maxX < minX || maxY < minY) {
      return null;
    }

    return {
      left: searchBox.left + minX,
      top: searchBox.top + minY,
      width: Math.max(1, maxX - minX + 1),
      height: Math.max(1, maxY - minY + 1)
    };
  }

  async function buildPromptPreview(pageBase64, answerBox) {
    const buffer = Buffer.from(pageBase64, 'base64');
    const metadata = await sharp(buffer).metadata();
    const pageWidth = metadata.width || 0;
    const pageHeight = metadata.height || 0;
    const answerBounds = clampBox(answerBox, pageWidth, pageHeight, 0);
    const searchBox = clampBox(
      {
        x: Number(answerBox.x) - Math.max(96, Math.round(Number(answerBox.width) * 1.7)),
        y: Number(answerBox.y) - Math.max(42, Math.round(Number(answerBox.height) * 0.95)),
        width: Number(answerBox.width) + Math.max(220, Math.round(Number(answerBox.width) * 3.4)),
        height: Number(answerBox.height) + Math.max(92, Math.round(Number(answerBox.height) * 2.2))
      },
      pageWidth,
      pageHeight,
      0
    );

    const contentBounds = await detectPrintedContentBounds(buffer, searchBox);
    let focusBox = mergeBoxes(contentBounds, answerBounds) || answerBounds;
    focusBox = clampBox(
      {
        x: focusBox.left - Math.max(18, Math.round(answerBounds.width * 0.25)),
        y: focusBox.top - Math.max(16, Math.round(answerBounds.height * 0.32)),
        width: focusBox.width + Math.max(36, Math.round(answerBounds.width * 0.5)),
        height: focusBox.height + Math.max(26, Math.round(answerBounds.height * 0.65))
      },
      pageWidth,
      pageHeight,
      0
    );
    focusBox = expandBoxToAspect(focusBox, pageWidth, pageHeight, 1.82);

    return (await sharp(buffer)
      .extract(focusBox)
      .resize({
        width: 1200,
        height: 660,
        fit: 'contain',
        background: '#ffffff',
        withoutEnlargement: false
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92 })
      .toBuffer()).toString('base64');
  }

  async function buildPromptPreviewFallback(pageBase64, answerBox) {
    const buffer = Buffer.from(pageBase64, 'base64');
    const metadata = await sharp(buffer).metadata();
    const pageWidth = metadata.width || 0;
    const pageHeight = metadata.height || 0;
    const cropBox = clampBox(
      {
        x: Number(answerBox.x) - Math.max(180, Math.round(Number(answerBox.width) * 2.2)),
        y: Number(answerBox.y) - Math.max(70, Math.round(Number(answerBox.height) * 1.8)),
        width: Number(answerBox.width) + Math.max(220, Math.round(Number(answerBox.width) * 2.9)),
        height: Number(answerBox.height) + Math.max(140, Math.round(Number(answerBox.height) * 3.6))
      },
      pageWidth,
      pageHeight,
      0
    );

    return (await sharp(buffer)
      .extract(cropBox)
      .resize({
        width: 1200,
        height: 660,
        fit: 'contain',
        background: '#ffffff',
        withoutEnlargement: false
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90 })
      .toBuffer()).toString('base64');
  }

  async function normalizePageBase64(base64) {
    const buffer = Buffer.from(base64, 'base64');
    return (await sharp(buffer)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 2000, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()).toString('base64');
  }

  async function buildHandwritingMask(studentBuffer, blankBuffer, cropBox) {
    const studentCrop = await sharp(studentBuffer)
      .extract(cropBox)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const blankCrop = await sharp(blankBuffer)
      .extract(cropBox)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = studentCrop.info;
    const masked = Buffer.alloc(width * height * 3, 255);

    for (let index = 0; index < studentCrop.data.length; index += 3) {
      const studentRed = studentCrop.data[index];
      const studentGreen = studentCrop.data[index + 1];
      const studentBlue = studentCrop.data[index + 2];
      const blankRed = blankCrop.data[index];
      const blankGreen = blankCrop.data[index + 1];
      const blankBlue = blankCrop.data[index + 2];

      const diff = Math.abs(studentRed - blankRed)
        + Math.abs(studentGreen - blankGreen)
        + Math.abs(studentBlue - blankBlue);
      const studentBrightness = studentRed + studentGreen + studentBlue;
      const blankBrightness = blankRed + blankGreen + blankBlue;
      const darkerThanBlank = studentBrightness + 28 < blankBrightness;
      const isInk = diff >= 58 || darkerThanBlank;

      if (isInk) {
        masked[index] = 0;
        masked[index + 1] = 0;
        masked[index + 2] = 0;
      }
    }

    return sharp(masked, {
      raw: {
        width,
        height,
        channels: 3
      }
    }).png().toBuffer();
  }

  async function ocrAnswerRegion(pageBase64, blankPageBase64, answerBox) {
    const input = Buffer.from(pageBase64, 'base64');
    const blankInput = Buffer.from(blankPageBase64, 'base64');
    const metadata = await sharp(input).metadata();
    const paddedBox = clampBox(
      answerBox,
      metadata.width || 0,
      metadata.height || 0,
      Math.max(12, Math.round(Math.min(answerBox.width, answerBox.height) * 0.15))
    );

    const handwritingOnly = await buildHandwritingMask(input, blankInput, paddedBox);

    const processed = await sharp(handwritingOnly)
      .grayscale()
      .normalize()
      .sharpen()
      .resize({
        width: Math.max(520, paddedBox.width * 4),
        height: Math.max(220, paddedBox.height * 4),
        fit: 'contain',
        withoutEnlargement: false,
        background: '#ffffff'
      })
      .threshold(210)
      .png()
      .toBuffer();

    const annotation = await callVisionAPI(processed.toString('base64'));
    const rawText = annotation?.fullTextAnnotation?.text || '';
    const confidence = annotation?.fullTextAnnotation?.pages?.[0]?.confidence || 0;

    return {
      detected_text: normalizeAnswerForCompare(rawText),
      confidence
    };
  }

  async function ocrStandaloneAnswerImage(base64) {
    const input = Buffer.from(base64, 'base64');
    const processed = await sharp(input)
      .rotate()
      .flatten({ background: '#ffffff' })
      .grayscale()
      .normalize()
      .sharpen()
      .resize({
        width: 640,
        height: 240,
        fit: 'contain',
        withoutEnlargement: false,
        background: '#ffffff'
      })
      .threshold(210)
      .png()
      .toBuffer();

    const annotation = await callVisionAPI(processed.toString('base64'));
    const rawText = annotation?.fullTextAnnotation?.text || '';
    const confidence = annotation?.fullTextAnnotation?.pages?.[0]?.confidence || 0;

    return {
      detected_text: normalizeAnswerForCompare(rawText),
      confidence
    };
  }

  function scoreVocabAnswer(detectedText, answerText, points) {
    const normalizedDetected = normalizeAnswerForCompare(detectedText);
    const normalizedAnswer = normalizeAnswerForCompare(answerText);
    return {
      normalized_detected_text: normalizedDetected,
      normalized_answer_text: normalizedAnswer,
      correct: normalizedDetected !== '' && normalizedDetected === normalizedAnswer,
      score: normalizedDetected !== '' && normalizedDetected === normalizedAnswer ? points : 0
    };
  }

  async function getNextAttemptNo(examId, studentName) {
    const result = await pool.query(`
      SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next_attempt_no
      FROM vocab_submissions
      WHERE exam_id = $1 AND LOWER(BTRIM(student_name)) = LOWER(BTRIM($2))`,
      [examId, studentName]
    );
    return parsePositiveInt(result.rows[0]?.next_attempt_no, 1) || 1;
  }

  function validateSubmissionImages(submissionImages, pageCount) {
    if (!Array.isArray(submissionImages) || submissionImages.length !== pageCount) {
      throw new Error(`Submission must contain ${pageCount} page images`);
    }
    submissionImages.forEach((image, index) => {
      if (!cleanText(image)) {
        throw new Error(`Submission page ${index + 1} is empty`);
      }
    });
  }

  async function normalizePageImages(images) {
    return Promise.all(images.map(image => normalizePageBase64(image)));
  }

  async function gradeFullSubmission(bundle, submissionImages) {
    validateSubmissionImages(submissionImages, bundle.pages.length);
    const normalizedImages = await normalizePageImages(submissionImages);
    const normalizedBlankImages = await normalizePageImages(bundle.pages.map(page => page.blank_image));
    const pageMap = new Map(bundle.pages.map((page, index) => [page.page_number, normalizedImages[index]]));
    const blankPageMap = new Map(bundle.pages.map((page, index) => [page.page_number, normalizedBlankImages[index]]));
    const gradedAnswers = [];

    for (const question of bundle.questions) {
      const canonical = resolveQuestionContent(bundle.exam, question);
      const pageImage = pageMap.get(question.page_number);
      const blankPageImage = blankPageMap.get(question.page_number);
      const ocrResult = await ocrAnswerRegion(pageImage, blankPageImage, question.answer_box);
      const scoreResult = scoreVocabAnswer(ocrResult.detected_text, canonical.answer_text, question.points);
      gradedAnswers.push({
        question_id: question.id,
        page_number: question.page_number,
        question_number: question.question_number,
        prompt_type: question.prompt_type,
        correct_answer: canonical.answer_text,
        detected_text: scoreResult.normalized_detected_text,
        correct: scoreResult.correct,
        score: scoreResult.score,
        points: question.points,
        ocr_confidence: ocrResult.confidence
      });
    }

    return { gradedAnswers, storedImages: normalizedImages };
  }

  async function gradeRetestSubmission(bundle, questionAttempts) {
    if (!Array.isArray(questionAttempts) || questionAttempts.length === 0) {
      throw new Error('Retest submission is missing question attempts');
    }

    const attemptMap = new Map();
    for (const attempt of questionAttempts) {
      const questionId = parsePositiveInt(attempt.question_id);
      const image = cleanText(attempt.image);
      if (!questionId || !image) {
        throw new Error('Each retest attempt must include question_id and image');
      }
      attemptMap.set(questionId, image);
    }

    const targetQuestions = bundle.questions.filter(question => attemptMap.has(question.id));
    if (!targetQuestions.length) {
      throw new Error('No matching retest questions were found');
    }

    const gradedAnswers = [];
    const storedImages = [];

    for (const question of targetQuestions) {
      const canonical = resolveQuestionContent(bundle.exam, question);
      const rawImage = attemptMap.get(question.id);
      const normalizedImage = (await sharp(Buffer.from(rawImage, 'base64'))
        .rotate()
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 90 })
        .toBuffer()).toString('base64');
      storedImages.push(normalizedImage);

      const ocrResult = await ocrStandaloneAnswerImage(normalizedImage);
      const scoreResult = scoreVocabAnswer(ocrResult.detected_text, canonical.answer_text, question.points);
      gradedAnswers.push({
        question_id: question.id,
        page_number: question.page_number,
        question_number: question.question_number,
        prompt_type: question.prompt_type,
        correct_answer: canonical.answer_text,
        detected_text: scoreResult.normalized_detected_text,
        correct: scoreResult.correct,
        score: scoreResult.score,
        points: question.points,
        ocr_confidence: ocrResult.confidence
      });
    }

    gradedAnswers.sort((a, b) => a.question_number - b.question_number);
    return { gradedAnswers, storedImages };
  }

  async function saveSubmission({
    examId,
    studentName,
    attemptMode,
    sourceSubmissionId,
    gradedAnswers,
    storedImages
  }) {
    const totalPossible = gradedAnswers.reduce((sum, answer) => sum + Number(answer.points || 0), 0);
    const totalScore = gradedAnswers.reduce((sum, answer) => sum + Number(answer.score || 0), 0);
    const percentage = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0;
    const wrongQuestionIds = gradedAnswers.filter(answer => !answer.correct).map(answer => answer.question_id);
    const attemptNo = await getNextAttemptNo(examId, studentName);

    const examResult = await pool.query('SELECT pass_score FROM vocab_exams WHERE id = $1', [examId]);
    if (examResult.rows.length === 0) {
      throw new Error('Exam not found');
    }
    const passScore = Number(examResult.rows[0].pass_score || 80);
    const passed = attemptMode === 'retest'
      ? wrongQuestionIds.length === 0
      : percentage >= passScore;

    const insertResult = await pool.query(`
      INSERT INTO vocab_submissions
        (exam_id, student_name, attempt_no, attempt_mode, source_submission_id, submission_images, graded_answers,
         total_score, total_possible, percentage, passed, wrong_question_ids)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, created_at`,
      [
        examId,
        studentName,
        attemptNo,
        attemptMode,
        sourceSubmissionId || null,
        JSON.stringify(storedImages),
        JSON.stringify(gradedAnswers),
        totalScore,
        totalPossible,
        percentage,
        passed,
        JSON.stringify(wrongQuestionIds)
      ]
    );

    return {
      id: insertResult.rows[0].id,
      created_at: insertResult.rows[0].created_at,
      attempt_no: attemptNo,
      total_score: totalScore,
      total_possible: totalPossible,
      percentage,
      passed,
      wrong_question_ids: wrongQuestionIds,
      graded_answers: gradedAnswers
    };
  }

  async function fetchSubmissionBundle(submissionId) {
    const submissionResult = await pool.query('SELECT * FROM vocab_submissions WHERE id = $1', [submissionId]);
    if (submissionResult.rows.length === 0) return null;

    const submission = submissionResult.rows[0];
    const examBundle = await fetchExamWithDetails(submission.exam_id);
    if (!examBundle) return null;

    return { submission, examBundle };
  }

  async function buildRetestQuestions(bundle, wrongQuestionIds) {
    const targetQuestions = bundle.questions.filter(question => wrongQuestionIds.includes(question.id));
    const pageMap = new Map(bundle.pages.map(page => [page.page_number, page]));

    const questions = await Promise.all(targetQuestions.map(async question => {
      const page = pageMap.get(question.page_number);
      const canonical = resolveQuestionContent(bundle.exam, question);
      let promptImage = '';
      try {
        promptImage = await buildPromptPreview(page.blank_image, question.answer_box);
      } catch (error) {
        console.warn(`Prompt preview heuristic failed for question ${question.id}, using fallback crop:`, error.message || error);
        promptImage = await buildPromptPreviewFallback(page.blank_image, question.answer_box);
      }

      return {
        question_id: question.id,
        page_number: question.page_number,
        question_number: question.question_number,
        prompt_type: question.prompt_type,
        points: question.points,
        correct_answer: canonical.answer_text,
        definition_zh: canonical.definition_zh,
        prompt_en: canonical.prompt_en,
        prompt_image: promptImage,
        answer_canvas_width: Math.max(420, question.answer_box.width * 2),
        answer_canvas_height: Math.max(140, question.answer_box.height * 2)
      };
    }));

    questions.sort((a, b) => a.question_number - b.question_number);
    return questions;
  }

  app.get('/api/vocab/exams', async (req, res) => {
    try {
      const teacherView = hasTeacherAccess(req) && String(req.query?.scope || '') === 'teacher';
      const params = [];
      let where = '';

      if (!teacherView) {
        params.push('published');
        where = 'WHERE e.status = $1';
      }

      const result = await pool.query(`
        SELECT
          e.id,
          e.source_type,
          e.howdy_level,
          e.unit,
          e.book_type,
          e.title,
          e.pass_score,
          e.page_count,
          e.status,
          e.created_at,
          e.updated_at,
          COUNT(DISTINCT q.id)::int AS question_count,
          COUNT(DISTINCT s.id)::int AS submission_count
        FROM vocab_exams e
        LEFT JOIN vocab_questions q ON q.exam_id = e.id
        LEFT JOIN vocab_submissions s ON s.exam_id = e.id
        ${where}
        GROUP BY e.id
        ORDER BY e.updated_at DESC, e.created_at DESC`,
        params
      );

      res.json(result.rows);
    } catch (err) {
      console.error('List vocab exams error:', err);
      res.status(500).json({ error: 'Failed to list vocab exams' });
    }
  });

  app.post('/api/vocab/exams', requireTeacherAuth, async (req, res) => {
    try {
      const examId = await saveExam(req.body || {}, null);
      const bundle = await fetchExamWithDetails(examId);
      res.status(201).json(serializeExamForTeacher(bundle));
    } catch (err) {
      console.error('Create vocab exam error:', err);
      res.status(400).json({ error: err.message || 'Failed to create vocab exam' });
    }
  });

  app.get('/api/vocab/exams/:id', async (req, res) => {
    try {
      const bundle = await fetchExamWithDetails(req.params.id);
      if (!bundle) {
        return res.status(404).json({ error: 'Exam not found' });
      }

      const teacherView = hasTeacherAccess(req);
      if (!teacherView && bundle.exam.status !== 'published') {
        return res.status(403).json({ error: 'Exam is not published' });
      }

      res.json(teacherView ? serializeExamForTeacher(bundle) : serializeExamForPublic(bundle));
    } catch (err) {
      console.error('Get vocab exam error:', err);
      res.status(500).json({ error: 'Failed to get vocab exam' });
    }
  });

  app.patch('/api/vocab/exams/:id', requireTeacherAuth, async (req, res) => {
    try {
      const examId = parsePositiveInt(req.params.id);
      if (!examId) return res.status(400).json({ error: 'Invalid exam id' });
      await saveExam(req.body || {}, examId);
      const bundle = await fetchExamWithDetails(examId);
      res.json(serializeExamForTeacher(bundle));
    } catch (err) {
      console.error('Update vocab exam error:', err);
      const status = /not found/i.test(String(err.message || '')) ? 404 : 400;
      res.status(status).json({ error: err.message || 'Failed to update vocab exam' });
    }
  });

  app.post('/api/vocab/exams/:id/publish', requireTeacherAuth, async (req, res) => {
    try {
      const examId = parsePositiveInt(req.params.id);
      if (!examId) return res.status(400).json({ error: 'Invalid exam id' });

      await assertPublishable(examId);
      const result = await pool.query(`
        UPDATE vocab_exams
        SET status = 'published', updated_at = NOW()
        WHERE id = $1
        RETURNING id, status, updated_at`,
        [examId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Exam not found' });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('Publish vocab exam error:', err);
      const status = /not found/i.test(String(err.message || '')) ? 404 : 400;
      res.status(status).json({ error: err.message || 'Failed to publish exam' });
    }
  });

  app.post('/api/vocab/submissions', async (req, res) => {
    try {
      const examId = parsePositiveInt(req.body?.exam_id);
      const studentName = cleanText(req.body?.student_name);
      const attemptMode = normalizeAttemptMode(req.body?.attempt_mode);
      const sourceSubmissionId = parsePositiveInt(req.body?.source_submission_id);

      if (!examId) return res.status(400).json({ error: 'exam_id is required' });
      if (!studentName) return res.status(400).json({ error: 'student_name is required' });

      const bundle = await fetchExamWithDetails(examId);
      if (!bundle) return res.status(404).json({ error: 'Exam not found' });
      if (bundle.exam.status !== 'published' && !hasTeacherAccess(req)) {
        return res.status(403).json({ error: 'Exam is not published' });
      }

      const gradingResult = attemptMode === 'retest'
        ? await gradeRetestSubmission(bundle, req.body?.question_attempts)
        : await gradeFullSubmission(bundle, req.body?.submission_images);

      const saveResult = await saveSubmission({
        examId,
        studentName,
        attemptMode,
        sourceSubmissionId,
        gradedAnswers: gradingResult.gradedAnswers,
        storedImages: gradingResult.storedImages
      });

      res.status(201).json({
        id: saveResult.id,
        exam_id: examId,
        title: bundle.exam.title,
        student_name: studentName,
        attempt_no: saveResult.attempt_no,
        attempt_mode: attemptMode,
        pass_score: bundle.exam.pass_score,
        total_score: saveResult.total_score,
        total_possible: saveResult.total_possible,
        percentage: saveResult.percentage,
        passed: saveResult.passed,
        wrong_question_ids: saveResult.wrong_question_ids,
        graded_answers: saveResult.graded_answers,
        created_at: saveResult.created_at
      });
    } catch (err) {
      console.error('Create vocab submission error:', err);
      res.status(err.statusCode || 400).json({ error: err.message || 'Failed to grade vocab submission' });
    }
  });

  app.get('/api/vocab/submissions/:id', async (req, res) => {
    try {
      const bundle = await fetchSubmissionBundle(req.params.id);
      if (!bundle) return res.status(404).json({ error: 'Submission not found' });

      const { submission, examBundle } = bundle;
      const exam = examBundle.exam;
      const teacherView = hasTeacherAccess(req);
      const gradedAnswers = canonicalizeGradedAnswers(exam, examBundle.questions, submission.graded_answers || []);
      const totalPossible = gradedAnswers.reduce((sum, answer) => sum + Number(answer.points || 0), 0);
      const totalScore = gradedAnswers.reduce((sum, answer) => sum + Number(answer.score || 0), 0);
      const percentage = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0;
      const wrongQuestionIds = gradedAnswers.filter(answer => !answer.correct).map(answer => answer.question_id);
      const passed = submission.attempt_mode === 'retest'
        ? wrongQuestionIds.length === 0
        : percentage >= Number(exam.pass_score || 80);

      res.json({
        id: submission.id,
        exam_id: exam.id,
        title: exam.title,
        source_type: exam.source_type,
        howdy_level: exam.howdy_level,
        unit: exam.unit,
        book_type: exam.book_type,
        pass_score: exam.pass_score,
        student_name: submission.student_name,
        attempt_no: submission.attempt_no,
        attempt_mode: submission.attempt_mode,
        source_submission_id: submission.source_submission_id,
        total_score: totalScore,
        total_possible: totalPossible,
        percentage,
        passed,
        wrong_question_ids: wrongQuestionIds,
        graded_answers: gradedAnswers,
        created_at: submission.created_at,
        submission_images: teacherView ? submission.submission_images : undefined
      });
    } catch (err) {
      console.error('Get vocab submission error:', err);
      res.status(500).json({ error: 'Failed to get vocab submission' });
    }
  });

  app.post('/api/vocab/submissions/:id/retest', async (req, res) => {
    try {
      const bundle = await fetchSubmissionBundle(req.params.id);
      if (!bundle) return res.status(404).json({ error: 'Submission not found' });

      const { submission, examBundle } = bundle;
      const wrongQuestionIds = Array.isArray(submission.wrong_question_ids)
        ? submission.wrong_question_ids.map(id => parsePositiveInt(id)).filter(Boolean)
        : [];

      if (!wrongQuestionIds.length) {
        return res.status(400).json({ error: 'This submission has no wrong questions to retest' });
      }

      const questions = await buildRetestQuestions(examBundle, wrongQuestionIds);
      const nextAttemptNo = await getNextAttemptNo(submission.exam_id, submission.student_name);

      res.json({
        exam_id: examBundle.exam.id,
        exam_title: examBundle.exam.title,
        source_submission_id: submission.id,
        student_name: submission.student_name,
        original_attempt_no: submission.attempt_no,
        next_attempt_no: nextAttemptNo,
        title: `${examBundle.exam.title} - 錯題再考`,
        pass_score: examBundle.exam.pass_score,
        questions
      });
    } catch (err) {
      console.error('Build vocab retest error:', err);
      res.status(500).json({ error: err.message || 'Failed to build retest' });
    }
  });
}

module.exports = {
  initVocabDB,
  registerVocabRoutes
};
