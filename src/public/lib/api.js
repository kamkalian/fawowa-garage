// Zugriff auf die Garage-API. Der Schlüssel steht im Header, nie in der Adresse der Anfrage.

export class ApiFehler extends Error {
  constructor(status, code, felder) {
    super(code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.felder = felder ?? null;
  }
}

async function anfrage(methode, pfad, { token, body } = {}) {
  let res;
  try {
    res = await fetch(pfad, {
      method: methode,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiFehler(0, 'netz');
  }
  if (res.status === 204) return null;
  let json = null;
  try { json = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (!res.ok) throw new ApiFehler(res.status, json?.code ?? null, json?.felder);
  return json;
}

export const einstellungen = () => anfrage('GET', '/api/v1/einstellungen');
export const garageAnlegen = (fahrerName) => anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: fahrerName } });
export const garageLaden = (token) => anfrage('GET', '/api/v1/garage', { token });
export const garageLoeschen = (token) => anfrage('DELETE', '/api/v1/garage', { token });
export const eintragAnlegen = (token, art, werte) => anfrage('POST', `/api/v1/garage/${art}`, { token, body: werte });
export const eintragAendern = (token, art, id, werte) => anfrage('PUT', `/api/v1/garage/${art}/${id}`, { token, body: werte });
export const eintragLoeschen = (token, art, id) => anfrage('DELETE', `/api/v1/garage/${art}/${id}`, { token });
export const gespannSetzen = (token, werte) => anfrage('PUT', '/api/v1/garage/gespann', { token, body: werte });
export const planerLesen = (token) => anfrage('GET', '/api/v1/garage/planer', { token });
export const planerSetzen = (token, werte) => anfrage('PUT', '/api/v1/garage/planer', { token, body: werte });
export const mitgliedSetzen = (token, art, id, im) => anfrage('PUT', '/api/v1/garage/mitglied', { token, body: { art, id, im } });
export const mitgliedPositionSetzen = (token, art, id, x, y, s) => anfrage('PUT', '/api/v1/garage/mitglied/position', { token, body: { art, id, x, y, s } });
export const antriebSetzen = (token, art, id, werte) => anfrage('PUT', `/api/v1/garage/antriebe/${art}/${id}`, { token, body: werte });
export const gegenstandAnlegen = (token, gepaeckId, name, platz) => anfrage('POST', `/api/v1/garage/gepaecke/${gepaeckId}/gegenstaende`, { token, body: { name, platz } });
export const gegenstandAendern = (token, id, werte) => anfrage('PUT', `/api/v1/garage/gegenstaende/${id}`, { token, body: werte });
export const gegenstandLoeschen = (token, id) => anfrage('DELETE', `/api/v1/garage/gegenstaende/${id}`, { token });
export const reihenfolgeSetzen = (token, reihenfolge) => anfrage('PUT', '/api/v1/garage/reihenfolge', { token, body: { reihenfolge } });
export const fahrerNameSetzen = (token, name) => anfrage('PUT', '/api/v1/garage/fahrer', { token, body: { fahrer_name: name } });
export const emailSetzen = (token, email, lang) => anfrage('PUT', '/api/v1/garage/email', { token, body: { email, lang } });
export const emailEntfernen = (token) => anfrage('DELETE', '/api/v1/garage/email', { token });
export const emailBestaetigen = (schluessel) => anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: schluessel } });
export const zugangAnfordern = (email, lang) => anfrage('POST', '/api/v1/zugang/anfordern', { body: { email, lang } });
export const zugangEinloesen = (schluessel) => anfrage('POST', '/api/v1/zugang/einloesen', { body: { token: schluessel } });
export const reichweiteBerechnen = (token, werte) => anfrage('POST', '/api/v1/garage/reichweite', { token, body: werte });
/** Stand der Reichweite der Garage: { status: wartet|laeuft|fertig|fehler|null, davor, meldung, ergebnis } */
export const reichweiteStand = (token) => anfrage('GET', '/api/v1/garage/reichweite', { token });
/** Routen und 1-km-Punkte der letzten Berechnung (nur auf Abruf): { linien, schritte } oder null-Felder */
export const reichweiteRouten = (token) => anfrage('GET', '/api/v1/garage/reichweite/routen', { token });
export const karteOrte = () => anfrage('GET', '/api/v1/karte/orte');


// Fotos eines Stellplatzes (Bild als Körper der Anfrage; zum Anzeigen wird es mit dem Zugangsschlüssel geladen)
export async function fotoHochladen(token, art, id, datei) {
  const res = await fetch(`/api/v1/garage/foto/${art}/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: datei });
  if (!res.ok) throw new ApiFehler(res.status, null);
}
export async function fotoLaden(token, art, id) {
  const res = await fetch(`/api/v1/garage/foto/${art}/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}
export async function fotoLoeschen(token, art, id) {
  const res = await fetch(`/api/v1/garage/foto/${art}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ApiFehler(res.status, null);
}
