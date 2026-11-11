export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {}
  const previous = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
  document.body.append(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
  } finally {
    area.remove();
    previous?.focus({ preventScroll: true });
  }
  if (!copied)
    throw new Error(
      `Clipboard unavailable. Copy this question manually: ${text}`,
    );
}
