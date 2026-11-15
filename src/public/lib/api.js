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
export const garageAnlegen = () => anfrage('POST', '/api/v1/garagen');
export const garageLaden = (token) => anfrage('GET', '/api/v1/garage', { token });
export const garageLoeschen = (token) => anfrage('DELETE', '/api/v1/garage', { token });
export const eintragAnlegen = (token, art, werte) => anfrage('POST', `/api/v1/garage/${art}`, { token, body: werte });
export const eintragAendern = (token, art, id, werte) => anfrage('PUT', `/api/v1/garage/${art}/${id}`, { token, body: werte });
export const eintragLoeschen = (token, art, id) => anfrage('DELETE', `/api/v1/garage/${art}/${id}`, { token });
export const gespannSetzen = (token, werte) => anfrage('PUT', '/api/v1/garage/gespann', { token, body: werte });
