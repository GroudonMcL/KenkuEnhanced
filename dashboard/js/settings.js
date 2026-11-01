// settings.js – the ⚙ Settings pane.
// Reads settings from the helper (GET /api/settings), lets you edit them, and
// saves them back (PUT /api/settings), which rewrites config.json for you.
// API keys are never sent back to the page in full – only "…last 4 characters".

const Settings = (() => {
  const $ = (id) => document.getElementById(id);
  const dialog = $("settings-dialog");
  let current = null;           // last settings we got from the helper
  const keysToRemove = new Set();

  function message(text, kind = "warn") {
    const box = $("settings-message");
    box.hidden = !text;
    box.className = `notice notice-${kind}`;
    box.textContent = text || "";
  }

  // Put the helper's settings into the form.
  function fill(s) {
    current = s;
    keysToRemove.clear();
    $("set-kenku-host").value = s.kenku.host;
    $("set-kenku-port").value = s.kenku.port;
    $("set-downloads").value = s.downloadsFolder;
    $("set-downloads-status").textContent = s.downloadsFolderExists
      ? "✓ This folder exists."
      : "This folder doesn't exist yet.";
    $("set-port").value = s.port;
    $("set-lan").checked = s.lanAccess;

    document.querySelectorAll(".key-row").forEach((row) => {
      const info = s.apiKeys[row.dataset.key] || { set: false };
      const input = row.querySelector("input");
      input.value = "";
      input.type = "password";
      input.placeholder = info.set ? `Saved (ends ${info.hint}) – type to replace` : "Not set – paste key here";
      row.querySelector(".key-remove").hidden = !info.set;
    });

    if (s.configError) {
      message(`Your config.json had a typing mistake (${s.configError}). Saving here will fix it; the old file is kept as config.broken.json.`, "error");
    } else if (s.restartNeeded) {
      message("Saved. Restart the helper for the port / network change to take effect.", "warn");
    }
  }

  async function open() {
    message(null);
    try {
      fill(await (await fetch("/api/settings")).json());
      dialog.showModal();
    } catch {
      alert("Couldn't load settings – is the helper running?");
    }
  }

  async function save(e) {
    e.preventDefault();
    const body = {
      kenku: { host: $("set-kenku-host").value.trim(), port: Number($("set-kenku-port").value) },
      downloadsFolder: $("set-downloads").value.trim(),
      createFolder: $("set-create-folder").checked,
      port: Number($("set-port").value),
      lanAccess: $("set-lan").checked,
      apiKeys: {},
    };
    document.querySelectorAll(".key-row").forEach((row) => {
      const name = row.dataset.key;
      const typed = row.querySelector("input").value.trim();
      if (typed) body.apiKeys[name] = typed;
      else if (keysToRemove.has(name)) body.apiKeys[name] = null;
    });

    $("settings-save").disabled = true;
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Save failed");
      fill(data);
      if (!data.restartNeeded) message("✓ Saved.", "ok");
      window.dispatchEvent(new Event("settings-saved")); // e.g. refresh Kenku status
    } catch (err) {
      message(err.message, "error");
    } finally {
      $("settings-save").disabled = false;
    }
  }

  function init() {
    $("open-settings").addEventListener("click", open);
    $("settings-cancel").addEventListener("click", () => dialog.close());
    $("settings-form").addEventListener("submit", save);

    document.querySelectorAll(".key-row").forEach((row) => {
      const input = row.querySelector("input");
      row.querySelector(".key-show").addEventListener("click", () => {
        input.type = input.type === "password" ? "text" : "password";
      });
      row.querySelector(".key-remove").addEventListener("click", () => {
        keysToRemove.add(row.dataset.key);
        input.value = "";
        input.placeholder = "Will be removed when you click Save";
      });
      const test = row.querySelector(".key-test");
      if (test) {
        test.addEventListener("click", async () => {
          if (input.value.trim()) {
            message("Click Save first, then Test (the test uses the saved key).", "warn");
            return;
          }
          message("Testing…");
          try {
            const r = await (await fetch(test.dataset.testUrl, { method: "POST" })).json();
            message(r.message, r.ok ? "ok" : "error");
          } catch {
            message("Couldn't reach the helper.", "error");
          }
        });
      }
    });
  }

  return { init, open };
})();
