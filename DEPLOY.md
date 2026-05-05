# Deploy

Single Cloud Run container that serves both the static client (built Vite
bundle: main game on `/`, sandbox on `/sandbox/`) and the WebSocket server
(`/ws`) on the same hostname.

## Local sanity check

```bash
npm run docker:build
npm run docker:run
# → http://localhost:8080      main game
# → http://localhost:8080/sandbox/ sandbox
# → http://localhost:8080/healthz JSON liveness
# → ws://localhost:8080/ws     WebSocket
```

## First-time GCP setup

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com

# Repo for the image (one-time)
gcloud artifacts repositories create boardgame \
  --repository-format=docker \
  --location=europe-west1
```

## Build + deploy

```bash
# Submit the Docker build to Cloud Build (no local Docker daemon needed)
gcloud builds submit \
  --tag europe-west1-docker.pkg.dev/YOUR_PROJECT_ID/boardgame/server:latest

# Deploy to Cloud Run
gcloud run deploy boardgame \
  --image europe-west1-docker.pkg.dev/YOUR_PROJECT_ID/boardgame/server:latest \
  --region europe-west1 \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 1 --memory 512Mi \
  --session-affinity \
  --timeout 3600
```

Notes:
- `--session-affinity` keeps a player on the same instance — important
  because game rooms live in process memory.
- `--max-instances 1` enforces single-process room hosting. If two
  players land on different instances, room state diverges. To scale
  out you'd need a shared room store (Redis), out of scope.
- `--timeout 3600` is the per-request cap; with WebSocket this is the
  max session length before Cloud Run drops the connection. The client
  reconnects via `?room=...&pid=...` URL anyway.
- HTTPS / WSS terminate at Cloud Run automatically; the client uses
  `wss://<host>/ws`.

## Verifying after deploy

```bash
URL=$(gcloud run services describe boardgame --region europe-west1 --format='value(status.url)')
curl -s "$URL/healthz"
# → {"ok":true,"rooms":0,"...":...}
open "$URL"
```

## Updating

```bash
# Push new image + deploy in one go
gcloud run deploy boardgame \
  --source . \
  --region europe-west1
```

`--source .` uses Cloud Build under the hood and reads the local
`Dockerfile`. Faster than building locally and pushing.

## Custom domain (optional)

```bash
gcloud run domain-mappings create \
  --service boardgame \
  --domain game.example.com \
  --region europe-west1
```

Add the printed DNS records at your registrar; Cloud Run handles the TLS cert.
