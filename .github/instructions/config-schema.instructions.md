---
description: "Use when adding, modifying, or reviewing gateway configuration: route definitions, auth settings, rate-limit rules, upstream targets, plugin options. Covers schema-first workflow and validation requirements."
applyTo: "src/config/**"
---

# Config Schema Guidelines

## Schema-First Rule

Every new gateway feature **must** extend the config schema before any code branch is added.

1. Define the new field in the schema file (Zod / Joi / AJV) with strict types and `.describe()` annotations.
2. Add a default value or mark the field as required — never silently ignore missing config.
3. Update any fixture / example config files in `src/config/examples/` (or equivalent) so the new field is documented.
4. Only then wire the validated config value into application code.

## Validation Requirements

- Call the schema `.parse()` / `.validate()` at **startup**, not at request time.
- On invalid config, log the full validation error (field path + message) and **exit the process** — do not degrade silently.
- Never cast or coerce config values with `as any`; let the schema handle coercion explicitly.

## Secrets Policy

- Secrets (JWT secret, API keys, Redis password) must come from **environment variables only**.
- Config schema must read secrets via `z.string().min(1)` applied to `process.env.XXX` — never from YAML/JSON files.
- Reject startup if a required secret env var is empty or missing.

## Route Config Shape (reference)

```ts
// Minimal shape — extend but do not remove fields
{
  id: string,           // unique, stable slug
  path: string,         // e.g. "/api/v1/orders"
  method: HTTPMethod,
  public: boolean,      // if false → auth middleware is mandatory
  upstream: UpstreamRef | UpstreamRef[],  // single call or orchestration chain
  rateLimit?: RateLimitConfig,
  auth?: AuthConfig,
}
```

## Anti-patterns

- Do not add `if (process.env.FEATURE_X)` guards in route/middleware code — model feature flags in schema.
- Do not hard-code route paths anywhere outside config.
- Do not store sensitive defaults in config files (even as placeholders like `"secret123"`).
