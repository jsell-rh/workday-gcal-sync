import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2ffkaP0JGQEDBtNgpknV8nbhU51xn/HMb5m5mt7pb0PMmFcdMYrVb271sAf/HW6AbOB5BiY8/x9SaEC8fM0rqNPU7IPPW79Ehmp0e/LlHmLozgiBfuoTPtkqltFiXCmkxEl6f5SMxxZxQh1L4tjjdXBzgL7/2weDqeEcF1PGskfIpM2yKeqjCF2vv46B/LIm/IVDSru+uqZNPtWDjEkcJcbzjUX7XqoaQVZdc5e1UOFu2IL+FKA2P2MpaKVqYG3wGOlhmNMlX0wE22ViihqM7lz939u5NCW1em28yzxCDftgQ3hAVMg+T2OAew+PreqLT3nuRj0+GKU9AXc7fufpLwIDAQAB',
    name: 'PTO Sync - Workday to Google Calendar',
    description: 'Syncs PTO/time-off from Workday to Google Calendar',
    permissions: [
      'identity',
      'storage',
      'activeTab',
      'tabs',
      'sidePanel',
      'alarms',
      'notifications',
    ],
    host_permissions: ['https://*.myworkday.com/*', 'https://www.googleapis.com/*'],
    oauth2: {
      client_id: '5968968327-njl8ho7kcp1876frdljpspl72h8es7f2.apps.googleusercontent.com',
      scopes: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly',
      ],
    },
  },
});
