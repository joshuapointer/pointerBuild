# pointer-updates — Manual Testing

Assumes service runs at `http://localhost:3001`, Postgres + MinIO live (see root `docker-compose.yml`).

## 1. Health
```bash
curl http://localhost:3001/health
```

## 2. Register an app
```bash
curl -X POST http://localhost:3001/apps \
  -H "Content-Type: application/json" \
  -d '{"appId":"com.example.myapp","name":"MyApp"}'
```

## 3. List apps
```bash
curl http://localhost:3001/apps
```

## 4. Get app details
```bash
curl http://localhost:3001/apps/com.example.myapp
```

## 5. Upload an update bundle
```bash
# bundle.zip = output of `expo export` zipped
curl -X POST http://localhost:3001/updates \
  -F bundle=@bundle.zip \
  -F appId=com.example.myapp \
  -F platform=ios \
  -F version=1.0.0 \
  -F runtimeVersion=49
```

## 6. Get latest manifest (Expo-compatible)
```bash
curl http://localhost:3001/updates/com.example.myapp/ios/49
```
Returns:
```json
{
  "id": "uuid",
  "version": "1.0.0",
  "runtimeVersion": "49",
  "platform": "ios",
  "createdAt": "...",
  "bundleUrl": "https://signed-url..."
}
```

## 7. Download a specific update (302 redirect to signed URL)
```bash
curl -L http://localhost:3001/updates/com.example.myapp/ios/49/<UPDATE_ID> -o bundle.zip
```

## 8. List update history
```bash
curl "http://localhost:3001/apps/com.example.myapp/history?platform=ios&runtimeVersion=49&limit=20&offset=0"
```

## 9. Soft-delete (archive) an update
```bash
curl -X DELETE http://localhost:3001/updates/<UPDATE_ID>
```

## 10. Run migrations standalone
```bash
npm run migrate
```

## Env vars
- `DATABASE_URL` — `postgres://user:pass@host:5432/db`
- `S3_ENDPOINT` — e.g. `http://localhost:9000`
- `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `S3_BUCKET` — default `pointer-updates`
- `PORT` — default `3001`
- `AUTO_MIGRATE=false` to skip startup migration
- `AUTO_ENSURE_BUCKET=false` to skip startup bucket check
