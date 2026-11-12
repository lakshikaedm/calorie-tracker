# Calorie

A small Rails 8 PWA for food, protein and workout logging. The production app is entirely static and works offline after the shell finishes caching. Personal records stay in IndexedDB; Rails never receives them. No accounts, database server, external fonts, frontend framework or AI API.

## Run on macOS

Use Ruby 3.3 or a newer compatible Ruby (the project pins Ruby 3.3.0 for reproducibility), Bundler, and Node 22+ for JavaScript tests. With rbenv, install the version in `.ruby-version`, then:

```sh
bundle install
bin/rails server
```

Open <http://localhost:3000>. There is no database setup. `bin/setup` installs gems and starts development. Rails serves the ERB shell; the browser performs every record operation locally.

## Tests

```sh
npm test
bin/rails test
bin/rails static:build
bundle exec ruby script/browser_test.rb
```

The browser suite requires Chrome. Selenium downloads its matching driver into `tmp/selenium` on first use. It starts temporary Rails/static servers on ports 3010/3011/3012, uses a fresh browser profile, and closes its servers afterwards. It stops Rails before checking the static build at `/calorie/` and `/`, including offline reloads and updates. Set `TEST_RAILS_PORT`, `TEST_STATIC_PORT` or `TEST_ROOT_PORT` to avoid conflicts. Screenshots are saved in `test/artifacts/`. No npm installation is needed: the JavaScript tests use Node's built-in runner.

See [verification](docs/VERIFICATION.md) for executed checks and iPhone manual checks.

## Static build and free hosting

From the project root, run this exact build command:

```sh
bin/rails static:build
```

The deployable folder is **`/Users/lakshikaedm/Projects/calory-tracker/dist/`** in this checkout (always `dist/` relative to the project root). Its root contains `index.html`, `manifest.webmanifest`, `service-worker.js`, Cloudflare's `_headers` file and the `app/` folder with CSS, JavaScript and local icons.

The exporter always boots Rails in **production** mode in a separate process, even if the calling shell sets `RAILS_ENV=development` or `test`. A dummy build-only secret avoids needing production credentials. It renders into a temporary directory, checks every precached asset exists, then replaces only the generated `dist/` output. A failed render/asset check leaves the previous successful build intact. Repeated builds remove stale output assets and produce identical file contents for unchanged source. Source files and IndexedDB data are never removed by the build.

Upload the **contents of `dist/`** to an HTTPS static host. This is the same Rails-rendered UI and the exact same JS/CSS, not a separate frontend. No Ruby process, Rails server, backend API or database is needed on the static host. `dist/` contains no personal data, Rails credentials, or server source. Build locally; upload prebuilt assets.

Recommended: Cloudflare Pages Direct Upload on its Free plan. In the dashboard, open Workers & Pages, create a Pages project, choose the direct upload/drag-and-drop option, and upload `dist/`. Retain the same production `https://<project>.pages.dev/` URL for every update. The static host needs no Functions or API keys. Optional Widget Sync uses your separately configured Worker. Keep the existing deployed hostname (`https://calorie-tracker.lakshikaedm.workers.dev`) when updating this installation; do not create a replacement origin. Current provider interface details: [Direct Upload documentation](https://developers.cloudflare.com/pages/get-started/direct-upload/) and [Free plan limits](https://developers.cloudflare.com/pages/platform/limits/).

For Cloudflare Pages, serve this output at the **domain root**, such as `https://<project>.pages.dev/`. Use the prebuilt `dist/` folder as the upload/output directory; do not upload the Rails project. Direct Upload runs no remote build command and does not set up automatic Git deployments. No Wrangler configuration or Cloudflare account connection is required to generate or test the output locally. The included `_headers` applies `Cache-Control: no-cache` at `/` and all fixed asset URLs so HTTP caches revalidate while the versioned service worker provides offline caching. See [Cloudflare's `_headers` documentation](https://developers.cloudflare.com/pages/configuration/headers/).

GitHub Pages also works, including `https://<user>.github.io/<repository>/`. Use a public repository for the free GitHub Pages path. You may publish only the generated files to a Pages branch, or use the manually triggered example in [docs/pages-workflow.yml](docs/pages-workflow.yml). Copy that example to `.github/workflows/pages.yml` only when you want deployment enabled, choose GitHub Actions in repository Settings → Pages, and run it manually. See [GitHub's workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The app uses hash navigation (`#today`, `#history`), relative module/manifest/icon paths, and a service worker scoped to its containing directory. A project Pages URL must end in `/`; static hosts normally redirect to it. No catch-all server rewrite is required. A cold request to an invented deep path isn't supported; use the app's root URL and hash navigation.

Preview the Cloudflare-style domain-root deployment locally, with **no Rails server running**:

```sh
bundle exec ruby script/serve_static.rb
```

Open <http://127.0.0.1:3001/>. This is a file-only preview server and never boots Rails. To check a nested deployment instead, run `STATIC_MOUNT=/calorie bundle exec ruby script/serve_static.rb` and open <http://127.0.0.1:3001/calorie/>. Service workers work on loopback HTTP or real HTTPS, not arbitrary insecure HTTP/LAN URLs. A `file://` preview will not work.

**Nothing in this repository deploys automatically.** The included CI runs tests and exports the build only.

## Install on iPhone

1. Visit your permanent HTTPS production URL in Safari.
2. Wait for Settings → “Ready for offline use on this device.”
3. Use Safari Share → Add to Home Screen, then open Calorie from that icon.
4. With internet still available, open Settings once and verify offline readiness in the installed app too.
5. Add a test food and workout. Close the app, enable Airplane Mode, then reopen. Verify records, History, editing and Undo.

Actual iPhone/standalone testing must be performed on a device. Desktop viewport emulation does not verify Safari, safe areas, native time pickers, clipboard permission prompts, suspension or installation.

## Daily use and target behavior

Remaining calories = target − food consumed + workout burned. Protein sums food only. Progress shows food / target, capped visually at 100%; the label retains the true percentage. Negative calorie and protein remainders remain visible without alarming messages. Values are displayed to at most two decimals; persisted inputs retain their precision.

Settings changes apply to the current local day and future days. Previous days keep their snapshots. Effective-date goal history supplies the correct historical target even for a past date first reached by moving an entry. A new installation starts at 1,800 kcal with no protein goal. Changing the target today does not rewrite yesterday. Device clock/timezone changes affect which local day is Today; saved dates are never reinterpreted as UTC.

Food/workout forms have separate IndexedDB drafts, saved on each input/change. Switching tabs/apps or reloading restores them; successful submission clears only that form's draft. Unsaved edit-dialog changes and unsaved settings are not drafts. The saved time is editable; a new/reset form defaults to current local time. Submissions use the current local date, including after midnight.

The copy button uses the food name and portion, does not require calories, and never submits. The optional “Open ChatGPT” action opens <https://chatgpt.com/>. [Official web guidance](https://learn.chatgpt.com/docs/web) supports this destination. No officially documented reliable iOS deep link for this workflow was established, so no custom scheme or last-conversation behavior is assumed. Paste the question yourself. Clipboard API failures try a selection-based fallback; browser restrictions may still prevent copying.

## Backups and data preservation

Settings → Export JSON backup downloads entries, preferences, effective goal history and daily snapshots. Copy the file somewhere safe. Settings → Import JSON backup validates the whole file **before** starting one atomic merge. IDs avoid duplicate entries; existing local records, preferences and daily targets win. To fully restore an old backup including its preferences, import into an empty app. “Clear all data” requires a separate explicit confirmation.

Deletion offers Undo for 15 seconds. A deletion receipt is persisted, so reopening promptly still offers Undo. After that window the receipt is discarded. Pending deletions and unsaved drafts are not included in backups.

Storage belongs to a browser origin and browser profile. Clearing website/app storage, eviction or uninstall behavior may remove it. The app requests persistent storage where supported, but cannot guarantee it. Export regularly. Moving between localhost, Pages, a custom domain, or another browser/device requires export/import; storage cannot be read automatically across origins. Use the same production URL for updates and avoid preview URLs for daily logging. Different directory deployments on the same origin share the same IndexedDB database by design; use separate origins for independent trackers.

## Widget Sync (optional)

Widget Sync is disabled by default. Food/workout logs, edits, deletions, Undo, imports and target changes commit locally first. A 2.5-second debounce then sends **today's** fresh summary only: `date`, `target`, `consumed`, `workout`, `remaining`, and `protein`. It reuses the app's calculations (`remaining = target - consumed + workout`); the Worker can recalculate remaining. Historical changes also send today, never a historical widget date. Opening or activating the app sends today even with an empty log; a local midnight check handles a new day while active.

After manually uploading the updated `dist/` to the **existing** deployment, on your iPhone:

1. Open the installed PWA online and accept **Settings → Update app** if offered.
2. Open **Settings → Widget Sync**. Enter your separate Worker's HTTPS base URL or full `/api/summary` endpoint. This is the API Worker, not automatically the tracker hostname.
3. Enter the private **WRITE_TOKEN** on the phone, enable **Enable Widget Sync**, and tap **Save Widget Sync**. Never use the READ_TOKEN in this app.
4. Tap **Test Connection**. It POSTs today's summary using the saved configuration. Check **Synced** and the last-success time. Settings must be saved and enabled before testing.
5. To replace the token, enter a new one and save. An empty token input retains the saved token. **Remove saved token and disable sync** deletes it from the configuration. Saved tokens are never filled back into the input; closing Settings clears any unsaved token text.

The Worker must allow origin `https://calorie-tracker.lakshikaedm.workers.dev`, method `POST`, and headers `Content-Type` and `Authorization` in its OPTIONS/CORS handling. The PWA sends `Authorization: Bearer …`, omits cookies and refuses redirects. Tokens are never sent in URLs. Network/CORS failures and timeouts retain pending state; 401/403 errors ask you to replace the token. Server response bodies are not displayed or logged. No Worker code or deployment configuration is changed here.

Configuration, token, pending revision and status live under the private `widget_sync` key in the existing IndexedDB `settings` store. The database remains `calorie-local`, version 2; no new schema migration is required. JSON export reads only the `preferences` settings key, so backups exclude the private token and sync configuration. Import does not replace the device credential. The existing, explicitly confirmed **Clear all data** action also removes Widget Sync settings.

This is a single-device personal credential stored in your browser, not a secure vault. It cannot protect against all forms of browser compromise, including malicious code running on the app's origin. Do not share the write token or commit it to source/build files. No token is supplied to the build process.

Requests use a shared Web Lock across app tabs and a persisted cooldown of at least 1.5 seconds after request completion. A browser without Web Locks reports an error and keeps logging locally. Pending changes survive reloads; network failures do not create an infinite retry loop. Retries happen after another change, reconnect, app activation, or Test Connection. A 15-second timeout bounds each network attempt. While iOS suspends or terminates the PWA, synchronization cannot be promised; reopening it retries today's current summary. The service worker bypasses authenticated requests and `/api/summary`, caching only the app shell.

Automated tests use a mocked API, temporary IndexedDB databases and isolated Chrome profiles. They do not verify a live Worker, its CORS configuration, Scriptable, or real iPhone background behavior. After configuration, verify those on your device.

## Updates

1. Export a backup before upgrading or changing URLs.
2. Run all checks, then rebuild `dist/` and upload the **whole build** to the existing production deployment.
3. Reopen online. The service worker's version is derived from every application asset and template. Installation caches a complete new shell; a failed download leaves the prior shell active.
4. When Settings offers “Update app”, tap it. The waiting worker activates, old app caches are removed, and the page reloads. Main form drafts and records remain in IndexedDB. Finish or cancel open edit/settings dialogs before applying an update.
5. Check offline readiness and a saved entry after updating.

The active worker serves its own cached shell and assets, so an update doesn't mix old/new files in an existing session. It only caches explicit application assets, never personal record data. No service-worker update deletes IndexedDB. Keep uploads atomic at the host; don't manually edit deployed individual assets. See [architecture](docs/ARCHITECTURE.md) for schema evolution.

## Structure

- `app/controllers/tracker_controller.rb`: Rails shell and versioned worker delivery.
- `app/views/layouts/application.html.erb`: PWA metadata and local assets.
- `app/views/tracker/index.html.erb`: Today, History, forms and small Settings/editor dialogs.
- `public/app/application.js`: UI, forms, draft persistence and navigation.
- `public/app/domain.js`: validation, local dates, calorie/protein totals and backup schema.
- `public/app/database.js`: IndexedDB stores, migrations and transactional operations.
- `public/app/clipboard.js`, `pwa.js`: clipboard fallback and update registration.
- `public/app/styles.css`: responsive iOS-inspired layout and appearance.
- `app/views/pwa/service-worker.js`, `lib/calorie_assets.rb`: scoped, versioned offline shell.
- `script/export.rb`: shared-view static export; `script/icons.rb`: local PNG generation.
- `test/`: Node logic tests, Rails request tests and real-browser repository checks.

The initial workspace was empty: no previous UI, records, tests or migration sources existed. Standard Rails structure was retained and unnecessary server-side subsystems were omitted.
