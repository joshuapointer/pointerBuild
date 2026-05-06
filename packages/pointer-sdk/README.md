# @pointer/sdk

Client SDK for [pointerBuild](../../README.md). Talks to `pointer-updates` and `pointer-deploy`.
Works in Node, browser, Expo managed, and bare React Native.

## Install

```bash
npm install @pointer/sdk
```

For the Expo hook (`usePointerUpdates`), make sure `react` is available (already true in any Expo/RN app).

## Quick start

### OTA updates

```ts
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { PointerUpdates } from '@pointer/sdk';

const updates = new PointerUpdates({
  apiBase: 'https://my-vps.com:3001',
  appId: 'com.mycompany.myapp',
});

const { manifest, bundle } = await updates.checkAndDownload({
  platform: Platform.OS as 'ios' | 'android',
  runtimeVersion: (Constants.expoConfig?.runtimeVersion as string) ?? '1.0.0',
});
```

### React hook (Expo)

```tsx
import { usePointerUpdates } from '@pointer/sdk/expo';
import { Platform } from 'react-native';

function App() {
  const { hasUpdate, manifest, check, download } = usePointerUpdates({
    apiBase: 'https://my-vps.com:3001',
    appId: 'com.mycompany.myapp',
    platform: Platform.OS as 'ios' | 'android',
    runtimeVersion: '1.0.0',
    pollIntervalMs: 60_000,
    onUpdateAvailable: (m) => console.log('new update:', m.id),
  });
  // ...
}
```

### Distribution / builds

```ts
import { PointerDeploy } from '@pointer/sdk';

const deploy = new PointerDeploy({
  apiBase: 'https://my-vps.com:3002',
  apiKey: process.env.POINTER_API_KEY,
});

await deploy.registerBuild({
  appId: 'com.mycompany.myapp',
  platform: 'ios',
  version: '1.0.0',
  buildNumber: 42,
  artifactUrl: 'https://storage.my-vps.com/builds/x.ipa',
  branch: 'main',
  commitSha: 'abc123',
});

const latest = await deploy.latestOnChannel('com.mycompany.myapp', 'production');
```

## API

- `PointerUpdates` — `health`, `listApps`, `registerApp`, `fetchManifest`, `checkForUpdate`,
  `downloadBundle`, `checkAndDownload`, `history`, `deleteUpdate`, `uploadBundle`.
- `PointerDeploy` — `health`, `registerBuild`, `listBuilds`, `latestBuilds`, `downloadUrl`,
  `promote`, `listChannels`, `latestOnChannel`, `createChannel`, `deleteBuild`.
- `usePointerUpdates(opts)` — React hook (subpath `@pointer/sdk/expo`). Returns `{ client,
  manifest, hasUpdate, isChecking, error, check, download }`.

## Errors

All non-2xx responses throw `PointerError` with `.status` and `.body`.

## License

MIT.
