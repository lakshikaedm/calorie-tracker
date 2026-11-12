const { openDatabase, DB_VERSION } = await import(
  new URL("app/database.js", document.baseURI)
);
const { localDate, DEFAULT_SETTINGS, summarize } = await import(
  new URL("app/domain.js", document.baseURI)
);
const results = [];
function equal(actual, expected, message = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}
const name = "calorie-test-" + crypto.randomUUID();
const repo = await openDatabase(name);
const today = localDate();
const yesterday = "2025-10-14";
const f = {
  name: "Chicken curry",
  portion: "200g",
  meal_type: "Lunch",
  calories: 1000,
  protein_grams: 25,
  local_date: today,
  local_time: "12:40",
};
const w = {
  name: "Gym",
  calories_burned: 300,
  local_date: today,
  local_time: "11:30",
};
async function check(label, run) {
  try {
    await run();
    results.push({ label, pass: true });
  } catch (error) {
    results.push({ label, pass: false, error: error.stack });
  }
}
let food, workout, backup;
await check("IndexedDB add food and persist portion and meal", async () => {
  food = await repo.save("food", f);
  const d = await repo.day(today);
  equal(d.foods[0].portion, "200g");
  equal(d.foods[0].meal_type, "Lunch");
  equal(d.foods[0].calories, 1000);
});
await check("IndexedDB add workout and calculate budget", async () => {
  workout = await repo.save("workout", w);
  const d = await repo.day(today);
  equal(
    summarize(d.foods, d.workouts, await repo.goal(today), today).remaining,
    1100,
  );
});
await check("edit food and recalculate protein", async () => {
  food = await repo.save(
    "food",
    { ...food, calories: 2000, protein_grams: 35.5 },
    food,
  );
  const d = await repo.day(today);
  equal(d.foods[0].id, food.id);
  equal(d.foods[0].protein_grams, 35.5);
  equal(d.foods.length, 1);
});
await check("edit workout and negative remaining", async () => {
  workout = await repo.save(
    "workout",
    { ...workout, calories_burned: 100 },
    workout,
  );
  const d = await repo.day(today);
  equal(
    summarize(d.foods, d.workouts, await repo.goal(today), today).remaining,
    -100,
  );
});
await check("daily goal snapshot survives later target changes", async () => {
  await repo.save("food", { ...f, local_date: yesterday });
  await repo.saveSettings(
    {
      ...DEFAULT_SETTINGS,
      daily_calorie_goal: 2100,
      optional_daily_protein_goal: 80,
    },
    today,
  );
  equal((await repo.goal(yesterday)).daily_calorie_goal, 1800);
  equal((await repo.goal(today)).daily_calorie_goal, 2100);
  equal((await repo.goal("2024-01-01")).daily_calorie_goal, 1800);
});
await check("edit date moves entry out of Today into History", async () => {
  food = await repo.save("food", { ...food, local_date: yesterday }, food);
  equal((await repo.day(today)).foods.length, 0);
  equal((await repo.day(yesterday)).foods.length, 2);
  equal(await repo.dates(today), [yesterday]);
});
await check("delete food and undo restores original fields", async () => {
  await repo.remove("food", food);
  equal((await repo.day(yesterday)).foods.length, 1);
  await repo.undo(food.id);
  equal((await repo.day(yesterday)).foods.length, 2);
});
await check("delete workout and undo", async () => {
  await repo.remove("workout", workout);
  equal((await repo.day(today)).workouts.length, 0);
  await repo.undo(workout.id);
  equal((await repo.day(today)).workouts[0].calories_burned, 100);
});
await check("draft persistence and save clears only its draft", async () => {
  await repo.draft("food", { name: "Banana", portion: "1 banana" });
  await repo.draft("workout", { name: "Walking" });
  equal((await repo.draft("food")).portion, "1 banana");
  await repo.save("food", f);
  equal(await repo.draft("food"), undefined);
  equal((await repo.draft("workout")).name, "Walking");
});
await check("export valid JSON with goals and stable IDs", async () => {
  backup = JSON.parse(JSON.stringify(await repo.export()));
  equal(backup.app, "Calorie");
  equal(backup.schema_version, 2);
  equal(backup.settings.daily_calorie_goal, 2100);
  equal(backup.foods.length, 3);
});
await check("import merge is idempotent and keeps newer edits", async () => {
  food = await repo.save("food", { ...food, name: "Updated chicken" }, food);
  const result = await repo.import(backup);
  equal(result.added, 0);
  equal(
    (await repo.day(yesterday)).foods.find((e) => e.id === food.id).name,
    "Updated chicken",
  );
});
await check("malformed import is rejected atomically", async () => {
  const bad = structuredClone(backup);
  bad.foods[0].calories = -1;
  let rejected = false;
  try {
    await repo.import(bad);
  } catch {
    rejected = true;
  }
  equal(rejected, true);
  equal((await repo.export()).foods.length, 3);
});
await check(
  "restore into empty app restores settings and historical goals",
  async () => {
    await repo.clear();
    await repo.goal(today);
    const result = await repo.import(backup);
    equal(result.added, 4);
    equal((await repo.settings()).daily_calorie_goal, 2100);
    equal((await repo.goal(yesterday)).daily_calorie_goal, 1800);
    equal((await repo.goal(today)).optional_daily_protein_goal, 80);
    equal((await repo.import(backup)).added, 0);
  },
);
await check("pending delete survives reopening with Undo", async () => {
  await repo.remove("workout", workout);
  repo.db.close();
  const reopened = await openDatabase(name);
  equal((await reopened.pending())[0].id, workout.id);
  await reopened.undo(workout.id);
  equal((await reopened.day(today)).workouts.length, 1);
  reopened.db.close();
});
await check(
  "v1 to v2 migration preserves entries and prior goal baseline",
  async () => {
    const legacy = name + "-legacy";
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(legacy, 1);
      req.onupgradeneeded = () => {
        for (const name of ["foods", "workouts"]) {
          const store = req.result.createObjectStore(name, { keyPath: "id" });
          store.createIndex("local_date", "local_date");
        }
        req.result.createObjectStore("settings");
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["foods", "settings"], "readwrite");
        tx.objectStore("foods").put({
          ...f,
          id: "old-entry",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        });
        tx.objectStore("settings").put(
          {
            daily_calorie_goal: 1600,
            optional_daily_protein_goal: null,
            theme: "dark",
          },
          "preferences",
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
    const migrated = await openDatabase(legacy);
    equal(migrated.db.version, DB_VERSION);
    equal((await migrated.day(today)).foods[0].id, "old-entry");
    equal((await migrated.goal(yesterday)).daily_calorie_goal, 1600);
    equal((await migrated.settings()).theme, "dark");
    await migrated.draft("food", { name: "test" });
    equal((await migrated.draft("food")).name, "test");
    migrated.db.close();
    indexedDB.deleteDatabase(legacy);
  },
);
await check("Widget Sync preserves v2 records, isolates credentials and marks every committed mutation", async () => {
  const widgetName = name + "-widget";
  let device = await openDatabase(widgetName);
  await device.import(backup);
  const before = await device.export();
  const stores = [...device.db.objectStoreNames];
  equal((await device.widgetSync()).enabled, false);
  await device.widgetSync(state => ({ ...state, enabled: true, token: "PRIVATE_TEST_SENTINEL",
    endpoint: "https://widget.example/api/summary" }));
  const after = await device.export();
  equal({ ...after, exported_at: null }, { ...before, exported_at: null });
  equal(JSON.stringify(await device.export()).includes("PRIVATE_TEST_SENTINEL"), false);
  device.db.close();
  device = await openDatabase(widgetName);
  equal(device.db.version, 2);
  equal([...device.db.objectStoreNames], stores);
  equal((await device.export()).foods, before.foods);
  equal((await device.export()).workouts, before.workouts);
  equal((await device.widgetSync()).token, "PRIVATE_TEST_SENTINEL");
  async function mutation(run) {
    await device.widgetSync(state => ({ ...state, pending: false }));
    const revision = (await device.widgetSync()).revision;
    await run();
    equal((await device.widgetSync()).pending, true);
    equal((await device.widgetSync()).revision === revision, false);
  }
  let entry;
  await mutation(async () => { entry = await device.save("food", f); });
  await mutation(async () => { entry = await device.save("food", { ...entry, calories: 500 }, entry); });
  await mutation(() => device.remove("food", entry));
  await mutation(() => device.undo(entry.id));
  await mutation(async () => { entry = await device.save("workout", w); });
  await mutation(async () => { entry = await device.save("workout", { ...entry, calories_burned: 200 }, entry); });
  await mutation(() => device.remove("workout", entry));
  await mutation(() => device.undo(entry.id));
  await mutation(() => device.saveSettings({ ...DEFAULT_SETTINGS, daily_calorie_goal: 2300 }));
  await mutation(() => device.save("food", { ...f, local_date: yesterday }));
  await mutation(() => device.import(backup));
  equal((await device.widgetSync()).token, "PRIVATE_TEST_SENTINEL");
  equal(JSON.stringify(await device.export()).includes("PRIVATE_TEST_SENTINEL"), false);
  // Rejected local mutations cannot create pending cloud changes.
  await device.widgetSync(state => ({ ...state, pending: false }));
  try { await device.save("food", { ...f, calories: -1 }); } catch {}
  equal((await device.widgetSync()).pending, false);
  device.db.close();
  indexedDB.deleteDatabase(widgetName);
});
indexedDB.deleteDatabase(name);
return results;
