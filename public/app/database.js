import {
  DEFAULT_SETTINGS,
  goalForDate,
  settingsWithGoals,
  validateEntry,
  validateBackup,
  localDate,
} from "./domain.js";
export const DB_NAME = "calorie-local";
export const DB_VERSION = 2;
const STORES = [
  "foods",
  "workouts",
  "settings",
  "goals",
  "drafts",
  "pending_deletions",
];
const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
export function migrate(db, tx, oldVersion) {
  if (oldVersion < 1) {
    for (const name of ["foods", "workouts"]) {
      const store = db.createObjectStore(name, { keyPath: "id" });
      store.createIndex("local_date", "local_date");
    }
    db.createObjectStore("settings");
  }
  if (oldVersion < 2) {
    db.createObjectStore("goals", { keyPath: "local_date" });
    db.createObjectStore("drafts");
    db.createObjectStore("pending_deletions", { keyPath: "id" });
    // v1 already used local_date. Preserve stores and establish the old target
    // as the baseline for every existing date, rather than deleting any data.
    const settings = tx.objectStore("settings");
    const read = settings.get("preferences");
    read.onsuccess = () => {
      const previous = read.result;
      if (previous && !previous.goal_versions)
        settings.put(
          {
            ...previous,
            goal_versions: [
              {
                date: "0001-01-01",
                daily_calorie_goal: previous.daily_calorie_goal,
                optional_daily_protein_goal:
                  previous.optional_daily_protein_goal ?? null,
              },
            ],
          },
          "preferences",
        );
    };
  }
}
export function openDatabase(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = (event) =>
      migrate(req.result, req.transaction, event.oldVersion);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(
        new Error(
          "Close other Calorie tabs, then reopen to finish the storage update.",
        ),
      );
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(new Repository(req.result));
    };
  });
}
export class Repository {
  constructor(db) {
    this.db = db;
  }
  async transaction(stores, mode, action) {
    const tx = this.db.transaction(stores, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () =>
        reject(tx.error || new Error("Storage change was cancelled."));
      tx.onerror = () => {};
    });
    try {
      const result = await action(tx);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async settings() {
    return this.transaction(
      ["settings"],
      "readonly",
      async (tx) =>
        (await request(tx.objectStore("settings").get("preferences"))) ||
        structuredClone(DEFAULT_SETTINGS),
    );
  }
  async goal(date) {
    return this.transaction(["goals", "settings"], "readwrite", async (tx) => {
      const store = tx.objectStore("goals");
      let goal = await request(store.get(date));
      if (!goal) {
        const settings =
          (await request(tx.objectStore("settings").get("preferences"))) ||
          DEFAULT_SETTINGS;
        goal = { local_date: date, ...goalForDate(settings, date) };
        store.put(goal);
      }
      return goal;
    });
  }
  async saveSettings(next, date = localDate()) {
    return this.transaction(["settings", "goals"], "readwrite", async (tx) => {
      const store = tx.objectStore("settings");
      const previous =
        (await request(store.get("preferences"))) || DEFAULT_SETTINGS;
      const settings = settingsWithGoals(previous, next, date);
      store.put(settings, "preferences");
      const goals = tx.objectStore("goals");
      const upcoming = await request(
        goals.getAll(IDBKeyRange.lowerBound(date)),
      );
      const dates = new Set([date, ...upcoming.map((goal) => goal.local_date)]);
      for (const local_date of dates)
        goals.put({
          local_date,
          daily_calorie_goal: settings.daily_calorie_goal,
          optional_daily_protein_goal: settings.optional_daily_protein_goal,
        });
      return settings;
    });
  }
  async day(date) {
    return this.transaction(["foods", "workouts"], "readonly", async (tx) => ({
      foods: await request(
        tx.objectStore("foods").index("local_date").getAll(date),
      ),
      workouts: await request(
        tx.objectStore("workouts").index("local_date").getAll(date),
      ),
    }));
  }
  async dates(before = localDate()) {
    return this.transaction(["foods", "workouts"], "readonly", async (tx) => {
      const dates = new Set();
      for (const name of ["foods", "workouts"])
        await new Promise((resolve, reject) => {
          const cursor = tx
            .objectStore(name)
            .index("local_date")
            .openKeyCursor(IDBKeyRange.upperBound(before, true), "prevunique");
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (row) {
              dates.add(row.key);
              row.continue();
            } else resolve();
          };
          cursor.onerror = () => reject(cursor.error);
        });
      return [...dates].sort().reverse();
    });
  }
  async save(kind, raw, original = null) {
    const entry = {
      ...validateEntry(kind, raw),
      id: original?.id || crypto.randomUUID(),
      created_at: original?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const storeName = kind === "food" ? "foods" : "workouts";
    await this.transaction(
      [storeName, "goals", "settings", "drafts"],
      "readwrite",
      async (tx) => {
        const goals = tx.objectStore("goals");
        for (const date of new Set(
          [entry.local_date, original?.local_date].filter(Boolean),
        ))
          if (!(await request(goals.get(date)))) {
            const settings =
              (await request(tx.objectStore("settings").get("preferences"))) ||
              DEFAULT_SETTINGS;
            goals.put({ local_date: date, ...goalForDate(settings, date) });
          }
        tx.objectStore(storeName).put(entry);
        if (!original) tx.objectStore("drafts").delete(kind);
      },
    );
    return entry;
  }
  async remove(kind, entry) {
    const store = kind === "food" ? "foods" : "workouts";
    const pending = {
      id: entry.id,
      kind,
      entry,
      expires_at: Date.now() + 15000,
    };
    await this.transaction(
      [store, "pending_deletions"],
      "readwrite",
      async (tx) => {
        tx.objectStore(store).delete(entry.id);
        tx.objectStore("pending_deletions").put(pending);
      },
    );
    return pending;
  }
  async undo(id) {
    return this.transaction(
      ["foods", "workouts", "pending_deletions"],
      "readwrite",
      async (tx) => {
        const store = tx.objectStore("pending_deletions");
        const pending = await request(store.get(id));
        if (!pending || pending.expires_at < Date.now())
          throw new Error("The undo window has ended.");
        tx.objectStore(pending.kind === "food" ? "foods" : "workouts").put(
          pending.entry,
        );
        store.delete(id);
      },
    );
  }
  async pending() {
    return this.transaction(["pending_deletions"], "readwrite", async (tx) => {
      const store = tx.objectStore("pending_deletions");
      const rows = await request(store.getAll());
      for (const row of rows)
        if (row.expires_at < Date.now()) store.delete(row.id);
      return rows
        .filter((r) => r.expires_at >= Date.now())
        .sort((a, b) => b.expires_at - a.expires_at);
    });
  }
  async draft(kind, value) {
    return this.transaction(
      ["drafts"],
      value === undefined ? "readonly" : "readwrite",
      async (tx) => {
        const store = tx.objectStore("drafts");
        if (value === undefined) return await request(store.get(kind));
        if (value === null) store.delete(kind);
        else store.put(value, kind);
      },
    );
  }
  async export() {
    return this.transaction(
      ["foods", "workouts", "settings", "goals"],
      "readonly",
      async (tx) => ({
        app: "Calorie",
        schema_version: 2,
        exported_at: new Date().toISOString(),
        foods: await request(tx.objectStore("foods").getAll()),
        workouts: await request(tx.objectStore("workouts").getAll()),
        settings:
          (await request(tx.objectStore("settings").get("preferences"))) ||
          structuredClone(DEFAULT_SETTINGS),
        goals: await request(tx.objectStore("goals").getAll()),
      }),
    );
  }
  async import(raw) {
    const backup = validateBackup(raw);
    return this.transaction(
      ["foods", "workouts", "settings", "goals", "pending_deletions"],
      "readwrite",
      async (tx) => {
        let added = 0,
          skipped = 0;
        const settingsStore = tx.objectStore("settings");
        const currentSettings = await request(settingsStore.get("preferences"));
        const currentFoods = await request(tx.objectStore("foods").count());
        const currentWorkouts = await request(
          tx.objectStore("workouts").count(),
        );
        const empty = !currentFoods && !currentWorkouts && !currentSettings;
        // A fresh launch creates today's default snapshot; an empty restore may replace it.
        if (empty) {
          settingsStore.put(backup.settings, "preferences");
          tx.objectStore("goals").clear();
        }
        for (const [name, rows, key] of [
          ["foods", backup.foods, "id"],
          ["workouts", backup.workouts, "id"],
          ["goals", backup.goals, "local_date"],
        ]) {
          const store = tx.objectStore(name);
          for (const row of rows) {
            const exists = await request(store.get(row[key]));
            const deleted =
              name !== "goals" &&
              (await request(tx.objectStore("pending_deletions").get(row.id)));
            if (exists || deleted) {
              skipped++;
              continue;
            }
            store.put(row);
            if (name !== "goals") added++;
          }
        }
        // Materialize missing snapshots with the backup's original goals, not today's target.
        for (const entry of [...backup.foods, ...backup.workouts]) {
          const store = tx.objectStore("goals");
          if (!(await request(store.get(entry.local_date))))
            store.put({
              local_date: entry.local_date,
              ...goalForDate(backup.settings, entry.local_date),
            });
        }
        if (empty && !(await request(tx.objectStore("goals").get(localDate()))))
          tx.objectStore("goals").put({
            local_date: localDate(),
            ...goalForDate(backup.settings, localDate()),
          });
        return { added, skipped };
      },
    );
  }
  async clear() {
    return this.transaction(STORES, "readwrite", async (tx) => {
      for (const name of STORES) tx.objectStore(name).clear();
    });
  }
}
