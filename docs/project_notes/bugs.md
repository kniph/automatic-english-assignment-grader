# Bug Log

Record of bugs encountered, root causes, solutions, and prevention strategies.

---

## 2026-03-27 - BUG-001: Canvas Blank (Gray Box) After Image Upload

**Issue**: ROI editor canvas displayed as gray box with no image after uploading template.

**Root Cause**:
`editorCard` div was `display:none` when `_fitCanvas()` ran. The canvas read `clientWidth = 0`, causing `scale = 0`, so the image was drawn at zero size.

**Solution**:
Unhide `editorCard` before calling `editor.loadImage()`, so the card has a non-zero width when the canvas calculates its scale.

**Prevention**:
Always ensure container elements are visible before reading `clientWidth` / `clientHeight`. Use `offsetWidth` check as a guard.

---

## 2026-03-27 - BUG-002: `pdf-parse` v2 Crashes Railway Server

**Issue**: Server crashed on Railway immediately after `require('pdf-parse')`. Local dev worked fine.

**Root Cause**:
`pdf-parse` v2 bundles `pdf.js` which uses browser APIs not available in Node.js on Railway's container environment.

**Solution**:
Removed `pdf-parse` entirely. PDFs from teacher upload are now handled client-side via PDF.js CDN (renders page 1 to canvas → JPEG). Server-side PDF OCR uses Google Vision `files:annotate`.

**Prevention**:
Avoid npm packages that bundle browser-targeted JS for server-side use. Test Railway deployment after adding any package that does heavy file processing.

---

## 2026-03-27 - BUG-003: `/api/parse-document` 500 Error for PDF

**Issue**: Uploading a PDF to `/api/parse-document` returned 500. DOCX worked fine.

**Root Cause**:
Used `images:annotate` endpoint with `image.content` for PDFs. Google Vision `images:annotate` only accepts raster image formats, not PDFs.

**Solution**:
Switch to `files:annotate` endpoint with `inputConfig: { content: base64, mimeType: 'application/pdf' }`. The response structure is also different — results are nested under `responses[0].responses[]` (one per page).

**Prevention**:
Use `images:annotate` for images (JPEG/PNG), `files:annotate` for PDFs/TIFFs. Check Vision API docs for endpoint selection.

---

## 2026-03-27 - BUG-004: Edit Tool Fails with "2 Matches Found"

**Issue**: Tried to edit a specific block in `server.js` but the `old_string` matched two locations — once in `/api/grade` and once in `/api/results/:id/analysis`.

**Root Cause**:
Both handlers contain nearly identical boilerplate:
```javascript
const keyResult = await pool.query('SELECT * FROM answer_keys WHERE id = $1', [req.params.answerKeyId]);
if (keyResult.rows.length === 0) return res.status(404)...
```

**Solution**:
Provide additional surrounding context in `old_string` to uniquely identify the target block (e.g., include the route handler signature line above it).

**Prevention**:
When editing repeated patterns, always include 3–5 unique lines of surrounding context. Route handler opening lines are usually unique and good anchors.

---

## 2026-03-27 - BUG-005: git index.lock — Stale Lock File

**Issue**: `git commit` fails with `fatal: Unable to create '.git/index.lock': File exists`.

**Root Cause**:
A previous git process crashed mid-operation, leaving the lock file behind.

**Solution**:
```bash
rm -f .git/index.lock
```

**Prevention**:
This happens after a crash or forced process kill. Safe to remove if no git process is currently running.

---

## 2026-03-27 - BUG-006: `gradeWithClaude` Returns No JSON

**Issue**: Claude response occasionally doesn't contain a JSON block, causing `JSON.parse` to throw.

**Root Cause**:
If Claude returns an explanation before the JSON (e.g., "Here is the grading:"), the regex `/\{[\s\S]*\}/` should still match. But if the model refuses or returns an error message, no JSON is present.

**Solution**:
Current code uses `raw.match(/\{[\s\S]*\}/)` — extracts the first JSON object even if surrounded by text.
If `jsonMatch` is null, throws `'Claude 未回傳有效的 JSON'` with the raw text in logs.

**Prevention**:
- Prompt instructs "Return ONLY valid JSON (no markdown, no explanation)"
- Haiku is less likely to add prose than Opus
- Log the raw response for debugging when parse fails

---

## 2026-03-28 - BUG-007: Analysis Endpoint Crashes for Claude Mode (Empty Questions)

**Issue**: `GET /api/results/:answerKeyId/analysis` crashed when `questions` array was empty. Claude mode assignments start with `questions: []` until first grading.

**Root Cause**:
`questions.map(q => ...)` on an empty array returns `[]` but downstream `question_stats` was empty — not a crash. The real issue was the analysis endpoint wasn't rebuilt from answers data.

**Solution**:
Added fallback: if `questions.length === 0` and results exist, rebuild questions from the first result's `answers` array:
```javascript
if (questions.length === 0 && results.length > 0) {
  questions = results[0].answers.map(a => ({
    number: a.question_number,
    correct_answer: a.correct_answer || '',
    type: 'fill_blank', points: 1
  })).sort((a, b) => a.number - b.number);
}
```

**Prevention**:
Always guard against empty arrays when the data might not be populated yet. Claude mode assigns questions lazily (on first grading).

---
