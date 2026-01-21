# Fluxim2

Simple Node.js server (no frameworks) that serves a single-page app for generating images via Replicate's FLUX models. The frontend polls the backend for prediction status and downloads the final image when ready.

## Prerequisites
- Node.js 18+
- A Replicate API token available as `REPLICATE_API_TOKEN`

## Running
```bash
REPLICATE_API_TOKEN=your-token node app.js
```

The app will start on http://localhost:3000.
