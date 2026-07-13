# OMNI SuperAdmin

## Production Notes

- The app connects only to the configured owned relay in `assets/config.js`; it does not use browser-local business-data storage.
- A green relay indicator means the browser has an active live connection. It is not a guarantee that every historical record has already arrived, so exports and the reset tool read each collection directly from the relay before acting.
- The database screen supports JSON and CSV import, JSON/CSV export, soft deletion, and removal from the reachable live graph. Relay disk backups and historical storage are managed on the relay server, not from a browser.
- The SuperAdmin browser gate is an application convenience, not a server authorization boundary. Before accepting untrusted public clients, move sensitive role/financial records to signed and encrypted GUN SEA identities with server-side validation, or expose privileged operations through an authenticated API. CORS alone cannot secure a GUN relay.

Static SuperAdmin app for `omni-v2`.

Open `index.html` or deploy the folder to GitHub Pages.

Main features:
- vendor approval/suspension
- users and soft-delete
- orders, credit, attendance views
- database spreadsheet
- CSV/JSON export/import
- audit log/events
