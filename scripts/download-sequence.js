#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

function printUsage() {
  console.log(`
Usage:
  node scripts/download-sequence.js \\
    --base-url "https://example.com/files/pageConfig" \\
    --template "HGR1_{n}.jpg" \\
    --start 1 \\
    --end 200 \\
    --out "downloads/howdy1/pageConfig"

Required:
  --base-url              Base URL without trailing filename
  --template              Filename template(s), e.g. "HGR1_{n}.jpg"

Optional:
  --start                 Start number (default: 1)
  --end                   End number, inclusive (default: 999)
  --out                   Output directory (default: downloads/sequence)
  --name-template         Output filename template, e.g. "H{level}_{book}_U{unit}-{page}_AK.jpg"
  --pages-per-unit        Pages per unit for {unit}/{page} tokens (example: 3)
  --level                 Value for {level} token
  --book                  Value for {book} token
  --stop-after-misses     Stop after this many consecutive misses (default: 10)
  --delay-ms              Delay between requests in ms (default: 150)
  --overwrite             Re-download existing files

Template syntax:
  {n}                     Raw number, e.g. 7
  {n:3}                   Zero-padded number, e.g. 007
  {seq}                   Sequence index within the requested range, starting at 1
  {unit}                  Computed unit number when --pages-per-unit is set
  {page}                  Computed page-in-unit when --pages-per-unit is set
  {level}                 Value from --level
  {book}                  Value from --book

Multiple templates:
  Separate by commas to try fallbacks in order.
  Example: "HGR2_{n}_1.jpg,HGR2_{n}.jpg,HGR2_{n}_2.jpg"

Examples:
  node scripts/download-sequence.js \\
    --base-url "https://e-learning.4kids.com.tw/Resource/Howdy2019/Howdy1_eflipping/files/pageConfig" \\
    --template "HGR1_{n}.jpg" \\
    --start 1 --end 200 \\
    --stop-after-misses 15 \\
    --out "downloads/howdy1/pageConfig"

  node scripts/download-sequence.js \\
    --base-url "https://e-learning.4kids.com.tw/Resource/Howdy2019/Howdy2_eflipping/files/pageConfig" \\
    --template "HGR2_{n}_1.jpg,HGR2_{n}.jpg,HGR2_{n}_2.jpg" \\
    --start 1 --end 24 \\
    --name-template "H{level}_{book}_U{unit}-{page}_AK.jpg" \\
    --pages-per-unit 3 \\
    --level 2 \\
    --book C \\
    --out "downloads/howdy2/wbc-answer"

  node scripts/download-sequence.js \\
    --base-url "https://example.com/assets" \\
    --template "page_{n:3}.png" \\
    --start 1 --end 500
`.trim());
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'overwrite' || key === 'help') {
      args[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i++;
  }
  return args;
}

function renderTemplate(template, values) {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)(?::(\d+))?\}/g, (match, key, width) => {
    const value = values[key];
    if (value == null) return match;
    const raw = String(value);
    return width ? raw.padStart(parseInt(width, 10), '0') : raw;
  });
}

function toInt(value, fallback) {
  if (value == null) return fallback;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Invalid integer: ${value}`);
  }
  return n;
}

function joinUrl(baseUrl, fileName) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${fileName}`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadBinary(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'automatic-english-assignment-grader/sequence-downloader'
    }
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const arrayBuffer = await response.arrayBuffer();
  return { ok: true, data: Buffer.from(arrayBuffer), status: response.status };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const baseUrl = args['base-url'];
  const templateArg = args.template;
  if (!baseUrl || !templateArg) {
    printUsage();
    throw new Error('Both --base-url and --template are required');
  }
  const templates = templateArg.split(',').map(s => s.trim()).filter(Boolean);
  if (templates.length === 0) {
    throw new Error('At least one template is required');
  }

  const start = toInt(args.start, 1);
  const end = toInt(args.end, 999);
  const stopAfterMisses = toInt(args['stop-after-misses'], 10);
  const delayMs = toInt(args['delay-ms'], 150);
  const outputDir = args.out || path.join('downloads', 'sequence');
  const nameTemplate = args['name-template'] || '';
  const pagesPerUnit = toInt(args['pages-per-unit'], 0);
  const level = args.level || '';
  const book = args.book || '';
  const overwrite = Boolean(args.overwrite);

  if (end < start) {
    throw new Error('--end must be greater than or equal to --start');
  }
  if (stopAfterMisses < 1) {
    throw new Error('--stop-after-misses must be at least 1');
  }

  await fs.mkdir(outputDir, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let misses = 0;
  let consecutiveMisses = 0;

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Template(s): ${templates.join(', ')}`);
  console.log(`Range: ${start}..${end}`);
  console.log(`Output: ${outputDir}`);
  if (nameTemplate) {
    console.log(`Name template: ${nameTemplate}`);
  }
  console.log(`Stop after ${stopAfterMisses} consecutive misses`);

  for (let n = start; n <= end; n++) {
    const seq = n - start + 1;
    const unit = pagesPerUnit > 0 ? Math.ceil(seq / pagesPerUnit) : '';
    const page = pagesPerUnit > 0 ? ((seq - 1) % pagesPerUnit) + 1 : '';
    const values = { n, seq, unit, page, level, book };
    const fileNames = templates.map(template => renderTemplate(template, values));
    const outputFileName = nameTemplate ? renderTemplate(nameTemplate, values) : null;

    if (!overwrite) {
      if (outputFileName) {
        if (await exists(path.join(outputDir, outputFileName))) {
          skipped++;
          consecutiveMisses = 0;
          console.log(`[skip] ${outputFileName} already exists`);
          continue;
        }
      } else {
        let existingFile = null;
        for (const fileName of fileNames) {
          if (await exists(path.join(outputDir, fileName))) {
            existingFile = fileName;
            break;
          }
        }
        if (existingFile) {
          skipped++;
          consecutiveMisses = 0;
          console.log(`[skip] ${existingFile} already exists`);
          continue;
        }
      }
    }

    let successFileName = null;
    let successData = null;
    let lastStatus = null;
    let hadError = false;

    for (const fileName of fileNames) {
      const url = joinUrl(baseUrl, fileName);
      try {
        const result = await downloadBinary(url);
        if (result.ok) {
          successFileName = fileName;
          successData = result.data;
          break;
        }
        lastStatus = result.status;
      } catch (err) {
        hadError = true;
        console.error(`[error] ${fileName} request failed: ${err.message}`);
      }
    }

    if (!successFileName || !successData) {
      misses++;
      consecutiveMisses++;
      if (!hadError) {
        console.log(`[miss] ${n} -> HTTP ${lastStatus} (${fileNames.join(' | ')})`);
      }
      if (consecutiveMisses >= stopAfterMisses) {
        console.log(`Stopping after ${consecutiveMisses} consecutive misses${hadError ? '/errors' : ''}.`);
        break;
      }
      await sleep(delayMs);
      continue;
    }

    const savedFileName = outputFileName || successFileName;
    const outputPath = path.join(outputDir, savedFileName);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, successData);
    downloaded++;
    consecutiveMisses = 0;
    if (savedFileName === successFileName) {
      console.log(`[ok] ${successFileName}`);
    } else {
      console.log(`[ok] ${successFileName} -> ${savedFileName}`);
    }
    await sleep(delayMs);
  }

  console.log('');
  console.log('Done.');
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Misses: ${misses}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
