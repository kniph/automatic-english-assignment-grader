#!/usr/bin/env node

/**
 * Version Update Script
 *
 * Updates version numbers across all files in your project automatically.
 *
 * Usage:
 *   npm run version:update
 *   (Reads from VERSION file and updates all configured files)
 */

const fs = require('fs');
const path = require('path');

console.log('\n🔍 Checking version consistency...\n');

// Read source of truth
const versionFile = path.join(__dirname, '..', 'VERSION');
let sourceVersion;

try {
  sourceVersion = fs.readFileSync(versionFile, 'utf8').trim();
  console.log(`📌 Source Version (VERSION file): v${sourceVersion}\n`);
} catch (error) {
  console.error('❌ Error: VERSION file not found or unreadable');
  console.error('   Create a VERSION file with your version number (e.g., "1.0.0")');
  process.exit(1);
}

// Validate version format
if (!/^\d+\.\d+\.\d+$/.test(sourceVersion)) {
  console.error('❌ Error: Invalid version format in VERSION file');
  console.error('   Use semantic versioning format: MAJOR.MINOR.PATCH (e.g., "1.0.0")');
  process.exit(1);
}

// =========================================
// CUSTOMIZE THIS SECTION FOR YOUR PROJECT
// =========================================

const filesToUpdate = [
  // Example: Update package.json
  {
    path: 'package.json',
    pattern: /"version":\s*"[\d.]+"/,
    replacement: `"version": "${sourceVersion}"`,
    description: 'package.json version field'
  },

  // Example: Update HTML files with version badges
  // {
  //   path: 'public/index.html',
  //   pattern: /Version v[\d.]+/g,
  //   replacement: `Version v${sourceVersion}`,
  //   description: 'index.html version badge'
  // },

  // Example: Update README.md
  // {
  //   path: 'README.md',
  //   pattern: /Version: \*\*[\d.]+\*\*/,
  //   replacement: `Version: **${sourceVersion}**`,
  //   description: 'README version badge'
  // },

  // Add more files as needed for your project
];

// =========================================
// END CUSTOMIZATION SECTION
// =========================================

let updatedCount = 0;
let skippedCount = 0;
let errors = [];

console.log('📝 Updating files:\n');

filesToUpdate.forEach(file => {
  const filePath = path.join(__dirname, '..', file.path);

  try {
    if (!fs.existsSync(filePath)) {
      errors.push(`File not found: ${file.path}`);
      console.log(`⚠️  ${file.description}: File not found`);
      return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;

    // Apply replacement
    if (file.pattern) {
      content = content.replace(file.pattern, file.replacement);
    }

    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ ${file.description}: Updated`);
      updatedCount++;
    } else {
      console.log(`⏭️  ${file.description}: No changes needed`);
      skippedCount++;
    }
  } catch (error) {
    errors.push(`${file.path}: ${error.message}`);
    console.log(`❌ ${file.description}: Error - ${error.message}`);
  }
});

// Summary
console.log(`\n📊 Summary:`);
console.log(`   Updated: ${updatedCount} files`);
console.log(`   Skipped: ${skippedCount} files`);
console.log(`   Errors: ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n⚠️  Errors:`);
  errors.forEach(err => console.log(`   - ${err}`));
}

if (updatedCount > 0) {
  console.log(`\n✨ Version update complete!`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Review changes: git diff`);
  console.log(`   2. Update CHANGELOG.md with release notes`);
  console.log(`   3. Commit: git add . && git commit -m "chore: bump version to v${sourceVersion}"`);
  console.log(`   4. Tag: git tag v${sourceVersion}`);
  console.log(`   5. Push: git push && git push --tags\n`);
} else {
  console.log(`\n✅ Version check passed!\n`);
}

process.exit(errors.length > 0 ? 1 : 0);
