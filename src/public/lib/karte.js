// Selbst gezeichnete Karte (Canvas) ohne fremde Kartenserver: Wegelinien aus den Kacheln des eigenen Servers, Ortsnamen, Wärmekarte der Reichweite,
// Umrandung und Startpunkt. Verschieben mit Ziehen, Zoom mit Mausrad, Knöpfen und zwei Fingern, Klick setzt den Start.
//
// Projektion: Web-Mercator. „Welt“ ist das Quadrat 0..1 (x von West nach Ost, y von Nord nach Süd); bei Zoom z ist es 256·2^z Pixel groß.

const TILE = 256;
const MAX_PARALLEL = 6;

const weltX = (lon) => (lon + 180) / 360;
const weltY = (lat) => {
  const s = Math.sin(lat * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const lonVonWelt = (x) => x * 360 - 180;
const latVonWelt = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;

/** Wegelinien einer Kachel aus dem Binärformat (siehe lib/karte-daten.js) in Weltkoordinaten */
function liniendaten(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const linien = [];
  let p = 4;
  for (let i = 0; i < n; i++) {
    const art = dv.getUint8(p++);
    const np = dv.getUint8(p++);
    const xy = new Float64Array(np * 2);
    for (let k = 0; k < np; k++) {
      xy[k * 2] = weltX(dv.getInt32(p + 4, true) / 1e6);
      xy[k * 2 + 1] = weltY(dv.getInt32(p, true) / 1e6);
      p += 8;
    }
    linien.push({ art, xy });
  }
  return linien;
}

// Farbe der Wärmekarte nach Anteil des Akkus (0 = Start, 1 = leer): grün, gelb, rot
function waermeFarbe(t) {
  const a = [22, 163, 74]; const b = [234, 179, 8]; const c = [220, 38, 38];
  const [x, y, u] = t < 0.5 ? [a, b, t * 2] : [b, c, (t - 0.5) * 2];
  return [Math.round(x[0] + (y[0] - x[0]) * u), Math.round(x[1] + (y[1] - x[1]) * u), Math.round(x[2] + (y[2] - x[2]) * u)];
}
export const waermeCss = (t) => `rgb(${waermeFarbe(t).join(',')})`;

export class Karte {
  /**
   * canvas; optionen: { bbox, zoom: [min, max], kachel(z, x, y) -> Promise<ArrayBuffer>, orte: [[Name, Art, Breite, Länge], ...],
   *   beiKlick(lat, lon), beschriftung: Text für Screenreader }
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
    this.kacheln = new Map();   // "z/x/y" -> { linien } | { fehler: Zeitpunkt } | 'laden'
    this.laufend = 0;
    this.warteschlange = [];
    this.overlay = null;        // { bild: Canvas, lat0, lon0, lat1, lon1 }
    this.umrandung = [];
    this.start = null;
    this.zeichnenGeplant = false;
    this.zeiger = new Map();
    this.farben = {};
    this._ereignisse();
    this.groesse();
  }

  // ---------- Koordinaten ----------
  get welt() { return TILE * 2 ** this.zoom; }
  /** Weltkoordinate -> Pixel auf der Zeichenfläche (CSS-Pixel) */
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
  setzeUmrandung(linien) { this.umrandung = linien ?? []; this.zeichnen(); }

  /** Wärmekarte aus dem Raster der Antwort (base64, ein Byte je Zelle, 255 = nicht erreicht) */
  setzeRaster(raster) {
    if (!raster) { this.overlay = null; this.zeichnen(); return; }
    const bin = atob(raster.daten);
    const bild = document.createElement('canvas');
    bild.width = raster.nx;
    bild.height = raster.ny;
    const ctx = bild.getContext('2d');
    const bd = ctx.createImageData(raster.nx, raster.ny);
    for (let y = 0; y < raster.ny; y++) {
      for (let x = 0; x < raster.nx; x++) {
        const v = bin.charCodeAt(y * raster.nx + x);
        // Zeile 0 liegt im Süden, im Bild oben ist Norden
        const o = ((raster.ny - 1 - y) * raster.nx + x) * 4;
        if (v === 255) { bd.data[o + 3] = 0; continue; }
        const [r, g, b] = waermeFarbe(v / 254);
        bd.data[o] = r; bd.data[o + 1] = g; bd.data[o + 2] = b; bd.data[o + 3] = 255;
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
        .then((buf) => this.kacheln.set(key, { linien: liniendaten(buf) }))
        .catch(() => this.kacheln.set(key, { fehler: Date.now() }))
        .finally(() => { this.laufend--; this._abarbeiten(); this.zeichnen(); });
    }
    if (this.kacheln.size > 400) { // Speicher begrenzen: die ältesten Einträge vergessen
      for (const key of this.kacheln.keys()) { if (this.kacheln.size <= 300) break; this.kacheln.delete(key); }
    }
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
    this.farben = { bg: f('--bg'), fg: f('--fg'), muted: f('--fg-muted'), rand: f('--border'), primary: f('--primary') };
  }

  _zeichne() {
    const g = this.g;
    this._farben();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = this.farben.bg;
    g.fillRect(0, 0, this.w, this.h);

    this._zeichneWaerme(g);   // die Wärmekarte liegt unter den Wegen, damit sie lesbar bleiben
    this._zeichneWege(g);
    this._zeichneUmrandung(g);
    this._zeichneOrte(g);
    this._zeichneStart(g);

    g.font = '10px system-ui, sans-serif';
    g.fillStyle = this.farben.muted;
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    g.fillText(this.opt.quelle ?? '', this.w - 6, this.h - 4);
  }

  _zeichneWege(g) {
    const tz = Math.min(this.zoomMax, Math.max(this.zoomMin, Math.round(this.zoom)));
    const n = 2 ** tz;
    const [wx0, wy0] = this.vonPx(0, 0);
    const [wx1, wy1] = this.vonPx(this.w, this.h);
    const x0 = Math.max(0, Math.floor(wx0 * n)); const x1 = Math.min(n - 1, Math.floor(wx1 * n));
    const y0 = Math.max(0, Math.floor(wy0 * n)); const y1 = Math.min(n - 1, Math.floor(wy1 * n));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) return; // viel zu viele Kacheln: nicht zeichnen
    const gezeichnet = new Set();
    const zuZeichnen = [];
    const nurSichtbareGrenzen = this.grenzen;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // außerhalb des Landes keine Anfragen
        if ((x + 1) / n < nurSichtbareGrenzen.x0 || x / n > nurSichtbareGrenzen.x1 || (y + 1) / n < nurSichtbareGrenzen.y0 || y / n > nurSichtbareGrenzen.y1) continue;
        let k = this._kachelHolen(tz, x, y);
        let kz = tz; let kx = x; let ky = y;
        // Solange sie lädt: gröbere Kachel derselben Stelle zeigen
        while ((k === 'laden' || k.fehler) && kz > this.zoomMin) {
          kz--; kx = Math.floor(kx / 2); ky = Math.floor(ky / 2);
          const ersatz = this.kacheln.get(`${kz}/${kx}/${ky}`);
          k = ersatz && ersatz !== 'laden' && !ersatz.fehler ? ersatz : 'laden';
          if (k !== 'laden') break;
        }
        if (k === 'laden' || k.fehler) continue;
        const id = `${kz}/${kx}/${ky}`;
        if (!gezeichnet.has(id)) { gezeichnet.add(id); zuZeichnen.push(k); }
      }
    }
    const s = this.welt;
    const ox = this.w / 2 - this.mitte.x * s;
    const oy = this.h / 2 - this.mitte.y * s;
    const stile = {
      4: { w: 0.7, f: this.farben.rand, a: 0.8 },
      3: { w: 1, f: this.farben.primary, a: 0.5 },
      2: { w: 0.9, f: this.farben.muted, a: 0.55 },
      1: { w: this.zoom > 10 ? 1.8 : 1.2, f: this.farben.muted, a: 0.95 }
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const art of [4, 3, 2, 1]) {
      const st = stile[art];
      g.beginPath();
      for (const k of zuZeichnen) {
        for (const l of k.linien) {
          if (l.art !== art) continue;
          const xy = l.xy;
          g.moveTo(xy[0] * s + ox, xy[1] * s + oy);
          for (let i = 2; i < xy.length; i += 2) g.lineTo(xy[i] * s + ox, xy[i + 1] * s + oy);
        }
      }
      g.strokeStyle = st.f;
      g.globalAlpha = st.a;
      g.lineWidth = st.w;
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  _zeichneWaerme(g) {
    const o = this.overlay;
    if (!o) return;
    const [x0, y0] = this.px(weltX(o.lon0), weltY(o.lat1));
    const [x1, y1] = this.px(weltX(o.lon1), weltY(o.lat0));
    g.imageSmoothingEnabled = true;
    g.globalAlpha = 0.6;
    g.drawImage(o.bild, x0, y0, x1 - x0, y1 - y0);
    g.globalAlpha = 1;
  }

  _zeichneUmrandung(g) {
    if (!this.umrandung.length) return;
    g.beginPath();
    for (const linie of this.umrandung) {
      linie.forEach(([la, lo], i) => {
        const [x, y] = this.px(weltX(lo), weltY(la));
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
    }
    g.lineJoin = 'round';
    g.strokeStyle = this.farben.bg;
    g.lineWidth = 4;
    g.stroke();
    g.strokeStyle = this.farben.fg;
    g.lineWidth = 2;
    g.stroke();
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
      g.fillStyle = this.farben.fg;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = this.farben.bg;
      g.strokeText(o[0], r.x, y);
      g.fillStyle = this.farben.fg;
      g.fillText(o[0], r.x, y);
    }
  }

  _zeichneStart(g) {
    if (!this.start) return;
    const [x, y] = this.px(weltX(this.start.lon), weltY(this.start.lat));
    g.beginPath();
    g.arc(x, y, 8, 0, Math.PI * 2);
    g.fillStyle = this.farben.primary;
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
      else if (e.key === '+' || e.key === '=') return void (this.zoomen(1.5), e.preventDefault());
      else if (e.key === '-') return void (this.zoomen(1 / 1.5), e.preventDefault());
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
