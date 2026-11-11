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

The browser suite requires Chrome. Selenium downloads its matching driver into `tmp/selenium` on first use. It starts temporary Rails/static servers on ports 3010/3011, uses a fresh browser profile, and closes its servers afterwards. Set `TEST_RAILS_PORT` / `TEST_STATIC_PORT` to avoid conflicts. Screenshots are saved in `test/artifacts/`. No npm installation is needed: the JavaScript tests use Node's built-in runner.

See [verification](docs/VERIFICATION.md) for executed checks and iPhone manual checks.

## Static build and free hosting

```sh
bin/rails static:build
```

Upload the **contents of `dist/`** to an HTTPS static host. This is the same Rails-rendered UI and the exact same JS/CSS, not a separate frontend. No Ruby process runs on the static host. `dist/` contains no personal data, Rails credentials, or server source. Build locally; upload prebuilt assets.

Recommended: Cloudflare Pages Direct Upload on its Free plan. In the dashboard, open Workers & Pages, create a Pages project, choose the direct upload/drag-and-drop option, and upload `dist/`. Retain the same production `https://<project>.pages.dev/` URL for every update. No Workers, Functions, billing-backed services or API keys are used by this app. Current provider interface details: [Direct Upload documentation](https://developers.cloudflare.com/pages/get-started/direct-upload/) and [Free plan limits](https://developers.cloudflare.com/pages/platform/limits/).

GitHub Pages also works, including `https://<user>.github.io/<repository>/`. Use a public repository for the free GitHub Pages path. You may publish only the generated files to a Pages branch, or use the manually triggered example in [docs/pages-workflow.yml](docs/pages-workflow.yml). Copy that example to `.github/workflows/pages.yml` only when you want deployment enabled, choose GitHub Actions in repository Settings → Pages, and run it manually. See [GitHub's workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The app uses hash navigation (`#today`, `#history`), relative module/manifest/icon paths, and a service worker scoped to its containing directory. A project Pages URL must end in `/`; static hosts normally redirect to it. No catch-all server rewrite is required. A cold request to an invented deep path isn't supported; use the app's root URL and hash navigation.

Preview the nested static deployment locally:

```sh
bundle exec ruby script/serve_static.rb
```

Open <http://127.0.0.1:3001/calorie/>. Service workers work on loopback HTTP or real HTTPS, not arbitrary insecure HTTP/LAN URLs. A `file://` preview will not work.

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
