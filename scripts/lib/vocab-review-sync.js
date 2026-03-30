#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');

const DEFAULT_API_BASE = process.env.IMPORT_API_BASE_URL || 'https://automatic-english-assignment-grader-production.up.railway.app';

function parseNumberList(value, min, max) {
  const numbers = new Set();
  for (const part of String(value || '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [startRaw, endRaw] = trimmed.split('-', 2);
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`Invalid range: ${trimmed}`);
      }
      for (let n = Math.min(start, end); n <= Math.max(start, end); n += 1) {
        if (n < min || n > max) throw new Error(`Number out of range: ${n}`);
        numbers.add(n);
      }
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid number: ${trimmed}`);
      numbers.add(n);
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

function normalizeApiBase(apiBase) {
  return String(apiBase || '').replace(/\/+$/, '');
}

function buildTitle(level, unit) {
  return `Howdy ${level} Unit ${unit} Vocabulary`;
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
  const {
    timeoutMs = 30000,
    ...fetchOptions
  } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let text;
  let data;

  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    });
    text = await response.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = text;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms (${url})`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
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

async function loadReviewQuestions(reviewCsvPath) {
  const text = await fs.readFile(reviewCsvPath, 'utf8');
  const rows = csvParse(text);

  return rows.map((row, index) => ({
    page_number: 1,
    question_number: index + 1,
    prompt_type: 'picture_word',
    answer_text: String(row.suggested_answer || '').trim(),
    answer_box: buildStudentAnswerBox(row),
    points: 5
  }));
}

async function fetchTeacherExamList(apiBase, headers) {
  const { data } = await fetchJson(`${apiBase}/api/vocab/exams?scope=teacher`, { headers });
  return Array.isArray(data) ? data : [];
}

function findExamByTitle(exams, title) {
  return exams.find(exam => String(exam.title || '').trim().toLowerCase() === String(title || '').trim().toLowerCase()) || null;
}

module.exports = {
  DEFAULT_API_BASE,
  buildTitle,
  csvParse,
  ensureTeacherCookie,
  fetchJson,
  fetchTeacherExamList,
  findExamByTitle,
  loadReviewQuestions,
  normalizeApiBase,
  parseNumberList
};
