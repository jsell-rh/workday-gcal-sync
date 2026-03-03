import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'PTO Sync - Workday to Google Calendar',
    description: 'Syncs PTO/time-off from Workday to Google Calendar',
    permissions: ['identity', 'storage', 'activeTab', 'tabs'],
    host_permissions: ['https://*.myworkday.com/*', 'https://www.googleapis.com/*'],
    // TODO: Replace with a real OAuth2 client ID from Google Cloud Console
    // oauth2: {
    //   client_id: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
    //   scopes: ['https://www.googleapis.com/auth/calendar.events'],
    // },
  },
});
