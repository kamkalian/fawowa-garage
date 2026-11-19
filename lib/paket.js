// Paketformat „fawowa-paket-1“ auf Seiten des Servers: Manifest lesen und prüfen (Format, Pfade, Größen, Prüfsummen).
// Beschreibung in docs/PAKETFORMAT.md; das Packen macht das Daten-Werkzeug (eigenes Repo).
import { createReadStream, existsSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

export const PAKET_FORMAT = 'fawowa-paket-1';
const PFAD_MUSTER = /^[a-z0-9._-]+(\/[a-z0-9._-]+)*$/;
const ARTEN = ['netz', 'karte'];

/** Ein Pfad im Paket darf nur a-z0-9._- und / enthalten, kein „..“ und keinen absoluten Pfad */
export function pfadErlaubt(p) {
  return typeof p === 'string' && PFAD_MUSTER.test(p) && !p.includes('..') && !p.startsWith('/');
}

/** Prüft die Struktur eines Manifests; liefert eine Liste der Probleme (leer = in Ordnung) */
export function pruefeManifest(m) {
  const fehler = [];
  if (!m || typeof m !== 'object') return ['Manifest ist kein Objekt'];
  if (m.format !== PAKET_FORMAT) fehler.push(`Format ist ${JSON.stringify(m.format)}, erwartet ${PAKET_FORMAT}`);
  if (!ARTEN.includes(m.art)) fehler.push(`unbekannte Art ${JSON.stringify(m.art)}`);
  if (typeof m.version !== 'string' || !/^[0-9A-Za-z._T-]+$/.test(m.version)) fehler.push('ungültige Version');
  if (!Array.isArray(m.dateien)) return [...fehler, 'dateien fehlt'];
  const zipNamen = new Set((m.zips ?? []).map((z) => z.name));
  for (const d of m.dateien) {
    if (!pfadErlaubt(d.pfad)) fehler.push(`ungültiger Pfad ${JSON.stringify(d.pfad)}`);
    if (!Number.isInteger(d.bytes) || d.bytes < 0) fehler.push(`${d.pfad}: ungültige Größe`);
    if (!Array.isArray(d.stuecke) || d.stuecke.length === 0) { fehler.push(`${d.pfad}: keine Stücke`); continue; }
    const summe = d.stuecke.reduce((a, s) => a + s.bytes, 0);
    if (summe !== d.bytes) fehler.push(`${d.pfad}: Stücke ergeben ${summe} Bytes, erwartet ${d.bytes}`);
    let erwarteterOffset = 0;
    for (const s of d.stuecke) {
      if (s.offset !== erwarteterOffset) fehler.push(`${d.pfad}: Stück ${s.eintrag} beginnt bei ${s.offset}, erwartet ${erwarteterOffset}`);
      erwarteterOffset += s.bytes;
      if (!zipNamen.has(s.zip)) fehler.push(`${d.pfad}: Stück ${s.eintrag} liegt in ${s.zip}, das nicht im Manifest steht`);
    }
  }
  return fehler;
}

/** SHA-256 einer Datei als Hex-Text (gestreamt, auch für große Dateien) */
export function sha256Datei(pfad) {
  return new Promise((aufloesen, ablehnen) => {
    const h = createHash('sha256');
    const strom = createReadStream(pfad);
    strom.on('data', (buf) => h.update(buf));
    strom.on('error', ablehnen);
    strom.on('end', () => aufloesen(h.digest('hex')));
  });
}

/**
 * Prüft die ZIP-Dateien eines Pakets gegen das externe Manifest: vorhanden, Größe und SHA-256.
 * Liefert eine Liste der Probleme (leer = in Ordnung).
 */
export async function pruefeZips(m, zipOrdner) {
  const fehler = [];
  for (const z of m.zips ?? []) {
    const pfad = join(zipOrdner, z.name);
    if (!existsSync(pfad)) { fehler.push(`ZIP fehlt: ${z.name}`); continue; }
    if (statSync(pfad).size !== z.bytes) { fehler.push(`ZIP hat falsche Größe: ${z.name}`); continue; }
    if (z.sha256 && (await sha256Datei(pfad)) !== z.sha256) fehler.push(`ZIP ist verändert: ${z.name}`);
  }
  return fehler;
}
