// Kacheln vorab erzeugen: Hintergrundjob. Er holt alle Kacheln der gewählten Zoomstufen über den Routing-Dienst (dessen
// Warteschlange begrenzt die Last) und legt sie auf der Platte ab. Die Auslieferung nimmt eine vorhandene Kachel von dort.
// Bereits vorhandene Kacheln werden übersprungen, deshalb ist ein Neustart unkritisch.
import { mkdirSync, writeFileSync, existsSync, renameSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

/** Version der Kachelablage: bei jeder Änderung an der Darstellung erhöhen, dann werden die Kacheln neu erzeugt */
export const KACHEL_VERSION = 1;

/** Dateiname einer Kachel auf der Platte */
export function kachelDatei(verzeichnis, z, x, y) {
  return join(verzeichnis, `v${KACHEL_VERSION}`, String(z), String(x), `${y}.bin`);
}

/** Bereich der Kacheln in Zoomstufe z, die ein Rechteck (Grad) berühren */
export function kachelnImRechteck(z, b) {
  const n = 2 ** z;
  const yAuf = (lat) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const x0 = Math.max(0, Math.floor((b.minLon + 180) / 360 * n));
  const x1 = Math.min(n - 1, Math.floor((b.maxLon + 180) / 360 * n));
  const y0 = Math.max(0, yAuf(b.maxLat));
  const y1 = Math.min(n - 1, yAuf(b.minLat));
  return { x0, x1, y0, y1, anzahl: Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1) };
}

export class KachelJob {
  constructor({ routing, verzeichnis, log = console.log, gleichzeitig = 8 }) {
    this.routing = routing;
    this.verzeichnis = verzeichnis;
    this.log = log;
    this.gleichzeitig = gleichzeitig;
    this.laeuft = false;
    this.abbruch = false;
    this.gesamt = 0;
    this.fertig = 0;
    this.fehler = 0;
    this.letzterFehler = null;
    this.zoomStufen = [];
    this.begonnen = null;
    this.beendet = null;
    this.stand = this.ladeStand();
  }

  /** Stand aus einem früheren Lauf (nur zur Anzeige, nach einem Neustart) */
  ladeStand() {
    try { return JSON.parse(readFileSync(join(this.verzeichnis, 'job.json'), 'utf8')); } catch { return null; }
  }

  speichereStand() {
    try {
      mkdirSync(this.verzeichnis, { recursive: true });
      writeFileSync(join(this.verzeichnis, 'job.json'), JSON.stringify(this.status(), null, 2));
    } catch (e) { this.log('Kachel-Stand konnte nicht gespeichert werden:', e.message); }
  }

  /** Anzahl der Kacheln je Zoomstufe für das Netzgebiet, ohne sie zu erzeugen */
  schaetzung(zooms) {
    const bbox = this.routing?.info?.bbox;
    if (!bbox) return { gesamt: 0, je: {} };
    const je = {};
    let gesamt = 0;
    for (const z of zooms) {
      const n = kachelnImRechteck(z, bbox).anzahl;
      je[z] = n;
      gesamt += n;
    }
    return { gesamt, je };
  }

  status() {
    const prozent = this.gesamt ? Math.round((this.fertig / this.gesamt) * 1000) / 10 : 0;
    return {
      laeuft: this.laeuft, abbruch: this.abbruch, gesamt: this.gesamt, fertig: this.fertig, fehler: this.fehler, prozent,
      letzterFehler: this.letzterFehler, zoomStufen: this.zoomStufen, begonnen: this.begonnen, beendet: this.beendet,
      kachelVersion: KACHEL_VERSION
    };
  }

  /** Startet den Job für die Zoomstufen; liefert den Stand sofort. Die Erzeugung läuft danach im Hintergrund. */
  start(zooms) {
    if (this.laeuft) throw new Error('Die Kacheln werden schon erzeugt.');
    if (!this.routing?.bereit) throw new Error('Der Routing-Dienst ist nicht bereit.');
    const bbox = this.routing.info.bbox;
    const liste = [];
    let fertigVorab = 0;
    for (const z of zooms) {
      const b = kachelnImRechteck(z, bbox);
      for (let x = b.x0; x <= b.x1; x++) {
        for (let y = b.y0; y <= b.y1; y++) {
          if (existsSync(kachelDatei(this.verzeichnis, z, x, y))) fertigVorab++;
          else liste.push([z, x, y]);
        }
      }
    }
    this.laeuft = true;
    this.abbruch = false;
    this.gesamt = liste.length + fertigVorab;
    this.fertig = fertigVorab;
    this.fehler = 0;
    this.letzterFehler = null;
    this.zoomStufen = [...zooms];
    this.begonnen = new Date().toISOString();
    this.beendet = null;
    this.speichereStand();
    this.log(`Kacheln: ${this.gesamt} insgesamt, ${liste.length} zu erzeugen (Zoom ${zooms.join(', ')})`);

    (async () => {
      for (let i = 0; i < liste.length && !this.abbruch; i += this.gleichzeitig) {
        // Die Kacheln werden synchron berechnet. Ohne Pause hätte der Ereignisablauf keine Gelegenheit, Fortschritt zu speichern
        await new Promise((r) => setImmediate(r));
        const charge = liste.slice(i, i + this.gleichzeitig);
        await Promise.all(charge.map(async ([z, x, y]) => {
          try {
            const buf = await this.routing.linien(z, x, y);
            const datei = kachelDatei(this.verzeichnis, z, x, y);
            mkdirSync(dirname(datei), { recursive: true });
            writeFileSync(datei + '.tmp', Buffer.from(buf));
            renameSync(datei + '.tmp', datei);
          } catch (e) {
            this.fehler++;
            this.letzterFehler = e.message;
          }
          this.fertig++;
        }));
        if (i % (this.gleichzeitig * 50) === 0) this.speichereStand();
      }
      this.laeuft = false;
      this.beendet = new Date().toISOString();
      this.speichereStand();
      this.log(`Kacheln: ${this.abbruch ? 'angehalten' : 'fertig'} (${this.fertig} von ${this.gesamt}, Fehler ${this.fehler})`);
    })();
    return this.status();
  }

  /** Bricht nach der laufenden Charge ab */
  stop() {
    if (this.laeuft) this.abbruch = true;
    return this.status();
  }
}
