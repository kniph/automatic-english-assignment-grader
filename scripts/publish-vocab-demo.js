#!/usr/bin/env node
require('dotenv').config();

const path = require('path');
const {
  DEFAULT_API_BASE,
  ensureTeacherCookie,
  fetchJson,
  fetchTeacherExamList,
  findExamByTitle,
  loadReviewQuestions,
  normalizeApiBase
} = require('./lib/vocab-review-sync');

const ROOT = path.resolve(__dirname, '..');
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

  const exams = await fetchTeacherExamList(apiBase, headers);
  const target = findExamByTitle(exams, args.title);
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
