# AGENTS.md

## Project overview

Chat and voice bot whose replies are written by Claude, grounded in similar conversations retrieved from the LMSYS-Chat-1M dataset (Voyage AI embeddings). One Express service exposes:

- `POST /chat` streams replies to the built-in web UI using server-sent events (SSE)
- `POST /vapi/chat/completions` is an OpenAI-compatible streaming endpoint that Vapi calls during voice calls (protected by a shared secret)
- `GET /config` returns the public voice settings for the UI

Full product context is in `PROJECT_PLAN.md`.

## Tech stack

- **Language:** TypeScript (strict), compiled by `tsc` to CommonJS in `dist/` (`"type": "commonjs"`)
- **Framework:** Express 5
- **AI services:** Anthropic SDK (`@anthropic-ai/sdk`), Voyage AI (built-in `fetch`), Vapi Web SDK (browser, from a CDN)
- **Tests:** Jest + Supertest through `ts-jest`

## Commands

```bash
npm test            # Run all Jest tests
npm run lint        # Run ESLint
npm run typecheck   # Type-check server and browser code
npm run build       # Compile to dist/
```

Run a single test file:

```bash
npx jest src/routes/chat.test.ts
```

## Code style

- 2-space indentation
- Single quotes for strings
- No default exports — use named exports only
- No semicolons
- Keep route handlers thin; extract business logic into separate modules

## Testing rules

- Every route must have a corresponding Supertest integration test
- Test files live alongside the source file they test (e.g. `src/routes/chat.test.ts` next to `src/routes/chat.ts`)
- Test the happy path and at least one error/edge case per route
- Do not mock Express internals; use Supertest to drive the real app
- Never call Voyage, Anthropic, Vapi or Hugging Face from tests; inject the stubs in `src/fixtures/testDeps.ts`
- Use only the synthetic fixtures in `src/fixtures/`, never real LMSYS rows

## Do not

- Never edit `package-lock.json` by hand — let npm manage it
- Never commit secrets, API keys, or `.env` files — use environment variables and add `.env*` to `.gitignore`
- Never commit `data/` (the ingested dataset and its embeddings); the dataset licence forbids redistribution
- Never send private keys to the browser — only the Vapi public key goes out through `GET /config`
