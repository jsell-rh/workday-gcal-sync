# PTO Sync

Browser extension that syncs time-off entries from Workday to Google Calendar.

## Install (Chrome)

1. `npm install && npm run build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked**, select the `.output/chrome-mv3` directory.
4. Open the extension and follow the setup guide.

## Install (Firefox)

1. `npm install && npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on**, select any file inside `.output/firefox-mv2`.

## How it works

The extension scrapes your time-off entries from a Workday absence page and creates corresponding events in Google Calendar. It can run manually or on a schedule via background alarms.

## Settings

- **Event visibility**: busy, free, or out-of-office (default: out-of-office).
- **Title template**: controls event titles using `{type}`, `{hours}`, `{status}` variables (default: `OOO - {type}`).
- **Target calendars**: sync to your primary calendar or specific calendar IDs.
- **Auto-sync**: enable periodic sync at intervals from 15 minutes to 4 hours (default: off).

## Troubleshooting

| Problem              | Fix                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| SSO login times out  | Log into Workday in a regular tab first, then retry.                                                               |
| OAuth / auth errors  | Remove and re-add the extension to reset the auth token. In Firefox, try clearing cookies for accounts.google.com. |
| Events not appearing | Check that the correct calendar is selected in settings and that events aren't filtered by visibility.             |

## Development

```
npm install          # install deps
npm run dev          # dev mode (Chrome, hot reload)
npm run dev:firefox  # dev mode (Firefox)
npm test             # run tests
```
