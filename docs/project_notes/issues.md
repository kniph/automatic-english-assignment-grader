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

## Pending / Future Work

- [ ] Supplemental notes preview/edit when reopening an existing assignment from the teacher list
- [ ] Stronger structured syntax validation for supplemental notes so malformed teacher input is caught before upload
- [ ] Student results history page (view past submissions by name)
- [ ] Teacher: per-assignment class analytics (which questions students miss most)
- [ ] Teacher: student management (class list, progress over time)
- [ ] Offline support / PWA manifest for iPad home screen installation
- [ ] Rate limiting on `/api/submissions` to prevent accidental repeated grading
- [ ] Authentication layer if deployed publicly (currently assumes trusted LAN)
- [ ] Batch import should set `ready` / `review_required` / `blocked` automatically from per-unit risk templates
- [ ] Per-unit default `supplemental_notes` templates for high-risk sections before full batch import
