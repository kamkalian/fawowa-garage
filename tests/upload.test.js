// Upload in Teilen: Stücke speichern, fehlende erkennen, zusammensetzen und die Größe prüfen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { teilSpeichern, stueckeVorhanden, zusammensetzen, kennungGueltig } from '../lib/upload.js';
import { platzStand, ordnerGroesse } from '../lib/platz.js';

const ID = 'abc123xyz9';

test('Upload in Teilen: Stücke landen, fehlende werden gemeldet, zusammengesetzt wird in Reihenfolge', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'garage-upl-'));
  await teilSpeichern(dir, ID, 1, Readable.from([Buffer.from('BBB')]));
  await teilSpeichern(dir, ID, 0, Readable.from([Buffer.from('AA')]));
  assert.deepEqual(stueckeVorhanden(dir, ID), [0, 1]);
  await assert.rejects(zusammensetzen(dir, ID, 3, undefined, join(dir, 'x.zip')), /Stück 3 von 3 fehlt/);
  await teilSpeichern(dir, ID, 2, Readable.from([Buffer.from('C')]));
  const ziel = join(dir, 'wegenetz.zip');
  const groesse = await zusammensetzen(dir, ID, 3, 6, ziel);
  assert.equal(groesse, 6);
  assert.equal(readFileSync(ziel, 'utf8'), 'AABBBC');
  assert.equal(existsSync(join(dir, 'hochladen-' + ID)), false, 'Teile werden danach entfernt');
});

test('Upload in Teilen: falsche Größe wird abgelehnt, nichts entsteht', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'garage-upl-'));
  await teilSpeichern(dir, ID, 0, Readable.from([Buffer.from('XYZ')]));
  const ziel = join(dir, 'wegenetz.zip');
  await assert.rejects(zusammensetzen(dir, ID, 1, 99, ziel), /Größe stimmt nicht/);
  assert.equal(existsSync(ziel), false);
});

test('Kennungen: nur Kleinbuchstaben und Ziffern, kein Pfad', () => {
  assert.equal(kennungGueltig('abc123xyz9'), true);
  assert.equal(kennungGueltig('../etc'), false);
  assert.equal(kennungGueltig('ABC'), false);
});

test('Platz: Größe eines Ordners und freier Platz', () => {
  const dir = mkdtempSync(join(tmpdir(), 'garage-platz-'));
  mkdirSync(join(dir, 'roh'));
  writeFileSync(join(dir, 'roh', 'a.bin'), Buffer.alloc(1000));
  assert.equal(ordnerGroesse(join(dir, 'roh')), 1000);
  assert.equal(ordnerGroesse(join(dir, 'fehlt')), 0);
  const stand = platzStand({ NETZ_DIR: join(dir, 'netz') });
  assert.ok(stand.frei === null || stand.frei > 0);
  assert.ok(stand.ordner.some((o) => o.name === 'roh'));
});
