# pointerBuild — Setup Guide

Self-hosted replacement for Expo EAS. Five components, one VPS, one developer.

| Component | Purpose | Port |
|-----------|---------|------|
| `pointer-updates` | OTA update server (EAS Updates) | 3001 |
| `pointer-deploy` | Build distribution + channels (EAS Submit/Deploy) | 3002 |
| `pointer-cli` | `npx pointer …` (EAS CLI) | n/a |
| `pointer-sdk` | Client SDK + Expo hook | n/a |
| GitHub Actions | macOS / Ubuntu build runners (EAS Build) | n/a |
| Postgres + MinIO + nginx | Storage / metadata / TLS | 5432 / 9000 / 80,443 |

## 1. Prerequisites

- Ubuntu 22.04+ or Debian 12 VPS (≥ 2 GB RAM)
- Domain pointed at the VPS (`updates.example.com`, `deploy.example.com`, `storage.example.com`)
- A GitHub repo for your Expo/RN app with macOS-capable Actions

## 2. Provision the VPS

```bash
# On the VPS, as a sudo-capable user:
curl -fsSL https://raw.githubusercontent.com/<you>/pointerBuild/main/infra/setup-vps.sh | sudo bash
# or, after cloning:
sudo INSTALL_DIR=/opt/pointerBuild bash infra/setup-vps.sh
```

`setup-vps.sh` is idempotent. It installs Docker, Docker Compose plugin,
Node 20, nginx + certbot, postgres client, ufw, and clones the repo into
`/opt/pointerBuild`.

## 3. Configure environment

```bash
cd /opt/pointerBuild
cp .env.example .env  # if not already created by setup
$EDITOR .env          # set DB_PASSWORD, S3_*, POINTER_API_KEY, public URLs, domain
```

Required:
- `DB_PASSWORD` — Postgres password
- `S3_ACCESS_KEY` / `S3_SECRET_KEY` — MinIO root credentials
- `POINTER_API_KEY` — shared bearer token for write endpoints
- `POINTER_UPDATES_PUBLIC_URL` / `POINTER_DEPLOY_PUBLIC_URL` — public origins clients hit

## 4. Bring up the stack

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f pointer-updates pointer-deploy
```

`minio-init` runs once and creates buckets `pointer-updates` and
`pointer-builds`. Re-run is safe.

Health checks:
```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
```

## 5. TLS with Let's Encrypt

```bash
sudo certbot --nginx \
  -d updates.example.com \
  -d deploy.example.com \
  -d storage.example.com \
  -m you@example.com --agree-tos --no-eff-email
```

## 6. Wire up an Expo / React Native app

Install the SDK and CLI:

```bash
npm install @pointer/sdk
npm install -D @pointer/cli   # or use npx
npx pointer init
```

`pointer.json` (created by `pointer init`):

```json
{
  "appId": "com.mycompany.myapp",
  "name": "MyApp",
  "updatesUrl": "https://updates.example.com",
  "deployUrl":  "https://deploy.example.com",
  "github": { "owner": "you", "repo": "myapp" }
}
```

Use the SDK in your app:

```ts
import { Platform } from 'react-native';
import { PointerUpdates } from '@pointer/sdk';

const updates = new PointerUpdates({
  apiBase: 'https://updates.example.com',
  appId: 'com.mycompany.myapp',
});

const { manifest, bundle } = await updates.checkAndDownload({
  platform: Platform.OS as 'ios' | 'android',
  runtimeVersion: '1.0.0',
});
```

Or with the React hook:

```tsx
import { usePointerUpdates } from '@pointer/sdk/expo';
```

## 7. GitHub Actions

Copy `.github/workflows/pointer-{ios,android,ci}.yml` into your app repo,
then set repo **Secrets**:

- `POINTER_UPDATES_URL` — e.g. `https://updates.example.com`
- `POINTER_DEPLOY_URL`  — e.g. `https://deploy.example.com`
- `POINTER_API_KEY`     — must equal the server's `POINTER_API_KEY`

Trigger a build from the Actions tab or via CLI:

```bash
npx pointer deploy --platform=ios     --runtime-version=1.0.0 --channel=production
npx pointer deploy --platform=android --runtime-version=1.0.0 --channel=production
```

`mode=export` uploads an OTA bundle to `pointer-updates`.
`mode=build` produces a native archive (`.xcarchive` / `.apk`) and
registers it with `pointer-deploy`.

## 8. Day-to-day commands

```bash
npx pointer status                        # health of all services
npx pointer builds   --app com.x.y        # list builds
npx pointer releases --app com.x.y        # list channels
npx pointer promote  --app com.x.y --build <id> --channel production
npx pointer update   --platform ios --runtime-version 1.0.0 --message "fix"
```

## 9. Backups

```bash
# Postgres
docker compose exec postgres pg_dump -U pointer pointerbuild | gzip > backup-$(date +%F).sql.gz
# MinIO data lives in the named volume `minio_data` — back it up via `docker run --rm -v minio_data:/data ...`
```

## 10. Layout

```
pointerBuild/
├── docker-compose.yml
├── .env.example
├── docker/
│   ├── Dockerfile.server
│   └── nginx.conf
├── infra/
│   └── setup-vps.sh
├── packages/
│   ├── pointer-updates/   # OTA server
│   ├── pointer-deploy/    # Distribution server
│   ├── pointer-cli/       # CLI
│   └── pointer-sdk/       # Client SDK + Expo hook
└── .github/workflows/
    ├── pointer-ios.yml
    ├── pointer-android.yml
    └── pointer-ci.yml
```

## 11. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `pg_isready` fails | check `DB_PASSWORD`; `docker compose logs postgres` |
| MinIO buckets missing | rerun `docker compose up minio-init` |
| 502 from nginx | inspect `docker compose logs nginx`; confirm upstreams healthy |
| Workflow can't reach API | secrets not set or firewall blocks 80/443 |
| SDK 401 | `POINTER_API_KEY` mismatch between server `.env` and client/CI |

## License

MIT.
