# CrofChat

A focused LibreChat-style MVP for CrofAI: paste or configure a CrofAI API key, fetch available models, and chat through CrofAI's OpenAI-compatible API.

## What is included

- CrofAI `/v1/models` discovery.
- Streaming `/chat/completions` chat.
- Reasoning delta display for models that stream `reasoning_content`.
- Vision prompts using image URLs.
- Raw tool schema forwarding and streamed tool-call display.
- CrofAI-supported request controls: `temperature`, `top_p`, `max_tokens`, `seed`, and `stop`.
- Browser-local conversations.
- Docker and Docker Compose hosting.

No multi-provider routing, agents, auth system, prompt marketplace, file RAG, web search, or other LibreChat extras are included.

## Run locally

```sh
npm start
```

Open `http://localhost:3000`.

The app has no runtime npm dependencies, so `node server/index.js` works too on Node 20+.

## Docker

```sh
cp .env.example .env
docker compose up --build
```

Set `CROFAI_API_KEY` in `.env` for a server-configured key. If it is blank, users can paste a key in the UI. The app never exposes a server-configured key to the browser.

## CrofAI endpoints

The app allows CrofAI's OpenAI-compatible endpoints:

- `https://crof.ai/v1`
- `https://crof.ai/v2`
- `https://ai.nahcrof.com/v1`
- `https://ai.nahcrof.com/v2`

The official CrofAI docs describe OpenAI-compatible chat completions, streaming, reasoning deltas, tools, vision content, `/v1/models`, and the supported parameters used here.
