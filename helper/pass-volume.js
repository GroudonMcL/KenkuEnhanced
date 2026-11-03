// helper/pass-volume.js – a tiny script the pass-through adds to every page it
// serves, so the dashboard can turn that page's volume up and down (fades,
// the mixer, Duck). Without it, a website in a tile is a closed box: the
// dashboard can't reach its sound at all.
//
// The page's own volume settings are left alone; ours is one extra "master"
// on top:
//   • <audio>/<video>: what the page sets × master
//   • Web Audio: everything the page sends to the speakers goes through one
//     extra gain node per AudioContext
//
// The dashboard talks to it with postMessage:
//   dashboard → page   { kenku: "volume", value: 0…1 }   set the master
//   dashboard → page   { kenku: "volume-hello" }         are you there?
//   page → dashboard   { kenku: "volume-ready" }         yes, I can be faded
// Pages inside the page (iframes from the same pass-through) get the same
// script, and the page passes the master on to them.
//
// `pageScript` runs IN THE BROWSER (it's turned into text below), so it must not
// use anything from Node.

function pageScript() {
  if (window.__kenkuVolume) return;
  window.__kenkuVolume = true;
  var master = 1;
  var clamp = function (v) { return Math.max(0, Math.min(1, Number(v) || 0)); };

  // ---- <audio> and <video> ----
  var proto = HTMLMediaElement.prototype;
  var vol = Object.getOwnPropertyDescriptor(proto, "volume");
  var wanted = new WeakMap(); // element → the volume the page asked for
  var media = new Set();
  function apply(el) {
    try { vol.set.call(el, clamp((wanted.has(el) ? wanted.get(el) : 1) * master)); } catch (e) { /* ignore */ }
  }
  function track(el) {
    if (!(el instanceof HTMLMediaElement)) return;
    if (!wanted.has(el)) wanted.set(el, vol.get.call(el));
    media.add(el);
    apply(el);
  }
  Object.defineProperty(proto, "volume", {
    configurable: true,
    enumerable: true,
    get: function () { return wanted.has(this) ? wanted.get(this) : vol.get.call(this); },
    set: function (v) {
      vol.set.call(this, v); // throws for bad values, just like the real thing
      wanted.set(this, Number(v));
      media.add(this);
      apply(this);
    },
  });
  var play = proto.play;
  proto.play = function () { track(this); return play.apply(this, arguments); };
  document.addEventListener("play", function (e) { track(e.target); }, true); // autoplay

  // ---- Web Audio ----
  var gains = [];
  var connect = AudioNode.prototype.connect;
  var disconnect = AudioNode.prototype.disconnect;
  var Offline = window.OfflineAudioContext || function () {};
  function gainFor(dest) {
    var ctx = dest.context;
    if (ctx instanceof Offline) return dest; // rendering to a file, not the speakers
    if (!ctx.__kenkuGain) {
      var g = ctx.createGain();
      g.gain.value = master;
      connect.call(g, dest);
      ctx.__kenkuGain = g;
      gains.push(g);
    }
    return ctx.__kenkuGain;
  }
  var isSpeakers = function (n) { return typeof AudioDestinationNode !== "undefined" && n instanceof AudioDestinationNode; };
  AudioNode.prototype.connect = function (dest) {
    if (isSpeakers(dest)) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = gainFor(dest);
      connect.apply(this, args);
      return dest;
    }
    return connect.apply(this, arguments);
  };
  AudioNode.prototype.disconnect = function (dest) {
    if (isSpeakers(dest) && dest.context.__kenkuGain) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = dest.context.__kenkuGain;
      return disconnect.apply(this, args);
    }
    return disconnect.apply(this, arguments);
  };

  // ---- The master ----
  function setMaster(v) {
    master = clamp(v);
    media.forEach(apply);
    gains.forEach(function (g) {
      try { g.gain.setTargetAtTime(master, g.context.currentTime, 0.03); } catch (e) { g.gain.value = master; }
    });
    for (var i = 0; i < window.frames.length; i++) {
      try { window.frames[i].postMessage({ kenku: "volume", value: master }, "*"); } catch (e) { /* ignore */ }
    }
  }
  var hello = function () { if (window.parent !== window) window.parent.postMessage({ kenku: "volume-ready" }, "*"); };
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || typeof e.data !== "object") return;
    if (e.data.kenku === "volume") setMaster(e.data.value);
    else if (e.data.kenku === "volume-hello") hello();
  });
  hello();
}

const SCRIPT = `<script>/* KenkuEnhanced volume control */(${pageScript.toString()})();</script>`;

// Put the script at the very start of the page's <head>, before the page's own scripts.
function inject(html) {
  if (html.includes("KenkuEnhanced volume control")) return html;
  const head = html.match(/<head(\s[^>]*)?>/i);
  if (head) return html.replace(head[0], head[0] + SCRIPT);
  const tag = html.match(/<html(\s[^>]*)?>/i);
  if (tag) return html.replace(tag[0], tag[0] + SCRIPT);
  return SCRIPT + html;
}

module.exports = { inject, pageScript };
