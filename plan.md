Context
Build an automatic grading tool for children's English homework (T/F, fill-in-the-blank, short answer). Teachers upload a photo of the answer key to define question regions, then batch-scan student homework for automatic OCR-based grading. Target market: Taiwan cram schools. The project is currently a fresh template with no custom code.

Architecture
Single Express.js server + vanilla HTML/JS frontend (same pattern as Essay Grader project).
LayerChoiceReasonBackendExpress.jsConsistent with Essay Grader & Spelling AppFrontendVanilla HTML/CSS/JS (multi-page)No build step, proven patternOCRGoogle Cloud Vision DOCUMENT_TEXT_DETECTIONStructured bounding boxes, handwriting support, same vendorImage processingSharp (server-side)HEIC conversion, EXIF rotation, preprocessingDatabasePostgreSQL (Railway)JSONB for flexible answer-key storage, consistent infraFuzzy matchingLevenshtein distanceSimple, configurable threshold per question
Key design decision: Per-region crop OCR (not full-page OCR + coordinate matching)

Teacher draws rectangles on template image (once per worksheet type)
When grading, system crops student image into N sub-images per question
Each sub-image sent individually to Google Vision
Avoids complex coordinate alignment between template and student photos
Cost: ~$0.03/student for 20 questions (acceptable for SaaS)


File Structure
automatic-english-assignment-grader/
├── server.js                    # Express backend
├── package.json
├── .env                         # GOOGLE_VISION_KEY, DATABASE_URL, JWT_SECRET
├── .gitignore
├── CLAUDE.md
├── public/
│   ├── index.html               # Landing page
│   ├── teacher.html             # Answer key setup (ROI drawing + answer entry)
│   ├── grader.html              # Upload & grade student homework
│   ├── css/
│   │   └── common.css
│   └── js/
│       ├── common.js            # Auth, API helpers
│       ├── roi-editor.js        # Canvas-based region drawing tool
│       ├── answer-key-builder.js # Answer key creation logic
│       ├── grading-view.js      # Upload, results display, O/X annotation
│       └── image-utils.js       # Client-side image helpers
├── docs/project_notes/          # (existing)
└── scripts/                     # (existing)

Database Schema
answer_keys
sqlCREATE TABLE answer_keys (
    id SERIAL PRIMARY KEY,
    teacher_name VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,           -- "Unit 3 Quiz"
    template_image TEXT,                  -- base64 of blank template
    image_width INTEGER NOT NULL,
    image_height INTEGER NOT NULL,
    questions JSONB NOT NULL,             -- array of question defs
    settings JSONB DEFAULT '{}',          -- case_sensitive, ignore_punctuation, etc.
    total_points INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
questions JSONB:
json[{
  "number": 1,
  "type": "true_false",
  "region": { "x": 120, "y": 340, "width": 280, "height": 60 },
  "correct_answer": "T",
  "alt_answers": ["true", "t"],
  "points": 2,
  "fuzzy_threshold": 0
}]
settings JSONB:
json{
  "case_sensitive": false,
  "ignore_punctuation": true,
  "fuzzy_default_threshold": 0.8
}
grading_results
sqlCREATE TABLE grading_results (
    id SERIAL PRIMARY KEY,
    answer_key_id INTEGER REFERENCES answer_keys(id) ON DELETE CASCADE,
    student_name VARCHAR(100),
    original_image TEXT NOT NULL,
    graded_image TEXT,
    answers JSONB NOT NULL,    -- per-question: detected_text, correct, score, confidence
    total_score INTEGER NOT NULL,
    total_possible INTEGER NOT NULL,
    graded_at TIMESTAMP DEFAULT NOW()
);

API Endpoints
MethodPathPurposePOST/api/ocr/regionCrop image to region, preprocess, run Vision OCRPOST/api/convert-heicHEIC → JPEG conversionPOST/api/answer-keysCreate answer keyGET/api/answer-keysList answer keys (by teacher)GET/api/answer-keys/:idGet answer key detailDELETE/api/answer-keys/:idDelete answer keyPOST/api/gradeGrade single student image against answer keyPOST/api/grade/batchGrade multiple student imagesGET/api/results/:answerKeyIdGet all results for an answer key

Core Components
1. ROI Editor (roi-editor.js)

Display template image on HTML5 Canvas
Click-and-drag to draw rectangles over each answer region
Sidebar form per region: question number, type (T/F / fill-blank / short-answer), correct answer, points
Resize/delete/reorder regions
Quick grid mode for uniform worksheets

2. Image Preprocessing Pipeline
Client-side (before upload): resize if >4000px, basic grayscale + contrast
Server-side (Sharp, per-region crop before OCR):

HEIC → JPEG if needed
Auto-rotate via EXIF
Sharpen + normalize for faint pencil marks
Optional threshold to binary for very faint writing

3. Grading Engine (grading-view.js)
Per question:

Normalize: trim, optionally lowercase, optionally strip punctuation
Exact match check
Check alt_answers array
Fuzzy match (Levenshtein) if threshold > 0
T/F normalization: "True"/"T"/"O"/"V" → canonical values

4. Image Annotator (Canvas-based)

Green O for correct, Red X for incorrect
Show detected text next to each mark
Total score at top-right corner
Export as downloadable PNG


Implementation Phases
Phase 1 — MVP (No auth, teacher enters name to save/load)

Set up Express server + PostgreSQL on Railway (reuse existing Google Vision API key from Essay Grader)
/api/ocr/region endpoint (Sharp preprocessing + Google Vision)
/api/answer-keys CRUD endpoints
teacher.html with Canvas ROI editor + answer entry form
/api/grade endpoint with matching engine
grader.html with single-image upload + O/X results display
Update CLAUDE.md and project notes

Phase 2 — Batch & Polish

Batch upload UI (multiple student photos)
Results table showing all students' scores
CSV export of results
HEIC support
Teacher verification UI for low-confidence OCR results

Phase 3 — Accuracy & Integration

Advanced preprocessing (adaptive threshold, deskewing)
"Learn from corrections" — store teacher overrides as alt_answers
Confidence indicators (green/yellow/red)
Auth integration with spelling-app JWT system
PDF report generation


Reusable Code References

Google Vision API pattern: Essay Grader/essay_grader_v7_Cloud_Vision_OCR.html (lines 799-844)
Express server setup: Essay Grader/railway-backend/server.js (Express + pg pool + CORS)
Image preprocessing: spelling-app-backend/public/essay-grader/app.html (lines 1078-1134)


Verification Plan

Unit test the matching engine: T/F, exact, fuzzy, case/punctuation toggle combinations
Manual OCR test: Upload a photo of children's handwriting → verify Vision API returns readable text
End-to-end test: Create answer key → upload student photo → verify correct O/X marks and score
HEIC test: Upload iPhone HEIC photo → verify conversion and grading works
Batch test: Upload 5+ student photos → verify all graded correctly with results table