# LMSYS Chat & Voice Bot

A chat and voice assistant that answers with **Claude**, using similar real conversations from the [LMSYS-Chat-1M](https://huggingface.co/datasets/lmsys/lmsys-chat-1m) dataset as reference examples:

1. The user's message is embedded with **Voyage AI**.
2. The closest dataset questions are found in an in-memory vector index.
3. **Claude** (`claude-opus-5-5`) streams an answer, using those question → answer pairs as untrusted reference data.
4. Voice calls run through **Vapi**, which calls this server as a custom LLM.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the full design.

## Requirements

- Node.js 22.9 or later (24 recommended)
- A Hugging Face account that has accepted the [LMSYS-Chat-1M terms](https://huggingface.co/datasets/lmsys/lmsys-chat-1m), and a read token
- API keys for Voyage AI and Anthropic
- For voice: a Vapi account, plus a tunnel such as [ngrok](https://ngrok.com) or `cloudflared` so Vapi can reach your machine

## Setup

```bash
npm install
cp .env.example .env    # then fill in the keys
npm run ingest          # builds, then downloads, filters and embeds about 20k pairs into data/
npm start               # builds, then serves http://localhost:3000
```

The project is written in TypeScript. `npm run build` compiles `src/` to `dist/` (CommonJS) and `web/app.ts` to `dist/public/app.js`. `npm start` and `npm run ingest` run the build first.

`npm run ingest` can be stopped and re-run, and it resumes where it stopped. To start again from scratch, or to change `VOYAGE_MODEL` or `VOYAGE_DIM`, delete `data/` first. The server refuses to start if the stored vectors don't match the configured model.

> The dataset licence does not allow redistribution. `data/` is git-ignored; never commit it or share it.

## Voice setup (Vapi)

1. Start a tunnel to port 3000, for example `ngrok http 3000`, and set `PUBLIC_BASE_URL` to the HTTPS URL it prints.
2. Pick a long random string for `VAPI_CUSTOM_LLM_SECRET`.
3. In the Vapi dashboard, add a **Custom LLM** provider credential whose API key is that same secret. Vapi sends it as `Authorization: Bearer …` when it calls `POST /vapi/chat/completions`.
4. Set `VAPI_PUBLIC_KEY`. Restrict that key to your origin in the Vapi dashboard.
5. Restart the server and click **Start call**.

The page starts an inline assistant pointing at `PUBLIC_BASE_URL/vapi`. To change its voice or transcriber, edit `inlineAssistant()` in [web/app.ts](web/app.ts). To use an assistant saved in the dashboard instead (with the model set to Custom LLM and the same URL), set `VAPI_ASSISTANT_ID`.

## Configuration

All configuration comes from environment variables. See [.env.example](.env.example).

| Variable | Purpose |
|---|---|
| `HF_TOKEN` | Hugging Face token (ingest only) |
| `LMSYS_MAX_PAIRS` | Number of pairs to ingest (default 20000) |
| `VOYAGE_API_KEY`, `VOYAGE_MODEL`, `VOYAGE_DIM` | Embeddings; the model and dimension must match between ingest and server |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Claude (default `claude-opus-5-5`) |
| `CLAUDE_EFFORT_TEXT`, `CLAUDE_EFFORT_VOICE` | Effort per channel (`low` … `max`, default `low`) |
| `CLAUDE_MAX_TOKENS` | Output cap (default 64000) |
| `RAG_TOP_K`, `MIN_SIMILARITY` | How many examples to include, and the minimum cosine similarity |
| `VAPI_PUBLIC_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_CUSTOM_LLM_SECRET`, `PUBLIC_BASE_URL` | Voice |
| `PORT` | HTTP port (default 3000) |

## API

- `POST /chat` takes `{ message, history? }` and returns SSE events in this order: `{"meta":{"sources":[…]}}`, then `{"delta":"…"}` (repeated), then `[DONE]`. An `{"error":"…"}` event is sent if something fails.
- `POST /vapi/chat/completions` is an OpenAI-compatible streaming endpoint for Vapi and requires the shared secret.
- `GET /config` returns only the public voice settings.

## Development

```bash
npm test                              # all tests (no network: Voyage, Claude and Vapi are stubbed)
npx jest src/routes/chat.test.ts      # one file
npm run typecheck                     # tsc for the server and browser code
npm run lint
```

| Path | Contents |
|---|---|
| `src/` | Server code (`app.ts`, `server.ts`, routes, RAG pipeline), with tests next to each file |
| `src/scripts/ingestLmsys.ts` | Dataset ingest |
| `web/app.ts` | Browser code for the minimal UI |
| `public/index.html` | The page |

The tests use the synthetic fixture in `src/fixtures/`, never real dataset rows.

## Costs

Each message costs one Voyage query embedding plus one Claude request (the system prompt, recent history and up to 4 examples). Voice calls also cost Vapi call minutes. Set spend limits in the Anthropic Console and the Vapi dashboard. The server logs token usage, including cache reads, for each Claude request.
