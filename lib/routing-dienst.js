// Routing-Dienst: startet Hintergrund-Threads mit dem Wegenetz und nimmt Aufträge an (Reichweite, Kartenlinien).
// Zwei Threads, damit die Karte flüssig bleibt, während eine Reichweite berechnet wird: einer rechnet (nacheinander, kleine Warteschlange),
// einer liefert Kartenkacheln. Ist eine Warteschlange voll, wird abgelehnt (code 'ausgelastet'), damit der Server nicht überrollt wird.
import { Worker } from 'worker_threads';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FehlerEingabe } from './fehler.js';

const hier = dirname(fileURLToPath(import.meta.url));
const nichtVerfuegbar = () => new FehlerEingabe('Das Routing ist gerade nicht verfügbar.', 503, { code: 'routing_aus' });

/** Ein Hintergrund-Thread mit eigenem Exemplar des Wegenetzes und einer Warteschlange */
class Thread {
  constructor({ ordner, minKomponente, maxWarteschlange, zeitlimitMs }) {
    Object.assign(this, { ordner, minKomponente, maxWarteschlange, zeitlimitMs });
    this.offen = new Map();
    this.naechsteId = 1;
    this.worker = null;
    this.info = null;
  }

  async starten() {
    await new Promise((aufloesen, ablehnen) => {
      const w = new Worker(join(hier, 'routing-worker.js'), { workerData: { ordner: this.ordner, minKomponente: this.minKomponente } });
      this.worker = w;
      w.once('error', ablehnen);
      w.on('message', (m) => {
        if (m.art === 'bereit') { this.info = m.info; aufloesen(); return; }
        const eintrag = this.offen.get(m.id);
        if (!eintrag) return;
        this.offen.delete(m.id);
        clearTimeout(eintrag.timer);
        if (m.fehler) eintrag.ablehnen(new Error(m.fehler)); else eintrag.aufloesen(m.ergebnis);
      });
      w.on('error', (e) => this._abgestuerzt(e));
      w.on('exit', (code) => { if (this.worker === w) this._abgestuerzt(new Error(`Routing-Thread beendet (${code})`)); });
    });
  }

  _abgestuerzt(e) {
    console.error('Routing-Dienst:', e.message);
    this.worker = null;
    for (const [id, eintrag] of this.offen) { clearTimeout(eintrag.timer); eintrag.ablehnen(nichtVerfuegbar()); this.offen.delete(id); }
  }

  get bereit() { return !!this.worker && !!this.info; }

  auftrag(inhalt) {
    if (!this.bereit) return Promise.reject(nichtVerfuegbar());
    if (this.offen.size > this.maxWarteschlange) {
      return Promise.reject(new FehlerEingabe('Das Routing ist gerade ausgelastet. Bitte gleich noch einmal versuchen.', 503, { code: 'ausgelastet' }));
    }
    return new Promise((aufloesen, ablehnen) => {
      const id = this.naechsteId++;
      const timer = setTimeout(() => {
        this.offen.delete(id);
        ablehnen(new FehlerEingabe('Die Berechnung hat zu lange gedauert.', 503, { code: 'zeitueberschreitung' }));
      }, this.zeitlimitMs);
      timer.unref?.();
      this.offen.set(id, { aufloesen, ablehnen, timer });
      this.worker.postMessage({ id, ...inhalt });
    });
  }

  async beenden() {
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}

export class RoutingDienst {
  /**
   * ordner: Wegenetz (von tools/routing/bauen.js); minKomponente: kleinste Größe eines zusammenhängenden Netzteils, in den der Start einrasten darf;
   * maxWarteschlange: wie viele Reichweiten-Aufträge höchstens warten; zeitlimitMs: Obergrenze je Reichweiten-Auftrag
   */
  constructor({ ordner, maxWarteschlange = 4, zeitlimitMs = 60000, minKomponente = 2000 }) {
    this.ordner = ordner;
    this.rechner = new Thread({ ordner, minKomponente, maxWarteschlange, zeitlimitMs });
    this.karte = new Thread({ ordner, minKomponente, maxWarteschlange: 96, zeitlimitMs: 15000 }); // Kacheln sind schnell, es dürfen viele warten
    this.orte = null;
  }

  /** Startet die Threads und wartet, bis das Netz geladen ist. Wirft, wenn das Netz fehlt oder nicht lädt. */
  async starten() {
    const orteDatei = join(this.ordner, 'orte.json');
    this.orte = existsSync(orteDatei) ? JSON.parse(readFileSync(orteDatei, 'utf8')) : [];
    await Promise.all([this.rechner.starten(), this.karte.starten()]);
  }

  get info() { return this.rechner.info; }
  get bereit() { return this.rechner.bereit && this.karte.bereit; }
  get wartend() { return this.rechner.offen.size + this.karte.offen.size; }

  /** Reichweite berechnen (siehe lib/reichweite.js); Ergebnis { ok: true, ... } oder { fehler: [...] } */
  berechne(eingabe) { return this.rechner.auftrag({ art: 'reichweite', eingabe }); }

  /** Wegelinien einer Kartenkachel als ArrayBuffer */
  linien(z, x, y) { return this.karte.auftrag({ art: 'linien', z, x, y }); }

  async beenden() { await Promise.all([this.rechner.beenden(), this.karte.beenden()]); }
}
