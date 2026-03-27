# Automatic English Assignment Grader

**Children's English homework auto-grader with OCR — supports T/F, fill-in-the-blank, and short answer questions.**

Tech Stack: Express.js, PostgreSQL, Google Cloud Vision API, Sharp, Vanilla HTML/CSS/JS

---

## Project Memory System

This project maintains structured memory in `docs/project_notes/` to preserve knowledge across AI sessions and prevent re-solving known issues.

### Memory-Aware Protocols

**Before proposing architectural changes:**
- Check `docs/project_notes/decisions.md` for existing architectural decisions
- Verify the proposed approach doesn't conflict with past choices
- Review relevant ADRs (Architectural Decision Records)

**When encountering errors or bugs:**
- Search `docs/project_notes/bugs.md` for similar issues first
- Apply known solutions if a match is found
- Document new bugs with root cause, solution, and prevention when resolved

**When looking up project configuration:**
- Check `docs/project_notes/key_facts.md` for credentials, ports, URLs, database schema
- Prefer documented facts over assumptions

**When starting work on a new feature:**
- Review `docs/project_notes/issues.md` for related past work
- Update work log when significant work is completed

### Memory File Structure

```
docs/project_notes/
├── bugs.md         # Bug log with solutions and prevention strategies
├── decisions.md    # Architectural Decision Records (ADRs)
├── key_facts.md    # Project configuration and quick reference
└── issues.md       # Work log with ticket references
```

---

## Deployment & Infrastructure

**Platform**: Railway
**Database**: PostgreSQL (Railway-hosted)
**OCR**: Google Cloud Vision API (DOCUMENT_TEXT_DETECTION)
**Environment**: Development on localhost:3000

---

## Development

### Start Server
```bash
npm run dev    # nodemon with auto-reload
npm start      # production
```

### Environment Variables (.env)
```
PORT=3000
DATABASE_URL=postgresql://localhost:5432/homework_grader
GOOGLE_VISION_API_KEY=<your-key>
```

---

## Key Files

- `server.js` — Express backend with all API endpoints, OCR, matching engine, and DB init
- `public/index.html` — Landing page with teacher name entry
- `public/teacher.html` — Answer key setup with Canvas-based ROI editor
- `public/grader.html` — Upload student homework and view grading results
- `public/js/roi-editor.js` — ROI (region of interest) drawing tool class
- `public/js/common.js` — Shared API helpers, toast notifications, file utilities
- `public/css/common.css` — Shared styles

## Architecture

- **Per-region crop OCR**: Teacher draws rectangles on template image. During grading, each region is cropped and sent individually to Google Vision for higher accuracy.
- **Matching engine**: Supports exact match, alt answers, fuzzy match (Levenshtein), and T/F normalization.
- **No auth for MVP**: Teacher name stored in localStorage for saving/loading answer keys.

---

## Version Management

Current Version: **[See VERSION file]**
- Automated version checking via pre-commit hook
- Run `npm run version:update` to bump version
- Run `npm run version:check` to verify consistency

---
