# Testing pointer-deploy

## Manual Testing

### Start the server
```bash
npm run migrate  # Run migrations first
npm start
```

### Health Check
```bash
curl http://localhost:3002/health
```

### Register a Build
```bash
# First, register an app (apps table is shared with pointer-updates)
# Note: For production, apps should be registered via pointer-updates first

# Create a build
curl -X POST http://localhost:3002/builds \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "com.mycompany.myapp",
    "platform": "ios",
    "version": "1.0.0",
    "buildNumber": 1,
    "artifactUrl": "https://example.com/builds/myapp-ios-1.0.0.zip",
    "branch": "main",
    "commitSha": "abc123def456"
  }'

# List builds for an app
curl "http://localhost:3002/builds/com.mycompany.myapp"

# Get latest builds per platform
curl "http://localhost:3002/builds/com.mycompany.myapp/latest"

# Get download URL
curl "http://localhost:3002/builds/{buildId}/download"

# Promote to channel
curl -X POST http://localhost:3002/builds/{buildId}/promote \
  -H "Content-Type: application/json" \
  -d '{"channel": "production"}'

# List channels
curl "http://localhost:3002/channels/com.mycompany.myapp"

# Get channel latest
curl "http://localhost:3002/channels/com.mycompany.myapp/production"

# Create channel directly
curl -X POST http://localhost:3002/channels \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "com.mycompany.myapp",
    "channel": "beta",
    "buildId": "BUILD_UUID"
  }'

# Delete a build (soft delete)
curl -X DELETE "http://localhost:3002/builds/{buildId}"
```

## Environment Variables

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/pointerbuild
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=pointer-builds
PORT=3002
AUTO_MIGRATE=true
AUTO_ENSURE_BUCKET=true
```
