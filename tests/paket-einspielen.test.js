// Einspielen von Paketen (fawowa-paket-1): ein kleines Testpaket wird gebaut, eingespielt und bei Fehlern abgelehnt.
// Die alten Daten bleiben bei jedem Fehler unverändert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync, createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import archiver from 'archiver';
import { paketEinspielen, paketZusammensetzen, paketPruefen, paketInhaltPruefen, standLesen } from '../lib/paket-einspielen.js';
import { paketeSuchen } from '../lib/paket-waechter.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');

/** ZIP ohne Komprimierung (Store) mit den Einträgen erzeugen */
function zipSchreiben(pfad, eintraege) {
  return new Promise((aufloesen, ablehnen) => {
    const out = createWriteStream(pfad);
    const z = archiver('zip', { store: true });
    out.on('close', aufloesen);
    z.on('error', ablehnen);
    z.pipe(out);
    for (const [name, inhalt] of eintraege) z.append(inhalt, { name });
    z.finalize();
  });
}

/**
 * Ein Testpaket im Ordner <wurzel>/<art>-<version>/ bauen: je Datei ein Stück in einer ZIP. Liefert den Paketordner.
 * eingriff: optionale Veränderung des Manifests (z. B. falsche Prüfsumme).
 */
async function paketBauen(wurzel, art, version, dateien, { eingriff } = {}) {
  const name = `${art}-${version}`;
  const ordner = join(wurzel, name);
  mkdirSync(ordner, { recursive: true });
  const zipName = `${name}.teil-001-von-001.zip`;
  const eintraege = [];
  const dateiListe = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    const eintrag = pfad + '.000';
    eintraege.push([eintrag, inhalt]);
    dateiListe.push({
      pfad, bytes: inhalt.length, sha256: sha(inhalt),
      stuecke: [{ zip: zipName, eintrag, offset: 0, bytes: inhalt.length, sha256: sha(inhalt) }]
    });
  }
  await zipSchreiben(join(ordner, zipName), eintraege);
  const zipBytes = readFileSync(join(ordner, zipName));
  const m = {
    format: 'fawowa-paket-1', art, version, erzeugt: new Date().toISOString(), quelle: { osm: 'test' },
    zips: [{ name: zipName, bytes: zipBytes.length, sha256: sha(zipBytes) }],
    dateien: dateiListe
  };
  if (eingriff) eingriff(m);
  writeFileSync(join(ordner, `${name}.manifest.json`), JSON.stringify(m, null, 2));
  return ordner;
}

const infoJson = (bbox = [6.0, 50.0, 7.0, 51.0]) => Buffer.from(JSON.stringify({ bbox }));
const netzDateien = (bbox) => ({ 'info.json': infoJson(bbox), 'karte/pts.i32': Buffer.alloc(16, 1) });

/** Ein PMTiles-Kopf: Magic „PMTiles“, Version 3, dann Platz */
function pmtiles(version = 3, magic = 'PMTiles') {
  const b = Buffer.alloc(127);
  b.write(magic, 0, 'latin1');
  b[7] = version;
  return b;
}

function ordnerMitInhalt(inhalt) {
  const d = mkdtempSync(join(tmpdir(), 'paket-test-'));
  for (const [n, b] of Object.entries(inhalt)) {
    mkdirSync(join(d, n, '..'), { recursive: true });
    writeFileSync(join(d, n), b);
  }
  return d;
}

function aufraeumen(...ordner) {
  for (const o of ordner) rmSync(o, { recursive: true, force: true });
}

test('Netzpaket wird eingespielt: alte Dateien weg, neue da, Paketordner gelöscht, Stand geschrieben', async () => {
  const wurzel = mkdtempSync(join(tmpdir(), 'paket-'));
  const netz = join(wurzel, 'netz'); const karte = join(wurzel, 'karte'); const imp = join(wurzel, 'import');
  mkdirSync(netz); writeFileSync(join(netz, 'alt.txt'), 'alt');
  const paket = await paketBauen(imp, 'netz', '2026-11-18T0815', netzDateien([6, 50, 7, 51]));
  const e = await paketEinspielen({ paketOrdner: paket, netzDir: netz, karteDir: karte, importOrdner: imp });
  assert.equal(e.art, 'netz');
  assert.ok(existsSync(join(netz, 'info.json')));
  assert.ok(existsSync(join(netz, 'karte', 'pts.i32')));
  assert.ok(!existsSync(join(netz, 'alt.txt')), 'alte Datei muss weg sein');
  assert.ok(!existsSync(join(netz, '.neu')) && !existsSync(join(netz, '.alt')), 'keine Zwischenordner übrig');
  assert.ok(!existsSync(paket), 'Paketordner wird nach dem Einspielen gelöscht');
  assert.equal(standLesen(imp).stand.netz.version, '2026-11-18T0815');
  aufraeumen(wurzel);
});

test('Kartenpaket ersetzt nur germany.pmtiles, das Netz bleibt', async () => {
  const wurzel = mkdtempSync(join(tmpdir(), 'paket-'));
  const netz = join(wurzel, 'netz'); const karte = join(wurzel, 'karte'); const imp = join(wurzel, 'import');
  mkdirSync(netz); writeFileSync(join(netz, 'info.json'), infoJson());
  mkdirSync(karte); writeFileSync(join(karte, 'germany.pmtiles'), pmtiles());
  // Eine neue Karte mit anderem Inhalt, damit man den Tausch sieht
  const neu = Buffer.concat([pmtiles(3), Buffer.alloc(50, 7)]);
  const paket2 = await paketBauen(imp, 'karte', '2026-11-18T0900', { 'germany.pmtiles': neu });
  await paketEinspielen({ paketOrdner: paket2, netzDir: netz, karteDir: karte, importOrdner: imp });
  assert.deepEqual(readFileSync(join(karte, 'germany.pmtiles')), neu);
  assert.ok(existsSync(join(netz, 'info.json')), 'das Netz bleibt unberührt');
  aufraeumen(wurzel);
});

test('fehlende ZIP: Fehler, alte Daten bleiben', async () => {
  const wurzel = mkdtempSync(join(tmpdir(), 'paket-'));
  const netz = join(wurzel, 'netz'); const imp = join(wurzel, 'import');
  mkdirSync(netz); writeFileSync(join(netz, 'info.json'), infoJson());
  const paket = await paketBauen(imp, 'netz', '2026-11-18T0815', netzDateien());
  rmSync(join(paket, 'netz-2026-11-18T0815.teil-001-von-001.zip'));
  await assert.rejects(paketEinspielen({ paketOrdner: paket, netzDir: netz, karteDir: join(wurzel, 'karte'), importOrdner: imp }), /fehlt|unvollständig/);
  assert.equal(readFileSync(join(netz, 'info.json'), 'utf8'), infoJson().toString());
  aufraeumen(wurzel);
});

test('manipulierte ZIP (Prüfsumme stimmt nicht): Fehler, alte Daten bleiben', async () => {
  const wurzel = mkdtempSync(join(tmpdir(), 'paket-'));
  const netz = join(wurzel, 'netz'); const imp = join(wurzel, 'import');
  mkdirSync(netz); writeFileSync(join(netz, 'info.json'), infoJson());
  const paket = await paketBauen(imp, 'netz', '2026-11-18T0815', netzDateien());
  const zipPfad = join(paket, 'netz-2026-11-18T0815.teil-001-von-001.zip');
  const b = readFileSync(zipPfad);
  b[b.length - 30] ^= 0xff; // ein Byte im Inhalt verändern
  writeFileSync(zipPfad, b);
  await assert.rejects(paketEinspielen({ paketOrdner: paket, netzDir: netz, karteDir: join(wurzel, 'karte'), importOrdner: imp }), /verändert|unvollständig|Prüfsumme|Stück/);
  assert.equal(readFileSync(join(netz, 'info.json'), 'utf8'), infoJson().toString());
  assert.ok(existsSync(paket), 'der Paketordner bleibt bei einem Fehler erhalten');
  aufraeumen(wurzel);
});

test('falsche Prüfsumme eines Stücks: Fehler, kein .neu übrig', async () => {
  const wurzel = mkdtempSync(join(tmpdir(), 'paket-'));
  const imp = join(wurzel, 'import'); const netz = join(wurzel, 'netz');
  mkdirSync(netz);
  const paket = await paketBauen(imp, 'netz', '2026-11-18T0815', netzDateien(), {
    eingriff: (m) => { m.dateien[0].stuecke[0].sha256 = '0'.repeat(64); }
  });
  await assert.rejects(paketZusammensetzen(
    JSON.parse(readFileSync(join(paket, 'netz-2026-11-18T0815.manifest.json'), 'utf8')), paket, netz), /Prüfsumme/);
  assert.ok(!existsSync(join(netz, '.neu')));
  aufraeumen(wurzel);
});

test('Pfad mit „..“ im Manifest wird abgelehnt', async () => {
  const wurzel = mkdtempSync(join(tmpdir(), 'paket-'));
  const paket = await paketBauen(join(wurzel, 'import'), 'netz', '2026-11-18T0815', netzDateien(), {
    eingriff: (m) => { m.dateien[0].pfad = '../ausserhalb.json'; }
  });
  await assert.rejects(paketPruefen(paket), /ungültig/);
  aufraeumen(wurzel);
});

test('Karte mit falschem PMTiles-Kopf wird abgelehnt, alte Karte bleibt', async () => {
  const wurzel = mkdtempSync(join(tmpdir(), 'paket-'));
  const karte = join(wurzel, 'karte'); const imp = join(wurzel, 'import');
  mkdirSync(karte); writeFileSync(join(karte, 'germany.pmtiles'), pmtiles(3));
  const paket = await paketBauen(imp, 'karte', '2026-11-18T0900', { 'germany.pmtiles': pmtiles(2) });
  await assert.rejects(paketEinspielen({ paketOrdner: paket, netzDir: join(wurzel, 'netz'), karteDir: karte, importOrdner: imp }), /PMTiles/);
  assert.deepEqual(readFileSync(join(karte, 'germany.pmtiles')), pmtiles(3));
  assert.ok(!existsSync(join(karte, '.neu')));
  aufraeumen(wurzel);
});

test('Netzpaket ohne bbox wird abgelehnt', async () => {
  const wurzel = mkdtempSync(join(tmpdir(), 'paket-'));
  const imp = join(wurzel, 'import'); const netz = join(wurzel, 'netz');
  mkdirSync(netz); writeFileSync(join(netz, 'info.json'), infoJson());
  const paket = await paketBauen(imp, 'netz', '2026-11-18T0815', { 'info.json': Buffer.from('{}'), 'karte/pts.i32': Buffer.alloc(4) });
  await assert.rejects(paketEinspielen({ paketOrdner: paket, netzDir: netz, karteDir: join(wurzel, 'karte'), importOrdner: imp }), /bbox/);
  assert.equal(readFileSync(join(netz, 'info.json'), 'utf8'), infoJson().toString());
  aufraeumen(wurzel);
});

test('paketInhaltPruefen: Netz ohne Karte-Datei wird abgelehnt', () => {
  const d = ordnerMitInhalt({ 'info.json': infoJson() });
  assert.throws(() => paketInhaltPruefen('netz', d), /karte\/pts/);
  aufraeumen(d);
});

test('Wächter: fertige Pakete bekommen je einen Auftrag, halbfertige .hochladen-Ordner werden ignoriert, kein Doppel', async () => {
  const wurzel = mkdtempSync(join(tmpdir(), 'paket-'));
  const imp = join(wurzel, 'import');
  await paketBauen(imp, 'netz', '2026-11-18T0815', netzDateien());
  // Halbfertiger Upload: Ordner endet auf .hochladen und hat noch kein Manifest
  mkdirSync(join(imp, 'karte-2026-11-18T0900.hochladen'), { recursive: true });
  writeFileSync(join(imp, 'karte-2026-11-18T0900.hochladen', 'x.zip'), 'teil');

  const angelegt = [];
  const jobs = {
    async paketAnlegen(ordner, opts) {
      // dasselbe Verhalten wie lib/jobs.js: automatisch kein zweiter Auftrag, solange der letzte wartet
      if (angelegt.includes(ordner)) return null;
      angelegt.push(ordner);
      return angelegt.length;
    }
  };
  assert.deepEqual(await paketeSuchen(imp, jobs), ['netz-2026-11-18T0815']);
  assert.deepEqual(await paketeSuchen(imp, jobs), [], 'zweiter Lauf legt keinen zweiten Auftrag an');
  assert.deepEqual(angelegt, ['netz-2026-11-18T0815']);
  aufraeumen(wurzel);
});

test('Datenordner ohne Pakete: Wächter tut nichts', async () => {
  const wurzel = mkdtempSync(join(tmpdir(), 'paket-'));
  assert.deepEqual(await paketeSuchen(join(wurzel, 'gibt-es-nicht'), { paketAnlegen: async () => 1 }), []);
  assert.deepEqual(readdirSync(wurzel), []);
  aufraeumen(wurzel);
});
