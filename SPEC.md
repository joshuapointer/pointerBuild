# pointerBuild - Technical Specification

## Overview
A fully self-hosted replacement for Expo EAS (Expo Application Services). Designed for individual developers managing iOS and Android React Native apps with minimal cost and cognitive load.

## Services

### 1. pointer-updates (OTA Updates Server)
**Replaces**: EAS Updates
**Port**: 3001

#### API Endpoints

```
POST /updates
  - Upload a new update bundle (zip from expo export)
  - Body: multipart/form-data { bundle, metadata }
  - Response: { id, version, platform, runtimeVersion, createdAt }

GET /updates/:appId/:platform/:runtimeVersion
  - Returns the latest update manifest for a platform/runtime
  - Response: Expo-compatible manifest JSON

GET /updates/:appId/:platform/:runtimeVersion/:updateId
  - Download a specific update bundle (zip)
  - Response: application/zip binary

DELETE /updates/:updateId
  - Soft delete an update

GET /apps/:appId/history
  - List all updates for an app
  - Query params: ?platform=&runtimeVersion=&limit=&offset=

POST /apps
  - Register a new app
  - Body: { appId (e.g. com.myapp), name, platform }

GET /apps
  - List all registered apps

GET /health
  - Health check endpoint
```

#### Database Schema (PostgreSQL)

```sql
CREATE TABLE apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id VARCHAR(255) UNIQUE NOT NULL,  -- e.g. "com.mycompany.myapp"
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id VARCHAR(255) REFERENCES apps(app_id),
  platform VARCHAR(10) NOT NULL,  -- 'ios' | 'android'
  version VARCHAR(50) NOT NULL,   -- semver or date-based
  runtime_version VARCHAR(50) NOT NULL,
  bundle_path VARCHAR(500) NOT NULL,  -- S3/MinIO path
  status VARCHAR(20) DEFAULT 'active',  -- 'active' | 'archived'
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_updates_app_platform_runtime ON updates(app_id, platform, runtime_version DESC);
```

#### Storage
- MinIO (S3-compatible) for update bundles
- Local filesystem fallback for simple deployments

---

### 2. pointer-deploy (Distribution Server)
**Replaces**: EAS Deploy, EAS Submit
**Port**: 3002

#### API Endpoints

```
POST /builds
  - Register a new build artifact
  - Body: { appId, platform, version, buildNumber, artifactUrl, branch, commitSha }
  - Response: { id, appId, platform, version, buildNumber, createdAt }

GET /builds/:appId
  - List builds for an app
  - Query params: ?platform=&branch=&limit=&offset=
  - Response: { builds: [...], total }

GET /builds/:appId/latest
  - Get latest build for each platform
  - Response: { ios: Build | null, android: Build | null }

GET /builds/:buildId/download
  - Get signed download URL for build artifact
  - Response: { url, expiresAt }

POST /builds/:buildId/promote
  - Promote a build to a release channel
  - Body: { channel: "production" | "staging" | "beta" }

GET /channels/:appId
  - List channels for an app

GET /channels/:appId/:channel/latest
  - Get latest build on a channel

POST /channels
  - Create a release channel
  - Body: { appId, channel, buildId }

DELETE /builds/:buildId
  - Remove a build

GET /health
  - Health check
```

#### Database Schema (PostgreSQL)

```sql
CREATE TABLE builds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id VARCHAR(255) REFERENCES apps(app_id),
  platform VARCHAR(10) NOT NULL,
  version VARCHAR(50) NOT NULL,
  build_number INTEGER NOT NULL,
  artifact_url VARCHAR(500) NOT NULL,
  branch VARCHAR(255),
  commit_sha VARCHAR(40),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id VARCHAR(255) REFERENCES apps(app_id),
  channel VARCHAR(50) NOT NULL,
  build_id UUID REFERENCES builds(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_builds_app_platform ON builds(app_id, platform DESC);
CREATE UNIQUE INDEX idx_channels_app_channel ON channels(app_id, channel);
```

---

### 3. pointer-cli (NPM Package)
**Replaces**: EAS CLI
**Package**: `@pointer/cli` or `pointer-app`

#### Commands

```
npx pointer init
  - Initialize pointer.json in current directory
  - Interactive: appId, apiBaseUrl, storage config
  - Creates: pointer.json, .pointerignore

npx pointer deploy [options]
  --platform ios|android|all
  --channel production|staging|beta
  --message "commit message"
  --runtime-version 1.0.0
  Triggers GitHub Actions workflow, waits for completion, promotes to channel

npx pointer builds
  --app com.mycompany.myapp
  List recent builds

npx pointer releases
  --app com.mycompany.myapp
  List release channels and latest versions

npx pointer promote
  --app com.mycompany.myapp
  --build BUILD_ID
  --channel production
  Promote a build to a channel

npx pointer update
  --platform ios|android
  --runtime-version 1.0.0
  --message "feature X"
  Export + upload update bundle

npx pointer status
  Show connected services health

npx pointer login
  Store credentials in ~/.pointer/credentials.json

npx pointer logout
  Clear stored credentials
```

#### pointer.json Schema

```json
{
  "appId": "com.mycompany.myapp",
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
    "owner": "mygithub",
    "repo": "my-app-repo",
    "workflowFile": ".github/workflows/pointer-build.yml"
  }
}
```

---

### 4. pointer-sdk (Client SDK)
**Purpose**: Integrate Expo apps with pointer-updates
**Package**: `@pointer/sdk` or expo package

#### Usage

```javascript
import { PointerUpdates } from '@pointer/sdk';

// In your Expo app entry
const updates = new PointerUpdates({
  apiBase: 'https://my-vps.com:3001',
  appId: 'com.mycompany.myapp',
});

// Check for and download updates
await updates.checkAndDownload();

// On app start
const manifest = await updates.fetchManifest({
  platform: Platform.OS,  // 'ios' | 'android'
  runtimeVersion: Constants.manifest?.runtimeVersion,
});
```

---

### 5. GitHub Actions Workflows

#### .github/workflows/pointer-ios.yml
```yaml
name: Build iOS
on:
  workflow_dispatch:
    inputs:
      runtimeVersion:
        required: true
      channel:
        default: 'production'
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Setup Expo
        run: npx expo install --fix
      - name: Build iOS
        run: |
          npx expo export --platform ios --output-dir ./dist
          # Package into archive, upload to pointer-deploy
      - name: Notify pointer-deploy
        run: |
          curl -X POST ${{ secrets.POINTER_DEPLOY_URL }}/builds \
            -H "Authorization: Bearer ${{ secrets.POINTER_API_KEY }}" \
            -d @- << EOF
            {
              "appId": "${{ vars.APP_ID }}",
              "platform": "ios",
              "version": "${{ github.ref_name }}",
              "buildNumber": ${{ github.run_number }},
              "artifactUrl": "https://storage.my-vps.com/builds/${{ steps.upload.outputs.artifact }}",
              "branch": "${{ github.ref_name }}",
              "commitSha": "${{ github.sha }}"
            }
          EOF
```

#### .github/workflows/pointer-android.yml
Similar for Android (runs on ubuntu-latest, can be 2x faster)

---

## Docker Compose Setup

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: pointerbuild
      POSTGRES_USER: pointer
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY}
    volumes:
      - minio_data:/data
    ports:
      - "9000:9000"
      - "9001:9001"

  pointer-updates:
    build: ./docker/Dockerfile.server
    command: node packages/pointer-updates/dist/index.js
    environment:
      DATABASE_URL: postgres://pointer:${DB_PASSWORD}@postgres:5432/pointerbuild
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: ${S3_ACCESS_KEY}
      S3_SECRET_KEY: ${S3_SECRET_KEY}
      S3_BUCKET: pointer-updates
      PORT: 3001
    ports:
      - "3001:3001"
    depends_on:
      - postgres
      - minio

  pointer-deploy:
    build: ./docker/Dockerfile.server
    command: node packages/pointer-deploy/dist/index.js
    environment:
      DATABASE_URL: postgres://pointer:${DB_PASSWORD}@postgres:5432/pointerbuild
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: ${S3_ACCESS_KEY}
      S3_SECRET_KEY: ${S3_SECRET_KEY}
      S3_BUCKET: pointer-builds
      PORT: 3002
    ports:
      - "3002:3002"
    depends_on:
      - postgres
      - minio

  nginx:
    image: nginx:alpine
    volumes:
      - ./docker/nginx.conf:/etc/nginx/nginx.conf:ro
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - pointer-updates
      - pointer-deploy

volumes:
  postgres_data:
  minio_data:
```

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Docker Compose setup (postgres, minio, nginx)
- [ ] pointer-updates server (full API)
- [ ] pointer-deploy server (full API)
- [ ] Database migrations
- [ ] S3/MinIO integration

### Phase 2: CLI
- [ ] pointer-cli package structure
- [ ] init, status, login, logout commands
- [ ] deploy command (triggers GitHub Actions)
- [ ] update command (expo export + upload)
- [ ] builds, releases, promote commands

### Phase 3: SDK & Integrations
- [ ] pointer-sdk for Expo
- [ ] GitHub Actions workflow templates
- [ ] expo-custom-updater integration

### Phase 4: Polish
- [ ] Health checks & monitoring
- [ ] Error handling & retries
- [ ] Documentation
- [ ] VPS setup automation script

---

## Environment Variables

```bash
# Database
DB_PASSWORD=strong_password_here

# S3/MinIO
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key

# API Keys
POINTER_API_KEY=your_api_key_for_cli
GITHUB_TOKEN=ghp_xxx  # For GitHub API calls

# Domain
POINTER_DOMAIN=your-vps.example.com
```

## Non-Goals (EAS Features We Skip)

- App Store / Play Store automatic submission (use Fastlane directly)
- Team management / permissions (single dev focus)
- Analytics / crash reporting (use other dedicated tools)
- Pre-build / EAS Build custom builder images (GitHub Actions handles this)
