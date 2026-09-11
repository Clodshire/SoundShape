// "Has this viewer ever picked a file?"
//
// Gates the first-run dropzone. Kept in localStorage rather than component
// state so it survives a reload — otherwise every refresh puts the onboarding
// panel back in front of someone who has already used the app.
//
// Exposed as an external store rather than mirrored into useState inside an
// effect: the value exists before React runs, and reading it through
// useSyncExternalStore keeps the server render ("never uploaded", so the
// dropzone is what gets prerendered) explicit instead of implied.

const KEY = "soundshape.hasUploaded";

const listeners = new Set<() => void>();

export function subscribeUploaded(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function hasUploaded(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Private browsing or site data blocked. Showing the dropzone is the safe
    // default — the worst case is onboarding a returning viewer twice.
    return false;
  }
}

/** The server cannot know, so it renders the first-run state. */
export function hasUploadedOnServer(): boolean {
  return false;
}

export function markUploaded() {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Not remembering across visits is survivable; it still applies this session.
  }
  listeners.forEach((l) => l());
}
