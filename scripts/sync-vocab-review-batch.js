#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const {
  DEFAULT_API_BASE,
  buildTitle,
  ensureTeacherCookie,
  fetchJson,
  fetchTeacherExamList,
  findExamByTitle,
  loadReviewQuestions,
  normalizeApiBase,
  parseNumberList
} = require('./lib/vocab-review-sync');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SUMMARY_PATH = path.join(ROOT, 'data', 'vocab-review-batch-v2', 'summary.json');

function parseArgs(argv) {
  const args = {
    apiBase: DEFAULT_API_BASE,
    teacherPasscode: process.env.TEACHER_PASSCODE || '',
    summaryPath: DEFAULT_SUMMARY_PATH,
    publish: false,
    dryRun: false,
    localOnly: false,
    maxMissing: 0,
    levels: null,
    units: null,
    limit: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--api-base') args.apiBase = argv[index + 1];
    else if (arg === '--teacher-passcode') args.teacherPasscode = argv[index + 1];
    else if (arg === '--summary') args.summaryPath = path.resolve(argv[index + 1]);
    else if (arg === '--publish') args.publish = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--local-only') args.localOnly = true;
    else if (arg === '--levels') args.levels = parseNumberList(argv[index + 1], 1, 10);
    else if (arg === '--units') args.units = parseNumberList(argv[index + 1], 1, 10);
    else if (arg === '--max-missing') args.maxMissing = parseMaxMissing(argv[index + 1]);
    else if (arg === '--limit') args.limit = parseLimit(argv[index + 1]);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);

    if (arg !== '--publish' && arg !== '--dry-run' && arg !== '--local-only' && arg !== '--help' && arg !== '-h') {
      index += 1;
    }
  }

  return args;
}

function parseMaxMissing(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid max missing value: ${value}`);
  return n;
}

function parseLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid limit value: ${value}`);
  return n;
}

async function loadSummary(summaryPath) {
  const raw = await fs.readFile(summaryPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('Summary file must be a JSON array');
  }
  return data;
}

function buildReviewCsvPath(entry) {
  const baseDir = path.isAbsolute(entry.outputDir)
    ? entry.outputDir
    : path.join(ROOT, entry.outputDir);
  return path.join(baseDir, 'review.csv');
}

function shouldIncludeEntry(entry, args) {
  if (args.levels && !args.levels.includes(Number(entry.howdy_level))) return false;
  if (args.units && !args.units.includes(Number(entry.unit))) return false;
  const missingCount = Math.max(0, Number(entry.expected_count) - Number(entry.detected_count));
  if (missingCount > args.maxMissing) return false;
  return true;
}

function summarizeSelection(entries) {
  const perfect = entries.filter(entry => entry.missing_count === 0).length;
  const near = entries.filter(entry => entry.missing_count > 0 && entry.missing_count <= 2).length;
  const hard = entries.filter(entry => entry.missing_count >= 3).length;
  return { perfect, near, hard };
}

async function backfillExam({ apiBase, headers, examId, reviewCsv, publish }) {
  const { data: exam } = await fetchJson(`${apiBase}/api/vocab/exams/${examId}`, { headers });
  if (!Array.isArray(exam.pages) || !exam.pages.length) {
    throw new Error('Target exam has no pages');
  }
  const preservePublished = !publish && exam.status === 'published';

  const questions = await loadReviewQuestions(reviewCsv);
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

  await fetchJson(`${apiBase}/api/vocab/exams/${examId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(payload)
  });

  if (!publish && !preservePublished) {
    const { data: updated } = await fetchJson(`${apiBase}/api/vocab/exams/${examId}`, { headers });
    return {
      id: examId,
      title: updated.title,
      status: updated.status,
      question_count: updated.questions?.length || questions.length,
      pass_score: updated.pass_score
    };
  }

  const { data: publishResult } = await fetchJson(`${apiBase}/api/vocab/exams/${examId}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify({})
  });

  const { data: publishedExam } = await fetchJson(`${apiBase}/api/vocab/exams/${examId}`, { headers });
  return {
    id: examId,
    title: publishedExam.title,
    status: publishedExam.status,
    question_count: publishedExam.questions?.length || questions.length,
    pass_score: publishedExam.pass_score,
    updated_at: publishResult.updated_at
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/sync-vocab-review-batch.js [options]

Options:
  --api-base <url>            API base URL (default: ${DEFAULT_API_BASE})
  --teacher-passcode <code>   Teacher passcode
  --summary <path>            Review summary JSON (default: ${DEFAULT_SUMMARY_PATH})
  --levels <list>             Limit to levels, e.g. 1,2 or 1-4
  --units <list>              Limit to units, e.g. 2-8
  --max-missing <n>           Keep entries with at most n missing answers (default: 0)
  --limit <n>                 Only process the first n selected entries
  --dry-run                   Print the selected batch without changing Railway
  --local-only                Do not call Railway; useful with --dry-run
  --publish                   Publish after backfilling the reviewed template
`);
    return;
  }

  const summary = await loadSummary(args.summaryPath);
  const selected = summary
    .map(entry => ({
      ...entry,
      title: buildTitle(entry.howdy_level, entry.unit),
      reviewCsv: buildReviewCsvPath(entry),
      missing_count: Math.max(0, Number(entry.expected_count) - Number(entry.detected_count))
    }))
    .filter(entry => shouldIncludeEntry(entry, args))
    .sort((left, right) => {
      if (left.howdy_level !== right.howdy_level) return left.howdy_level - right.howdy_level;
      return left.unit - right.unit;
    });

  const limited = args.limit ? selected.slice(0, args.limit) : selected;
  const selectionSummary = summarizeSelection(limited);

  if (args.localOnly || args.dryRun) {
    let remoteExams = [];
    if (!args.localOnly) {
      const apiBase = normalizeApiBase(args.apiBase);
      const teacherCookie = await ensureTeacherCookie(apiBase, String(args.teacherPasscode || '').trim());
      const headers = teacherCookie ? { Cookie: teacherCookie } : {};
      remoteExams = await fetchTeacherExamList(apiBase, headers);
    }

    const report = {
      mode: 'dry-run',
      selected_count: limited.length,
      filters: {
        levels: args.levels,
        units: args.units,
        max_missing: args.maxMissing,
        limit: args.limit,
        publish: args.publish
      },
      breakdown: selectionSummary,
      entries: limited.map(entry => {
        const target = remoteExams.length ? findExamByTitle(remoteExams, entry.title) : null;
        return {
          howdy_level: entry.howdy_level,
          unit: entry.unit,
          title: entry.title,
          expected_count: entry.expected_count,
          detected_count: entry.detected_count,
          missing_count: entry.missing_count,
          review_csv: path.relative(ROOT, entry.reviewCsv),
          exam_id: target?.id || null,
          remote_status: target?.status || null
        };
      })
    };

    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const apiBase = normalizeApiBase(args.apiBase);
  const teacherCookie = await ensureTeacherCookie(apiBase, String(args.teacherPasscode || '').trim());
  const headers = teacherCookie ? { Cookie: teacherCookie } : {};
  const exams = await fetchTeacherExamList(apiBase, headers);

  const results = [];
  for (let index = 0; index < limited.length; index += 1) {
    const entry = limited[index];
    const target = findExamByTitle(exams, entry.title);
    if (!target) {
      console.error(`[${index + 1}/${limited.length}] Skip ${entry.title}: exam not found`);
      results.push({
        howdy_level: entry.howdy_level,
        unit: entry.unit,
        title: entry.title,
        action: 'skipped',
        reason: 'exam_not_found'
      });
      continue;
    }

    console.error(`[${index + 1}/${limited.length}] ${args.publish ? 'Publish' : 'Backfill'} ${entry.title} (exam ${target.id})`);
    const result = await backfillExam({
      apiBase,
      headers,
      examId: target.id,
      reviewCsv: entry.reviewCsv,
      publish: args.publish
    });

    results.push({
      howdy_level: entry.howdy_level,
      unit: entry.unit,
      title: entry.title,
      action: args.publish ? 'published' : 'backfilled',
      exam_id: result.id,
      status: result.status,
      question_count: result.question_count,
      pass_score: result.pass_score,
      updated_at: result.updated_at || null
    });
  }

  console.log(JSON.stringify({
    mode: args.publish ? 'publish' : 'backfill',
    selected_count: limited.length,
    breakdown: selectionSummary,
    results
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
