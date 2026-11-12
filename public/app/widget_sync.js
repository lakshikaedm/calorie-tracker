import { localDate, summarize } from "./domain.js";

export function summaryEndpoint(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a valid HTTPS API endpoint."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Use an HTTPS endpoint without credentials, query parameters or a fragment.");
  if (url.pathname === "/") url.pathname = "/api/summary";
  if (url.pathname !== "/api/summary")
    throw new Error("Enter the Worker base URL or its /api/summary endpoint.");
  return url.href;
}
export function widgetConfiguration(state, raw) {
  const endpoint = raw.endpoint.trim() ? summaryEndpoint(raw.endpoint) : "";
  const token = raw.token.trim() || state.token;
  if (/[\r\n]/.test(token)) throw new Error("Enter a valid private write token.");
  if (raw.enabled && (!endpoint || !token))
    throw new Error("Enter an API endpoint and private write token before enabling sync.");
  return { ...state, enabled: raw.enabled, endpoint, token, pending: raw.enabled,
    revision: crypto.randomUUID(), status: raw.enabled ? "Pending" : "Disabled", error: "" };
}
export async function dailySummary(repo, date = localDate()) {
  const day = await repo.day(date);
  const goal = await repo.goal(date);
  const totals = summarize(day.foods, day.workouts, goal, date);
  return { date, target: goal.daily_calorie_goal, consumed: totals.food,
    workout: totals.burned, remaining: totals.remaining, protein: totals.protein };
}

// No record payloads or credentials enter caches, URLs, logs or exports.
// All writes use a shared origin lock, including across tabs. Without Web Locks,
// logging still works; syncing waits for a browser supporting safe serialization.
export class WidgetSync {
  constructor(repo, { fetcher = globalThis.fetch?.bind(globalThis),
    online = () => navigator.onLine, date = localDate, now = Date.now,
    locks = globalThis.navigator?.locks, onStatus = () => {},
    delay = 2500, setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimer = id => globalThis.clearTimeout(id) } = {}) {
    Object.assign(this, { repo, fetcher, online, date, now, locks, onStatus, delay, setTimer, clearTimer });
    this.timer = null;
    this.running = false;
    this.again = false;
  }
  async status() {
    const state = await this.repo.widgetSync();
    this.onStatus({ ...state, status: !state.enabled ? "Disabled" :
      !this.online() ? "Offline" : state.status });
  }
  schedule() {
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { this.timer = null; void this.flush(); }, this.delay);
    void this.status().catch(() => {});
  }
  // Explicit opportunities, rather than an endless network retry loop.
  async opportunity() {
    try {
      await this.repo.requestWidgetSync();
      this.schedule();
    } catch { this.onStatus({ status: "Error", error: "Unable to read local sync settings." }); }
  }
  async flush() {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      if (!this.locks) {
        const state = await this.repo.widgetSync();
        if (state.enabled) this.onStatus({ ...state, status: "Error", error: "Widget Sync requires a browser with Web Locks support." });
        return;
      }
      await this.locks.request("calorie-widget-sync", async () => {
        const state = await this.repo.widgetSync();
        if (!state.enabled || !state.pending || !this.online()) return;
        // Persisted completion time also limits retries initiated by another tab.
        const wait = state.last_attempt + 1500 - this.now();
        if (wait > 0) {
          this.clearTimer(this.timer);
          this.timer = this.setTimer(() => { this.timer = null; void this.flush(); }, wait);
          return;
        }
        const endpoint = summaryEndpoint(state.endpoint);
        if (!state.token) throw new Error("Save a private write token in Widget Sync settings.");
        const payload = await dailySummary(this.repo, this.date());
        const controller = new AbortController();
        const timeout = this.setTimer(() => controller.abort(), 15000);
        let message = "", success = false;
        try {
          const response = await this.fetcher(endpoint, {
            method: "POST", mode: "cors", credentials: "omit", cache: "no-store",
            redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
            body: JSON.stringify(payload),
          });
          if (response.status === 401 || response.status === 403)
            message = "Authorization failed. Replace the private write token and test again.";
          else if (!response.ok) message = `API request failed (HTTP ${response.status}). Retry on reconnect, app activation or the next change.`;
          else success = true;
        } catch {
          // Never display arbitrary server/error text: it could echo credentials.
          message = "Connection failed or timed out. Check network, endpoint and Worker CORS settings.";
        } finally { this.clearTimer(timeout); }
        const result = await this.repo.widgetSync(current => {
          const same = current.revision === state.revision && this.date() === payload.date;
          return { ...current, last_attempt: this.now(),
            ...(success ? { last_success: new Date(this.now()).toISOString() } : {}),
            pending: current.enabled && (!success || !same),
            status: !current.enabled ? "Disabled" : !same ? "Pending" : success ? "Synced" : "Error",
            error: same ? message : "" };
        });
        if (success && result.pending) this.again = true;
      });
      await this.status();
    } catch {
      this.onStatus({ status: "Error", error: "Unable to synchronize. Check local sync settings and try again." });
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.schedule(); }
    }
  }
}
