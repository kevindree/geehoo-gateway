---
name: add-orchestrated-route
description: "Add a new config-driven orchestrated route to the API gateway. Use when adding a route, chaining upstream calls, or wiring new middleware. Covers config schema → route registration → middleware → upstream call → test."
argument-hint: "Describe the new route: path, method, upstream(s), auth requirements"
user-invocable: true
---

# Add an Orchestrated Route

## When to Use

- Adding a new gateway route that composes one or more upstream API calls
- Wiring a new auth rule, rate-limit policy, or request/response transform
- Onboarding a new upstream service into the gateway

## Procedure

### 1. Understand the Requirement

Clarify before writing any code:
- Route path and HTTP method
- Is the route public or auth-protected?
- Which upstream(s) does it call, and in what order (sequential / parallel / conditional)?
- What request transform is needed (header injection, body mapping)?
- What response transform / merge strategy is needed?
- Any custom rate-limit overrides?

### 2. Extend the Config Schema

In `src/config/` (schema file):
- Add or extend the route schema type for any new fields.
- Add a validation rule and `.describe()` annotation.
- Ensure startup validation rejects missing/invalid values.

### 3. Add the Route Config Entry

In the appropriate config file / fixture:
```yaml
- id: "my-new-route"
  path: "/api/v1/my-resource"
  method: GET
  public: false           # auth required
  upstream:
    - id: "service-a"
      url: "${SERVICE_A_URL}/resource"
      timeout: 5000
  rateLimit:
    windowMs: 60000
    max: 100
```

### 4. Register the Route

In `src/routes/`:
- The dynamic router reads config and registers routes automatically.
- If new middleware is needed, add it to `src/middleware/` first (see step 5).
- Verify no hard-coded paths are introduced.

### 5. Implement / Update Middleware (if needed)

In `src/middleware/`:
- Auth: ensure JWT / API-key validation runs unless `public: true`.
- Rate limit: key must follow the pattern `rl:<routeId>:<userId>`.
- Error handler: normalize upstream errors before returning to caller.

### 6. Implement the Orchestrator Step (if needed)

In `src/orchestrator/`:
- Add the upstream call with explicit timeout and retry config.
- Handle non-2xx upstream responses — never forward raw error bodies.
- For chained calls, pass mapped fields from step N to step N+1 as defined in config.

### 7. Write Tests

- **Unit test** for any new middleware (happy path + at least one failure path).
- **Integration test** mocking the upstream with `nock` or `msw`:
  - 2xx success path
  - Upstream 4xx / 5xx → normalized gateway error
  - Auth failure (if protected route)
  - Rate-limit exceeded

### 8. Validate

```bash
npm run lint
npm test
```

Fix all lint and test failures before considering the route done.

## Security Checklist

- [ ] Route is protected by auth unless `public: true` is intentional and reviewed
- [ ] Rate limit is applied
- [ ] Upstream URL comes from env var or validated config, not user input
- [ ] Response body does not leak raw upstream error details
- [ ] Any request headers forwarded to upstream are allowlisted, not passed through blindly
