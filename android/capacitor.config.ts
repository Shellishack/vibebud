import type { CapacitorConfig } from '@capacitor/cli';

const devUrl = process.env.VIBEMOJI_DEV_URL;

const config: CapacitorConfig = {
  appId: 'dev.vibemoji.android',
  appName: 'vibemoji',
  webDir: 'www',
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
