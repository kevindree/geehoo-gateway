# geehoo-gateway

A config-driven API gateway built on Node.js + Express. Compose upstream APIs into new endpoints purely through visual flow configuration — no code required.

---

## Upstream Call Node — Configuration Guide

The **Upstream Call** node is the workhorse of any orchestration flow. It makes an HTTP/REST/GraphQL/SOAP request to a backend service and stores the response under the node's id (e.g. `upstream_call_xxx.data`).

This guide covers the most common configuration scenarios.

### Field reference

| Field | Purpose |
|-------|---------|
| **Method** | HTTP method sent to the upstream (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`/...). |
| **URL** | Full upstream URL. Supports `{{nodeId.path}}` placeholders for dynamic segments. Substituted values are URL-encoded. |
| **Timeout (ms)** | Per-request timeout; defaults to `10000`. Network timeout returns `504 GATEWAY_TIMEOUT`. |
| **Upstream Auth** | Auth attached to the upstream request (Bearer / Basic / API key in header / API key in query). Use `$ENV_VAR` to reference an environment variable. |
| **Headers** | Static headers added to the upstream request. |
| **Params / Body From** | One or more JMESPath-style references whose values are merged (shallow) and used as **query string** (for `GET`/`HEAD`/`DELETE`) or **request body** (for `POST`/`PUT`/`PATCH`). Later refs override earlier ones on key collision. |
| **Request Body (JSON)** | Static body literal. Used only when `Params / Body From` is empty. |

### Default behavior when nothing is configured

- **GET / HEAD / DELETE** — incoming `req.query` is forwarded as the upstream query string.
- **POST / PUT / PATCH** — incoming `req.body` is forwarded as the upstream request body.

So a 1:1 passthrough route needs only the `Method` and `URL` filled in.

### Available reference paths

Use these in `Params / Body From` and inside `{{...}}` URL placeholders:

| Reference | Value |
|-----------|-------|
| `trigger.body` | Incoming request body (parsed JSON for `application/json`). |
| `trigger.query` | Incoming query parameters object. |
| `trigger.params` | Path parameters from the gateway route definition (e.g. the `:id` in `/addresses/:id`). |
| `trigger.headers` | Sanitized incoming headers (only safe headers — `content-type`, `accept`, `accept-language`, `user-agent`). |
| `<upstream_call_id>.data` | Response body of a previous upstream call node. |
| `<upstream_call_id>.headers` | Response headers of a previous upstream call. |
| `<issue_jwt_id>.accessToken` / `.refreshToken` / `.expiresIn` | Output of an Issue JWT node. |

---

## Common scenarios

### Scenario 1 — Passthrough GET with query params

**Goal**: Client calls `GET /products?page=2&limit=20`; upstream receives the same query string.

**Gateway route**: `GET /products`

**Upstream Call**:

| Field | Value |
|-------|-------|
| Method | `GET` |
| URL | `https://api.example.com/v1/products` |
| Params / Body From | *(leave empty — `trigger.query` is forwarded automatically)* |

---

### Scenario 2 — Passthrough POST with JSON body

**Goal**: Client calls `POST /login` with `{ "email": "...", "password": "..." }`; upstream receives the same body.

**Gateway route**: `POST /login`

**Upstream Call**:

| Field | Value |
|-------|-------|
| Method | `POST` |
| URL | `https://api.example.com/v1/auth/login` |
| Params / Body From | *(leave empty — `trigger.body` is forwarded automatically)* |
| Request Body (JSON) | *(leave empty)* |

---

### Scenario 3 — Path parameter (REST-style ID in the URL)

**Goal**: Client calls `DELETE /addresses/addr_abc123`; upstream is `DELETE https://api.example.com/v1/addresses/addr_abc123`.

**Gateway route**: `DELETE /addresses/:id`

**Upstream Call**:

| Field | Value |
|-------|-------|
| Method | `DELETE` |
| URL | `https://api.example.com/v1/addresses/{{trigger.params.id}}` |

> ⚠️ The gateway path **must** declare `:id` for `trigger.params.id` to be populated. If the path is just `/addresses`, the placeholder resolves to an empty string and the upstream URL becomes `.../addresses/` — typically a 404.

---

### Scenario 4 — ID comes from query string instead of path

**Goal**: Client calls `DELETE /addresses?id=addr_abc123`; upstream URL must include the id as a path segment.

**Gateway route**: `DELETE /addresses`

**Upstream Call**:

| Field | Value |
|-------|-------|
| Method | `DELETE` |
| URL | `https://api.example.com/v1/addresses/{{trigger.query.id}}` |
| Params / Body From | *(leave empty if you don't want to forward all query params; otherwise see scenario 5)* |

---

### Scenario 5 — Mix path param + extra query string

**Goal**: Client calls `DELETE /addresses/addr_abc?user_id=42`; upstream is `DELETE https://api.example.com/v1/addresses/addr_abc?user_id=42`.

**Gateway route**: `DELETE /addresses/:id`

**Upstream Call**:

| Field | Value |
|-------|-------|
| Method | `DELETE` |
| URL | `https://api.example.com/v1/addresses/{{trigger.params.id}}` |
| Params / Body From | `trigger.query` |

---

### Scenario 6 — Reshape an incoming request before sending it upstream

**Goal**: Client posts `{ "email": "...", "pw": "..." }`, but upstream expects `{ "username": "...", "password": "..." }`.

**Flow**: `Trigger` → `Transform` → `Upstream Call` → `Response`

Configure a Transform node before the Upstream Call to map `email→username`, `pw→password`. Then in the Upstream Call:

| Field | Value |
|-------|-------|
| Method | `POST` |
| URL | `https://api.example.com/v1/auth/login` |
| Params / Body From | `<transform_node_id>` |

---

### Scenario 7 — Chain two upstream calls (use response of first as input to second)

**Goal**: Get a user by id, then use the user's `accountId` to fetch their orders.

**Flow**: `Trigger` → `Upstream Call A` → `Upstream Call B` → `Response`

**Upstream Call A**:

| Field | Value |
|-------|-------|
| Method | `GET` |
| URL | `https://api.example.com/v1/users/{{trigger.params.userId}}` |

**Upstream Call B**:

| Field | Value |
|-------|-------|
| Method | `GET` |
| URL | `https://api.example.com/v1/orders?accountId={{<upstream_call_A_id>.data.accountId}}` |

> Tip: `Params / Body From` would also work here — set it to `<upstream_call_A_id>.data` and reference fields server-side.

---

### Scenario 8 — Merge multiple sources into the upstream payload

**Goal**: Send the upstream a combined payload of incoming body + a value extracted from a previous node.

**Upstream Call**:

| Field | Value |
|-------|-------|
| Method | `POST` |
| Params / Body From | `trigger.body`, `<previous_node_id>.data` |

The two objects are shallow-merged in the order shown in the chip list. Later entries override earlier ones on key collision.

---

### Scenario 9 — Static body (template-style)

**Goal**: Always send a fixed body to the upstream regardless of the incoming request.

**Upstream Call**:

| Field | Value |
|-------|-------|
| Method | `POST` |
| URL | `https://api.example.com/v1/events` |
| Params / Body From | *(empty)* |
| Request Body (JSON) | `{ "type": "ping", "source": "geehoo-gateway" }` |

---

### Scenario 10 — Upstream auth using project-level credentials

**Goal**: Don't hard-code secrets in each route; reuse the project's stored upstream credentials.

**Upstream Call**:

| Field | Value |
|-------|-------|
| Upstream Auth | `Basic Auth` (or whatever type the upstream needs) |
| ☑ Use project parameter | checked |

The actual username/password is read from the project's settings page at request time, so rotating a credential only requires updating the project — not editing every route.

---

## Error responses

The gateway normalizes upstream and internal errors into a consistent shape:

```json
{ "error": { "code": "...", "message": "...", "requestId": "..." } }
```

| Status | `code` | When |
|--------|--------|------|
| `4xx` (passthrough) | `UPSTREAM_ERROR` | Upstream returned a 4xx; original status + body are preserved under `error.detail`. |
| `502` | `BAD_GATEWAY` | Upstream returned a 5xx (body is **not** propagated). |
| `503` | `SERVICE_UNAVAILABLE` | Could not connect to the upstream (DNS/connection failure). |
| `504` | `GATEWAY_TIMEOUT` | Upstream did not respond before `Timeout (ms)` elapsed. |
| `404` | `NOT_FOUND` | Gateway has no route matching the request path/method. |
| `429` | `RATE_LIMIT_EXCEEDED` | Per-route rate limit hit. |
| `401` | `UNAUTHORIZED` | Missing/invalid JWT or API key. |
| `5xx` (other) | `INTERNAL_ERROR` | Unexpected gateway error; details go to logs. The `requestId` lets you correlate with structured logs. |

---

## Tips & gotchas

- **`{{...}}` placeholders are always URL-encoded.** If you need a raw value (e.g. comma-separated list), URL-encode at the source instead.
- **Empty references render as empty strings**, not `undefined`. Always declare path params on the gateway route if you reference `trigger.params.x`.
- **`DELETE`/`HEAD`/`GET` cannot send a JSON body** in this gateway — `Params / Body From` and the static body field are turned into a query string for these methods.
- **Sensitive headers are not forwarded** to scripts/templates by default. Only `content-type`, `accept`, `accept-language`, `user-agent` are exposed via `trigger.headers`.
- **`Use project parameter`** is the recommended way to handle upstream credentials. Don't paste real secrets into a route's auth fields.
