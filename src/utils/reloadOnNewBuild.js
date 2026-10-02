/**
 * Reload the kiosk when a deploy has replaced the build it is running.
 *
 * The update button rebuilds dist/ and bounces the backend service, but nothing
 * reloads the kiosk — Electron keeps whatever bundle it loaded at boot, for as
 * long as the Pi stays up. So a fix would land on disk and never reach the
 * screen, while a bug only showed itself on some unrelated reload weeks later.
 *
 * Instead the page asks the backend for index.html now and then and compares
 * its entry script with the one it is running. Vite names that file after its
 * content hash, so a different name means a different build.
 */

const CHECK_EVERY_MS = 60_000;

// Not in the middle of someone using the screen: a reload eats the tap that was
// on its way to a control.
const QUIET_FOR_MS = 30_000;

function entryScript(doc) {
  const script = doc.querySelector('script[type="module"][src*="/assets/"]');
  return script ? new URL(script.getAttribute('src'), window.location.href).pathname : null;
}

export function reloadOnNewBuild() {
  const running = entryScript(document);
  // Dev server, or a page that is not the built app: nothing to compare with.
  if (!running) return;

  let lastInput = Date.now();
  const noteInput = () => { lastInput = Date.now(); };
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((event) =>
    window.addEventListener(event, noteInput, { passive: true, capture: true })
  );

  setInterval(async () => {
    let served;
    try {
      const response = await fetch('/', { cache: 'no-store' });
      if (!response.ok) return;
      served = entryScript(new DOMParser().parseFromString(await response.text(), 'text/html'));
    } catch {
      return; // Backend restarting — the deploy itself. Ask again next round.
    }
    if (!served || served === running) return;
    if (Date.now() - lastInput < QUIET_FOR_MS) return;

    console.log(`[Build] ${running} → ${served}: reloading onto the new build`);
    window.location.reload();
  }, CHECK_EVERY_MS);
}
