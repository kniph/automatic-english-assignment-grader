#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const WBS_DIR = path.join(ROOT, 'WBs');
const DEFAULT_API_BASE = process.env.IMPORT_API_BASE_URL || 'https://automatic-english-assignment-grader-production.up.railway.app';

function parseArgs(argv) {
  const args = {
    apiBase: DEFAULT_API_BASE,
    overwriteExisting: false,
    dryRun: false,
    howdyLevels: Array.from({ length: 10 }, (_, i) => i + 1),
    books: ['A', 'B', 'C']
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--api-base') args.apiBase = argv[++i];
    else if (arg === '--overwrite-existing') args.overwriteExisting = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--howdy') args.howdyLevels = parseNumberList(argv[++i], 1, 10);
    else if (arg === '--books') args.books = parseBookList(argv[++i]);
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

function normalizeApiBase(apiBase) {
  return String(apiBase || '').replace(/\/+$/, '');
}

function bookFolder(bookType) {
  return `WB${bookType}`;
}

async function listFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function buildAkMap(dir) {
  const files = await listFiles(dir);
  const map = new Map();
  for (const file of files) {
    const parsed = path.parse(file);
    map.set(parsed.name, path.join(dir, file));
  }
  return map;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

async function requireFile(filePath, label) {
  if (!(await fileExists(filePath))) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  return filePath;
}

async function isReadableImage(filePath) {
  try {
    await sharp(filePath).metadata();
    return true;
  } catch (_) {
    return false;
  }
}

function partLabelFromAudioName(name) {
  const base = path.parse(name).name;
  const match = base.match(/_([A-Z])$/i);
  if (!match) return base;
  return `Part ${match[1].toUpperCase()}`;
}

async function stitchImages(imagePaths) {
  const buffers = [];
  const metas = [];

  for (const imagePath of imagePaths) {
    const buffer = await sharp(imagePath).rotate().flatten({ background: '#ffffff' }).toBuffer();
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

async function loadAudioFiles(audioDir, prefix) {
  const files = (await listFiles(audioDir))
    .filter(file => file.startsWith(prefix) && file.toLowerCase().endsWith('.mp3'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const audioFiles = [];
  for (const file of files) {
    const data = await fs.readFile(path.join(audioDir, file), 'base64');
    audioFiles.push({
      name: path.parse(file).name,
      label: partLabelFromAudioName(file),
      data
    });
  }
  return audioFiles;
}

async function buildAssignmentPayload(level, bookType, unit) {
  const baseDir = path.join(WBS_DIR, `Howdy ${level}`);
  const blankDir = path.join(baseDir, bookFolder(bookType));
  const akDir = path.join(baseDir, 'AK', bookFolder(bookType));
  const audioDir = path.join(baseDir, 'Audio', bookFolder(bookType));
  const akMap = await buildAkMap(akDir);

  let blankPaths = [];
  let akPaths = [];
  let audioPrefix = '';
  let assignmentUnit = unit;

  if (bookType === 'A' && unit === 9) {
    blankPaths = [
      path.join(blankDir, `H${level}_A_RW1-1.jpg`),
      path.join(blankDir, `H${level}_A_RW1-2.jpg`)
    ];
    akPaths = [
      akMap.get(`H${level}_A_RW1-1_AK`),
      akMap.get(`H${level}_A_RW1-2_AK`)
    ];
    audioPrefix = `H${level}_A_RW1_`;
  } else if (bookType === 'B' && unit === 10) {
    blankPaths = [
      path.join(blankDir, `H${level}_B_RW2-1.jpg`),
      path.join(blankDir, `H${level}_B_RW2-2.jpg`)
    ];
    akPaths = [
      akMap.get(`H${level}_B_RW2-1_AK`),
      akMap.get(`H${level}_B_RW2-2_AK`)
    ];
    audioPrefix = `H${level}_B_RW2_`;
  } else {
    const pagePrefix = `H${level}_${bookType}_U${assignmentUnit}`;
    blankPaths = [1, 2, 3].map(page => path.join(blankDir, `${pagePrefix}-${page}.jpg`));
    akPaths = [1, 2, 3].map(page => akMap.get(`${pagePrefix}-${page}_AK`));
    audioPrefix = `H${level}_${bookType}_U${assignmentUnit}_`;
  }

  for (let i = 0; i < blankPaths.length; i++) {
    await requireFile(blankPaths[i], `blank page ${i + 1}`);
  }

  const akIssues = [];
  const resolvedAkPaths = [];
  for (let i = 0; i < blankPaths.length; i++) {
    const akPath = akPaths[i];
    const label = `page ${i + 1}`;
    if (!akPath) {
      akIssues.push(`${label}: missing answer key file`);
      resolvedAkPaths.push(blankPaths[i]);
      continue;
    }
    if (!(await isReadableImage(akPath))) {
      akIssues.push(`${label}: unreadable answer key (${path.basename(akPath)})`);
      resolvedAkPaths.push(blankPaths[i]);
      continue;
    }
    resolvedAkPaths.push(akPath);
  }

  const [assignmentBuffer, answerKeyBuffer, audioFiles] = await Promise.all([
    stitchImages(blankPaths),
    stitchImages(resolvedAkPaths),
    bookType === 'C' ? Promise.resolve([]) : loadAudioFiles(audioDir, audioPrefix)
  ]);

  const hasAkFallback = akIssues.length > 0;
  const defaultRiskSummary = '這份作業已批次匯入，但尚未逐課完成高風險題設定；目前分數只視為暫定，需老師覆核後再正式採計。';
  const blockedRiskSummary = `這份作業已批次匯入，但答案卷仍有缺漏或損壞：${akIssues.join('；')}。系統先封鎖這份作業，請補上正確 Answer Key 後再開放。`;

  return {
    howdy_level: level,
    unit: assignmentUnit,
    book_type: bookType,
    assignment_image: assignmentBuffer.toString('base64'),
    answer_key_image: answerKeyBuffer.toString('base64'),
    audio_files: audioFiles,
    supplemental_notes: '',
    grading_status: hasAkFallback ? 'blocked' : 'review_required',
    risk_summary: hasAkFallback ? blockedRiskSummary : defaultRiskSummary
  };
}

function expectedUnitsForBook(bookType) {
  if (bookType === 'A') return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  if (bookType === 'B') return [1, 2, 3, 4, 5, 6, 7, 8, 10];
  return [1, 2, 3, 4, 5, 6, 7, 8];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let data;
  const text = await response.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && data.error
      ? data.error
      : `${response.status} ${response.statusText}`;
    throw new Error(`${message} (${url})`);
  }
  return data;
}

async function fetchExistingAssignments(apiBase) {
  const rows = await fetchJson(`${apiBase}/api/assignments`);
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.howdy_level}-${row.unit}-${row.book_type}`, row);
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/import-assignments.js [options]

Options:
  --api-base <url>           API base URL (default: ${DEFAULT_API_BASE})
  --howdy <list>             Levels to import, e.g. 1-10 or 1,2,5
  --books <list>             Books to import, e.g. A,B,C
  --overwrite-existing       Re-upload assignments that already exist
  --dry-run                  Validate and print what would be imported
`);
    return;
  }

  const apiBase = normalizeApiBase(args.apiBase);
  const existing = await fetchExistingAssignments(apiBase);
  const queue = [];

  for (const level of args.howdyLevels) {
    for (const bookType of args.books) {
      for (const unit of expectedUnitsForBook(bookType)) {
        const key = `${level}-${unit}-${bookType}`;
        if (existing.has(key) && !args.overwriteExisting) {
          queue.push({ key, action: 'skip-existing' });
          continue;
        }
        queue.push({ key, action: 'import', level, bookType, unit });
      }
    }
  }

  const summary = { imported: 0, importedBlocked: 0, skippedExisting: 0, failed: 0 };

  for (const item of queue) {
    if (item.action === 'skip-existing') {
      summary.skippedExisting += 1;
      console.log(`[skip] ${item.key} already exists`);
      continue;
    }

    const label = `Howdy ${item.level} / ${item.bookType} / unit ${item.unit}`;
    try {
      const payload = await buildAssignmentPayload(item.level, item.bookType, item.unit);
      if (payload.grading_status === 'blocked') {
        console.log(`[prepare-blocked] ${label} | placeholder AK | audio ${payload.audio_files.length}`);
      } else {
        console.log(`[prepare] ${label} | pages ok | audio ${payload.audio_files.length}`);
      }
      if (!args.dryRun) {
        await fetchJson(`${apiBase}/api/assignments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      summary.imported += 1;
      if (payload.grading_status === 'blocked') {
        summary.importedBlocked += 1;
      }
      const actionLabel = args.dryRun ? '[dry-run]' : '[imported]';
      const suffix = payload.grading_status === 'blocked' ? ' [blocked]' : '';
      console.log(`${actionLabel} ${label}${suffix}`);
    } catch (err) {
      summary.failed += 1;
      console.error(`[failed] ${label}: ${err.message}`);
    }
  }

  console.log('');
  console.log(`Imported: ${summary.imported}`);
  console.log(`Imported as blocked: ${summary.importedBlocked}`);
  console.log(`Skipped existing: ${summary.skippedExisting}`);
  console.log(`Failed: ${summary.failed}`);

  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
