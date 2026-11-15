// Darstellung von Werten im Verwaltungsbereich (nur Deutsch)
import { pick } from '../public/lib/i18n.js';

const zahl = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export function datum(wert, mitUhrzeit = false) {
  if (!wert) return '–';
  const d = new Date(wert);
  if (Number.isNaN(d.getTime())) return '–';
  return mitUhrzeit
    ? d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString('de-DE', { dateStyle: 'medium' });
}

/** Wert eines Feldes als Text oder null, wenn nichts eingetragen ist. nachId: (art, id) => Name für Verweise */
export function feldWert(feld, eintrag, nachId) {
  const v = eintrag[feld.key];
  if (v === null || v === undefined || v === '') return null;
  if (feld.typ === 'zahl' || feld.typ === 'ganzzahl') return `${zahl.format(v)}${feld.einheit ? ' ' + feld.einheit : ''}`;
  if (feld.typ === 'auswahl') return pick(feld.optionen.find(o => o.wert === v), 'de') || String(v);
  if (feld.typ === 'verweis') return nachId(feld.verweis, v) ?? `Nr. ${v} (gelöscht)`;
  return String(v);
}
