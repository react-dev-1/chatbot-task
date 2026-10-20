# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- Shared rules for all agents live in AGENTS.md. Everything below is Claude Code-specific. -->

@AGENTS.md

## Claude-only notes

- When running a single test, prefer `npx jest <path>` over `npm test -- <path>` — it avoids npm arg-parsing quirks on Windows.
- The SSE routes (`/chat` and `/vapi/chat/completions`) must flush each chunk immediately. Express 5 supports this natively; do not add `compression` middleware to that route, as it buffers output and breaks streaming.
- Before suggesting a new npm dependency, check whether the need can be met with Node.js built-ins or code already in the repo.
- `PROJECT_PLAN.md` documents the architecture, API contracts and delivery tasks (L0–L9) — read it before changing the RAG pipeline, prompts or endpoint contracts.
