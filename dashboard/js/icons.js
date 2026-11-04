// icons.js – small line icons (inline SVG), so buttons look the same on every PC
// instead of using colour emoji. Icons.svg("play") gives the markup;
// Icons.set(button, "play") swaps a button's icon (only when it actually changes,
// so polling every second doesn't rebuild anything).

const Icons = (() => {
  const F = 'fill="currentColor" stroke="none"';
  const P = {
    play: `<path ${F} d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>`,
    pause: `<rect ${F} x="6" y="4" width="4" height="16" rx="1.2"/><rect ${F} x="14" y="4" width="4" height="16" rx="1.2"/>`,
    stop: `<rect ${F} x="5.5" y="5.5" width="13" height="13" rx="2"/>`,
    prev: `<path ${F} d="M19 5.5v13a1 1 0 0 1-1.6.8L9 13a1.2 1.2 0 0 1 0-2l8.4-6.3a1 1 0 0 1 1.6.8z"/><path d="M5.5 5v14"/>`,
    next: `<path ${F} d="M5 5.5v13a1 1 0 0 0 1.6.8L15 13a1.2 1.2 0 0 0 0-2L6.6 4.7A1 1 0 0 0 5 5.5z"/><path d="M18.5 5v14"/>`,
    shuffle: `<path d="M3 17h2.5a4 4 0 0 0 3.3-1.7l5.4-7.6A4 4 0 0 1 17.5 6H21"/><path d="m18 3 3 3-3 3"/><path d="M3 7h2.5a4 4 0 0 1 3 1.4"/><path d="M21 18h-3.5a4 4 0 0 1-3-1.4"/><path d="m18 15 3 3-3 3"/>`,
    repeat: `<path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>`,
    repeat1: `<path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/><path d="M11 10.5 12.5 9.5v5"/>`,
    volume: `<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>`,
    mute: `<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>`,
    link: `<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`,
    search: `<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`,
    zoom: `<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>`,
    // tile-type marks in the title bar
    video: `<rect x="2.5" y="5" width="19" height="14" rx="3.5"/><path ${F} d="M10 9.2v5.6a.5.5 0 0 0 .76.43l4.5-2.8a.5.5 0 0 0 0-.86l-4.5-2.8a.5.5 0 0 0-.76.43z"/>`,
    globe: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>`,
    music: `<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>`,
    pads: `<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>`,
    bars: `<path d="M5 20v-8M10 20V5M15 20v-11M20 20v-6"/>`,
    sliders: `<path d="M6 4v16M12 4v16M18 4v16"/><rect ${F} x="3.5" y="13" width="5" height="3" rx="1"/><rect ${F} x="9.5" y="7" width="5" height="3" rx="1"/><rect ${F} x="15.5" y="15" width="5" height="3" rx="1"/>`,
    // volume ramps: fade in (getting louder) and fade out (getting quieter)
    fadein: `<path d="M3 19h18V5z"/>`,
    fadeout: `<path d="M3 5v14h18z"/>`,
    // Duck: a speaker with an arrow down
    duck: `<path d="M10 6 6 9H3v6h3l4 3z"/><path d="M17 5v10M13.5 12 17 15.5 20.5 12"/>`,
  };
  const svg = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;
  function set(el, name, text = "") {
    const key = name + "|" + text;
    if (el.dataset.icon === key) return;
    el.dataset.icon = key;
    el.innerHTML = svg(name) + (text ? `<span>${text}</span>` : "");
  }

  // Sliders: Chromium can't colour the part of a slider's track left of the thumb
  // by itself, so we hand it the percentage (--fill). Call after setting .value in code;
  // dragging is handled below.
  function paintRange(input) {
    const min = +input.min || 0, max = input.max === "" ? 100 : +input.max;
    const pct = max > min ? ((+input.value - min) / (max - min)) * 100 : 0;
    const v = pct.toFixed(1) + "%";
    if (input.style.getPropertyValue("--fill") !== v) input.style.setProperty("--fill", v);
  }
  document.addEventListener("input", (e) => { if (e.target.type === "range") paintRange(e.target); }, true);
  document.addEventListener("DOMContentLoaded", () => document.querySelectorAll("input[type=range]").forEach(paintRange));

  return { svg, set, has: (name) => name in P, paintRange };
})();
