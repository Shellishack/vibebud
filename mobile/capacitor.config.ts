import type { CapacitorConfig } from '@capacitor/cli';

const devUrl = process.env.VIBEBUD_DEV_URL;

const config: CapacitorConfig = {
  appId: 'dev.vibebud.android',
  appName: 'vibebud',
  // Point straight at core's static export — no intermediate copy. Capacitor
  // happily accepts a webDir outside the project root, so `cap sync` reads
  // directly from `core/out/` and we don't need a separate `www/` mirror.
  webDir: '../core/out',
  android: {
    allowMixedContent: true,
    backgroundColor: '#00000000',
  },
  server: devUrl
    ? {
        url: `${devUrl.replace(/\/$/, '')}/buddy`,
        cleartext: true,
      }
    : {
        androidScheme: 'https',
      },
};

export default config;
