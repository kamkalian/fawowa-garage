import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erstelleMailer, oeffentlicheUrl, mailText } from '../lib/mail.js';

test('Ohne SMTP_HOST oder MAIL_FROM gibt es keinen Mailer', () => {
  assert.equal(erstelleMailer({}), null);
  assert.equal(erstelleMailer({ SMTP_HOST: 'smtp.example.org' }), null);
  assert.equal(erstelleMailer({ MAIL_FROM: 'garage@example.org' }), null);
  assert.equal(typeof erstelleMailer({ SMTP_HOST: 'smtp.example.org', MAIL_FROM: 'Garage <garage@example.org>' }).senden, 'function');
});

test('PUBLIC_URL: nur http(s) ohne Pfad-Zusätze, Schrägstrich am Ende wird entfernt', () => {
  assert.equal(oeffentlicheUrl({ PUBLIC_URL: 'https://garage.example.org/' }), 'https://garage.example.org');
  assert.equal(oeffentlicheUrl({ PUBLIC_URL: 'https://garage.example.org' }), 'https://garage.example.org');
  for (const x of [undefined, '', 'garage.example.org', 'javascript:alert(1)', 'https://a b.de', 'https://x.de/?a=1', 'https://x.de/#a', 'ftp://x.de']) {
    assert.equal(oeffentlicheUrl({ PUBLIC_URL: x }), null, String(x));
  }
});

test('Mail-Texte: beide Sprachen, der Link steht drin, unbekannte Sprache gilt als Deutsch', () => {
  const link = 'https://garage.example.org/#zugang=abc';
  for (const art of ['email', 'zugang']) {
    const de = mailText('de', art, link);
    const en = mailText('en', art, link);
    assert.ok(de.text.includes(link) && en.text.includes(link));
    assert.notEqual(de.betreff, en.betreff);
    assert.equal(mailText('fr', art, link).betreff, de.betreff);
  }
});
