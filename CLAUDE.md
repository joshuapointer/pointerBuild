# pointerBuild - Self-Hosted EAS Replacement

## Mission
Build a complete, dockerized, self-hosted replacement for Expo EAS services. Designed for a single iOS/Android developer who wants zero lock-in, minimal cognitive load, and pain-free app management.

## Scope

### What we're building
- **pointer-updates**: Self-hosted OTA update server (replaces EAS Updates)
- **pointer-build**: Dockerized CI/CD for Expo/React Native builds (replaces EAS Build)
- **pointer-deploy**: Distribution & release management (replaces EAS Deploy/Submit)
- **pointer-cli**: Unified NPM package / CLI for interacting with all services
- **pointer-agent**: Optional autonomous agent for automation workflows

### Principles
- Docker-compose first, simple mental model
- One command: `npx pointer <command>` does everything
- Environment variables for all secrets (no hardcoded credentials)
- GitHub Actions workflows for builds (free tier = 2000 mins/month)
- Compatible with standard Expo tooling (expo export, EAS CLI, etc.)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Developer Laptop                                       │
│  npx pointer-cli → REST API / GitHub Actions            │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│  Self-Hosted VPS (Docker)                                │
│                                                         │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │ pointer-     │  │ pointer-      │  │ pointer-     │ │
│  │ updates      │  │ deploy        │  │ agent        │ │
│  │ (Node.js)    │  │ (Node.js)     │  │ (optional)   │ │
│  └──────────────┘  └───────────────┘  └──────────────┘ │
│                                                         │
│  Postgres DB (updates metadata)                         │
│  MinIO/S3 (artifact storage)                            │
└─────────────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│  GitHub Actions (Build runners - free tier)             │
│  - MacOS for iOS builds                                 │
│  - Ubuntu for Android builds                           │
└─────────────────────────────────────────────────────────┘
```

## Directory Structure

```
pointerBuild/
├── docker-compose.yml          # All services
├── Dockerfile.server           # pointer-updates, pointer-deploy
├── packages/
│   ├── pointer-cli/           # The npx pointer CLI
│   ├── pointer-updates/        # OTA update server (Node.js)
│   ├── pointer-deploy/         # Distribution/release API
│   ├── pointer-sdk/            # Client SDK (expo integration)
│   └── pointer-agent/          # Optional automation agent
├── .github/
│   └── workflows/
│       ├── build-ios.yml       # GitHub Actions iOS build
│       └── build-android.yml   # GitHub Actions Android build
├── infra/                     # VPS provisioning scripts
│   └── setup-vps.sh
├── docs/                      # Documentation
└── README.md
```

## Workflow

1. Developer runs `npx pointer init` → configures repo
2. Developer runs `npx pointer deploy --platform=all` →
   - Triggers GitHub Actions builds
   - Uploads artifacts to self-hosted storage
   - Registers update with pointer-updates
3. Testers pull from pointer-deploy API
4. Developer promotes to production with `npx pointer release`

## Constraints

- No Expo server dependency (fully self-hosted)
- Works with bare React Native AND managed Expo
- iOS builds: GitHub Actions macOS (free tier)
- Android builds: GitHub Actions Ubuntu OR local Docker
- All secrets via environment variables
- Zero-cost infrastructure where possible

## Plan

Create a detailed SPEC.md with:
1. Full API specs for pointer-updates and pointer-deploy
2. Database schema (Postgres)
3. Docker image definitions
4. CLI command specifications
5. GitHub Actions workflow templates
6. Client SDK integration guide
7. VPS setup automation

Then implement all packages and services in parallel agents.
