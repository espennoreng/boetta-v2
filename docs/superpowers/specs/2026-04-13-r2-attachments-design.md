# R2 Attachments + Anthropic Session Resources

## Goal

Move chat file uploads off the inline base64 path (which forces every byte through the Vercel proxy and caps us at 25 MB) onto **Cloudflare R2** with **direct browser uploads**, persist a row per attachment in Neon, and hand the file to the Anthropic Beta Managed Agents API as a **Session Resource** so the agent can re-access it on later turns without us re-uploading.

This is the MVP. Cross-session reuse, thumbnails, virus scanning, lifecycle policies, custom domains, multipart, and an org-wide file library are explicit non-goals — see *Non-goals*.

## Decisions

- **Object store:** Cloudflare R2 (S3-compatible, free egress, one bucket per environment).
- **Upload path:** Browser → R2 via **presigned PUT URL** issued by our API. Bytes never traverse the Next.js proxy.
- **SDK:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, configured with `region: "auto"` and `endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. (Required values per Cloudflare R2 docs.)
- **Agent integration:** After upload, `/api/chat` streams the object from R2 into `client.beta.sessions.resources.create(...)`. The agent sees a session-scoped `BetaManagedAgentsFileResource`. We stop sending base64 over the chat request.
- **Persistence:** New `attachments` table in Neon. One row per upload, scoped to `clerkOrgId` and `anthropicSessionId`.
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
  │     ─ return { attachmentId, putUrl, r2Key, headers: { "Content-Type": mime } }
  │
  │  2. PUT  putUrl   (file bytes, Content-Type header MUST match)
  │     ─ goes directly to R2; CORS preflight first
  │     ─ R2 returns 200 + ETag
  │
  │  3. POST /api/chat  { message, sessionId, attachmentIds: [...] }
  │     ─ NO base64 payload
  │
  ▼
Next.js /api/chat (Node runtime)
  ├─ load attachment rows by id (must match orgId + sessionId)
  ├─ for each: GetObjectCommand to R2 → stream into
  │  client.beta.sessions.resources.create(sessionId, { file: stream, ... })
  │  store the returned resource_id back on the attachments row
  ├─ send the agent message referencing those resources
  └─ stream events back over SSE (unchanged)

R2 bucket  ◄──── presigned PUT (browser) / GetObject (server)
Neon       ◄──── attachments table
Anthropic  ◄──── Session Resources API (server, with bytes streamed from R2)
```

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
| `anthropic_resource_id` | `text` | set after registering with the Agents API |
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

1. `SELECT * FROM attachments WHERE id = ANY($1) AND clerk_org_id = $2 AND anthropic_session_id = $3 AND status = 'uploaded'` — drop any that don't qualify.
2. For each row missing `anthropic_resource_id`:
   - `s3.send(new GetObjectCommand({ Bucket, Key: row.r2Key }))` → stream `Body`.
   - `client.beta.sessions.resources.create(sessionId, { file: body, mime: row.mime, name: row.original_name })`.
   - `UPDATE attachments SET anthropic_resource_id = $1 WHERE id = $2`.
3. Send the user message with references to those resources (exact reference shape per `client.beta.sessions.events.send` schema for resource attachments).

Idempotency: if the same attachment id appears in a later turn, the `anthropic_resource_id` is already set → skip the upload, just reference it.

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

- Anthropic Files API / cross-session `file_id` reuse.
- Thumbnails or page-1 PDF previews.
- Virus / malware scanning.
- Object Lock, versioning, lifecycle to cold storage.
- Multipart / resumable uploads.
- SHA-256 dedup.
- Custom-domain serving (e.g. a `files.<your-domain>` host) and edge caching.
- Org-wide file-library UI.
- Migration of existing in-memory attachments (there are none persisted today).

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
- `attach_shared_file({ id })` — server registers the file as a Session Resource (or references its cached `anthropic_file_id`); agent now sees it.

Two tools beats one fused tool because (a) the UI can render an explicit "Agent attached X" card, and (b) the agent can survey 20 candidates before committing to fetch 3.

**System-prompt manifest.** Per session, inject a small preamble listing category names and counts. Without it the agent doesn't know to search.

**Anthropic Files API becomes worth it here.** Per-session attachments re-register every chat — fine. A 30 MB kommuneplan cited in 200 sessions should not. Upload it to the account-level Files API once on first attach, persist the `file_id` on `org_files.anthropic_file_id`, and let `attach_shared_file` short-circuit on subsequent uses. R2 stays the canonical store; `file_id` is a cache.

**Permissions.** Read: any active org member. Write: an org admin role (Clerk-side) — to be defined when this is built.

**Still out of scope even when this lands.** Semantic search / RAG over the library (different feature). Cross-org sharing. Version history.

## Open question

The exact event/reference shape for citing a Session Resource inside `client.beta.sessions.events.send` — the docs surface confirms the resource lifecycle endpoints but the in-message reference shape needs to be confirmed against `node_modules/@anthropic-ai/sdk` types during planning. If the API turns out to require base64 inline even for resources, fall back to: server fetches from R2 → base64 → existing `image`/`document` content blocks. The R2 + persistence + payload-size wins are unchanged; only the agent-side "resource" gain is contingent.
