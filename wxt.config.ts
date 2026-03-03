import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'PTO Sync - Workday to Google Calendar',
    description: 'Syncs PTO/time-off from Workday to Google Calendar',
    permissions: ['identity', 'storage', 'activeTab', 'tabs'],
    host_permissions: ['https://*.myworkday.com/*', 'https://www.googleapis.com/*'],
    oauth2: {
      client_id: '5968968327-njl8ho7kcp1876frdljpspl72h8es7f2.apps.googleusercontent.com',
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    },
  },
});
