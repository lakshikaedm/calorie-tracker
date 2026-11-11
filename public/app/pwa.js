export async function registerPWA(beforeUpdate = async () => {}) {
  const status = document.querySelector("#offline-status");
  if (!("serviceWorker" in navigator)) {
    status.textContent = "Offline access is unavailable in this browser.";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(
      new URL("../service-worker.js", import.meta.url),
      {
        scope: new URL("../", import.meta.url).pathname,
        updateViaCache: "none",
      },
    );
    await navigator.serviceWorker.ready;
    status.textContent = "Ready for offline use on this device.";
    const updateButton = document.querySelector("#apply-update");
    const available = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        updateButton.hidden = false;
        status.textContent =
          "An update is ready. Your saved entries and drafts will be kept.";
      }
    };
    available();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", available);
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    updateButton.addEventListener("click", async () => {
      updateButton.disabled = true;
      try {
        await beforeUpdate();
        registration.waiting?.postMessage({ type: "ACTIVATE_UPDATE" });
      } catch {
        status.textContent =
          "Update postponed: your draft could not be saved. Free some device storage and try again.";
        updateButton.disabled = false;
      }
    });
  } catch {
    status.textContent =
      "Offline setup did not finish. Reopen with internet access to try again.";
  }
}
