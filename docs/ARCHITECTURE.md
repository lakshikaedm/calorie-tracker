# Architecture and storage contract

The initial inspection found an empty directory, Ruby 3.3.0, Rails 8.0.4 and Node available. There were no reusable components, previous data files or browser database identifiers. A new Rails app was generated without Active Record, Active Storage, jobs, mail, Cable, Hotwire or a frontend build tool. Propshaft remains available for standard Rails assets, but these buildless PWA modules deliberately live in `public/app` so Rails and the static artifact use identical URLs and files.

Rails renders one GET page. There are no food, workout or settings endpoints. JS calls IndexedDB directly. A static build boots Rails locally, renders that same view/layout and copies its assets. The deployable folder needs only HTTPS file hosting. Rails cannot execute on static hosting; no Rails-dependent interaction is included in production.

## IndexedDB `calorie-local`, version 2

- `foods`, key path `id`, index `local_date`: `id`, `name`, `portion`, `meal_type`, `calories`, `protein_grams`, `local_date`, `local_time`, `created_at`, `updated_at`.
- `workouts`, key path `id`, index `local_date`: `id`, `name`, `calories_burned`, `local_date`, `local_time`, `created_at`, `updated_at`.
- `settings`, key `preferences`: calorie goal, nullable protein goal, theme, and an ordered `goal_versions` effective-date timeline.
- `goals`, key path `local_date`: daily calorie/protein target snapshots.
- `drafts`, keys `food` / `workout`: form values.
- `pending_deletions`, key path `id`: deleted entry, type, and Undo expiry timestamp.

UUIDs identify records across exports/imports. ISO timestamps identify creation/update instants; separate local date/time strings determine daily grouping. No UTC slicing determines Today. The day is checked on visibility, focus, pageshow and a light timer. History queries distinct local dates through the date indexes, retrieves only the current 30-day batch's records, and creates detail entry DOM only when expanded. Earlier batches load on demand. Expanding History doesn't change the device clock or Today.

Goals are saved with entry transactions and updated atomically with preferences. Timeline versions support unvisited past dates. A past day's explicit snapshot wins. Backups preserve both snapshots and timeline. Merge imports never overwrite existing local records. Restore into empty storage to restore backup preferences as well.

## Migrations

Version 1 defines foods, workouts and preferences. Version 2 adds daily snapshots, drafts and deletion receipts, keeping the original stores and entries. Existing v1 preferences become the baseline goal timeline. `onupgradeneeded` performs changes in the browser's version-change transaction; failure rolls back. Tests create a real v1 database and verify v2 persistence. Future versions must add explicit `oldVersion < N` steps and preserve IDs, dates and timestamps; do not delete and recreate the database. Close other tabs when a version change is blocked. No unknown previous browser schema is guessed or imported silently.

An import is validated in full, then merged in a single multi-store transaction. Interrupted writes either commit completely or abort. Browsers without available IndexedDB get a storage error rather than a false success. Storage quota errors retain the main form. The app doesn't promise writes survive an OS termination that occurs before a browser transaction commits.

## Offline and updates

`CalorieAssets.service_worker` hashes the worker template, app modules, CSS, icons, manifest and ERB templates. Both Rails and the exporter use it. Each worker owns a versioned cache scoped to its deployment directory. Installation requires the whole shell; navigation serves its cached root. The scope and manifest paths are relative to the hosting subdirectory. All app navigation uses hashes.

An updated worker waits until explicitly accepted in Settings or normal worker lifecycle activation after old clients close. Activation removes only obsolete Calorie caches for that scope; unrelated caches and IndexedDB remain intact. Personal records never travel in requests and never enter service-worker caches. Export files remain local browser downloads. No external assets are necessary for offline operation; the optional ChatGPT link naturally needs network access.
