# Architectural Decision Records (ADRs)

Record of key architectural and technical decisions made for this project.

---

## ADR Template

### ADR-XXX: [Decision Title]

**Date**: YYYY-MM-DD

**Context**:
[What is the situation and what problem needs to be solved?]

**Decision**:
[What is the change we're actually making?]

**Rationale**:
[Why did we choose this approach?]

**Alternatives Considered**:
- Option A - [Why we didn't choose this]
- Option B - [Why we didn't choose this]

**Consequences**:
[What becomes easier/harder? Trade-offs? Impacts?]

**References**:
[Links to docs, discussions, related files]

---

## Example ADR

### ADR-001: Use PostgreSQL for Production Database

**Date**: 2025-02-02

**Context**:
Need to choose a production database for the application. Currently using SQLite in development.

**Decision**:
Use PostgreSQL for production deployment.

**Rationale**:
- Better concurrency support than SQLite
- Team has PostgreSQL experience
- Supported by hosting provider (Railway)
- ACID compliance for financial data

**Alternatives Considered**:
- MongoDB - rejected because relational data fits our model better
- MySQL - rejected due to team's stronger PostgreSQL knowledge
- SQLite - rejected due to concurrency limitations

**Consequences**:
- Need to maintain separate dev (SQLite) and prod (PostgreSQL) configs
- Migration scripts must be tested on both databases
- Can leverage PostgreSQL-specific features (JSONB, full-text search)

---

_Start documenting your decisions below:_

---
