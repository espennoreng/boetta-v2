# Document Generation from DOCX Templates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the byggesak managed agent to fill out user-uploaded DOCX templates with case data, then output both DOCX and PDF files for download.

**Architecture:** The managed agent container handles all document generation. The environment gets `docxtemplater`, `pizzip` (npm) and `libreoffice-writer` (apt). The system prompt is extended with template-handling instructions. A new API route serves file downloads from the session. The chat UI renders download links when output files are available.

**Tech Stack:** docxtemplater, pizzip, LibreOffice (headless PDF conversion), Anthropic Managed Agents Files API

---

### Task 1: Add packages to managed agent environment

**Files:**
- Modify: `lib/agent-manager.ts:35-48` (getEnvironmentId function)

- [ ] **Step 1: Add npm and apt packages to environment config**

In `lib/agent-manager.ts`, update the `getEnvironmentId` function to include packages:

```typescript
const environment = await client.beta.environments.create({
  name: `${AGENT_TYPE}-env-${Date.now()}`,
  config: {
    type: "cloud",
    networking: { type: "unrestricted" },
    packages: {
      npm: ["docxtemplater", "pizzip"],
      apt: ["libreoffice-writer"],
    },
  },
});
```

- [ ] **Step 2: Verify the app still starts**

Run: `bun dev`
Expected: App starts without errors. The environment packages are only used when creating a new session with Anthropic's API — no local dependencies needed.

- [ ] **Step 3: Commit**

```bash
git add lib/agent-manager.ts
git commit -m "feat: add docxtemplater and libreoffice to agent environment"
```

---

### Task 2: Extend system prompt with document generation instructions

**Files:**
- Modify: `lib/agents/byggesak/agent.ts:7-84` (SYSTEM_PROMPT constant)

- [ ] **Step 1: Add document generation section to system prompt**

In `lib/agents/byggesak/agent.ts`, add the following section at the end of the `SYSTEM_PROMPT` string (before the closing backtick), after the `## Sjekkpunktindeks` section:

```typescript
## Dokumentgenerering

Du kan fylle ut DOCX-maler som brukeren laster opp. Når du mottar en DOCX-fil som ser ut som en mal (inneholder {{plassholdere}}), følg denne prosessen:

### Steg 1: Identifiser plassholdere
Les dokumentet og list opp alle {{plassholdere}} du finner.

### Steg 2: Samle data
Bruk eksisterende verktøy (get_checkpoints, get_checkpoint_detail, search_lovdata, etc.) for å hente saksdata som matcher plassholderne. Bruk også informasjon fra opplastede saksdokumenter.

### Steg 3: Sjekk hva som mangler
Gå gjennom alle plassholdere og identifiser hvilke du IKKE kan fylle ut automatisk fra tilgjengelig data. Spør brukeren om alle manglende felter i én samlet melding. Bruk [svar:]-formatet for enkle valg der det passer.

### Steg 4: Generer dokumentet
Når du har alle verdier, skriv og kjør et Node.js-script som bruker docxtemplater:

\`\`\`javascript
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const fs = require("fs");

const content = fs.readFileSync("/path/to/template.docx");
const zip = new PizZip(content);
const doc = new Docxtemplater(zip, {
  paragraphLoop: true,
  linebreaks: true,
});

doc.render({
  // plassholder: verdi
});

const buf = doc.getZip().generate({ type: "nodebuffer" });
fs.writeFileSync("/mnt/session/outputs/dokument.docx", buf);
\`\`\`

### Steg 5: Konverter til PDF
Kjør: \`libreoffice --headless --convert-to pdf --outdir /mnt/session/outputs/ /mnt/session/outputs/dokument.docx\`

### Steg 6: Bekreft
Fortell brukeren at dokumentene er klare og list opp filene i /mnt/session/outputs/.

Bruk alltid UTF-8 for norske tegn (æøå). Gi filene beskrivende navn basert på dokumenttypen og saksnummeret, f.eks. "mangelbrev-2024-001.docx".
```

- [ ] **Step 2: Verify the app still starts**

Run: `bun dev`
Expected: App starts. The system prompt change only affects new agent sessions.

- [ ] **Step 3: Commit**

```bash
git add lib/agents/byggesak/agent.ts
git commit -m "feat: add document generation instructions to system prompt"
```

---

### Task 3: Add file download API route

**Files:**
- Create: `app/api/files/[fileId]/route.ts`

- [ ] **Step 1: Create the download route**

Create `app/api/files/[fileId]/route.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;

  const file = await client.beta.files.retrieve(fileId);
  const content = await client.beta.files.download(fileId);

  const arrayBuffer = await content.arrayBuffer();

  const contentType = file.name.endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  return new Response(arrayBuffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
    },
  });
}
```

- [ ] **Step 2: Verify the route compiles**

Run: `bun dev`
Expected: App starts without errors. The route is only hit when a file download is requested.

- [ ] **Step 3: Commit**

```bash
git add app/api/files/\[fileId\]/route.ts
git commit -m "feat: add file download API route"
```

---

### Task 4: Stream output files and render download links in chat

**Files:**
- Modify: `lib/agent-manager.ts` (streamWithToolHandling — add file listing after done)
- Modify: `hooks/use-agent-chat.ts` (handle new `files` event type)
- Modify: `components/chat-page.tsx` (render download links)

- [ ] **Step 1: Add file listing to the stream after session goes idle**

In `lib/agent-manager.ts`, add a helper to list session output files and yield them as events. Add this function before `streamWithToolHandling`:

```typescript
async function listSessionOutputFiles(sessionId: string): Promise<
  Array<{ id: string; name: string }>
> {
  const files: Array<{ id: string; name: string }> = [];
  for await (const file of client.beta.files.list({ scope_id: sessionId })) {
    if (file.name.endsWith(".docx") || file.name.endsWith(".pdf")) {
      files.push({ id: file.id, name: file.name });
    }
  }
  return files;
}
```

Then in the `streamWithToolHandling` function, right before `yield { type: "done" }` on line ~320, add:

```typescript
const outputFiles = await listSessionOutputFiles(sessionId);
if (outputFiles.length > 0) {
  yield { type: "files", files: outputFiles };
}
```

- [ ] **Step 2: Handle `files` event in the chat hook**

In `hooks/use-agent-chat.ts`, add `files` to the `SSEEvent` type:

```typescript
interface SSEEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "citations" | "files" | "done" | "error";
  // ... existing fields ...
  files?: Array<{ id: string; name: string }>;
}
```

Add `files` to the `ChatMessage` type:

```typescript
export interface ChatMessage {
  // ... existing fields ...
  files?: FileUIPart[];
  outputFiles?: Array<{ id: string; name: string }>;
}
```

Add a case in the switch statement, before the `done` case:

```typescript
case "files": {
  setMessages((prev) =>
    prev.map((msg) =>
      msg.id === assistantId
        ? { ...msg, outputFiles: event.files }
        : msg,
    ),
  );
  break;
}
```

- [ ] **Step 3: Render download links in chat-page**

In `components/chat-page.tsx`, add a `DownloadLinks` component before the `ChatMessageItem` function:

```typescript
function DownloadLinks({ files }: { files: Array<{ id: string; name: string }> }) {
  return (
    <div className="mt-4 rounded-lg border border-green-200 bg-green-50/50 p-4 dark:border-green-900 dark:bg-green-950/30">
      <div className="mb-2 flex items-center gap-2 text-green-700 dark:text-green-400">
        <span className="text-xs font-medium uppercase tracking-wide">
          Genererte dokumenter
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {files.map((file) => (
          <a
            key={file.id}
            href={`/api/files/${file.id}`}
            download={file.name}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            <span>{file.name.endsWith(".pdf") ? "📄" : "📝"}</span>
            <span>{file.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
```

Then in the `ChatMessageItem` function, render it after the question card (before the closing `</Message>`):

```typescript
{message.outputFiles && message.outputFiles.length > 0 && (
  <DownloadLinks files={message.outputFiles} />
)}
```

- [ ] **Step 4: Verify the app starts and the UI renders correctly**

Run: `bun dev`
Expected: App starts. No visual changes unless the agent produces output files.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-manager.ts hooks/use-agent-chat.ts components/chat-page.tsx
git commit -m "feat: stream output files and render download links in chat"
```

---

### Task 5: Track previously seen files to only show new ones

**Files:**
- Modify: `lib/agent-manager.ts` (listSessionOutputFiles and streamWithToolHandling)

The `listSessionOutputFiles` function lists ALL files in the session, including ones uploaded by the user and from previous turns. We need to track which files we've already seen so we only yield newly generated ones.

- [ ] **Step 1: Track seen file IDs across stream iterations**

In `streamWithToolHandling`, add a `Set` to track file IDs that existed before this turn. At the start of the function, before the while loop, snapshot the existing files:

```typescript
const seenFileIds = new Set<string>();
const existingFiles = await listSessionOutputFiles(sessionId);
for (const file of existingFiles) {
  seenFileIds.add(file.id);
}
```

Then change the file listing before `yield { type: "done" }` to filter:

```typescript
const outputFiles = await listSessionOutputFiles(sessionId);
const newFiles = outputFiles.filter((f) => !seenFileIds.has(f.id));
if (newFiles.length > 0) {
  yield { type: "files", files: newFiles };
  for (const f of newFiles) {
    seenFileIds.add(f.id);
  }
}
```

- [ ] **Step 2: Verify the app starts**

Run: `bun dev`
Expected: App starts without errors.

- [ ] **Step 3: Commit**

```bash
git add lib/agent-manager.ts
git commit -m "feat: only show newly generated files per turn"
```

---

### Task 6: End-to-end manual test

- [ ] **Step 1: Create a test DOCX template**

Create a simple test template `mangelbrev_mal.docx` with placeholders like `{{saksnummer}}`, `{{dato}}`, `{{adresse}}`. You can create this with any word processor — save as .docx with the literal text `{{saksnummer}}` etc.

- [ ] **Step 2: Start the dev server and test the flow**

Run: `bun dev`

1. Open the app in a browser
2. Upload `mangelbrev_mal.docx` in the chat
3. Say "Fyll ut denne malen for en byggesak"
4. Verify the agent identifies placeholders
5. Verify the agent asks for missing data
6. Provide the missing data
7. Verify the agent generates DOCX + PDF
8. Verify download links appear in the chat
9. Click the download links and verify the files open correctly

- [ ] **Step 3: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: adjustments from manual testing"
```
