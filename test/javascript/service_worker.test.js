import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../../app/views/pwa/service-worker.js", import.meta.url),
  "utf8",
);
const scope = "https://calorie.example/project/";
function harness({ failedAsset = null } = {}) {
  const listeners = {};
  const stores = new Map();
  const fetched = [];
  let claimed = false,
    skipped = false;
  function cache() {
    const rows = new Map();
    const key = (req) =>
      typeof req === "string" ? new URL(req, scope).href : req.url || req.href;
    return {
      rows,
      put: async (req, response) => rows.set(key(req), response.clone()),
      match: async (req) => rows.get(key(req))?.clone(),
      addAll: async (requests) => {
        for (const req of requests) {
          const response = await fetcher(req);
          if (!response.ok) throw Error("Failed cache download");
          rows.set(key(req), response);
        }
      },
    };
  }
  async function fetcher(req) {
    const url = String(req.url || req);
    fetched.push(url);
    return new Response(
      url === failedAsset
        ? "missing"
        : url.endsWith("/")
          ? "<html>shell</html>"
          : "asset",
      { status: url === failedAsset ? 404 : 200 },
    );
  }
  const caches = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, cache());
      return stores.get(name);
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
  const self = {
    registration: { scope },
    clients: {
      claim: async () => {
        claimed = true;
      },
    },
    skipWaiting: () => {
      skipped = true;
    },
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  vm.runInNewContext(source, {
    self,
    caches,
    fetch: fetcher,
    URL,
    Request,
    Set,
  });
  const trigger = async (type, props = {}) => {
    let pending;
    listeners[type]({
      ...props,
      waitUntil: (p) => (pending = p),
      respondWith: (p) => (pending = p),
    });
    return await pending;
  };
  return {
    trigger,
    stores,
    caches,
    fetched,
    get claimed() {
      return claimed;
    },
    get skipped() {
      return skipped;
    },
  };
}
test("service worker installs every local shell asset including modules and icons", async () => {
  const h = harness();
  await h.trigger("install");
  const store = [...h.stores.values()][0];
  for (const path of [
    "",
    "index.html",
    "app/database.js",
    "app/domain.js",
    "app/widget_sync.js",
    "app/clipboard.js",
    "app/styles.css",
    "app/icon-512.png",
    "manifest.webmanifest",
  ])
    assert.ok(await store.match(new URL(path, scope)));
  assert.ok(h.fetched.every((url) => url.startsWith(scope)));
});
test("offline navigation serves cached shell without fetching records", async () => {
  const h = harness();
  await h.trigger("install");
  const before = h.fetched.length;
  const response = await h.trigger("fetch", {
    request: { method: "GET", url: scope + "#history", mode: "navigate" },
  });
  assert.equal(await response.text(), "<html>shell</html>");
  assert.equal(h.fetched.length, before);
});
test("only explicit shell resources are cached; external/private requests pass through", async () => {
  const h = harness();
  await h.trigger("install");
  assert.equal(
    await h.trigger("fetch", {
      request: { method: "GET", url: "https://chatgpt.com/", mode: "navigate" },
    }),
    undefined,
  );
  assert.equal(
    await h.trigger("fetch", {
      request: { method: "POST", url: scope + "app/domain.js" },
    }),
    undefined,
  );
  assert.equal(
    await h.trigger("fetch", {
      request: { method: "GET", url: scope + "private-backup.json" },
    }),
    undefined,
  );
  const count = h.fetched.length;
  await h.trigger("fetch", { request: new Request(scope + "app/domain.js") });
  assert.equal(h.fetched.length, count);
});
test("API and authenticated requests bypass both cache and navigation fallback", async () => {
  const h = harness();
  await h.trigger("install");
  const before = h.fetched.length;
  for (const req of [
    new Request("https://widget.example/api/summary", { method: "POST", headers: { Authorization: "Bearer test" } }),
    new Request(scope + "app/domain.js", { headers: { Authorization: "Bearer test" } }),
    { method: "GET", url: new URL("/api/summary", scope).href, mode: "navigate" },
  ]) assert.equal(await h.trigger("fetch", { request: req }), undefined);
  assert.equal(h.fetched.length, before);
});
test("activation removes only obsolete caches in its own deployment scope", async () => {
  const h = harness();
  await h.trigger("install");
  await h.caches.open("calorie-old-" + scope);
  await h.caches.open("unrelated-cache");
  await h.caches.open("calorie-old-https://calorie.example/another/");
  await h.trigger("activate");
  const keys = await h.caches.keys();
  assert.ok(!keys.includes("calorie-old-" + scope));
  assert.ok(keys.includes("unrelated-cache"));
  assert.ok(keys.includes("calorie-old-https://calorie.example/another/"));
  assert.ok(h.claimed);
});
test("failed installation rejects and leaves an old shell untouched", async () => {
  const h = harness({ failedAsset: scope + "app/database.js" });
  const previous = await h.caches.open("calorie-old-" + scope);
  await previous.put(scope, new Response("previous shell"));
  await assert.rejects(h.trigger("install"));
  assert.equal(await (await previous.match(scope)).text(), "previous shell");
  assert.equal(h.claimed, false);
});
test("updates wait for explicit activation message", async () => {
  const h = harness();
  await h.trigger("install");
  assert.equal(h.skipped, false);
  await h.trigger("message", { data: { type: "IGNORE" } });
  assert.equal(h.skipped, false);
  await h.trigger("message", { data: { type: "ACTIVATE_UPDATE" } });
  assert.equal(h.skipped, true);
});
