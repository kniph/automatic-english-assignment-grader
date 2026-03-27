# Version Management Guide

This project uses semantic versioning with automated consistency checks.

## Version Number Format

**MAJOR.MINOR.PATCH** (e.g., `1.2.3`)

- **MAJOR**: Incompatible API changes (breaking changes)
- **MINOR**: New functionality (backwards-compatible)
- **PATCH**: Bug fixes (backwards-compatible)

## Version Storage

The version number is stored in multiple locations:
- `VERSION` file (source of truth)
- `package.json`
- Frontend HTML files (if applicable)

## Updating Version

### Manual Update

1. Edit the `VERSION` file with the new version number
2. Run the update script:
   ```bash
   npm run version:update
   ```
3. The script will automatically update all version references

### What Gets Updated

The update script synchronizes version across:
- `package.json` → `version` field
- `package-lock.json` → `version` field
- Frontend files → version badges/displays (if configured)

## Version Check (Pre-Commit Hook)

A pre-commit hook automatically runs `npm run version:check` before each commit to ensure version consistency across all files.

If versions are inconsistent:
1. Run `npm run version:check` to see which files are out of sync
2. Run `npm run version:update` to fix inconsistencies
3. Re-stage and commit

## Best Practices

1. **Update version before release**: Bump version when preparing a release
2. **Update CHANGELOG.md**: Document changes for each version
3. **Tag releases**: Create git tags for version releases
   ```bash
   git tag -a v1.2.3 -m "Release version 1.2.3"
   git push origin v1.2.3
   ```

## Common Scenarios

### Bug Fix Release
```bash
# VERSION: 1.2.3 → 1.2.4
echo "1.2.4" > VERSION
npm run version:update
git add .
git commit -m "fix: resolve critical bug"
git tag -a v1.2.4 -m "Bug fix release"
```

### New Feature Release
```bash
# VERSION: 1.2.4 → 1.3.0
echo "1.3.0" > VERSION
npm run version:update
git add .
git commit -m "feat: add new feature"
git tag -a v1.3.0 -m "Feature release"
```

### Breaking Change Release
```bash
# VERSION: 1.3.0 → 2.0.0
echo "2.0.0" > VERSION
npm run version:update
git add .
git commit -m "feat!: breaking API changes"
git tag -a v2.0.0 -m "Major release with breaking changes"
```

## Troubleshooting

**Version check fails on commit:**
- Run `npm run version:check` to see which files are inconsistent
- Run `npm run version:update` to synchronize all files
- Re-stage and commit

**Version update script fails:**
- Ensure `VERSION` file exists and contains valid version
- Verify `scripts/update-version.js` has proper file paths
- Check file permissions

## Scripts Reference

- `npm run version:update` - Update all files to match VERSION file
- `npm run version:check` - Verify version consistency
- `scripts/update-version.js` - Version update script
- `scripts/check-version.js` - Version check script
- `scripts/pre-commit.hook` - Git pre-commit hook
