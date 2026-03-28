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

## Pending / Future Work

- [ ] Student results history page (view past submissions by name)
- [ ] Teacher: per-assignment class analytics (which questions students miss most)
- [ ] Teacher: student management (class list, progress over time)
- [ ] Offline support / PWA manifest for iPad home screen installation
- [ ] Multi-page workbook support (assignment spans more than one page)
- [ ] Rate limiting on `/api/submissions` to prevent accidental repeated grading
- [ ] Authentication layer if deployed publicly (currently assumes trusted LAN)
