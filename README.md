# [PROJECT_NAME]

[Brief description of what this project does]

## Features

- [Feature 1]
- [Feature 2]
- [Feature 3]

## Tech Stack

- **Backend**: [e.g., Node.js, Express]
- **Database**: [e.g., PostgreSQL, MongoDB]
- **Frontend**: [e.g., React, Vue, or None if API only]
- **Deployment**: [e.g., Railway, Vercel, AWS]

## Getting Started

### Prerequisites

- Node.js v[XX] or higher
- [Database] installed
- [Other prerequisites]

### Installation

1. Clone the repository:
   ```bash
   git clone [repository-url]
   cd [project-name]
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Run database migrations:
   ```bash
   npm run migrate
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

## Environment Variables

See `.env.example` for required environment variables.

Key variables:
- `DATABASE_URL` - Database connection string
- `JWT_SECRET` - Secret for JWT tokens
- `PORT` - Server port (default: 3000)

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run migrate` - Run database migrations
- `npm run seed` - Seed database with sample data
- `npm run version:update` - Bump version number
- `npm run version:check` - Verify version consistency

## Project Structure

```
project-root/
├── api/            # API routes and controllers
├── data/           # Database migrations and seeds
├── docs/           # Documentation and project notes
├── public/         # Static files (if applicable)
├── scripts/        # Utility scripts
└── tests/          # Test files
```

## Documentation

- [CLAUDE.md](CLAUDE.md) - AI assistant context and project memory
- [CHANGELOG.md](CHANGELOG.md) - Version history
- [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md) - Version management guidelines
- [docs/project_notes/](docs/project_notes/) - Bug logs, decisions, and work history

## Contributing

[Add contribution guidelines if applicable]

## License

[Specify license - see LICENSE file]

## Contact

[Your name/email or team contact]
