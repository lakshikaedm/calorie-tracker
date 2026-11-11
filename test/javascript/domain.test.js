import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS as defaults,
  localDate,
  localTime,
  validateEntry,
  validateSettings,
  summarize,
  orderEntries,
  estimateQuestion,
  goalForDate,
  settingsWithGoals,
  validateBackup,
  validDate,
} from "../../public/app/domain.js";
const date = "2026-11-11";
const food = (calories = 1000, protein_grams = 25, extra = {}) => ({
  id: "food-1",
  name: "Chicken curry",
  portion: "200g",
  meal_type: "Lunch",
  calories,
  protein_grams,
  local_date: date,
  local_time: "12:40",
  created_at: "2026-11-11T03:40:00Z",
  updated_at: "2026-11-11T03:40:00Z",
  ...extra,
});
const workout = (calories_burned = 300, extra = {}) => ({
  id: "workout-1",
  name: "Gym",
  calories_burned,
  local_date: date,
  local_time: "11:30",
  created_at: "2026-11-11T02:30:00Z",
  updated_at: "2026-11-11T02:30:00Z",
  ...extra,
});
test("A: workout increases remaining to 1100", () =>
  assert.equal(
    summarize([food()], [workout()], defaults, date).remaining,
    1100,
  ));
test("B: excess food preserves negative remaining", () =>
  assert.equal(
    summarize([food(2000)], [workout(100)], defaults, date).remaining,
    -100,
  ));
test("C: protein totals 60.5 and ignores workouts", () =>
  assert.equal(
    summarize([food(), food(10, 35.5)], [workout(900)], defaults, date).protein,
    60.5,
  ));
test("optional protein goal and negative remainder", () => {
  assert.equal(summarize([food()], [], defaults, date).proteinRemaining, null);
  assert.equal(
    summarize(
      [food(100, 45)],
      [],
      { ...defaults, optional_daily_protein_goal: 40 },
      date,
    ).proteinRemaining,
    -5,
  );
});
test("food intake progress stays separate from exercise", () => {
  const s = summarize([food(900)], [workout(1000)], defaults, date);
  assert.equal(s.progress, 50);
  assert.equal(s.food, 900);
  assert.equal(s.burned, 1000);
  assert.equal(s.remaining, 1900);
});
test("progress clamps empty and exceeded days", () => {
  assert.equal(summarize([], [], defaults, date).progress, 0);
  assert.equal(summarize([food(3000)], [], defaults, date).progress, 100);
});
test("today filters yesterday out", () => {
  const s = summarize(
    [food(), food(999, 99, { local_date: "2026-11-10" })],
    [workout(300, { local_date: "2026-11-10" })],
    defaults,
    date,
  );
  assert.equal(s.food, 1000);
  assert.equal(s.burned, 0);
  assert.equal(s.protein, 25);
});
test("local calendar handling across midnight without UTC slicing", () => {
  const before = new Date(2026, 10, 11, 23, 59);
  const after = new Date(2026, 10, 12, 0, 1);
  assert.equal(localDate(before), date);
  assert.equal(localDate(after), "2026-11-12");
  assert.equal(localTime(after), "00:01");
});
test("portion and meal type validated and preserved", () => {
  const entry = validateEntry("food", food());
  assert.equal(entry.portion, "200g");
  assert.equal(entry.meal_type, "Lunch");
});
test("food protein defaults to zero", () =>
  assert.equal(validateEntry("food", food(100, "")).protein_grams, 0));
test("zero calories valid and decimals preserved", () => {
  assert.equal(validateEntry("food", food(0, 12.5)).protein_grams, 12.5);
  assert.equal(validateEntry("workout", workout(0)).calories_burned, 0);
});
test("invalid numeric values are rejected", () => {
  for (const value of [-1, Infinity, NaN, "", null, true, {}, 1000001])
    assert.throws(() => validateEntry("food", food(value)));
  assert.throws(() => validateEntry("workout", workout(-1)));
  assert.throws(() => validateEntry("food", food(100, -1)));
});
test("required names portions meal types times dates validated", () => {
  for (const extra of [
    { name: " " },
    { portion: "" },
    { meal_type: "Brunch" },
    { local_time: "25:00" },
    { local_date: "2026-02-30" },
  ])
    assert.throws(() => validateEntry("food", food(100, 2, extra)));
});
test("calendar validation including leap day", () => {
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("0001-01-01"), true);
  assert.equal(validDate("0000-01-01"), false);
});
test("history target changes are effective today onwards", () => {
  const updated = settingsWithGoals(
    defaults,
    { ...defaults, daily_calorie_goal: 2100, optional_daily_protein_goal: 80 },
    date,
  );
  assert.equal(goalForDate(updated, "2026-11-10").daily_calorie_goal, 1800);
  assert.equal(goalForDate(updated, date).daily_calorie_goal, 2100);
  assert.equal(
    goalForDate(updated, "2026-11-12").optional_daily_protein_goal,
    80,
  );
});
test("settings changes on same date replace that date only", () => {
  let s = settingsWithGoals(
    defaults,
    { ...defaults, daily_calorie_goal: 1900 },
    date,
  );
  s = settingsWithGoals(s, { ...s, daily_calorie_goal: 2000 }, date);
  assert.equal(s.goal_versions.length, 2);
  assert.equal(goalForDate(s, "2026-11-10").daily_calorie_goal, 1800);
});
test("invalid settings rejected", () => {
  for (const extra of [
    { daily_calorie_goal: 0 },
    { theme: "blue" },
    { optional_daily_protein_goal: -1 },
    { optional_daily_protein_goal: 0 },
  ])
    assert.throws(() => validateSettings({ ...defaults, ...extra }));
});
test("chronological ordering newest local time first with stable ties", () => {
  const a = food(1, 1, { id: "a", local_time: "11:00" }),
    b = workout(),
    c = food(1, 1, { id: "c" });
  assert.deepEqual(
    orderEntries([a, b, c]).map((e) => e.id),
    ["c", "workout-1", "a"],
  );
});
test("copy question exact text independent of calories", () => {
  assert.equal(
    estimateQuestion("Chicken curry", "200g"),
    "Calculate roughly the calories and protein in Chicken curry, portion: 200g. Give a reasonable estimate in kcal and grams of protein.",
  );
  assert.throws(() => estimateQuestion("", "200g"));
  assert.throws(() => estimateQuestion("Chicken", ""));
});
const backup = () => ({
  app: "Calorie",
  schema_version: 2,
  foods: [food()],
  workouts: [workout()],
  settings: structuredClone(defaults),
  goals: [
    {
      local_date: date,
      daily_calorie_goal: 1800,
      optional_daily_protein_goal: null,
    },
  ],
});
test("JSON backup round trip preserves all values", () => {
  const data = validateBackup(JSON.parse(JSON.stringify(backup())));
  assert.deepEqual(data.foods[0], food());
  assert.deepEqual(data.workouts[0], workout());
  assert.equal(data.goals[0].daily_calorie_goal, 1800);
});
test("backup rejects invalid shape version duplicate ids and corrupted records", () => {
  assert.throws(() => validateBackup({}));
  let b = backup();
  b.schema_version = 99;
  assert.throws(() => validateBackup(b));
  b = backup();
  b.foods.push(food());
  assert.throws(() => validateBackup(b));
  b = backup();
  b.workouts[0].calories_burned = -5;
  assert.throws(() => validateBackup(b));
  b = backup();
  b.settings.goal_versions = [];
  assert.throws(() => validateBackup(b));
});
test("decimal inputs avoid accumulated display error", () =>
  assert.equal(
    summarize([food(0.1, 0.1), food(0.2, 0.2)], [], defaults, date).food,
    0.3,
  ));
