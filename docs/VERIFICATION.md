# Verification and device checklist

Implemented and checked on macOS using Ruby 3.3.0, Rails 8.0.4, Node 25.2.1 and Chrome 157. No iPhone hardware or real Home Screen installation was available. No hosted deployment was made.

## Automated checks

- `npm test`: 28 passing tests. Pure calculations, examples A/B/C, validation, portion/meal preservation, local date rollover, target history, ordering, copy text and JSON backup validation. Service-worker harness tests check complete shell caching, cached navigation, external/private request exclusion, scoped old-cache cleanup, failed installation retention and explicit update activation.
- `bin/rails test`: 4 passing tests, 43 assertions. Shared UI, no Active Record railtie, health, public JavaScript worker delivery, complete production exports, deterministic rebuilds and stale build file removal. The export test deliberately sets `RAILS_ENV=test` in the calling environment and verifies the output has production rendering.
- `bin/rails static:build`: successfully generates the shared-view static PWA in `dist/`.
- `bundle exec ruby script/browser_test.rb`: 112 passing browser checks against temporary Rails and static servers, including Chromium's native Clipboard API. Both `/calorie/` and the Cloudflare-style domain root `/` are exercised. Before either static workflow, the suite stops its Rails server and checks that its port is unavailable. Both static deployments then pass offline reload, record operations, history, settings/export and an accepted worker update that preserves records and drafts. The preview servers serve files only and never load Rails.

Browser coverage includes real IndexedDB food/workout CRUD, Undo, draft restoration after reload, atomic validated backup merges, repeat-import deduplication, historical goals, editing a date, and upgrading an actual v1 IndexedDB fixture to v2 without data loss. UI coverage includes food/workout switching, copy with empty calories, numeric field preservation, calorie/protein recomputation, negative remaining values, expanded history, theme persistence and a 390px viewport without horizontal overflow.

Chrome network emulation verifies offline reload, food/workout addition, historical editing, deletion/Undo, history browsing, settings and a real JSON download. The static update test modifies only the generated worker temporarily, accepts the waiting update in Settings, verifies records and the main form draft survive, and restores the original build file. The shell cache is inspected to confirm app modules are present and record backups are absent. Worker failure/update lifecycle rules also have deterministic harness tests; this harness isn't a substitute for Safari testing.

Screenshots from the latest suite are saved under `test/artifacts/`: desktop dark, mobile dark and mobile light for each deployment. Light/dark screenshots have been visually reviewed. The chat's interactive browser preview host was unavailable, but local Chromium automation worked.

## Manual iPhone checks still required

1. Upload `dist/` to a permanent HTTPS host; visit in Safari and verify offline readiness in Settings.
2. Share → Add to Home Screen. Open the installed app online once and verify offline readiness there too.
3. Check Dynamic Island/notch and home indicator safe areas in portrait; scroll to the last entry and confirm nothing is hidden by navigation. Check iPad/landscape as applicable.
4. Check native numeric keyboards, decimal protein, meal selector, native time/date inputs, readable focus states and no unwanted input zoom.
5. Enter food and portion, copy before entering calories, open ChatGPT, paste, and return. Repeat after the tracker is suspended briefly; the main draft should remain. Clipboard permission/fallback behavior is browser-dependent.
6. Add the supplied examples: 1800 − 1000 + 300 = 1100; 1800 − 2000 + 100 = −100; food protein 25 + 35.5 = 60.5 g. Workouts must not change protein.
7. Close the installed app, enable Airplane Mode, reopen, and exercise add/edit/delete/Undo, History, Settings and export. Check downloaded backups can be opened in Files.
8. Leave a draft across local midnight, return, and verify Today changes to the new date and old entries move to History. Change a historical entry date and verify both days update. The draft's manually chosen time should remain intact.
9. Change goals today; verify previous-day targets stay unchanged. Enable/disable protein goal. Switch System/Light/Dark and OS appearance; test Increase Contrast/Reduce Motion and VoiceOver where available.
10. Export, clear (confirm only after exporting), then restore. Import twice and verify no duplicates. A malformed JSON file must not change existing data.
11. Upload a fresh complete build at the same production URL. Reopen online, finish editing any open entry/preferences, then accept Update app. Verify records and main form drafts remain and the updated app reopens offline.

Storage eviction, Safari/installed-app lifecycle behavior, hardware safe areas, actual installation, OS suspension and clipboard permission UX cannot be established by desktop emulation. The app's persistence request is best-effort; regular JSON backups remain necessary.
