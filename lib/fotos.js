// Fotos der Stellplätze: Ablage auf dem Server (eigener Ordner, nicht im Webbereich). Nur über die Garage mit ihrem Zugangsschlüssel
// abrufbar. Der Browser verkleinert und speichert das Foto als JPEG (dabei gehen Standortangaben aus den Bilddaten verloren).
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

export const FOTO_MAX_BYTES = 2 * 1024 * 1024;
const ORDNER = process.env.FOTO_DIR ?? join(process.cwd(), 'fotos');
const ENDUNG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const NAME = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

/** Dateityp aus den ersten Bytes (nicht aus dem angegebenen Typ): JPEG, PNG oder WebP; sonst null */
export function fotoTyp(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Speichert ein Foto und liefert den Dateinamen */
export function fotoSpeichern(buf, typ) {
  mkdirSync(ORDNER, { recursive: true });
  const name = `${randomBytes(16).toString('hex')}.${ENDUNG[typ]}`;
  writeFileSync(join(ORDNER, name), buf, { mode: 0o600 });
  return name;
}

export function fotoLesen(name) {
  if (!NAME.test(name)) return null;
  return readFileSync(join(ORDNER, name));
}

export function fotoLoeschen(name) {
  if (!name || !NAME.test(name)) return;
  try { unlinkSync(join(ORDNER, name)); } catch { /* Datei fehlt schon: nichts zu tun */ }
}

/** Mime-Typ zu einem gespeicherten Dateinamen */
export function fotoMime(name) {
  return name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}
