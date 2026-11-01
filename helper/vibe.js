// helper/vibe.js
// Helper side of "Image → vibe" (the ✨ Vibe button).
//
// The picture is recognised IN THE BROWSER by a small AI model (CLIP, run with
// Transformers.js), so nothing is uploaded anywhere and it's free. This file:
//
//   GET /models/<model>/<file>  → the model files. Downloaded from Hugging Face the
//                                 first time (about 150 MB), then kept in data/models/,
//                                 so it works offline and survives clearing the browser.
//   GET /api/vibe/status        → { downloaded: true/false, bytes }
//   GET /api/vibe/image?url=... → fetches a picture from the web for the page
//                                 (browsers won't let a page read other sites' pictures).

const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const express = require("express");
const { DATA_DIR } = require("./datafile");

const MODELS_DIR = path.join(DATA_DIR, "models");
// Only these models may be downloaded through the helper.
const ALLOWED_MODELS = ["Xenova/clip-vit-base-patch32"];
// The files the dashboard needs (others are refused).
const FILE_PATTERN = /^(onnx\/(text|vision)_model_quantized\.onnx|[\w.-]+\.json|[\w.-]+\.txt)$/;
const NEEDED = ["onnx/text_model_quantized.onnx", "onnx/vision_model_quantized.onnx"];
const MAX_IMAGE = 15 * 1024 * 1024;

const inFlight = new Map(); // file → Promise, so two requests don't download the same file twice

// Download a model file to disk (via a .part file), while also streaming it to the
// browser if `res` is given, so the page can show download progress.
async function download(url, file, res) {
  const upstream = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!upstream.ok) {
    const err = new Error(`Hugging Face answered ${upstream.status}`);
    err.status = upstream.status === 404 ? 404 : 502;
    throw err;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".part";
  const out = fs.createWriteStream(tmp);
  if (res) {
    const len = upstream.headers.get("content-length");
    if (len) res.set("Content-Length", len);
    res.type(file.endsWith(".json") ? "application/json" : file.endsWith(".txt") ? "text/plain" : "application/octet-stream");
  }
  try {
    for await (const chunk of Readable.fromWeb(upstream.body)) {
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      if (res && !res.destroyed) res.write(chunk);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    fs.renameSync(tmp, file);
  } catch (err) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  if (res) res.end();
}

function folderBytes(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      total += e.isDirectory() ? folderBytes(p) : fs.statSync(p).size;
    }
  } catch { /* missing folder = 0 */ }
  return total;
}

module.exports = function vibeRouters() {
  // ---- /models/... ----------------------------------------------------------
  const models = express.Router();
  models.get(/^\/(.+)$/, async (req, res) => {
    const rel = decodeURIComponent(req.params[0]);
    const model = ALLOWED_MODELS.find((m) => rel.startsWith(m + "/"));
    const fileName = model && rel.slice(model.length + 1);
    if (!model || !FILE_PATTERN.test(fileName)) return res.status(404).json({ error: "Unknown model file" });

    const file = path.join(MODELS_DIR, model, fileName);
    if (fs.existsSync(file)) return res.sendFile(file);

    const url = `https://huggingface.co/${model}/resolve/main/${fileName}`;
    if (inFlight.has(file)) {
      // Someone else is downloading it: wait, then send the finished file.
      try { await inFlight.get(file); } catch { /* fall through to the error below */ }
      return fs.existsSync(file) ? res.sendFile(file) : res.status(502).json({ error: "Download failed" });
    }
    const job = download(url, file, res);
    inFlight.set(file, job);
    try {
      await job;
    } catch (err) {
      console.error(`!! Couldn't download ${model}/${fileName}: ${err.message}`);
      if (!res.headersSent) res.status(err.status || 502).json({ error: `Couldn't download the picture model (${err.cause?.code || err.message}). Are you online?` });
      else res.destroy();
    } finally {
      inFlight.delete(file);
    }
  });

  // ---- /api/vibe/... --------------------------------------------------------
  const api = express.Router();

  api.get("/status", (req, res) => {
    const dir = path.join(MODELS_DIR, ALLOWED_MODELS[0]);
    res.json({
      downloaded: NEEDED.every((f) => fs.existsSync(path.join(dir, f))),
      bytes: folderBytes(dir),
    });
  });

  api.get("/image", async (req, res) => {
    let url;
    try {
      url = new URL(String(req.query.url || ""));
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      return res.status(400).json({ error: "Please give a full http:// or https:// picture address." });
    }
    try {
      const r = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 KenkuEnhanced", Accept: "image/*" },
        signal: AbortSignal.timeout(15000),
      });
      const type = r.headers.get("content-type") || "";
      if (!r.ok) return res.status(502).json({ error: `The site answered ${r.status}.` });
      if (!type.startsWith("image/")) {
        r.body?.cancel();
        return res.status(415).json({ error: "That address isn't a picture. Right-click the picture → Copy image address." });
      }
      if (Number(r.headers.get("content-length")) > MAX_IMAGE) {
        r.body?.cancel();
        return res.status(413).json({ error: "That picture is over 15 MB." });
      }
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > MAX_IMAGE) return res.status(413).json({ error: "That picture is over 15 MB." });
      res.type(type).send(bytes);
    } catch (err) {
      res.status(502).json({ error: `Couldn't fetch the picture (${err.cause?.code || err.name}).` });
    }
  });

  return { models, api };
};
