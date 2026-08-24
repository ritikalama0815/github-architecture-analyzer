# Archviz

Interactive architecture analyzer for TypeScript / Angular projects.

Upload a ZIP or paste a public GitHub URL → static import analysis (ts-morph) → interactive Cytoscape dependency graph → architecture health report (cycles, coupling, unused files).

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Angular 19 (standalone), Signals, Angular Material, Tailwind, Cytoscape.js |
| Backend | NestJS, ts-morph, Prisma |
| Data | PostgreSQL (optional — in-memory fallback if DB is down) |
| Deploy | Docker Compose |

## Quick start

### Prerequisites

- Node.js 20+
- npm 10+
- Docker (optional, for PostgreSQL persistence)

### 1. Install

```bash
cd github-architecture
cp .env.example .env
npm install
```

### 2. Database (optional)

```bash
docker compose up -d postgres
cd apps/api && npx prisma migrate deploy && cd ../..
```

If Postgres is not running, the API still works with an **in-memory store** for the current process.

### 3. Run

From the repo root:

```bash
# terminal 1 — API on :3000
npm run dev:api

# terminal 2 — Angular on :4200
npm run dev:web
```

Or both:

```bash
npm run dev
```

Open [http://localhost:4200](http://localhost:4200).

## Try it

1. Paste a public repo URL, e.g. `https://github.com/nestjs/nest` (large repos take longer), or a smaller Angular sample.
2. Or upload a ZIP of a TypeScript project (without `node_modules`).
3. Explore the graph: drag, zoom, search, filter by kind, highlight circular edges.
4. Click nodes for fan-in/out, dependents, and file metrics.
5. Review the health score and issue list.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/analyses` | List recent analyses |
| `POST` | `/api/analyses/github` | `{ "githubUrl": "https://github.com/owner/repo" }` |
| `POST` | `/api/analyses/zip` | multipart field `file` |
| `GET` | `/api/analyses/:id` | Status + summary |
| `GET` | `/api/analyses/:id/graph` | Nodes, edges, issues, stats |
| `GET` | `/api/analyses/:id/issues` | Health report |

## Project layout

```
github-architecture/
├── apps/api          NestJS analyzer + ingest + Prisma
├── apps/web          Angular UI + Cytoscape graph
├── packages/shared   Shared TypeScript DTOs
└── docker-compose.yml
```

## Features included

- GitHub zipball ingest + ZIP upload
- TypeScript AST import graph via ts-morph
- Angular-oriented node kinds (component, service, module, guard, …)
- Circular dependency detection + edge highlighting
- High-coupling / large-file / unused-file heuristics
- Architecture health score
- Interactive graph (fcose layout, search, filters, minimap, dark/light)
- PNG export of the graph canvas

## Notes

- Analysis is best on **TypeScript / Angular** codebases.
- Very large monorepos are capped (~2500 source files) for responsiveness.
- Set `GITHUB_TOKEN` in `.env` if you hit GitHub API rate limits.
- Timeline / PDF reports are left as future enhancements.
