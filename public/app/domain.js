export const DEFAULT_SETTINGS = {
  daily_calorie_goal: 1800,
  optional_daily_protein_goal: null,
  theme: "system",
  goal_versions: [
    {
      date: "0001-01-01",
      daily_calorie_goal: 1800,
      optional_daily_protein_goal: null,
    },
  ],
};
export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack", "Other"];
export const localDate = (now = new Date()) =>
  `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
export const localTime = (now = new Date()) =>
  `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
export const formatNumber = (number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number);
export const formatDate = (
  date,
  options = { month: "long", day: "numeric", year: "numeric" },
) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, options);
export function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "0001-01-01"
  )
    return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(+date) && localDate(date) === value;
}
export function nonnegative(value, label, optional = false) {
  if (optional && (value === "" || value == null)) return 0;
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    String(value).trim() === "" ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0 ||
    Number(value) > 1000000
  )
    throw new Error(`${label} must be a number between 0 and 1,000,000.`);
  return Number(value);
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200)
    throw new Error(`${label} is required (up to 200 characters).`);
  return value.trim();
}
export function validateEntry(kind, raw) {
  if (!["food", "workout"].includes(kind))
    throw new Error("Unknown entry type.");
  const entry = {
    name: text(raw.name, kind === "food" ? "Food name" : "Workout name"),
    local_date: raw.local_date,
    local_time: raw.local_time,
  };
  if (!validDate(entry.local_date)) throw new Error("Choose a valid date.");
  if (
    typeof entry.local_time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.local_time)
  )
    throw new Error("Choose a valid time.");
  if (kind === "food") {
    entry.portion = text(raw.portion, "Portion");
    if (!MEALS.includes(raw.meal_type)) throw new Error("Choose a meal type.");
    entry.meal_type = raw.meal_type;
    entry.calories = nonnegative(raw.calories, "Calories");
    entry.protein_grams = nonnegative(raw.protein_grams, "Protein", true);
  } else
    entry.calories_burned = nonnegative(raw.calories_burned, "Calories burned");
  return entry;
}
export function validateSettings(raw) {
  const daily_calorie_goal = nonnegative(
    raw.daily_calorie_goal,
    "Daily calorie target",
  );
  if (daily_calorie_goal <= 0)
    throw new Error("Daily calorie target must be greater than zero.");
  const optional_daily_protein_goal =
    raw.optional_daily_protein_goal == null
      ? null
      : nonnegative(raw.optional_daily_protein_goal, "Protein target");
  if (optional_daily_protein_goal === 0)
    throw new Error("Protein target must be greater than zero.");
  if (!["system", "light", "dark"].includes(raw.theme))
    throw new Error("Choose a valid appearance.");
  return { daily_calorie_goal, optional_daily_protein_goal, theme: raw.theme };
}
export function goalForDate(settings, date) {
  const versions = settings.goal_versions || DEFAULT_SETTINGS.goal_versions;
  const version =
    [...versions]
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter((v) => v.date <= date)
      .at(-1) || DEFAULT_SETTINGS;
  return {
    daily_calorie_goal: version.daily_calorie_goal,
    optional_daily_protein_goal: version.optional_daily_protein_goal,
  };
}
export function settingsWithGoals(previous, next, date) {
  const valid = validateSettings(next);
  const versions = [
    ...(previous.goal_versions || DEFAULT_SETTINGS.goal_versions),
  ].filter((v) => v.date < date);
  versions.push({
    date,
    daily_calorie_goal: valid.daily_calorie_goal,
    optional_daily_protein_goal: valid.optional_daily_protein_goal,
  });
  return {
    ...valid,
    goal_versions: versions.sort((a, b) => a.date.localeCompare(b.date)),
  };
}
// Compensated summation reduces decimal drift; formatting rounds only for display.
function sum(values) {
  let total = 0,
    correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = total + adjusted;
    correction = next - total - adjusted;
    total = next;
  }
  return Number(total.toFixed(8));
}
export function summarize(foods, workouts, goal, date) {
  const food = sum(
    foods.filter((e) => e.local_date === date).map((e) => e.calories),
  );
  const burned = sum(
    workouts.filter((e) => e.local_date === date).map((e) => e.calories_burned),
  );
  const protein = sum(
    foods.filter((e) => e.local_date === date).map((e) => e.protein_grams),
  );
  return {
    food,
    burned,
    protein,
    remaining: Number((goal.daily_calorie_goal - food + burned).toFixed(8)),
    proteinRemaining:
      goal.optional_daily_protein_goal == null
        ? null
        : Number((goal.optional_daily_protein_goal - protein).toFixed(8)),
    progress: Math.min(
      100,
      Math.max(0, (food / goal.daily_calorie_goal) * 100),
    ),
    percent: (food / goal.daily_calorie_goal) * 100,
  };
}
export const orderEntries = (entries) =>
  [...entries].sort(
    (a, b) =>
      b.local_time.localeCompare(a.local_time) ||
      b.created_at.localeCompare(a.created_at) ||
      b.id.localeCompare(a.id),
  );
export function estimateQuestion(name, portion) {
  return `Calculate roughly the calories and protein in ${text(name, "Food name")}, portion: ${text(portion, "Portion")}. Give a reasonable estimate in kcal and grams of protein.`;
}
function identity(raw) {
  if (typeof raw.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.id))
    throw new Error("Backup contains an invalid record ID.");
  for (const key of ["created_at", "updated_at"])
    if (typeof raw[key] !== "string" || !Number.isFinite(Date.parse(raw[key])))
      throw new Error("Backup contains an invalid timestamp.");
  return { id: raw.id, created_at: raw.created_at, updated_at: raw.updated_at };
}
export function validateBackup(raw) {
  if (
    !raw ||
    raw.app !== "Calorie" ||
    raw.schema_version !== 2 ||
    !Array.isArray(raw.foods) ||
    !Array.isArray(raw.workouts) ||
    !Array.isArray(raw.goals)
  )
    throw new Error("Choose a Calorie schema version 2 JSON backup.");
  const settings = validateSettings(raw.settings || {});
  if (
    !Array.isArray(raw.settings.goal_versions) ||
    !raw.settings.goal_versions.length
  )
    throw new Error("Backup is missing goal history.");
  settings.goal_versions = raw.settings.goal_versions.map((v) => {
    if (!validDate(v.date)) throw new Error("Invalid goal date.");
    return {
      date: v.date,
      ...validateSettings({ ...v, theme: settings.theme }),
    };
  });
  if (!settings.goal_versions.some((v) => v.date === "0001-01-01"))
    throw new Error("Backup is missing its initial daily target.");
  const foods = raw.foods.map((e) => ({
    ...identity(e),
    ...validateEntry("food", e),
  }));
  const workouts = raw.workouts.map((e) => ({
    ...identity(e),
    ...validateEntry("workout", e),
  }));
  const goals = raw.goals.map((g) => {
    if (!validDate(g.local_date)) throw new Error("Invalid daily target date.");
    const valid = validateSettings({ ...g, theme: settings.theme });
    return {
      local_date: g.local_date,
      daily_calorie_goal: valid.daily_calorie_goal,
      optional_daily_protein_goal: valid.optional_daily_protein_goal,
    };
  });
  for (const [rows, key] of [
    [foods, "id"],
    [workouts, "id"],
    [goals, "local_date"],
    [settings.goal_versions, "date"],
  ])
    if (new Set(rows.map((r) => r[key])).size !== rows.length)
      throw new Error("Backup contains duplicate record IDs or dates.");
  return { foods, workouts, goals, settings };
}
