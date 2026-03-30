#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_API_BASE = process.env.IMPORT_API_BASE_URL || 'https://automatic-english-assignment-grader-production.up.railway.app';
const DEFAULT_TITLE = 'Howdy 1 Unit 2 Vocabulary';
const DEFAULT_REVIEW_CSV = path.join(ROOT, 'data', 'vocab-review-batch-v2', 'howdy-1-unit-2', 'review.csv');

function parseArgs(argv) {
  const args = {
    apiBase: DEFAULT_API_BASE,
    teacherPasscode: process.env.TEACHER_PASSCODE || '',
    title: DEFAULT_TITLE,
    reviewCsv: DEFAULT_REVIEW_CSV
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--api-base') args.apiBase = argv[index + 1];
    else if (arg === '--teacher-passcode') args.teacherPasscode = argv[index + 1];
    else if (arg === '--title') args.title = argv[index + 1];
    else if (arg === '--review-csv') args.reviewCsv = path.resolve(argv[index + 1]);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);

    if (arg !== '--help' && arg !== '-h') index += 1;
  }

  return args;
}

function normalizeApiBase(apiBase) {
  return String(apiBase || '').replace(/\/+$/, '');
}

function csvParse(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header = [], ...dataRows] = rows;
  return dataRows
    .filter(cells => cells.some(cell => String(cell || '').trim()))
    .map(cells => Object.fromEntries(header.map((key, i) => [String(key || '').trim(), cells[i] ?? ''])));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }

  if (!response.ok) {
    const message = data && typeof data === 'object' && data.error
      ? data.error
      : `${response.status} ${response.statusText}`;
    throw new Error(`${message} (${url})`);
  }

  return { data, response };
}

function getSetCookieHeader(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    const values = response.headers.getSetCookie();
    return values[0] || '';
  }
  return response.headers.get('set-cookie') || '';
}

async function ensureTeacherCookie(apiBase, teacherPasscode) {
  const { data: status } = await fetchJson(`${apiBase}/api/teacher-auth/status`);
  if (!status.enabled) return '';
  if (!teacherPasscode) {
    throw new Error('Teacher passcode is required');
  }

  const { response, data } = await fetchJson(`${apiBase}/api/teacher-auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: teacherPasscode })
  });

  if (!data?.authenticated) {
    throw new Error('Teacher auth failed');
  }

  const cookie = String(getSetCookieHeader(response) || '').split(';')[0];
  if (!cookie) throw new Error('Teacher auth succeeded but no cookie was returned');
  return cookie;
}

async function loadReviewQuestions(reviewCsvPath) {
  const text = await fs.readFile(reviewCsvPath, 'utf8');
  const rows = csvParse(text);

  function buildStudentAnswerBox(row) {
    const baseLeft = Number(row.left);
    const baseTop = Number(row.top);
    const baseWidth = Number(row.width);
    const baseHeight = Number(row.height);
    const column = String(row.column || '').trim().toLowerCase();

    // Answer-key detection boxes hug the printed answer too tightly.
    // Student handwriting starts further left, so keep the right edge conservative
    // but pull the capture window left to preserve the first letter.
    const leftPad = 52 + (column === 'right'
      ? Math.max(10, Math.round(baseWidth * 0.1))
      : Math.max(16, Math.round(baseWidth * 0.18)));
    const rightTrim = Math.max(24, Math.round(baseWidth * 0.22));
    const topPad = Math.max(12, Math.round(baseHeight * 0.24));
    const bottomPad = Math.max(12, Math.round(baseHeight * 0.24));

    return {
      x: Math.max(0, baseLeft - leftPad),
      y: Math.max(0, baseTop - topPad),
      width: Math.max(72, baseWidth + leftPad - rightTrim),
      height: Math.max(56, baseHeight + topPad + bottomPad)
    };
  }

  return rows.map((row, index) => ({
    page_number: 1,
    question_number: index + 1,
    prompt_type: 'picture_word',
    answer_text: String(row.suggested_answer || '').trim(),
    answer_box: buildStudentAnswerBox(row),
    points: 5
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/publish-vocab-demo.js [options]

Options:
  --api-base <url>            API base URL (default: ${DEFAULT_API_BASE})
  --teacher-passcode <code>   Teacher passcode
  --title <title>             Target exam title (default: ${DEFAULT_TITLE})
  --review-csv <path>         Review CSV path (default: ${DEFAULT_REVIEW_CSV})
`);
    return;
  }

  const apiBase = normalizeApiBase(args.apiBase);
  const teacherCookie = await ensureTeacherCookie(apiBase, String(args.teacherPasscode || '').trim());
  const headers = teacherCookie ? { Cookie: teacherCookie } : {};

  const { data: exams } = await fetchJson(`${apiBase}/api/vocab/exams?scope=teacher`, { headers });
  const target = exams.find(exam => String(exam.title || '').trim().toLowerCase() === String(args.title || '').trim().toLowerCase());
  if (!target) {
    throw new Error(`Exam not found for title: ${args.title}`);
  }

  const { data: exam } = await fetchJson(`${apiBase}/api/vocab/exams/${target.id}`, { headers });
  if (!Array.isArray(exam.pages) || !exam.pages.length) {
    throw new Error('Target exam has no pages');
  }

  const questions = await loadReviewQuestions(args.reviewCsv);
  if (!questions.length) {
    throw new Error('No review questions loaded');
  }

  const payload = {
    source_type: exam.source_type || 'custom',
    title: exam.title,
    pass_score: exam.pass_score || 80,
    status: 'draft',
    pages: exam.pages.map(page => ({
      page_number: page.page_number,
      blank_image: page.blank_image,
      answer_key_image: page.answer_key_image
    })),
    questions
  };

  await fetchJson(`${apiBase}/api/vocab/exams/${target.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(payload)
  });

  const { data: publishResult } = await fetchJson(`${apiBase}/api/vocab/exams/${target.id}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify({})
  });

  const { data: publishedExam } = await fetchJson(`${apiBase}/api/vocab/exams/${target.id}`, { headers });

  console.log(JSON.stringify({
    id: target.id,
    title: publishedExam.title,
    status: publishedExam.status,
    question_count: publishedExam.questions?.length || 0,
    pass_score: publishedExam.pass_score,
    updated_at: publishResult.updated_at
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
