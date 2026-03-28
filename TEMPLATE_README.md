# New Project Template

This is a comprehensive project template with built-in version management and AI project memory system.

## 🎯 What's Included

### Core Files
- `README.md` - Main project documentation (customize this)
- `CLAUDE.md` - AI assistant context and memory-aware protocols
- `CHANGELOG.md` - Version history tracking
- `VERSION` - Single source of truth for version number
- `VERSION_MANAGEMENT.md` - Version management guidelines
- `.gitignore` - Common ignore patterns
- `LICENSE` - MIT license (replace as needed)
- `package.json` - Node.js project configuration
- `.env.example` - Environment variables template

### Project Memory System (`docs/project_notes/`)
The memory system preserves knowledge across AI sessions:
- `bugs.md` - Bug log with solutions and prevention strategies
- `decisions.md` - Architectural Decision Records (ADRs)
- `key_facts.md` - Project configuration and quick reference
- `issues.md` - Work log with completed features

### Version Management Scripts (`scripts/`)
- `update-version.js` - Update version across all files
- `check-version.js` - Verify version consistency
- `pre-commit.hook` - Git hook for automatic version checking

## 🚀 Quick Start

### 1. Copy Template to New Project

```bash
# Navigate to your projects directory
cd ~/projects

# Copy template
cp -r "/Users/kniph/Library/Mobile Documents/com~apple~CloudDocs/Apps aided by AI (LLM)/new-project-template" ./my-new-project

# Navigate to new project
cd my-new-project
```

### 2. Customize Project Files

**Update these files with your project info:**

1. **README.md**
   - Replace `[PROJECT_NAME]` with your project name
   - Add project description and features
   - Update tech stack and installation instructions

2. **CLAUDE.md**
   - Replace `[PROJECT_NAME]` and `[Brief one-line description]`
   - Add project-specific sections (deployment, database schema, etc.)
   - Customize memory protocols if needed

3. **package.json**
   - Update `name`, `description`, `author`
   - Add your dependencies
   - Customize scripts as needed

4. **LICENSE**
   - Replace `[YEAR]` and `[YOUR_NAME]`
   - Or use a different license

5. **docs/project_notes/*.md**
   - Remove example entries
   - Keep templates for future use

6. **scripts/update-version.js** and **scripts/check-version.js**
   - Uncomment and customize file patterns for your project
   - Add any additional files that contain version numbers

### 3. Initialize Project

```bash
# Initialize git
git init

# Install dependencies (if using Node.js)
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Make initial commit
git add .
git commit -m "Initial commit from template"

# Set up pre-commit hook (optional)
cp scripts/pre-commit.hook .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### 4. Start Using Project Memory

From day one, document:
- **Bugs**: When you fix something, log it in `bugs.md`
- **Decisions**: When you make architectural choices, add ADRs to `decisions.md`
- **Key Facts**: Add important config, credentials, URLs to `key_facts.md`
- **Work**: Log completed features in `issues.md`

## 📖 Version Management

### Update Version

```bash
# 1. Edit VERSION file with new version number
echo "1.0.0" > VERSION

# 2. Run update script to sync all files
npm run version:update

# 3. Update CHANGELOG.md with changes

# 4. Commit and tag
git add .
git commit -m "chore: bump version to v1.0.0"
git tag v1.0.0
git push && git push --tags
```

### Check Version Consistency

```bash
npm run version:check
```

## 🧠 Project Memory Benefits

The memory system provides compound interest on knowledge:

**Without memory:**
- Month 3: "We should document this..."
- Month 6: Already forgot 50 decisions
- Month 12: Re-solving same bugs repeatedly

**With memory:**
- Day 1: Documentation structure ready
- Week 1: First bug documented with solution
- Month 1: Team learns to capture knowledge
- Month 12: Project gets **easier** over time

## 📁 Directory Structure

```
my-new-project/
├── docs/
│   └── project_notes/          # Project memory system
│       ├── bugs.md
│       ├── decisions.md
│       ├── key_facts.md
│       └── issues.md
├── scripts/                    # Utility scripts
│   ├── update-version.js
│   ├── check-version.js
│   └── pre-commit.hook
├── .env.example               # Environment variables template
├── .gitignore                 # Git ignore patterns
├── CHANGELOG.md               # Version history
├── CLAUDE.md                  # AI assistant context
├── LICENSE                    # Project license
├── package.json               # Node.js config
├── README.md                  # Main documentation
├── VERSION                    # Version source of truth
└── VERSION_MANAGEMENT.md      # Version guidelines
```

## 🎨 Customization Tips

### Add More Files to Version Management

Edit `scripts/update-version.js` and `scripts/check-version.js`:

```javascript
// In filesToUpdate array:
{
  path: 'src/config.js',
  pattern: /const VERSION = '[\d.]+'/,
  replacement: `const VERSION = '${sourceVersion}'`,
  description: 'config.js version constant'
}
```

### Customize Memory Protocols

Edit `CLAUDE.md` to add project-specific protocols:
- Database schema checks
- API endpoint conventions
- Code style guidelines
- Testing requirements

### Add More Memory Files

Create additional files in `docs/project_notes/`:
- `performance.md` - Performance optimization notes
- `security.md` - Security considerations
- `deployment.md` - Deployment procedures
- `apis.md` - Third-party API documentation

## 🔄 Keeping Template Updated

When you improve this template for a project, consider updating the master template:

```bash
# Copy improvements back to template
cp improved-file.md "/Users/kniph/Library/Mobile Documents/com~apple~CloudDocs/Apps aided by AI (LLM)/new-project-template/"
```

## 📚 Resources

- [Keep a Changelog](https://keepachangelog.com/)
- [Semantic Versioning](https://semver.org/)
- [Architectural Decision Records](https://adr.github.io/)
- [SpillWave: Build Your First Claude Code Skill](https://pub.spillwave.com/build-your-first-claude-code-skill-a-simple-project-memory-system-that-saves-hours-1d13f21aff9e)

---

**Template Version**: 1.0.0
**Last Updated**: 2026-02-02
**Created for**: Projects with AI-assisted development
