// Foto vor dem Hochladen verkleinern und als JPEG speichern. Dabei gehen die Bilddaten (Standort, Kameradaten) verloren, das ist gewollt.
const MAX_SEITE = 900;

export async function verkleinern(datei) {
  const bild = await createImageBitmap(datei);
  const faktor = Math.min(1, MAX_SEITE / Math.max(bild.width, bild.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bild.width * faktor));
  c.height = Math.max(1, Math.round(bild.height * faktor));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bild, 0, 0, c.width, c.height);
  bild.close?.();
  const blob = await new Promise((ok, fehler) => c.toBlob(b => (b ? ok(b) : fehler(new Error('foto'))), 'image/jpeg', 0.85));
  return blob;
}
