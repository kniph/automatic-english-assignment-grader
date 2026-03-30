#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const VOC_ROOT = path.join(ROOT, 'VOCs');
const BLANK_ROOT = path.join(VOC_ROOT, '空白卷');
const SCAN_ROOT = path.join(VOC_ROOT, '掃描檔');
const DEFAULT_API_BASE = process.env.IMPORT_API_BASE_URL || 'https://automatic-english-assignment-grader-production.up.railway.app';

function parseArgs(argv) {
  const args = {
    apiBase: DEFAULT_API_BASE,
    dryRun: false,
    overwriteExisting: false,
    levels: null,
    units: null,
    teacherPasscode: process.env.TEACHER_PASSCODE || ''
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--api-base') args.apiBase = argv[++index];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--overwrite-existing') args.overwriteExisting = true;
    else if (arg === '--levels') args.levels = parseNumberList(argv[++index], 1, 10);
    else if (arg === '--units') args.units = parseNumberList(argv[++index], 1, 10);
    else if (arg === '--teacher-passcode') args.teacherPasscode = argv[++index];
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
      const num = Number(trimmed);
      if (!Number.isInteger(num) || num < min || num > max) throw new Error(`Invalid number: ${trimmed}`);
      numbers.add(num);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

function normalizeApiBase(apiBase) {
  return String(apiBase || '').replace(/\/+$/, '');
}

function isImageFile(name) {
  return /\.(jpg|jpeg|png)$/i.test(name);
}

function parseHowdyUnitFromName(name) {
  const base = path.parse(name).name.replace(/\s+/g, '');
  const match = base.match(/^H(\d+)U(\d+)/i);
  if (!match) return null;
  return {
    level: Number(match[1]),
    unit: Number(match[2])
  };
}

function buildTitle(level, unit) {
  return `Howdy ${level} Unit ${unit} Vocabulary`;
}

async function listDirFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(entry => entry.isFile()).map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function collectBlankMap() {
  const levelDirs = await fs.readdir(BLANK_ROOT, { withFileTypes: true });
  const map = new Map();

  for (const entry of levelDirs) {
    if (!entry.isDirectory()) continue;
    const levelMatch = entry.name.match(/^NH(\d+)$/i);
    if (!levelMatch) continue;
    const level = Number(levelMatch[1]);
    const dirPath = path.join(BLANK_ROOT, entry.name);
    const files = await listDirFiles(dirPath);
    for (const file of files) {
      if (!isImageFile(file)) continue;
      const parsed = parseHowdyUnitFromName(file);
      if (!parsed) continue;
      const key = `${parsed.level}-${parsed.unit}`;
      if (!map.has(key)) {
        map.set(key, path.join(dirPath, file));
      }
    }
  }

  return map;
}

async function collectScanMap() {
  const levelDirs = await fs.readdir(SCAN_ROOT, { withFileTypes: true });
  const map = new Map();

  for (const entry of levelDirs) {
    if (!entry.isDirectory()) continue;
    const levelMatch = entry.name.match(/^H(\d+)$/i);
    if (!levelMatch) continue;
    const dirPath = path.join(SCAN_ROOT, entry.name);
    const files = await listDirFiles(dirPath);
    for (const file of files) {
      if (!isImageFile(file)) continue;
      if (/_Conflict/i.test(file)) continue;
      const parsed = parseHowdyUnitFromName(file);
      if (!parsed) continue;
      const key = `${parsed.level}-${parsed.unit}`;
      if (!map.has(key)) {
        map.set(key, path.join(dirPath, file));
      }
    }
  }

  return map;
}

async function imageFileToBase64(filePath) {
  return (await sharp(filePath)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: 2000, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer()).toString('base64');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
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

function getSetCookieHeader(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    const values = response.headers.getSetCookie();
    return values[0] || '';
  }
  return response.headers.get('set-cookie') || '';
}

async function ensureTeacherCookie(apiBase, teacherPasscode) {
  const status = await fetchJson(`${apiBase}/api/teacher-auth/status`);
  if (!status.enabled) return '';
  if (!teacherPasscode) {
    throw new Error('Teacher passcode is required by the API but no passcode was provided');
  }

  const response = await fetch(`${apiBase}/api/teacher-auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: teacherPasscode })
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Teacher auth failed (${response.status})`);
  }

  const setCookie = getSetCookieHeader(response);
  const cookie = String(setCookie || '').split(';')[0];
  if (!cookie) {
    throw new Error('Teacher auth succeeded but no auth cookie was returned');
  }
  return cookie;
}

async function fetchExistingExams(apiBase, cookie) {
  const headers = cookie ? { Cookie: cookie } : {};
  const rows = await fetchJson(`${apiBase}/api/vocab/exams?scope=teacher`, { headers });
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.title || '').trim().toLowerCase(), row);
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/import-vocab-exams.js [options]

Options:
  --api-base <url>           API base URL (default: ${DEFAULT_API_BASE})
  --levels <list>            Howdy levels to import, e.g. 1-8 or 2,4,6
  --units <list>             Units to import, e.g. 1-8 or 2,5
  --teacher-passcode <code>  Teacher passcode for protected APIs
  --overwrite-existing       Update exams with the same title
  --dry-run                  Scan VOCs and print what would be imported
`);
    return;
  }

  const apiBase = normalizeApiBase(args.apiBase);
  const blankMap = await collectBlankMap();
  const scanMap = await collectScanMap();
  const matchedKeys = [...blankMap.keys()].filter(key => scanMap.has(key)).sort((left, right) => {
    const [leftLevel, leftUnit] = left.split('-').map(Number);
    const [rightLevel, rightUnit] = right.split('-').map(Number);
    if (leftLevel !== rightLevel) return leftLevel - rightLevel;
    return leftUnit - rightUnit;
  });

  let existing = new Map();
  let teacherCookie = '';
  if (!args.dryRun) {
    teacherCookie = await ensureTeacherCookie(apiBase, String(args.teacherPasscode || '').trim());
    existing = await fetchExistingExams(apiBase, teacherCookie);
  }

  let imported = 0;
  let updated = 0;
  let skippedExisting = 0;
  let skippedFiltered = 0;
  let failed = 0;

  for (const key of matchedKeys) {
    const [level, unit] = key.split('-').map(Number);
    if (args.levels && !args.levels.includes(level)) {
      skippedFiltered += 1;
      continue;
    }
    if (args.units && !args.units.includes(unit)) {
      skippedFiltered += 1;
      continue;
    }

    const title = buildTitle(level, unit);
    const existingExam = existing.get(title.toLowerCase());
    const blankPath = blankMap.get(key);
    const scanPath = scanMap.get(key);

    if (existingExam && !args.overwriteExisting) {
      skippedExisting += 1;
      console.log(`[skip] ${title} already exists`);
      continue;
    }

    try {
      if (args.dryRun) {
        console.log(`[dry-run] ${title}`);
        console.log(`  blank: ${path.relative(ROOT, blankPath)}`);
        console.log(`  answer: ${path.relative(ROOT, scanPath)}`);
        continue;
      }

      const [blankImage, answerKeyImage] = await Promise.all([
        imageFileToBase64(blankPath),
        imageFileToBase64(scanPath)
      ]);

      const payload = {
        source_type: 'custom',
        title,
        pass_score: 80,
        status: 'draft',
        pages: [
          {
            page_number: 1,
            blank_image: blankImage,
            answer_key_image: answerKeyImage
          }
        ],
        questions: []
      };

      if (existingExam) {
        await fetchJson(`${apiBase}/api/vocab/exams/${existingExam.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(teacherCookie ? { Cookie: teacherCookie } : {})
          },
          body: JSON.stringify(payload)
        });
        updated += 1;
        console.log(`[updated] ${title}`);
      } else {
        await fetchJson(`${apiBase}/api/vocab/exams`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(teacherCookie ? { Cookie: teacherCookie } : {})
          },
          body: JSON.stringify(payload)
        });
        imported += 1;
        console.log(`[imported] ${title}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`[failed] ${title}: ${error.message}`);
    }
  }

  const blankOnly = [...blankMap.keys()].filter(key => !scanMap.has(key)).sort();
  const scanOnly = [...scanMap.keys()].filter(key => !blankMap.has(key)).sort();

  console.log('');
  console.log(`Matched pairs: ${matchedKeys.length}`);
  console.log(`Imported: ${imported}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped existing: ${skippedExisting}`);
  console.log(`Skipped by filter: ${skippedFiltered}`);
  console.log(`Failed: ${failed}`);
  console.log(`Blank-only keys: ${blankOnly.length}`);
  console.log(`Scan-only keys: ${scanOnly.length}`);

  if (blankOnly.length) {
    console.log(`Blank-only sample: ${blankOnly.slice(0, 10).join(', ')}`);
  }
  if (scanOnly.length) {
    console.log(`Scan-only sample: ${scanOnly.slice(0, 10).join(', ')}`);
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
