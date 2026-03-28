# Architectural Decision Records (ADRs)

Record of key architectural and technical decisions made for this project.

---

## ADR-001: Claude Vision as Primary Grading Engine

**Date**: 2026-03-28

**Context**:
Initial design used Google Cloud Vision OCR to detect text in each answer region (ROI), then matched against a pre-defined answer key. This required teachers to manually draw ROI rectangles on a template image — time-consuming and fragile.

The user has electronic answer key files (PDF/Word/images) and wanted to eliminate the setup step entirely.

**Decision**:
Send both the answer key image and the student's work image directly to Claude Vision API. Claude reads both images and returns structured JSON with per-question results.

**Rationale**:
- Zero setup for teachers — just upload answer key image, no ROI drawing
- Handles handwriting, printed text, T/F, fill-blank, short answer uniformly
- More robust than pattern-matching OCR for children's irregular handwriting
- Simpler codebase

**Alternatives Considered**:
- Google Vision OCR + regex parsing — requires structured answer format, brittle
- Google Vision + manual ROI — works but requires per-assignment setup
- Form-based digital input — doesn't match real workbook workflow

**Consequences**:
- Requires `ANTHROPIC_API_KEY` in environment
- Cost per grading: ~$0.002 (Haiku) vs $0 (pure OCR)
- Claude must infer question structure from image — occasional errors possible

---

## ADR-002: Model Selection for Grading (Haiku → Sonnet 4.6)

**Date**: 2026-03-28 (initial), updated 2026-03-29

**Context**:
Initial implementation used `claude-opus-4-6` (~$0.03/grading). Switched to Haiku for cost. After real classroom testing, Haiku proved insufficient for visual grading tasks.

**Haiku failures observed**:
- Accepted "Nic" as correct answer for "Nice to see you." (partial phrase treated as typo)
- Did not detect when student circled BOTH words in a "circle one" question
- Confused matching line connections in complex multi-line matching exercises
- Named matching targets incorrectly (hallucinated building names from scene)

**Decision**:
Switch to `claude-sonnet-4-6`.

**Rationale**:
- Sonnet 4.6 has significantly better visual spatial reasoning
- Cost ~$0.01–0.02/grading — still acceptable for classroom use (~3–6 NTD)
- Children's workbooks contain visually complex question types (matching, circling, grid checkboxes) that require genuine vision capability

**Model cost ladder** (latest):
| Model | API ID | Est. cost/grading |
|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5-20251001` | ~$0.002 |
| Sonnet 4.6 | `claude-sonnet-4-6` | ~$0.01–0.02 |
| Opus 4.6 | `claude-opus-4-6` | ~$0.05+ |

**Note on model IDs**: Date-versioned IDs (e.g., `claude-sonnet-4-5-20251022`) may not exist. Use the alias form (`claude-sonnet-4-6`) for reliability.

---

## ADR-003: Base64 Image Storage in PostgreSQL

**Date**: 2026-03-28

**Context**:
Need to store workbook images (blank page, answer key) and audio files. Railway doesn't provide persistent file storage — files written to disk are lost on redeploy.

**Decision**:
Store all images and audio as Base64 TEXT columns in PostgreSQL.

**Rationale**:
- Railway PostgreSQL persists across deploys
- Simplest architecture (no S3/CDN/file service needed)
- Workbook images: ~200–300 KB after compression → manageable
- Audio MP3s: typically 0.5–1.5 MB → acceptable for a small school

**Alternatives Considered**:
- Railway Volume (persistent disk) — available but adds complexity
- AWS S3 / Cloudflare R2 — better for large scale, overkill for MVP
- External CDN — adds cost and configuration

**Consequences**:
- DB size grows ~1–2 MB per uploaded assignment (images + audio)
- 240 possible assignments (Howdy 1–10 × Unit 1–8 × A/B/C) ≈ ~240–480 MB total
- Fits within Railway hobby plan (1 GB)
- Large API responses when fetching assignments with images — acceptable for LAN/WiFi use

---

## ADR-004: Client-Side PDF→JPEG via PDF.js CDN

**Date**: 2026-03-28

**Context**:
Teachers upload answer key and workbook images, sometimes as PDF files. Server-side PDF parsing with `pdf-parse` v2 crashed on Railway (bundles pdf.js, incompatible environment). Google Vision `files:annotate` works for OCR but returns text, not a renderable image.

**Decision**:
Use PDF.js loaded from CDN (`cdnjs.cloudflare.com`) to render PDF page 1 to a `<canvas>` element in the browser, then export as JPEG base64.

**Rationale**:
- Pure client-side — no server changes needed
- PDF.js is well-maintained and handles complex PDFs
- Avoids pdf-parse v2 Railway crash entirely
- Scale 2.5× viewport gives ~2500px wide output — sufficient quality

**Alternatives Considered**:
- `pdf-parse` npm package — crashes on Railway (v2 bundles Node-incompatible pdf.js)
- Google Vision `files:annotate` — returns OCR text, not image
- Sharp PDF support — Sharp doesn't support PDF natively
- `pdfjs-dist` npm package — would work server-side but heavy and complex

**Consequences**:
- Requires internet connection to load PDF.js CDN on teacher.html
- Only renders page 1 of multi-page PDFs (sufficient for workbook covers)
- CDN dependency — could be self-hosted if needed

---

## ADR-005: Pointer Events API for Apple Pencil Drawing

**Date**: 2026-03-28

**Context**:
Students use iPad + Apple Pencil to write answers on the digital workbook. Need to capture freehand drawing with natural feel.

**Decision**:
Use the browser's Pointer Events API (`pointerdown`, `pointermove`, `pointerup`) with `touch-action: none` on the canvas.

**Rationale**:
- Pointer Events handles mouse, touch, and Apple Pencil uniformly
- `event.pressure` gives 0.0–1.0 pressure value from Apple Pencil
- `event.pointerType === 'pen'` detects Apple Pencil specifically
- `touch-action: none` prevents page scroll while drawing
- No external library needed

**Alternatives Considered**:
- Hammer.js / touch events — older API, less accurate for Pencil
- `canvas2d` libraries (Fabric.js, Konva) — heavy, unnecessary for simple drawing

**Consequences**:
- Pressure-sensitive line width works natively on iPad with Pencil
- Falls back gracefully to mouse on desktop (for teacher testing)
- Palm rejection relies on iPadOS system-level handling (not app responsibility)

---

## ADR-006: UPSERT on (howdy_level, unit, book_type)

**Date**: 2026-03-28

**Context**:
Teachers may re-upload a corrected version of the same assignment (same Howdy/Unit/Book). Without UPSERT, duplicate rows would accumulate.

**Decision**:
`UNIQUE(howdy_level, unit, book_type)` constraint + `INSERT ... ON CONFLICT DO UPDATE` (UPSERT).

**Rationale**:
- Re-uploading the same assignment replaces the old one seamlessly
- No orphan records
- Simple for teacher UX — just upload again to update

**Consequences**:
- Old assignment image is overwritten permanently on re-upload
- All prior `student_submissions` for that assignment_id are preserved (FK to id, not to content)

---

## ADR-008: Matching Exercise Strategy — Teacher Provides Text Answer Key

**Date**: 2026-03-29

**Context**:
"Look and match" / "Listen and match" exercises require drawing lines between two sets of items. These are common across all Howdy workbook units.

AI vision models (including Sonnet) suffer from "Spatial Hallucination" when asked to trace hand-drawn lines through crossing paths on complex images. Problems include:
- Red answer-key lines confused with decorative image lines
- Multiple crossing lines — model cannot reliably determine which endpoint connects to which
- Line thickness and image compression further degrade accuracy

Gemini suggested OpenCV + HSV filtering + A* path tracing, but this requires:
- Python environment on Railway (complex)
- Consistent pen colour (not guaranteed from photos)
- ~200+ lines of image processing code

**Decision**:
For matching exercises, **teachers enter the correct pairs as text** when uploading an assignment (e.g., `Lucy→toy shop, Peter→carousel`). Claude only needs to read the student's drawn lines and compare them to the text answer key — not read the answer key image for this question type.

**Implementation**: Planned — requires teacher.html UI addition for text answer input per question type, and updated `gradeHandwriting()` prompt to accept supplementary text answers.

**Current Status**: Not yet implemented. For now, matching is graded from the answer key image alone (unreliable). Teacher should verify matching question scores manually.

**Rationale**:
- Eliminates the hardest visual task entirely
- Teacher spends ~30 seconds entering pairs per unit (one-time)
- Claude's strength is language/reasoning; let image handle what AI handles well, text handle what it doesn't

---

## ADR-009: Review Units Use unit=9 and unit=10

**Date**: 2026-03-29

**Context**:
WB A contains "Review 1" after Unit 8. WB B contains "Review 2". These are distinct assignment units that must be stored and selected separately.

**Decision**:
Use `unit = 9` for Review 1 and `unit = 10` for Review 2 in the database. The `book_type` column already distinguishes which book the assignment belongs to.

**DB migration**: ALTER TABLE drops and recreates the CHECK constraint to allow `unit BETWEEN 1 AND 10`.

**UI**: Dropdowns show "Review 1（A本）" and "Review 2（B本）" as selectable options. The UNIT_LABELS map in index.html and assignment.html translates 9→"Review 1" and 10→"Review 2" for display.

**Alternatives Considered**:
- Separate `review` boolean column — more explicit but requires schema change and API updates
- `unit = 0` — Review has no natural zero meaning, confusing
- varchar unit field — requires full schema migration

---

## ADR-007: Answer Key Hidden from Student

**Date**: 2026-03-28

**Context**:
`GET /api/assignments/:id` is called from the student-facing assignment page. The answer key image must not be exposed.

**Decision**:
The `GET /api/assignments/:id` endpoint returns `assignment_image` and `audio_files`, but explicitly excludes `answer_key_image`. The answer key is only fetched server-side in `POST /api/submissions`.

**Consequences**:
- Students cannot inspect network responses to get answers
- No authentication system needed for this security property (answer key never leaves server)
