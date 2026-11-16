// Selbst gezeichnete Karte (Canvas) im OSM-Stil: Grundkarte (Wasser, Wald, Grünflächen, Wohngebiete, Flüsse, Bahn), Straßen und
// Radwege aus den Kacheln des eigenen Servers, Ortsnamen und die Wärmekarte der Reichweite. Keine fremden Kartenserver.
// Projektion Web-Mercator; „Welt“ ist das Quadrat 0..1 (x West→Ost, y Nord→Süd).

const TILE = 256;
const MAX_PARALLEL = 6;
const LAND = '#f2efe9';
const FLAECHE = { 1: '#aad3df', 2: '#add19e', 3: '#cdebb0', 4: '#e6e0d4' };
const LINIE = { 5: ['#aad3df', 2.4], 6: ['#aad3df', 1.1], 7: ['#8c8c8c', 1.2] };

/** Pfad einer Kachel-Linie in die Pixel der Kachel übertragen (u: Transformation) */
function zeichnePfad(g, xy, u) {
  g.moveTo(xy[0] * u.s + u.ox, xy[1] * u.s + u.oy);
  for (let i = 2; i < xy.length; i += 2) g.lineTo(xy[i] * u.s + u.ox, xy[i + 1] * u.s + u.oy);
}

const weltX = (lon) => (lon + 180) / 360;
const weltY = (lat) => {
  const s = Math.sin(lat * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const lonVonWelt = (x) => x * 360 - 180;
const latVonWelt = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;

/** Kachel aus dem Binärformat (siehe lib/karte-daten.js) */
export function parseKachel(buf) {
  const dv = new DataView(buf);
  let p = 0;
  const liste = () => {
    const n = dv.getUint32(p, true);
    p += 4;
    const out = [];
    for (let i = 0; i < n; i++) {
      const cls = dv.getUint8(p);
      const np = dv.getUint16(p + 1, true);
      p += 3;
      const xy = new Float64Array(np * 2);
      for (let k = 0; k < np; k++) {
        xy[2 * k] = weltX(dv.getInt32(p + 4, true) / 1e6);
        xy[2 * k + 1] = weltY(dv.getInt32(p, true) / 1e6);
        p += 8;
      }
      out.push({ cls, xy });
    }
    return out;
  };
  return { flaechen: liste(), linien: liste(), wege: liste() };
}

/** Farbe und Deckkraft der Wärmekarte. f: Anteil des Budgets (1 = Grenze). Bis 1 grün, gelb, rot; darüber transparent. */
function waermeRgba(f) {
  if (f <= 1) {
    const t = Math.max(0, f);
    const a = [22, 163, 74]; const b = [234, 179, 8]; const c = [220, 38, 38];
    const [x, y, u] = t < 0.5 ? [a, b, t * 2] : [b, c, (t - 0.5) * 2];
    // Kurz vor der Grenze wird die Farbe weich durchsichtig
    const alpha = f <= 0.85 ? 110 : Math.round(110 * (1 - f) / 0.15);
    return [Math.round(x[0] + (y[0] - x[0]) * u), Math.round(x[1] + (y[1] - x[1]) * u), Math.round(x[2] + (y[2] - x[2]) * u), alpha];
  }
  return [0, 0, 0, 0]; // jenseits der Grenze keine Färbung
}

export class Karte {
  /**
   * canvas; optionen: { bbox, zoom: [min, max], kachel(z, x, y) -> Promise<ArrayBuffer>, orte: [[Name, Art, Breite, Länge], ...],
   *   beiKlick(lat, lon), quelle: Text für die Quellenangabe }
   */
  constructor(canvas, optionen) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.opt = optionen;
    this.zoomMin = optionen.zoom[0];
    this.zoomMax = optionen.zoom[1];
    const b = optionen.bbox;
    this.mitte = { x: weltX((b.minLon + b.maxLon) / 2), y: weltY((b.minLat + b.maxLat) / 2) };
    this.grenzen = { x0: weltX(b.minLon - 0.3), x1: weltX(b.maxLon + 0.3), y0: weltY(b.maxLat + 0.2), y1: weltY(b.minLat - 0.2) };
    this.zoom = this.zoomMin;
    this.kacheln = new Map(); // "z/x/y" -> geparste Kachel | 'laden' | { fehler: Zeitpunkt }
    this.bilder = new Map();  // "z/x/y" -> vorgerenderte Kachel (Canvas), ältestes zuerst
    this.laufend = 0;
    this.warteschlange = [];
    this.overlay = null;      // { bild, lat0, lon0, lat1, lon1 }
    this.start = null;
    this.zeichnenGeplant = false;
    this.zeiger = new Map();
    this.farben = {};
    this._ereignisse();
    this.groesse();
  }

  // ---------- Koordinaten ----------
  get welt() { return TILE * 2 ** this.zoom; }
  px(wx, wy) { const s = this.welt; return [(wx - this.mitte.x) * s + this.w / 2, (wy - this.mitte.y) * s + this.h / 2]; }
  vonPx(x, y) { const s = this.welt; return [this.mitte.x + (x - this.w / 2) / s, this.mitte.y + (y - this.h / 2) / s]; }

  groesse() {
    const r = this.c.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.c.width = Math.round(this.w * this.dpr);
    this.c.height = Math.round(this.h * this.dpr);
    this.begrenze();
    this.zeichnen();
  }

  begrenze() {
    this.zoom = Math.min(this.zoomMax, Math.max(this.zoomMin - 0.5, this.zoom));
    const halbB = this.w / 2 / this.welt;
    const halbH = this.h / 2 / this.welt;
    const { x0, x1, y0, y1 } = this.grenzen;
    this.mitte.x = x1 - x0 <= halbB * 2 ? (x0 + x1) / 2 : Math.min(x1 - halbB, Math.max(x0 + halbB, this.mitte.x));
    this.mitte.y = y1 - y0 <= halbH * 2 ? (y0 + y1) / 2 : Math.min(y1 - halbH, Math.max(y0 + halbH, this.mitte.y));
  }

  // ---------- Steuerung von außen ----------
  zoomen(faktor, px = this.w / 2, py = this.h / 2) {
    const [wx, wy] = this.vonPx(px, py);
    this.zoom = Math.min(this.zoomMax, Math.max(this.zoomMin - 0.5, this.zoom + Math.log2(faktor)));
    const s = this.welt;
    this.mitte.x = wx - (px - this.w / 2) / s;
    this.mitte.y = wy - (py - this.h / 2) / s;
    this.begrenze();
    this.zeichnen();
  }

  zentrieren(lat, lon, zoom = null) {
    this.mitte.x = weltX(lon);
    this.mitte.y = weltY(lat);
    if (zoom !== null) this.zoom = Math.min(this.zoomMax, Math.max(this.zoomMin, zoom));
    this.begrenze();
    this.zeichnen();
  }

  /** Zeigt ein Rechteck (Grad) vollständig */
  zeigeRechteck(minLat, minLon, maxLat, maxLon) {
    const bw = (weltX(maxLon) - weltX(minLon)) * 1.1;
    const bh = (weltY(minLat) - weltY(maxLat)) * 1.1;
    const z = Math.log2(Math.min(this.w / (TILE * bw), this.h / (TILE * bh)));
    this.zoom = Math.min(this.zoomMax, Math.max(this.zoomMin - 0.5, z));
    this.mitte.x = (weltX(minLon) + weltX(maxLon)) / 2;
    this.mitte.y = (weltY(minLat) + weltY(maxLat)) / 2;
    this.begrenze();
    this.zeichnen();
  }

  setzeStart(lat, lon) { this.start = lat === null ? null : { lat, lon }; this.zeichnen(); }

  /** Wärmekarte aus dem Raster der Antwort (base64, ein Byte je Zelle; Wert = byte / 254 × max) */
  setzeRaster(raster) {
    if (!raster) { this.overlay = null; this.zeichnen(); return; }
    const bin = atob(raster.daten);
    const bild = document.createElement('canvas');
    bild.width = raster.nx;
    bild.height = raster.ny;
    const ctx = bild.getContext('2d');
    const bd = ctx.createImageData(raster.nx, raster.ny);
    const max = raster.max ?? 1.5;
    for (let y = 0; y < raster.ny; y++) {
      for (let x = 0; x < raster.nx; x++) {
        const f = bin.charCodeAt(y * raster.nx + x) / 254 * max;
        // Zeile 0 liegt im Süden, im Bild oben ist Norden
        const o = ((raster.ny - 1 - y) * raster.nx + x) * 4;
        const [r, g, b, a] = waermeRgba(f);
        bd.data[o] = r; bd.data[o + 1] = g; bd.data[o + 2] = b; bd.data[o + 3] = a;
      }
    }
    ctx.putImageData(bd, 0, 0);
    this.overlay = { bild, lat0: raster.lat0, lon0: raster.lon0, lat1: raster.lat0 + raster.ny * raster.dLat, lon1: raster.lon0 + raster.nx * raster.dLon };
    this.zeichnen();
  }

  // ---------- Kacheln ----------
  _kachelHolen(z, x, y) {
    const key = `${z}/${x}/${y}`;
    const k = this.kacheln.get(key);
    if (k !== undefined) {
      if (k.fehler && Date.now() - k.fehler > 10000) this.kacheln.delete(key); else return k;
    }
    this.kacheln.set(key, 'laden');
    this.warteschlange.push({ key, z, x, y });
    this._abarbeiten();
    return 'laden';
  }

  _abarbeiten() {
    while (this.laufend < MAX_PARALLEL && this.warteschlange.length) {
      const { key, z, x, y } = this.warteschlange.pop(); // zuletzt angefragte zuerst: sie liegen im Bild
      this.laufend++;
      Promise.resolve(this.opt.kachel(z, x, y))
        .then((buf) => this.kacheln.set(key, parseKachel(buf)))
        .catch(() => this.kacheln.set(key, { fehler: Date.now() }))
        .finally(() => { this.laufend--; this._abarbeiten(); this.zeichnen(); });
    }
    if (this.kacheln.size > 400) { // Speicher begrenzen
      for (const key of this.kacheln.keys()) { if (this.kacheln.size <= 300) break; this.kacheln.delete(key); }
    }
  }

  /** Daten der sichtbaren Kacheln; fehlt eine, wird die gröbere Kachel derselben Stelle genommen */
  _sichtbare() {
    const tz = Math.min(this.zoomMax, Math.max(this.zoomMin, Math.round(this.zoom)));
    const n = 2 ** tz;
    const [wx0, wy0] = this.vonPx(0, 0);
    const [wx1, wy1] = this.vonPx(this.w, this.h);
    const x0 = Math.max(0, Math.floor(wx0 * n)); const x1 = Math.min(n - 1, Math.floor(wx1 * n));
    const y0 = Math.max(0, Math.floor(wy0 * n)); const y1 = Math.min(n - 1, Math.floor(wy1 * n));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) return [];
    const fertig = (k) => k && k !== 'laden' && !k.fehler;
    const gesehen = new Set();
    const daten = [];
    const g = this.grenzen;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x + 1) / n < g.x0 || x / n > g.x1 || (y + 1) / n < g.y0 || y / n > g.y1) continue; // außerhalb: keine Anfrage
        let k = this._kachelHolen(tz, x, y);
        let kz = tz; let kx = x; let ky = y;
        while (!fertig(k) && kz > this.zoomMin) {
          kz--; kx = Math.floor(kx / 2); ky = Math.floor(ky / 2);
          k = this.kacheln.get(`${kz}/${kx}/${ky}`);
        }
        if (!fertig(k)) continue;
        const id = `${kz}/${kx}/${ky}`;
        if (!gesehen.has(id)) { gesehen.add(id); daten.push({ z: kz, x: kx, y: ky, k }); }
      }
    }
    return daten;
  }

  // ---------- Zeichnen ----------
  zeichnen() {
    if (this.zeichnenGeplant) return;
    this.zeichnenGeplant = true;
    requestAnimationFrame(() => { this.zeichnenGeplant = false; this._zeichne(); });
  }

  _farben() {
    const s = getComputedStyle(document.documentElement);
    const f = (n) => s.getPropertyValue(n).trim();
    this.farben = { fg: f('--fg'), muted: f('--fg-muted'), bg: f('--bg') };
  }

  /** Breite der Wege und Linien in CSS-Pixeln je Zoomstufe der Kachel */
  _breite(z) { return Math.min(2.2, Math.max(0.9, 0.9 + (z - this.zoomMin) * 0.25)); }

  _zeichne() {
    const g = this.g;
    this._farben();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = LAND;
    g.fillRect(0, 0, this.w, this.h);
    // Jede Kachel ist vorgerendert; beim Zoomen und Verschieben wird nur kopiert
    for (const t of this._sichtbare()) {
      const [x0, y0] = this.px(t.x / 2 ** t.z, t.y / 2 ** t.z);
      const groesse = TILE * 2 ** (this.zoom - t.z);
      g.drawImage(this._bild(t), x0, y0, groesse, groesse);
    }
    this._zeichneWaerme(g);
    this._zeichneOrte(g);
    this._zeichneStart(g);
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = '#4b4b4b';
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    g.fillText(this.opt.quelle ?? '', this.w - 6, this.h - 4);
  }

  /** Bild einer Kachel: einmal zeichnen, dann im Speicher behalten (begrenzt) */
  _bild(t) {
    const key = `${t.z}/${t.x}/${t.y}`;
    const vorhanden = this.bilder.get(key);
    if (vorhanden) { this.bilder.delete(key); this.bilder.set(key, vorhanden); return vorhanden; }
    const S = Math.round(TILE * Math.min(this.dpr, 2));
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // Welt (0..1) -> Pixel dieser Kachel
    const u = { s: 2 ** t.z * S, ox: -t.x * S, oy: -t.y * S, f: S / TILE, m: this._breite(t.z) };
    this._zeichneFlaechen(g, t.k, u);
    this._zeichneLinien(g, t.k, u);
    this._zeichneWege(g, t.k, u);
    this.bilder.set(key, c);
    if (this.bilder.size > 150) this.bilder.delete(this.bilder.keys().next().value);
    return c;
  }

  /** Flächen einzeln füllen: ein einziger Pfad mit tausenden Teilflächen ist im Browser sehr langsam */
  _zeichneFlaechen(g, k, u) {
    for (const cls of [1, 2, 3, 4]) {
      g.fillStyle = FLAECHE[cls];
      for (const f of k.flaechen) {
        if (f.cls !== cls) continue;
        g.beginPath();
        zeichnePfad(g, f.xy, u);
        g.closePath();
        g.fill();
      }
    }
  }

  _zeichneLinien(g, k, u) {
    for (const cls of [5, 6, 7]) {
      g.beginPath();
      let da = false;
      for (const l of k.linien) {
        if (l.cls !== cls) continue;
        da = true;
        zeichnePfad(g, l.xy, u);
      }
      if (da) { g.strokeStyle = LINIE[cls][0]; g.lineWidth = LINIE[cls][1] * u.m * u.f; g.setLineDash([]); g.stroke(); }
    }
  }

  _zeichneWege(g, k, u) {
    // Art 1 Hauptstraße, 2 Nebenstraße, 3 Radweg (gestrichelt), 4 Wirtschaftsweg und Pfad (gestrichelt)
    const stil = {
      1: { w: 2.6, f: '#fcd6a4', rand: '#d9a86c' },
      2: { w: 1.8, f: '#ffffff', rand: '#c9c2b5' },
      3: { w: 1.0, f: '#4f86d9', strich: [4, 2] },
      4: { w: 0.9, f: '#9a8b74', strich: [3, 2] }
    };
    const pfad = (art) => {
      g.beginPath();
      for (const wg of k.wege) if (wg.cls === art) zeichnePfad(g, wg.xy, u);
    };
    for (const art of [1, 2, 3, 4]) {
      const st = stil[art];
      if (st.rand) {
        pfad(art);
        g.strokeStyle = st.rand;
        g.lineWidth = (st.w + 1.4) * u.m * u.f;
        g.setLineDash([]);
        g.stroke();
      }
      pfad(art);
      g.strokeStyle = st.f;
      g.lineWidth = st.w * u.m * u.f;
      g.setLineDash((st.strich ?? []).map((v) => v * u.f));
      g.stroke();
      g.setLineDash([]);
    }
  }

  _zeichneWaerme(g) {
    const o = this.overlay;
    if (!o) return;
    const [x0, y0] = this.px(weltX(o.lon0), weltY(o.lat1));
    const [x1, y1] = this.px(weltX(o.lon1), weltY(o.lat0));
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(o.bild, x0, y0, x1 - x0, y1 - y0);
  }

  _zeichneOrte(g) {
    const orte = this.opt.orte ?? [];
    if (!orte.length) return;
    const minZoom = { city: 7, town: 8.7, village: 10.5, suburb: 12 };
    const rang = { city: 0, town: 1, suburb: 2, village: 3 };
    const [wx0, wy0] = this.vonPx(-40, -20);
    const [wx1, wy1] = this.vonPx(this.w + 40, this.h + 20);
    const sichtbar = [];
    for (const o of orte) {
      if (this.zoom < minZoom[o[1]]) continue;
      const wx = weltX(o[3]); const wy = weltY(o[2]);
      if (wx < wx0 || wx > wx1 || wy < wy0 || wy > wy1) continue;
      sichtbar.push(o);
    }
    sichtbar.sort((a, b) => rang[a[1]] - rang[b[1]]);
    const belegt = [];
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    let n = 0;
    for (const o of sichtbar) {
      if (n >= 500) break;
      const [x, y] = this.px(weltX(o[3]), weltY(o[2]));
      const gross = o[1] === 'city';
      g.font = `${gross ? '600 13px' : o[1] === 'town' ? '500 12px' : '11px'} system-ui, sans-serif`;
      const w = g.measureText(o[0]).width;
      const r = { x: x + 5, y: y - 7, w, h: 14 };
      if (belegt.some((b) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y)) continue;
      belegt.push(r);
      n++;
      g.beginPath();
      g.arc(x, y, gross ? 3 : 2, 0, Math.PI * 2);
      g.fillStyle = '#222';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.strokeText(o[0], r.x, y);
      g.fillStyle = '#222';
      g.fillText(o[0], r.x, y);
    }
  }

  _zeichneStart(g) {
    if (!this.start) return;
    const [x, y] = this.px(weltX(this.start.lon), weltY(this.start.lat));
    g.beginPath();
    g.arc(x, y, 8, 0, Math.PI * 2);
    g.fillStyle = '#15803d';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#fff';
    g.stroke();
    g.beginPath();
    g.arc(x, y, 2.5, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
  }

  // ---------- Eingaben ----------
  _ereignisse() {
    const c = this.c;
    c.style.touchAction = 'none';
    const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.zeiger.set(e.pointerId, { p: pos(e), start: pos(e), bewegt: false });
    });
    c.addEventListener('pointermove', (e) => {
      const z = this.zeiger.get(e.pointerId);
      if (!z) return;
      const neu = pos(e);
      if (this.zeiger.size === 2) {
        // Zwei Finger: Abstand und Mitte bestimmen Zoom und Verschiebung
        const [a, b] = [...this.zeiger.values()];
        const vorher = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]);
        z.p = neu;
        const jetzt = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]);
        if (vorher > 0 && jetzt > 0) this.zoomen(jetzt / vorher, (a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2);
        for (const v of this.zeiger.values()) v.bewegt = true;
        return;
      }
      const dx = neu[0] - z.p[0];
      const dy = neu[1] - z.p[1];
      if (Math.hypot(neu[0] - z.start[0], neu[1] - z.start[1]) > 4) z.bewegt = true;
      z.p = neu;
      if (z.bewegt) {
        this.mitte.x -= dx / this.welt;
        this.mitte.y -= dy / this.welt;
        this.begrenze();
        this.zeichnen();
      }
    });
    const ende = (e) => {
      const z = this.zeiger.get(e.pointerId);
      this.zeiger.delete(e.pointerId);
      if (z && !z.bewegt && this.zeiger.size === 0 && e.type === 'pointerup') {
        const [wx, wy] = this.vonPx(z.p[0], z.p[1]);
        this.opt.beiKlick?.(latVonWelt(wy), lonVonWelt(wx));
      }
    };
    c.addEventListener('pointerup', ende);
    c.addEventListener('pointercancel', ende);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      this.zoomen(Math.exp(-e.deltaY * 0.0015), x, y);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => { const [x, y] = pos(e); this.zoomen(2, x, y); });
    c.addEventListener('keydown', (e) => {
      const schritt = 60 / this.welt;
      if (e.key === 'ArrowLeft') this.mitte.x -= schritt;
      else if (e.key === 'ArrowRight') this.mitte.x += schritt;
      else if (e.key === 'ArrowUp') this.mitte.y -= schritt;
      else if (e.key === 'ArrowDown') this.mitte.y += schritt;
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); this.zoomen(1.5); return; }
      else if (e.key === '-') { e.preventDefault(); this.zoomen(1 / 1.5); return; }
      else return;
      e.preventDefault();
      this.begrenze();
      this.zeichnen();
    });
    this.beobachter = new ResizeObserver(() => this.groesse());
    this.beobachter.observe(c);
  }

  beenden() { this.beobachter?.disconnect(); }
}

export { latVonWelt, lonVonWelt };
