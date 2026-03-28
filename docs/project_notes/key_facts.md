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
- `GET  /api/assignments/available` — list all (howdy, unit, book) combinations that have been uploaded
- `GET  /api/assignments?howdy=&unit=&book=` — filter assignments (no images/audio, metadata only; includes `has_supplemental_notes`)
- `GET  /api/assignments/:id` — get assignment with workbook image + audio (NO answer key)
- `POST /api/assignments` — create/upsert assignment (teacher only; accepts optional `supplemental_notes`)
- `DELETE /api/assignments/:id`
- `POST /api/submissions` — student submits merged drawing → Claude grades → returns results
- `GET  /api/submissions?assignment_id=X` — list submissions for teacher view
- `GET  /api/submissions/:id` — get single submission with answers

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

---

## Pages

| File | Role | Audience |
|---|---|---|
| `public/index.html` | Student entry: name → Howdy → Unit → Book | Student |
| `public/assignment.html` | Canvas drawing + audio + submit + results | Student |
| `public/teacher.html` | Upload assignments (image + answer key + audio) | Teacher |
| `public/grader.html` | Legacy: manual upload + grade + analysis | Teacher (v1) |
| `public/*-v1.html` | Backup of v1 pages | Archive |

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



```bash
npm run dev    # nodemon auto-reload
npm start      # production
```

Fix stale git lock:
```bash
rm -f .git/index.lock
```
