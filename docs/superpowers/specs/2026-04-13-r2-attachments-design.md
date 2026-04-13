# R2 Attachments + Anthropic Files API

## Goal

Move chat file uploads off the inline base64 path (which forces every byte through the Vercel proxy and caps us at 25 MB) onto **Cloudflare R2** with **direct browser uploads**, persist a row per attachment in Neon, and upload each file once to the **Anthropic Files API** so subsequent chat turns reference it by `file_id` instead of re-sending bytes.

This is the MVP. Thumbnails, virus scanning, lifecycle policies, custom domains, multipart, sandbox-mounted resources (Session Resources), and an org-wide file library are explicit non-goals — see *Non-goals*.

## Source-of-truth model (mental model)

Three locations hold a copy or pointer for every uploaded file. Keep them straight:

| Location | What it holds | Who reads it | Lifetime |
|---|---|---|---|
| **R2 bucket** | Canonical bytes | Browser (chat UI), your server | Permanent (until you delete) |
| **Anthropic Files API** | A copy Claude can see, keyed by `file_id` | The model, when an event references the `file_id` | Anthropic's retention (treat as cache; can re-upload from R2 on 404) |
| **Anthropic event log** | A pointer (`{type:'document', source:{type:'file', file_id}}`) inside a `user.message` event | The agent's conversation history | Tied to the session |

**R2 is the source of truth.** The Files API copy is a derived cache so the model can read the file. The event log only stores pointers — never bytes you'd render in a browser.

## Decisions

- **Object store:** Cloudflare R2 (S3-compatible, free egress, one bucket per environment).
- **Upload path:** Browser → R2 via **presigned PUT URL** issued by our API. Bytes never traverse the Next.js proxy.
- **SDK:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, configured with `region: "auto"` and `endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. (Required values per Cloudflare R2 docs.)
- **Agent integration:** First time a user references an attachment, `/api/chat` fetches it from R2 and uploads it to `client.beta.files`, persisting the returned `file_id`. Every chat turn that references the file (this one, any later turn, any later session) sends a tiny content block: `{type: 'document'|'image', source: {type: 'file', file_id}}`. Bytes are never re-sent to Anthropic after the first upload. We stop sending base64 over the chat request.
- **Reconnect/resume:** Anthropic's event log is durable. On SSE drop, the client lists past events then tails the live stream (Pattern 1: list-then-tail with `event.id` dedupe). No file re-upload involved; `file_id`s in the log keep working.
- **Files API as a cache, not a store:** R2 is canonical. If a `file_id` ever returns 404 on send (Anthropic-side retention is not contractually pinned), the server transparently re-uploads from R2 and stores the new `file_id`.
- **Persistence:** New `attachments` table in Neon. One row per upload, owned by `clerkOrgId` and tagged with the `anthropicSessionId` it was first uploaded into. Cross-session re-reference within the same org is allowed.
- **Key layout:** `org/{clerkOrgId}/session/{anthropicSessionId}/{uuid}-{safeFilename}` — chosen now even though we won't slice on the prefixes in the MVP UI, because reshuffling keys later is expensive.
- **Download:** `GET /api/files/[id]` — auth-checks `orgId`, then 302-redirects to a short-lived presigned GET URL.
- **Auth:** All upload/download routes go through `requireActive()` (existing Clerk + entitlement gate). R2 credentials are server-only.
- **Size cap:** 100 MB per file at MVP (single PUT well under R2's 5 GB single-PUT ceiling). The existing 25 MB Vercel proxy limit no longer applies because file bytes don't pass through the proxy.
- **Allowed types:** PDF, PNG, JPEG, WebP at MVP. Mirrors what the agent today accepts.

## Architecture

```
Browser
  │
  │  1. POST /api/uploads/presign  { filename, mime, size, sessionId }
  │     ─ requireActive() → orgId
  │     ─ validate mime + size
  │     ─ INSERT attachments row, status = 'pending'
  │     ─ return { attachmentId, putUrl, headers: { "Content-Type": mime } }
  │
  │  2. PUT  putUrl   (file bytes, Content-Type header MUST match)
  │     ─ direct to R2; CORS preflight first; R2 returns 200 + ETag
  │
  │  3. POST /api/uploads/[id]/complete   { etag }
  │     ─ flips attachments.status to 'uploaded'
  │
  │  4. POST /api/chat  { message, sessionId, attachmentIds: [...] }
  │     ─ NO base64 payload
  │
  ▼
Next.js /api/chat (Node runtime)
  ├─ load attachment rows by id (must match orgId + status='uploaded')
  ├─ for each row WHERE anthropic_file_id IS NULL:
  │    GetObjectCommand to R2 → stream Body
  │    client.beta.files.upload({ file: stream, purpose: 'agent' })
  │    UPDATE attachments SET anthropic_file_id = ...
  ├─ events.send(sessionId, { events: [{
  │    type: 'user.message',
  │    content: [
  │      { type: 'document'|'image',
  │        source: { type: 'file', file_id: row.anthropic_file_id } },
  │      ...
  │      { type: 'text', text: message },
  │    ],
  │  }] })
  └─ stream events back over SSE (Pattern 1: list-then-tail)

R2 bucket  ◄──── presigned PUT (browser) / presigned GET (browser, via /api/files/[id])
                 GetObject (server, only on first reference per file)
Neon       ◄──── attachments table (org_id, session_id, r2_key, anthropic_file_id, ...)
Anthropic  ◄──── Files API upload (once per file)
                 events.send with file_id references (every turn that uses the file)
```

For chat-history rendering, the browser fetches `/api/files/[id]` which 302-redirects to a 5-minute presigned R2 GET. **Anthropic's Files API is never touched for human-facing rendering.**

## Database Schema

One new table. All timestamps `timestamptz` with `default now()`.

### `attachments`

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK, `defaultRandom()` | the id used in URLs |
| `clerk_org_id` | `text` not null | tenant scope; matches `session_ownership.clerk_org_id` |
| `clerk_user_id` | `text` not null | who uploaded it |
| `anthropic_session_id` | `text` not null | the chat session this file belongs to |
| `r2_key` | `text` not null | full key, e.g. `org/.../session/.../uuid-name.pdf` |
| `mime` | `text` not null | validated against allow-list |
| `size_bytes` | `bigint` not null | from client; trusted only after upload-complete |
| `original_name` | `text` not null | display only; sanitized for the key |
| `status` | `text` not null | `'pending' | 'uploaded' | 'failed'` |
| `anthropic_file_id` | `text` | Files API id; null until first chat turn that references it. Reused across all later turns and sessions. |
| `created_at` | `timestamptz` not null default `now()` | |
| `uploaded_at` | `timestamptz` | set when client confirms PUT 200 |

Indexes:

- `attachments_session_idx` on `(anthropic_session_id, created_at)` — for "show files in this chat".
- `attachments_org_created_idx` on `(clerk_org_id, created_at)` — for the future "files in this org" view.

No FK to `session_ownership` (Drizzle convention in this repo is plain text Clerk IDs and no FKs across the app/Anthropic boundary).

## Upload Flow (detailed)

### 1. `POST /api/uploads/presign`

Request body:

```ts
{ sessionId: string; filename: string; mime: string; size: number; }
```

Server:

1. `requireActive()` → `{ userId, orgId }`.
2. Validate `mime` ∈ allow-list, `size` ≤ 100 MB. Reject with 400 otherwise.
3. Verify `sessionId` belongs to `orgId` via `queries.getSessionOwnership`. 403 otherwise.
4. Build `r2Key = org/${orgId}/session/${sessionId}/${crypto.randomUUID()}-${sanitize(filename)}`.
5. `INSERT INTO attachments (status: 'pending', ...) RETURNING id`.
6. Generate presigned PUT:
   ```ts
   await getSignedUrl(
     s3,
     new PutObjectCommand({ Bucket, Key: r2Key, ContentType: mime }),
     { expiresIn: 600 }, // 10 minutes
   );
   ```
7. Return `{ attachmentId, putUrl, headers: { "Content-Type": mime } }`.

### 2. Browser PUT

Client uploads with `fetch(putUrl, { method: "PUT", body: file, headers: { "Content-Type": mime } })`. The Content-Type header **must exactly match** what the URL was signed with or R2 returns `403 SignatureDoesNotMatch`.

### 3. `POST /api/uploads/[id]/complete`

Lightweight ack: client posts `{ etag }` after PUT 200. Server `UPDATE attachments SET status='uploaded', uploaded_at=now() WHERE id=$1 AND clerk_org_id=$2`. Required so `/api/chat` can reject attachment ids that never finished uploading without a HEAD round-trip to R2 on every chat turn. The ETag is stored only for debugging — we don't validate it.

### 4. `POST /api/chat` change

`files: FileUIPart[]` field is replaced with `attachmentIds: string[]`. Server:

1. `SELECT * FROM attachments WHERE id = ANY($1) AND clerk_org_id = $2 AND status = 'uploaded'` — drop any that don't qualify. (Note: an attachment first uploaded in session A can be referenced from session B if the user re-attaches it; we don't force `anthropic_session_id` to match here. Per-session attribution is preserved on the row's original value.)
2. For each row WHERE `anthropic_file_id IS NULL`:
   - `s3.send(new GetObjectCommand({ Bucket, Key: row.r2_key }))` → stream `Body`.
   - `client.beta.files.upload({ file: body, purpose: 'agent' })` → returns `{ id }`.
   - `UPDATE attachments SET anthropic_file_id = $1 WHERE id = $2`.
3. Build the content blocks for the user message:
   ```ts
   const content = [
     ...rows.map(r => ({
       type: r.mime.startsWith('image/') ? 'image' : 'document',
       source: { type: 'file', file_id: r.anthropic_file_id },
     })),
     { type: 'text', text: message },
   ];
   await client.beta.sessions.events.send(sessionId, {
     events: [{ type: 'user.message', content }],
   });
   ```
4. Stream agent events back over SSE (existing flow, unchanged).

**Idempotency.** If the same attachment id appears in a later turn, `anthropic_file_id` is already set — skip the Files API upload entirely. Same logic across sessions.

**Recovery on stale `file_id`.** If `events.send` returns a 404/invalid file_id error, clear `anthropic_file_id`, re-run step 2 for that row, and retry once. Logged as a metric so we can spot retention regressions early.

## Download Flow

`GET /api/files/[id]`:

1. `requireActive()` → `orgId`.
2. `SELECT * FROM attachments WHERE id = $1 AND clerk_org_id = $2 AND status = 'uploaded'`. 404 otherwise.
3. Issue presigned GET (`expiresIn: 300`, 5 minutes).
4. Respond `302` to the presigned URL. (302 not 200 so the browser handles ranges/streaming and the bytes never touch the function.)

Used for: re-rendering attachments in chat history, "open" / "download" links.

## Environment Variables

```
R2_ACCOUNT_ID          = <cloudflare account id>
R2_ACCESS_KEY_ID       = <r2 api token access key>
R2_SECRET_ACCESS_KEY   = <r2 api token secret>
R2_BUCKET              = boetta-attachments-<env>
R2_PUBLIC_BASE_URL     = (unused at MVP — reserved for future custom domain)
```

Endpoint is derived: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`.

## R2 Bucket Setup (one-time, per environment)

1. Create bucket `boetta-attachments-{dev,prod}` in the Cloudflare dashboard. Region: `auto` (EU jurisdiction selected at bucket-create time for prod).
2. Create an R2 API token scoped to *this bucket only*, with `Object Read & Write`. Save key + secret.
3. Apply the CORS policy below (Dashboard → bucket → Settings → CORS).

### CORS policy

```json
[
  {
    "AllowedOrigins": ["https://<prod-domain>", "https://<vercel-preview-pattern>", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ExposeHeaders: ["ETag"]` lets the browser read the upload's ETag for the `complete` ack. `AllowedHeaders: ["Content-Type"]` is the minimum needed for our presigned PUTs. Vercel preview deployments use rotating subdomains, so before the first deploy the `AllowedOrigins` list must be updated to whatever pattern you settle on (single explicit `*.vercel.app` is acceptable for the dev bucket, never for prod).

## Security

- R2 credentials never ship to the browser. Only presigned URLs do.
- Presigned PUT URLs are narrowly scoped: bucket + key + content-type + 10-minute expiry.
- Presigned GET URLs are 5-minute expiry.
- Every API route runs through `requireActive()` and re-checks `clerk_org_id` ownership before issuing any presigned URL.
- We do **not** trust `mime` or `size` from the client. The presign endpoint enforces an allow-list and the server-side `GetObject` stream into Anthropic naturally truncates a forged `size`. (Real content-type validation belongs in the deferred virus-scan step.)
- No `Content-Disposition` filename echo from user input — `original_name` is rendered as text in the UI, not used in HTTP headers.

## Non-goals (deferred — do not build in this MVP)

- **Sandbox-mounted Session Resources** (`{type:'file', file_id, mount_path}` in `sessions.create`). Useful when the agent reads a file via bash/grep tools rather than seeing it as a content block. Not needed for the byggesak visual-PDF case. Re-evaluate when we add tools that want filesystem access.
- Thumbnails or page-1 PDF previews.
- Virus / malware scanning.
- Object Lock, versioning, lifecycle to cold storage.
- Multipart / resumable uploads.
- SHA-256 dedup.
- Custom-domain serving (e.g. a `files.<your-domain>` host) and edge caching.
- Org-wide file-library UI.
- Migration of existing in-memory attachments (there are none persisted today).

(Note: cross-session `file_id` reuse via the Files API is **in scope** for this MVP. It was previously listed as a non-goal; the design now gets it for free because we key on `attachments.anthropic_file_id` regardless of session.)

## Rollout

Single deploy, no flag:

1. Migration adds `attachments` table.
2. New API routes ship dark.
3. `PromptInput` switches from base64 → presign + PUT + send `attachmentIds`.
4. `/api/chat` removes the base64 path entirely (no parallel code paths — see project memory: avoid backwards-compat shims).
5. `experimental.proxyClientMaxBodySize` and `MAX_REQUEST_BODY_BYTES` are dropped back to defaults in the same PR.

## Future work: org-shared file library (sketch, not in MVP)

Out of scope for this spec, but the MVP is intentionally shaped to make this additive. Captured here so we don't paint ourselves into a corner.

**Use case.** A municipality uploads a corpus of standing documents (kommuneplan, reguleringsplaner, vedtekter, skjema). Any session in that org should let the agent discover and pull in a relevant document on its own.

**Storage.** Sibling prefix in the same R2 bucket — no migration:
```
org/{orgId}/library/{libraryFileId}/{filename}
```

**New table `org_files`** (separate from `attachments`; different lifecycle, different permissions). Columns include `id`, `clerk_org_id`, `r2_key`, `mime`, `size`, `original_name`, `title`, `description` (agent-readable), `category`, `tags text[]`, `anthropic_file_id` (nullable), `uploaded_by`, `created_at`, `archived_at`.

**Two agent tools, not one.**
- `list_shared_files({ category?, query?, tags? })` — returns metadata only.
- `attach_shared_file({ id })` — server uploads to Files API (or reuses cached `anthropic_file_id`) and emits a `user.message` content block referencing it; agent now sees it.

Two tools beats one fused tool because (a) the UI can render an explicit "Agent attached X" card, and (b) the agent can survey 20 candidates before committing to fetch 3.

**System-prompt manifest.** Per session, inject a small preamble listing category names and counts. Without it the agent doesn't know to search.

**Anthropic Files API.** Same `anthropic_file_id` caching pattern as the per-session `attachments` table — `org_files` just gets its own column and the same recovery-on-404 code path. R2 stays the canonical store.

**Permissions.** Read: any active org member. Write: an org admin role (Clerk-side) — to be defined when this is built.

**Still out of scope even when this lands.** Semantic search / RAG over the library (different feature). Cross-org sharing. Version history.

## What's confirmed vs. needs verification at planning time

**Confirmed (from current Anthropic docs):**
- Files API upload returns a stable `file_id`, reusable across sessions.
- Content blocks accept `source: { type: 'file', file_id }` for `document` and `image`.
- Event log is durable; SSE reconnect = list-then-tail with `event.id` dedupe (Pattern 1).

**To verify against `node_modules/@anthropic-ai/sdk` types during planning:**
- Exact field name for the Files API upload `purpose` parameter on the *current* SDK version (`'agent'` is documented but the SDK type is the source of truth).
- Whether `events.send` accepts `image` and `document` content blocks identically to the Messages API (we expect yes; verify).
- Behavior on a stale `file_id` — exact error class to pattern-match for the recovery branch.

If any of these turn out wrong, the fallback is server-side: fetch from R2 → base64 → inline content block. The R2 + persistence + payload-size wins are unchanged; only the "Anthropic upload happens once per file" gain is contingent.
