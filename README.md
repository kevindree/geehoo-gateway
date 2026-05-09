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

---

## Transform Node — Configuration Guide

A **Transform** node reshapes, filters, or computes data between other nodes in an orchestration flow. It reads from a prior node's output (`Input From`), applies one of four transform modes, and stores the result under its own node ID for downstream nodes to reference.

**Typical position in a flow:**

```
Trigger → Upstream Call → Transform → Response
Trigger → Transform → Upstream Call → Response   (reshape the request before sending)
```

### Field reference

| Field | Purpose |
|-------|---------|
| **Input From** | Reference to any prior node's output (e.g. `upstream-1.data`, `trigger.body`). See the reference table in the Upstream Call section for all valid paths. |
| **Transform Type** | One of: `JMESPath`, `Field Mapping`, `Handlebars Template`, `Sandbox JS`. |
| **Expression / Mappings / Template / Script** | Type-specific configuration — see each mode below. |

The result of the Transform node is stored as `<nodeId>` and can be referenced by downstream nodes (e.g. as a `bodyFrom` in an Upstream Call or the `dataFrom` of a Response node).

---

### Mode 1 — JMESPath

**How it works:** Evaluates a [JMESPath](https://jmespath.org/) expression against the input. Returns the query result; returns `null` on evaluation error.

**Best for:** Extracting a nested field, filtering an array, projecting a subset of keys — anything that can be expressed as a single query.

**Expression syntax quick-reference:**

| Goal | Expression | Example input → output |
|------|-----------|------------------------|
| Get a nested field | `data.user.id` | `{data:{user:{id:1}}}` → `1` |
| Get first array item | `items[0]` | `{items:[{id:1},{id:2}]}` → `{id:1}` |
| Get first item field | `items[0].name` | `{items:[{name:"A"}]}` → `"A"` |
| Project all names | `items[*].name` | `[{name:"A"},{name:"B"}]` → `["A","B"]` |
| Filter array | `[?status==` `` `publish` `` `]` | filters items where status is "publish" |
| Filter + project | `[?status==` `` `publish` `` `].{id:id,name:name}` | filtered list with only id/name |
| Rename key | `{userId: id, title: name}` | `{id:1,name:"A"}` → `{userId:1,title:"A"}` |

> ⚠️ String literals in JMESPath **must** use backticks `` ` ``, not quotes. `[?status==` `` `publish` `` `]` is correct; `[?status=="publish"]` will not work.

**Example — return only published products from a WooCommerce array:**

- Input From: `upstream_call-xxx.data`
- Expression: `` [?status==`publish`] ``

**Example — return published products with only id and name:**

- Input From: `upstream_call-xxx.data`
- Expression: `` [?status==`publish`].{id: id, name: name} ``

---

### Mode 2 — Field Mapping

**How it works:** Reads each `From` path from the input and writes its value to the `To` path in a newly constructed output object. Paths use dot notation with an optional leading `$.`. Missing source paths are silently skipped; the output only contains the explicitly mapped fields.

**Best for:** Renaming fields between incompatible API schemas; flattening deep nesting; grouping flat fields into a nested structure; building a clean interface contract between upstream and downstream systems.

**Path notation:**

| Notation | Meaning |
|----------|---------|
| `$.a.b.c` | Nested path (leading `$.` optional) |
| `a.b.c` | Same — `$.` prefix is stripped automatically |

> ⚠️ Array indexing (e.g. `items[0].name`) is **not** supported in Field Mapping paths. Use JMESPath first to extract the element, then apply Field Mapping on the result.

**Example — adapt a CRM payload to an internal user schema:**

Input (`upstream_call-crm.data`):
```json
{ "cust_id": "U-001", "cust_name": "Alice", "addr": { "city": "Beijing", "zip": "100000" } }
```

Mappings:
| From | To |
|------|----|
| `$.cust_id` | `$.id` |
| `$.cust_name` | `$.displayName` |
| `$.addr.city` | `$.location.city` |
| `$.addr.zip` | `$.location.postcode` |

Output:
```json
{ "id": "U-001", "displayName": "Alice", "location": { "city": "Beijing", "postcode": "100000" } }
```

**Example — flatten a nested structure:**

Input: `{ "meta": { "pagination": { "total": 100, "page": 2 } } }`

Mappings:
| From | To |
|------|----|
| `$.meta.pagination.total` | `$.total` |
| `$.meta.pagination.page` | `$.page` |

Output: `{ "total": 100, "page": 2 }`

---

### Mode 3 — Handlebars Template

**How it works:** Renders a [Handlebars](https://handlebarsjs.com/) template string. If the rendered result is valid JSON it is automatically parsed and returned as an object; otherwise it is returned as a plain string.

**Available variables:**

| Variable | Value |
|----------|-------|
| `{{data}}` / `{{data.field}}` | The resolved `Input From` value |
| `{{context.nodeId}}` / `{{context.nodeId.field}}` | Full result of any prior node, keyed by node ID |

**Best for:** Constructing a JSON payload that combines data from multiple nodes; generating plain-text output (notification messages, email bodies); cases where you need string interpolation that JMESPath cannot produce.

> ⚠️ Handlebars does not natively support array index access with `[0]`. Use `.[0]` (dot prefix) instead: `{{data.[0].name}}`. If the input is an array, consider adding a JMESPath Transform before this node to extract the element first.

**Example — return the first item from an array (input is an array):**

```handlebars
{
  "id": "{{data.[0].id}}",
  "name": "{{data.[0].name}}"
}
```

**Example — build a request body combining two upstream calls:**

- Input From: `upstream-user.data`
- Template:
```handlebars
{
  "userId": "{{data.id}}",
  "orderId": "{{context.upstream-order.data.orderId}}",
  "note": "Order for {{data.name}}"
}
```

**Example — generate a plain-text notification message:**

```handlebars
Hello {{data.name}}, your order #{{context.upstream-order.data.id}} has been confirmed.
```
Output is a string (not JSON), usable directly as a Response body.

---

### Mode 4 — Sandbox JS

**How it works:** Executes arbitrary JavaScript inside a [QuickJS](https://bellard.org/quickjs/) sandbox (`quickjs-emscripten`). Completely isolated from the Node.js host — no `process`, no network, no filesystem. CPU hard limit: **100ms**. Returns `null` on timeout, syntax error, or runtime error.

**Available variables:**

| Variable | Value |
|----------|-------|
| `input` | The resolved `Input From` value (deep-copied via JSON serialization) |
| `context` | Map of all prior node results keyed by node ID (also deep-copied) |

The script **must** use `return` to produce output.

**Best for:** Complex logic that JMESPath cannot express — arithmetic, multi-step computation, conditional field inclusion, combining many nodes, custom sorting/grouping.

**Example — filter and enrich an array:**

```js
return input
  .filter(p => p.status === 'publish' && parseFloat(p.price) > 0)
  .map(p => ({
    id: p.id,
    name: p.name,
    price: parseFloat(p.price),
    onSale: p.on_sale
  }))
```

**Example — cross-node aggregation:**

```js
const user = context['get-user'].data
const perms = context['get-permissions'].data.permissions
return {
  id: user.id,
  name: user.name,
  roles: perms.map(p => p.role),
  isAdmin: perms.some(p => p.role === 'admin')
}
```

**Example — strip sensitive fields before returning:**

```js
const { password, secret, apiKey, ...safe } = input
return safe
```

**Example — pagination metadata calculation:**

```js
const { total, per_page, page } = input
return {
  total,
  perPage: per_page,
  currentPage: page,
  totalPages: Math.ceil(total / per_page),
  hasNext: page < Math.ceil(total / per_page),
  hasPrev: page > 1
}
```

---

### Choosing the right mode

```
Does the task fit a single JSON path query / filter / projection?
    → JMESPath   (fastest, most readable)

Do you need to rename/restructure fields between two schemas?
    → Field Mapping   (explicit, no code)

Do you need to combine data from multiple nodes into one string or JSON?
    → Handlebars Template   (best for string interpolation across nodes)

Do you need loops, arithmetic, conditionals, or anything else?
    → Sandbox JS   (most powerful; 100ms CPU cap applies)
```

---

### Common Transform recipes

#### Return a full array unchanged
Delete the Transform node entirely. Set the Response node's `Data From` directly to `upstream_call-xxx.data`.

#### Filter an array by a field value
- Mode: JMESPath
- Expression: `` [?status==`publish`] ``

#### Project an array to fewer fields
- Mode: JMESPath
- Expression: `[*].{id: id, name: name}`

#### Filter + project in one step
- Mode: JMESPath
- Expression: `` [?status==`publish`].{id: id, name: name} ``

#### Extract a single item from an array
- Mode: JMESPath
- Expression: `[0]` (first item) or `[-1]` (last item)

#### Rename fields (schema adaptation)
- Mode: Field Mapping
- Add one mapping row per field to rename

#### Build a payload from two upstream responses
- Mode: Handlebars Template
- Set `Input From` to the first upstream node; reference the second via `{{context.nodeId.data.field}}`

#### Strip sensitive fields
- Mode: Sandbox JS
- Script: `const { password, token, ...safe } = input; return safe`

#### Sort an array
- Mode: Sandbox JS
- Script: `return [...input].sort((a, b) => a.name.localeCompare(b.name))`

#### Paginate a response
- Mode: Sandbox JS
- Script:
```js
const page = context['trigger'].query.page || 1
const size = context['trigger'].query.size || 10
const start = (page - 1) * size
return {
  items: input.slice(start, start + size),
  total: input.length,
  page: Number(page),
  totalPages: Math.ceil(input.length / size)
}
```

---

## Loop Node — Configuration Guide

A **Loop** node repeatedly executes a single target node, collects each iteration's result into an array, and stops when a JMESPath stop condition becomes truthy or the iteration cap is reached. The array is stored under the loop node's own ID and can be referenced by downstream nodes.

**Typical position in a flow:**

```
Trigger → Transform (build page=1 query) → Upstream Call → Loop → Merge/Response
```

### Field reference

| Field | Required | Purpose |
|-------|----------|---------|
| **Target Node** | Yes | The node re-executed on every iteration. Can be any node type except `trigger`, `response`, or another `loop`. |
| **Stop Condition** | Yes | JMESPath expression evaluated against the target node's latest result. The loop stops as soon as this returns a truthy value. |
| **Max Iterations** | No | Upper bound (default: `10`). The engine enforces a hard cap of **50** regardless of this value. |
| **Aggregate Results From** | No | JMESPath-style ref (e.g. `nodeId.data.items`) to extract a specific field from each iteration result. If omitted, the target node's full result is appended. If the extracted value is itself an array, its elements are spread (flattened one level) into the accumulator. |

---

### Example 1 — Paginated fetch (collect all pages)

**Goal**: An upstream API returns one page at a time (`GET /orders?page=N`). Fetch every page and return all orders in a single response.

**The challenge**: The upstream query parameter `page` must increment each iteration. This is solved with a Transform node placed *before* the Upstream Call inside the loop. The Loop targets the **Upstream Call** node; the Transform node is chained as a predecessor to it in the flow, so it runs automatically each time the upstream call re-executes.

> **How page tracking works**: A Transform (Sandbox JS) node reads the previous iteration's response to compute the next page number, then writes `{ page: N }` as its output. The Upstream Call's `Params / Body From` is set to `<transform_id>`, so each iteration picks up the freshly incremented page number.

**Step-by-step node setup:**

**1. `transform_page` — Sandbox JS Transform**

| Field | Value |
|-------|-------|
| Input From | `call_orders` *(the upstream call node — initially `undefined`, treated as `null`)* |
| Transform Type | Sandbox JS |
| Script | see below |

```js
// input is the previous iteration's response (null on first call)
const prevPage = (input && input.data && input.data.page) ? input.data.page : 0
return { page: prevPage + 1 }
```

On the first iteration `input` is `null` (no prior result), so `page` becomes `0 + 1 = 1`. On every subsequent iteration it reads `page` from the last response and increments it.

**2. `call_orders` — Upstream Call**

| Field | Value |
|-------|-------|
| Method | `GET` |
| URL | `https://api.example.com/orders` |
| Params / Body From | `transform_page` |

The query string sent to the upstream will be `?page=1`, `?page=2`, … on each iteration.

**3. `loop_pages` — Loop**

| Field | Value |
|-------|-------|
| Target Node | `call_orders` |
| Stop Condition | `` length(data.items) == `0` `` |
| Max Iterations | `20` |
| Aggregate Results From | `call_orders.data.items` |

The stop condition evaluates the **latest** result of `call_orders`. When the upstream returns an empty `items` array there are no more pages, so the loop stops. Each iteration's `data.items` array is spread into the accumulator, producing a flat list of all orders.

**4. `response` — Response**

| Field | Value |
|-------|-------|
| Data From | `loop_pages` |

**Final response:**
```json
[
  { "id": 1, "amount": 100 },
  { "id": 2, "amount": 200 },
  { "id": 3, "amount": 150 }
]
```

**Flow diagram:**
```
Trigger → transform_page → call_orders ↘
                    ↑________________________loop_pages → Response
```

> `transform_page` is a predecessor of `call_orders` in the graph edges. The Loop targets `call_orders`; because `transform_page → call_orders` is an edge, the engine executes `transform_page` first every time `call_orders` is invoked.

---

### Example 2 — Poll until an async task completes

**Goal**: Submit a job, then poll its status every iteration until `status` is no longer `"pending"`.

**`call_status` — Upstream Call**

| Field | Value |
|-------|-------|
| Method | `GET` |
| URL | `https://api.example.com/jobs/{{trigger.params.jobId}}` |

**`loop_poll` — Loop**

| Field | Value |
|-------|-------|
| Target Node | `call_status` |
| Stop Condition | `` status != `pending` `` |
| Max Iterations | `10` |
| Aggregate Results From | *(empty — collect full response each poll)* |

The loop runs up to 10 times. As soon as the upstream returns a `status` other than `"pending"` the loop stops. The result is an array of all poll responses; the last element reflects the final status.

To return only the final status response, add a Transform after the loop:

- Mode: JMESPath
- Expression: `[-1]` *(last element of the array)*

---

### Stop Condition reference

The stop condition is a **JMESPath expression** evaluated against the target node's latest full result (not the accumulated array).

| Scenario | Expression |
|----------|-----------|
| Empty `items` array in response body | `` length(data.items) == `0` `` |
| Total pages exhausted (`page >= totalPages`) | `` data.page >= data.totalPages `` |
| Status field is not "pending" | `` status != `pending` `` |
| A boolean `done` flag is true | `data.done` |
| Response array itself is empty | `` length(@) == `0` `` |

> String literals in JMESPath use backticks `` ` ``, not quotes. Numeric literals also use backticks: `` `0` ``.

---

### Common pitfalls

- **Stop condition never becomes truthy** → loop always runs to `maxIterations`. Double-check the JMESPath path matches the actual response shape.
- **Transform for page increment must be a predecessor edge of the Upstream Call**, not of the Loop. The Loop node itself only controls *how many times* it re-runs the subgraph rooted at the target node.
- **`aggregateResultsFrom` flattens one level**: if the extracted value is `[1, 2, 3]` and there are 3 iterations, the loop result is `[1, 2, 3, 4, 5, 6, 7, 8, 9]` — not `[[1,2,3],[4,5,6],[7,8,9]]`. This is intentional for pagination use cases.
- The hard cap is **50 iterations** engine-side. Setting `maxIterations` to a larger value has no effect.

---

---

# 中文文档

geehoo-gateway 是一个基于 Node.js + Express 构建的配置驱动型 API 网关。通过可视化流程配置即可将多个上游 API 组合成新的端点，无需编写任何代码。

---

## Upstream Call 节点 — 配置指南

**Upstream Call（上游调用）** 节点是编排流程的核心节点。它向后端服务发起 HTTP/REST/GraphQL/SOAP 请求，并将响应结果以节点 ID 为键存储（例如 `upstream_call_xxx.data`）。

本指南涵盖最常见的配置场景。

### 字段说明

| 字段 | 用途 |
|------|------|
| **Method** | 发送给上游的 HTTP 方法（`GET`/`POST`/`PUT`/`PATCH`/`DELETE`/...）。 |
| **URL** | 完整的上游 URL，支持 `{{nodeId.path}}` 占位符用于动态段，替换值会自动 URL 编码。 |
| **Timeout (ms)** | 单次请求超时时间，默认 `10000` 毫秒。超时返回 `504 GATEWAY_TIMEOUT`。 |
| **Upstream Auth** | 附加到上游请求的认证信息（Bearer / Basic / Header API Key / Query API Key）。使用 `$ENV_VAR` 引用环境变量。 |
| **Headers** | 附加到上游请求的静态请求头。 |
| **Params / Body From** | 一个或多个 JMESPath 风格的引用，值会被浅合并后作为 **查询字符串**（`GET`/`HEAD`/`DELETE`）或 **请求体**（`POST`/`PUT`/`PATCH`）发送。后面的引用在键冲突时覆盖前面的。 |
| **Request Body (JSON)** | 静态请求体字面量，仅在 `Params / Body From` 为空时生效。 |

### 未配置时的默认行为

- **GET / HEAD / DELETE** — 将入站 `req.query` 原样转发为上游查询字符串。
- **POST / PUT / PATCH** — 将入站 `req.body` 原样转发为上游请求体。

因此，1:1 透传路由只需填写 `Method` 和 `URL` 两个字段即可。

### 可用引用路径

可在 `Params / Body From` 以及 `{{...}}` URL 占位符中使用以下引用：

| 引用 | 值 |
|------|----|
| `trigger.body` | 入站请求体（`application/json` 时为解析后的 JSON）。 |
| `trigger.query` | 入站查询参数对象。 |
| `trigger.params` | 网关路由定义中的路径参数（如 `/addresses/:id` 中的 `:id`）。 |
| `trigger.headers` | 经过过滤的安全请求头（仅 `content-type`、`accept`、`accept-language`、`user-agent`）。 |
| `<upstream_call_id>.data` | 前一个上游调用节点的响应体。 |
| `<upstream_call_id>.headers` | 前一个上游调用节点的响应头。 |
| `<issue_jwt_id>.accessToken` / `.refreshToken` / `.expiresIn` | Issue JWT 节点的输出。 |

---

## 常见场景

### 场景 1 — GET 透传（带查询参数）

**目标**：客户端调用 `GET /products?page=2&limit=20`，上游收到相同的查询字符串。

**网关路由**：`GET /products`

**Upstream Call**：

| 字段 | 值 |
|------|-----|
| Method | `GET` |
| URL | `https://api.example.com/v1/products` |
| Params / Body From | *（留空 — `trigger.query` 自动转发）* |

---

### 场景 2 — POST 透传（JSON 请求体）

**目标**：客户端以 `{ "email": "...", "password": "..." }` 调用 `POST /login`，上游收到相同的请求体。

**网关路由**：`POST /login`

**Upstream Call**：

| 字段 | 值 |
|------|-----|
| Method | `POST` |
| URL | `https://api.example.com/v1/auth/login` |
| Params / Body From | *（留空 — `trigger.body` 自动转发）* |
| Request Body (JSON) | *（留空）* |

---

### 场景 3 — 路径参数（URL 中的 REST 风格 ID）

**目标**：客户端调用 `DELETE /addresses/addr_abc123`，上游为 `DELETE https://api.example.com/v1/addresses/addr_abc123`。

**网关路由**：`DELETE /addresses/:id`

**Upstream Call**：

| 字段 | 值 |
|------|-----|
| Method | `DELETE` |
| URL | `https://api.example.com/v1/addresses/{{trigger.params.id}}` |

> ⚠️ 网关路径**必须**声明 `:id`，否则 `trigger.params.id` 为空，上游 URL 变为 `.../addresses/`，通常导致 404。

---

### 场景 4 — ID 来自查询字符串而非路径

**目标**：客户端调用 `DELETE /addresses?id=addr_abc123`，上游 URL 中 ID 作为路径段。

**网关路由**：`DELETE /addresses`

**Upstream Call**：

| 字段 | 值 |
|------|-----|
| Method | `DELETE` |
| URL | `https://api.example.com/v1/addresses/{{trigger.query.id}}` |
| Params / Body From | *（如不需要转发全部查询参数则留空；否则参见场景 5）* |

---

### 场景 5 — 路径参数 + 额外查询字符串

**目标**：客户端调用 `DELETE /addresses/addr_abc?user_id=42`，上游为 `DELETE https://api.example.com/v1/addresses/addr_abc?user_id=42`。

**网关路由**：`DELETE /addresses/:id`

**Upstream Call**：

| 字段 | 值 |
|------|-----|
| Method | `DELETE` |
| URL | `https://api.example.com/v1/addresses/{{trigger.params.id}}` |
| Params / Body From | `trigger.query` |

---

### 场景 6 — 发送前对请求进行数据重塑

**目标**：客户端发送 `{ "email": "...", "pw": "..." }`，但上游期望 `{ "username": "...", "password": "..." }`。

**流程**：`Trigger` → `Transform` → `Upstream Call` → `Response`

在 Upstream Call 前配置 Transform 节点，将 `email→username`、`pw→password` 进行映射，然后在 Upstream Call 中：

| 字段 | 值 |
|------|-----|
| Method | `POST` |
| URL | `https://api.example.com/v1/auth/login` |
| Params / Body From | `<transform_node_id>` |

---

### 场景 7 — 链式调用两个上游（用第一个响应作为第二个的输入）

**目标**：通过 ID 获取用户，再用用户的 `accountId` 获取其订单。

**流程**：`Trigger` → `Upstream Call A` → `Upstream Call B` → `Response`

**Upstream Call A**：

| 字段 | 值 |
|------|-----|
| Method | `GET` |
| URL | `https://api.example.com/v1/users/{{trigger.params.userId}}` |

**Upstream Call B**：

| 字段 | 值 |
|------|-----|
| Method | `GET` |
| URL | `https://api.example.com/v1/orders?accountId={{<upstream_call_A_id>.data.accountId}}` |

---

### 场景 8 — 合并多个来源作为上游请求体

**目标**：向上游发送由入站请求体 + 前一个节点提取值合并而成的请求体。

**Upstream Call**：

| 字段 | 值 |
|------|-----|
| Method | `POST` |
| Params / Body From | `trigger.body`、`<previous_node_id>.data` |

两个对象按列表顺序浅合并，后面的条目在键冲突时覆盖前面的。

---

### 场景 9 — 静态请求体

**目标**：无论入站请求是什么，始终向上游发送固定的请求体。

**Upstream Call**：

| 字段 | 值 |
|------|-----|
| Method | `POST` |
| URL | `https://api.example.com/v1/events` |
| Params / Body From | *（留空）* |
| Request Body (JSON) | `{ "type": "ping", "source": "geehoo-gateway" }` |

---

### 场景 10 — 使用项目级凭据进行上游认证

**目标**：不在每条路由中硬编码密钥，复用项目存储的上游凭据。

**Upstream Call**：

| 字段 | 值 |
|------|-----|
| Upstream Auth | `Basic Auth`（或上游所需的认证类型） |
| ☑ Use project parameter | 勾选 |

实际用户名/密码在请求时从项目设置中读取，轮换凭据只需更新项目设置，无需修改每条路由。

---

## 错误响应

网关将上游错误和内部错误统一为以下格式：

```json
{ "error": { "code": "...", "message": "...", "requestId": "..." } }
```

| 状态码 | `code` | 触发条件 |
|--------|--------|---------|
| `4xx`（透传） | `UPSTREAM_ERROR` | 上游返回 4xx；原始状态码和响应体保存在 `error.detail` 中。 |
| `502` | `BAD_GATEWAY` | 上游返回 5xx（响应体**不**透传）。 |
| `503` | `SERVICE_UNAVAILABLE` | 无法连接到上游（DNS/连接失败）。 |
| `504` | `GATEWAY_TIMEOUT` | 上游在 `Timeout (ms)` 内未响应。 |
| `404` | `NOT_FOUND` | 网关中没有与请求路径/方法匹配的路由。 |
| `429` | `RATE_LIMIT_EXCEEDED` | 触发了路由级别的限流。 |
| `401` | `UNAUTHORIZED` | JWT 或 API Key 缺失/无效。 |
| `5xx`（其他） | `INTERNAL_ERROR` | 意外的网关内部错误；详情记录在日志中，可通过 `requestId` 关联。 |

---

## 提示与注意事项

- **`{{...}}` 占位符的值始终会被 URL 编码。** 如果需要原始值（如逗号分隔列表），请在数据源端提前编码。
- **空引用渲染为空字符串**，而不是 `undefined`。如果引用了 `trigger.params.x`，请确保网关路由路径中声明了对应的路径参数。
- **`DELETE`/`HEAD`/`GET` 无法发送 JSON 请求体** — `Params / Body From` 和静态请求体字段对这些方法会转换为查询字符串。
- **敏感请求头默认不转发**。只有 `content-type`、`accept`、`accept-language`、`user-agent` 通过 `trigger.headers` 暴露。
- **推荐使用 `Use project parameter`** 管理上游凭据，不要在路由的认证字段中粘贴真实密钥。

---

## Transform 节点 — 配置指南

**Transform（转换）** 节点用于在编排流程的各节点之间对数据进行重塑、过滤或计算。它从前序节点的输出中读取数据（`Input From`），应用四种转换模式之一，并将结果以自身节点 ID 为键存储，供后续节点引用。

**在流程中的典型位置：**

```
Trigger → Upstream Call → Transform → Response
Trigger → Transform → Upstream Call → Response   （发送前对请求进行重塑）
```

### 字段说明

| 字段 | 用途 |
|------|------|
| **Input From** | 引用任意前序节点的输出（如 `upstream-1.data`、`trigger.body`）。 |
| **Transform Type** | 四种之一：`JMESPath`、`Field Mapping`、`Handlebars Template`、`Sandbox JS`。 |
| **Expression / Mappings / Template / Script** | 各模式的具体配置，见下方各模式说明。 |

Transform 节点的结果以 `<nodeId>` 为键存储，可在下游节点中引用（如作为 Upstream Call 的 `bodyFrom` 或 Response 节点的 `dataFrom`）。

---

### 模式一 — JMESPath

**工作原理：** 对输入数据执行 [JMESPath](https://jmespath.org/) 表达式查询，返回查询结果；求值出错时返回 `null`。

**适用场景：** 提取嵌套字段、过滤数组、投影字段子集 — 任何可用单条查询表达的操作。

**表达式语法速查：**

| 目标 | 表达式 | 示例输入 → 输出 |
|------|--------|----------------|
| 获取嵌套字段 | `data.user.id` | `{data:{user:{id:1}}}` → `1` |
| 获取数组第一项 | `items[0]` | `{items:[{id:1},{id:2}]}` → `{id:1}` |
| 获取第一项的字段 | `items[0].name` | `{items:[{name:"A"}]}` → `"A"` |
| 投影所有名称 | `items[*].name` | `[{name:"A"},{name:"B"}]` → `["A","B"]` |
| 过滤数组 | `` [?status==`publish`] `` | 过滤 status 为 "publish" 的项 |
| 过滤 + 投影 | `` [?status==`publish`].{id:id,name:name} `` | 过滤后只保留 id/name |
| 重命名键 | `{userId: id, title: name}` | `{id:1,name:"A"}` → `{userId:1,title:"A"}` |

> ⚠️ JMESPath 中字符串字面量**必须**使用反引号 `` ` ``，而不是引号。`` [?status==`publish`] `` 是正确的；`[?status=="publish"]` 不起作用。

**示例 — 从 WooCommerce 数组中返回已发布的商品：**

- Input From：`upstream_call-xxx.data`
- Expression：`` [?status==`publish`] ``

**示例 — 返回已发布商品且只保留 id 和 name：**

- Input From：`upstream_call-xxx.data`
- Expression：`` [?status==`publish`].{id: id, name: name} ``

---

### 模式二 — Field Mapping（字段映射）

**工作原理：** 从输入中按 `From` 路径读取每个字段的值，写入新对象的 `To` 路径。路径使用点号表示法，可加可选的前缀 `$.`。缺失的源路径会被静默跳过；输出对象只包含显式映射的字段。

**适用场景：** 在不兼容的 API Schema 之间重命名字段；展平深层嵌套；将扁平字段分组为嵌套结构；在上下游系统之间建立清晰的接口契约。

**路径表示法：**

| 表示法 | 含义 |
|--------|------|
| `$.a.b.c` | 嵌套路径（前缀 `$.` 可选） |
| `a.b.c` | 同上 — `$.` 前缀会自动去除 |

> ⚠️ Field Mapping 路径**不支持**数组下标（如 `items[0].name`）。如需先提取数组元素，请先用 JMESPath Transform，再对结果应用 Field Mapping。

**示例 — 将 CRM 数据适配为内部用户 Schema：**

输入（`upstream_call-crm.data`）：
```json
{ "cust_id": "U-001", "cust_name": "Alice", "addr": { "city": "Beijing", "zip": "100000" } }
```

映射：
| From | To |
|------|----|
| `$.cust_id` | `$.id` |
| `$.cust_name` | `$.displayName` |
| `$.addr.city` | `$.location.city` |
| `$.addr.zip` | `$.location.postcode` |

输出：
```json
{ "id": "U-001", "displayName": "Alice", "location": { "city": "Beijing", "postcode": "100000" } }
```

**示例 — 展平嵌套结构：**

输入：`{ "meta": { "pagination": { "total": 100, "page": 2 } } }`

映射：
| From | To |
|------|----|
| `$.meta.pagination.total` | `$.total` |
| `$.meta.pagination.page` | `$.page` |

输出：`{ "total": 100, "page": 2 }`

---

### 模式三 — Handlebars Template（模板）

**工作原理：** 渲染一个 [Handlebars](https://handlebarsjs.com/) 模板字符串。如果渲染结果是合法 JSON，则自动解析为对象返回；否则作为纯字符串返回。

**可用变量：**

| 变量 | 值 |
|------|----|
| `{{data}}` / `{{data.field}}` | `Input From` 解析后的值 |
| `{{context.nodeId}}` / `{{context.nodeId.field}}` | 任意前序节点的完整结果，以节点 ID 为键 |

**适用场景：** 构建需要合并多节点数据的 JSON 请求体；生成纯文本输出（通知消息、邮件正文）；需要 JMESPath 无法完成的字符串插值时。

> ⚠️ Handlebars 原生不支持 `[0]` 数组下标访问，请改用 `.[0]`（点号前缀）：`{{data.[0].name}}`。如果输入是数组，建议先用 JMESPath Transform 提取元素。

**示例 — 返回数组的第一项（输入为数组）：**

```handlebars
{
  "id": "{{data.[0].id}}",
  "name": "{{data.[0].name}}"
}
```

**示例 — 合并两个上游调用结果构建请求体：**

- Input From：`upstream-user.data`
- Template：
```handlebars
{
  "userId": "{{data.id}}",
  "orderId": "{{context.upstream-order.data.orderId}}",
  "note": "Order for {{data.name}}"
}
```

**示例 — 生成纯文本通知消息：**

```handlebars
Hello {{data.name}}, your order #{{context.upstream-order.data.id}} has been confirmed.
```
输出为字符串（非 JSON），可直接用作 Response 节点的响应体。

---

### 模式四 — Sandbox JS（沙箱 JavaScript）

**工作原理：** 在 [QuickJS](https://bellard.org/quickjs/) 沙箱（`quickjs-emscripten`）中执行任意 JavaScript，与 Node.js 宿主完全隔离 — 无 `process`、无网络、无文件系统。CPU 硬限制：**100ms**。超时、语法错误或运行时错误时返回 `null`。

**可用变量：**

| 变量 | 值 |
|------|----|
| `input` | `Input From` 解析后的值（通过 JSON 序列化深拷贝） |
| `context` | 所有前序节点结果的映射，以节点 ID 为键（同样深拷贝） |

脚本**必须**使用 `return` 语句返回结果。

**适用场景：** JMESPath 无法表达的复杂逻辑 — 算术运算、多步计算、条件字段包含、跨多节点聚合、自定义排序/分组。

**示例 — 过滤并丰富数组：**

```js
return input
  .filter(p => p.status === 'publish' && parseFloat(p.price) > 0)
  .map(p => ({
    id: p.id,
    name: p.name,
    price: parseFloat(p.price),
    onSale: p.on_sale
  }))
```

**示例 — 跨节点聚合：**

```js
const user = context['get-user'].data
const perms = context['get-permissions'].data.permissions
return {
  id: user.id,
  name: user.name,
  roles: perms.map(p => p.role),
  isAdmin: perms.some(p => p.role === 'admin')
}
```

**示例 — 返回前去除敏感字段：**

```js
const { password, secret, apiKey, ...safe } = input
return safe
```

**示例 — 分页元数据计算：**

```js
const { total, per_page, page } = input
return {
  total,
  perPage: per_page,
  currentPage: page,
  totalPages: Math.ceil(total / per_page),
  hasNext: page < Math.ceil(total / per_page),
  hasPrev: page > 1
}
```

---

### 如何选择合适的模式

```
任务能用单条 JSON 路径查询/过滤/投影完成？
    → JMESPath   （最快、可读性最好）

需要在两个 Schema 之间重命名/重构字段？
    → Field Mapping   （显式、无需代码）

需要将多个节点的数据合并为一个字符串或 JSON？
    → Handlebars Template   （最适合跨节点字符串插值）

需要循环、算术、条件判断或其他任意逻辑？
    → Sandbox JS   （最强大；100ms CPU 上限）
```

---

### 常用 Transform 配方

#### 原样返回完整数组
直接删除 Transform 节点，将 Response 节点的 `Data From` 设置为 `upstream_call-xxx.data`。

#### 按字段值过滤数组
- 模式：JMESPath
- Expression：`` [?status==`publish`] ``

#### 将数组投影为更少的字段
- 模式：JMESPath
- Expression：`[*].{id: id, name: name}`

#### 一步完成过滤 + 投影
- 模式：JMESPath
- Expression：`` [?status==`publish`].{id: id, name: name} ``

#### 从数组中提取单个元素
- 模式：JMESPath
- Expression：`[0]`（第一项）或 `[-1]`（最后一项）

#### 重命名字段（Schema 适配）
- 模式：Field Mapping
- 每个需要重命名的字段添加一条映射记录

#### 从两个上游响应构建请求体
- 模式：Handlebars Template
- 将 `Input From` 设为第一个上游节点；通过 `{{context.nodeId.data.field}}` 引用第二个节点的数据

#### 去除敏感字段
- 模式：Sandbox JS
- Script：`const { password, token, ...safe } = input; return safe`

#### 对数组排序
- 模式：Sandbox JS
- Script：`return [...input].sort((a, b) => a.name.localeCompare(b.name))`

#### 客户端分页
- 模式：Sandbox JS
- Script：
```js
const page = context['trigger'].query.page || 1
const size = context['trigger'].query.size || 10
const start = (page - 1) * size
return {
  items: input.slice(start, start + size),
  total: input.length,
  page: Number(page),
  totalPages: Math.ceil(input.length / size)
}
```

---

## Loop 节点 — 配置指南

**Loop（循环）** 节点会反复执行某个目标节点，将每次迭代的结果累积到一个数组中，当 JMESPath 停止条件为真或达到迭代上限时结束。该数组以循环节点自身的 ID 为键存储，可被后续节点引用。

**在流程中的典型位置：**

```
Trigger → Transform（构建 page=1 查询参数）→ Upstream Call → Loop → Merge/Response
```

### 字段说明

| 字段 | 是否必填 | 用途 |
|------|----------|------|
| **Target Node** | 是 | 每次迭代重新执行的节点，可以是除 `trigger`、`response`、`loop` 以外的任意节点类型。 |
| **Stop Condition** | 是 | 对目标节点最新结果求值的 JMESPath 表达式，返回真值时停止循环。 |
| **Max Iterations** | 否 | 迭代上限（默认 `10`），引擎强制执行最高 **50** 次的硬上限。 |
| **Aggregate Results From** | 否 | JMESPath 风格的引用（如 `nodeId.data.items`），用于从每次迭代结果中提取特定字段。省略时追加目标节点的完整结果；若提取值本身是数组，其元素会被展开（一级展平）后并入累积器。 |

---

### 示例一 — 分页拉取（收集所有页）

**目标**：上游 API 每次返回一页数据（`GET /orders?page=N`），拉取所有页并在单个响应中返回全部订单。

**难点**：上游查询参数 `page` 必须每次迭代递增。解决方案是在流程中将一个 Transform 节点置于 Upstream Call *之前*。Loop 节点的目标是 **Upstream Call**；由于 Transform 节点作为前驱边连接到 Upstream Call，每次 Upstream Call 被调用时 Transform 都会自动先执行。

> **page 追踪原理**：Transform（Sandbox JS）节点读取前一次迭代的响应来计算下一页码，并将 `{ page: N }` 作为输出。Upstream Call 的 `Params / Body From` 设置为 `<transform_id>`，因此每次迭代都能获取最新递增后的页码。

**逐步节点配置：**

**1. `transform_page` — Sandbox JS Transform**

| 字段 | 值 |
|------|-----|
| Input From | `call_orders` *（上游调用节点 — 首次调用时为 `undefined`，视为 `null`）* |
| Transform Type | Sandbox JS |
| Script | 见下方 |

```js
// input 是上一次迭代的响应（首次调用时为 null）
const prevPage = (input && input.data && input.data.page) ? input.data.page : 0
return { page: prevPage + 1 }
```

第一次迭代时 `input` 为 `null`，所以 `page` 变为 `0 + 1 = 1`。之后每次迭代从上次响应中读取 `page` 并递增。

**2. `call_orders` — Upstream Call**

| 字段 | 值 |
|------|-----|
| Method | `GET` |
| URL | `https://api.example.com/orders` |
| Params / Body From | `transform_page` |

每次迭代发送给上游的查询字符串依次为 `?page=1`、`?page=2`……

**3. `loop_pages` — Loop**

| 字段 | 值 |
|------|-----|
| Target Node | `call_orders` |
| Stop Condition | `` length(data.items) == `0` `` |
| Max Iterations | `20` |
| Aggregate Results From | `call_orders.data.items` |

停止条件对 `call_orders` 的**最新**结果求值。当上游返回空的 `items` 数组时，说明没有更多页，循环停止。每次迭代的 `data.items` 数组被展开并入累积器，最终生成包含所有订单的扁平列表。

**4. `response` — Response**

| 字段 | 值 |
|------|-----|
| Data From | `loop_pages` |

**最终响应：**
```json
[
  { "id": 1, "amount": 100 },
  { "id": 2, "amount": 200 },
  { "id": 3, "amount": 150 }
]
```

**流程图：**
```
Trigger → transform_page → call_orders ↘
                    ↑________________________loop_pages → Response
```

> `transform_page` 是 `call_orders` 在图边中的前驱节点。Loop 节点的目标是 `call_orders`；由于存在 `transform_page → call_orders` 这条边，引擎每次调用 `call_orders` 时都会先执行 `transform_page`。

---

### 示例二 — 轮询等待异步任务完成

**目标**：提交任务后，轮询其状态，直到 `status` 不再是 `"pending"`。

**`call_status` — Upstream Call**

| 字段 | 值 |
|------|-----|
| Method | `GET` |
| URL | `https://api.example.com/jobs/{{trigger.params.jobId}}` |

**`loop_poll` — Loop**

| 字段 | 值 |
|------|-----|
| Target Node | `call_status` |
| Stop Condition | `` status != `pending` `` |
| Max Iterations | `10` |
| Aggregate Results From | *（留空 — 每次轮询收集完整响应）* |

循环最多执行 10 次。一旦上游返回的 `status` 不是 `"pending"`，循环立即停止。结果是包含所有轮询响应的数组，最后一个元素反映最终状态。

如需只返回最终状态响应，在 Loop 之后添加 Transform：

- 模式：JMESPath
- Expression：`[-1]` *（数组的最后一个元素）*

---

### 停止条件参考

停止条件是一个 **JMESPath 表达式**，对目标节点的最新完整结果（而非累积数组）求值。

| 场景 | 表达式 |
|------|--------|
| 响应体中的 `items` 数组为空 | `` length(data.items) == `0` `` |
| 已到达最后一页（`page >= totalPages`） | `` data.page >= data.totalPages `` |
| 状态字段不是 "pending" | `` status != `pending` `` |
| 布尔型 `done` 标志为 true | `data.done` |
| 响应数组本身为空 | `` length(@) == `0` `` |

> JMESPath 中字符串字面量使用反引号 `` ` ``，而非引号；数字字面量同样使用反引号：`` `0` ``。

---

### 常见陷阱

- **停止条件始终不为真** → 循环将一直运行到 `maxIterations` 上限。请仔细检查 JMESPath 路径是否与实际响应结构匹配。
- **用于递增页码的 Transform 节点必须作为 Upstream Call 的前驱边**，而非 Loop 节点的前驱边。Loop 节点本身只控制以目标节点为根的子图被重复执行的次数。
- **`aggregateResultsFrom` 会展平一层**：如果提取值为 `[1, 2, 3]`，经过 3 次迭代后 Loop 结果为 `[1, 2, 3, 4, 5, 6, 7, 8, 9]`，而不是 `[[1,2,3],[4,5,6],[7,8,9]]`。这是为分页场景设计的有意行为。
- 引擎侧的硬上限为 **50 次迭代**，将 `maxIterations` 设为更大的值不会有任何效果。
