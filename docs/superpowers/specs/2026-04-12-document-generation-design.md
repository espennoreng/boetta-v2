# Document Generation from DOCX Templates

## Overview

Enable the byggesak managed agent to generate documents from user-uploaded DOCX templates. The user uploads a Word template with `{{placeholders}}` in the chat. The agent analyzes the template, gathers case data using existing tools, asks the user for any missing fields, fills in the placeholders using `docxtemplater`, converts to PDF with LibreOffice, and outputs both DOCX and PDF.

## Scope

### In scope (PoC)

- User uploads DOCX template via existing chat file upload
- Agent identifies `{{placeholders}}` in the template
- Agent fills placeholders from case data (existing tools)
- Agent asks user for any fields it cannot fill automatically
- Agent generates filled DOCX using `docxtemplater` + `pizzip`
- Agent converts to PDF using `libreoffice --headless --convert-to pdf`
- Both files written to `/mnt/session/outputs/`
- Backend retrieves files via Files API, exposes download links in chat

### Not in scope

- Template administration per organization (future)
- Validation that all placeholders were filled
- History of generated documents

## Architecture

### Where generation happens

All document generation runs inside the managed agent container. No new custom tools are needed — the agent uses its existing `agent_toolset` capabilities (bash, read, write).

### Environment changes

Add packages to the managed agent environment:

- **npm**: `docxtemplater`, `pizzip`
- **apt**: `libreoffice-writer`

### System prompt changes

Extend the byggesak agent system prompt with instructions for document template handling:

1. When receiving a DOCX file, read it and identify `{{placeholder}}` patterns
2. Use existing tools (`get_checkpoints`, `get_checkpoint_detail`, etc.) to gather case data
3. Map case data to placeholders
4. Identify any placeholders that cannot be filled from available data
5. Ask the user for all missing fields in a single message
6. Write and execute a Node.js script using `docxtemplater` to fill the template
7. Convert the filled DOCX to PDF using LibreOffice
8. Copy both files to `/mnt/session/outputs/`

### No new custom tools

The agent already has access to `bash`, `read`, and `write` via `agent_toolset_20260401`. Document generation is handled by:

1. Agent writes an inline Node.js script that uses `docxtemplater` + `pizzip`
2. Agent runs the script via `bash`
3. Agent runs `libreoffice --headless --convert-to pdf` via `bash`

## Flow

```
User uploads mangelbrev_mal.docx + "Fyll ut for sak 123"
  |
  v
Agent receives file, reads it, identifies {{placeholders}}
  |
  v
Agent calls existing tools to gather case data
(get_checkpoints, get_checkpoint_detail, search_lovdata, etc.)
  |
  v
Agent checks: can all placeholders be filled?
  |--- No ---> Agent asks user for missing fields (single message)
  |            User responds
  |            <---
  v
Agent writes Node.js script:
  - Reads template with pizzip
  - Fills placeholders with docxtemplater
  - Writes filled DOCX to /mnt/session/outputs/
  |
  v
Agent runs: libreoffice --headless --convert-to pdf
  - Writes PDF to /mnt/session/outputs/
  |
  v
Backend fetches files via Files API
  |
  v
User sees download links for DOCX + PDF in chat
```

## Changes Required

### 1. Environment configuration (`lib/agent-manager.ts` or environment setup)

Add `docxtemplater`, `pizzip` (npm) and `libreoffice-writer` (apt) to the environment packages.

### 2. System prompt (`lib/agents/byggesak/agent.ts`)

Add document generation instructions to the system prompt.

### 3. File download API route (new: `app/api/files/[fileId]/route.ts`)

New API route that fetches a file from the managed agent session via Files API and returns it as a download.

### 4. Chat UI — download link rendering (`components/` or `hooks/`)

Render download links in the chat when the agent produces output files. Detect when files are available in `/mnt/session/outputs/` and show them to the user.
