// Begrenzung der Anfragen je Schlüssel (z. B. Adresse des Besuchers) innerhalb eines Zeitfensters. Zählung im Arbeitsspeicher.

export class Begrenzung {
  constructor({ max = 5, fensterMs = 60 * 60 * 1000 } = {}) {
    this.max = max;
    this.fensterMs = fensterMs;
    this.eintraege = new Map(); // schluessel -> Zeitpunkte
  }

  _aktuell(schluessel, jetzt) {
    const liste = (this.eintraege.get(schluessel) ?? []).filter(t => jetzt - t < this.fensterMs);
    if (liste.length) this.eintraege.set(schluessel, liste);
    else this.eintraege.delete(schluessel);
    return liste;
  }

  erlaubt(schluessel, jetzt = Date.now()) {
    return this._aktuell(schluessel, jetzt).length < this.max;
  }

  zaehle(schluessel, jetzt = Date.now()) {
    const liste = this._aktuell(schluessel, jetzt);
    liste.push(jetzt);
    this.eintraege.set(schluessel, liste);
    // Speicher klein halten: alte Schlüssel gelegentlich aufräumen
    if (this.eintraege.size > 5000) {
      for (const k of [...this.eintraege.keys()]) this._aktuell(k, jetzt);
    }
  }
}
