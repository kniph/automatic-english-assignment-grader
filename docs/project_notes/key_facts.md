# Key Project Facts

Essential project configuration, constants, and quick reference information.

---

## Deployment & Infrastructure

**Platform**: [e.g., Railway, Vercel, AWS]
**Database**: [e.g., PostgreSQL, MongoDB]
**Auto-Deploy**: [Yes/No, from which branch]
**Environment**: [Development/Staging/Production URLs]

---

## Database Schema

[Document key tables, relationships, important columns]

### Example:
**Users Table**
- Primary key: `id`
- Important columns: `email`, `role`, `created_at`
- Relationships: Has many `posts`
- Indexes: `email` (unique), `role`

---

## Environment Variables

**Required Variables:**
- `DATABASE_URL` - Database connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `API_KEY` - External API authentication

**Optional Variables:**
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (development/production)

---

## User Roles & Permissions

[Document role system if applicable]
- `admin` - Full system access
- `user` - Standard access
- `guest` - Read-only access

---

## API Endpoints

[List critical endpoints]
- `GET /api/health` - Health check
- `POST /api/auth/login` - User authentication
- `GET /api/users/:id` - Get user details

---

## Development

### Start Server
```bash
npm run dev   # Development with hot reload
npm start     # Production mode
```

### Database
```bash
npm run migrate        # Run migrations
npm run migrate:make   # Create new migration
npm run seed           # Seed data
npm run rollback       # Rollback last migration
```

### Testing
```bash
npm test              # Run tests
npm run test:watch    # Watch mode
```

---

## Common Issues & Quick Fixes

[Document frequent problems and solutions]

**Port already in use:**
```bash
lsof -ti:3000 | xargs kill
```

**Database connection failed:**
- Check DATABASE_URL in .env file
- Verify database server is running
- Check firewall/network settings

**Module not found:**
```bash
rm -rf node_modules package-lock.json
npm install
```

---

## Test Accounts

[Document test credentials - mark clearly if contains real data]

**⚠️ Development only - not for production:**
- Admin: `admin@test.com` / `test123`
- User: `user@test.com` / `test123`

---

## Git & Version Control

**Remote**: [GitHub/GitLab URL]
**Main Branch**: [main/master]
**Commit Convention**: [Conventional Commits, custom format]

---

## Dependencies

**Key Dependencies:**
- [List critical dependencies and their purposes]
- Example: `express` - Web framework
- Example: `knex` - Database query builder

**Security Notes:**
- [Document any security-sensitive dependencies]
- [Update schedule for dependencies]

---
