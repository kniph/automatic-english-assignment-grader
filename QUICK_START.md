# 🚀 Quick Start Guide

## 3-Minute Setup for New Project

### Step 1: Copy Template (30 seconds)

```bash
# Navigate to where you want to create the project
cd ~/projects

# Copy the template
cp -r "/Users/kniph/Library/Mobile Documents/com~apple~CloudDocs/Apps aided by AI (LLM)/new-project-template" ./my-new-project

# Enter the new project
cd my-new-project
```

### Step 2: Find & Replace (60 seconds)

Open these files and replace placeholders:

1. **README.md**
   - Find: `[PROJECT_NAME]` → Replace with your project name
   - Find: `[Brief description...]` → Add your description
   - Find: `[repository-url]` → Add your git URL

2. **CLAUDE.md**
   - Find: `[PROJECT_NAME]` → Your project name
   - Find: `[Brief one-line description]` → Your description
   - Find: `[List your stack]` → e.g., "Node.js, Express, PostgreSQL"

3. **package.json**
   - `"name"`: Change to your project name (lowercase, hyphens)
   - `"description"`: Add description
   - `"author"`: Add your name

4. **LICENSE**
   - Find: `[YEAR]` → Current year (e.g., 2026)
   - Find: `[YOUR_NAME]` → Your name

### Step 3: Initialize (60 seconds)

```bash
# Initialize git
git init

# Install dependencies (if Node.js project)
npm install

# Create environment file
cp .env.example .env
# (Edit .env later with your config)

# First commit
git add .
git commit -m "Initial commit from template"
```

### Step 4: Optional - Set Up Pre-Commit Hook (30 seconds)

```bash
# Copy hook
cp scripts/pre-commit.hook .git/hooks/pre-commit

# Make executable
chmod +x .git/hooks/pre-commit
```

## ✅ You're Done!

Now start building and **remember to document as you go**:

- 🐛 Fixed a bug? → Add to `docs/project_notes/bugs.md`
- 🎯 Made a decision? → Add ADR to `docs/project_notes/decisions.md`
- 📝 Important config? → Add to `docs/project_notes/key_facts.md`
- ✨ Completed feature? → Log in `docs/project_notes/issues.md`

## Next Steps

1. **Read** [TEMPLATE_README.md](TEMPLATE_README.md) for detailed instructions
2. **Customize** version scripts in `scripts/` if needed
3. **Start coding** and let the memory system save you time!

---

**Questions?** See [TEMPLATE_README.md](TEMPLATE_README.md) for full documentation.
