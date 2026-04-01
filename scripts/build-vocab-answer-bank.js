#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INPUT_DIR = path.join(ROOT, 'VOCs', 'CSVs');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'data', 'vocab-prompts');
const DEFAULT_OVERRIDES_PATH = path.join(DEFAULT_OUTPUT_DIR, 'manual-answer-overrides.json');
const DEFAULT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8];

function parseArgs(argv) {
  const args = {
    inputDir: DEFAULT_INPUT_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    overridesPath: DEFAULT_OVERRIDES_PATH,
    levels: DEFAULT_LEVELS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input-dir') args.inputDir = path.resolve(argv[index + 1]);
    else if (arg === '--output-dir') args.outputDir = path.resolve(argv[index + 1]);
    else if (arg === '--overrides') args.overridesPath = path.resolve(argv[index + 1]);
    else if (arg === '--levels') args.levels = parseNumberList(argv[index + 1], 1, 10);
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
      for (let number = Math.min(start, end); number <= Math.max(start, end); number += 1) {
        if (number < min || number > max) throw new Error(`Number out of range: ${number}`);
        numbers.add(number);
      }
    } else {
      const number = Number(trimmed);
      if (!Number.isInteger(number) || number < min || number > max) {
        throw new Error(`Invalid number: ${trimmed}`);
      }
      numbers.add(number);
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/["\n,]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header = [], ...dataRows] = rows;
  return dataRows
    .filter(cells => cells.some(cell => normalizeWhitespace(cell)))
    .map(cells => Object.fromEntries(header.map((key, index) => [normalizeWhitespace(key), cells[index] ?? ''])));
}

function normalizeWord(value) {
  return normalizeWhitespace(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’`]/g, "'");
}

function parseLevelLabel(levelLabel) {
  const match = normalizeWhitespace(levelLabel).match(/^Howdy\s+(\d+)\s+Unit\s+(\d+)$/i);
  if (!match) return null;
  return {
    howdy_level: Number(match[1]),
    unit: Number(match[2])
  };
}

function buildRecord(sourceFile, row) {
  const parsedLevel = parseLevelLabel(row.level);
  if (!parsedLevel) return null;

  const sequence = Number(String(row.sequence || '').trim());
  return {
    source_file: sourceFile,
    howdy_level: parsedLevel.howdy_level,
    unit: parsedLevel.unit,
    answer_text: normalizeWord(row.word),
    definition_zh: normalizeWhitespace(row.definition),
    prompt_en: normalizeWhitespace(row.sentence),
    level_label: normalizeWhitespace(row.level),
    sequence_in_source: Number.isFinite(sequence) ? sequence : null
  };
}

async function loadCsvRecords(filePath) {
  const sourceFile = path.basename(filePath);
  const text = await fs.readFile(filePath, 'utf8');
  return parseCsv(text)
    .map(row => buildRecord(sourceFile, row))
    .filter(Boolean);
}

async function loadManualOverrides(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      throw new Error('Manual answer overrides must be a JSON array');
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function groupByUnit(records) {
  const grouped = new Map();
  for (const record of records) {
    const key = `${record.howdy_level}-${record.unit}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }
  return grouped;
}

function addIssue(issueCounts, message) {
  issueCounts.set(message, (issueCounts.get(message) || 0) + 1);
}

function formatIssues(issueCounts) {
  return [...issueCounts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([message, count]) => (count > 1 ? `${message} (${count} rows)` : message));
}

function validateUnitRecords(level, fileRecords, issueCounts) {
  const exactRecords = fileRecords.filter(record => record.howdy_level === level);
  for (const record of fileRecords) {
    if (record.howdy_level !== level) {
      addIssue(issueCounts, `${record.source_file}: contains ${record.level_label} while processing Howdy ${level}`);
    }
  }
  return exactRecords;
}

function recordMatchesOverride(record, override) {
  const matchSpec = override.match || override;
  const matchKeys = ['source_file', 'howdy_level', 'unit', 'sequence_in_source', 'answer_text'];
  return matchKeys.every(key => {
    if (matchSpec[key] === undefined || matchSpec[key] === null || matchSpec[key] === '') return true;
    if (key === 'answer_text') {
      return normalizeWord(record[key]) === normalizeWord(matchSpec[key]);
    }
    return String(record[key]) === String(matchSpec[key]);
  });
}

function overrideRelevantToRecords(override, records) {
  const matchSpec = override.match || override;
  return records.some(record => ['source_file', 'howdy_level', 'unit'].every(key => {
    if (matchSpec[key] === undefined || matchSpec[key] === null || matchSpec[key] === '') return true;
    return String(record[key]) === String(matchSpec[key]);
  }));
}

function applyManualOverrides(records, overrides, issueCounts) {
  if (!overrides.length) return records;

  const usageCounts = new Array(overrides.length).fill(0);
  const output = [];

  for (const record of records) {
    const matches = overrides
      .map((override, index) => ({ override, index }))
      .filter(entry => recordMatchesOverride(record, entry.override));

    if (matches.length > 1) {
      addIssue(issueCounts, `Multiple manual answer overrides matched Howdy ${record.howdy_level} Unit ${record.unit} sequence ${record.sequence_in_source}`);
    }

    const matched = matches[0] || null;
    if (!matched) {
      output.push(record);
      continue;
    }

    usageCounts[matched.index] += 1;
    const action = String(matched.override.action || 'replace').trim().toLowerCase();
    const setSpec = matched.override.set || matched.override;

    if (action === 'remove') {
      continue;
    }

    if (action !== 'replace') {
      addIssue(issueCounts, `Unknown manual answer override action: ${matched.override.action}`);
      output.push(record);
      continue;
    }

    output.push({
      ...record,
      ...(setSpec.answer_text !== undefined ? { answer_text: normalizeWord(setSpec.answer_text) } : {}),
      ...(setSpec.definition_zh !== undefined ? { definition_zh: normalizeWhitespace(setSpec.definition_zh) } : {}),
      ...(setSpec.prompt_en !== undefined ? { prompt_en: normalizeWhitespace(setSpec.prompt_en) } : {})
    });
  }

  overrides.forEach((override, index) => {
    if (usageCounts[index] === 0 && overrideRelevantToRecords(override, records)) {
      addIssue(issueCounts, `Unused manual answer override: ${JSON.stringify(override)}`);
    }
  });

  return output;
}

function sortUnitRecords(records) {
  return [...records].sort((left, right) => {
    if (left.howdy_level !== right.howdy_level) return left.howdy_level - right.howdy_level;
    if (left.unit !== right.unit) return left.unit - right.unit;
    return (left.sequence_in_source || 0) - (right.sequence_in_source || 0);
  });
}

function buildOutputRecords(records, issueCounts) {
  const grouped = groupByUnit(records);
  const output = [];

  for (const key of [...grouped.keys()].sort((left, right) => {
    const [leftLevel, leftUnit] = left.split('-').map(Number);
    const [rightLevel, rightUnit] = right.split('-').map(Number);
    if (leftLevel !== rightLevel) return leftLevel - rightLevel;
    return leftUnit - rightUnit;
  })) {
    const unitRecords = sortUnitRecords(grouped.get(key));
    const seenAnswers = new Set();

    unitRecords.forEach((record, index) => {
      const normalizedAnswer = record.answer_text.toLowerCase();
      if (seenAnswers.has(normalizedAnswer)) {
        addIssue(issueCounts, `Duplicate answer in Howdy ${record.howdy_level} Unit ${record.unit}: ${record.answer_text}`);
      }
      seenAnswers.add(normalizedAnswer);

      output.push({
        ...record,
        unit_item_order: index + 1
      });
    });
  }

  return output;
}

function buildCsv(records) {
  const headers = [
    'source_file',
    'howdy_level',
    'unit',
    'unit_item_order',
    'sequence_in_source',
    'answer_text',
    'definition_zh',
    'prompt_en'
  ];

  const lines = [headers.join(',')];
  for (const record of records) {
    lines.push(headers.map(header => csvEscape(record[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/build-vocab-answer-bank.js [options]

Options:
  --input-dir <dir>    CSV source directory (default: ${DEFAULT_INPUT_DIR})
  --output-dir <dir>   Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --overrides <path>   Manual answer overrides JSON (default: ${DEFAULT_OVERRIDES_PATH})
  --levels <list>      Howdy levels to include (default: ${DEFAULT_LEVELS.join(',')})
`);
    return;
  }

  const issueCounts = new Map();
  const collected = [];
  const overrides = await loadManualOverrides(args.overridesPath);

  for (const level of args.levels) {
    const filePath = path.join(args.inputDir, `howdy_${level}_all_units.csv`);
    const fileRecords = await loadCsvRecords(filePath);
    const exactRecords = validateUnitRecords(level, fileRecords, issueCounts);
    collected.push(...applyManualOverrides(exactRecords, overrides, issueCounts));
  }

  const outputRecords = buildOutputRecords(collected, issueCounts);
  const issues = formatIssues(issueCounts);
  await fs.mkdir(args.outputDir, { recursive: true });

  const jsonPath = path.join(args.outputDir, 'howdy-1-8-answer-bank.json');
  const csvPath = path.join(args.outputDir, 'howdy-1-8-answer-bank.csv');
  const issuesPath = path.join(args.outputDir, 'howdy-1-8-answer-bank-issues.txt');

  await fs.writeFile(jsonPath, `${JSON.stringify(outputRecords, null, 2)}\n`);
  await fs.writeFile(csvPath, buildCsv(outputRecords));
  await fs.writeFile(issuesPath, `${issues.join('\n')}\n`);

  const unitCount = new Set(outputRecords.map(record => `${record.howdy_level}-${record.unit}`)).size;
  console.log(`Built ${outputRecords.length} records across ${unitCount} units`);
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`CSV: ${path.relative(ROOT, csvPath)}`);
  console.log(`Issues: ${issues.length}`);
  if (issues.length) {
    console.log(`Issues file: ${path.relative(ROOT, issuesPath)}`);
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
