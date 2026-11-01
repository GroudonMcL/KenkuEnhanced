// storage.js – tiny wrapper around localStorage.
// localStorage keeps small bits of data in this browser between visits.
// Everything is stored as JSON under keys starting with "kenkuDash.".
// Wrapped in try/catch because storage can be disabled or full.

const Store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem("kenkuDash." + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("kenkuDash." + key, JSON.stringify(value));
    } catch {
      /* ignore – the dashboard still works, it just won't remember */
    }
  },
};
