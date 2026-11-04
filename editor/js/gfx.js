// ===================== gfx.js — render con Three.js =====================
// Orden de dibujo (un solo canvas WebGL, sin limpiar entre pasadas):
//   0) casas -> textura aparte (color + id de caja en alfa + profundidad)
//   1) piso por chunks (sin profundidad)   2) sombras de casas (stencil: cada píxel se oscurece una vez)
//   3) sombras de sprites (calcos en el piso)   4) composición de casas: contornos + oclusión de rincones, escribe profundidad
//   5) sprites como billboards verticales (una sola llamada instanciada, ordenados de atrás hacia adelante)   6) cables
// Además, dos canvas 2D encima para la depuración (misma API básica que PIXI.Graphics).
const Gfx = (() => {
  const SF = R3.SF, CZ = R3.CZ, SYN = R3.SYN, RANGE = 2500;
  let R, gl, cvs, rtH, bw = 1, bh = 1, pr = 1, cssW = 1, cssH = 1, atlasTex, AW = 1, AH = 1;
  const cam = new THREE.Camera(); cam.matrixAutoUpdate = false; cam.matrixWorldAutoUpdate = false;
  const SC = {}; for (const k of ["houses", "ground", "hshadow", "decal", "comp", "spr", "cable"]) { SC[k] = new THREE.Scene(); SC[k].matrixWorldAutoUpdate = true; }
  const view = { wx: 0, wy: 0, z: 1, dC: 0 }, UQ = new Float64Array(2);
  const CLEAR = new THREE.Color(0x28301f);

  // ---------- frames del atlas (índices fijos, tablas tipadas)
  const FN = new Map(); let FU0, FV0, FU1, FV1, FW, FH, FOX, FOY;
  function initFrames(frames) {
    const names = Object.keys(frames), n = names.length;
    FU0 = new Float32Array(n); FV0 = new Float32Array(n); FU1 = new Float32Array(n); FV1 = new Float32Array(n);
    FW = new Float32Array(n); FH = new Float32Array(n); FOX = new Float32Array(n); FOY = new Float32Array(n);
    names.forEach((nm, i) => { const f = frames[nm]; FN.set(nm, i); FU0[i] = f.x / AW; FV0[i] = f.y / AH; FU1[i] = (f.x + f.w) / AW; FV1[i] = (f.y + f.h) / AH; FW[i] = f.w; FH[i] = f.h; FOX[i] = f.ox; FOY[i] = f.oy; });
  }
  const fid = (name) => { const i = FN.get(name); return i === undefined ? -1 : i; };

  // ---------- init
  function init(parent, atlasImg, frames) {
    THREE.ColorManagement.enabled = false;
    R = new THREE.WebGLRenderer({ antialias: false, stencil: true, alpha: false, powerPreference: "high-performance" });
    R.outputColorSpace = THREE.LinearSRGBColorSpace; R.autoClear = false; R.sortObjects = false; R.info.autoReset = false;
    cvs = R.domElement; parent.appendChild(cvs); gl = R.getContext();
    AW = atlasImg.width; AH = atlasImg.height; initFrames(frames);
    atlasTex = new THREE.Texture(atlasImg); atlasTex.flipY = false; atlasTex.magFilter = THREE.NearestFilter; atlasTex.minFilter = THREE.NearestFilter; atlasTex.generateMipmaps = false;
    atlasTex.colorSpace = THREE.NoColorSpace; atlasTex.needsUpdate = true;
    const dt = new THREE.DepthTexture(4, 4); dt.type = THREE.UnsignedIntType;
    rtH = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false, depthTexture: dt });
    buildComposite(); buildSprites(); buildDecals();
    resize();
    return { canvas: cvs, gl };
  }
  function resize() {
    pr = Math.min(devicePixelRatio || 1, 2); cssW = innerWidth; cssH = innerHeight;
    R.setPixelRatio(pr); R.setSize(cssW, cssH);
    bw = Math.round(cssW * pr); bh = Math.round(cssH * pr); rtH.setSize(bw, bh);
    compMat.uniforms.uRes.value.set(bw, bh); sprMat.uniforms.uRes.value.set(bw, bh);
    for (const o of OVL) { o.cv.width = bw; o.cv.height = bh; o.cv.style.width = cssW + "px"; o.cv.style.height = cssH + "px"; }
  }

  // ---------- cámara: matriz mundo -> clip con la proyección oblicua girada (ver cam.js)
  function setView(wx, wy, z) {
    const C = Cam.C, K = R3.K, T = Cam.T;
    view.wx = wx; view.wy = wy; view.z = z;
    const q = Cam.unPInto((cssW / 2 - wx) / z, (cssH / 2 - wy) / z, UQ); view.dC = Cam.depth(q[0], q[1], 0);
    const a = 2 * z / cssW, b = 2 * z / cssH;
    cam.projectionMatrix.set(
      a * C.ax, a * C.ay, 0, 2 * wx / cssW - 1,
      -b * C.bx, -b * C.by, b * CZ * SF, 1 - 2 * wy / cssH,
      (-K * C.c - C.s) / RANGE, (C.c - K * C.s) / RANGE, -T / RANGE, -view.dC / RANGE,
      0, 0, 0, 1);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    sprMat.uniforms.uRight.value.set(C.c, C.s);
    compMat.uniforms.uOff.value = Math.max(1, z * pr * .5); compMat.uniforms.uAOs.value = z * pr * .5;
  }

  // ---------- piso
  const CHM = 256 / SF;
  const quadGeo = (w, h) => { const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, w, 0, 0, w, h, 0, 0, h, 0]), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]); return g; };
  const chunkGeo = quadGeo(CHM, CHM);
  let aniso = 1;
  function canvasTex(cv, mips) { const t = new THREE.CanvasTexture(cv); t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.magFilter = THREE.NearestFilter;
    t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter; t.generateMipmaps = !!mips; t.anisotropy = mips ? aniso : 1; return t; }
  function addChunk(i, j, cv) {
    aniso = Math.min(8, R.capabilities.getMaxAnisotropy());
    const tex = canvasTex(cv, true), mat = new THREE.MeshBasicMaterial({ map: tex, depthTest: false, depthWrite: false });
    const m = new THREE.Mesh(chunkGeo, mat); m.position.set(i * CHM, j * CHM, 0); m.updateMatrix(); m.matrixAutoUpdate = false; SC.ground.add(m);
    return { m, tex, mat };
  }
  function removeChunk(h) { SC.ground.remove(h.m); h.tex.dispose(); h.mat.dispose(); }

  // ---------- casas
  const houseMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null } }, side: THREE.DoubleSide, blending: THREE.NoBlending,
    vertexShader: `attribute float fid; varying vec2 vUv; varying float vFid;
      void main() { vUv = uv; vFid = fid; vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
        gl_Position = projectionMatrix * modelViewMatrix * p; }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying float vFid;
      void main() { vec4 c = texture2D(map, vUv); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb, vFid / 255.0); }` });
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .4, depthTest: false, depthWrite: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.ReplaceStencilOp });
  const groups = { houses: new THREE.Group(), postes: new THREE.Group() }; SC.houses.add(groups.houses); SC.houses.add(groups.postes);
  function houseGeo(d) { const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(d.pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(d.uv, 2)); g.setAttribute("fid", new THREE.BufferAttribute(d.fid, 1));
    g.setIndex(new THREE.BufferAttribute(d.idx, 1)); g.computeBoundingSphere(); return g; }
  function addHouse(d, instances) {
    const tex = canvasTex(d.canvas, true), mat = houseMat.clone(); mat.uniforms.map.value = tex;
    const geo = houseGeo(d); let m;
    if (instances) { m = new THREE.InstancedMesh(geo, mat, instances.length); const mx = new THREE.Matrix4();
      instances.forEach(([x, y], k) => { mx.makeTranslation(x, y, 0); m.setMatrixAt(k, mx); }); m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); groups.postes.add(m); }
    else { m = new THREE.Mesh(geo, mat); groups.houses.add(m); }
    m.matrixAutoUpdate = false;
    let sm = null;
    if (d.shadow && d.shadow.idx.length) { const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(d.shadow.pos, 3)); sg.setIndex(new THREE.BufferAttribute(d.shadow.idx, 1)); sg.computeBoundingSphere();
      sm = new THREE.Mesh(sg, shadowMat); sm.matrixAutoUpdate = false; SC.hshadow.add(sm); }
    return { m, sm, tex, mat, geo, canvas: d.canvas, bytes: d.texBytes };
  }
  function removeHouse(h) { h.m.parent && h.m.parent.remove(h.m); h.geo.dispose(); h.mat.dispose(); h.tex.dispose(); if (h.m.isInstancedMesh) h.m.dispose();
    if (h.sm) { SC.hshadow.remove(h.sm); h.sm.geometry.dispose(); } }

  // ---------- composición de casas (contorno + oclusión de rincones como en R3, pero en GPU)
  let compMat;
  function buildComposite() {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    compMat = new THREE.ShaderMaterial({
      uniforms: { tCol: { value: rtH.texture }, tDep: { value: rtH.depthTexture }, uRes: { value: new THREE.Vector2(1, 1) }, uOff: { value: 1 }, uAOs: { value: .5 },
        uDS: { value: 2 * RANGE }, uOutline: { value: .82 }, uAO: { value: 1 } },
      depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, blending: THREE.NoBlending,
      vertexShader: `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tCol; uniform sampler2D tDep; uniform vec2 uRes; uniform float uOff, uAOs, uDS, uOutline, uAO;
        void main() {
          vec2 iv = 1.0 / uRes, px = gl_FragCoord.xy;
          vec4 c = texture2D(tCol, px * iv); if (c.a < 0.002) discard;
          float d = texture2D(tDep, px * iv).r;
          float edge = 0.0;
          vec2 N4[4]; N4[0] = vec2(1.0, 0.0); N4[1] = vec2(-1.0, 0.0); N4[2] = vec2(0.0, 1.0); N4[3] = vec2(0.0, -1.0);
          for (int k = 0; k < 4; k++) { vec2 q = (px + N4[k] * uOff) * iv; vec4 cn = texture2D(tCol, q);
            if (cn.a < 0.002) edge = 2.0;
            else if (abs(cn.a - c.a) > 0.002 && (texture2D(tDep, q).r - d) * uDS > 0.3) edge = max(edge, 1.0); }
          vec2 O9[9]; O9[0] = vec2(0.0, 3.0); O9[1] = vec2(-3.0, 0.0); O9[2] = vec2(3.0, 0.0); O9[3] = vec2(0.0, -3.0); O9[4] = vec2(-2.0, 2.0);
          O9[5] = vec2(2.0, 2.0); O9[6] = vec2(0.0, 7.0); O9[7] = vec2(-6.0, 2.0); O9[8] = vec2(6.0, 2.0);
          float occ = 0.0;
          for (int k = 0; k < 9; k++) { vec2 q = (px + O9[k] * uAOs) * iv; vec4 cn = texture2D(tCol, q);
            if (cn.a > 0.002) { float dn = (texture2D(tDep, q).r - d) * uDS; if (dn < -0.25 && dn > -3.0) occ += 1.0; } }
          vec3 col = c.rgb;
          if (occ > 0.0) { float f = 1.0 - min(0.32 * uAO, occ * 0.055 * uAO); col *= vec3(f, f, f * 1.02); }
          if (edge > 0.0) { float t = edge > 1.5 ? uOutline : uOutline * 0.6; col = mix(col, vec3(46.0, 32.0, 26.0) / 255.0, t); }
          gl_FragColor = vec4(col, 1.0); gl_FragDepth = d;
        }` });
    const m = new THREE.Mesh(g, compMat); m.frustumCulled = false; SC.comp.add(m);
  }

  // ---------- sprites: billboards verticales instanciados
  // persistentes (árboles, props, autos) con id fijo + transitorios (gente) que se cargan cada cuadro
  const CAP = 65536, TCAP = 8192, MAXI = 8192;
  const PX = new Float32Array(CAP), PY = new Float32Array(CAP), PF = new Int32Array(CAP).fill(-1), PFL = new Int8Array(CAP), POY = new Float32Array(CAP), PCAT = new Uint8Array(CAP), PON = new Uint8Array(CAP);
  const FREE = new Int32Array(CAP); let nFree = 0, nP = 0;
  const TX = new Float32Array(TCAP), TY = new Float32Array(TCAP), TF = new Int32Array(TCAP), TFL = new Int8Array(TCAP); let nT = 0;
  const CATS = ["trees", "props", "vehicles", "people"], CATI = Object.fromEntries(CATS.map((c, i) => [c, i])), catOn = new Uint8Array(8).fill(1);
  const iP = new Float32Array(MAXI * 3), iUV = new Float32Array(MAXI * 4), iS = new Float32Array(MAXI * 4);
  const KEY = new Float32Array(MAXI), IDS = new Int32Array(MAXI), BIN = new Uint16Array(MAXI), ORD = new Int32Array(MAXI), NB = 2048, CNT = new Int32Array(NB + 1);
  let sprMat, sprGeo, attP, attUV, attS, sprMesh;
  function quadInstGeo() { const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); return g; }
  function buildSprites() {
    sprGeo = quadInstGeo();
    attP = new THREE.InstancedBufferAttribute(iP, 3); attUV = new THREE.InstancedBufferAttribute(iUV, 4); attS = new THREE.InstancedBufferAttribute(iS, 4);
    for (const a of [attP, attUV, attS]) a.setUsage(THREE.DynamicDrawUsage);
    sprGeo.setAttribute("iP", attP); sprGeo.setAttribute("iUV", attUV); sprGeo.setAttribute("iS", attS); sprGeo.instanceCount = 0;
    sprMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlasTex }, uRight: { value: new THREE.Vector2(1, 0) }, uRes: { value: new THREE.Vector2(1, 1) } },
      defines: { SF: SF.toFixed(4), CZ: CZ.toFixed(7) }, transparent: true, depthTest: true, depthWrite: true, side: THREE.DoubleSide,
      vertexShader: `uniform vec2 uRight; uniform vec2 uRes; attribute vec3 iP; attribute vec4 iUV; attribute vec4 iS; varying vec2 vUv;
        void main() {
          float pr = (position.x * iS.x - iS.z) * iP.z, pu = iS.w - position.y * iS.y;
          vec4 cp = projectionMatrix * vec4(iP.xy + uRight * (pr / SF), pu / (SF * CZ), 1.0);
          vec4 ap = projectionMatrix * vec4(iP.xy, 0.0, 1.0);
          vec2 a = (ap.xy * 0.5 + 0.5) * uRes; cp.xy += (floor(a + 0.5) - a) * 2.0 / uRes;
          gl_Position = cp; vUv = vec2(mix(iUV.x, iUV.z, position.x), mix(iUV.y, iUV.w, position.y)); }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; void main() { vec4 c = texture2D(map, vUv); if (c.a < 0.02) discard; gl_FragColor = c; }` });
    sprMesh = new THREE.Mesh(sprGeo, sprMat); sprMesh.frustumCulled = false; SC.spr.add(sprMesh);
  }
  const BB = {
    add(name, x, y, cat, flip = false, oy = NaN) { const id = nFree ? FREE[--nFree] : nP++; if (id >= CAP) throw new Error("sin lugar para sprites");
      PF[id] = fid(name); PX[id] = x; PY[id] = y; PFL[id] = flip ? -1 : 1; POY[id] = oy; PCAT[id] = CATI[cat] ?? 1; PON[id] = 1; return id; },
    set(id, f, x, y, flip, oy) { PF[id] = f; PX[id] = x; PY[id] = y; PFL[id] = flip ? -1 : 1; POY[id] = oy; },
    setPos(id, x, y) { PX[id] = x; PY[id] = y; },
    setFlip(id, flip) { PFL[id] = flip ? -1 : 1; },
    show(id, v) { PON[id] = v ? 1 : 0; },
    remove(id) { PF[id] = -1; PON[id] = 0; FREE[nFree++] = id; },
    clear() { nP = 0; nFree = 0; PF.fill(-1); PON.fill(0); nT = 0; DC.clear(); },
    push(f, x, y, flip) { if (nT >= TCAP) return; TF[nT] = f; TX[nT] = x; TY[nT] = y; TFL[nT] = flip ? -1 : 1; nT++; },
    frame: fid, fw: (f) => FW[f], fh: (f) => FH[f], fox: (f) => FOX[f], foy: (f) => FOY[f],
    cat(c, v) { catOn[CATI[c]] = v ? 1 : 0; DC.cat(c, v); },
    get count() { return nP - nFree; }, drawn: 0,
    info(id) { return [PF[id], PX[id], PY[id], PFL[id], POY[id], PCAT[id], PON[id], catOn[PCAT[id]]]; },
  };
  // arma las instancias visibles, ordenadas por la y de pantalla del pie (counting sort, sin asignaciones)
  function updateSprites(vx0, vy0, vx1, vy1) {
    const C = Cam.C, ax = C.ax, ay = C.ay, bx = C.bx, by = C.by;
    let n = 0;
    for (let i = 0; i < nP && n < MAXI; i++) {
      const f = PF[i]; if (f < 0 || !PON[i] || !catOn[PCAT[i]]) continue;
      const x = PX[i], y = PY[i], sx = ax * x + ay * y, sy = bx * x + by * y, oy = POY[i] === POY[i] ? POY[i] : FOY[f], w = FW[f];
      if (sx + w < vx0 || sx - w > vx1 || sy - oy > vy1 || sy - oy + FH[f] < vy0) continue;
      KEY[n] = sy; IDS[n] = i; n++;
    }
    if (catOn[3]) for (let t = 0; t < nT && n < MAXI; t++) {
      const f = TF[t], x = TX[t], y = TY[t], sx = ax * x + ay * y, sy = bx * x + by * y;
      if (sx + FW[f] < vx0 || sx - FW[f] > vx1 || sy - FOY[f] > vy1 || sy - FOY[f] + FH[f] < vy0) continue;
      KEY[n] = sy; IDS[n] = -1 - t; n++;
    }
    const k0 = vy0 - 300, kr = NB / Math.max(1, vy1 + 600 - k0);
    CNT.fill(0);
    for (let k = 0; k < n; k++) { let b = ((KEY[k] - k0) * kr) | 0; b = b < 0 ? 0 : b >= NB ? NB - 1 : b; BIN[k] = b; CNT[b + 1]++; }
    for (let b = 0; b < NB; b++) CNT[b + 1] += CNT[b];
    for (let k = 0; k < n; k++) ORD[CNT[BIN[k]]++] = IDS[k];
    for (let k = 0; k < n; k++) {
      const id = ORD[k]; let f, x, y, fl, oy;
      if (id >= 0) { f = PF[id]; x = PX[id]; y = PY[id]; fl = PFL[id]; oy = POY[id] === POY[id] ? POY[id] : FOY[f]; }
      else { const t = -1 - id; f = TF[t]; x = TX[t]; y = TY[t]; fl = TFL[t]; oy = FOY[f]; }
      iP[k * 3] = x; iP[k * 3 + 1] = y; iP[k * 3 + 2] = fl;
      iUV[k * 4] = FU0[f]; iUV[k * 4 + 1] = FV0[f]; iUV[k * 4 + 2] = FU1[f]; iUV[k * 4 + 3] = FV1[f];
      iS[k * 4] = FW[f]; iS[k * 4 + 1] = FH[f]; iS[k * 4 + 2] = FOX[f]; iS[k * 4 + 3] = oy;
    }
    sprGeo.instanceCount = n; BB.drawn = n; nT = 0;
    upd(attP, n * 3); upd(attUV, n * 4); upd(attS, n * 4);
  }

  // ---------- sombras de sprites: calcos en el piso, rotados en el mundo
  const DCAP = 16384, DTCAP = 4096;
  const DX = new Float32Array(DCAP), DY = new Float32Array(DCAP), DA = new Float32Array(DCAP), DF = new Int32Array(DCAP).fill(-1), DON = new Uint8Array(DCAP), DCT = new Uint8Array(DCAP);
  const DFREE = new Int32Array(DCAP); let dnFree = 0, dnP = 0;
  const DTX = new Float32Array(DTCAP), DTY = new Float32Array(DTCAP), DTF = new Int32Array(DTCAP); let dnT = 0;
  const dP = new Float32Array(MAXI * 4), dUV = new Float32Array(MAXI * 4), dS = new Float32Array(MAXI * 4);
  let decGeo, decMat, dattP, dattUV, dattS; const dcatOn = new Uint8Array(8).fill(1);
  function buildDecals() {
    decGeo = quadInstGeo();
    dattP = new THREE.InstancedBufferAttribute(dP, 4); dattUV = new THREE.InstancedBufferAttribute(dUV, 4); dattS = new THREE.InstancedBufferAttribute(dS, 4);
    for (const a of [dattP, dattUV, dattS]) a.setUsage(THREE.DynamicDrawUsage);
    decGeo.setAttribute("iP", dattP); decGeo.setAttribute("iUV", dattUV); decGeo.setAttribute("iS", dattS); decGeo.instanceCount = 0;
    decMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlasTex }, uOp: { value: .4 } }, defines: { SF: SF.toFixed(4), SYN: SYN.toFixed(4) },
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute vec4 iP; attribute vec4 iUV; attribute vec4 iS; varying vec2 vUv;
        void main() { float u = (position.x * iS.x - iS.z) / SF, v = (iS.w - position.y * iS.y) / (SF * SYN);
          vec2 w = iP.xy + vec2(iP.z * u - iP.w * v, iP.w * u + iP.z * v);
          gl_Position = projectionMatrix * vec4(w, 0.02, 1.0); vUv = vec2(mix(iUV.x, iUV.z, position.x), mix(iUV.y, iUV.w, position.y)); }`,
      fragmentShader: `uniform sampler2D map; uniform float uOp; varying vec2 vUv; void main() { vec4 c = texture2D(map, vUv); gl_FragColor = vec4(c.rgb, c.a * uOp); }` });
    const m = new THREE.Mesh(decGeo, decMat); m.frustumCulled = false; SC.decal.add(m);
  }
  const DC = {
    add(name, x, y, ang, cat) { const id = dnFree ? DFREE[--dnFree] : dnP++; DF[id] = fid(name); DX[id] = x; DY[id] = y; DA[id] = ang || 0; DON[id] = 1; DCT[id] = CATI[cat] ?? 1; return id; },
    set(id, f, x, y, ang) { if (f >= 0) DF[id] = f; DX[id] = x; DY[id] = y; DA[id] = ang; },
    show(id, v) { DON[id] = v ? 1 : 0; },
    remove(id) { DF[id] = -1; DON[id] = 0; DFREE[dnFree++] = id; },
    clear() { dnP = 0; dnFree = 0; DF.fill(-1); DON.fill(0); dnT = 0; },
    push(f, x, y) { if (dnT >= DTCAP) return; DTF[dnT] = f; DTX[dnT] = x; DTY[dnT] = y; dnT++; },
    cat(c, v) { dcatOn[CATI[c]] = v ? 1 : 0; },
  };
  function upd(a, cnt) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(4, cnt)); a.needsUpdate = true; }
  let dn = 0;
  function dput(f, x, y, a) { const n = dn++; dP[n * 4] = x; dP[n * 4 + 1] = y; dP[n * 4 + 2] = Math.cos(a); dP[n * 4 + 3] = Math.sin(a);
      dUV[n * 4] = FU0[f]; dUV[n * 4 + 1] = FV0[f]; dUV[n * 4 + 2] = FU1[f]; dUV[n * 4 + 3] = FV1[f]; dS[n * 4] = FW[f]; dS[n * 4 + 1] = FH[f]; dS[n * 4 + 2] = FOX[f]; dS[n * 4 + 3] = FOY[f]; }
  function updateDecals(x0, y0, x1, y1) {
    dn = 0;
    for (let i = 0; i < dnP && dn < MAXI; i++) { const f = DF[i]; if (f < 0 || !DON[i] || !dcatOn[DCT[i]]) continue; const x = DX[i], y = DY[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue; dput(f, x, y, DA[i]); }
    if (dcatOn[3]) for (let t = 0; t < dnT && dn < MAXI; t++) { const x = DTX[t], y = DTY[t]; if (x < x0 || x > x1 || y < y0 || y > y1) continue; dput(DTF[t], x, y, 0); }
    const n = dn; decGeo.instanceCount = n; dnT = 0;
    upd(dattP, n * 4); upd(dattUV, n * 4); upd(dattS, n * 4);
  }

  // ---------- cables
  const cableMat = new THREE.LineBasicMaterial({ color: 0x17171b, transparent: true, opacity: .85, depthWrite: false });
  let cableObj = null;
  function setCables(arr) { if (cableObj) { SC.cable.remove(cableObj); cableObj.geometry.dispose(); cableObj = null; } if (!arr.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3)); g.computeBoundingSphere();
    cableObj = new THREE.LineSegments(g, cableMat); cableObj.matrixAutoUpdate = false; SC.cable.add(cableObj); }

  // ---------- depuración 2D (subconjunto de PIXI.Graphics sobre canvas 2D)
  const OVL = [];
  function overlay(parent) {
    const cv = document.createElement("canvas"); cv.className = "ovl"; parent.appendChild(cv); const g = cv.getContext("2d");
    const hex = (c) => "#" + (c >>> 0).toString(16).padStart(6, "0");
    const o = { cv, snap: null,
      begin(wx, wy, z) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.setTransform(z * pr, 0, 0, z * pr, wx * pr, wy * pr); g.beginPath();
        o.snap = { wx, wy, z, yaw: Cam.yaw }; cv.style.transform = ""; cv.style.display = "block"; },
      clear() { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.beginPath(); o.snap = null; cv.style.display = "none"; },
      // reubica lo ya dibujado si la cámara sólo se paneó o hizo zoom (sin redibujar)
      follow(wx, wy, z) { const s = o.snap; if (!s) return; if (s.yaw !== Cam.yaw) { cv.style.display = "none"; return; }
        const k = z / s.z; cv.style.transform = `matrix(${k},0,0,${k},${wx - s.wx * k},${wy - s.wy * k})`; cv.style.display = "block"; },
      moveTo(x, y) { g.moveTo(x, y); return o; }, lineTo(x, y) { g.lineTo(x, y); return o; }, closePath() { g.closePath(); return o; },
      quadraticCurveTo(a, b, c, d) { g.quadraticCurveTo(a, b, c, d); return o; },
      circle(x, y, r) { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); return o; },
      ellipse(x, y, a, b) { g.moveTo(x + a, y); g.ellipse(x, y, Math.abs(a), Math.abs(b), 0, 0, Math.PI * 2); return o; },
      rect(x, y, w, h) { g.rect(x, y, w, h); return o; },
      fill(s = {}) { g.globalAlpha = s.alpha ?? 1; g.fillStyle = hex(s.color ?? 0xffffff); g.fill(); g.beginPath(); return o; },
      stroke(s = {}) { g.globalAlpha = s.alpha ?? 1; g.lineWidth = s.width ?? 1; g.strokeStyle = hex(s.color ?? 0xffffff); g.stroke(); g.beginPath(); return o; } };
    OVL.push(o); if (R) resize(); return o;
  }

  // ---------- cuadro
  const VIS = { ground: true, hshadow: true, decal: true, houses: true, spr: true, cable: true };
  function render() {
    R.info.reset(); SC.houses.visible = VIS.houses;
    R.setRenderTarget(rtH); R.setClearColor(0x000000, 0); R.clear(true, true, false);
    if (VIS.houses && (groups.houses.visible || groups.postes.visible)) R.render(SC.houses, cam);
    R.setRenderTarget(null); R.setClearColor(CLEAR, 1); R.clear(true, true, true);
    if (VIS.ground) R.render(SC.ground, cam);
    if (VIS.hshadow) R.render(SC.hshadow, cam);
    if (VIS.decal) R.render(SC.decal, cam);
    if (VIS.houses) R.render(SC.comp, cam);
    if (VIS.spr) R.render(SC.spr, cam);
    if (VIS.cable) R.render(SC.cable, cam);
  }
  function setLight(c) { shadowMat.opacity = c.sombraPiso; decMat.uniforms.uOp.value = c.sombraPiso; compMat.uniforms.uOutline.value = c.contorno; compMat.uniforms.uAO.value = c.ao; }

  return { init, resize, setView, render, addChunk, removeChunk, addHouse, removeHouse, setCables, overlay, updateSprites, updateDecals, setLight,
    BB, DC, VIS, groups, CHM, view, get canvas() { return cvs; }, get gl() { return gl; }, get info() { return R.info; }, get pr() { return pr; },
    get size() { return [bw, bh]; }, _dbg() { const n = sprGeo.instanceCount; return { n, iP: Array.from(iP.slice(0, n * 3)), iS: Array.from(iS.slice(0, n * 4)), iUV: Array.from(iUV.slice(0, n * 4)) }; } };
})();
