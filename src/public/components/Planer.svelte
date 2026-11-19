<script>
  import { onMount, untrack } from 'svelte';
  import { EINSTELLUNGEN_GRENZEN, ANNAHMEN, hatMotor } from '../../../lib/rechenmodell.js';
  import { t, zahlText } from '../lib/i18n.js';
  import * as api from '../lib/api.js';
  import { Karte, grenzeAusPunkten } from '../lib/karte.js';
  import { gespannFuerRechnung } from '../../../lib/gespann.js';
  import Fenster from './Fenster.svelte';
  import InfoRechnung from './InfoRechnung.svelte';

  // Reichweiten-Planer als Vollbild-Seite: die Karte füllt den Bildschirm, Suche, Filter und Ergebnis liegen darüber.
  // Die Rechnung läuft auf dem Server mit dem Gespann der Garage.
  let { lang, token, daten, einst, offen = false, zurueck } = $props();

  const cfg = $derived(einst.reichweite);
  const WIND = [['N', 0], ['NO', 45], ['O', 90], ['SO', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
  const SONNE = [0, 150, 400, 800];
  // Fahrt: gemütlich oder sportlich. Die Unterstützung und die Höchstleistung des Fahrers folgen daraus (ohne Motor nur die Höchstleistung).
  const STIL = {
    gemuetlich: { unterstuetzung: 'eco', geschwindigkeit_kmh: 16, eigenleistung_max_w: 150 },
    sportlich: { unterstuetzung: 'sport', geschwindigkeit_kmh: 22, eigenleistung_max_w: 250 }
  };

  // Alle Zugfahrzeuge und Anhänger im Gespann, zusammengefasst für die Rechnung
  const kombi = $derived(gespannFuerRechnung(daten.fahrraeder, daten.anhaenger, daten.mitglieder));
  const rad = $derived(kombi.fahrrad);
  const wagen = $derived(kombi.anhaenger);
  const motor = $derived(hatMotor(rad));
  const mitZusatzakku = $derived((rad?.zusatzakku_wh ?? 0) > 0 || (wagen?.zusatzakku_wh ?? 0) > 0);
  // Ersatzakku: ein Akku am Zugfahrzeug (zusätzlich zum Hauptakku). Ein Akku am Anhänger hat einen eigenen Füllstand.
  const zusatzRad = $derived((rad?.zusatzakku_wh ?? 0) > 0);
  // Hauptakku am Fahrrad. Fehlt er (der einzige Akku steckt im Anhänger), gibt es nur einen Füllstand-Regler.
  const hauptAkku = $derived((rad?.akku_kapazitaet_wh ?? 0) > 0);
  // Ein Füllstand je Akku im Gespann (Fahrrad und Anhänger)
  const akkuListe = $derived([...(rad?.akkuListe ?? []), ...(wagen?.akkuListe ?? [])]);
  function standSetzen(key, wert) { e.akku_staende = { ...(e.akku_staende ?? {}), [key]: wert }; }
  const mitSolar = $derived((wagen?.solar_wp ?? 0) > 0);
  const kapazitaet = $derived((rad?.akku_kapazitaet_wh ?? 0) + (rad?.zusatzakku_wh ?? 0) + (wagen?.zusatzakku_wh ?? 0));

  // Ohne Motor gibt es keinen Akku: dann wird nur nach Fahrtzeit gerechnet
  let wahlAkku = $state(true);
  const nachAkku = $derived(motor && wahlAkku);
  const voraussetzung = $derived(!rad ? 'fahrrad_fehlt' : (nachAkku && kapazitaet <= 0) ? 'akku_fehlt' : null);

  let stil = $state('gemuetlich');
  let e = $state({
    akku_rest_prozent: 100, zusatz_rest_prozent: null, fahrtzeit_h: 3, reserve_prozent: 5, akku_staende: {}, eigenleistung_modus: 'entspannt',
    ...STIL.gemuetlich,
    wind_ms: 0, wind_richtung_grad: 270, einstrahlung_w_m2: 0, temperatur_c: 15, hoehe_m: 100, oberflaeche: 1
  });
  let modus = $state('alle');
  let weitere = $state(false);
  let filterOffen = $state(true);

  /** Fahrt setzen (gemütlich oder sportlich) */
  function stilSetzen(name) {
    stil = name;
    Object.assign(e, STIL[name]);
  }

  // ---------- Zustand ----------
  let leinwand;
  let karte = null;
  let zoomStand = $state(null); // aktuelle Zoomstufe der Karte, für die Anzeige
  let orte = $state([]);
  let start = $state(null);
  let suche = $state('');
  let suchOffen = $state(false);
  let rechnet = $state(false);
  let auftrag = $state(null);
  let ergebnis = $state(null);
  let routenAn = $state(false);   // Schalter: Routen zeichnen
  let punkteAn = $state(false);   // Schalter: 1-km-Punkte zeichnen
  let heatAn = $state(true);     // Schalter: Heatmap zeichnen
  let grenzeAn = $state(false);  // Schalter: Grenze um den Bereich zeichnen
  let routen = $state(null);      // { linien, schritte } der letzten Berechnung, einmal geladen
  let routenFehlen = $state(false);
  let letzterLauf = $state(null); // Zeitpunkt des angezeigten Ergebnisses (Ende der Berechnung)
  let schrittIdx = $state(2); // Rasterabstand: 0,5 / 1 / 2 km
  const SCHRITTE = [{ km: 0.5, label: '0,5 km' }, { km: 1, label: '1 km' }, { km: 2, label: '2 km' }];
  const LAUF_SCHRITTE = ['Wegenetz laden', 'Suche vom Start aus', 'Punkte im Raster festlegen', 'Routen berechnen', 'Heatmap berechnen'];
  // Welcher Schritt läuft, aus der Meldung des Servers
  function laufSchritt(phase) {
    const i = LAUF_SCHRITTE.findIndex((s) => (phase ?? '').startsWith(s));
    return i < 0 ? 0 : i;
  }
  // Maßstab für die Zoomstufe: eine runde Länge, die etwa 120 Pixel breit ist (512-Pixel-Kacheln)
  function berechneMassstab(zoom, breite) {
    const mProPx = (78271.517 * Math.cos((breite * Math.PI) / 180)) / Math.pow(2, zoom);
    let best = 10;
    for (const m of [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]) if (m / mProPx <= 120) best = m;
    return { px: Math.round(best / mProPx), label: best >= 1000 ? `${best / 1000} km` : `${best} m` };
  }
  // Infofenster über die Berechnung
  let infoOffen = $state(false);

  // Einstellungen im Profil der Garage: beim Öffnen laden, nach jeder Änderung kurz verzögert speichern
  let planerBereit = false;
  function planerAnwenden(p) {
    if (!p) return;
    if (p.stil === 'sportlich' || p.stil === 'gemuetlich') stil = p.stil;
    if (cfg.modi.includes(p.modus)) modus = p.modus;
    wahlAkku = p.wahlAkku !== false;
    schrittIdx = [0, 1, 2].includes(p.schrittIdx) ? p.schrittIdx : 2;
    weitere = p.weitere === true;
    if (p.e) Object.assign(e, p.e);
  }
  $effect(() => {
    const snap = { stil, modus, wahlAkku, schrittIdx, weitere, e: { ...e } };
    if (!planerBereit || !token) return;
    const t = setTimeout(() => api.planerSetzen(token, snap).catch(() => {}), 600);
    return () => clearTimeout(t);
  });

  const zeitText = (z) => new Date(z).toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'short', timeStyle: 'short' });
  const massstab = $derived(zoomStand === null ? null : berechneMassstab(zoomStand, start?.lat ?? 51));
  const budgetText = $derived(nachAkku ? (ergebnis?.budget.art === 'akku' ? `${zahlText(lang, ergebnis.budget.wert)} Wh` : '') : `${zahlText(lang, e.fahrtzeit_h)} h`);
  let meldungFehler = $state('');
  let zaehler = 0;

  const treffer = $derived.by(() => {
    const s = suche.trim().toLowerCase();
    if (s.length < 2) return [];
    const rang = { city: 0, town: 1, suburb: 2, village: 3 };
    return orte.filter(o => o[0].toLowerCase().includes(s))
      .sort((a, b) => (a[0].toLowerCase().startsWith(s) ? 0 : 1) - (b[0].toLowerCase().startsWith(s) ? 0 : 1) || rang[a[1]] - rang[b[1]] || a[0].localeCompare(b[0]))
      .slice(0, 8);
  });

  const innerhalb = (lat, lon) => lat >= cfg.bbox.minLat && lat <= cfg.bbox.maxLat && lon >= cfg.bbox.minLon && lon <= cfg.bbox.maxLon;
  const fehlerText = (code) => {
    const text = t(lang, code ? `e_${code}` : 'e_allgemein');
    return text.startsWith('e_') ? t(lang, 'e_allgemein') : text;
  };

  function setzeStart(lat, lon, zentrieren = false) {
    if (!innerhalb(lat, lon)) { meldungFehler = fehlerText('ausserhalb'); return; }
    meldungFehler = '';
    start = { lat, lon };
    karte?.setzeStart(lat, lon);
    if (zentrieren) karte?.zentrieren(lat, lon, Math.max(karte.zoom, 11));
  }

  function ortWaehlen(o) {
    suche = '';
    suchOffen = false;
    setzeStart(o[2], o[3], true);
  }

  function standort() {
    if (!navigator.geolocation) { meldungFehler = t(lang, 'geoNicht'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setzeStart(p.coords.latitude, p.coords.longitude, true),
      () => { meldungFehler = t(lang, 'geoVerweigert'); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  // ---------- Berechnen ----------
  function einstellungen() {
    const r = { ...e, budget_art: nachAkku ? 'akku' : 'zeit', unterstuetzung: motor ? STIL[stil].unterstuetzung : 'aus' };
    if (r.budget_art === 'akku') delete r.fahrtzeit_h;
    else { delete r.akku_rest_prozent; delete r.zusatz_rest_prozent; delete r.reserve_prozent; }
    if (!mitZusatzakku || !hauptAkku || r.zusatz_rest_prozent === null) delete r.zusatz_rest_prozent;
    if (!mitSolar) r.einstrahlung_w_m2 = 0;
    for (const k of Object.keys(r)) if (typeof r[k] === 'number' && !Number.isFinite(r[k])) delete r[k];
    return r;
  }

  // Die Berechnung läuft im Hintergrund (Warteschlange des Workers): nach dem Start den Stand abfragen, bis das Ergebnis da ist
  const pause = (ms) => new Promise(r => setTimeout(r, ms));

  // Heatmap, Routen, 1-km-Punkte und Grenze: nur laden, wenn ein Schalter an ist
  async function zeigeRoutenNeu() {
    if (!karte) return;
    karte.setzeRaster(heatAn && ergebnis ? ergebnis.raster : null);
    if (!routenAn && !punkteAn && !grenzeAn) { karte.setzeRouten(null); karte.setzePunkte(null); karte.setzeGrenze(null); return; }
    if (!routen) routen = await api.reichweiteRouten(token);
    routenFehlen = !routen.linien;
    karte.setzeRouten(routenAn && routen.linien ? routen.linien : null);
    karte.setzePunkte(punkteAn && routen.schritte ? routen.schritte : null);
    karte.setzeGrenze(grenzeAn && routen.schritte && start ? grenzeAusPunkten(routen.schritte, start) : null);
  }

  // Ergebnis anzeigen (Raster auf der Karte, Startpunkt)
  function zeigeErgebnis(r, anpassen, zeitpunkt = null) {
    auftrag = null;
    ergebnis = r;
    letzterLauf = zeitpunkt;
    if (!start) start = { lat: r.start.lat, lon: r.start.lon };
    routen = null;
    routenFehlen = false;
    karte.setzeRouten(null);
    karte.setzePunkte(null);
    zeigeRoutenNeu().catch(() => {});
    karte.setzeRaster(heatAn ? r.raster : null);
    karte.setzeStart(r.start.lat, r.start.lon);
    if (anpassen) {
      const R = r.raster;
      karte.zeigeRechteck(R.lat0, R.lon0, R.lat0 + R.ny * R.dLat, R.lon0 + R.nx * R.dLon);
    }
  }

  // Stand des Auftrags der Garage abfragen, bis das Ergebnis da ist oder ein Fehler gemeldet wird.
  // Die Berechnung läuft im Worker weiter, auch wenn die Seite geschlossen wird; beim Öffnen kommt man hierher zurück.
  async function verfolgen(nr, anpassen) {
    for (;;) {
      if (nr !== zaehler) return;
      const s = await api.reichweiteStand(token);
      if (nr !== zaehler) return;
      if (s.status === 'fertig' && s.ergebnis) { zeigeErgebnis(s.ergebnis, anpassen, s.zeitpunkt); return; }
      if (s.status === 'fehler') {
        auftrag = { status: 'fehler', code: s.meldung };
        ergebnis = null;
        karte.setzeRaster(null);
        return;
      }
      if (s.status === 'wartet' || s.status === 'laeuft') {
        auftrag = { status: s.status, davor: s.davor, phase: s.phase, fortschritt: s.fortschritt };
        await pause(500);
        continue;
      }
      auftrag = null;
      return;
    }
  }

  async function berechnen(anpassen = true) {
    if (!start || voraussetzung) return;
    const nr = ++zaehler;
    rechnet = true;
    meldungFehler = '';
    try {
      const angenommen = await api.reichweiteBerechnen(token, { lat: start.lat, lon: start.lon, modus, einstellungen: einstellungen(), schritt_km: SCHRITTE[schrittIdx].km });
      if (nr !== zaehler) return;
      auftrag = { status: 'wartet', davor: angenommen.davor };
      await verfolgen(nr, anpassen);
    } catch (err) {
      if (nr !== zaehler) return;
      auftrag = null;
      ergebnis = null;
      karte.setzeRaster(null);
      meldungFehler = err.felder ? t(lang, 'e_eingabe') : fehlerText(err.code);
    } finally {
      if (nr === zaehler) rechnet = false;
    }
  }

  // ---------- Karte ----------
  onMount(() => {
    karte = new Karte(leinwand, {
      bbox: cfg.bbox, zoom: cfg.zoom, orte: [],
      quelle: t(lang, 'kartenQuelle'),
      beiKlick: (lat, lon) => setzeStart(lat, lon),
      beiZoom: (z) => { zoomStand = z; }
    });
    zoomStand = karte.zoom;
    // Der Planer öffnet sich beim Laden gleich: die Karte passt ihre Größe danach an, wenn der Container sichtbar ist
    requestAnimationFrame(() => karte?.groesse());
    api.karteOrte().then((o) => { orte = o; karte.opt.orte = o; karte.zeichnen(); }).catch(() => {});
    // Lief schon eine Berechnung (auch aus einer früheren Sitzung), wird ihr Stand hier angezeigt
    if (token) api.planerLesen(token).then(planerAnwenden).catch(() => {}).finally(() => { planerBereit = true; });
    if (token && cfg.bbox) { const nr = ++zaehler; verfolgen(nr, false).catch(() => {}); }
    return () => { karte.beenden(); };
  });

  // Solange die Seite offen ist: Größe der Karte anpassen, Seite nicht scrollen, Escape schließt
  $effect(() => {
    if (!offen) return;
    filterOffen = window.innerWidth >= 640; // auf Handys startet der Filter eingeklappt
    karte?.groesse();
    document.documentElement.classList.add('planer-offen');
    const esc = (ev) => { if (ev.key === 'Escape') zurueck?.(); };
    window.addEventListener('keydown', esc);
    return () => {
      document.documentElement.classList.remove('planer-offen');
      window.removeEventListener('keydown', esc);
    };
  });
  $effect(() => { if (karte) { karte.opt.quelle = t(lang, 'kartenQuelle'); karte.zeichnen(); } });

  const annahmeText = (k) => {
    const w = { fahrer_gewicht_kg: ANNAHMEN.fahrer_gewicht_kg, gewicht_kg: ANNAHMEN.fahrrad_gewicht_kg, leergewicht_kg: ANNAHMEN.anhaenger_leergewicht_kg,
      motor_nennleistung_w: ANNAHMEN.motor_nennleistung_w, anhaenger_flaeche: ANNAHMEN.anhaenger_flaeche_m2 }[k];
    return t(lang, `assume_${k}`, w ?? '');
  };
  const windKmh = $derived(Math.round(e.wind_ms * 3.6));
</script>

<div class="vollbild" hidden={!offen} role="dialog" aria-modal="true" aria-label={t(lang, 'tabPlaner')}>
  <div class="karten-flaeche" bind:this={leinwand} role="region" aria-label={t(lang, 'p_kartenName')}></div>

  <header class="kopfleiste">
    <button type="button" class="btn btn-outline btn-sm" onclick={() => zurueck?.()}>← {t(lang, 'p_zurueckGarage')}</button>
    <div class="suchfeld">
      <label class="sr" for="p-suche">{t(lang, 'p_ort')}</label>
      <input id="p-suche" class="input" type="search" autocomplete="off" role="combobox" aria-expanded={suchOffen && treffer.length > 0} aria-controls="p-treffer"
        placeholder={t(lang, 'p_ortHinweis')} bind:value={suche} oninput={() => (suchOffen = true)} onblur={() => setTimeout(() => (suchOffen = false), 150)}
        onkeydown={(ev) => { if (ev.key === 'Enter' && treffer.length) { ev.preventDefault(); ortWaehlen(treffer[0]); } else if (ev.key === 'Escape') suchOffen = false; }} />
      {#if suchOffen && treffer.length}
        <ul id="p-treffer" class="treffer" role="listbox">
          {#each treffer as o (o[0] + o[2] + o[3])}
            <li role="option" aria-selected="false"><button type="button" onmousedown={(ev) => ev.preventDefault()} onclick={() => ortWaehlen(o)}>{o[0]} <span class="art">{t(lang, `ort_${o[1]}`)}</span></button></li>
          {/each}
        </ul>
      {/if}
    </div>
  </header>

  <div class="zoomknoepfe">
    <button type="button" class="karte-karte btn-icon" aria-label={t(lang, 'p_zoomIn')} onclick={() => karte?.zoomen(1.6)}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg></button>
    <button type="button" class="karte-karte btn-icon" aria-label={t(lang, 'p_zoomOut')} onclick={() => karte?.zoomen(1 / 1.6)}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg></button>
  </div>
  <span class="zoomanzeige" aria-live="polite">Zoom {zoomStand === null ? '–' : zoomStand.toFixed(1)}</span>

  <aside class="karte-karte filter">
    <button type="button" class="filter-kopf" aria-expanded={filterOffen} aria-controls="planer-filter" onclick={() => (filterOffen = !filterOffen)}>
      {t(lang, 'p_einstellungen')} <span aria-hidden="true">{filterOffen ? '−' : '+'}</span>
    </button>
    {#if filterOffen}
      <form id="planer-filter" class="filter-inhalt" onsubmit={(ev) => { ev.preventDefault(); berechnen(true); }} novalidate>
        <fieldset>
          <legend>{t(lang, 'p_start')}</legend>
          <div class="zeile">
            <button type="button" class="btn btn-outline btn-sm" onclick={standort}>{t(lang, 'p_standort')}</button>
          </div>
          <span class="notiz">{start ? `${start.lat.toFixed(4)}, ${start.lon.toFixed(4)}` : t(lang, 'p_startKlick')}</span>
        </fieldset>

        <fieldset>
          <legend>{t(lang, 'p_wege')}</legend>
          <select class="input" aria-label={t(lang, 'p_wege')} bind:value={modus}>
            {#each cfg.modi as m (m)}<option value={m}>{t(lang, `modus_${m}`)}</option>{/each}
          </select>
          <p class="notiz">{t(lang, `modusHinweis_${modus}`)}</p>
        </fieldset>

        <fieldset>
          <legend>{t(lang, 'p_berechnenNach')}</legend>
          <div class="gruppe" role="radiogroup" aria-label={t(lang, 'p_berechnenNach')}>
            <button type="button" role="radio" class="wahl" aria-checked={nachAkku} disabled={!motor} onclick={() => (wahlAkku = true)}>{t(lang, 'p_nachAkku')}</button>
            <button type="button" role="radio" class="wahl" aria-checked={!nachAkku} onclick={() => (wahlAkku = false)}>{t(lang, 'p_nachZeit')}</button>
          </div>
          {#if !motor}<p class="notiz">{t(lang, 'p_ohneMotorHinweis')}</p>{/if}

          {#if nachAkku}
            {#each akkuListe as a (a.key)}
              <label for="p-akku-{a.key}">{a.name} · {t(lang, 'p_akkuNr', a.nummer)}: <strong>{e.akku_staende?.[a.key] ?? e.akku_rest_prozent} %</strong></label>
              <input id="p-akku-{a.key}" type="range" min="0" max="100" step="1" value={e.akku_staende?.[a.key] ?? e.akku_rest_prozent} oninput={(ev) => standSetzen(a.key, Number(ev.currentTarget.value))} />
            {/each}
          {:else}
            <label for="p-zeit">{t(lang, 'p_fahrtzeit')}: <strong>{zahlText(lang, e.fahrtzeit_h)} h</strong></label>
            <input id="p-zeit" type="range" min={EINSTELLUNGEN_GRENZEN.fahrtzeit_h[0]} max={EINSTELLUNGEN_GRENZEN.fahrtzeit_h[1]} step="0.5" bind:value={e.fahrtzeit_h} />
            <p class="notiz">{t(lang, 'p_fahrtzeitHinweis')}</p>
          {/if}
        </fieldset>

        <button type="button" class="weitere-knopf" aria-expanded={weitere} aria-controls="planer-erweitert" onclick={() => (weitere = !weitere)}>
          {t(lang, 'p_weitere')} <span aria-hidden="true">{weitere ? '−' : '+'}</span>
        </button>


        {#if voraussetzung}
          <div class="hinweiskasten" role="alert">
            <p>{t(lang, `vor_${voraussetzung}`)}</p>
            <button type="button" class="btn btn-outline btn-sm" onclick={() => zurueck?.()}>{t(lang, 'p_zumGespann')}</button>
          </div>
        {:else}
          <p class="notiz">{t(lang, 'p_mit')}: {rad.name}{#if wagen} + {wagen.name}{/if}</p>
        {/if}

        <div class="aktionen">
          <button type="submit" class="btn btn-primary" disabled={!start || !!voraussetzung || rechnet}>{rechnet ? t(lang, 'p_rechnet') : t(lang, 'p_berechnen')}</button>
        </div>
      </form>
    {/if}
  </aside>

  {#if weitere && filterOffen}
    <aside id="planer-erweitert" class="karte-karte erweitert" aria-label={t(lang, 'p_weitere')}>
      <div class="feinteile">
            <fieldset>
              <legend>{t(lang, 'p_raster')}</legend>
              <input id="p-raster" type="range" min="0" max="2" step="1" bind:value={schrittIdx} aria-label={t(lang, 'p_raster')} />
              <div class="raster-marken"><span>0,5 km</span><span>1 km</span><span>2 km</span></div>
              <p class="notiz">{t(lang, 'p_rasterHinweis', SCHRITTE[schrittIdx].label)}</p>
            </fieldset>

            <fieldset>
              <legend>{t(lang, 'p_fahrt')}</legend>
              <div class="gruppe" role="radiogroup" aria-label={t(lang, 'p_fahrt')}>
                <button type="button" role="radio" class="wahl" aria-checked={stil === 'gemuetlich'} onclick={() => stilSetzen('gemuetlich')}>{t(lang, 'p_stil_gemuetlich')}</button>
                <button type="button" role="radio" class="wahl" aria-checked={stil === 'sportlich'} onclick={() => stilSetzen('sportlich')}>{t(lang, 'p_stil_sportlich')}</button>
              </div>
              <p class="notiz">{t(lang, 'p_stilHinweis')}</p>
            </fieldset>

            <fieldset>
              <label for="p-eigen">{t(lang, 'p_eigen')}: <strong>{e.eigenleistung_max_w} W</strong></label>
              <input id="p-eigen" type="range" min={EINSTELLUNGEN_GRENZEN.eigenleistung_max_w[0]} max={EINSTELLUNGEN_GRENZEN.eigenleistung_max_w[1]} step="5" bind:value={e.eigenleistung_max_w} />
              <p class="notiz">{t(lang, 'p_eigenHinweis')}</p>
            </fieldset>

            <fieldset>
              <label for="p-modus">{t(lang, 'p_modus')}: <strong>{e.eigenleistung_modus === 'volle_power' ? t(lang, 'p_modusVolle') : t(lang, 'p_modusEntspannt')}</strong></label>
              <div class="modus-regler">
                <span>{t(lang, 'p_modusEntspannt')}</span>
                <input id="p-modus" type="range" min="0" max="1" step="1" value={e.eigenleistung_modus === 'volle_power' ? 1 : 0}
                  oninput={(ev) => { e.eigenleistung_modus = Number(ev.currentTarget.value) === 1 ? 'volle_power' : 'entspannt'; }} />
                <span>{t(lang, 'p_modusVolle')}</span>
              </div>
              <p class="notiz">{t(lang, 'p_modusHinweis')}</p>
            </fieldset>

            <fieldset>
              <legend>{t(lang, 'p_wetter')}</legend>
              <label for="p-wind">{t(lang, 'p_wind')}: <strong>{e.wind_ms} m/s</strong> <span class="notiz">({windKmh} km/h)</span></label>
              <input id="p-wind" type="range" min="0" max={EINSTELLUNGEN_GRENZEN.wind_ms[1]} step="0.5" bind:value={e.wind_ms} />
              {#if e.wind_ms > 0}
                <label for="p-windrichtung">{t(lang, 'p_windAus')}</label>
                <select id="p-windrichtung" class="input" bind:value={e.wind_richtung_grad}>
                  {#each WIND as [k, grad] (k)}<option value={grad}>{t(lang, `wind_${k}`)}</option>{/each}
                </select>
              {/if}
              {#if mitSolar && nachAkku}
                <label for="p-sonne">{t(lang, 'p_sonne')}</label>
                <select id="p-sonne" class="input" bind:value={e.einstrahlung_w_m2}>
                  {#each SONNE as s (s)}<option value={s}>{t(lang, `sonne_${s}`)}</option>{/each}
                </select>
              {/if}
            </fieldset>

            <div class="zwei">
              {#if nachAkku}
                <div>
                  <label for="p-reserve">{t(lang, 'p_reserve')} (%)</label>
                  <input id="p-reserve" class="input" type="number" min="0" max="50" step="1" bind:value={e.reserve_prozent} />
                </div>
              {/if}
              <div>
                <label for="p-belag">{t(lang, 'p_belag')}</label>
                <select id="p-belag" class="input" bind:value={e.oberflaeche}>
                  <option value={1}>{t(lang, 'belag_1')}</option>
                  <option value={1.3}>{t(lang, 'belag_1.3')}</option>
                  <option value={1.6}>{t(lang, 'belag_1.6')}</option>
                  <option value={2}>{t(lang, 'belag_2')}</option>
                </select>
              </div>
              <div>
                <label for="p-temp">{t(lang, 'p_temp')} (°C)</label>
                <input id="p-temp" class="input" type="number" min={EINSTELLUNGEN_GRENZEN.temperatur_c[0]} max={EINSTELLUNGEN_GRENZEN.temperatur_c[1]} step="1" bind:value={e.temperatur_c} />
              </div>
              <div>
                <label for="p-hoehe">{t(lang, 'p_hoehe')} (m)</label>
                <input id="p-hoehe" class="input" type="number" min={EINSTELLUNGEN_GRENZEN.hoehe_m[0]} max={EINSTELLUNGEN_GRENZEN.hoehe_m[1]} step="10" bind:value={e.hoehe_m} />
              </div>
            </div>
          </div>
    </aside>
  {/if}

  {#if meldungFehler}<p class="pille fehler" role="alert">{meldungFehler}</p>{/if}
  <p class="pille hinweis">{t(lang, 'p_kartenHinweis')}</p>

  <div class="unten-rechts">
    {#if auftrag || ergebnis}
      <section class="karte-karte fortschritt" role="status" aria-live="polite">
        {#if !auftrag}
          <strong>{t(lang, 'p_letzterLauf')}</strong>
          <span class="notiz">{letzterLauf ? zeitText(letzterLauf) : ''}</span>
          {#if ergebnis?.kennzahlen}
            <dl class="metriken">
              <div><dt>{t(lang, 'p_mReichweite')}</dt><dd>{budgetText}</dd></div>
              <div><dt>{t(lang, 'p_mWeit')}</dt><dd>{zahlText(lang, ergebnis.kennzahlen.weitester_km)} km</dd></div>
              <div><dt>{t(lang, 'p_mPunkte')}</dt><dd>{ergebnis.kennzahlen.punkte_machbar} / {ergebnis.kennzahlen.punkte_gesamt}</dd></div>
              <div><dt>{t(lang, 'p_mRechen')}</dt><dd>{zahlText(lang, Math.round(ergebnis.kennzahlen.ms / 100) / 10)} s</dd></div>
              <div><dt>{t(lang, 'p_mRaster')}</dt><dd>{zahlText(lang, ergebnis.schritt_m / 1000)} km</dd></div>
            </dl>
          {/if}
        {:else if auftrag.status === 'fehler'}
          <strong>{t(lang, 'p_fehlgeschlagen')}</strong>
          <span>{fehlerText(auftrag.code)}</span>
        {:else if auftrag.status === 'laeuft'}
          <strong>{t(lang, 'p_laeuft')}</strong>
          <div class="balken-zeile"><div class="balken-lauf"><div style:width={`${auftrag.fortschritt ?? 0}%`}></div></div><span class="prozent">{auftrag.fortschritt ?? 0} %</span></div>
          <ol class="lauf-schritte">
            {#each LAUF_SCHRITTE as schritt, i (schritt)}
              <li class:erledigt={i < laufSchritt(auftrag.phase)} class:aktuell={i === laufSchritt(auftrag.phase)}>{schritt}</li>
            {/each}
          </ol>
          <span class="phase">{auftrag.phase ?? ''}</span>
        {:else}
          <strong>{t(lang, 'p_wartet')}</strong>
          <span class="warteschlange">{t(lang, 'p_warteschlange')} <strong>{auftrag.davor}</strong></span>
          <span class="notiz">{t(lang, 'p_spaeter')}</span>
        {/if}
      </section>
    {/if}

    <section class="karte-karte ergebnis" aria-label={t(lang, 'p_ergebnis')}>
      <div class="legende" aria-hidden="true"><span>0</span><span class="balken"></span><span>{budgetText}</span></div>
      <button type="button" class="info-knopf" onclick={() => (infoOffen = true)}>{t(lang, 'p_infoKnopf')}</button>
      <p class="notiz">Punkte alle {SCHRITTE[schrittIdx].label}</p>
      {#if massstab}
        <div class="maszstab"><span class="massbalken" style:width={`${massstab.px}px`}></span><span>{massstab.label}</span></div>
      {/if}
      {#if ergebnis}
        <label class="haken"><input type="checkbox" bind:checked={heatAn} onchange={() => zeigeRoutenNeu().catch(() => {})} /> {t(lang, 'p_heat')}</label>
        <label class="haken"><input type="checkbox" bind:checked={routenAn} onchange={() => zeigeRoutenNeu().catch(() => {})} /> {t(lang, 'p_routen')}</label>
        {#if routenAn}
          <p class="steigung"><span class="st-gruen">{t(lang, 'p_stBergab')}</span> · <span class="st-blau">{t(lang, 'p_stFlach')}</span> · <span class="st-gelb">{t(lang, 'p_stMittel')}</span> · <span class="st-rot">{t(lang, 'p_stSteil')}</span></p>
        {/if}
        <label class="haken"><input type="checkbox" bind:checked={punkteAn} onchange={() => zeigeRoutenNeu().catch(() => {})} /> {t(lang, 'p_punkte')}</label>
        <label class="haken"><input type="checkbox" bind:checked={grenzeAn} onchange={() => zeigeRoutenNeu().catch(() => {})} /> {t(lang, 'p_grenze')}</label>
        {#if routenFehlen && (routenAn || punkteAn)}<p class="notiz">{t(lang, 'p_routenFehlen')}</p>{/if}
      {/if}
    </section>
  </div>
</div>

{#if infoOffen}
  <Fenster {lang} breit titel={t(lang, 'p_infoTitel')} onclose={() => (infoOffen = false)}>
    <InfoRechnung {lang} />
  </Fenster>
{/if}

<style>
  .modus-regler { display: flex; align-items: center; gap: .5rem; }
  .modus-regler input { flex: 1; }
  /* Vollbild: die Seite darunter wird nicht mehr gescrollt, solange der Planer offen ist */
  :global(html.planer-offen), :global(html.planer-offen body) { overflow: hidden; }

  .vollbild { position: fixed; inset: 0; z-index: 100; background: #f2efe9; overflow: hidden; }
  .karten-flaeche { position: absolute; inset: 0; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  /* Schwebende Karten über der Karte */
  .karte-karte { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 6px 20px rgba(0,0,0,.35); color: var(--fg); }

  .kopfleiste { position: absolute; top: .75rem; left: .75rem; right: 4rem; display: flex; align-items: center; gap: .75rem; z-index: 10; }
  .kopfleiste .btn { flex-shrink: 0; height: 2.5rem; display: inline-flex; align-items: center; background: var(--bg-card); box-shadow: 0 2px 8px rgba(0,0,0,.3); }
  .suchfeld { position: relative; flex: 1; max-width: 26rem; }
  .suchfeld .input { height: 2.5rem; box-sizing: border-box; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
  .treffer { list-style: none; position: absolute; left: 0; right: 0; top: 100%; z-index: 20; margin-top: .125rem; background: var(--bg-card); border: 1px solid var(--border);
    border-radius: var(--radius-sm); box-shadow: 0 4px 12px rgba(0,0,0,.3); max-height: 16rem; overflow-y: auto; }
  .treffer button { width: 100%; text-align: left; padding: .4rem .6rem; background: none; border: none; color: var(--fg); font: inherit; font-size: .8125rem; cursor: pointer; }
  .treffer button:hover, .treffer button:focus-visible { background: var(--bg-hover); outline: none; }
  .art { color: var(--fg-muted); font-size: .75rem; margin-left: .25rem; }

  .zoomknoepfe { position: absolute; top: .75rem; right: .75rem; display: flex; flex-direction: column; gap: .25rem; z-index: 10; }
  .steigung { font-size: .8125rem; margin: 0; }
  .st-gruen { color: #16a34a; font-weight: 600; } .st-blau { color: #2563eb; font-weight: 600; } .st-gelb { color: #eab308; font-weight: 600; } .st-rot { color: #dc2626; font-weight: 600; }
  .zoomanzeige { position: absolute; left: .75rem; bottom: 2.6rem; z-index: 10; font-size: .875rem; font-weight: 600; color: #111; white-space: nowrap; pointer-events: none; font-variant-numeric: tabular-nums; }
  .zoomknoepfe button.karte-karte { width: 2.25rem; height: 2.25rem; padding: 0; font: inherit; font-size: 1.25rem; line-height: 1; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .zoomknoepfe button.karte-karte:hover { border-color: var(--primary); }

  .filter { position: absolute; top: 4.75rem; left: .75rem; width: 15rem; max-height: calc(100% - 7.5rem); overflow-y: auto; z-index: 10; }
  .filter-kopf { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: .6rem .8rem; background: none; border: none; color: var(--fg); font: inherit; font-weight: 600; cursor: pointer; position: sticky; top: 0; background: var(--bg-card); border-radius: var(--radius); }
  .filter-kopf:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
  .weitere-knopf { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: .5rem .6rem; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--fg); font: inherit; font-size: .8125rem; font-weight: 600; cursor: pointer; }
  .weitere-knopf:hover { border-color: var(--primary); }
  .weitere-knopf:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  /* Die erweiterten Einstellungen: rechts neben dem linken Bereich, bis an den Bereich „Letzter Lauf“ */
  .erweitert { position: absolute; top: 4.75rem; left: calc(.75rem + 15rem + .5rem); right: calc(.75rem + min(22rem, 100% - 1.5rem) + .5rem); max-height: calc(100% - 7.5rem); overflow-y: auto; z-index: 12; padding: .75rem 1rem; }
  .erweitert .feinteile { display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: 1rem 1.5rem; padding-top: 0; }
  .filter-inhalt { display: flex; flex-direction: column; gap: 1rem; padding: 0 .8rem .8rem; }

  fieldset { border: none; border-top: 1px solid var(--border); padding: .75rem 0 0; display: flex; flex-direction: column; gap: .375rem; min-width: 0; }
  fieldset:first-of-type { border-top: none; padding-top: 0; }
  legend { font-size: .875rem; font-weight: 600; padding: 0; margin-bottom: .25rem; float: left; width: 100%; }
  legend + * { clear: both; }
  label { margin-bottom: 0; }
  input[type="range"] { width: 100%; accent-color: var(--primary); }
  .zeile { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .zwei { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem .75rem; }
  .feinteile { display: flex; flex-direction: column; gap: .5rem; padding-top: .5rem; }
  .gruppe { display: grid; grid-template-columns: 1fr 1fr; gap: .375rem; }
  .wahl { padding: .45rem .6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--fg);
    font: inherit; font-size: .8125rem; cursor: pointer; transition: all .15s; }
  .wahl:hover:not(:disabled) { border-color: var(--primary); }
  .wahl[aria-checked="true"], .wahl[aria-pressed="true"] { border-color: var(--primary); background: var(--primary-bg); color: var(--primary); font-weight: 600; }
  .ansicht { display: flex; gap: .375rem; }
  .ansicht .wahl { flex: 1; }
  .wahl:disabled { opacity: .5; cursor: not-allowed; }
  .wahl:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  details summary { cursor: pointer; font-size: .8125rem; color: var(--fg-muted); padding: .25rem 0; }
  .hinweiskasten { border: 1px solid var(--amber); background: var(--amber-bg); border-radius: var(--radius-sm); padding: .625rem .75rem; display: flex; flex-direction: column; gap: .5rem; align-items: flex-start; }
  .hinweiskasten p { font-size: .8125rem; }
  .aktionen { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .info-knopf { align-self: flex-start; padding: .25rem .6rem; font: inherit; font-size: .75rem; color: var(--primary); background: none; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
  .info-knopf:hover { border-color: var(--primary); }
  .haken { display: flex; align-items: center; gap: .4rem; font-size: .8125rem; cursor: pointer; }

  .pille { position: absolute; left: 50%; transform: translateX(-50%); z-index: 10; background: var(--bg-card); border: 1px solid var(--border); border-radius: 999px;
    padding: .3rem .8rem; font-size: .8125rem; box-shadow: 0 2px 8px rgba(0,0,0,.3); white-space: nowrap; pointer-events: none; }
  .pille.laden { top: 4.75rem; }
  .pille.fehler { top: 4.75rem; border-color: var(--red, #dc2626); color: var(--red, #dc2626); pointer-events: auto; }
  .pille.hinweis { bottom: .75rem; font-size: .75rem; color: var(--fg-muted); white-space: normal; max-width: calc(100% - 2rem); text-align: center; }

  .unten-rechts { position: absolute; right: .75rem; bottom: .75rem; width: min(22rem, calc(100% - 1.5rem)); max-height: calc(100% - 6rem); overflow-y: auto; z-index: 10; display: flex; flex-direction: column; gap: .5rem; }
  .ergebnis { padding: .9rem 1rem; display: flex; flex-direction: column; gap: .5rem; }
  .fortschritt { padding: .75rem 1rem; display: flex; flex-direction: column; gap: .4rem; }
  .balken-lauf { height: 8px; border-radius: 4px; background: rgba(128,128,128,.25); overflow: hidden; }
  .balken-lauf > div { height: 100%; background: var(--primary); transition: width .3s; }
  .lauf-schritte { list-style: none; margin: 0; padding: 0; font-size: .8125rem; color: var(--fg-muted); display: grid; gap: .15rem; }
  .lauf-schritte li.erledigt { color: var(--fg); }
  .lauf-schritte li.erledigt::before { content: '✓ '; }
  .lauf-schritte li.aktuell { color: var(--primary); font-weight: 600; }
  .phase { font-size: .8125rem; }
  .balken-zeile { display: flex; align-items: center; gap: .5rem; }
  .balken-zeile .balken-lauf { flex: 1; }
  .prozent { font-size: .8125rem; font-variant-numeric: tabular-nums; min-width: 2.75rem; text-align: right; }
  .metriken { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem .75rem; margin: 0; }
  .metriken dt { font-size: .75rem; color: var(--fg-muted); }
  .metriken dd { font-size: .9375rem; font-weight: 600; margin: 0; }
  .maszstab { display: flex; align-items: center; gap: .5rem; font-size: .8125rem; }
  .massbalken { height: 6px; border: 2px solid var(--fg); border-top: none; display: inline-block; }
  .raster-marken { display: flex; justify-content: space-between; font-size: .75rem; color: var(--fg-muted); }
  .legende { display: flex; align-items: center; gap: .5rem; font-size: .75rem; color: var(--fg-muted); }
  .balken { flex: 1; max-width: 14rem; height: .625rem; border-radius: 999px;
    background: linear-gradient(90deg, rgb(22,163,74), rgb(234,179,8) 50%, rgb(220,38,38)); }
  dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem 1rem; }
  dt { font-size: .75rem; color: var(--fg-muted); }
  dd { font-size: 1.05rem; font-weight: 600; }
  .annahmen { font-size: .8125rem; color: var(--fg-muted); padding-left: 1.25rem; }

  @media (max-width: 639px) {
    .kopfleiste { right: .75rem; flex-wrap: wrap; }
    .kopfleiste .btn { order: 0; }
    .suchfeld { order: 1; flex-basis: 100%; max-width: none; }
    .zoomknoepfe { top: auto; bottom: 9rem; right: .75rem; }
    .filter { top: auto; bottom: .75rem; left: .75rem; right: .75rem; width: auto; max-height: 45%; }
    .unten-rechts { left: .75rem; width: auto; max-height: 38%; }
    .erweitert { left: .75rem; right: .75rem; }
    .pille.hinweis { display: none; }
  }
</style>
