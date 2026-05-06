# @pointer/cli

Unified CLI for [pointerBuild](../../README.md) — a self-hosted EAS replacement.

Install globally or via `npx`:

```bash
npm install -g @pointer/cli
# or
npx pointer <command>
```

## Commands

| Command | Description |
| --- | --- |
| `pointer init` | Interactive setup — writes `pointer.json` and `.pointerignore`. |
| `pointer status` | Health check for `pointer-updates` and `pointer-deploy`. |
| `pointer login` | Store API key + optional GitHub token in `~/.pointer/credentials.json`. |
| `pointer logout` | Clear stored credentials. |
| `pointer deploy --platform all` | Dispatch GitHub Actions builds, wait, optionally promote. |
| `pointer update --platform ios` | `expo export` + upload OTA update bundle. |
| `pointer builds --app <id>` | List recent builds for an app. |
| `pointer releases --app <id>` | List release channels and latest builds. |
| `pointer promote --app <id> --build <id> --channel production` | Promote a build to a channel. |

Run `pointer <command> --help` for full flag listings.

## `pointer.json`

```json
{
  "appId": "com.acme.myapp",
  "name": "MyApp",
  "apiBase": "https://my-vps.com",
  "updatesUrl": "https://my-vps.com:3001",
  "deployUrl": "https://my-vps.com:3002",
  "storage": {
    "type": "s3",
    "endpoint": "https://my-vps.com:9000",
    "bucket": "pointer-builds",
    "accessKey": "${S3_ACCESS_KEY}",
    "secretKey": "${S3_SECRET_KEY}"
  },
  "github": {
    "owner": "myorg",
    "repo": "myapp",
    "workflowIos": "pointer-ios.yml",
    "workflowAndroid": "pointer-android.yml"
  }
}
```

`${VAR}` placeholders are expanded from the process environment at load time.

## Authentication

The CLI reads credentials in this order:

1. `POINTER_API_KEY` / `GITHUB_TOKEN` env vars
2. `~/.pointer/credentials.json` (written by `pointer login`)

API keys are sent as `Authorization: Bearer <key>` to the pointer servers. The
GitHub token is only used for `workflow_dispatch` calls during `pointer deploy`.

## Typical workflow

```bash
# One-time setup
pointer init
pointer login

# Verify connectivity
pointer status

# Ship a binary build via GitHub Actions, then mark it production
pointer deploy --platform all --channel production --runtime-version 1.0.0

# Or ship a JS-only OTA update
pointer update --platform all --runtime-version 1.0.0 --message "fix login bug"

# Inspect history
pointer builds --limit 10
pointer releases
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `POINTER_API_KEY` | Bearer token for pointer servers |
| `GITHUB_TOKEN` | Personal access token for `workflow_dispatch` |
| `POINTER_DEBUG` | Print stack traces on failure |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Expanded into `pointer.json` storage block |

## Development

```bash
npm install
npm run build
node dist/index.js --help
```
