// Upload in Teilen: die ZIP-Datei kommt in einzelnen Stücken an, jedes Stück wird sofort auf die Platte geschrieben.
// Bricht die Verbindung ab, fehlen nur die übrigen Stücke. Am Ende werden die Stücke zu einer Datei zusammengesetzt.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, createWriteStream, createReadStream, statSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';

export const TEIL_MAX_BYTES = 128 * 1024 * 1024;

// Kennung einer Hochladung: nur Kleinbuchstaben und Ziffern (kein Pfad möglich)
export const kennungGueltig = (id) => typeof id === 'string' && /^[a-z0-9]{8,40}$/.test(id);

const ordnerVon = (importOrdner, id) => join(importOrdner, 'hochladen-' + id);

/** Ein Stück speichern (Nummer nr, ab 0). Der Stream wird vollständig auf die Platte geschrieben. */
export async function teilSpeichern(importOrdner, id, nr, strom) {
  const ordner = ordnerVon(importOrdner, id);
  mkdirSync(ordner, { recursive: true });
  const ziel = join(ordner, `${nr}.teil`);
  try {
    await pipeline(strom, createWriteStream(ziel + '.tmp'));
  } catch (e) {
    rmSync(ziel + '.tmp', { force: true });
    throw e;
  }
  renameSync(ziel + '.tmp', ziel);
}

/** Welche Stücke schon angekommen sind (Nummern, aufsteigend) */
export function stueckeVorhanden(importOrdner, id) {
  const ordner = ordnerVon(importOrdner, id);
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner)
    .map((n) => /^(\d+)\.teil$/.exec(n))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

/**
 * Alle Stücke 0 … anzahl-1 zu einer Datei zusammensetzen (ziel). Fehlt ein Stück oder stimmt die Größe nicht,
 * wird nichts verändert und ein Fehler geworfen.
 */
export async function zusammensetzen(importOrdner, id, anzahl, erwarteteGroesse, ziel) {
  const ordner = ordnerVon(importOrdner, id);
  const vorhanden = new Set(stueckeVorhanden(importOrdner, id));
  for (let i = 0; i < anzahl; i++) {
    if (!vorhanden.has(i)) throw new Error(`Stück ${i + 1} von ${anzahl} fehlt`);
  }
  let groesse = 0;
  for (let i = 0; i < anzahl; i++) groesse += statSync(join(ordner, `${i}.teil`)).size;
  if (erwarteteGroesse !== undefined && groesse !== erwarteteGroesse) {
    throw new Error(`Die Größe stimmt nicht (${groesse} statt ${erwarteteGroesse} Bytes)`);
  }
  mkdirSync(join(ziel, '..'), { recursive: true });
  const tmp = ziel + '.tmp';
  await pipeline(async function* () {
    for (let i = 0; i < anzahl; i++) yield* createReadStream(join(ordner, `${i}.teil`));
  }, createWriteStream(tmp));
  renameSync(tmp, ziel);
  rmSync(ordner, { recursive: true, force: true });
  return groesse;
}

/** Eine unvollständige Hochladung verwerfen */
export function hochladenVerwerfen(importOrdner, id) {
  rmSync(ordnerVon(importOrdner, id), { recursive: true, force: true });
}
