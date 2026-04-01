# Work Log

Chronological record of completed work, features, and significant changes.

---

## 2026-03-27 - Initial OCR Grading System (v1)

**Work Done**:
1. Built Express.js server with PostgreSQL on Railway
2. Implemented ROI-based OCR grading with Google Cloud Vision
3. Teacher draws rectangles on template image to define answer regions
4. Per-region crop → OCR → Levenshtein fuzzy matching against answer key
5. Built `teacher.html` (ROI editor with canvas), `grader.html` (upload + results)

**Files Modified**:
- `server.js` — initial implementation
- `public/teacher.html` — ROI canvas editor
- `public/grader.html` — grading + results UI
- `public/js/roi-editor.js` — ROI drawing tool class

**Result**: Working v1 system. Teacher sets up ROI regions, students upload photos, system grades automatically.

---

## 2026-03-27 - Switch to Claude Vision Grading

**Work Done**:
1. Added `@anthropic-ai/sdk` dependency
2. Implemented `gradeWithClaude()` — sends answer key + student image to Claude Haiku
3. Added `mode: 'claude'` to answer keys — no ROI setup required
4. Rewrote `teacher.html` to simple image upload flow (no ROI drawing)
5. Fixed `grader.html` for Claude mode: `a.correct_answer`, `drawAnnotatedImage` region guard
6. Fixed analysis endpoint empty-questions fallback
7. Added CSV export with UTF-8 BOM for Excel
8. Added weakness analysis (per-question accuracy bars, per-student wrong questions)

**Files Modified**:
- `server.js` — `gradeWithClaude()`, Claude mode in `gradeStudent()`, analysis endpoint fixes
- `public/teacher.html` — complete rewrite (image upload + PDF.js)
- `public/grader.html` — Claude mode fixes

**Result**: Teachers upload answer key image → Claude compares with student work → automatic grading. No ROI setup needed.

**Commit**: `79134be`

---

## 2026-03-28 - Model Switch: Opus → Haiku (Cost Reduction)

**Work Done**:
Changed `gradeWithClaude()` model from `claude-opus-4-6` to `claude-haiku-4-5-20251001`.

**Reason**: Opus cost ~$0.03/grading (~1 NTD). Haiku costs ~$0.002/grading (~15× cheaper). Sufficient accuracy for children's English workbooks.

**Files Modified**:
- `server.js` — model name in `gradeWithClaude()`

**Commit**: `9dc73e7`

---

## 2026-03-28 - Major Redesign: Student Workbook Workflow (v2)

**Work Done**:

1. **New DB tables**:
   - `assignments` — stores blank workbook image, answer key, audio files; UPSERT on (howdy, unit, book)
   - `student_submissions` — stores merged drawing + Claude grading results

2. **New API endpoints** (all in `server.js`):
   - `GET /api/assignments/available` — for student selection cascade
   - `GET /api/assignments` (filtered) — list with metadata
   - `GET /api/assignments/:id` — full data (no answer key exposed)
   - `POST /api/assignments` — teacher UPSERT with Sharp image compression
   - `DELETE /api/assignments/:id`
   - `POST /api/submissions` — student submits merged drawing → `gradeHandwriting()` → save
   - `GET /api/submissions` / `GET /api/submissions/:id`
   - New `gradeHandwriting()` function (adapted Claude grading for handwriting)

3. **`public/index.html`** — complete rewrite:
   - Tablet-optimised student selection UI
   - Cascade: name → Howdy 1–10 → Unit 1–8 → A/B/C book
   - Unavailable options shown greyed out (pulled from DB)
   - Stores name in sessionStorage, saves to assignment.html via URL param

4. **`public/assignment.html`** — NEW file:
   - Full-screen two-canvas layout: bgCanvas (workbook background) + drawCanvas (student drawing)
   - Apple Pencil drawing via Pointer Events API with pressure-sensitive stroke width
   - Tools: pen, eraser, 4 colours, 3 stroke sizes
   - Undo history (40 states)
   - Audio player (multiple MP3 tracks from DB)
   - Submit: merges bgCanvas + drawCanvas → JPEG → POST /api/submissions
   - Results overlay: per-question O/X breakdown with correct answers

5. **`public/teacher.html`** — complete rewrite:
   - Two tabs: Upload / Assignment List
   - Upload: select Howdy/Unit/Book + blank page image + answer key image + audio files
   - Images: handles JPG/PNG/HEIC/PDF (PDF.js CDN)
   - Audio: multiple MP3s with custom label input
   - List: table of uploaded assignments with delete

6. **Backups**: v1 HTML files saved as `*-v1.html`

**Files Modified**:
- `server.js` — new tables init + 8 new routes + `gradeHandwriting()`
- `public/index.html` — complete rewrite
- `public/teacher.html` — complete rewrite
- `public/assignment.html` — new file
- `public/index-v1.html`, `public/grader-v1.html`, `public/teacher-v1.html` — backups

**Result**: Students open iPad → enter name → select Howdy/Unit/Book → write with Apple Pencil → tap 批閱 → see instant graded results. Teachers upload workbook images and audio via teacher.html.

**Commit**: `6b82203`

---

## 2026-03-28 - Documentation Update

**Work Done**:
Filled all four project_notes docs with real project content (previously all template placeholders).

**Files Modified**:
- `docs/project_notes/key_facts.md` — full DB schema, API endpoints, env vars, storage notes
- `docs/project_notes/decisions.md` — 7 ADRs covering major architectural decisions
- `docs/project_notes/bugs.md` — 7 bugs with root cause + solution + prevention
- `docs/project_notes/issues.md` — this file, full work log

---

## 2026-03-28~29 - Bug Fixes: Audio Bar, Section Labels, Grading Coverage

**Work Done**:
1. **Audio bar same-row layout** — wrapped each button+progress in `.audio-track` flex div; audio bar set to `flex-wrap: nowrap; overflow-x: auto`
2. **Results section labels** — grading results now show "A-1", "B-3" format instead of "#1"
3. **Multi-section grading** — prompt updated to explicitly list all question types (matching, checkboxes, numbering, circling, fill-in); Claude was previously only grading Part B
4. **Submission image compression** — fixed Sharp resize to width-only (removed height:2800 limit that cut multi-page images)
5. **section field in answers** — server.js answers mapping now includes `section` field from Claude JSON

**Files Modified**: `server.js`, `public/assignment.html`
**Commits**: `554bf52`

---

## 2026-03-29 - Teacher Upload: Multi-Page Support (1–3 Images)

**Work Done**:
- Both "blank workbook" and "answer key" file inputs now accept `multiple` files
- New `stitchImages()` function: loads each image into canvas, stitches vertically → single JPEG
- New `handleMultiImageFiles()` replaces single-file handler
- Teacher selects 3 page images at once (⌘+click) → auto-stitched before upload
- Filename display shows all page names

**Files Modified**: `public/teacher.html`
**Commits**: `2e18a68`

---

## 2026-03-29 - Model Upgrade: Haiku → Sonnet 4.6

**Work Done**:
- Switched grading model from `claude-haiku-4-5-20251001` to `claude-sonnet-4-6`
- Attempted `claude-sonnet-4-5-20251022` (404 error — model does not exist); fixed to alias
- Updated both `gradeWithClaude()` (legacy) and `gradeHandwriting()` (v2)

**Reason**: Haiku failed on visual grading tasks — partial phrase accepted as correct, double-circle not detected, matching lines hallucinated

**Files Modified**: `server.js`
**Commits**: `040b687`, `627d572`

---

## 2026-03-29 - Grading Prompt Overhaul

**Work Done**:
Major rewrite of `gradeHandwriting()` prompt in `server.js`:
- Added two-step process: (1) identify all sections, (2) grade every item
- **Matching**: explicit instructions to trace lines from dot to dot; red lines are teacher's answer key lines, not decorative
- **Circling**: exactly one circle per blank; two circles = `(both circled)` = wrong
- **Fill-in phrases**: 2+ word answers must be complete; single-word answers allow 1-character typo
- **Checkboxes, numbering, T/F**: refined per-type rules

**Files Modified**: `server.js`
**Commits**: `0f71318`

---

## 2026-03-29 - Review 1 / Review 2 Unit Support

**Work Done**:
- DB constraint relaxed: `unit BETWEEN 1 AND 10` (was 1–8)
- `ALTER TABLE` migration in `initDB()` to update existing Railway DB
- `teacher.html`: Unit dropdown adds "Review 1（A本）" (value=9) and "Review 2（B本）" (value=10)
- `index.html`: Unit grid adds Review 1/2 buttons; `UNIT_LABELS` map for display
- `assignment.html`: topbar displays "Review 1"/"Review 2" instead of "Unit 9"/"Unit 10"

**Background**: WB A has Review 1 after Unit 8; WB B has Review 2 after Unit 8

**Files Modified**: `server.js`, `public/teacher.html`, `public/index.html`, `public/assignment.html`
**Commits**: `f47f554`

---

## 2026-03-29 - Howdy 1 Workbook Question Type Analysis

**Work Done**:
Reviewed all pages of NH1 WB A (U1–U8 + Review 1) and NH1 WB B (U1–U8, first half) to catalogue all question types and assess AI grading reliability.

**Key findings**:
- 6 question types are reliably gradable (fill-in, unscramble, circle-one-word, numbering, etc.)
- 7 types are gradable with caveats (grid checkbox, image checkbox, double-blank circle, etc.)
- 4 types are high-risk / unreliable (matching lines, crossword, jumble-circle, combined circle+match)
- 5 types are completely non-gradable (draw, color, maze, dot-to-dot, guess-and-draw)

**Decision**: Matching exercises will require teacher to provide text answer key (not yet implemented). Crossword and jumble-circle recommended to be skipped or excluded.

**Documentation**: Full table recorded in `docs/project_notes/key_facts.md` under "Howdy 1 Workbook Question Types"
**ADRs Added**: ADR-008 (matching strategy), ADR-009 (Review unit numbering)

---

## 2026-03-29 - Supplemental Grading Notes for Hard Question Types

**Work Done**:
- Added `assignments.supplemental_notes` column and migration in `server.js`
- Updated `POST /api/assignments` UPSERT to save optional teacher-entered grading notes
- Updated assignment list metadata to expose `has_supplemental_notes`
- Added `public/teacher.html` textarea for section-specific guidance such as `matching`, `skip`, and `written_only`
- Updated `gradeHandwriting()` so Claude treats supplemental notes as higher priority than the answer-key image for listed sections

**Result**:
- Matching exercises no longer need to rely on pure image inference for the correct pairs
- Teachers can explicitly exclude crossword-like sections from scoring
- Mixed tasks can be constrained to grade only the written part when circling/matching is unreliable

**Files Modified**:
- `server.js`
- `public/teacher.html`
- `docs/project_notes/decisions.md`
- `docs/project_notes/key_facts.md`
- `docs/project_notes/issues.md`

---

## 2026-03-29 - Teacher Upload Manual (zh-TW)

**Work Done**:
- Wrote a detailed teacher-facing upload manual covering:
  - how to prepare blank workbook pages and answer keys
  - how to upload images, PDFs, HEIC, and MP3 audio
  - how overwrite/update works for the same Howdy/Unit/Book combination
  - how to use supplemental grading notes for matching, skip, and written-only cases
  - common mistakes and troubleshooting steps

**File Added**:
- `docs/TEACHER_UPLOAD_MANUAL_zh-TW.md`

**Purpose**:
- Future uploads may be handled by different teachers or staff members
- The upload process now has enough nuance that an explicit handoff document is needed

---

## 2026-03-30 - Vocab Exam MVP Module

**Work Done**:
1. Added a separate vocab module backend in `vocab-module.js`
2. Added new DB tables:
   - `vocab_exams`
   - `vocab_exam_pages`
   - `vocab_questions`
   - `vocab_submissions`
3. Added teacher-facing vocab APIs for create/list/get/update/publish
4. Added strict per-question OCR grading:
   - crop each answer box from the submitted page
   - Google Vision OCR on the cropped answer area
   - strict string comparison after trim / whitespace collapse only
5. Added wrong-question retest generation from `wrong_question_ids`
6. Built new pages:
   - `public/vocab-teacher.html`
   - `public/vocab-exam.html`
   - `public/vocab-result.html`
   - `public/vocab-retest.html`
7. Added shared vocab UI assets:
   - `public/css/vocab.css`
   - `public/js/vocab-drawing.js`
   - `public/js/vocab-teacher.js`
   - `public/js/vocab-exam.js`
   - `public/js/vocab-result.js`
   - `public/js/vocab-retest.js`
8. Added entry links from `public/index.html` and `public/teacher.html`

**Scope Notes**:
- Current MVP supports manual template creation with teacher-drawn answer boxes
- Howdy metadata is supported as the source type, but automatic local-material import is not wired yet for vocab exams
- Runtime smoke test inside sandbox was blocked because the app could not bind `0.0.0.0:3000`, and the session DB env was not available

**Files Modified**:
- `server.js`
- `vocab-module.js`
- `public/index.html`
- `public/teacher.html`
- `public/vocab-teacher.html`
- `public/vocab-exam.html`
- `public/vocab-result.html`
- `public/vocab-retest.html`
- `public/css/vocab.css`
- `public/js/vocab-drawing.js`
- `public/js/vocab-teacher.js`
- `public/js/vocab-exam.js`
- `public/js/vocab-result.js`
- `public/js/vocab-retest.js`
- `docs/project_notes/decisions.md`
- `docs/project_notes/key_facts.md`
- `docs/project_notes/issues.md`

---

## 2026-03-30 - VOCs Local Import Script

**Work Done**:
1. Added `scripts/import-vocab-exams.js`
2. Added `npm run import:vocab`
3. Importer pairs:
   - `VOCs/空白卷/NH*/H*U*`
   - `VOCs/掃描檔/H*/H*U*`
4. Matching imports create vocab **draft** exams with:
   - 1 blank page
   - 1 answer-key page
   - no question boxes yet
5. `--dry-run` works without API calls and was used to validate the local corpus

**Dry-run result on current repo**:
- matched pairs: 63
- blank-only: `1-1`
- scan-only: none

**Scope Notes**:
- Current importer only consumes direct image pairs (`jpg/jpeg/png`)
- It does not yet split the bundled PDFs or parse NH9 DOCX files
- Imported exams are created as drafts so teachers can finish the template safely before publishing

**Files Modified**:
- `scripts/import-vocab-exams.js`
- `package.json`
- `docs/project_notes/key_facts.md`
- `docs/project_notes/issues.md`

---

## 2026-03-29 - Shared Grading Reference Files

**Work Done**:
- Added automatic loading of reusable prompt context from `data/grading_references/`
- Implemented layered file lookup:
  - `global.md`
  - `howdy-<level>.md`
  - `howdy-<level>-unit-<unit>.md`
  - `howdy-<level>-unit-<unit>-book-<book>.md`
- Added starter reference files for Howdy 1 recurring main characters and Howdy 1 Unit 1 Workbook A

**Purpose**:
- Avoid retyping recurring character descriptions into `supplemental_notes` for every assignment
- Keep cross-unit / cross-book knowledge in one maintainable place
- Let assignment-specific teacher notes focus only on one-off answers such as matching pairs or skip rules

**Files Modified**:
- `server.js`
- `data/grading_references/README.md`
- `data/grading_references/howdy-1.md`
- `data/grading_references/howdy-1-unit-1-book-a.md`
- `docs/project_notes/key_facts.md`
- `docs/project_notes/issues.md`

---

## 2026-03-30 - Howdy 1-10 Dataset Completeness Check and Risk Tiers

**Work Done**:
- Rechecked the full `WBs/` dataset after batch download and normalization
- Confirmed `Howdy 1-10` blanks and answer keys are complete for WB A, WB B, and WB C
- Confirmed WB C has no audio by design
- Normalized and completed `Howdy 1` audio into standard `Audio/WBA` and `Audio/WBB` folders
- Reviewed representative workbook pages from multiple levels/books to generalize AI grading risk beyond the original Howdy 1-only analysis
- Added a series-wide import-readiness and grading-risk summary to `key_facts.md`

**Key findings**:
- `WBA` blanks: 260, AK: 260
- `WBB` blanks: 260, AK: 260
- `WBC` blanks: 240, AK: 240
- `WBA` audio: 143 files total across Howdy 1-10
- `WBB` audio: 176 files total across Howdy 1-10
- `WBC` audio: 0, expected
- Dataset is now ready for import
- High-risk sections remain the same family of tasks: matching lines, crosswords, hidden-word circling, and other visually traced activities

**Documentation**:
- Updated `docs/project_notes/key_facts.md` with:
  - import completeness snapshot
  - series-wide AI grading risk tiers
  - recommended import policy

---

## 2026-03-30 - Assignment Grading Status Guardrails

**Work Done**:
- Added assignment-level grading states:
  - `ready` = score can be treated as official
  - `review_required` = score is provisional and needs teacher review
  - `blocked` = assignment is hidden from the student selector
- Added `risk_summary` on assignments so the warning can explain what needs review
- Added `score_status` / `review_summary` on `student_submissions`
- Updated the student landing page to warn before opening `review_required` assignments
- Updated the workbook page to show a provisional banner for risky assignments
- Updated the result screen to label provisional scores clearly instead of presenting them as fully reliable
- Updated the teacher upload page to let teachers choose grading status explicitly when saving an assignment

**Purpose**:
- Prevent unstable high-risk sections from being silently treated as official scores
- Move the risk warning to both sides of the workflow:
  - before student starts
  - after AI grading finishes
- Give teachers a clean way to keep unfinished risky assignments off the student side

**Files Modified**:
- `server.js`
- `public/index.html`
- `public/assignment.html`
- `public/teacher.html`
- `docs/project_notes/key_facts.md`
- `docs/project_notes/issues.md`

---

## 2026-03-30 - Batch Import of Howdy 1-10 Workbook Data

**Work Done**:
- Added `scripts/import-assignments.js` to batch-import local `WBs/` assets through the assignment API
- Added `npm run import:assignments` in `package.json`
- Stitched 2-page review workbooks and 3-page unit workbooks into single upload images during import
- Imported blanks, answer keys, and audio for the full `Howdy 1-10` set through the deployed API
- Preserved existing assignments by default instead of overwriting teacher-entered content
- Added importer fallback behavior for damaged/missing answer-key files:
  - import the assignment record anyway
  - substitute the blank page only as a placeholder image
  - mark the assignment as `blocked` with a precise `risk_summary`

**Import Result**:
- Imported: `259`
- Skipped existing: `1`
- Imported as `blocked`: `4`
- Failed: `0`

**Blocked placeholders created by importer**:
- `Howdy 6 / Unit 5 / B`
- `Howdy 7 / Unit 2 / B`
- `Howdy 8 / Unit 7 / A`
- `Howdy 10 / Unit 7 / B`

**Important deployment note**:
- The deployed Railway API accepted the imported data, but at verification time it was still returning the older assignment schema without `grading_status`
- That means the data import succeeded before the new guardrail fields were confirmed live on production
- The repo therefore needs the latest backend deployed so those `blocked` records are actually hidden from students

**Files Modified**:
- `scripts/import-assignments.js`
- `package.json`
- `docs/project_notes/issues.md`

---

## 2026-03-30 - Supplemental Notes Manifest + Production Backfill

**Work Done**:
- Added `scripts/generate-supplemental-manifest.js` to OCR stitched blank workbook pages with Google Vision and auto-detect high-risk sections
- Expanded the section classifier to generate `matching`, `written_only`, and `skip` notes from workbook section titles
- Updated `scripts/import-assignments.js` so it can:
  - load a supplemental-notes manifest
  - import only assignments that actually need notes
  - preserve `review_required` while still attaching guidance text
- Generated a full manifest for the safe `Howdy 1-9` range and backfilled production assignments with notes
- Corrected `Howdy 10` blank-page mobile ranges for Workbook A/B and re-imported those assignments with the corrected blank images

**Production Result**:
- Assignments with `supplemental_notes` after backfill: `126`
- `Howdy 1-9`: `119` assignments updated from the generated manifest
- `Howdy 10 / WBA-WBB`: `18` assignments re-imported with corrected blank pages
- `Howdy 10 / WBB`: `3` assignments now also have generated supplemental notes
- `Howdy 10 / WBC`: `8` assignments re-imported with the corrected 4-page blank structure; `4` of them now also carry generated/manual supplemental notes

**Howdy 10 page-range correction**:
- Workbook A blank pages use mobile pages `85-110`
- Workbook B blank pages use mobile pages `113-138`
- Workbook C blank pages use mobile pages `140-171`
- The earlier generic page-range assumption used for Howdy 2-10 was wrong for Howdy 10

**Howdy 10 Workbook C special case**:
- Workbook C uses `32` blank pages and `32` answer-key slots, not the usual `24`
- That means each Howdy 10 Workbook C unit spans `4` pages instead of `3`
- Four answer-key images are missing from the source site:
  - `HGR10_4.jpg`
  - `HGR10_6.jpg`
  - `HGR10_14.jpg`
  - `HGR10_24.jpg`
- These units were imported with blank-page AK fallbacks and explicit `skip` notes for the affected section, so they remain usable without being `blocked`

**Files Modified**:
- `scripts/generate-supplemental-manifest.js`
- `scripts/import-assignments.js`
- `docs/project_notes/key_facts.md`
- `docs/project_notes/issues.md`

---

## 2026-03-30 - Teacher Passcode Gate

**Work Done**:
- Added a simple teacher-only passcode flow controlled by `TEACHER_PASSCODE`
- Added `GET /api/teacher-auth/status`, `POST /api/teacher-auth/verify`, and `POST /api/teacher-auth/logout`
- Protected teacher-only APIs with a cookie-based auth check:
  - assignment upload/delete
  - legacy answer-key CRUD
  - legacy grading/results APIs
  - teacher submission list/detail APIs
- Kept student APIs public where needed:
  - `/api/assignments/available`
  - filtered `/api/assignments?howdy=&unit=&book=`
  - `/api/assignments/:id`
  - `/api/submissions`
- Updated `public/js/common.js` with shared passcode prompt helpers
- Updated `teacher.html`, `grader.html`, and both `*-v1.html` pages to require passcode before loading teacher data

**Files Modified**:
- `server.js`
- `public/js/common.js`
- `public/teacher.html`
- `public/grader.html`
- `public/teacher-v1.html`
- `public/grader-v1.html`
- `docs/project_notes/key_facts.md`
- `docs/project_notes/issues.md`

---

## 2026-03-30 - NH9 Prompt Extraction

**Work Done**:
- Checked the newly added `VOCs` documents for machine-readable text
- Confirmed the NH9 DOCX files are text-extractable
- Confirmed `VOCs/空白卷/NH9/U1-8.pdf` is also text-extractable, but contains the same prompt content as the DOCX files
- Confirmed the NH1 bundled PDFs and scan PDFs are not useful as answer-key text sources
- Added `scripts/extract-vocab-prompts.js`
- Generated:
  - `data/vocab-prompts/nh9-vocab-prompts.csv`
  - `data/vocab-prompts/nh9-vocab-prompts.json`

**Findings**:
- The NH9 files provide prompt text, Chinese clues, unit numbers, and special instructions
- They do not provide a completed answer-key column
- This conversion is useful for structuring NH9 content, but it does not unblock safe bulk publishing for Howdy 1-8 vocab exams

**Files Modified**:
- `scripts/extract-vocab-prompts.js`
- `data/vocab-prompts/nh9-vocab-prompts.csv`
- `data/vocab-prompts/nh9-vocab-prompts.json`
- `docs/project_notes/key_facts.md`
- `docs/project_notes/issues.md`

---

## 2026-03-30 - Howdy 1–8 Vocab Answer Bank Found in Legacy CSVs

**Work Done**:
- Inspected `VOCs/CSVs/` and found structured vocab CSVs for Howdy 1–10
- Confirmed Howdy 1–8 units already have `word / definition / level / sentence / sequence`
- Added `scripts/build-vocab-answer-bank.js` to normalize Howdy 1–8 into project-owned output files
- Added npm script `build:vocab-bank`
- Generated:
  - `data/vocab-prompts/howdy-1-8-answer-bank.json`
  - `data/vocab-prompts/howdy-1-8-answer-bank.csv`
  - `data/vocab-prompts/howdy-1-8-answer-bank-issues.txt`

**Result**:
- There is now a reliable text answer source for Howdy 1–8 vocab exams
- The main remaining problem is no longer answer discovery; it is reconciling page order and answer-box coordinates with the imported exam images

**Known Issues**:
- `howdy_1_all_units.csv` contains stray `Howdy 10 Unit 1–8` rows and must be filtered by exact level label
- CSV order is not guaranteed to match visual exam order on the page, so it cannot be published blindly without template reconciliation

---

## 2026-03-30 - Vocab Review Extractor for Howdy 1–8

**Work Done**:
- Added `scripts/extract-vocab-review.js`
- Built a review-extraction pipeline that:
  - aligns the answer scan to the blank page
  - detects newly added answer text by color family
  - OCRs each candidate crop
  - matches OCR output against the normalized answer bank
  - writes `review.csv`, `review-raw.csv`, crop PNGs, and `review.json` per unit
- Added npm script `extract:vocab-review`

**Detection Strategy**:
- Howdy 1–4: new answer text is primarily green
- Howdy 5–8: new answer text is primarily blue
- Duplicate candidates are reduced by keeping the best unique match per expected answer

**Batch Result**:
- Ran the full matched set into `data/vocab-review-batch-v2/`
- Summary:
  - 63 matched exams processed
  - 35 perfect
  - 13 near-complete (missing 1–2 answers)
  - 15 harder units still missing 3+ answers

**Main Remaining Hard Units**:
- Howdy 1 Unit 7
- Howdy 5 Units 1, 2, 3, 5, 6
- Howdy 6 Units 1, 3, 4, 5, 7, 8
- Howdy 7 Units 3, 6, 7

---

## 2026-03-30 - Demo Publish: Howdy 1 Unit 2

**Work Done**:
- Added `scripts/publish-vocab-demo.js` for one-off Railway publishing from a reviewed vocab CSV
- Used `data/vocab-review-batch-v2/howdy-1-unit-2/review.csv` as the source of truth
- Updated the existing Railway draft exam titled `Howdy 1 Unit 2 Vocabulary`
- Published the exam

**Railway Result**:
- `id: 1`
- `title: Howdy 1 Unit 2 Vocabulary`
- `status: published`
- `question_count: 14`
- `pass_score: 80`

**Purpose**:
- Safe demo unit for teacher / student walkthrough before broader batch publication

---

## 2026-03-30 - Vocab Exam Zoom Controls

**Work Done**:
- Added zoom controls to `public/vocab-exam.html`
- Enabled browser-level pinch zoom by updating the viewport meta tag
- Added shared zoom support to `public/js/vocab-drawing.js`
- Wired global exam zoom state in `public/js/vocab-exam.js`
- Added responsive zoom control styling in `public/css/vocab.css`

**Result**:
- Students can zoom out to see more of the page, zoom back in for writing, and reset to fit-width
- Zoom applies consistently across all exam pages without changing underlying drawing coordinates

---

## 2026-03-31 - Vocab OCR Hardening: Answer Guides + Blank-Template Subtraction

**Work Done**:
- Exposed public `question_guides` from `GET /api/vocab/exams/:id` without leaking answers
- Updated `public/vocab-exam.html` / `public/js/vocab-drawing.js` / `public/js/vocab-exam.js` to draw visible answer guides on the student page
- Added a guide note instructing students to write inside the dashed box and start from the left side
- Strengthened iPad Safari suppression by adding legacy touch-event prevention on the vocab draw canvas
- Reworked vocab OCR preprocessing in `vocab-module.js`:
  - normalize the submitted page and the stored blank page to the same size
  - crop both with the same `answer_box`
  - subtract the blank crop from the student crop to isolate handwriting
  - binarize and enlarge the handwriting-only mask before sending it to Google Vision

**Why This Matters**:
- The biggest OCR gains came from cleaner input, not from changing OCR vendors
- Fixed-template vocab exams are a special case where the platform already owns the blank template, so direct page OCR is unnecessarily noisy
- Student guidance and crop purity were both major factors in moving the demo from unusable to near-pass performance

**Related Files**:
- `vocab-module.js`
- `public/vocab-exam.html`
- `public/css/vocab.css`
- `public/js/vocab-drawing.js`
- `public/js/vocab-exam.js`

---

## 2026-03-31 - Vocab Score Display Switched to Percentage-First

**Work Done**:
- Kept vocab grading logic unchanged:
  - each question still scores full points or zero
  - pass/fail still uses `percentage >= pass_score`
- Changed the result page to show percentage as the main grade (`93 / 100`)
- Moved raw point totals to a secondary line (`原始題分 65 / 70`)
- Updated teacher builder labels so `pass_score` is clearly treated as a percentage threshold
- Updated the teacher exam list to display `pass_score` with a `%` suffix

**Why This Matters**:
- Vocab exams have variable question counts, so raw totals are inconsistent across exams
- Teachers conceptually grade these tests out of 100, then compare to a pass line like 80
- The system was already doing that mathematically; this change makes the UI match the grading model

---

## 2026-03-31 - Vocab Batch Backfill Workflow for Reviewed Units

**Work Done**:
- Added shared review-sync helpers in `scripts/lib/vocab-review-sync.js`
- Refactored `scripts/publish-vocab-demo.js` to use the shared helper layer
- Added `scripts/sync-vocab-review-batch.js` to:
  - select reviewed units from `data/vocab-review-batch-v2/summary.json`
  - filter by `max_missing`, `levels`, `units`, and `limit`
  - dry-run against local files only or verify against Railway
  - backfill reviewed questions into existing Railway vocab drafts
  - optionally publish after backfill
- Added request timeouts and per-exam progress output so long batch runs are observable and do not hang silently
- Preserved already-published exams during non-publish backfills by republishing them after the template refresh

**Railway Result**:
- Verified the first safe batch as `35` perfect reviewed units (`missing_count = 0`)
- Backfilled all `35` units into the existing Railway vocab exams
- Preserved `Howdy 1 Unit 2 Vocabulary` as the live published demo
- Left the remaining batch items in `draft` for later teacher review and selective publish

**Why This Matters**:
- The project now has a repeatable path from:
  reviewed `review.csv` -> Railway draft exam with answers and answer boxes
- This closes the gap between one-off demo publishing and scalable staged rollout

---

## 2026-03-31 - Vocab Perfect Batch Published + Student Selection Switched to Howdy/Unit Flow

**Work Done**:
- Used `scripts/sync-vocab-review-batch.js --publish` to publish all `35` perfect reviewed vocab units to Railway
- Confirmed the public vocab exam list now returns `35` published exams
- Updated `public/vocab-exam.html`, `public/js/vocab-exam.js`, and `public/css/vocab.css` so students no longer see one long flat list
- Replaced the old list with a step flow:
  - student name
  - Howdy level
  - Unit
  - exam card(s)
- Added title-based metadata fallback in the student exam page because the existing imported vocab exams currently have `source_type=custom` and null `howdy_level/unit` in production

**Why This Matters**:
- After the batch publish, the flat published-exam list became too long for students to browse efficiently
- The new selection flow keeps the student UX aligned with the existing WB ABC flow without requiring an immediate data migration of legacy vocab exam metadata

---

## 2026-03-31 - Vocab Selection UX Tightened to Match Workbook Flow

**Work Done**:
- Tightened the vocab selection layout to the same narrow step-card rhythm used by the workbook home page
- Changed the name entry card into a true Step 1 card
- Matched the Howdy / Unit button sizing and selection states more closely to the workbook selector
- Added smooth step reveal scrolling with `scrollIntoView({ behavior: 'smooth' })` so selecting a step moves the user down to the next card

**UX Note**:
- This interaction pattern is a step-by-step flow with progressive disclosure
- The “tap then automatically move down to the next card” behavior is implemented with smooth scrolling

---

## 2026-03-31 - Vocab Guide Boxes Missing on iPad Due to Canvas Layer Order

**Work Done**:
- Locked the three-canvas stack in `public/js/vocab-drawing.js` to an explicit z-order:
  - background canvas `z-index: 0`
  - guide canvas `z-index: 1`
  - drawing canvas `z-index: 2`

**Why This Matters**:
- Production exam payloads already contained `question_guides`, and the deployed student JS already included guide rendering logic
- On iPad Safari, the blue dashed guide layer could still disappear because canvas stacking was implicit
- Explicit z-order prevents the guide canvas from being visually buried under the worksheet background

---

## 2026-03-31 - Vocab Fit-Width Now Uses Visible Layout and Resets Per Exam

**Work Done**:
- Updated `public/js/vocab-exam.js` so opening an exam:
  - resets zoom back to `100%`
  - reveals the workspace first
  - waits for a visible layout pass before building the canvas surfaces

**Why This Matters**:
- Previously, exam pages could be initialized while the workspace section was still hidden
- In that hidden state, the surface width fallback used the image’s natural width instead of the real container width
- That made the initial view too large and could make one `100%` state look different from another `100%` state
- The new flow makes `100%` consistently mean fit-to-width, including the first time the exam opens

---

## 2026-03-31 - Vocab Review 1 / Review 2 Composite Exams Published

**Work Done**:
- Added `scripts/sync-vocab-review-exams.js` to build 4-page vocab review exams by composing existing single-unit vocab exams:
  - `Review 1` = Unit 1-4
  - `Review 2` = Unit 5-8
- Added npm script `sync:vocab-reviews`
- Published the currently safe composite exams to Railway:
  - `Howdy 2 Review 1 Vocabulary` (`id=64`, `47` questions, `4` pages)
  - `Howdy 2 Review 2 Vocabulary` (`id=65`, `52` questions, `4` pages)
  - `Howdy 3 Review 1 Vocabulary` (`id=66`, `49` questions, `4` pages)
  - `Howdy 8 Review 1 Vocabulary` (`id=67`, `60` questions, `4` pages)

**Skipped For Now**:
- `Howdy 3 Review 2 Vocabulary` because `Howdy 3 Unit 7 Vocabulary` still has no reviewed questions
- `Howdy 8 Review 2 Vocabulary` because `Howdy 8 Unit 5 Vocabulary` still has no reviewed questions

**Why This Matters**:
- The student selector already had `Review 1 / Review 2` slots, but they were disabled until real composite exams existed
- Reusing the existing reviewed unit templates is safer than re-detecting boxes from bundled PDFs
- This matches the real midterm/final workflow where vocab testing uses four pages across grouped units

---

## 2026-03-31 - Teacher Cookie Broke Student Guide Boxes

**Work Done**:
- Updated `vocab-module.js` so the teacher-view exam payload also includes:
  - `question_count`
  - `question_guides`

**Why This Matters**:
- On iPad Safari, if the browser already had teacher auth cookie, `GET /api/vocab/exams/:id` returned the teacher serializer instead of the public serializer
- The student exam page depends on `question_count` and `question_guides` to render the top metadata and blue dashed answer boxes
- Because those fields were missing from the teacher serializer, the page showed `undefined 題` and no guide boxes even though the exam itself was valid

---

## 2026-03-31 - Hidden Diagnostics Panel for Vocab Exam Page

**Work Done**:
- Added a lightweight `/api/server-info` endpoint in `server.js` with:
  - app version
  - support code
  - commit hash
  - deployment identifier
  - server start time
- Added a hidden diagnostics panel to `public/vocab-exam.html`
- Styled the diagnostics sheet in `public/css/vocab.css`
- Wired the interaction in `public/js/vocab-exam.js`:
  - tap the page title or exam title 5 times to open
  - copy full support info with one button
  - include current exam and teacher-auth state in the copied payload

**Why This Matters**:
- Users do not see obvious build numbers or “testing” UI during normal use
- Developers can still quickly identify the exact deployed build and browser/session state
- This is especially useful for iPad-only issues where cache, teacher auth, and deployment state can interact in non-obvious ways

---

## 2026-04-01 - Remaining Near-Complete Vocab Units Split Into Source Errors vs Detection Gaps

**Work Done**:
- Re-checked the remaining near-complete units against the actual answer-sheet images instead of trusting the normalized answer bank alone
- Confirmed that the blockers for these units are not all the same problem:
  - `Howdy 3 Unit 7`: source CSV typo (`stuck`) should be `snack`
  - `Howdy 4 Unit 3`: normalized bank contains an extra bogus item (`tall`); the answer sheet only has 13 items
  - `Howdy 4 Unit 6`: answer sheet does contain `cut`, but the OCR crop was matched too conservatively because the detected text included the full phrase (`cut my nails`)
  - `Howdy 4 Unit 8`: answer sheet answer is `glass`, not `glass of water`
  - `Howdy 8 Unit 5`: the bank is correct for this unit, but review extraction missed the bottom-left items `try / tried` and `noon`

**Why This Matters**:
- The unresolved draft units are blocked by a mix of:
  - source CSV anomalies
  - phrase-vs-headword normalization mistakes
  - answer-box / detector misses near the bottom of the page
- Treating all of them as generic OCR misses would keep producing wrong fixes and wrong publish decisions

---

## 2026-04-01 - Five Blocked Vocab Units Repaired and Published

**Work Done**:
- Added `data/vocab-prompts/manual-answer-overrides.json` and taught `scripts/build-vocab-answer-bank.js` to apply source-level overrides before rebuilding the normalized answer bank
- Added `data/vocab-prompts/manual-review-overrides.json` and taught `scripts/extract-vocab-review.js` to patch OCR review candidates after extraction
- Updated `scripts/extract-vocab-review.js` so partial re-runs merge into the existing `summary.json` instead of overwriting it
- Rebuilt and re-reviewed the previously blocked units:
  - `Howdy 3 Unit 7`
  - `Howdy 4 Unit 3`
  - `Howdy 4 Unit 6`
  - `Howdy 4 Unit 8`
  - `Howdy 8 Unit 5`
- Synced those repaired units back to Railway and published them
- Re-ran composite review sync and published the newly unblocked review exams:
  - `Howdy 3 Review 2 Vocabulary` (`id=68`)
  - `Howdy 4 Review 1 Vocabulary` (`id=69`)
  - `Howdy 4 Review 2 Vocabulary` (`id=70`)
  - `Howdy 8 Review 2 Vocabulary` (`id=71`)

**Resolved Root Causes**:
- `Howdy 3 Unit 7`: source CSV typo `stuck` -> `snack`
- `Howdy 4 Unit 3`: extra bogus source item `tall`
- `Howdy 4 Unit 6`: raw OCR already saw `cut`, but needed a review-layer promotion
- `Howdy 4 Unit 8`: answer sheet headword is `glass`, not `glass of water`
- `Howdy 8 Unit 5`: after rebuilding with the corrected bank, extraction recovered the missing bottom-of-page answers

---

## 2026-04-01 - Howdy 5 Units 4 / 7 / 8 Repaired and Published

**Work Done**:
- Added a source-level override for `Howdy 5 Unit 8` so the sheet answer `cowgirl / cowboy` is treated as one combined vocab item instead of two separate bank rows
- Added review-level overrides for:
  - `Howdy 5 Unit 4` extended-vocabulary items `house` and `super`
  - `Howdy 5 Unit 7` `sailor`, which was OCRed but matched to `sail`
- Rebuilt and published:
  - `Howdy 5 Unit 4 Vocabulary` (`id=35`, `17` questions)
  - `Howdy 5 Unit 7 Vocabulary` (`id=38`, `15` questions)
  - `Howdy 5 Unit 8 Vocabulary` (`id=39`, `15` questions)

**Why This Matters**:
- `Howdy 5` pages are denser than earlier Howdy levels, so the extractor often tops out near `15` detected answers
- Some misses are not generic OCR errors:
  - `H5U8` was a source-structure mismatch (`cowgirl / cowboy` displayed as one sheet answer)
  - `H5U4` missed the bottom-right extended-vocabulary answers entirely
  - `H5U7` already had the right raw text but selected the wrong bank entry

---

## 2026-04-01 - Howdy 5/6/7 Rollout Completed, Howdy 1 Reduced to a Single Source Blocker

**Work Done**:
- Extended `data/vocab-prompts/manual-review-overrides.json` to recover the remaining dense-layout misses in:
  - `Howdy 5 Unit 1 / 2 / 3 / 5 / 6`
  - `Howdy 6 Unit 1 / 2 / 3 / 4 / 5 / 7 / 8`
  - `Howdy 7 Unit 1 / 2 / 3 / 4 / 5 / 6 / 7`
  - `Howdy 1 Unit 7`
- Re-ran `scripts/extract-vocab-review.js` until all 63 matched unit exams reached `detected_count == expected_count`
- Published the remaining single-unit vocab exams on Railway:
  - completed all of `Howdy 5`
  - completed all of `Howdy 6`
  - completed all of `Howdy 7`
  - completed `Howdy 1 Unit 7`
- Published the newly unblocked composite review exams:
  - `Howdy 5 Review 1 Vocabulary` (`id=72`)
  - `Howdy 5 Review 2 Vocabulary` (`id=73`)
  - `Howdy 6 Review 1 Vocabulary` (`id=74`)
  - `Howdy 6 Review 2 Vocabulary` (`id=75`)
  - `Howdy 7 Review 1 Vocabulary` (`id=76`)
  - `Howdy 7 Review 2 Vocabulary` (`id=77`)
  - `Howdy 1 Review 2 Vocabulary` (`id=78`)

**Current Production State**:
- All 63 matched single-unit vocab exams are now published
- `Howdy 2-8` now have both `Review 1` and `Review 2` published
- `Howdy 1 Review 2` is published after repairing `Howdy 1 Unit 7`
- The only remaining vocab gap is:
  - `Howdy 1 Unit 1 Vocabulary` has no answer-sheet image
  - therefore `Howdy 1 Review 1 Vocabulary` is still blocked

**Operational Conclusion**:
- The remaining rollout risk is no longer OCR/extraction quality for Howdy 2-8
- The only unresolved blocker is missing source material for `Howdy 1 Unit 1`

---

## 2026-04-01 - Howdy 1 Unit 1 Added, Full Howdy 1-8 Vocab Rollout Completed

**Work Done**:
- Imported the newly added answer sheet `VOCs/掃描檔/H1/H1U1.jpg` and created `Howdy 1 Unit 1 Vocabulary` on Railway
- Re-ran vocab review extraction for `Howdy 1 Unit 1` until it reached `14/14` detected answers
- Synced and published:
  - `Howdy 1 Unit 1 Vocabulary` (`id=79`, `14` questions)
  - `Howdy 1 Review 1 Vocabulary` (`id=80`, `4` pages, `55` questions)
- Re-checked the full rollout with dry runs:
  - all `64/64` Howdy 1-8 single-unit vocab exams are now complete
  - all `Review 1 / Review 2` composite vocab exams for `Howdy 1-8` are now ready and published

**Current Production State**:
- `Howdy 1-8` single-unit vocab exams: fully published
- `Howdy 1-8` `Review 1 / Review 2` vocab exams: fully published
- `NH9` remains intentionally out of scope for the current vocab rollout

**Operational Conclusion**:
- The vocab rollout is no longer blocked by missing Howdy 1 material
- Remaining work should now shift away from rollout completion and back to product refinement / future content

---

## 2026-04-01 - Vocab Student Exam UI Aligned with Main Index Visual Language

**Work Done**:
- Updated `public/vocab-exam.html` to add the same centered app hero pattern used on the main student entry page
- Updated `public/css/vocab.css` so the vocab student exam page now follows the same visual system as `public/index.html`:
  - blue gradient page background
  - floating top-right teacher links
  - centered title/subtitle hero
  - matching summary bar treatment
  - matching step-card width and shadow rhythm
  - tighter visual alignment for selection buttons and primary actions
- Kept the workspace tools and grading flow intact while making the selection / exam shell feel like the same product
- Extended the same student-facing visual alignment to:
  - `public/vocab-result.html`
  - `public/vocab-retest.html`
  so the exam, result, and retest pages now read as one consistent flow instead of three separate modules

**Design Terminology**:
- This change aligns the vocab page with the main index page's **visual language**
- It also improves **interaction pattern parity** across the student flows

---

## Pending / Future Work

- [ ] Supplemental notes preview/edit when reopening an existing assignment from the teacher list
- [ ] Stronger structured syntax validation for supplemental notes so malformed teacher input is caught before upload
- [ ] Student results history page (view past submissions by name)
- [ ] Teacher: per-assignment class analytics (which questions students miss most)
- [ ] Teacher: student management (class list, progress over time)
- [ ] Offline support / PWA manifest for iPad home screen installation
- [ ] Rate limiting on `/api/submissions` to prevent accidental repeated grading
- [ ] Upgrade simple teacher passcode into full teacher accounts / permissions if multiple teachers need separate ownership and audit logs
- [ ] Batch import should set `ready` / `review_required` / `blocked` automatically from per-unit risk templates
- [ ] Per-unit default `supplemental_notes` templates for high-risk sections before full batch import
