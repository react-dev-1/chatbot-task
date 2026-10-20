# LMSYS Chat & Voice Bot — Project Plan

| | |
|---|---|
| **Delivered by** | Levein Group |
| **Document date** | 20 October 2026 |
| **Status** | Draft — for review |
| **Repository** | `chatbot-task` (Node.js / Express 5 backend + minimal web UI) |

---

## 1. Overview

A general-purpose chat and voice assistant that uses retrieval-augmented generation (RAG) over the [LMSYS-Chat-1M](https://huggingface.co/datasets/lmsys/lmsys-chat-1m) dataset. Three services are involved:

| Service | Role |
|---|---|
| **Voyage AI** | Embeds dataset prompts (once, at ingest) and each user message, so the most similar real conversations can be found. |
| **Anthropic (Claude)** | Writes the reply. The matched LMSYS question → answer pairs are given to it as reference examples, and the reply is streamed back. |
| **Vapi** | Runs voice calls: speech-to-text, text-to-speech, turn-taking and barge-in. It calls this backend as a *custom LLM*, so voice and text share the same RAG pipeline. |

The project is one Node.js service:

- `POST /chat` streams replies to the text UI using server-sent events (SSE).
- `POST /vapi/chat/completions` is an OpenAI-compatible streaming endpoint that Vapi calls during voice calls.
- `GET /config` gives the UI its public settings (the Vapi public key).
- A minimal single-page UI is served from the same app. It needs no build step.

### 1.1 Goals

1. Answer everyday questions (coding, writing, general knowledge, how-to) with fluent, current-model answers grounded in similar real conversations from LMSYS-Chat-1M.
2. Offer text chat and natural, interruptible voice calls, both from a minimal UI, with multi-turn context.
3. Keep unsafe or personal dataset content out of retrieval, and treat retrieved text as reference data, never as instructions.
4. Keep costs visible and controlled. There are three paid APIs (Voyage, Anthropic, Vapi), each with limits and alerts.

### 1.2 Success measures

| Measure | Target |
|---|---|
| Answer rated helpful in a 50-prompt manual check | ≥ 90% |
| Answers that use relevant retrieved examples (spot check) | ≥ 70% of answers where a match passed the threshold |
| Time to first streamed text chunk (text chat) | < 2.5 s |
| Voice response latency (from the end of user speech to the bot speaking) | < 3 s (see the risk in §12) |
| Server start-up, including loading 20k vectors | < 5 s |
| Flagged or redacted conversations in the ingested data | 0 |

---

## 2. What LMSYS-Chat-1M provides

| Property | Detail | How the bot uses it |
|---|---|---|
| Size | 1,000,000 real conversations collected April–August 2023 on Vicuna demo and Chatbot Arena | Source of question → answer pairs. A filtered subset is embedded. |
| `conversation` | List of `{ role, content }` turns (user / assistant) | Split into (prompt → reply) pairs that become retrieval examples |
| `turn` | Number of turns in the conversation | Single-turn pairs for v1 |
| `model` | Which of 25 LLMs replied (e.g. Vicuna, GPT-4, Claude, Llama 2) | Shown as a source in the UI ("based on examples from *gpt-4*, *vicuna-13b*") |
| `language` | Detected language (150+ languages, mostly English) | Filter to English for v1 |
| `openai_moderation` | Per-turn moderation categories and a `flagged` flag | Drop any conversation with a flagged turn |
| `redacted` | Whether personal data was replaced with placeholders like `NAME_1` | Drop redacted conversations |
| Access | Gated. You must accept the licence on Hugging Face and use a token. | `HF_TOKEN` is used by the ingest script only |

**What it does not provide:** current information (nothing after mid-2023), guaranteed-correct answers (replies come from 2023 models), embeddings, or audio. Voyage supplies the embeddings, Claude writes the final answer (and can correct outdated or wrong examples), and Vapi supplies the voice.

---

## 3. Scope

### 3.1 In scope

- An ingest script that downloads and filters the data, embeds the prompts with Voyage, and stores the pairs and vectors.
- An in-memory vector index (cosine top-k).
- A RAG responder: retrieve the top-k pairs, build a Claude request, and stream Claude's reply.
- `POST /chat` (SSE, text chat, with conversation history).
- `POST /vapi/chat/completions` (an OpenAI-compatible custom-LLM endpoint for Vapi), which converts the request to Claude and converts the stream back.
- A minimal UI: a message list, a text box, and a **Start/End call** button (Vapi Web SDK), with live transcripts and source models shown.
- Jest + Supertest tests, ESLint, and a README.

### 3.2 Out of scope (this phase)

- Fine-tuning or training a model on the dataset.
- Claude tool use or agents. Each turn is a single streamed Messages API call.
- Phone-number (PSTN) calls through Vapi. Calls are browser-only.
- User accounts, saved chat history across sessions, or an admin dashboard.
- Redistributing the dataset, its embeddings, or any part of them.

---

## 4. Architecture

```
 Browser (public/index.html)
  ├─ text box ── POST /chat {message, history} ────────────┐
  │          ◄── SSE data:{"delta":…} … [DONE] ────────────┤
  └─ Vapi Web SDK (call button) ◄──WebRTC──► Vapi          │
                                              │            │
          POST /vapi/chat/completions  ◄──────┘            │
          (OpenAI-style in/out, shared secret)             ▼
 Express 5 app (src/app.ts)
  ├─ routes/chat.ts ──┐
  ├─ routes/vapi.ts ──┴─► bot/ragResponder.ts
  └─ routes/config.ts        │  1. embed query ──► embeddings/voyage.ts ──► Voyage AI
                             │  2. top-k search ─► retrieval/vectorIndex.ts (in memory)
                             │  3. build prompt ─► bot/prompt.ts
                             └─ 4. stream ──────► llm/claude.ts ──► Anthropic Messages API
                                                   (@anthropic-ai/sdk, streaming)

 src/scripts/ingestLmsys.ts ── HF datasets-server ─► filter ─► Voyage (document embeddings)
                            └─► data/lmsys-pairs.jsonl + data/lmsys-vectors.f32 + data/meta.json
```

| Module | Responsibility |
|---|---|
| `src/scripts/ingestLmsys.ts` | Fetches from Hugging Face, filters (`src/ingest/filters.ts`), embeds in batches with Voyage, writes the pairs and vectors; can resume after a failure |
| `src/embeddings/voyage.ts` | `embed(texts)` over built-in `fetch`, with retry and back-off (Voyage has no official Node SDK requirement) |
| `src/retrieval/vectorIndex.ts` | Loads normalised Float32 vectors; brute-force cosine top-k search |
| `src/llm/claude.ts` | Wraps `@anthropic-ai/sdk` `client.beta.messages.stream(...)`; produces text deltas; maps refusals and errors |
| `src/bot/prompt.ts` | Builds the system prompt (stable, so it can be cached) and the user turn containing the retrieved examples |
| `src/bot/ragResponder.ts` | `respond({ message, history, channel })` → async generator of `meta` and `delta` events; `channel` is `text` or `voice` |
| `src/bot/speech.ts` | Safety net for voice: removes any leftover markdown or code before the text is sent to Vapi |
| `src/bot/validation.ts` | Validates `/chat` bodies and normalises history into a valid Messages API conversation |
| `src/routes/chat.ts` | Thin SSE handler for text chat |
| `src/routes/vapi.ts` | Thin handler: checks the shared secret, converts the OpenAI `messages` to history plus the latest message, and streams OpenAI `chat.completion.chunk` events |
| `src/routes/config.ts` | Returns `{ vapiPublicKey, vapiAssistantId, customLlmUrl }` |
| `src/app.ts` | `createApp({ responder, config })`: JSON parsing, static files, routes |
| `src/server.ts` | Loads the data and vectors, creates the Voyage and Claude clients, calls `listen` |
| `src/types.ts` | Shared interfaces (`Pair`, `Embedder`, `LlmClient`, `Responder`, …) |
| `public/index.html` + `web/app.ts` | Minimal UI. `web/app.ts` compiles to `dist/public/app.js`; the Vapi Web SDK is loaded as an ES module from a version-pinned CDN URL. |

**Tech stack:** TypeScript (strict) on Node.js, compiled by `tsc` to CommonJS in `dist/`; Express 5; Jest + Supertest through `ts-jest`; ESLint with `typescript-eslint`. The browser code has its own `web/tsconfig.json` (DOM, ES modules).

**New dependencies:**
- `@anthropic-ai/sdk` (runtime): the official Anthropic SDK, chosen over raw `fetch` for typed errors, built-in retries and stream helpers.
- Dev only: `typescript`, `ts-jest`, `typescript-eslint` and `@types/*`, which the TypeScript toolchain needs.

Voyage is called with built-in `fetch`, so it adds no dependency. The Vapi Web SDK is browser-only and loaded from a CDN.

---

## 5. Data pipeline

| Step | Detail |
|---|---|
| Fetch | `GET https://datasets-server.huggingface.co/rows?dataset=lmsys/lmsys-chat-1m&config=default&split=train&offset=N&length=100`, sent with `Authorization: Bearer $HF_TOKEN`. Retries with back-off on 429/5xx. The `/filter` endpoint was dropped because it needs a search index on Hugging Face's side that may not be ready; the English filter runs locally instead. |
| Filter | Drop a conversation if any turn is moderation-flagged or `redacted` is true. Drop a pair if the prompt has fewer than 3 or more than 500 characters, the reply has fewer than 20 or more than 4,000 characters, or the reply is a refusal stub. |
| Shape | Each user turn with the assistant turn that follows becomes `{ id, prompt, reply, model, conversationId }`. |
| Dedupe | Normalise each prompt (lower-case, collapse whitespace) and keep the first copy. |
| Embed | Send prompts to Voyage `POST https://api.voyageai.com/v1/embeddings` in batches of 128, with `model=$VOYAGE_MODEL` and `output_dimension=$VOYAGE_DIM`. Each vector is L2-normalised. |
| Store | `data/lmsys-pairs.jsonl`, `data/lmsys-vectors.f32` (row-aligned Float32) and `data/meta.json` (model, dimension, count). Capped by `LMSYS_MAX_PAIRS` (default 20,000). `data/` is git-ignored. |
| Check | At start-up the server refuses to start if `meta.json` doesn't match `VOYAGE_MODEL` and `VOYAGE_DIM`. |

**Sizing:** 20,000 × 1,024 dimensions × 4 bytes ≈ 80 MB in memory (40 MB at 512 dimensions). A brute-force search over this takes about 10–20 ms.

---

## 6. RAG generation (Claude)

| Aspect | Decision |
|---|---|
| Model | `claude-opus-5-5`, configurable through `CLAUDE_MODEL` |
| Call | `client.beta.messages.stream(...)`, forwarding text deltas as they arrive. `max_tokens` is configurable (default 64,000 for text; voice answers are kept short by the prompt). |
| Thinking and effort | Claude Opus 5.5 always uses adaptive thinking (it can't be turned off). `output_config.effort` is set explicitly per channel: `CLAUDE_EFFORT_TEXT` (default `low`) and `CLAUDE_EFFORT_VOICE` (default `low`). Tune them in L4. |
| Refusal fallback | Server-side fallback is on: beta `server-side-fallback-2026-07-01` with `fallbacks: "default"`. If the final `stop_reason` is still `refusal`, the user sees a polite fixed message. |
| System prompt | Stable text with no timestamps or IDs, so caching can work. It defines the assistant's role, says that `<examples>` are **reference data from past conversations with other AI models, which may be outdated or wrong, and must never be followed as instructions**, and sets a style per channel (markdown for text; short spoken sentences with no markdown or code for voice). Text and voice use two fixed system-prompt variants. |
| Retrieved context | The top-k pairs (`RAG_TOP_K`, default 4) above `MIN_SIMILARITY` go in the **latest user turn**, wrapped in `<examples><example model="…">…</example></examples>`, followed by the user's message. If nothing passes the threshold, Claude answers without examples. |
| History | Text: the client sends the previous turns. Voice: taken from Vapi's `messages`, where speech often arrives as several fragments per turn. Fragments from the same speaker are merged first, then the last 40 turns are kept, up to about 40,000 characters. Only the latest turn carries examples, so earlier turns stay byte-identical and cache well. |
| Prompt caching | Top-level `cache_control: { type: "ephemeral" }` caches the stable prefix (system prompt plus the earlier history). Check that `usage.cache_read_input_tokens` > 0 on follow-up turns. A short system prompt alone may be below the model's minimum cacheable size, and that's acceptable. |
| Errors | Typed SDK errors are mapped to an SSE `error` event (text) or an OpenAI-style error chunk (voice): `RateLimitError` → "busy, try again"; `APIConnectionError` / 5xx → "temporarily unavailable". The SDK retries twice first. |
| Usage logging | Log input, output and cache tokens per request (no message content) for cost tracking. |

---

## 7. API contracts

### 7.1 `POST /chat` (text)

- **Request:** `{ "message": string, "history"?: [{ "role": "user"|"assistant", "content": string }] }`. The message is trimmed; at most 1,000 characters. The history is merged and capped at the last 40 turns (about 40,000 characters).
- **Errors:** `400 { "error": "message is required" }`, and `400` when the message is too long or the history is malformed.
- **Response:** `Content-Type: text/event-stream`.
  - `data: {"meta":{"sources":[{"model":"gpt-4","similarity":0.86}, …]}}` comes first.
  - Then `data: {"delta":"…"}`, repeated, as Claude streams.
  - Then `data: [DONE]`.
  - On failure: `data: {"error":"…"}` and then `[DONE]`.
- Each chunk is flushed immediately. No `compression` middleware is used on this route.

### 7.2 `POST /vapi/chat/completions` (voice, called by Vapi)

- **Auth:** the `Authorization: Bearer <VAPI_CUSTOM_LLM_SECRET>` header must match; otherwise the endpoint returns `401`.
- **Request:** an OpenAI chat-completions body (`messages`, `stream: true`, …). Vapi's own `system` message is ignored, because the server owns the prompt. The last `user` message is the query; earlier `user`/`assistant` messages become the history.
- **Response:** OpenAI-style SSE. Each line is `data: {"id":…,"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"…"}}]}`. The stream ends with a chunk where `finish_reason: "stop"`, then `data: [DONE]`.
- Text goes through `speech.ts` before it is streamed.

### 7.3 `GET /config`

Returns `{ "vapiPublicKey": string }`. Only the **public** key is returned. The Anthropic, Voyage and Vapi private keys never reach the browser.

---

## 8. Voice (Vapi)

| Part | Implementation |
|---|---|
| Call | The browser runs `vapi.start(assistantConfig)` with an inline (transient) assistant: `model.provider = "custom-llm"`, `model.url = PUBLIC_BASE_URL + "/vapi"`, plus a transcriber and a voice chosen in config. Alternatively, a saved assistant can be referenced by `VAPI_ASSISTANT_ID`. |
| Speech-to-text, text-to-speech, barge-in | Handled by Vapi (end-of-speech detection, interruptions, echo cancellation). |
| Transcript | The SDK's `message` events (final transcripts) are added to the same message list as text chat. |
| Latency | Low effort, short voice-style answers, and streaming deltas straight through so Vapi can start speaking on the first sentence. Optional: a Vapi filler phrase ("Let me think…"). |
| Reachability | Vapi's servers must be able to reach `/vapi/chat/completions`. For local development, use a tunnel (e.g. ngrok or cloudflared) and set `PUBLIC_BASE_URL`. |
| Browser support | Vapi uses WebRTC, so voice works in current Chrome, Edge, Firefox and Safari. |
| Security | The public key is restricted to the app's domain in the Vapi dashboard; the custom-LLM endpoint requires the shared secret; a maximum call duration is set in the assistant config. |

---

## 9. Delivery plan

| # | Task | Done when |
|---|---|---|
| L0 | Project hygiene: TypeScript setup (`tsconfig`, `ts-jest`, `typescript-eslint`); `.gitignore` covers `data/`, `dist/` and `.env*`; npm scripts `build`, `typecheck`, `start` and `ingest`; `.env.example`; install `@anthropic-ai/sdk` | `npm run typecheck` and `npm run lint` pass |
| L1 | Voyage client with retry/back-off | Unit tests pass with `fetch` stubbed |
| L2 | Ingest: fetch, filter, embed, store; resumable | With real keys it writes 20k pairs and vectors with no flagged or redacted rows; the filters are unit-tested |
| L3 | Vector index and prompt builder | Unit tests on a synthetic fixture: correct top-k order, threshold respected, examples wrapped and escaped, system prompt byte-stable |
| L4 | Claude client and RAG responder | With the Claude client stubbed, the responder emits `meta` then `delta` events; refusal and error paths are covered; manual 50-prompt check ≥ 90% helpful; effort and `MIN_SIMILARITY` tuned |
| L5 | `/chat` SSE route and `/config` | Supertest covers the happy path, the 400 errors, a Claude error event and a Voyage failure |
| L6 | `/vapi/chat/completions` route | Supertest covers the OpenAI chunk format, `[DONE]`, a `401` without the secret, history mapping and code being removed from speech |
| L7 | Minimal UI: text chat | A typed message streams a reply with its sources shown; follow-up questions use context |
| L8 | Minimal UI: Vapi call | Through a tunnel, a spoken question gets a spoken answer within the latency target; transcripts appear; barge-in works |
| L9 | README: dataset access, the three API keys, ingest, tunnel, run, test; cost notes | A new developer can run it from the README alone |

Tests (`*.test.ts`, next to the code they test) use a small **synthetic** fixture (`src/fixtures/pairs.sample.jsonl` plus tiny low-dimension vectors). They never use real LMSYS rows and never call Voyage, Anthropic or Vapi: the embedder and the Claude client are injected and stubbed.

---

## 10. Configuration

| Variable | Used by | Default / note |
|---|---|---|
| `HF_TOKEN` | Ingest | Required for ingest |
| `VOYAGE_API_KEY` | Ingest, server | Required |
| `VOYAGE_MODEL` | Ingest, server | Must match between ingest and server; confirm the current recommended model in the Voyage docs |
| `VOYAGE_DIM` | Ingest, server | `1024` (or `512` to halve memory) |
| `ANTHROPIC_API_KEY` | Server | Required. Read automatically by the SDK. |
| `CLAUDE_MODEL` | Server | `claude-opus-5-5` |
| `CLAUDE_EFFORT_TEXT` / `CLAUDE_EFFORT_VOICE` | Server | `low` / `low` (tuned in L4) |
| `CLAUDE_MAX_TOKENS` | Server | `64000` |
| `RAG_TOP_K` | Responder | `4` |
| `MIN_SIMILARITY` | Responder | Set in L4 |
| `LMSYS_MAX_PAIRS` | Ingest | `20000` |
| `LMSYS_DATA_DIR` | Server | `data/` |
| `VAPI_PUBLIC_KEY` | Server → `/config` → browser | Required for voice |
| `VAPI_ASSISTANT_ID` | Browser (optional) | Use a saved assistant instead of the inline config |
| `VAPI_CUSTOM_LLM_SECRET` | `/vapi` route | Required. Also entered in the Vapi custom-LLM credential. |
| `PUBLIC_BASE_URL` | UI / assistant config | Public URL (or tunnel URL) that Vapi calls |
| `PORT` | Server | `3000` |

All secrets come from environment variables only and are never committed (`.env*` is git-ignored).

---

## 11. Costs

| Service | Driver | Control |
|---|---|---|
| Anthropic | Input tokens (system prompt, history and up to 4 examples, roughly 2–6k tokens per turn) plus output tokens; Claude Opus 5.5 is $4 / $20 per million tokens | Effort `low`; cap history and example length; prompt caching; workspace spend limit in the Anthropic Console |
| Voyage AI | A one-off embedding of about 20k prompts, plus one short query embedding per message | Small; check the free-token allowance on Voyage's pricing page |
| Vapi | Per minute of call time (platform fee plus the speech-to-text and text-to-speech providers; the LLM is our own) | Spending limit, billing alerts, maximum call duration |
| Hugging Face | Free (gated access only) | — |

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Prompt injection through retrieved LMSYS text | Medium | High | Examples are wrapped in tags and labelled as untrusted reference data in the system prompt; never placed in `system`; filtered at ingest |
| Voice latency too high (embedding + retrieval + Claude time to first token) | Medium | High | Low effort; short voice answers; stream immediately; Vapi filler phrase; measure in L8. If the target is still missed, decide on a faster voice model (open question 2). |
| Retrieved examples are outdated or wrong (2023 models) | High | Medium | The prompt tells Claude to verify and correct the examples, not copy them |
| Unsafe content gets past the filters | Low | High | Moderation and redaction filters; spot-check a sample; Claude's own safeguards; refusal fallback |
| Licence breach (gated dataset, no redistribution) | Medium | High | Never commit `data/`; synthetic test fixtures; check the licence terms before any public deployment |
| API outage or rate limit (Anthropic, Voyage) | Low | High | SDK retries; Voyage back-off; clear error events instead of hung streams |
| Ingest model ≠ query model (vectors don't match) | Low | High | `meta.json` check at start-up |
| Costs run up (three paid APIs) | Medium | Medium | Spend limits on each provider; token usage logging; maximum call duration |
| Vapi can't reach a local server | High (in development) | Medium | Tunnel and `PUBLIC_BASE_URL`, documented in the README |
| Secrets leak | Low | High | Keys only in env vars; `.env*` git-ignored; only the Vapi public key reaches the browser |

---

## 13. Decisions and open questions

**Decided (20 Oct 2026):**

1. English only for v1.
2. `claude-opus-5-5` for both text and voice.
3. Runs locally. Voice calls go through a tunnel (`PUBLIC_BASE_URL`).

**Still open:**

4. Which Vapi voice and transcriber should be used, and what are the monthly budget caps for Anthropic and Vapi? Until this is decided, the inline assistant uses Vapi's default transcriber and voice, set in `public/index.html` so they're easy to change.
