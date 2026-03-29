#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const WBS_DIR = path.join(ROOT, 'WBs');
const DEFAULT_OUT = path.join(ROOT, 'data', 'supplemental_notes_manifest.generated.json');
const MANUAL_NOTE_OVERRIDES = new Map([
  ['10-1-C', '[C] skip\nOpen-ended paragraph writing page without a usable answer-key image. Do not auto-grade this section.'],
  ['10-2-C', '[B] skip\nThis section has no usable answer-key image in the source materials. Do not auto-grade this section.'],
  ['10-4-C', '[B] skip\nThis section has no usable answer-key image in the source materials. Do not auto-grade this section.'],
  ['10-6-C', '[C] skip\nOpen-ended paragraph writing page without a usable answer-key image. Do not auto-grade this section.']
]);

function parseArgs(argv) {
  const args = {
    howdyLevels: Array.from({ length: 10 }, (_, i) => i + 1),
    books: ['A', 'B', 'C'],
    out: DEFAULT_OUT
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--howdy') args.howdyLevels = parseNumberList(argv[++i], 1, 10);
    else if (arg === '--books') args.books = parseBookList(argv[++i]);
    else if (arg === '--out') args.out = path.resolve(argv[++i]);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function parseNumberList(value, min, max) {
  const numbers = new Set();
  for (const part of String(value || '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [startRaw, endRaw] = trimmed.split('-', 2);
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error(`Invalid range: ${trimmed}`);
      for (let n = Math.min(start, end); n <= Math.max(start, end); n++) {
        if (n < min || n > max) throw new Error(`Number out of range: ${n}`);
        numbers.add(n);
      }
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid number: ${trimmed}`);
      numbers.add(n);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

function parseBookList(value) {
  const books = String(value || '')
    .split(',')
    .map(v => v.trim().toUpperCase())
    .filter(Boolean);
  if (!books.length) throw new Error('No books provided');
  for (const book of books) {
    if (!['A', 'B', 'C'].includes(book)) throw new Error(`Invalid book: ${book}`);
  }
  return [...new Set(books)];
}

function bookFolder(bookType) {
  return `WB${bookType}`;
}

function expectedUnitsForBook(bookType) {
  if (bookType === 'A') return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  if (bookType === 'B') return [1, 2, 3, 4, 5, 6, 7, 8, 10];
  return [1, 2, 3, 4, 5, 6, 7, 8];
}

function pagesPerAssignment(level, bookType) {
  if (level === 10 && bookType === 'C') return 4;
  return 3;
}

async function stitchImages(imagePaths) {
  const buffers = [];
  const metas = [];

  for (const imagePath of imagePaths) {
    const buffer = await sharp(imagePath).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
    const meta = await sharp(buffer).metadata();
    buffers.push(buffer);
    metas.push(meta);
  }

  const width = Math.max(...metas.map(m => m.width || 0));
  const height = metas.reduce((sum, meta) => sum + (meta.height || 0), 0);

  let top = 0;
  const composite = buffers.map((input, index) => {
    const item = { input, left: 0, top };
    top += metas[index].height || 0;
    return item;
  });

  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite(composite)
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function ocrTextFromBuffer(buffer) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_VISION_API_KEY not configured');

  const body = {
    requests: [{
      image: { content: buffer.toString('base64') },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }]
    }]
  };

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Vision request failed: ${res.status}`);
  }
  return data.responses?.[0]?.fullTextAnnotation?.text || '';
}

function buildBlankPaths(level, bookType, unit) {
  const blankDir = path.join(WBS_DIR, `Howdy ${level}`, bookFolder(bookType));
  if (bookType === 'A' && unit === 9) {
    return [
      path.join(blankDir, `H${level}_A_RW1-1.jpg`),
      path.join(blankDir, `H${level}_A_RW1-2.jpg`)
    ];
  }
  if (bookType === 'B' && unit === 10) {
    return [
      path.join(blankDir, `H${level}_B_RW2-1.jpg`),
      path.join(blankDir, `H${level}_B_RW2-2.jpg`)
    ];
  }
  const pageCount = pagesPerAssignment(level, bookType);
  return Array.from({ length: pageCount }, (_, index) =>
    path.join(blankDir, `H${level}_${bookType}_U${unit}-${index + 1}.jpg`)
  );
}

function cleanTitle(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .replace(/[|]+/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();
}

function extractSections(ocrText) {
  const lines = String(ocrText || '')
    .split('\n')
    .map(line => cleanTitle(line))
    .filter(Boolean);

  const sections = [];
  for (const line of lines) {
    const match = line.match(/^([A-I])(?:[\.\):]|\s)\s*(.+)$/i);
    if (!match) continue;
    const section = match[1].toUpperCase();
    const title = cleanTitle(match[2]);
    if (!title) continue;
    const lower = title.toLowerCase();
    if (!/(look|listen|read|write|circle|match|crossword|complete|connect|decode|unscramble|color|draw|guess|check|find|help|number|put|count)/.test(lower)) {
      continue;
    }
    if (sections.some(item => item.section === section && item.title.toLowerCase() === lower)) continue;
    sections.push({ section, title });
  }
  return sections;
}

function classifySection(title) {
  const lower = title.toLowerCase();

  if (lower.includes('crossword')) {
    return {
      mode: 'skip',
      note: 'crossword'
    };
  }

  if (lower.includes('maze')) {
    return {
      mode: 'skip',
      note: 'maze'
    };
  }

  if (lower.includes('draw')) {
    return {
      mode: 'skip',
      note: 'drawing activity'
    };
  }

  if (lower.includes('guess') && lower.includes('draw')) {
    return {
      mode: 'skip',
      note: 'guess-and-draw activity'
    };
  }

  if (lower.includes('write') && lower.includes('match')) {
    return {
      mode: 'written_only',
      note: 'Ignore the matching lines. Grade only the written answers.'
    };
  }

  if (lower.includes('write and find the words')) {
    return {
      mode: 'written_only',
      note: 'Ignore the word-search / circling part. Grade only the written answers.'
    };
  }

  if (lower.includes('find the words') && lower.includes('circle')) {
    return {
      mode: 'skip',
      note: 'word-search circling activity'
    };
  }

  if (lower.includes('circle and write')) {
    return {
      mode: 'written_only',
      note: 'Ignore the circling part. Grade only the written answers.'
    };
  }

  if (lower.includes('write and color') || lower.includes('color and write')) {
    return {
      mode: 'written_only',
      note: 'Ignore the coloring part. Grade only the written answers.'
    };
  }

  if (lower.includes('match and unscramble')) {
    return {
      mode: 'written_only',
      note: 'Ignore the matching lines. Grade only the written unscrambled answers.'
    };
  }

  if (lower.includes('decode') && lower.includes('match')) {
    return {
      mode: 'written_only',
      note: 'Ignore the matching lines. Grade only the written decoded answers.'
    };
  }

  if (lower.includes('connect the dots') && lower.includes('write')) {
    return {
      mode: 'written_only',
      note: 'Ignore the dot-to-dot and coloring part. Grade only the written answers.'
    };
  }

  if (lower.includes('write a short passage')) {
    return {
      mode: 'skip',
      note: 'open-ended paragraph writing'
    };
  }

  if (
    (lower.includes('read and color') || lower.includes('look and color') || lower.includes('listen and color')) &&
    !lower.includes('write')
  ) {
    return {
      mode: 'skip',
      note: 'coloring activity'
    };
  }

  if (lower.includes('color') && !lower.includes('write')) {
    return {
      mode: 'skip',
      note: 'coloring activity'
    };
  }

  if (lower.includes('match')) {
    return {
      mode: 'matching',
      note: 'This is a line-connecting matching section. If any student line is unclear, do not guess.'
    };
  }

  return null;
}

function buildSupplementalNotes(level, bookType, unit, sections) {
  const blocks = [];
  const seen = new Set();
  for (const item of sections) {
    const classification = classifySection(item.title);
    if (!classification) continue;
    const block = `[${item.section}] ${classification.mode}\n${classification.note}`;
    if (seen.has(block)) continue;
    seen.add(block);
    blocks.push(block);
  }
  const override = MANUAL_NOTE_OVERRIDES.get(`${level}-${unit}-${bookType}`);
  if (override && !seen.has(override)) {
    blocks.push(override);
  }
  return blocks.join('\n\n').trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/generate-supplemental-manifest.js [options]

Options:
  --howdy <list>    Levels to scan, e.g. 1-10
  --books <list>    Books to scan, e.g. A,B,C
  --out <path>      Output JSON path
`);
    return;
  }

  const manifest = [];
  for (const level of args.howdyLevels) {
    for (const bookType of args.books) {
      for (const unit of expectedUnitsForBook(bookType)) {
        const blankPaths = buildBlankPaths(level, bookType, unit);
        const stitched = await stitchImages(blankPaths);
        const text = await ocrTextFromBuffer(stitched);
        const sections = extractSections(text);
        const supplementalNotes = buildSupplementalNotes(level, bookType, unit, sections);
        manifest.push({
          howdy_level: level,
          unit,
          book_type: bookType,
          sections,
          supplemental_notes: supplementalNotes
        });
        console.log(`[scanned] Howdy ${level} / ${bookType} / unit ${unit} | sections ${sections.length} | notes ${supplementalNotes ? 'yes' : 'no'}`);
      }
    }
  }

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Saved: ${args.out}`);
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
