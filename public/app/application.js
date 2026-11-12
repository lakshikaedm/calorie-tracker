import {
  localDate,
  localTime,
  formatDate,
  formatNumber as n,
  summarize,
  orderEntries,
  estimateQuestion,
  MEALS,
} from "./domain.js";
import { openDatabase } from "./database.js";
import { copyText } from "./clipboard.js";
import { registerPWA } from "./pwa.js";
import { WidgetSync, widgetConfiguration } from "./widget_sync.js";
const $ = (selector) => document.querySelector(selector);
const form = $("#entry-form");
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let repo,
  widgetSync,
  settings,
  kind = "food",
  today = localDate(),
  edit = null,
  historyLimit = 30,
  refreshVersion = 0,
  submitting = false,
  writeQueue = Promise.resolve(),
  toastTimer;
const drafts = {};
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("calorie-changes")
    : null;
const fields = (target) => Object.fromEntries(new FormData(target));
function errorMessage(error) {
  if (error?.name === "QuotaExceededError")
    return "Device storage is full. Export a backup and free some space, then try again.";
  return (
    error?.message ||
    "Unable to save on this device. Your form is still here. Please try again."
  );
}
function showError(target, error) {
  target.textContent = errorMessage(error);
  target.hidden = false;
}
function notify(message, duration = 3500) {
  clearTimeout(toastTimer);
  $("#toast-text").textContent = message;
  $("#undo-delete").hidden = true;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
    showPending();
  }, duration);
}
async function showPending() {
  if (!repo) return;
  const rows = await repo.pending();
  if (!rows.length) return;
  const pending = rows[0];
  clearTimeout(toastTimer);
  $("#toast-text").textContent =
    `${pending.kind === "food" ? "Food" : "Workout"} deleted`;
  $("#undo-delete").hidden = false;
  $("#toast").hidden = false;
  $("#undo-delete").onclick = async () => {
    try {
      await repo.undo(pending.id);
      changed();
      await refresh();
      notify("Entry restored");
    } catch (e) {
      notify(errorMessage(e));
    }
  };
  toastTimer = setTimeout(
    () => {
      $("#toast").hidden = true;
      showPending();
    },
    Math.max(1, pending.expires_at - Date.now()),
  );
}
function theme() {
  if (settings.theme === "system")
    delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}
function changed() {
  channel?.postMessage("changed");
}
function queueDraft() {
  const currentKind = kind;
  const draft = { ...fields(form), saved_on: today };
  drafts[currentKind] = draft;
  writeQueue = writeQueue
    .then(() => repo.draft(currentKind, draft))
    .catch((e) => notify(errorMessage(e)));
}
function resetForm() {
  form.reset();
  form.elements.local_time.value = localTime();
  form.elements.meal_type.value = "Breakfast";
  $("#form-error").hidden = true;
}
function applyKind(next, save = true) {
  if (submitting) return;
  if (save) queueDraft();
  kind = next;
  resetForm();
  for (const button of document.querySelectorAll("[data-kind]"))
    button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
  const food = kind === "food";
  $("#food-fields").hidden = !food;
  $("#protein-field").hidden = !food;
  $("#copy-estimate").hidden = !food;
  $("#chatgpt-link").hidden = !food;
  form.elements.portion.required = food;
  form.elements.portion.disabled = !food;
  form.elements.meal_type.disabled = !food;
  form.elements.protein_grams.disabled = !food;
  $("#name-label").textContent = food ? "Food name" : "Workout name";
  form.elements.name.placeholder = food
    ? "e.g. Chicken rice"
    : "e.g. Strength training";
  $("#calories-label").textContent = food ? "Calories" : "Calories burned";
  $("#submit-entry").textContent = food ? "+ Add Food" : "+ Add Workout";
  const draft = drafts[kind];
  if (draft)
    for (const [key, value] of Object.entries(draft))
      if (form.elements[key]) form.elements[key].value = value;
}
function entryMarkup(entry, type) {
  const food = type === "food";
  return `<button class="entry" data-edit-id="${escapeHTML(entry.id)}" data-edit-kind="${type}" aria-label="Edit ${escapeHTML(entry.name)}"><span class="entry-icon"><svg aria-hidden="true"><use href="#i-${type}"/></svg></span><span class="entry-copy"><span class="entry-meta">${escapeHTML(entry.local_time)} &nbsp;·&nbsp; ${food ? escapeHTML(entry.meal_type) : "Workout"}</span><span class="entry-name">${escapeHTML(entry.name)}${food ? ` <span class="entry-portion">${escapeHTML(entry.portion)}</span>` : ""}</span></span><span class="entry-numbers">${n(food ? entry.calories : entry.calories_burned)} kcal<small>${food ? `${n(entry.protein_grams)} g protein` : "burned"}</small></span><svg aria-hidden="true"><use href="#i-arrow"/></svg></button>`;
}
function entriesMarkup(day) {
  return orderEntries([
    ...day.foods.map((e) => ({ ...e, kind: "food" })),
    ...day.workouts.map((e) => ({ ...e, kind: "workout" })),
  ])
    .map((e) => entryMarkup(e, e.kind))
    .join("");
}
function historyTotals(totals, goal) {
  return `<div class="history-totals"><span>Target <strong>${n(goal.daily_calorie_goal)} kcal</strong></span><span>Food <strong>${n(totals.food)} kcal</strong></span><span>Workout <strong>${n(totals.burned)} kcal</strong></span><span>Remaining <strong>${n(totals.remaining)} kcal</strong></span><span>Protein <strong>${n(totals.protein)} g${goal.optional_daily_protein_goal == null ? "" : ` / ${n(goal.optional_daily_protein_goal)} g goal`}</strong></span>${totals.proteinRemaining == null ? "" : `<span>Protein remaining <strong>${n(totals.proteinRemaining)} g</strong></span>`}</div>`;
}
async function renderHistory(version) {
  const list = $("#history-list");
  const openDates = new Set(
    [...list.querySelectorAll("details[open]")].map((d) => d.dataset.date),
  );
  const dates = await repo.dates(today);
  const fragment = document.createDocumentFragment();
  for (const date of dates.slice(0, historyLimit)) {
    const day = await repo.day(date);
    const goal = await repo.goal(date);
    const totals = summarize(day.foods, day.workouts, goal, date);
    const details = document.createElement("details");
    details.className = "history-day";
    details.dataset.date = date;
    details.innerHTML = `<summary><span>${escapeHTML(formatDate(date))}</span><strong>${n(totals.food)} kcal</strong><svg aria-hidden="true"><use href="#i-arrow"/></svg></summary><div class="history-details"></div>`;
    const expand = () => {
      if (details.open && !details.dataset.loaded) {
        details.querySelector(".history-details").innerHTML =
          historyTotals(totals, goal) +
          `<div class="entry-list">${entriesMarkup(day)}</div>`;
        details.dataset.loaded = "true";
      }
    };
    details.addEventListener("toggle", expand);
    if (openDates.has(date)) {
      details.open = true;
      expand();
    }
    fragment.append(details);
  }
  if (version !== refreshVersion) return;
  if (!dates.length)
    list.innerHTML =
      '<div class="empty card"><svg aria-hidden="true"><use href="#i-history"/></svg><strong>Your days will find a home here.</strong>Previous days appear here as you log.</div>';
  else list.replaceChildren(fragment);
  $("#more-history").hidden = dates.length <= historyLimit;
}
async function refresh() {
  const version = ++refreshVersion;
  today = localDate();
  settings = await repo.settings();
  theme();
  const day = await repo.day(today);
  const goal = await repo.goal(today);
  if (version !== refreshVersion) return;
  const totals = summarize(day.foods, day.workouts, goal, today);
  $("#today-date").textContent = formatDate(today, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  $("#target-label").textContent = `Target ${n(goal.daily_calorie_goal)} kcal`;
  $("#remaining-value").textContent = n(totals.remaining);
  $("#food-total").innerHTML = `${n(totals.food)} <small>kcal</small>`;
  $("#workout-total").innerHTML = `${n(totals.burned)} <small>kcal</small>`;
  $("#protein-total").textContent =
    `${n(totals.protein)} g${goal.optional_daily_protein_goal == null ? "" : ` / ${n(goal.optional_daily_protein_goal)} g`}`;
  $("#protein-remaining").hidden = totals.proteinRemaining == null;
  $("#protein-remaining").textContent =
    totals.proteinRemaining == null
      ? ""
      : `${n(totals.proteinRemaining)} g remaining toward your protein target`;
  $("#progress-fill").style.width = `${totals.progress}%`;
  $("#calorie-progress").setAttribute(
    "aria-valuenow",
    totals.progress.toFixed(2),
  );
  $("#calorie-progress").setAttribute(
    "aria-valuetext",
    `${n(totals.food)} of ${n(goal.daily_calorie_goal)} kcal, ${n(totals.percent)} percent`,
  );
  $("#progress-label").textContent = `${n(totals.percent)}% of daily target`;
  const count = day.foods.length + day.workouts.length;
  $("#entry-count").textContent =
    `${count} ${count === 1 ? "entry" : "entries"}`;
  $("#today-entries").innerHTML = count
    ? entriesMarkup(day)
    : '<div class="empty"><svg aria-hidden="true"><use href="#i-food"/></svg><strong>A fresh start for today.</strong>Add your first food or workout above.</div>';
  widgetSync?.schedule();
  if (location.hash === "#history") await renderHistory(version);
}
function route() {
  const history = location.hash === "#history";
  $("#today-screen").hidden = history;
  $("#history-screen").hidden = !history;
  for (const [id, active] of [
    ["#nav-today", !history],
    ["#nav-history", history],
  ]) {
    if (active) $(id).setAttribute("aria-current", "page");
    else $(id).removeAttribute("aria-current");
  }
  if (repo) refresh().catch((e) => notify(errorMessage(e)));
}
function inputMarkup(name, label, value, type = "text", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeHTML(value ?? "")}" ${extra}></label>`;
}
async function openEditor(id, type) {
  const dayContainer = document
    .querySelector(`[data-edit-id="${CSS.escape(id)}"]`)
    ?.closest("[data-date]");
  const day = await repo.day(dayContainer?.dataset.date || today);
  const entry = (type === "food" ? day.foods : day.workouts).find(
    (e) => e.id === id,
  );
  if (!entry) return;
  edit = { entry, kind: type };
  const food = type === "food";
  $("#edit-title").textContent = food ? "Edit food" : "Edit workout";
  $("#edit-form").innerHTML =
    inputMarkup(
      "name",
      food ? "Food name" : "Workout name",
      entry.name,
      "text",
      'required maxlength="200"',
    ) +
    (food
      ? inputMarkup(
          "portion",
          "Portion",
          entry.portion,
          "text",
          'required maxlength="200"',
        ) +
        `<label>Meal type<select name="meal_type">${MEALS.map((m) => `<option ${m === entry.meal_type ? "selected" : ""}>${m}</option>`).join("")}</select></label>`
      : "") +
    inputMarkup(
      food ? "calories" : "calories_burned",
      food ? "Calories (kcal)" : "Calories burned (kcal)",
      food ? entry.calories : entry.calories_burned,
      "number",
      'required min="0" max="1000000" step="any" inputmode="decimal"',
    ) +
    (food
      ? inputMarkup(
          "protein_grams",
          "Protein (g)",
          entry.protein_grams,
          "number",
          'min="0" max="1000000" step="any" inputmode="decimal"',
        )
      : "") +
    `<div class="field-row">${inputMarkup("local_date", "Date", entry.local_date, "date", 'required min="0001-01-01"')}${inputMarkup("local_time", "Time", entry.local_time, "time", "required")}</div><button class="primary">Save changes</button><p id="edit-error" class="error" role="alert" hidden></p>`;
  $("#edit-dialog").showModal();
}
async function boot() {
  try {
    repo = await openDatabase();
    widgetSync = new WidgetSync(repo, { onStatus: state => {
      $("#widget-status").textContent = state.status;
      $("#widget-last-success").textContent = state.last_success
        ? new Date(state.last_success).toLocaleString() : "Never";
      $("#widget-message").textContent = state.error || "";
    } });
    void widgetSync.opportunity();
    settings = await repo.settings();
    theme();
    drafts.food = await repo.draft("food");
    drafts.workout = await repo.draft("workout");
    applyKind("food", false);
    $("#loading").hidden = true;
    route();
    await showPending();
    form.addEventListener("input", queueDraft);
    form.addEventListener("change", queueDraft);
    document
      .querySelectorAll("[data-kind]")
      .forEach((button) =>
        button.addEventListener("click", () => applyKind(button.dataset.kind)),
      );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting) return;
      const raw = fields(form);
      raw.local_date = localDate();
      if (kind === "workout") raw.calories_burned = raw.calories;
      submitting = true;
      form.inert = true;
      $("#form-error").hidden = true;
      const button = $("#submit-entry");
      button.disabled = true;
      try {
        await writeQueue;
        await repo.save(kind, raw);
        drafts[kind] = null;
        resetForm();
        changed();
        await refresh();
        notify(
          kind === "food"
            ? "Food added. A little more in balance."
            : "Workout added",
        );
      } catch (e) {
        showError($("#form-error"), e);
      } finally {
        submitting = false;
        form.inert = false;
        button.disabled = false;
      }
    });
    $("#copy-estimate").addEventListener("click", async () => {
      $("#form-error").hidden = true;
      try {
        const raw = fields(form);
        const question = estimateQuestion(raw.name, raw.portion);
        // Safari needs the Clipboard API call to begin in the tap gesture.
        await copyText(question);
        notify("Copied");
      } catch (e) {
        showError($("#form-error"), e);
      }
    });
    $("#main").addEventListener("click", (event) => {
      const button = event.target.closest("[data-edit-id]");
      if (button)
        openEditor(button.dataset.editId, button.dataset.editKind).catch((e) =>
          notify(errorMessage(e)),
        );
    });
    $("#edit-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await repo.save(edit.kind, fields(event.target), edit.entry);
        $("#edit-dialog").close();
        edit = null;
        changed();
        await refresh();
        notify("Changes saved");
      } catch (e) {
        showError($("#edit-error"), e);
      }
    });
    $("#delete-entry").addEventListener("click", async () => {
      try {
        await repo.remove(edit.kind, edit.entry);
        $("#edit-dialog").close();
        edit = null;
        changed();
        await refresh();
        await showPending();
      } catch (e) {
        showError($("#edit-error"), e);
      }
    });
    $("#open-settings").addEventListener("click", async () => {
      settings = await repo.settings();
      const f = $("#settings-form");
      for (const key of ["daily_calorie_goal", "theme"])
        f.elements[key].value = settings[key];
      f.elements.protein_enabled.checked =
        settings.optional_daily_protein_goal != null;
      f.elements.optional_daily_protein_goal.value =
        settings.optional_daily_protein_goal ?? "";
      const sync = await repo.widgetSync();
      $("#widget-form").elements.enabled.checked = sync.enabled;
      $("#widget-form").elements.endpoint.value = sync.endpoint;
      $("#widget-form").elements.token.value = "";
      $("#widget-form").elements.token.placeholder = sync.token
        ? "Saved on this device — enter a replacement" : "Enter private write token";
      await widgetSync.status();
      toggleProtein();
      $("#settings-error").hidden = true;
      $("#settings-dialog").showModal();
    });
    function toggleProtein() {
      const enabled = $("#settings-form").elements.protein_enabled.checked;
      $("#protein-goal-field").hidden = !enabled;
      $("#settings-form").elements.optional_daily_protein_goal.required =
        enabled;
    }
    $("#settings-form").elements.protein_enabled.addEventListener(
      "change",
      toggleProtein,
    );
    $("#settings-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const raw = fields(event.target);
        raw.optional_daily_protein_goal = raw.protein_enabled
          ? raw.optional_daily_protein_goal
          : null;
        settings = await repo.saveSettings(raw);
        theme();
        $("#settings-dialog").close();
        changed();
        await refresh();
        notify("Preferences saved");
      } catch (e) {
        showError($("#settings-error"), e);
      }
    });
    $("#widget-form").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        const f = event.target;
        const saved = await repo.widgetSync(state => widgetConfiguration(state, {
          enabled: f.elements.enabled.checked,
          endpoint: f.elements.endpoint.value, token: f.elements.token.value,
        }));
        f.elements.token.value = "";
        f.elements.token.placeholder = saved.token
          ? "Saved on this device — enter a replacement" : "Enter private write token";
        changed();
        widgetSync.schedule();
        await widgetSync.status();
      } catch (e) { $("#widget-message").textContent = errorMessage(e); }
    });
    $("#widget-remove-token").addEventListener("click", async () => {
      try {
        await repo.widgetSync(state => ({ ...state, token: "", enabled: false,
          pending: false, status: "Disabled", error: "", revision: crypto.randomUUID() }));
        $("#widget-form").elements.token.value = "";
        $("#widget-form").elements.token.placeholder = "Enter private write token";
        $("#widget-form").elements.enabled.checked = false;
        changed();
        await widgetSync.status();
      } catch { $("#widget-message").textContent = "Unable to remove the token from local storage. Try again."; }
    });
    $("#widget-test").addEventListener("click", () => { void widgetSync.opportunity(); });
    $("#settings-dialog").addEventListener("close", () => {
      $("#widget-form").elements.token.value = "";
    });
    document
      .querySelectorAll("[data-close]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          button.closest("dialog").close(),
        ),
      );
    $("#export-data").addEventListener("click", async () => {
      try {
        const data = await repo.export();
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `calorie-backup-${localDate()}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        notify("Backup exported");
      } catch (e) {
        notify(errorMessage(e));
      }
    });
    $("#import-data").addEventListener("change", async (event) => {
      try {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 25 * 1024 * 1024)
          throw new Error("Choose a backup smaller than 25 MB.");
        const result = await repo.import(JSON.parse(await file.text()));
        changed();
        await refresh();
        notify(
          `Imported ${result.added} entries. ${result.skipped} existing records kept.`,
        );
        $("#settings-dialog").close();
      } catch (e) {
        showError($("#settings-error"), e);
      } finally {
        event.target.value = "";
      }
    });
    $("#clear-data").addEventListener("click", () =>
      $("#confirm-dialog").showModal(),
    );
    $("#cancel-clear").addEventListener("click", () =>
      $("#confirm-dialog").close(),
    );
    $("#confirm-clear").addEventListener("click", async () => {
      try {
        await writeQueue;
        await repo.clear();
        drafts.food = null;
        drafts.workout = null;
        resetForm();
        document.querySelectorAll("dialog[open]").forEach((d) => d.close());
        changed();
        await refresh();
        notify("All local data cleared");
      } catch (e) {
        notify(errorMessage(e));
      }
    });
    $("#more-history").addEventListener("click", () => {
      historyLimit += 30;
      refresh().catch((e) => notify(errorMessage(e)));
    });
    window.addEventListener("hashchange", route);
    const checkDay = () => {
      if (!document.hidden) {
        if (localDate() !== today) {
          today = localDate();
          if (!form.elements.name.value)
            form.elements.local_time.value = localTime();
        }
        refresh().catch((e) => notify(errorMessage(e)));
        void widgetSync.opportunity();
      }
    };
    document.addEventListener("visibilitychange", checkDay);
    window.addEventListener("pageshow", checkDay);
    window.addEventListener("focus", checkDay);
    setInterval(() => {
      if (localDate() !== today) checkDay();
    }, 10000);
    channel &&
      (channel.onmessage = () =>
        refresh().catch((e) => notify(errorMessage(e))));
    const connection = () => {
      $("#connection").textContent = navigator.onLine
        ? "On this device"
        : "Offline · on this device";
    };
    connection();
    window.addEventListener("online", () => { connection(); void widgetSync.opportunity(); });
    window.addEventListener("offline", () => { connection(); void widgetSync.status().catch(() => {}); });
    registerPWA(async () => {
      queueDraft();
      await writeQueue;
      // Let a failed final draft write postpone the update rather than reload.
      await repo.draft(kind, { ...fields(form), saved_on: today });
    });
    navigator.storage?.persist?.().catch(() => {});
  } catch (e) {
    $("#loading").textContent =
      `Calorie couldn't open local storage. ${errorMessage(e)} Try a regular browser window with storage enabled. No data has been cleared.`;
  }
}
boot();
