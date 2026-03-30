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

## 2026-03-29 - BUG-010: Wrong Model ID Format — `claude-sonnet-4-5-20251022` Returns 404

**Issue**: After switching from Haiku to Sonnet, all grading calls returned 500. Railway logs showed:
```
NotFoundError: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-4-5-20251022"}}
```

**Root Cause**:
The model ID `claude-sonnet-4-5-20251022` was a guess. Unlike Haiku (`claude-haiku-4-5-20251001` which was previously working), this versioned Sonnet ID does not exist in Anthropic's API.

**Solution**:
Use the alias form `claude-sonnet-4-6` (no date suffix). Also tried `claude-3-5-sonnet-20241022` as fallback. The alias form is safer as it always resolves to the latest stable version.

**Prevention**:
Do not guess versioned model IDs. Use the canonical alias names from Anthropic's model comparison page:
- `claude-haiku-4-5-20251001` (Haiku — this specific version is documented)
- `claude-sonnet-4-6` (Sonnet alias — always works)
- `claude-opus-4-6` (Opus alias — always works)

---

## 2026-03-29 - BUG-011: Partial Phrase Answers Accepted as Correct

**Issue**: Student wrote "Nic" (3 characters). Correct answer was "Nice to see you." (5 words). Claude graded it as correct.

**Root Cause**:
Grading prompt said "Accept 1-character typo". Claude interpreted "Nic" vs "Nice" as a 1-character difference and marked it correct, ignoring that the full phrase was incomplete.

**Solution**:
Updated prompt to distinguish single-word and phrase answers:
```
- SINGLE WORD answers: accept 1-character typo
- PHRASE answers (2+ words): ALL key words must be present; partial answers are WRONG
```

**Prevention**:
Always specify typo tolerance separately for single words vs. phrases. Partial answers that are simply truncated (not typos) should always be wrong.

---

## 2026-03-29 - BUG-012: "Circle Both Words" Not Detected

**Issue**: Student circled both "she" AND "her" in a "Read and circle" blank (should circle only one). Claude graded the blank as correct.

**Root Cause**:
The original prompt did not include a rule about what happens when multiple words are circled in a single blank. Claude assumed the student circled the correct one.

**Solution**:
Added explicit rule to grading prompt:
```
If the student circled BOTH words in a single blank → WRONG, student_answer="(both circled)"
```

**Prevention**:
For "circle one of two" exercises, the prompt must always include an explicit "circle both = wrong" rule. This is non-obvious to an AI model without the rule.

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

## 2026-03-30 - BUG-013: Vocab Canvas Hands Off Apple Pencil to Page Drag

**Issue**: On `vocab-exam.html`, Apple Pencil could draw briefly, then iPad Safari started treating later movements as page dragging instead of ink input.

**Root Cause**:
The vocab canvas used `touch-action: pan-y pinch-zoom` and only partially handled pointer events. Safari could still let browser gestures take over after the initial stroke, especially when pen and touch interactions mixed on the same canvas.

**Solution**:
Moved the vocab canvas to the same event model already proven in `assignment.html`:
- set canvas `touch-action: none`
- explicitly separate `pen/mouse` drawing from `touch` scrolling
- track active pointers in JS
- use pointer capture for the active pen pointer
- keep page/mount scrolling under JS control for touch input

**Prevention**:
On iPad drawing surfaces, do not rely on browser gesture defaults once Apple Pencil writing is required. Use a fully owned pointer model with explicit pen-vs-touch handling and pointer capture.

---

## 2026-03-30 - BUG-014: Vocab Submissions Fail on Railway When Vision Key Is Missing

**Issue**: `POST /api/vocab/submissions` returned 400 on Railway when students submitted a vocab exam. Railway logs showed `Google Vision API key not configured`.

**Root Cause**:
The vocab module grades each answer box with Google Vision OCR via `callVisionAPI()`. Production was deployed without `GOOGLE_VISION_API_KEY`. The route also collapsed the config failure into a generic 400, which made it look like a bad student submission instead of a server-side OCR outage.

**Solution**:
- `callVisionAPI()` now throws a clearer error: `OCR service unavailable: GOOGLE_VISION_API_KEY is not configured on the server`
- Missing-key failures now carry HTTP `503`
- `POST /api/vocab/submissions` preserves that status instead of forcing `400`
- project docs now explicitly state that vocab grading still requires `GOOGLE_VISION_API_KEY`

**Prevention**:
Do not rely on the main assignment grader's Anthropic flow when deploying vocab grading. Treat `GOOGLE_VISION_API_KEY` as a required production variable for any deployment that uses vocab exams, document parsing, or region OCR.

---

## 2026-03-30 - BUG-015: iPad Safari Shows Text Selection / Lookup UI While Writing on Vocab Exam

**Issue**: On `vocab-exam.html`, Apple Pencil writing could trigger Safari's selection / lookup callout mid-writing. Ink still worked, but the `Copy / Look Up / Translate / Search Web` overlay kept appearing on top of the page.

**Root Cause**:
The vocab workspace allowed Safari's default selection and touch-callout behavior to stay active around the canvas stack. On iPad, this could surface selection UI over the exam image while the student was writing or pausing.

**Solution**:
- mark the vocab workspace as non-selectable with `user-select: none` / `-webkit-touch-callout: none`
- disable selection / drag / context-menu behavior on the canvas shell
- clear any transient browser selection during canvas pointer interactions

**Prevention**:
For iPad writing surfaces, suppress browser text selection and touch callouts at both the CSS layer and the canvas event layer. Pointer capture alone is not enough to stop Safari's selection UI.

---

## 2026-03-30 - BUG-016: Auto-Published Vocab Answer Boxes Included Printed Prompt Text

**Issue**: The demo vocab exam for `Howdy 1 Unit 2` graded obvious correct handwriting as wrong. OCR output looked like fragments such as `re (c`, `hree (a`, `ight (a`, `abbit /n` instead of the full target words.

**Root Cause**:
The published `answer_box` values came straight from answer-key detection crops. Those crops were good enough to detect the colored answer word on the answer sheet, but they still included nearby printed prompt characters like `(` or part of the English sentence. When reused on the blank student page, the same box captured handwriting plus printed worksheet text, so Google Vision was solving the wrong image.

**Solution**:
- tighten the demo exam boxes before publishing
- shift boxes slightly left/up to preserve handwritten strokes
- trim the right edge so the printed `(adj.) / (n.)` text stays out of the OCR crop
- republish the Railway demo exam with the corrected boxes

**Prevention**:
Do not reuse answer-key detection boxes as student OCR boxes without a second normalization step. Answer-key boxes are for locating colored answers; student boxes must target only the blank handwriting region.

---

## 2026-03-30 - BUG-017: Tightened Demo Boxes Still Clipped Handwriting Prefixes

**Issue**: After removing most printed prompt text from the demo vocab OCR boxes, the next test still missed many first letters. Example outputs included `one -> le`, `six -> ix`, `seven -> ven`, `ten -> en`.

**Root Cause**:
The first pass at tightening the student boxes preserved the right boundary but left the capture window too close to the colored answer word anchor. Real handwriting on the blank worksheet starts further left than the printed answer key word, so the OCR crop clipped the first letter even though the box no longer included much prompt text.

**Solution**:
- expand the demo publish boxes further to the left
- keep the right edge relatively conservative to avoid reintroducing printed `(adj.) / (n.)` text
- republish the Railway demo exam again with the wider-left boxes

**Prevention**:
When converting answer-key detections into student handwriting boxes, leave extra space on the left side for natural handwriting drift. Students do not anchor their first stroke at the same x-position as the printed answer key.

---

## 2026-03-31 - BUG-018: OCR Still Saw Worksheet Noise Even After Better Boxes

**Issue**: After adding answer guides and widening the demo boxes, vocab grading improved to the `55/70` range but still produced failures caused by extra printed noise or stray strokes inside the crop.

**Root Cause**:
The grading pipeline still OCRed the merged worksheet crop directly. Even when the answer box was better aligned, Google Vision still saw the worksheet background, prompt text, and any residual artifacts together with the handwriting. For fixed-template exams, this is the wrong input: the system already has the exact blank page and should isolate only the student's added ink.

**Solution**:
- normalize both the submission page and the stored blank page to the same pixel grid
- crop the same region from both
- subtract the blank crop from the student crop to keep only changed pixels
- OCR the handwriting-only mask instead of the raw worksheet crop
- binarize and enlarge the masked crop before sending it to Google Vision

**Prevention**:
For any fixed-template handwriting product, do not OCR the merged page directly if the blank template is available. Always isolate student-added pixels first; OCR accuracy depends more on crop purity than on swapping vendors.

---

## 2026-03-31 - BUG-019: Safari Selection / Live Text Still Surfaced Above Vocab Canvas

**Issue**: Even after disabling `user-select` and clearing browser selection, iPad Safari could still show selection / lookup UI above the vocab canvas while the student was writing.

**Root Cause**:
Pointer-event suppression alone did not fully stop Safari's native touch-driven selection pipeline. The canvas needed lower-level `touchstart` / `touchmove` / `touchend` prevention to reduce browser ownership of the gesture.

**Solution**:
- add non-passive legacy touch listeners on the vocab draw canvas
- call `preventDefault()` on native touch events in addition to the pointer model
- continue clearing transient selection state during interactions

**Prevention**:
On iPad drawing surfaces, treat pointer events and legacy touch events as separate suppression layers. Preventing one does not guarantee Safari will stop Live Text / selection UI.

---

## 2026-03-31 - BUG-020: Vocab Result UI Displayed Raw Points Beside a Percentage Pass Threshold

**Issue**: The vocab result page showed a large score like `65 / 70` while the pass threshold was displayed as `80`. Even though pass/fail was correctly calculated from `percentage`, the UI made it look as if the student needed 80 raw points, which is impossible on shorter exams.

**Root Cause**:
The backend stored both raw points and percentage, and pass/fail already used percentage. The confusion came from the presentation layer: the hero score emphasized raw points while the pass threshold remained percentage-based.

**Solution**:
- keep internal per-question scoring unchanged (`5` points or `0`)
- keep pass/fail based on `percentage >= pass_score`
- change the main result display to percentage-based score (`93 / 100`)
- show raw points only as secondary detail (`原始題分 65 / 70`)
- relabel teacher inputs and list columns so `pass_score` is clearly a percentage threshold

**Prevention**:
When exam lengths vary, never present raw points as the primary score if the pass threshold is percentage-based. Keep raw points for audit, but use a percentage score as the main teacher/student-facing grade.

---
