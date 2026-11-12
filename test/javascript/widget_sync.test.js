import test from "node:test";
import assert from "node:assert/strict";
import { WidgetSync, dailySummary, summaryEndpoint, widgetConfiguration } from "../../public/app/widget_sync.js";

function harness({ fetcher, online = true, date = "2026-11-12" } = {}) {
  let state = { enabled: true, token: "test-private-credential", endpoint: "https://widget.example/api/summary",
    pending: true, revision: "one", last_attempt: 0, status: "Pending" };
  let clock = 10000;
  const timers = new Map();
  const sent = [];
  const days = new Map([[date, { foods: [{ local_date: date, calories: 1179, protein_grams: 71.2, name: "Never upload this" }], workouts: [] }]]);
  const repo = {
    widgetSync: async update => { if (update) state = update(state); return { ...state }; },
    requestWidgetSync: async () => { if (state.enabled) state = { ...state, pending: true, revision: crypto.randomUUID(), status: "Pending" }; },
    day: async key => days.get(key) || { foods: [], workouts: [] },
    goal: async () => ({ daily_calorie_goal: 1800, optional_daily_protein_goal: null }),
  };
  let tail = Promise.resolve();
  const locks = { request: (_key, action) => { const job = tail.then(action); tail = job.catch(() => {}); return job; } };
  const options = { locks, online: () => online, date: () => date, now: () => clock,
    fetcher: async (...args) => { sent.push(args); return fetcher ? fetcher(...args) : { ok: true, status: 200 }; },
    setTimer: (fn, ms) => { const id = Symbol(); timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id) };
  const sync = new WidgetSync(repo, options);
  return { sync, repo, options, timers, sent, days, get state() { return state; },
    advance: ms => { clock += ms; }, setOnline: value => { online = value; }, setDate: value => { date = value; },
    fire: async () => { const jobs = [...timers.values()]; timers.clear(); for (const job of jobs) await job.fn(); } };
}

test("HTTPS endpoint and credential configuration validation; disabled by default repository contract", () => {
  assert.equal(summaryEndpoint("https://widget.example"), "https://widget.example/api/summary");
  for (const url of ["http://widget.example", "https://user:secret@widget.example", "https://widget.example?token=secret", "https://widget.example/#secret", "https://widget.example/wrong"])
    assert.throws(() => summaryEndpoint(url));
  assert.throws(() => widgetConfiguration({}, { enabled: true, endpoint: "", token: "" }));
  const state = widgetConfiguration({ token: "old" }, { enabled: true, endpoint: "https://widget.example", token: "" });
  assert.equal(state.token, "old");
  assert.equal(widgetConfiguration(state, { enabled: true, endpoint: state.endpoint, token: "replacement" }).token, "replacement");
});
test("POST sends exactly summary, authorization header and no caching or redirects", async () => {
  const h = harness();
  await h.sync.flush();
  const [url, req] = h.sent[0];
  assert.equal(url, "https://widget.example/api/summary");
  assert.deepEqual(JSON.parse(req.body), { date: "2026-11-12", target: 1800, consumed: 1179, workout: 0, remaining: 621, protein: 71.2 });
  assert.equal(req.headers.Authorization, "Bearer test-private-credential");
  assert.equal(req.headers["Content-Type"], "application/json");
  assert.equal(req.method, "POST");
  assert.equal(req.cache, "no-store");
  assert.equal(req.credentials, "omit");
  assert.equal(req.redirect, "error");
  assert.equal(h.state.pending, false);
  assert.equal(h.state.status, "Synced");
  assert.ok(h.state.last_success);
});
test("workouts, changed target, fractional protein and negative remaining reuse actual calculations", async () => {
  const h = harness();
  h.days.get("2026-11-12").workouts.push({ local_date: "2026-11-12", calories_burned: 100 });
  h.repo.goal = async () => ({ daily_calorie_goal: 1000 });
  const payload = await dailySummary(h.repo, "2026-11-12");
  assert.equal(payload.remaining, -79);
  assert.equal(payload.protein, 71.2);
});
test("offline pending survives; reconnect and app activation retry once", async () => {
  const h = harness({ online: false });
  await h.sync.opportunity(); await h.sync.flush();
  assert.equal(h.sent.length, 0);
  assert.equal(h.state.pending, true);
  h.setOnline(true);
  await h.sync.opportunity(); await h.sync.flush();
  assert.equal(h.sent.length, 1);
  h.advance(2500);
  await h.sync.opportunity(); await h.sync.flush();
  assert.equal(h.sent.length, 2);
});
for (const [label, fetcher] of [
  ["network/CORS", async () => { throw Error("might contain credentials"); }],
  ["unauthorized", async () => ({ ok: false, status: 401 })],
  ["forbidden", async () => ({ ok: false, status: 403 })],
  ["server error", async () => ({ ok: false, status: 500 })],
  ["rate limit", async () => ({ ok: false, status: 429 })],
]) test(`${label} preserves pending without automatic infinite retries or error-body disclosure`, async () => {
  const h = harness({ fetcher });
  await h.sync.flush();
  assert.equal(h.state.pending, true);
  assert.equal(h.state.status, "Error");
  assert.equal(h.timers.size, 0);
  assert.ok(!h.state.error.includes("credentials"));
  assert.equal(h.sent.length, 1);
});
test("rapid changes debounce into one latest summary", async () => {
  const h = harness();
  for (let i = 0; i < 10; i++) { await h.repo.requestWidgetSync(); h.sync.schedule(); }
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 2500);
  h.days.get("2026-11-12").foods[0].calories = 1200;
  await h.sync.flush();
  assert.equal(h.sent.length, 1);
  assert.equal(JSON.parse(h.sent[0][1].body).consumed, 1200);
});
test("pending survives controller recreation and cooldown prevents rapid writes", async () => {
  const h = harness();
  await h.sync.flush();
  await h.repo.requestWidgetSync();
  const restarted = new WidgetSync(h.repo, h.options);
  await restarted.flush();
  assert.equal(h.sent.length, 1);
  assert.equal([...h.timers.values()][0].ms, 1500);
  h.advance(1500); await restarted.flush();
  assert.equal(h.sent.length, 2);
});
test("requests across tabs are serialized; in-flight changes cannot clear newer pending state", async () => {
  let release;
  const h = harness({ fetcher: () => new Promise(resolve => { release = resolve; }) });
  const first = h.sync.flush();
  while (!release) await Promise.resolve();
  await h.repo.requestWidgetSync();
  h.days.get("2026-11-12").foods[0].calories = 1300;
  const other = new WidgetSync(h.repo, h.options);
  const second = other.flush();
  assert.equal(h.sent.length, 1);
  release({ ok: true, status: 200 });
  await Promise.all([first, second]);
  assert.equal(h.sent.length, 1);
  assert.equal(h.state.pending, true);
  h.advance(2500);
  // Replace the fetcher so the second request can complete immediately.
  h.sync.fetcher = async (...args) => { h.sent.push(args); return { ok: true, status: 200 }; };
  await h.sync.flush();
  assert.equal(JSON.parse(h.sent[1][1].body).consumed, 1300);
  assert.equal(h.state.pending, false);
});
test("new local day sends empty today rather than yesterday, including initial launch", async () => {
  const h = harness();
  h.setDate("2026-11-13");
  await h.sync.opportunity(); await h.sync.flush();
  assert.deepEqual(JSON.parse(h.sent[0][1].body), { date: "2026-11-13", target: 1800, consumed: 0, workout: 0, remaining: 1800, protein: 0 });
});
test("disabled sync never sends; missing Web Locks fails closed", async () => {
  const h = harness();
  await h.repo.widgetSync(state => ({ ...state, enabled: false }));
  await h.sync.opportunity(); await h.sync.flush();
  assert.equal(h.sent.length, 0);
  let status;
  await h.repo.widgetSync(state => ({ ...state, enabled: true }));
  const unsupported = new WidgetSync(h.repo, { ...h.options, locks: null, onStatus: value => { status = value.status; } });
  await unsupported.flush();
  assert.equal(h.sent.length, 0);
  assert.equal(status, "Error");
});
test("timeout aborts the request and retains a pending summary", async () => {
  const h = harness({ fetcher: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")));
  }) });
  const job = h.sync.flush();
  while (!h.sent.length) await Promise.resolve();
  const timeout = [...h.timers.values()].find(timer => timer.ms === 15000);
  assert.ok(timeout);
  timeout.fn();
  await job;
  assert.equal(h.state.pending, true);
  assert.equal(h.state.status, "Error");
  assert.equal(h.timers.size, 0);
});
test("midnight during an in-flight request preserves pending for new today", async () => {
  let release;
  const h = harness({ fetcher: () => new Promise(resolve => { release = resolve; }) });
  const job = h.sync.flush();
  while (!release) await Promise.resolve();
  h.setDate("2026-11-13");
  release({ ok: true, status: 200 });
  await job;
  assert.equal(h.state.pending, true);
  assert.equal(h.state.status, "Pending");
  assert.equal(h.timers.size, 1);
});
test("removing a credential during an in-flight request cannot restore it", async () => {
  let release;
  const h = harness({ fetcher: () => new Promise(resolve => { release = resolve; }) });
  const job = h.sync.flush();
  while (!release) await Promise.resolve();
  await h.repo.widgetSync(state => ({ ...state, token: "", enabled: false, pending: false, revision: "removed" }));
  release({ ok: true, status: 200 });
  await job;
  assert.equal(h.state.token, "");
  assert.equal(h.state.enabled, false);
  assert.equal(h.state.pending, false);
  assert.equal(h.state.status, "Disabled");
});
