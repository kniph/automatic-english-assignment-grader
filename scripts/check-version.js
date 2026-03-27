#!/usr/bin/env node

/**
 * Version Check Script
 *
 * Verifies that all version references across the codebase are consistent.
 * Useful to run before committing to catch forgotten version updates.
 *
 * Usage:
 *   npm run version:check
 */

const fs = require('fs');
const path = require('path');

console.log('\n🔍 Checking version consistency across codebase...\n');

// Read source of truth
const versionFile = path.join(__dirname, '..', 'VERSION');
let sourceVersion;

try {
  sourceVersion = fs.readFileSync(versionFile, 'utf8').trim();
  console.log(`📌 Source Version (VERSION file): v${sourceVersion}\n`);
} catch (error) {
  console.error('❌ Error: VERSION file not found or unreadable');
  process.exit(1);
}

// =========================================
// CUSTOMIZE THIS SECTION FOR YOUR PROJECT
// =========================================

const filesToCheck = [
  // Example: Check package.json
  {
    name: 'package.json',
    path: 'package.json',
    extract: (content) => {
      const match = content.match(/"version":\s*"([\d.]+)"/);
      return match ? match[1] : null;
    }
  },

  // Example: Check HTML files
  // {
  //   name: 'index.html',
  //   path: 'public/index.html',
  //   extract: (content) => {
  //     const match = content.match(/Version v([\d.]+)/);
  //     return match ? match[1] : null;
  //   }
  // },

  // Example: Check README.md
  // {
  //   name: 'README.md',
  //   path: 'README.md',
  //   extract: (content) => {
  //     const match = content.match(/Version: \*\*([\d.]+)\*\*/);
  //     return match ? match[1] : null;
  //   }
  // },

  // Add more files as needed for your project
];

// =========================================
// END CUSTOMIZATION SECTION
// =========================================

let inconsistencies = [];
let checked = 0;

console.log('📋 Checking files:\n');

filesToCheck.forEach(file => {
  const filePath = path.join(__dirname, '..', file.path);

  try {
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  ${file.name}: File not found`);
      return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const version = file.extract(content);

    if (!version) {
      console.log(`⚠️  ${file.name}: Version not found`);
      inconsistencies.push(`${file.name}: Version pattern not found in file`);
      return;
    }

    if (version !== sourceVersion) {
      console.log(`❌ ${file.name}: v${version} (expected v${sourceVersion})`);
      inconsistencies.push(`${file.name}: v${version} ≠ v${sourceVersion}`);
    } else {
      console.log(`✅ ${file.name}: v${version}`);
    }

    checked++;
  } catch (error) {
    console.log(`❌ ${file.name}: Error - ${error.message}`);
    inconsistencies.push(`${file.name}: ${error.message}`);
  }
});

console.log(`\n📊 Summary:`);
console.log(`   Files checked: ${checked}`);
console.log(`   Inconsistencies: ${inconsistencies.length}`);

if (inconsistencies.length > 0) {
  console.log(`\n⚠️  Version inconsistencies detected:`);
  inconsistencies.forEach(issue => console.log(`   - ${issue}`));
  console.log(`\n💡 Fix inconsistencies:`);
  console.log(`   1. Update VERSION file with correct version`);
  console.log(`   2. Run: npm run version:update`);
  console.log('');
  process.exit(1);
} else {
  console.log(`\n✅ All version numbers are consistent!\n`);
  process.exit(0);
}
