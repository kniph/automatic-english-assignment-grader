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
| `unit` | INTEGER | 1–8 |
| `book_type` | VARCHAR(1) | 'A', 'B', or 'C' |
| `assignment_image` | TEXT | Base64 JPEG of blank workbook page |
| `answer_key_image` | TEXT | Base64 JPEG of answer key (never sent to student) |
| `audio_files` | JSONB | `[{name, label, data (base64 mp3)}]` |
| `created_at` | TIMESTAMP | |

**Unique constraint**: `(howdy_level, unit, book_type)` — UPSERT on duplicate

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
- `GET  /api/assignments?howdy=&unit=&book=` — filter assignments (no images/audio, metadata only)
- `GET  /api/assignments/:id` — get assignment with workbook image + audio (NO answer key)
- `POST /api/assignments` — create/upsert assignment (teacher only)
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

**Current model**: `claude-haiku-4-5-20251001`
**Approx cost**: ~$0.002 per grading (two images in, JSON out)
**Previous model**: `claude-opus-4-6` (~$0.03/grading, switched to Haiku for cost)

To change model: edit `gradeWithClaude()` and `gradeHandwriting()` in `server.js`.

---

## Image Storage Notes

All images stored as Base64 TEXT in PostgreSQL. Server-side compression via Sharp before INSERT:
- Max dimensions: 2000 × 2800 px
- JPEG quality: 85–90
- Typical stored size: ~150–300 KB per image (base64)
- Audio files stored as base64 MP3 — 1 MB MP3 ≈ 1.35 MB base64

**Railway PostgreSQL hobby plan**: 1 GB storage limit.
~240 assignments (Howdy 1–10 × Unit 1–8 × A/B/C) × ~1 MB each ≈ ~240 MB for all assignments.

---

## Development

```bash
npm run dev    # nodemon auto-reload
npm start      # production
```

Fix stale git lock:
```bash
rm -f .git/index.lock
```
