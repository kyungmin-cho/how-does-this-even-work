# Deploy

The web app (`apps/web`) runs on Cloud Run and is served at https://arcyou.ai through a Cloudflare Worker (`arcyou-demo`). No CI/CD: deploy by hand with one command.

```bash
pnpm deploy:gcp
```

`scripts/deploy.sh` checks the gcloud account, runs `pnpm build` (stops on failure), deploys from source with the `Dockerfile`, then checks the run.app URL and arcyou.ai and prints the new revision.

| Item | Value |
|---|---|
| GCP account | arcsolve.ai@gmail.com |
| Project | c0mpiled17-demo-1109 |
| Region | asia-northeast3 |
| Service | assembly-demo |
| Secret | `ANTHROPIC_API_KEY` (Secret Manager, mounted as env var) |

## Rules

- Deploy only with `pnpm deploy:gcp`. Don't run `gcloud run deploy` with other flags.
- Never put the API key in code or files. Read `ANTHROPIC_API_KEY` in server code only; never prefix it with `NEXT_PUBLIC_`.
- After adding a package, commit the updated `pnpm-lock.yaml` (the Docker build uses `--frozen-lockfile`).
- One deploy at a time: the script takes a lock at `/tmp/assembly-deploy.lock`.
- The deploy uploads the working tree as it is, including other sessions' uncommitted edits.
- Report the revision name after a deploy. To roll back:

```bash
gcloud run services update-traffic assembly-demo --project c0mpiled17-demo-1109 --region asia-northeast3 --to-revisions=<previous-revision>=100
```
