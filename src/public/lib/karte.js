// Karte des Reichweiten-Planers auf MapLibre GL. Die Grundkarte kommt aus einer einzigen PMTiles-Datei des eigenen Servers
// (/karte/germany.pmtiles, Stil in src/public/karte/stil.json). Über die Grundkarte legen sich die Wärmekarte der Reichweite
// (als Bild), der Startpunkt und das Rechteck des Ergebnisses. Keine fremden Kartenserver.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import stil from '../karte/stil.json';

// Das pmtiles-Protokoll einmal registrieren (MapLibre meldet sonst einen Fehler bei jeder weiteren Karte)
if (!globalThis.__fawowaPmtiles) {
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  globalThis.__fawowaPmtiles = true;
}

/** Farbe und Deckkraft der Wärmekarte. f: Anteil des Budgets (1 = Grenze). Bis 1 grün, gelb, rot; darüber transparent. */
function waermeRgba(f) {
  if (f <= 1) {
    const t = Math.max(0, f);
    const a = [22, 163, 74]; const b = [234, 179, 8]; const c = [220, 38, 38];
    const [x, y, u] = t < 0.5 ? [a, b, t * 2] : [b, c, (t - 0.5) * 2];
    return [Math.round(x[0] + (y[0] - x[0]) * u), Math.round(x[1] + (y[1] - x[1]) * u), Math.round(x[2] + (y[2] - x[2]) * u), 110];
  }
  return [0, 0, 0, 0]; // jenseits der Grenze keine Färbung
}

/**
 * Wärmekarte aus dem Raster der Antwort (base64, ein Byte je Zelle; Wert = byte / 254 × max) als PNG-Adresse und Eckpunkte.
 * Zeile 0 liegt im Süden, im Bild oben ist Norden.
 */
export function rasterBild(raster) {
  const bin = atob(raster.daten);
  const deck = raster.deckkraft ? atob(raster.deckkraft) : null;
  const max = raster.max ?? 1.5;
  const bild = document.createElement('canvas');
  bild.width = raster.nx;
  bild.height = raster.ny;
  const ctx = bild.getContext('2d');
  const bd = ctx.createImageData(raster.nx, raster.ny);
  for (let y = 0; y < raster.ny; y++) {
    for (let x = 0; x < raster.nx; x++) {
      const k = y * raster.nx + x;
      const f = bin.charCodeAt(k) / 254 * max;
      const o = ((raster.ny - 1 - y) * raster.nx + x) * 4;
      const [r, g, b, a] = waermeRgba(f);
      bd.data[o] = r; bd.data[o + 1] = g; bd.data[o + 2] = b;
      bd.data[o + 3] = deck ? Math.round(a * deck.charCodeAt(k) / 255) : a;
    }
  }
  ctx.putImageData(bd, 0, 0);
  const lat1 = raster.lat0 + raster.ny * raster.dLat;
  const lon1 = raster.lon0 + raster.nx * raster.dLon;
  // Reihenfolge wie MapLibre sie für Bildquellen verlangt: links oben, rechts oben, rechts unten, links unten
  const koordinaten = [[raster.lon0, lat1], [lon1, lat1], [lon1, raster.lat0], [raster.lon0, raster.lat0]];
  return { url: bild.toDataURL('image/png'), koordinaten };
}

const LEER = { type: 'FeatureCollection', features: [] };
const punkt = (lat, lon) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }] });
const rahmen = (minLat, minLon, maxLat, maxLon) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]] } }]
});

export class Karte {
  /**
   * container: HTML-Element für die Karte. optionen: { bbox, zoom: [min, max], orte, quelle (Text der Quellenangabe),
   * beiKlick(lat, lon) }
   */
  constructor(container, optionen) {
    this.container = container;
    this.opt = optionen;
    this.zoomMin = optionen.zoom[0];
    this.zoomMax = optionen.zoom[1];
    const b = optionen.bbox;
    // Adresse des PMTiles-Datei auf demselben Server; der Stil wird hier nur ergänzt, nicht von außen geladen
    const stilKopie = structuredClone(stil);
    stilKopie.sources.osm.url = `pmtiles://${location.origin}/karte/germany.pmtiles`;
    // Verschieben über NRW hinaus (Nachbarregionen, dort ohne Daten)
    this.map = new maplibregl.Map({
      container,
      style: stilKopie,
      bounds: [[b.minLon, b.minLat], [b.maxLon, b.maxLat]],
      fitBoundsOptions: { padding: 40 },
      minZoom: this.zoomMin,
      maxZoom: this.zoomMax,
      maxBounds: [[b.minLon - 2.5, b.minLat - 2.0], [b.maxLon + 2.5, b.maxLat + 2.0]],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      canvasContextAttributes: { antialias: false }
    });
    this.zustand = { raster: null, start: null, rechteck: null };
    this.geladen = false;
    this.attribution = null;
    this.zeichnen();
    this.map.on('load', () => { this.geladen = true; this._anwenden(); });
    this.map.on('click', (e) => this.opt.beiKlick?.(e.lngLat.lat, e.lngLat.lng));
    // Zoomstufe melden (Anzeige im Planer)
    this.map.on('zoom', () => this.opt.beiZoom?.(this.map.getZoom()));
  }

  /** Aktueller Zoom (Stufe, auch Bruchteile) */
  get zoom() { return this.map.getZoom(); }

  groesse() { this.map.resize(); }

  zoomen(faktor) {
    this.map.zoomTo(this.map.getZoom() + Math.log2(faktor), { duration: 200 });
  }

  zentrieren(lat, lon, zoom = null) {
    this.map.easeTo({ center: [lon, lat], ...(zoom !== null ? { zoom } : {}), duration: 400 });
  }

  /** Ansicht so wählen, dass das Rechteck (Ergebnis) ganz zu sehen ist */
  zeigeRechteck(minLat, minLon, maxLat, maxLon) {
    this.zustand.rechteck = { minLat, minLon, maxLat, maxLon };
    this.map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40, duration: 0 });
    this._anwenden();
  }

  setzeStart(lat, lon) {
    this.zustand.start = lat === null ? null : { lat, lon };
    this._anwenden();
  }

  /** raster: Antwort der Berechnung (siehe rasterBild) oder null */
  setzeRaster(raster) {
    this.zustand.raster = raster ? rasterBild(raster) : null;
    this._anwenden();
  }

  /** Quellenangabe (unten rechts) neu setzen */
  zeichnen() {
    if (this.attribution) this.map.removeControl(this.attribution);
    this.attribution = new maplibregl.AttributionControl({ compact: true, customAttribution: this.opt.quelle });
    this.map.addControl(this.attribution, 'bottom-right');
  }

  beenden() {
    this.map.remove();
  }

  /** Quellen und Ebenen für den Zustand anlegen oder aktualisieren; vor dem Laden der Grundkarte wird nichts getan */
  _anwenden() {
    if (!this.geladen) return;
    const m = this.map;
    const z = this.zustand;

    if (z.raster) {
      if (m.getSource('waerme')) m.getSource('waerme').updateImage({ url: z.raster.url, coordinates: z.raster.koordinaten });
      else {
        m.addSource('waerme', { type: 'image', url: z.raster.url, coordinates: z.raster.koordinaten });
        m.addLayer({ id: 'waerme', type: 'raster', source: 'waerme', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } });
      }
    } else if (m.getLayer('waerme')) {
      m.removeLayer('waerme');
      m.removeSource('waerme');
    }

    const rahmenDaten = z.rechteck ? rahmen(z.rechteck.minLat, z.rechteck.minLon, z.rechteck.maxLat, z.rechteck.maxLon) : LEER;
    if (m.getSource('rechteck')) m.getSource('rechteck').setData(rahmenDaten);
    else {
      m.addSource('rechteck', { type: 'geojson', data: rahmenDaten });
      m.addLayer({ id: 'rechteck', type: 'line', source: 'rechteck', paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-dasharray': [2, 2] } });
    }

    const startDaten = z.start ? punkt(z.start.lat, z.start.lon) : LEER;
    if (m.getSource('start')) m.getSource('start').setData(startDaten);
    else {
      m.addSource('start', { type: 'geojson', data: startDaten });
      m.addLayer({ id: 'start', type: 'circle', source: 'start', paint: { 'circle-radius': 7, 'circle-color': '#2563eb', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    }
  }
}
