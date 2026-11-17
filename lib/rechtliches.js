// Impressum und Datenschutzerklärung als einfache HTML-Seiten im Design der Hauptseite, auf Deutsch und Englisch (?lang=en).
// Angaben zum Betreiber kommen aus der .env (OPERATOR, OPERATOR_PERSON). Hinweis: Dies sind Vorlagen.
// Vor dem Veröffentlichen die Texte prüfen lassen.

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Nur "en" und "de" sind erlaubt, alles andere ergibt Deutsch */
export function waehleSprache(wert) {
  return wert === 'en' ? 'en' : 'de';
}

const UI = {
  de: {
    seitentitel: 'Fahrradwohnwagen-Tools',
    zurueck: 'Zur Hauptseite',
    sprache: 'Sprache',
    design: 'Hell/Dunkel umschalten',
    fehltBetreiber: 'Die Angaben zum Betreiber fehlen noch (OPERATOR in der .env).',
    bitteEintragen: 'Bitte Angaben zum Betreiber eintragen.'
  },
  en: {
    seitentitel: 'Bike trailer tools',
    zurueck: 'Back to the main page',
    sprache: 'Language',
    design: 'Toggle light/dark',
    fehltBetreiber: 'The operator details have not been entered yet (OPERATOR in the .env).',
    bitteEintragen: 'Please enter the operator details.'
  }
};

const IMPRESSUM = {
  de: {
    titel: 'Impressum',
    andere: 'Datenschutz',
    angaben: 'Angaben gemäß § 5 DDG',
    verantwortlich: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV',
    inhalteTitel: 'Haftung für Inhalte',
    inhalte: 'Die Angaben zu den Tools und Links sind mit Sorgfalt zusammengestellt. Wenn wir von einer konkreten Rechtsverletzung erfahren, entfernen wir den Inhalt unverzüglich.',
    linksTitel: 'Haftung für Links',
    links: 'Diese Seite enthält Links zu Seiten anderer Anbieter (Tools, Forum, Shop, Zahlungsdienste). Auf deren Inhalte haben wir keinen Einfluss und übernehmen dafür keine Gewähr. Verantwortlich ist immer der jeweilige Anbieter.',
    iconsTitel: 'Icons',
    icons: 'Die Icons der Tools stammen aus den jeweiligen Projekten, die Icons der Links von den verlinkten Seiten. Unterstützer werden nur mit ihrer Zustimmung genannt.'
  },
  en: {
    titel: 'Legal notice',
    andere: 'Privacy',
    angaben: 'Information according to § 5 DDG (German Digital Services Act)',
    verantwortlich: 'Responsible for the content (§ 18 (2) MStV)',
    inhalteTitel: 'Liability for content',
    inhalte: 'The information on the tools and links has been compiled with care. If we learn of a concrete violation of the law, we will remove the content without delay.',
    linksTitel: 'Liability for links',
    links: 'This site contains links to sites of other providers (tools, forum, shop, payment services). We have no influence on their content and accept no liability for it. The respective provider is always responsible.',
    iconsTitel: 'Icons',
    icons: 'The icons of the tools come from the respective projects, the icons of the links from the linked sites. Supporters are named only with their consent.'
  }
};

const DATENSCHUTZ = {
  de: {
    titel: 'Datenschutz',
    andere: 'Impressum',
    verantwortlich: 'Verantwortlich',
    besuchTitel: 'Was beim Besuch passiert',
    besuch: 'Diese Seite setzt keine Cookies und kein Tracking ein. Im Browser werden nur deine Einstellungen für Sprache und Hell/Dunkel gespeichert; sie verlassen dein Gerät nicht. Der Server verarbeitet beim Aufruf die technisch nötigen Angaben (Zeitpunkt, angeforderte Seite, Fehlermeldungen) und nutzt sie nur, um den Betrieb und die Sicherheit zu gewährleisten.',
    hintergrundTitel: 'Abfragen im Hintergrund',
    hintergrund: 'Die Liste der Unterstützer, die Icons der Tools und der Links sowie der Zahlungsstand werden vom Server abgerufen, nicht von deinem Browser. Dabei gelangt deine Adresse nicht zu GitHub oder zu den verlinkten Seiten.',
    externTitel: 'Externe Links',
    extern: 'Die Links zu Tools, Forum, Shop, Ko-fi und PayPal führen zu anderen Seiten. Dort gelten deren Datenschutzbestimmungen. Mit dem Klick verlässt du diese Seite.',
    unterstuetzerTitel: 'Unterstützer',
    unterstuetzer: 'Namen werden nur mit ausdrücklicher Zustimmung der Person angezeigt. Beträge einzelner Personen werden nie veröffentlicht.',
    rechteTitel: 'Deine Rechte',
    rechte: 'Du kannst Auskunft, Berichtigung oder Löschung der zu dir gespeicherten Daten verlangen und dich bei einer Datenschutz-Aufsichtsbehörde beschweren.'
  },
  en: {
    titel: 'Privacy',
    andere: 'Legal notice',
    verantwortlich: 'Controller',
    besuchTitel: 'What happens when you visit',
    besuch: 'This site uses no cookies and no tracking. Your browser only stores your settings for language and light/dark; they never leave your device. When you visit, the server processes the technically necessary data (time, requested page, error messages) and uses it only to keep the service running and secure.',
    hintergrundTitel: 'Requests in the background',
    hintergrund: 'The list of supporters, the icons of the tools and links, and the payment total are fetched by the server, not by your browser. Your address does not reach GitHub or the linked sites in the process.',
    externTitel: 'External links',
    extern: 'The links to tools, forum, shop, Ko-fi and PayPal lead to other sites. Their privacy policies apply there. By clicking you leave this site.',
    unterstuetzerTitel: 'Supporters',
    unterstuetzer: 'Names are shown only with the explicit consent of the person. Amounts of individual people are never published.',
    rechteTitel: 'Your rights',
    rechte: 'You can request information, correction or deletion of the data stored about you, and lodge a complaint with a data protection supervisory authority.'
  }
};

function seite({ lang, titel, inhalt, hatBetreiber, pfad, andere }) {
  const ui = UI[lang];
  const zusatz = lang === 'en' ? '?lang=en' : '';
  const knopf = (code) => `<a class="btn btn-sm ${lang === code ? 'btn-primary' : 'btn-ghost'}" href="${pfad}?lang=${code}" data-lang="${code}"${lang === code ? ' aria-current="true"' : ''}>${code.toUpperCase()}</a>`;
  return `<!DOCTYPE html>
<html lang="${lang}" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/style.css">
  <title>${esc(titel)} · ${esc(ui.seitentitel)}</title>
</head>
<body>
<header class="header">
  <div class="header-inner">
    <div>
      <h1 class="glow-text">${esc(titel)}</h1>
      <p class="header-sub"><a href="/${zusatz}">${esc(ui.zurueck)}</a><a href="${esc(andere.pfad)}${zusatz}">${esc(andere.text)}</a></p>
    </div>
    <div class="header-tools">
      <div class="lang-switch" role="group" aria-label="${esc(ui.sprache)}">${knopf('de')}${knopf('en')}</div>
      <button class="btn btn-ghost btn-icon" type="button" id="theme" title="${esc(ui.design)}" aria-label="${esc(ui.design)}"></button>
    </div>
  </div>
</header>
<main class="container page rechtlich">
  ${inhalt}
  ${hatBetreiber ? '' : `<p class="hinweis">${esc(ui.fehltBetreiber)}</p>`}
</main>
<script type="module" src="/recht.js"></script>
</body>
</html>`;
}

/** Absätze aus Text; "\n" aus der .env wird zu einem eigenen Absatz */
function zeilen(text) {
  return esc(text).split('\n').map((z) => `<p>${z}</p>`).join('');
}

const abschnitt = (titel, text) => `<h2>${esc(titel)}</h2><p>${esc(text)}</p>`;

export function impressumSeite({ betreiber, person, lang = 'de' }) {
  lang = waehleSprache(lang);
  const t = IMPRESSUM[lang];
  const inhalt = `
  <h2>${esc(t.angaben)}</h2>
  ${betreiber ? zeilen(betreiber) : `<p>${esc(UI[lang].bitteEintragen)}</p>`}
  ${person ? `<h2>${esc(t.verantwortlich)}</h2><p>${esc(person)}</p>` : ''}
  ${abschnitt(t.inhalteTitel, t.inhalte)}
  ${abschnitt(t.linksTitel, t.links)}
  ${abschnitt(t.iconsTitel, t.icons)}`;
  return seite({ lang, titel: t.titel, inhalt, hatBetreiber: !!betreiber, pfad: '/impressum', andere: { pfad: '/datenschutz', text: t.andere } });
}

export function datenschutzSeite({ betreiber, lang = 'de' }) {
  lang = waehleSprache(lang);
  const t = DATENSCHUTZ[lang];
  const inhalt = `
  <h2>${esc(t.verantwortlich)}</h2>
  ${betreiber ? zeilen(betreiber) : `<p>${esc(UI[lang].bitteEintragen)}</p>`}
  ${abschnitt(t.besuchTitel, t.besuch)}
  ${abschnitt(t.hintergrundTitel, t.hintergrund)}
  ${abschnitt(t.externTitel, t.extern)}
  ${abschnitt(t.unterstuetzerTitel, t.unterstuetzer)}
  ${abschnitt(t.rechteTitel, t.rechte)}`;
  return seite({ lang, titel: t.titel, inhalt, hatBetreiber: !!betreiber, pfad: '/datenschutz', andere: { pfad: '/impressum', text: t.andere } });
}
