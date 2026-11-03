// ===================== perf.js — indicadores de rendimiento =====================
// Tiempos por subsistema (sin asignaciones por cuadro: acumuladores en Float64Array por índice fijo),
// historial de cuadros en buffers circulares, llamadas de dibujo y tiempo de GPU (si el navegador lo permite),
// memoria y recolecciones de basura estimadas, tareas largas, benchmark y reporte para copiar.
const Perf = (() => {
  const SEC = ["fisica", "gente", "transito", "flowfields", "casas", "piso", "debug", "sprites", "render"];
  const LABEL = { fisica: "física (Box2D)", gente: "simulación de gente", transito: "IA de autos", flowfields: "cálculo de flowfields", casas: "horneado de casas",
    piso: "horneado de piso", debug: "dibujo de depuración", sprites: "sprites y cámara", render: "render Three (CPU)" };
  const NS = SEC.length, IDX = {}; SEC.forEach((s, i) => IDX[s] = i);
  const cur = new Float64Array(NS), ema = new Float64Array(NS), peak = new Float64Array(NS), t0s = new Float64Array(NS);
  const HN = 300, hFrame = new Float32Array(HN), hJs = new Float32Array(HN), hGpu = new Float32Array(HN); let hi = 0, hCount = 0;
  const C = {};                      // contadores (los setea main)
  let gl = null, draws = 0, drawsLast = 0, tris = 0, trisLast = 0, gpuExt = null, gpuMs = -1, gpuSupported = "no", renderer = "?";
  const qPool = [], qPending = []; let qActive = null;
  let heapLast = 0, gcCount = 0, gcT0 = performance.now(), heapMax = 0, longN = 0, longLast = 0, longTotal = 0;
  let bench = null, lastUi = 0, open = false;
  const t = (id) => { t0s[id] = performance.now(); };
  const e = (id) => { cur[id] += performance.now() - t0s[id]; };
  const ID = IDX;

  function init(app) {
    gl = app.renderer.gl || null;
    if (gl) {
      for (const fn of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
        const orig = gl[fn]; if (!orig) continue;
        gl[fn] = function (mode, a, b, c, d) { draws++; tris += (fn.startsWith("drawElements") ? b : a) || 0; return orig.call(gl, mode, a, b, c, d); };
      }
      try { const dbg = gl.getExtension("WEBGL_debug_renderer_info"); renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (x) {}
      try { gpuExt = gl.getExtension("EXT_disjoint_timer_query_webgl2"); gpuSupported = gpuExt ? "sí" : "no (el navegador no lo expone)"; } catch (x) {}
    }
    const r = app.renderer, orig = r.render.bind(r);
    r.render = function (...args) {
      const tt = performance.now();
      if (gpuExt && !qActive) { qActive = qPool.pop() || gl.createQuery(); gl.beginQuery(gpuExt.TIME_ELAPSED_EXT, qActive); }
      const res = orig(...args);
      if (qActive) { gl.endQuery(gpuExt.TIME_ELAPSED_EXT); qPending.push(qActive); qActive = null; }
      cur[IDX.render] += performance.now() - tt;
      return res;
    };
    try { new PerformanceObserver((l) => { for (const en of l.getEntries()) { longN++; longLast = en.duration; longTotal += en.duration; } }).observe({ type: "longtask", buffered: false }); C.longtaskApi = 1; } catch (x) { C.longtaskApi = 0; }
  }
  function pollGpu() {
    while (qPending.length) {
      const q = qPending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(gpuExt.GPU_DISJOINT_EXT), ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (!disjoint) gpuMs = ns / 1e6;
      qPool.push(qPending.shift());
    }
  }
  // al final de cada cuadro
  function frame(dtMs) {
    if (gpuExt) pollGpu();
    let js = 0;
    for (let i = 0; i < NS; i++) { ema[i] = ema[i] * .92 + cur[i] * .08; if (cur[i] > peak[i]) peak[i] = cur[i]; if (i !== IDX.render) js += cur[i]; cur[i] = 0; }
    hFrame[hi] = dtMs; hJs[hi] = js + ema[IDX.render]; hGpu[hi] = gpuMs; hi = (hi + 1) % HN; if (hCount < HN) hCount++;
    drawsLast = draws; draws = 0; trisLast = tris; tris = 0;
    const m = performance.memory; if (m) { const h = m.usedJSHeapSize; if (heapLast && h < heapLast - 512 * 1024) gcCount++; heapLast = h; if (h > heapMax) heapMax = h; }
    if (bench) benchFrame(dtMs);
  }
  // percentiles sin ordenar arrays nuevos: copia a un buffer fijo
  const sortBuf = new Float32Array(HN * 40);
  function pct(src, n, ps) { sortBuf.set(src.subarray(0, n)); const v = sortBuf.subarray(0, n); v.sort(); return ps.map(p => v[Math.min(n - 1, Math.floor(p * n))]); }

  // ---------- UI
  function ui(force) {
    const now = performance.now(); if (!open || (!force && now - lastUi < 250)) return; lastUi = now;
    const n = hCount, [p50, p95, p99] = pct(hFrame, n, [.5, .95, .99]);
    let sum = 0, mx = 0; for (let i = 0; i < n; i++) { sum += hFrame[i]; if (hFrame[i] > mx) mx = hFrame[i]; }
    const avg = sum / Math.max(1, n), fps = 1000 / avg;
    const m = performance.memory, mins = (now - gcT0) / 60000;
    const row = (k, v, cls = "") => `<tr><td>${k}</td><td class="${cls}">${v}</td></tr>`;
    const ms = (v) => v.toFixed(2) + " ms";
    let h = `<table>`;
    h += `<tr><th colspan=2>Cuadros</th></tr>` + row("FPS", fps.toFixed(1), fps < 30 ? "bad" : fps < 55 ? "warn" : "ok") + row("cuadro prom / p50", ms(avg) + " / " + ms(p50)) +
      row("p95 / p99 / máx", ms(p95) + " / " + ms(p99) + " / " + ms(mx), p95 > 33 ? "bad" : p95 > 20 ? "warn" : "ok") +
      row("tareas largas (>50 ms)", C.longtaskApi ? `${longN} (última ${longLast.toFixed(0)} ms)` : "no disponible");
    h += `<tr><th colspan=2>JS por cuadro (promedio · pico)</th></tr>`;
    let jsTot = 0; for (let i = 0; i < NS; i++) if (i !== IDX.render) jsTot += ema[i];
    for (let i = 0; i < NS; i++) h += row(LABEL[SEC[i]], ms(ema[i]) + ` · ${peak[i].toFixed(1)}`, ema[i] > 6 ? "bad" : ema[i] > 2 ? "warn" : "");
    h += row("<b>total JS (sin render)</b>", "<b>" + ms(jsTot) + "</b>");
    h += `<tr><th colspan=2>GPU</th></tr>` + row("tiempo de GPU", gpuExt ? (gpuMs >= 0 ? ms(gpuMs) : "midiendo…") : gpuSupported) +
      row("llamadas de dibujo / cuadro", drawsLast) + row("vértices / índices enviados", trisLast.toLocaleString("es-AR")) +
      row("texturas horneadas", `${C.texCount || 0} (~${((C.texBytes || 0) / 1048576).toFixed(1)} MB)`) + row("placa", `<small>${renderer}</small>`);
    h += `<tr><th colspan=2>Escena</th></tr>` + row("objetos en escena / visibles", `${C.objects || 0} / ${C.objectsVisible || 0}`) +
      row("casas horneadas / total", `${C.baked || 0} / ${C.housesTotal || 0} · ${(C.bakeAvg || 0).toFixed(0)} ms c/u`) + row("chunks de piso", C.chunks || 0) +
      row("pendientes de hornear", C.pending || 0);
    h += `<tr><th colspan=2>Gente</th></tr>` + row("personas", `${C.people || 0} (${C.peopleDrawn || 0} dibujadas)`) +
      row("tasa completa / reducida", `${C.peopleFull || 0} / ${C.peopleLow || 0}`) + row("caminando / en calzada / empujadas", `${C.peopleWalking || 0} / ${C.peopleRoad || 0} / ${C.peopleKnock || 0}`) +
      row("flowfields peatonales", `${C.pFields || 0}/${C.pTargets || 0}`);
    h += `<tr><th colspan=2>Tránsito y física</th></tr>` + row("autos con IA (activos / total)", `${C.carsActive || 0} / ${C.carsTotal || 0}`) +
      row("en movimiento / frenados / en reversa", `${C.carsMoving || 0} / ${C.carsBlocked || 0} / ${C.carsRev || 0}`) + row("rayos por cuadro", C.rays || 0) +
      row("cuerpos Box2D (despiertos)", `${C.bodies || 0} (${C.awake || 0})`) + row("contactos activos", C.contacts || 0) + row("flowfields de autos", `${C.cFields || 0}/${C.cTargets || 0}`);
    h += `<tr><th colspan=2>Memoria</th></tr>` + (m ? row("heap JS usado / pico", `${(m.usedJSHeapSize / 1048576).toFixed(1)} / ${(heapMax / 1048576).toFixed(1)} MB`) +
      row("recolecciones de basura estimadas", `${gcCount} (${(gcCount / Math.max(.1, mins)).toFixed(1)}/min)`, gcCount / Math.max(.1, mins) > 6 ? "warn" : "") : row("heap JS", "sólo en Chrome/Edge"));
    h += `<tr><th colspan=2>Dispositivo</th></tr>` + row("pantalla", `${innerWidth}×${innerHeight} @${devicePixelRatio}x → canvas ${C.canvasW || 0}×${C.canvasH || 0}`) +
      row("núcleos / memoria", `${navigator.hardwareConcurrency || "?"} / ${navigator.deviceMemory ? navigator.deviceMemory + " GB" : "?"}`) + row("táctil", matchMedia("(pointer: coarse)").matches ? "sí" : "no");
    h += `</table>`;
    if (C.build) h += `<div class="pmuted">${C.build}</div>`;
    if (bench) h += `<div class="pbench">Benchmark en curso… ${Math.ceil(bench.left / 1000)} s</div>`;
    if (lastBench) h += `<div class="pbench">${lastBench.html}</div>`;
    document.getElementById("perfBody").innerHTML = h;
    graph();
  }
  function graph() {
    const cv = document.getElementById("perfGraph"), g = cv.getContext("2d"), Wc = cv.width, Hc = cv.height, max = 50;
    g.fillStyle = "#14161c"; g.fillRect(0, 0, Wc, Hc);
    for (const [ms, col] of [[16.7, "#2e7d32"], [33.3, "#b71c1c"]]) { const y = Hc - ms / max * Hc; g.fillStyle = col; g.fillRect(0, y, Wc, 1); }
    const bw = Wc / HN;
    for (let k = 0; k < hCount; k++) {
      const i = (hi - hCount + k + HN) % HN, x = k * bw, fh = Math.min(Hc, hFrame[i] / max * Hc), jh = Math.min(Hc, hJs[i] / max * Hc);
      g.fillStyle = hFrame[i] > 33.3 ? "#e53935" : hFrame[i] > 17.5 ? "#fbc02d" : "#607d8b"; g.fillRect(x, Hc - fh, Math.max(1, bw), fh);
      g.fillStyle = "#4fc3f7"; g.fillRect(x, Hc - jh, Math.max(1, bw), jh);
      if (hGpu[i] > 0) { g.fillStyle = "#ce93d8"; g.fillRect(x, Hc - Math.min(Hc, hGpu[i] / max * Hc) - 1, Math.max(1, bw), 2); }
    }
    g.fillStyle = "#aaa"; g.font = "10px monospace"; g.fillText("50 ms", 2, 10); g.fillText("33", 2, Hc - 33.3 / max * Hc - 2); g.fillText("16.7", 2, Hc - 16.7 / max * Hc - 2);
  }

  // ---------- benchmark: recorrido fijo de cámara
  let lastBench = null;
  function startBench(seconds, step, done) {
    bench = { left: seconds * 1000, dur: seconds * 1000, step, done, ft: new Float32Array(seconds * 150), n: 0, js: new Float64Array(NS), gc0: gcCount, long0: longN, heap0: performance.memory ? performance.memory.usedJSHeapSize : 0 };
    resetPeaks();
  }
  function benchFrame(dtMs) {
    const b = bench; if (b.n < b.ft.length) b.ft[b.n++] = dtMs;
    for (let i = 0; i < NS; i++) b.js[i] += ema[i];
    b.left -= dtMs; b.step(1 - b.left / b.dur);
    if (b.left <= 0) {
      const n = b.n, v = b.ft.subarray(0, n); let s = 0, mx = 0, over33 = 0, over50 = 0; for (let i = 0; i < n; i++) { s += v[i]; mx = Math.max(mx, v[i]); if (v[i] > 33.3) over33++; if (v[i] > 50) over50++; }
      const sorted = Float32Array.from(v).sort(), P = (p) => sorted[Math.min(n - 1, Math.floor(p * n))];
      const res = { cuadros: n, fps: 1000 / (s / n), p50: P(.5), p95: P(.95), p99: P(.99), max: mx, over33, over50, gc: gcCount - b.gc0, tareasLargas: longN - b.long0,
        heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null, js: SEC.map((k, i) => [LABEL[k], b.js[i] / n]) };
      res.html = `<b>Resultado del benchmark (${(b.dur / 1000) | 0} s)</b><br>${res.fps.toFixed(1)} FPS · p50 ${res.p50.toFixed(1)} · p95 ${res.p95.toFixed(1)} · p99 ${res.p99.toFixed(1)} · máx ${res.max.toFixed(0)} ms<br>` +
        `cuadros >33 ms: ${over33} · >50 ms: ${over50} · GC: ${res.gc} · tareas largas: ${res.tareasLargas}`;
      lastBench = res; bench = null; b.done && b.done(res); ui(true);
    }
  }
  function resetPeaks() { peak.fill(0); gcCount = 0; gcT0 = performance.now(); longN = 0; heapMax = 0; }
  function report() {
    const n = hCount, [p50, p95, p99] = pct(hFrame, n, [.5, .95, .99]); let s = 0; for (let i = 0; i < n; i++) s += hFrame[i];
    const m = performance.memory, L = [];
    L.push("== Reporte de rendimiento — Barrio Conurbano ==", new Date().toISOString(), navigator.userAgent, `placa: ${renderer} · GPU timer: ${gpuSupported}`,
      `pantalla ${innerWidth}x${innerHeight} @${devicePixelRatio} · canvas ${C.canvasW}x${C.canvasH} · núcleos ${navigator.hardwareConcurrency} · mem ${navigator.deviceMemory || "?"} GB`,
      `FPS ${(1000 / (s / n)).toFixed(1)} · p50 ${p50.toFixed(1)} · p95 ${p95.toFixed(1)} · p99 ${p99.toFixed(1)} ms · draw calls ${drawsLast} · GPU ${gpuMs >= 0 ? gpuMs.toFixed(2) + " ms" : "n/d"}`);
    for (let i = 0; i < NS; i++) L.push(`  ${LABEL[SEC[i]]}: ${ema[i].toFixed(2)} ms (pico ${peak[i].toFixed(1)})`);
    for (const k in C) if (k !== "build") L.push(`  ${k}: ${C[k]}`);
    if (m) L.push(`heap ${(m.usedJSHeapSize / 1048576).toFixed(1)} MB · pico ${(heapMax / 1048576).toFixed(1)} · GC ${gcCount}`);
    if (lastBench) L.push(`benchmark: ${JSON.stringify({ ...lastBench, html: undefined })}`);
    if (C.build) L.push(C.build);
    return L.join("\n");
  }
  function toggle(v) { open = v ?? !open; document.getElementById("perf").style.display = open ? "block" : "none"; if (open) ui(true); return open; }
  return { init, t, e, ID, frame, ui, C, startBench, report, toggle, resetPeaks, get open() { return open; }, get bench() { return !!bench; } };
})();
