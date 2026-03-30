# Key Project Facts

Essential project configuration, constants, and quick reference information.

---

## Deployment & Infrastructure

**Platform**: Railway (Node.js service + PostgreSQL plugin)
**Database**: PostgreSQL (Railway-hosted, same project)
**Auto-Deploy**: Yes — every push to `main` branch triggers deployment
**Dev URL**: http://localhost:3000
**Production URL**: Railway-assigned (check Railway dashboard)

---

## Environment Variables

**Required:**
- `DATABASE_URL` — PostgreSQL connection string (auto-set by Railway plugin)
- `ANTHROPIC_API_KEY` — Claude API key for AI grading (set manually in Railway)

**Optional:**
- `PORT` — Server port (default: 3000; Railway sets this automatically)
- `NODE_ENV` — `production` on Railway (enables SSL for DB)
- `GOOGLE_VISION_API_KEY` — Legacy OCR key (no longer used in main workflow)
- `TEACHER_PASSCODE` — optional simple teacher passcode; when set, upload / grading / teacher-result APIs require a teacher auth cookie

---

## Database Schema

### `assignments` (v2 — student workflow)
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `howdy_level` | INTEGER | 1–10 |
| `unit` | INTEGER | 1–10 (see mapping below) |
| `book_type` | VARCHAR(1) | 'A', 'B', or 'C' |
| `assignment_image` | TEXT | Base64 JPEG of blank workbook page (may be multi-page stitched vertically) |
| `answer_key_image` | TEXT | Base64 JPEG of answer key (never sent to student) |
| `audio_files` | JSONB | `[{name, label, data (base64 mp3)}]` |
| `supplemental_notes` | TEXT | Optional teacher-entered grading notes for hard question types (`matching`, `skip`, `written_only`, etc.) |
| `grading_status` | VARCHAR(20) | `ready`, `review_required`, or `blocked` |
| `risk_summary` | TEXT | Teacher-facing / student-facing note explaining why manual review is needed |
| `created_at` | TIMESTAMP | |

**Unique constraint**: `(howdy_level, unit, book_type)` — UPSERT on duplicate

**Unit value mapping**:
| Value | Label |
|---|---|
| 1–8 | Unit 1–8 |
| 9 | Review 1 (in WB A) |
| 10 | Review 2 (in WB B) |

### `student_submissions` (v2 — student workflow)
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `assignment_id` | INTEGER FK | → assignments(id) CASCADE DELETE |
| `student_name` | VARCHAR(100) | |
| `submission_image` | TEXT | Base64 JPEG (merged background + canvas drawing) |
| `answers` | JSONB | `[{question_number, correct, score, detected_text, correct_answer, match_type}]` |
| `total_score` | INTEGER | |
| `total_possible` | INTEGER | |
| `percentage` | INTEGER | |
| `score_status` | VARCHAR(20) | `official` or `provisional` |
| `review_summary` | TEXT | Warning shown when the score is provisional |
| `graded_at` | TIMESTAMP | |

### `answer_keys` (v1 — legacy, kept for backward compatibility)
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `teacher_name` | VARCHAR(100) | |
| `name` | VARCHAR(200) | Assignment display name |
| `mode` | VARCHAR(10) | 'simple', 'roi', or 'claude' |
| `template_image` | TEXT | Base64 JPEG of answer key |
| `questions` | JSONB | Structured question list |
| `settings` | JSONB | Grading settings |
| `total_points` | INTEGER | |
| `created_at` | TIMESTAMP | |

### `grading_results` (v1 — legacy)
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `answer_key_id` | INTEGER FK | → answer_keys(id) CASCADE DELETE |
| `student_name` | VARCHAR(100) | |
| `original_image` | TEXT | |
| `answers` | JSONB | |
| `total_score` | INTEGER | |
| `total_possible` | INTEGER | |
| `graded_at` | TIMESTAMP | |

---

## API Endpoints

### Student Workflow (v2)
- `GET  /api/assignments/available` — list all non-blocked (howdy, unit, book) combinations available to students
- `GET  /api/assignments?howdy=&unit=&book=` — filter assignments (no images/audio, metadata only; includes `has_supplemental_notes`, `grading_status`, `risk_summary`)
- `GET  /api/assignments/:id` — get assignment with workbook image + audio (NO answer key); blocked assignments return 403
- `POST /api/assignments` — create/upsert assignment (teacher only; accepts optional `supplemental_notes`, `grading_status`, `risk_summary`)
- `DELETE /api/assignments/:id`
- `POST /api/submissions` — student submits merged drawing → Claude grades → returns results with `score_status` / `review_summary`
- `GET  /api/submissions?assignment_id=X` — list submissions for teacher view
- `GET  /api/submissions/:id` — get single submission with answers
- `GET  /api/teacher-auth/status` — whether teacher passcode is enabled / current browser is authenticated
- `POST /api/teacher-auth/verify` — verify teacher passcode and set teacher auth cookie
- `POST /api/teacher-auth/logout` — clear teacher auth cookie

### Legacy v1 (still functional)
- `POST /api/answer-keys` — create answer key
- `GET  /api/answer-keys?teacher_name=` — list
- `GET  /api/answer-keys/:id`
- `DELETE /api/answer-keys/:id`
- `POST /api/grade` — grade single student image
- `POST /api/grade/batch` — batch grade
- `GET  /api/results/:answerKeyId` — list results
- `GET  /api/results/:answerKeyId/analysis` — weakness analysis
- `GET  /api/results/:answerKeyId/export` — CSV export (UTF-8 BOM for Excel)

### Utilities
- `GET  /api/health`
- `POST /api/convert-heic` — HEIC → JPEG
- `POST /api/parse-document` — PDF/DOCX → structured answers (Google Vision)
- `POST /api/ocr/region` — OCR a cropped region (legacy)

### Vocab Module
- `GET  /api/vocab/exams` — published vocab exams for student selection
- `GET  /api/vocab/exams?scope=teacher` — full vocab exam list for teacher builder
- `POST /api/vocab/exams` — create vocab exam draft (teacher only)
- `GET  /api/vocab/exams/:id` — public exam data when published; full template when teacher-authenticated
- `PATCH /api/vocab/exams/:id` — update exam/pages/questions (teacher only)
- `POST /api/vocab/exams/:id/publish` — validate and publish exam (teacher only)
- `POST /api/vocab/submissions` — submit full exam or retest answers for grading
- `GET  /api/vocab/submissions/:id` — fetch saved result details
- `POST /api/vocab/submissions/:id/retest` — build wrong-question retest payload

---

## Pages

| File | Role | Audience |
|---|---|---|
| `public/index.html` | Student entry: name → Howdy → Unit → Book | Student |
| `public/assignment.html` | Canvas drawing + audio + submit + results | Student |
| `public/teacher.html` | Upload assignments (image + answer key + audio); prompts for teacher passcode when enabled | Teacher |
| `public/grader.html` | Legacy: manual upload + grade + analysis; prompts for teacher passcode when enabled | Teacher (v1) |
| `public/*-v1.html` | Backup of v1 pages | Archive |
| `public/vocab-teacher.html` | Vocab exam builder: page upload, answer-box marking, publish/list | Teacher |
| `public/vocab-exam.html` | Student vocab exam selection + multi-page writing UI | Student |
| `public/vocab-result.html` | Per-attempt vocab grading result page | Student |
| `public/vocab-retest.html` | Wrong-question retest UI built from a previous submission | Student |

---

## Vocab Module Schema

### `vocab_exams`
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `source_type` | VARCHAR(20) | `howdy` or `custom` |
| `howdy_level` | INTEGER | nullable unless source=`howdy` |
| `unit` | INTEGER | nullable unless source=`howdy` |
| `book_type` | VARCHAR(1) | nullable unless source=`howdy` |
| `title` | VARCHAR(200) | teacher-facing / student-facing exam name |
| `pass_score` | INTEGER | default 80 |
| `page_count` | INTEGER | 1–4 |
| `status` | VARCHAR(20) | `draft` or `published` |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

### `vocab_exam_pages`
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `exam_id` | INTEGER FK | → `vocab_exams(id)` CASCADE DELETE |
| `page_number` | INTEGER | 1–4 |
| `blank_image` | TEXT | base64 JPEG |
| `answer_key_image` | TEXT | base64 JPEG |

### `vocab_questions`
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `exam_id` | INTEGER FK | → `vocab_exams(id)` CASCADE DELETE |
| `page_number` | INTEGER | which uploaded page contains the question |
| `question_number` | INTEGER | unique within exam |
| `prompt_type` | VARCHAR(40) | currently `picture_word` / `phrase` |
| `answer_text` | TEXT | canonical strict answer |
| `answer_box` | JSONB | `{x,y,width,height}` in original page coordinates |
| `points` | INTEGER | default 5 |

### `vocab_submissions`
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `exam_id` | INTEGER FK | → `vocab_exams(id)` CASCADE DELETE |
| `student_name` | VARCHAR(100) | |
| `attempt_no` | INTEGER | increments per exam + student |
| `attempt_mode` | VARCHAR(20) | `full` or `retest` |
| `source_submission_id` | INTEGER FK | prior attempt when this is a retest |
| `submission_images` | JSONB | base64 JPEG array |
| `graded_answers` | JSONB | per-question OCR + score payload |
| `total_score` | INTEGER | |
| `total_possible` | INTEGER | |
| `percentage` | INTEGER | |
| `passed` | BOOLEAN | based on exam `pass_score` |
| `wrong_question_ids` | JSONB | source for the next retest |
| `created_at` | TIMESTAMP | |

---

## Key Libraries

| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Claude Vision grading API |
| `sharp` | Server-side image compression/rotation |
| `heic-convert` | HEIC → JPEG conversion |
| `mammoth` | DOCX text extraction (legacy) |
| `pg` | PostgreSQL client |
| `express` | HTTP server |
| PDF.js (CDN) | Client-side PDF → canvas → JPEG |

---

## Import Scripts

- `npm run import:assignments` — batch import workbook assignments from `WBs/`
- `npm run import:vocab` — batch import vocab blank/answer image pairs from `VOCs/`

Current `import:vocab` behavior:
- scans `VOCs/空白卷/NH*/H*U*.{jpg,jpeg,png}`
- scans `VOCs/掃描檔/H*/H*U*.{jpg,jpeg,png}`
- ignores conflict duplicates such as `_Conflict.jpg`
- creates vocab draft exams with 1 page and no questions yet
- intended to preload blank/answer sheets so teachers only need to draw answer boxes and type answers

---

## AI Grading Model

**Current model**: `claude-sonnet-4-6`
**Approx cost**: ~$0.01–0.02 per grading (two images in, JSON out)
**Model history**:
| Date | Model | Reason |
|---|---|---|
| 2026-03-28 | `claude-opus-4-6` | Initial |
| 2026-03-28 | `claude-haiku-4-5-20251001` | Cost reduction (~15× cheaper) |
| 2026-03-29 | `claude-sonnet-4-6` | Haiku too inaccurate for visual grading tasks |

**Why Sonnet over Haiku**: Haiku failed to detect "both words circled" errors, couldn't reliably distinguish partial answers from complete ones, and misidentified matching line connections. Sonnet 4.6 significantly improves visual spatial reasoning.

To change model: edit `gradeWithClaude()` and `gradeHandwriting()` in `server.js`.

### Shared Grading References

Reusable grading context is stored in:

- `data/grading_references/global.md`
- `data/grading_references/howdy-<level>.md`
- `data/grading_references/howdy-<level>-unit-<unit>.md`
- `data/grading_references/howdy-<level>-unit-<unit>-book-<book>.md`

These files are automatically injected into `gradeHandwriting()` before grading.

Best use cases:
- recurring main characters across a whole Howdy level
- recurring named places or pets
- workbook-specific visual conventions that repeat across units

Do not use these files for one-off answer keys. One-off section rules still belong in `assignments.supplemental_notes`.

### Supplemental Grading Notes

Teachers can add plain-text notes in `public/teacher.html` for question types that are unreliable from images alone.

Typical patterns:
- Section-specific matching pairs, e.g. `[C] matching` followed by `1. Lucy -> toy shop`
- `skip` for sections that should be excluded from scoring
- `written_only` when the model should ignore a circling/matching subtask and grade only the written answer

These notes are stored in `assignments.supplemental_notes` and are treated as higher priority than the answer-key image for the sections they mention.

---

## Image Storage Notes

All images stored as Base64 TEXT in PostgreSQL. Server-side compression via Sharp before INSERT:
- Max dimensions: 2000 × 2800 px
- JPEG quality: 85–90
- Typical stored size: ~150–300 KB per image (base64)
- Audio files stored as base64 MP3 — 1 MB MP3 ≈ 1.35 MB base64

**Railway PostgreSQL hobby plan**: 1 GB storage limit.
~300 assignments (Howdy 1–10 × 10 units including Review × A/B/C) × ~1 MB each ≈ ~300 MB for all assignments.
Note: Multi-page stitched images (3 pages per unit) are compressed server-side to max width 2000px before storage.

---

## Howdy 1 Workbook Question Types & AI Grading Reliability

Analysed by reviewing NH1 WB A (U1–U8, Review 1) and NH1 WB B (U1–U8, Review 2) in full.

### 🟢 Reliably Gradable

| Question Type | Example | Notes |
|---|---|---|
| Fill-in blanks (word bank) | "Use the words in the box to fill in the blanks" | Write one word from a given list. High accuracy. |
| Unscramble and write | "small / elephant / Is / this / ?" → "Is this elephant small?" | Rearrange words into a sentence. Text comparison. |
| Fill missing letters | `b _ o _ h _ _ _` (brother) | Partial word completion. |
| Read and circle (1 word/blank) | "He is my father / mother." | Circle one correct word per choice pair. |
| Listen/Read and number | Number boxes in correct order | Write 1–6 in picture boxes based on audio/reading. |
| Listen and write (dialogue) | Fill blanks in a conversation from word bank | Word-level fill-in from listening. |

### 🟡 Gradable with Caveats

| Question Type | Risk | Mitigation |
|---|---|---|
| Read and circle (2 blanks/sentence) | Student may circle BOTH words in one blank | Prompt rule: both circled = wrong. Still occasionally missed. |
| Listen/Read and check (single column) | Must identify which checkbox is ticked | Prompt rule added. Works ~85% of time. |
| Listen and check (image pairs) | Must identify which image in a pair has a tick | Visual position identification. Moderate accuracy. |
| Listen and check (grid/table format) | Tick is in a specific row/column cell | Grid spatial reasoning; Sonnet handles better than Haiku. |
| Read and circle correct picture | Circle one of two images | Identifying which image is circled. |
| Look at picture, count and write | Count objects in scene, write number | Depends on image clarity and zoom level. |
| Decode and match | Number-to-letter code → decode sentence → match | Decoding part reliable; matching line part uncertain. |

### 🔴 High-Risk / Unreliable

| Question Type | Problem | Recommended Approach |
|---|---|---|
| **Look / Listen and match (line connecting)** | AI cannot reliably trace hand-drawn lines through crossing paths, especially red lines on complex backgrounds | **Use supplemental notes with teacher-entered matching pairs** (see ADR-008) |
| **Listen, circle AND match (combined)** | Two high-risk operations compounded (U5 WB A Part C) | Treat as match and provide the correct pairs in supplemental notes |
| **Complete the crossword** | Grid spatial reasoning extremely unreliable | **Mark the section `skip` in supplemental notes** |
| **Circle hidden word in letter jumble** | Find and circle a word hidden in random letters (U7 WB A Part F) | Use `written_only` in supplemental notes; grade only the written answer below |

### ⚫ Not Gradable (Skip)

| Question Type | Reason |
|---|---|
| Draw yourself / Draw your best friend | Creative free drawing |
| Read and color / Write and color | Coloring activity |
| Connect the dots, then color and write | Dot-to-dot drawing |
| Maze (help zoo keeper find animals) | Navigate a maze |
| Read and guess, then draw | Guess riddle and draw the answer |

### Combined Types (grade text part, skip visual part)

| Question Type | Gradable Part | Skip Part |
|---|---|---|
| Write and find the words (word search) | Write character name under picture | Circle word in grid |
| Match and unscramble | Written unscrambled word | Matching line |
| Circle and write, then color | Written word | Circle in jumble + coloring |
| Complete the words and draw | Missing letters filled in | Drawing the shape |

---

## 2026-03-30 Import Readiness Snapshot (Howdy 1-10)

Dataset rechecked after batch downloading and normalization.

### Asset Completeness

| Asset Type | Scope | Count | Status |
|---|---|---:|---|
| Workbook A blank pages | Howdy 1-10 | 260 | Complete |
| Workbook B blank pages | Howdy 1-10 | 260 | Complete |
| Workbook C blank pages | Howdy 1-10 | 248 | Complete |
| Workbook A answer keys | Howdy 1-10 | 260 | Complete |
| Workbook B answer keys | Howdy 1-10 | 260 | Complete |
| Workbook C answer keys | Howdy 1-10 | 248 | Complete |
| Workbook A audio | Howdy 1-10 | 143 | Complete for the series' real audio pattern |
| Workbook B audio | Howdy 1-10 | 176 | Complete for the series' real audio pattern |
| Workbook C audio | Howdy 1-10 | 0 | Expected; WB C has no listening activities |

### Import Readiness

- `Howdy 1-9 / WBA-WBC` blank pages: ready to import
- `Howdy 10 / WBA-WBC` blank pages: ready to import after 2026-03-30 page-range correction
- `Howdy 1-10 / WBA-WBC` answer keys: ready to import
- `Howdy 1-10 / WBA-WBB` audio: ready to import
- `Howdy 1-10 / WBC` audio: not applicable by design

### Supplemental Notes Backfill

- `scripts/generate-supplemental-manifest.js` uses Google Vision OCR on stitched blank pages to detect high-risk sections and generate default `supplemental_notes`
- `scripts/import-assignments.js` accepts:
  - `--supplemental-manifest <path>`
  - `--only-manifested`
- Production assignments with `supplemental_notes` after the 2026-03-30 backfill: `126`
- Safe-range manifest coverage:
  - `Howdy 1-9`: `119 / 234` assignments received generated notes
  - `Howdy 10 / WBA-WBB`: `3` assignments received generated notes after the blank-page fix
  - `Howdy 10 / WBC`: `4` assignments received generated/manual notes after the 4-page-unit fix

### Howdy 10 Special Blank-Page Ranges

- Workbook A blank pages: mobile `85-110`
- Workbook B blank pages: mobile `113-138`
- Workbook C blank pages: mobile `140-171`
- The generic Howdy 2-10 mobile-page assumptions do **not** hold for Howdy 10
- `Howdy 10 / WBC` uses `4` pages per unit instead of `3`
- Source `pageConfig` answer keys missing: `HGR10_4.jpg`, `HGR10_6.jpg`, `HGR10_14.jpg`, `HGR10_24.jpg`
- Those four gaps are handled by explicit `skip` notes plus blank-page AK fallbacks so the affected assignments stay importable without being `blocked`

### Series-Wide AI Grading Risk Tiers

These tiers are based on:
- full question-type review of Howdy 1 WB A/B
- representative sampling from Howdy 5, 8, and 10 across WB A/B/C
- observed recurring task patterns across the series

#### 🟢 No-Risk

Use normal import flow. These rely mostly on OCR + text comparison and require little or no spatial reasoning.

- Fill in the blanks from a word bank
- Complete missing letters in a word
- Unscramble words or sentences and write the answer
- Choose the correct word form from brackets and write it
- Rewrite a sentence in a fixed target form
- Short fixed-answer written responses where the expected wording is explicit in the answer key
- Dialogue completion when students write text into dedicated blanks

#### 🟡 Low-Risk

Usually safe to auto-grade, but still worth spot-checking after first import of a new series/book.

- True/False with a clear mark and a fixed correction sentence
- Single-choice text options marked by circling or checking
- Numbering tasks where students write `1-6` or similar in boxes or blanks
- Read-and-answer items where the answer is copied or lightly transformed from the passage
- Simple decode tasks when grading only the written decoded answer
- Listen-and-write sections with short word or phrase answers

#### 🟠 Medium-Risk

Importable, but these should be watched more closely. They depend on image interpretation, spatial position, or allow more answer variation.

- Circle the correct picture
- Check the correct picture in a pair or row
- Count objects in a scene and write the number
- Checkbox tasks inside a grid or table
- Order/number speech bubbles or picture panels
- Mixed tasks such as `listen and check`, `read and circle`, then write
- Reading short-answer questions where multiple acceptable phrasings are likely
- Sentence rewriting tasks where the student's wording may be correct but not identical to the answer key

#### 🔴 High-Risk

Do not rely on image-only grading. These need `supplemental_notes`, `written_only`, or `skip`.

- Matching by drawing lines
- Any combined `circle + match` or `listen + match` section
- Crossword or puzzle grids
- Hidden-word / word-search circling
- Tasks that require tracing lines, arrows, or paths through a complex image
- Any section where correctness depends mainly on where a student drew or circled, rather than what they wrote

### Recommended Import Policy

- Import no-risk and low-risk sections normally
- Import medium-risk sections, but plan for smoke tests and per-book spot checks
- Pre-mark high-risk sections with:
  - `matching` plus teacher-entered text pairs
  - `written_only`
  - `skip`

### Non-Scoring Activity Types

These are not "no-risk"; they should usually be excluded from scoring entirely.

- Draw / guess and draw
- Read and color / write and color
- Dot-to-dot / connect the dots
- Maze / path-finding
- Any free drawing or coloring extension activity

---

## Batch Import Tool

- Command: `npm run import:assignments`
- Script: `scripts/import-assignments.js`
- Source of truth: local `WBs/Howdy N/` folders
- Transport: assignment API upload, not direct DB writes
- Default behavior:
  - import `Howdy 1-10`, books `A/B/C`
  - skip existing `(howdy_level, unit, book_type)` rows
  - mark newly imported assignments as `review_required`
- Special fallback:
  - if an answer-key image is missing or unreadable, the importer substitutes the blank page only as a placeholder image
  - the assignment is then marked `blocked` with a precise `risk_summary`
  - this keeps the dataset structurally complete without silently exposing broken grading data

### 2026-03-30 Import Snapshot

- Production assignment count after batch import: `260`
- Imported in this run: `259`
- Skipped existing: `1`
- Placeholder `blocked` assignments expected from the importer:
  - `Howdy 6 / Unit 5 / B`
  - `Howdy 7 / Unit 2 / B`
  - `Howdy 8 / Unit 7 / A`
  - `Howdy 10 / Unit 7 / B`

---



```bash
npm run dev    # nodemon auto-reload
npm start      # production
```

Fix stale git lock:
```bash
rm -f .git/index.lock
```
