# Bug Log

Record of bugs encountered, root causes, solutions, and prevention strategies.

---

## Template Entry Format

### YYYY-MM-DD - BUG-XXX: [Brief Description]

**Issue**: [What went wrong? What was the symptom?]

**Root Cause**: [Why did this happen? What was the underlying issue?]

**Solution**:
[Step-by-step fix or code change]

**Prevention**:
[How to avoid this in the future? Warning signs? Best practices?]

**Commit**: [Git commit hash if applicable]

---

## Example Entry

### 2025-02-02 - BUG-001: API Returns 500 on Valid Requests

**Issue**: POST /api/users endpoint returns 500 error even with valid data

**Root Cause**: Missing environment variable DATABASE_URL causes connection failure

**Solution**:
1. Add DATABASE_URL to .env file
2. Restart server
3. Verify connection with health check endpoint

**Prevention**:
- Add .env.example file with all required variables
- Add startup check that validates required env vars
- Document all environment variables in key_facts.md

**Commit**: `abc1234`

---

_Start logging your bugs below:_

---
