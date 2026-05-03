# geehoo-gateway — Agent Instructions

## Project Overview

**geehoo-gateway** is a Node.js (Express/Fastify/Hono) API Gateway that lets users orchestrate multiple upstream APIs through configuration alone — no custom code required. It exposes composed APIs to external consumers and handles:

- **API Orchestration**: config-driven request routing, chaining, and transformation
- **Authentication / Authorization**: JWT validation, API-key checks, role enforcement
- **Rate Limiting**: per-user / per-route throttling
- **Upstream Integration**: HTTP calls to backend microservices with timeout/retry/error handling

## Architecture Principles

- **Config-first**: business logic lives in config/schema, not in application code. Agents should extend the configuration schema before adding code branches.
- **No-code surface**: end-users must be able to define new API routes via config (YAML/JSON/DB). Never hard-code routes.
- **Security by default**: every exposed route must pass through the auth middleware unless explicitly marked `public: true` in config. Never bypass auth silently.
- **Stateless runtime**: the gateway itself is stateless. Rate-limit counters and sessions live in Redis (or equivalent); do not use in-memory stores.

## Key Directories (expected, establish on first scaffold)

| Path | Purpose |
|------|---------|
| `src/config/` | Config loading, validation, and schema |
| `src/routes/` | Dynamic route registration from config |
| `src/middleware/` | Auth, rate-limit, logging, error-handler |
| `src/orchestrator/` | Upstream call chaining and response merging |
| `src/plugins/` | Optional feature plugins loaded from config |
| `tests/` | Unit and integration tests |

## Development Commands

> Update this section once the project is scaffolded.

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Lint / type-check
npm run lint
```

## Conventions

- Use **TypeScript** (preferred) or plain JS with JSDoc types.
- Export **named exports** only; avoid default exports.
- Validate all incoming config at startup with a schema library (e.g., Zod, Joi, AJV). Fail fast on invalid config.
- Use **structured JSON logging** (e.g., Pino). Never use `console.log` in production paths.
- All upstream HTTP calls must set explicit **timeouts** and handle non-2xx responses.
- Rate-limit keys must be namespaced: `rl:<routeId>:<userId>`.

## Security Constraints

- **Never** expose raw upstream error details to external callers. Normalize error responses.
- Secrets (API keys, JWT secrets) come from environment variables only; never from config files.
- Input from config files must be sanitized before use in HTTP headers or URLs (path-traversal, header injection).
- Follow OWASP Top 10 for any user-facing endpoint.

## Testing Expectations

- Every new middleware must have unit tests covering the happy path and at least one failure path.
- Integration tests should mock upstream services (e.g., `nock`, `msw`).
- Do not merge features without at least one test.

## Related Agents

The `.github/agents/` folder contains specialized role agents:
- **Backend Developer** — API orchestration logic, middleware, upstream integration
- **Security Engineer** — Auth flows, rate-limit bypass risks, input sanitization
- **Database Engineer** — If a persistence layer is added for config/audit
- **DevOps Engineer** — Docker, CI/CD, deployment config
- **Test Engineer** — Test coverage, integration test scaffolding
