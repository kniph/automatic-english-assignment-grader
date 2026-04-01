#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const VOC_ROOT = path.join(ROOT, 'VOCs');
const BLANK_ROOT = path.join(VOC_ROOT, '空白卷');
const SCAN_ROOT = path.join(VOC_ROOT, '掃描檔');
const BANK_PATH = path.join(ROOT, 'data', 'vocab-prompts', 'howdy-1-8-answer-bank.json');
const REVIEW_OVERRIDES_PATH = path.join(ROOT, 'data', 'vocab-prompts', 'manual-review-overrides.json');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'data', 'vocab-review');
const TESSERACT_BIN = process.env.TESSERACT_BIN || 'tesseract';

function parseArgs(argv) {
  const args = {
    levels: null,
    units: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    overridesPath: REVIEW_OVERRIDES_PATH
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--levels') args.levels = parseNumberList(argv[index + 1], 1, 10);
    else if (arg === '--units') args.units = parseNumberList(argv[index + 1], 1, 10);
    else if (arg === '--output-dir') args.outputDir = path.resolve(argv[index + 1]);
    else if (arg === '--overrides') args.overridesPath = path.resolve(argv[index + 1]);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);

    if (arg !== '--help' && arg !== '-h') index += 1;
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
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`Invalid range: ${trimmed}`);
      }
      for (let n = Math.min(start, end); n <= Math.max(start, end); n += 1) {
        if (n < min || n > max) throw new Error(`Number out of range: ${n}`);
        numbers.add(n);
      }
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid number: ${trimmed}`);
      numbers.add(n);
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/["\n,]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function normalizeApiText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[/,.-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);

  for (let index = 0; index <= right.length; index += 1) {
    previous[index] = index;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let col = 1; col <= right.length; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      current[col] = Math.min(
        current[col - 1] + 1,
        previous[col] + 1,
        previous[col - 1] + cost
      );
    }

    for (let col = 0; col <= right.length; col += 1) {
      previous[col] = current[col];
    }
  }

  return previous[right.length];
}

function similarity(left, right) {
  const a = normalizeApiText(left);
  const b = normalizeApiText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const distance = levenshtein(a, b);
  const base = 1 - (distance / Math.max(a.length, b.length));
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) {
    return Math.max(base, 0.9);
  }

  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  const overlap = [...aTokens].filter(token => bTokens.has(token)).length;
  return Math.max(base, overlap / Math.max(aTokens.size, bTokens.size, 1));
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

function isImageFile(name) {
  return /\.(jpg|jpeg|png)$/i.test(name);
}

async function listDirFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
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
    if (!entry.isDirectory() || !/^NH\d+$/i.test(entry.name)) continue;
    const dirPath = path.join(BLANK_ROOT, entry.name);
    const files = await listDirFiles(dirPath);
    for (const file of files) {
      if (!isImageFile(file)) continue;
      const parsed = parseHowdyUnitFromName(file);
      if (!parsed) continue;
      map.set(`${parsed.level}-${parsed.unit}`, path.join(dirPath, file));
    }
  }

  return map;
}

async function collectScanMap() {
  const levelDirs = await fs.readdir(SCAN_ROOT, { withFileTypes: true });
  const map = new Map();

  for (const entry of levelDirs) {
    if (!entry.isDirectory() || !/^H\d+$/i.test(entry.name)) continue;
    const dirPath = path.join(SCAN_ROOT, entry.name);
    const files = await listDirFiles(dirPath);
    for (const file of files) {
      if (!isImageFile(file) || /_Conflict/i.test(file)) continue;
      const parsed = parseHowdyUnitFromName(file);
      if (!parsed) continue;
      map.set(`${parsed.level}-${parsed.unit}`, path.join(dirPath, file));
    }
  }

  return map;
}

async function buildBlankTemplatePNG(blankPath) {
  return sharp(blankPath)
    .flatten({ background: '#ffffff' })
    .resize({ width: 2000, withoutEnlargement: true })
    .png()
    .toBuffer();
}

async function buildAlignedAnswerPNG(scanPath, blankPngBuffer) {
  const blankMeta = await sharp(blankPngBuffer).metadata();
  const blankRaw = await sharp(blankPngBuffer).greyscale().raw().toBuffer({ resolveWithObject: true });

  let best = null;
  for (const angle of [0, 90, 180, 270]) {
    const candidate = await sharp(scanPath)
      .flatten({ background: '#ffffff' })
      .rotate(angle)
      .resize({
        width: blankMeta.width,
        height: blankMeta.height,
        fit: 'fill'
      })
      .png()
      .toBuffer();

    const answerRaw = await sharp(candidate).greyscale().raw().toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let index = 0; index < blankRaw.data.length; index += 4) {
      sum += Math.abs(blankRaw.data[index] - answerRaw.data[index]);
    }
    if (!best || sum < best.sum) {
      best = { sum, buffer: candidate };
    }
  }

  return best.buffer;
}

function isGreenAnswerPixel(red, green, blue) {
  return green >= 70 && green >= red + 18 && green >= blue + 8;
}

function isBlueAnswerPixel(red, green, blue) {
  return blue >= 70 && blue >= red + 18 && blue >= green + 6;
}

async function buildAnswerWordMask(blankPngBuffer, answerPngBuffer, level) {
  const blankRaw = await sharp(blankPngBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const answerRaw = await sharp(answerPngBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = blankRaw.info.width;
  const height = blankRaw.info.height;
  const mask = new Uint8Array(width * height);
  const marginX = Math.round(width * 0.05);
  const marginTop = Math.round(height * 0.08);
  const marginBottom = Math.round(height * 0.04);

  for (let y = marginTop; y < height - marginBottom; y += 1) {
    for (let x = marginX; x < width - marginX; x += 1) {
      const pixelIndex = (y * width + x) * 3;
      const detector = level <= 4 ? isGreenAnswerPixel : isBlueAnswerPixel;
      const blankIsGreen = detector(
        blankRaw.data[pixelIndex],
        blankRaw.data[pixelIndex + 1],
        blankRaw.data[pixelIndex + 2]
      );
      const answerIsGreen = detector(
        answerRaw.data[pixelIndex],
        answerRaw.data[pixelIndex + 1],
        answerRaw.data[pixelIndex + 2]
      );

      if (answerIsGreen && !blankIsGreen) {
        mask[y * width + x] = 1;
      }
    }
  }

  return { mask, width, height };
}

function findConnectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  const neighbors = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;

    const queue = [start];
    visited[start] = 1;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;

    while (queue.length) {
      const index = queue.pop();
      const x = index % width;
      const y = Math.floor(index / width);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      area += 1;

      const onLeftEdge = x === 0;
      const onRightEdge = x === width - 1;
      for (const delta of neighbors) {
        if ((delta === -width - 1 || delta === -1 || delta === width - 1) && onLeftEdge) continue;
        if ((delta === -width + 1 || delta === 1 || delta === width + 1) && onRightEdge) continue;
        const next = index + delta;
        if (next < 0 || next >= mask.length) continue;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    components.push({
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      area
    });
  }

  return components;
}

function mergeBoxes(boxes, pageWidth, pageHeight) {
  const prepared = boxes
    .map(box => ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      cx: box.left + box.width / 2,
      cy: box.top + box.height / 2,
      column: box.left + box.width / 2 < pageWidth / 2 ? 'left' : 'right'
    }))
    .sort((left, right) => {
      if (left.column !== right.column) return left.column.localeCompare(right.column);
      return left.top - right.top || left.left - right.left;
    });

  const merged = [];
  for (const box of prepared) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.column === box.column &&
      Math.abs(previous.cy - box.cy) <= 80 &&
      box.left - previous.right <= 120 &&
      Math.min(previous.bottom, box.bottom) - Math.max(previous.top, box.top) >= -20
    ) {
      previous.left = Math.min(previous.left, box.left);
      previous.top = Math.min(previous.top, box.top);
      previous.right = Math.max(previous.right, box.right);
      previous.bottom = Math.max(previous.bottom, box.bottom);
      previous.width = previous.right - previous.left;
      previous.height = previous.bottom - previous.top;
      previous.area += box.area;
      previous.cx = previous.left + previous.width / 2;
      previous.cy = previous.top + previous.height / 2;
      continue;
    }
    merged.push({ ...box });
  }

  return merged
    .filter(box => box.area >= 180)
    .filter(box => box.width >= 18 && box.height >= 18)
    .filter(box => box.width <= pageWidth * 0.35)
    .filter(box => box.height <= pageHeight * 0.08)
    .map(box => ({
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      area: box.area,
      column: box.column,
      cx: box.cx,
      cy: box.cy
    }));
}

function expandBox(box, pageWidth, pageHeight) {
  const paddingX = Math.max(18, Math.round(box.width * 0.35));
  const paddingY = Math.max(10, Math.round(box.height * 0.28));
  const left = Math.max(0, box.left - paddingX);
  const top = Math.max(0, box.top - paddingY);
  const right = Math.min(pageWidth, box.left + box.width + paddingX);
  const bottom = Math.min(pageHeight, box.top + box.height + paddingY);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

async function writeCrop(buffer, box, outputPath) {
  await sharp(buffer)
    .extract({
      left: box.x ?? box.left,
      top: box.y ?? box.top,
      width: box.width,
      height: box.height
    })
    .png()
    .toFile(outputPath);
}

function ocrTextFromFile(filePath, psm) {
  try {
    const text = execFileSync(TESSERACT_BIN, [
      filePath,
      'stdout',
      '--psm',
      String(psm),
      '-l',
      'eng'
    ], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024
    });
    return String(text || '').replace(/\s+/g, ' ').trim();
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Tesseract not found: ${TESSERACT_BIN}`);
    }
    return '';
  }
}

function expandAnswerVariants(answerText) {
  const variants = new Set();
  variants.add(answerText);
  const withoutParens = answerText.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (withoutParens) variants.add(withoutParens);
  for (const part of answerText.split('/')) {
    const trimmed = part.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (trimmed) variants.add(trimmed);
  }
  return [...variants];
}

function scoreCandidates(ocrText, bankRows) {
  return bankRows
    .map(row => {
      const variants = expandAnswerVariants(row.answer_text);
      const bestScore = Math.max(...variants.map(variant => similarity(ocrText, variant)));
      return {
        answer_text: row.answer_text,
        prompt_en: row.prompt_en,
        definition_zh: row.definition_zh,
        bestScore
      };
    })
    .sort((left, right) => right.bestScore - left.bestScore);
}

function loadBankByUnit(records) {
  const grouped = new Map();
  for (const row of records) {
    const key = `${row.howdy_level}-${row.unit}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

async function loadReviewOverrides(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Manual review overrides must be a JSON object keyed by "level-unit"');
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function buildCsv(rows) {
  const headers = [
    'howdy_level',
    'unit',
    'candidate_index',
    'column',
    'detected_text',
    'suggested_answer',
    'match_score',
    'left',
    'top',
    'width',
    'height',
    'prompt_en',
    'definition_zh',
    'crop_file'
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(header => csvEscape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function sortVisualOrder(rows) {
  return [...rows].sort((left, right) => {
    if (left.column !== right.column) return left.column.localeCompare(right.column);
    return left.top - right.top || left.left - right.left;
  });
}

function selectBestRows(rawRows) {
  const selectedByAnswer = new Map();
  const ordered = [...rawRows].sort((left, right) => {
    if (right.match_score !== left.match_score) return right.match_score - left.match_score;
    return normalizeApiText(right.detected_text).length - normalizeApiText(left.detected_text).length;
  });

  for (const row of ordered) {
    if (!row.suggested_answer) continue;
    if (selectedByAnswer.has(row.suggested_answer)) continue;
    if (row.match_score < 0.45) continue;
    selectedByAnswer.set(row.suggested_answer, row);
  }

  return sortVisualOrder([...selectedByAnswer.values()]);
}

function rowMatchesPatch(row, match = {}) {
  return Object.entries(match).every(([key, value]) => String(row[key]) === String(value));
}

function applyReviewOverrides(level, unit, rows, overridesByUnit) {
  const unitOverrides = overridesByUnit[`${level}-${unit}`];
  if (!unitOverrides) return rows;

  let output = rows.map(row => ({ ...row }));

  for (const patch of unitOverrides.patch_rows || []) {
    output = output.map(row => (
      rowMatchesPatch(row, patch.match)
        ? { ...row, ...patch.set }
        : row
    ));
  }

  for (const appended of unitOverrides.append_rows || []) {
    output.push({
      howdy_level: level,
      unit,
      ...appended
    });
  }

  return output;
}

async function loadExistingSummary(outputDir) {
  const summaryPath = path.join(outputDir, 'summary.json');
  try {
    const raw = await fs.readFile(summaryPath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function mergeSummaries(existing, updates) {
  const byKey = new Map();
  for (const entry of existing) {
    byKey.set(`${entry.howdy_level}-${entry.unit}`, entry);
  }
  for (const entry of updates) {
    byKey.set(`${entry.howdy_level}-${entry.unit}`, entry);
  }
  return [...byKey.values()].sort((left, right) => {
    if (left.howdy_level !== right.howdy_level) return left.howdy_level - right.howdy_level;
    return left.unit - right.unit;
  });
}

async function processUnit(level, unit, blankPath, scanPath, bankRows, outputDir, overridesByUnit) {
  const blankPngBuffer = await buildBlankTemplatePNG(blankPath);
  const answerPngBuffer = await buildAlignedAnswerPNG(scanPath, blankPngBuffer);
  const pageMeta = await sharp(blankPngBuffer).metadata();
  const { mask, width, height } = await buildAnswerWordMask(blankPngBuffer, answerPngBuffer, level);
  const components = findConnectedComponents(mask, width, height)
    .filter(box => box.area >= 60)
    .filter(box => box.width >= 8 && box.height >= 8);
  const merged = mergeBoxes(components, width, height);

  await fs.mkdir(outputDir, { recursive: true });

  const rows = [];
  for (let index = 0; index < merged.length; index += 1) {
    const box = merged[index];
    const answerBox = expandBox(box, pageMeta.width, pageMeta.height);
    const cropFile = `answer-${String(index + 1).padStart(2, '0')}.png`;
    const cropPath = path.join(outputDir, cropFile);
    await writeCrop(answerPngBuffer, answerBox, cropPath);

    const ocrCandidates = [8, 7, 13]
      .map(psm => ocrTextFromFile(cropPath, psm))
      .filter(Boolean);
    const scoredVariants = ocrCandidates.map(text => ({
      text,
      scored: scoreCandidates(text, bankRows)
    }));
    const bestVariant = scoredVariants.sort((left, right) => {
      const leftScore = left.scored[0]?.bestScore || 0;
      const rightScore = right.scored[0]?.bestScore || 0;
      return rightScore - leftScore;
    })[0] || { text: '', scored: [] };

    const detectedText = bestVariant.text;
    const scored = bestVariant.scored;
    const best = scored[0] || { answer_text: '', bestScore: 0, prompt_en: '', definition_zh: '' };

    rows.push({
      howdy_level: level,
      unit,
      candidate_index: index + 1,
      column: box.column,
      detected_text: detectedText,
      suggested_answer: best.answer_text,
      match_score: Number(best.bestScore || 0),
      left: answerBox.x,
      top: answerBox.y,
      width: answerBox.width,
      height: answerBox.height,
      prompt_en: best.prompt_en,
      definition_zh: best.definition_zh,
      crop_file: cropFile
    });
  }

  const overriddenRows = applyReviewOverrides(level, unit, rows, overridesByUnit);
  const selectedRows = selectBestRows(overriddenRows);

  await fs.writeFile(path.join(outputDir, 'review-raw.csv'), buildCsv(sortVisualOrder(overriddenRows)));
  await fs.writeFile(path.join(outputDir, 'review.csv'), buildCsv(selectedRows));
  await fs.writeFile(path.join(outputDir, 'review.json'), `${JSON.stringify({
    howdy_level: level,
    unit,
    expected_count: bankRows.length,
    raw_detected_count: overriddenRows.length,
    detected_count: selectedRows.length,
    blank_image: path.relative(ROOT, blankPath),
    answer_image: path.relative(ROOT, scanPath),
    rows: selectedRows
  }, null, 2)}\n`);

  return {
    howdy_level: level,
    unit,
    expected_count: bankRows.length,
    detected_count: selectedRows.length,
    outputDir: path.relative(ROOT, outputDir)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/extract-vocab-review.js [options]

Options:
  --levels <list>        Howdy levels to process
  --units <list>         Units to process
  --output-dir <dir>     Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --overrides <path>     Manual review overrides JSON (default: ${REVIEW_OVERRIDES_PATH})
`);
    return;
  }

  const bankRows = JSON.parse(await fs.readFile(BANK_PATH, 'utf8'));
  const bankByUnit = loadBankByUnit(bankRows);
  const reviewOverrides = await loadReviewOverrides(args.overridesPath);
  const blankMap = await collectBlankMap();
  const scanMap = await collectScanMap();
  const matchedKeys = [...blankMap.keys()].filter(key => scanMap.has(key)).sort((left, right) => {
    const [leftLevel, leftUnit] = left.split('-').map(Number);
    const [rightLevel, rightUnit] = right.split('-').map(Number);
    if (leftLevel !== rightLevel) return leftLevel - rightLevel;
    return leftUnit - rightUnit;
  });

  const summaries = [];
  for (const key of matchedKeys) {
    const [level, unit] = key.split('-').map(Number);
    if (args.levels && !args.levels.includes(level)) continue;
    if (args.units && !args.units.includes(unit)) continue;

    const unitRows = bankByUnit.get(key);
    if (!unitRows?.length) continue;

    const outputDir = path.join(args.outputDir, `howdy-${level}-unit-${unit}`);
    const summary = await processUnit(level, unit, blankMap.get(key), scanMap.get(key), unitRows, outputDir, reviewOverrides);
    summaries.push(summary);
    console.log(`Howdy ${level} Unit ${unit}: detected ${summary.detected_count}/${summary.expected_count} -> ${summary.outputDir}`);
  }

  await fs.mkdir(args.outputDir, { recursive: true });
  const mergedSummary = mergeSummaries(await loadExistingSummary(args.outputDir), summaries);
  await fs.writeFile(path.join(args.outputDir, 'summary.json'), `${JSON.stringify(mergedSummary, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
