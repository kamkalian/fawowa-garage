// E-Mail-Versand (SMTP) und die Texte der Nachrichten. Die Zugangsdaten stehen in der .env (siehe .env.example).
// Ohne SMTP_HOST und MAIL_FROM gibt es keinen Mailer: die E-Mail-Funktionen sind dann abgeschaltet und die Oberfläche blendet sie aus.

import nodemailer from 'nodemailer';

const ja = (v) => ['1', 'true', 'ja'].includes(String(v ?? '').trim().toLowerCase());

/** Mailer mit { senden({ an, betreff, text }) } oder null, wenn kein SMTP eingerichtet ist */
export function erstelleMailer(env = process.env) {
  const host = String(env.SMTP_HOST ?? '').trim();
  const von = String(env.MAIL_FROM ?? '').trim();
  if (!host || !von) return null;

  const transport = nodemailer.createTransport({
    host,
    port: Number(env.SMTP_PORT) || 587,
    secure: ja(env.SMTP_SECURE), // true für Port 465; sonst wird STARTTLS genutzt, sofern der Server es anbietet
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });

  return {
    senden: ({ an, betreff, text }) => transport.sendMail({ from: von, to: an, subject: betreff, text })
  };
}

/** Öffentliche Adresse der Anwendung für die Links in den Nachrichten (ohne Schrägstrich am Ende), sonst null */
export function oeffentlicheUrl(env = process.env) {
  const s = String(env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s"'<>#?]+$/i.test(s) && s.length <= 200 ? s : null;
}

const TEXTE = {
  de: {
    email: {
      betreff: 'FaWoWa-Garage: E-Mail-Adresse bestätigen',
      text: (link) => `Hallo,

du hast diese E-Mail-Adresse für deine FaWoWa-Garage angegeben. Bestätige sie mit diesem Link (24 Stunden gültig):

${link}

Danach kannst du dir auf der Startseite jederzeit einen neuen Zugangslink an diese Adresse schicken lassen, falls du deinen persönlichen Link verlierst.

Du warst das nicht? Dann ignoriere diese Nachricht, es passiert nichts.`
    },
    zugang: {
      betreff: 'FaWoWa-Garage: Zugang zu deiner Garage',
      text: (link) => `Hallo,

mit diesem Link kommst du wieder an deine FaWoWa-Garage (eine Stunde gültig, nur einmal nutzbar):

${link}

Beim Öffnen bekommst du einen neuen persönlichen Link. Speichere ihn als Lesezeichen. Der bisherige Link gilt danach nicht mehr.

Du hast das nicht angefordert? Dann ignoriere diese Nachricht, es passiert nichts.`
    }
  },
  en: {
    email: {
      betreff: 'FaWoWa Garage: confirm your email address',
      text: (link) => `Hello,

you entered this email address for your FaWoWa Garage. Confirm it with this link (valid for 24 hours):

${link}

After that you can always have a new access link sent to this address from the start page, in case you lose your personal link.

Was this not you? Then ignore this message, nothing will happen.`
    },
    zugang: {
      betreff: 'FaWoWa Garage: access to your garage',
      text: (link) => `Hello,

use this link to get back to your FaWoWa Garage (valid for one hour, can be used once):

${link}

When you open it you get a new personal link. Bookmark it. The previous link stops working afterwards.

You did not request this? Then ignore this message, nothing will happen.`
    }
  }
};

/** art: 'email' (Adresse bestätigen) oder 'zugang' (neuer Zugangslink) */
export function mailText(lang, art, link) {
  const t = (TEXTE[lang] ?? TEXTE.de)[art];
  return { betreff: t.betreff, text: t.text(link) };
}
