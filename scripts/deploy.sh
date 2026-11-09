#!/bin/sh
# Build locally, then deploy apps/web to Cloud Run (served at https://arcyou.ai via Cloudflare Worker).
# Usage: pnpm deploy:gcp
set -eu

ACCOUNT="arcsolve.ai@gmail.com"
PROJECT="c0mpiled17-demo-1109"
REGION="asia-northeast3"
SERVICE="assembly-demo"
LOCK="/tmp/assembly-deploy.lock"

cd "$(dirname "$0")/.."

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "Another deploy is running (lock: $LOCK). Wait, or remove the lock if it is stale." >&2
  exit 1
fi
trap 'rmdir "$LOCK"' EXIT

active=$(gcloud config get-value account 2>/dev/null)
if [ "$active" != "$ACCOUNT" ]; then
  echo "gcloud account is '$active', expected $ACCOUNT. Stopping." >&2
  exit 1
fi

echo "==> Local build"
pnpm build

echo "==> Deploying $SERVICE to $PROJECT ($REGION)"
gcloud run deploy "$SERVICE" --source . \
  --project "$PROJECT" --region "$REGION" \
  --set-secrets ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest \
  --memory 1Gi --allow-unauthenticated --quiet

url=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')
rev=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.latestReadyRevisionName)')

echo "==> Checks"
echo "run.app   $(curl -sL -o /dev/null -w '%{http_code}' "$url/")"
echo "arcyou.ai $(curl -sL -o /dev/null -w '%{http_code}' https://arcyou.ai/ || echo 'unreachable from this machine (DNS cache?)')"
echo "Revision: $rev"
echo "Rollback: gcloud run services update-traffic $SERVICE --project $PROJECT --region $REGION --to-revisions=<previous-revision>=100"
