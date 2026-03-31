#!/usr/bin/env node
require('dotenv').config();

const {
  DEFAULT_API_BASE,
  ensureTeacherCookie,
  fetchJson,
  fetchTeacherExamList,
  findExamByTitle,
  normalizeApiBase,
  parseNumberList
} = require('./lib/vocab-review-sync');

const REVIEW_SPECS = [
  {
    reviewNumber: 1,
    reviewUnit: 9,
    label: 'Review 1',
    bookType: 'A',
    sourceUnits: [1, 2, 3, 4]
  },
  {
    reviewNumber: 2,
    reviewUnit: 10,
    label: 'Review 2',
    bookType: 'B',
    sourceUnits: [5, 6, 7, 8]
  }
];

function buildUnitTitle(level, unit) {
  return `Howdy ${level} Unit ${unit} Vocabulary`;
}

function buildReviewTitle(level, reviewNumber) {
  return `Howdy ${level} Review ${reviewNumber} Vocabulary`;
}

function parseArgs(argv) {
  const args = {
    apiBase: DEFAULT_API_BASE,
    teacherPasscode: process.env.TEACHER_PASSCODE || '',
    dryRun: false,
    publish: false,
    levels: [1, 2, 3, 4, 5, 6, 7, 8],
    reviews: [1, 2]
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--api-base') args.apiBase = argv[index + 1];
    else if (arg === '--teacher-passcode') args.teacherPasscode = argv[index + 1];
    else if (arg === '--levels') args.levels = parseNumberList(argv[index + 1], 1, 10);
    else if (arg === '--reviews') args.reviews = parseNumberList(argv[index + 1], 1, 2);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--publish') args.publish = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);

    if (!['--dry-run', '--publish', '--help', '-h'].includes(arg)) {
      index += 1;
    }
  }

  return args;
}

async function fetchExamBundle(apiBase, headers, examId) {
  const { data } = await fetchJson(`${apiBase}/api/vocab/exams/${examId}`, { headers });
  return data;
}

function buildReviewPayload(level, spec, sourceBundles) {
  const pages = sourceBundles.map((bundle, pageIndex) => {
    const page = Array.isArray(bundle.pages) ? bundle.pages[0] : null;
    if (!page?.blank_image || !page?.answer_key_image) {
      throw new Error(`${bundle.title || `exam ${bundle.id}`} is missing page images`);
    }
    return {
      page_number: pageIndex + 1,
      blank_image: page.blank_image,
      answer_key_image: page.answer_key_image
    };
  });

  let nextQuestionNumber = 1;
  const questions = [];
  sourceBundles.forEach((bundle, pageIndex) => {
    const unitQuestions = Array.isArray(bundle.questions)
      ? [...bundle.questions].sort((left, right) => Number(left.question_number) - Number(right.question_number))
      : [];
    if (!unitQuestions.length) {
      throw new Error(`${bundle.title || `exam ${bundle.id}`} has no questions`);
    }

    unitQuestions.forEach(question => {
      questions.push({
        page_number: pageIndex + 1,
        question_number: nextQuestionNumber,
        prompt_type: question.prompt_type || 'picture_word',
        answer_text: question.answer_text,
        answer_box: question.answer_box,
        points: Number(question.points) || 5
      });
      nextQuestionNumber += 1;
    });
  });

  return {
    source_type: 'howdy',
    howdy_level: level,
    unit: spec.reviewUnit,
    book_type: spec.bookType,
    title: buildReviewTitle(level, spec.reviewNumber),
    pass_score: 80,
    status: 'draft',
    pages,
    questions
  };
}

function summarizeCandidate(level, spec, exams) {
  const sourceTitles = spec.sourceUnits.map(unit => buildUnitTitle(level, unit));
  const sourceExams = sourceTitles.map(title => findExamByTitle(exams, title));
  const missingSources = sourceTitles.filter((_, index) => !sourceExams[index]).length;
  const emptyQuestionSources = sourceExams.filter(exam => exam && Number(exam.question_count || 0) <= 0).length;
  const ready = missingSources === 0 && emptyQuestionSources === 0;

  return {
    level,
    review: spec.reviewNumber,
    title: buildReviewTitle(level, spec.reviewNumber),
    unit: spec.reviewUnit,
    source_units: spec.sourceUnits,
    ready,
    missing_sources: missingSources,
    empty_question_sources: emptyQuestionSources,
    source_exams: sourceExams.map((exam, index) => ({
      unit: spec.sourceUnits[index],
      id: exam?.id || null,
      title: sourceTitles[index],
      status: exam?.status || null,
      question_count: exam?.question_count || 0
    }))
  };
}

async function createOrUpdateReviewExam({ apiBase, headers, level, spec, exams, publish }) {
  const sourceTitles = spec.sourceUnits.map(unit => buildUnitTitle(level, unit));
  const sourceExams = sourceTitles.map(title => findExamByTitle(exams, title));

  const missingTitle = sourceTitles.find((_, index) => !sourceExams[index]);
  if (missingTitle) {
    throw new Error(`Missing source exam: ${missingTitle}`);
  }

  const sourceBundles = [];
  for (const exam of sourceExams) {
    const bundle = await fetchExamBundle(apiBase, headers, exam.id);
    if (!Array.isArray(bundle.pages) || bundle.pages.length !== 1) {
      throw new Error(`${bundle.title || `exam ${bundle.id}`} must have exactly 1 page`);
    }
    if (!Array.isArray(bundle.questions) || !bundle.questions.length) {
      throw new Error(`${bundle.title || `exam ${bundle.id}`} has no questions`);
    }
    sourceBundles.push(bundle);
  }

  const payload = buildReviewPayload(level, spec, sourceBundles);
  const existing = findExamByTitle(exams, payload.title);

  let reviewId = existing?.id || null;
  if (reviewId) {
    await fetchJson(`${apiBase}/api/vocab/exams/${reviewId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(payload)
    });
  } else {
    const { data } = await fetchJson(`${apiBase}/api/vocab/exams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(payload)
    });
    reviewId = data.id;
  }

  if (publish) {
    await fetchJson(`${apiBase}/api/vocab/exams/${reviewId}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({})
    });
  }

  const finalBundle = await fetchExamBundle(apiBase, headers, reviewId);
  return {
    id: finalBundle.id,
    title: finalBundle.title,
    status: finalBundle.status,
    question_count: Array.isArray(finalBundle.questions) ? finalBundle.questions.length : 0,
    page_count: Array.isArray(finalBundle.pages) ? finalBundle.pages.length : 0
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/sync-vocab-review-exams.js [options]

Options:
  --api-base <url>            API base URL (default: ${DEFAULT_API_BASE})
  --teacher-passcode <code>   Teacher passcode
  --levels <list>             Howdy levels to process, e.g. 2 or 2,3,8
  --reviews <list>            Review numbers to process, e.g. 1 or 1,2
  --dry-run                   Print what would be created
  --publish                   Publish the created/updated review exams
`);
    return;
  }

  const apiBase = normalizeApiBase(args.apiBase);
  const teacherCookie = await ensureTeacherCookie(apiBase, String(args.teacherPasscode || '').trim());
  const headers = teacherCookie ? { Cookie: teacherCookie } : {};
  const exams = await fetchTeacherExamList(apiBase, headers);

  const specs = REVIEW_SPECS.filter(spec => args.reviews.includes(spec.reviewNumber));
  const candidates = [];
  for (const level of args.levels) {
    for (const spec of specs) {
      candidates.push(summarizeCandidate(level, spec, exams));
    }
  }

  if (args.dryRun) {
    console.log(JSON.stringify({
      api_base: apiBase,
      publish: args.publish,
      selected_levels: args.levels,
      selected_reviews: args.reviews,
      candidates
    }, null, 2));
    return;
  }

  const results = [];
  for (const level of args.levels) {
    for (const spec of specs) {
      try {
        const result = await createOrUpdateReviewExam({
          apiBase,
          headers,
          level,
          spec,
          exams,
          publish: args.publish
        });
        results.push({
          level,
          review: spec.reviewNumber,
          action: 'upserted',
          ...result
        });
      } catch (error) {
        results.push({
          level,
          review: spec.reviewNumber,
          action: 'skipped',
          error: error.message
        });
      }
    }
  }

  console.log(JSON.stringify({
    api_base: apiBase,
    publish: args.publish,
    results
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
