# Automatic English Assignment Grader

**Children's English homework auto-grader with OCR — supports T/F, fill-in-the-blank, and short answer questions.**

Upload a photo of the answer key, draw rectangles over each answer area, then batch-scan student homework for instant automatic grading.

---

## Features

- **OCR-powered grading** using Google Cloud Vision (optimized for children's handwriting)
- **3 question types**: True/False, Fill-in-the-blank, Short Answer
- **Canvas-based ROI editor**: draw rectangles on the template image to define answer regions
- **Smart matching**: case-insensitive, punctuation-ignore, fuzzy matching (Levenshtein), T/F normalization
- **Batch grading**: upload multiple student photos at once
- **Annotated output**: O/X marks drawn on the student's paper with total score
- **HEIC support**: works with iPhone photos

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Express.js + Node.js |
| Database | PostgreSQL (Railway) |
| OCR | Google Cloud Vision API (`DOCUMENT_TEXT_DETECTION`) |
| Image processing | Sharp (HEIC conversion, preprocessing) |
| Frontend | Vanilla HTML/CSS/JS (no build step) |

---

## How It Works

1. **Teacher sets up answer key** (`/teacher.html`)
   - Upload a photo of the blank worksheet or answer key
   - Draw rectangles on each answer area
   - Enter the correct answer, question type, and point value
   - Save the answer key

2. **Teacher grades homework** (`/grader.html`)
   - Select an answer key
   - Upload one or more student homework photos
   - System crops each region, runs OCR, matches against answer key
   - Results shown with O/X marks and score breakdown

---

## Setup

### Prerequisites

- Node.js v18 or higher
- PostgreSQL database
- Google Cloud Vision API key

### Environment Variables

```env
PORT=3000
DATABASE_URL=postgresql://...
GOOGLE_VISION_API_KEY=your_key_here
```

### Local Development

```bash
git clone https://github.com/kniph/automatic-english-assignment-grader
cd automatic-english-assignment-grader
npm install
npm run dev
```

### Deploy to Railway

1. Push to GitHub
2. New Railway project → Deploy from GitHub repo
3. Add PostgreSQL database service
4. Set `GOOGLE_VISION_API_KEY` in environment variables
5. `DATABASE_URL` is auto-injected by Railway

---

## Project Structure

```
├── server.js              # Express backend — all API endpoints, OCR, matching engine
├── public/
│   ├── index.html         # Landing page
│   ├── teacher.html       # Answer key setup with ROI editor
│   ├── grader.html        # Grade student homework
│   ├── css/common.css
│   └── js/
│       ├── roi-editor.js  # Canvas region drawing tool
│       └── common.js      # Shared utilities
└── docs/project_notes/    # AI session memory (bugs, decisions, key facts)
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/answer-keys` | Create answer key |
| GET | `/api/answer-keys` | List answer keys (filter by `teacher_name`) |
| GET | `/api/answer-keys/:id` | Get answer key detail |
| DELETE | `/api/answer-keys/:id` | Delete answer key |
| POST | `/api/ocr/region` | OCR a cropped image region |
| POST | `/api/convert-heic` | Convert HEIC to JPEG |
| POST | `/api/grade` | Grade single student image |
| POST | `/api/grade/batch` | Grade multiple student images |
| GET | `/api/results/:answerKeyId` | Get past grading results |

---

## Available Scripts

- `npm run dev` — Start development server with hot reload
- `npm start` — Start production server
- `npm run version:update` — Bump version number
- `npm run version:check` — Verify version consistency

---

## Documentation

- [CLAUDE.md](CLAUDE.md) — AI assistant context and project memory
- [CHANGELOG.md](CHANGELOG.md) — Version history
- [docs/project_notes/](docs/project_notes/) — Bug logs, decisions, and work history

---

## License

MIT
