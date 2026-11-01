// layout.js – resizable side-by-side panels with draggable handles.
//
// Each panel's width is a "share" (flex-grow). Dragging a handle moves width
// from one neighbour to the other. Shares and which panels are visible are
// saved in localStorage.

const Layout = (() => {
  const DEFAULT = {
    sizes: { kenku: 34, youtube: 24, embed: 20, sounds: 22 },
    visible: { scenes: true, kenku: true, youtube: true, embed: true, sounds: true },
  };
  const container = document.getElementById("panels");
  const panels = [...container.querySelectorAll(".panel")]; // fixed order: A, B, C, D
  let state = Store.get("layout", structuredClone(DEFAULT));

  function save() { Store.set("layout", state); }

  // Rebuild: hide/show panels, put a drag handle between each pair of visible panels.
  function render() {
    container.querySelectorAll(".splitter").forEach((s) => s.remove());
    const visible = panels.filter((p) => state.visible[p.dataset.panel] !== false);

    // The scenes bar isn't a resizable panel – it's just shown or hidden.
    document.getElementById("scenes-bar").hidden = state.visible.scenes === false;

    panels.forEach((p) => {
      p.hidden = !visible.includes(p);
      p.style.flexGrow = state.sizes[p.dataset.panel] || 30;
    });
    for (let i = 0; i < visible.length - 1; i++) {
      const s = document.createElement("div");
      s.className = "splitter";
      s.title = "Drag to resize";
      visible[i].after(s);
      attachDrag(s, visible[i], visible[i + 1]);
    }
    document.querySelectorAll("[data-toggle]").forEach((b) => {
      b.classList.toggle("on", state.visible[b.dataset.toggle] !== false);
    });
  }

  function attachDrag(handle, left, right) {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId); // keep getting moves even off the handle
      handle.classList.add("active");
      document.body.classList.add("dragging");

      const startX = e.clientX;
      const leftPx = left.getBoundingClientRect().width;
      const rightPx = right.getBoundingClientRect().width;
      const leftKey = left.dataset.panel;
      const rightKey = right.dataset.panel;
      const totalGrow = (state.sizes[leftKey] || 30) + (state.sizes[rightKey] || 30);
      const totalPx = leftPx + rightPx;
      const MIN = 220; // px – matches .panel min-width in CSS

      function onMove(ev) {
        const newLeftPx = Math.min(Math.max(leftPx + (ev.clientX - startX), MIN), totalPx - MIN);
        state.sizes[leftKey] = (newLeftPx / totalPx) * totalGrow;
        state.sizes[rightKey] = totalGrow - state.sizes[leftKey];
        left.style.flexGrow = state.sizes[leftKey];
        right.style.flexGrow = state.sizes[rightKey];
      }
      function onUp() {
        handle.classList.remove("active");
        document.body.classList.remove("dragging");
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        save();
      }
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  function init() {
    document.querySelectorAll("[data-toggle]").forEach((b) => {
      b.addEventListener("click", () => {
        const key = b.dataset.toggle;
        state.visible[key] = state.visible[key] === false;
        // never hide everything
        if (!panels.some((p) => state.visible[p.dataset.panel] !== false)) state.visible[key] = true;
        save();
        render();
      });
    });
    document.getElementById("reset-layout").addEventListener("click", () => {
      state = structuredClone(DEFAULT);
      save();
      render();
    });
    render();
  }

  // Make sure a panel is showing (e.g. before loading a website into it).
  function show(key) {
    if (state.visible[key] !== false) return;
    state.visible[key] = true;
    save();
    render();
  }

  return { init, show };
})();
