<script>
  import { onMount } from 'svelte';
  import { EINSTELLUNGEN_STANDARD, EINSTELLUNGEN_GRENZEN, UNTERSTUETZUNG, ANNAHMEN } from '../../../lib/rechenmodell.js';
  import { t, zahlText } from '../lib/i18n.js';
  import * as api from '../lib/api.js';
  import { Karte } from '../lib/karte.js';

  // Reichweiten-Planer: Start wählen, Einstellungen, „Berechnen“; die Karte zeigt die Reichweite als Wärmekarte mit Umrandung.
  // Die Rechnung läuft auf dem Server mit dem Gespann der Garage (Tab „Gespann“).
  let { lang, token, daten, einst, sichtbar, melde, zumGespann } = $props();

  const cfg = $derived(einst.reichweite);
  const WIND = [['N', 0], ['NO', 45], ['O', 90], ['SO', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
  const SONNE = [0, 150, 400, 800];

  // ---------- Gespann der Garage ----------
  const nachId = (liste, id) => liste.find(x => x.id === id) ?? null;
  const rad = $derived(nachId(daten.fahrraeder, daten.gespann?.fahrrad_id));
  const wagen = $derived(nachId(daten.anhaenger, daten.gespann?.anhaenger_id));
  const mitZusatzakku = $derived((rad?.zusatzakku_wh ?? 0) > 0 || (wagen?.zusatzakku_wh ?? 0) > 0);
  const mitSolar = $derived((wagen?.solar_wp ?? 0) > 0);
  const voraussetzung = $derived(!rad ? 'fahrrad_fehlt' : rad.motor_art === 'ohne' ? 'kein_motor'
    : (rad.akku_kapazitaet_wh ?? 0) + (rad.zusatzakku_wh ?? 0) + (wagen?.zusatzakku_wh ?? 0) <= 0 ? 'akku_fehlt' : null);

  // ---------- Einstellungen ----------
  let modus = $state('alle');
  let e = $state({
    akku_rest_prozent: EINSTELLUNGEN_STANDARD.akku_rest_prozent, zusatz_rest_prozent: null, geschwindigkeit_kmh: EINSTELLUNGEN_STANDARD.geschwindigkeit_kmh,
    unterstuetzung: EINSTELLUNGEN_STANDARD.unterstuetzung, eigenleistung_w: EINSTELLUNGEN_STANDARD.eigenleistung_w, eigenleistung_max_w: EINSTELLUNGEN_STANDARD.eigenleistung_max_w,
    wind_ms: 0, wind_richtung_grad: 270, einstrahlung_w_m2: 0, reserve_prozent: EINSTELLUNGEN_STANDARD.reserve_prozent,
    temperatur_c: EINSTELLUNGEN_STANDARD.temperatur_c, hoehe_m: EINSTELLUNGEN_STANDARD.hoehe_m, oberflaeche: EINSTELLUNGEN_STANDARD.oberflaeche
  });
  let live = $state(false);

  // ---------- Zustand ----------
  let leinwand;
  let karte = null;
  let orte = $state([]);
  let start = $state(null);        // { lat, lon }
  let suche = $state('');
  let suchOffen = $state(false);
  let rechnet = $state(false);
  let ergebnis = $state(null);
  let meldungFehler = $state('');
  let zaehler = 0;
  let timer;

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
    if (live) planeBerechnung();
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
    const r = { ...e };
    if (!mitZusatzakku || r.zusatz_rest_prozent === null) delete r.zusatz_rest_prozent;
    if (!mitSolar) r.einstrahlung_w_m2 = 0;
    for (const k of Object.keys(r)) if (typeof r[k] === 'number' && !Number.isFinite(r[k])) delete r[k];
    return r;
  }

  async function berechnen(anpassen = true) {
    if (!start || voraussetzung) return;
    const nr = ++zaehler;
    rechnet = true;
    meldungFehler = '';
    try {
      const r = await api.reichweiteBerechnen(token, { lat: start.lat, lon: start.lon, modus, einstellungen: einstellungen() });
      if (nr !== zaehler) return; // eine neuere Anfrage läuft schon
      ergebnis = r;
      karte.setzeRaster(r.raster);
      karte.setzeUmrandung(r.umrandung);
      karte.setzeStart(r.start.lat, r.start.lon);
      if (anpassen && r.umrandung.length) {
        const alle = r.umrandung.flat();
        karte.zeigeRechteck(Math.min(...alle.map(p => p[0])), Math.min(...alle.map(p => p[1])), Math.max(...alle.map(p => p[0])), Math.max(...alle.map(p => p[1])));
      }
    } catch (err) {
      if (nr !== zaehler) return;
      ergebnis = null;
      karte.setzeRaster(null);
      karte.setzeUmrandung([]);
      meldungFehler = err.felder ? t(lang, 'e_eingabe') : fehlerText(err.code);
    } finally {
      if (nr === zaehler) rechnet = false;
    }
  }

  function planeBerechnung() {
    clearTimeout(timer);
    timer = setTimeout(() => berechnen(false), 900);
  }

  // Automatisch neu rechnen, wenn sich etwas ändert (nur, wenn eingeschaltet)
  $effect(() => {
    modus; JSON.stringify(e); rad?.id; wagen?.id; daten.gespann?.fahrer_gewicht_kg; daten.gespann?.gepaeck_kg; // eslint-disable-line no-unused-expressions
    if (live && start && !voraussetzung) planeBerechnung();
    return () => clearTimeout(timer);
  });

  // ---------- Karte ----------
  onMount(() => {
    karte = new Karte(leinwand, {
      bbox: cfg.bbox, zoom: cfg.zoom, orte: [],
      quelle: t(lang, 'kartenQuelle'),
      kachel: (z, x, y) => api.karteKachel(z, x, y),
      beiKlick: (lat, lon) => setzeStart(lat, lon)
    });
    api.karteOrte().then((o) => { orte = o; karte.opt.orte = o; karte.zeichnen(); }).catch(() => {});
    return () => { karte.beenden(); clearTimeout(timer); };
  });

  // Der Tab war ausgeblendet: Größe neu bestimmen, wenn er sichtbar wird; Sprache für die Quelle nachziehen
  $effect(() => { if (sichtbar && karte) karte.groesse(); });
  $effect(() => { if (karte) { karte.opt.quelle = t(lang, 'kartenQuelle'); karte.zeichnen(); } });

  const annahmeText = (k) => {
    const w = { fahrer_gewicht_kg: ANNAHMEN.fahrer_gewicht_kg, gewicht_kg: ANNAHMEN.fahrrad_gewicht_kg, leergewicht_kg: ANNAHMEN.anhaenger_leergewicht_kg,
      motor_nennleistung_w: ANNAHMEN.motor_nennleistung_w, anhaenger_flaeche: ANNAHMEN.anhaenger_flaeche_m2 }[k];
    return t(lang, `assume_${k}`, w ?? '');
  };
  const windKmh = $derived(Math.round(e.wind_ms * 3.6));
</script>

<div class="planer">
  <form class="steuerung" onsubmit={(ev) => { ev.preventDefault(); berechnen(true); }} novalidate>
    <fieldset>
      <legend>{t(lang, 'p_start')}</legend>
      <div class="suchfeld">
        <label for="p-suche">{t(lang, 'p_ort')}</label>
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
      <div class="zeile">
        <button type="button" class="btn btn-outline btn-sm" onclick={standort}>{t(lang, 'p_standort')}</button>
        <span class="notiz">{start ? `${start.lat.toFixed(4)}, ${start.lon.toFixed(4)}` : t(lang, 'p_startKlick')}</span>
      </div>
    </fieldset>

    <fieldset>
      <legend>{t(lang, 'p_wege')}</legend>
      <select class="input" aria-label={t(lang, 'p_wege')} bind:value={modus}>
        {#each cfg.modi as m (m)}<option value={m}>{t(lang, `modus_${m}`)}</option>{/each}
      </select>
      <p class="notiz">{t(lang, `modusHinweis_${modus}`)}</p>
    </fieldset>

    <fieldset>
      <legend>{t(lang, 'p_akku')}</legend>
      <label for="p-akku">{t(lang, 'p_akkuRest')}: <strong>{e.akku_rest_prozent} %</strong></label>
      <input id="p-akku" type="range" min="0" max="100" step="1" bind:value={e.akku_rest_prozent} />
      {#if mitZusatzakku}
        <label for="p-zakku">{t(lang, 'p_zusatzRest')}: <strong>{e.zusatz_rest_prozent ?? e.akku_rest_prozent} %</strong></label>
        <input id="p-zakku" type="range" min="0" max="100" step="1" value={e.zusatz_rest_prozent ?? e.akku_rest_prozent} oninput={(ev) => (e.zusatz_rest_prozent = Number(ev.currentTarget.value))} />
      {/if}
    </fieldset>

    <fieldset>
      <legend>{t(lang, 'p_fahrt')}</legend>
      <label for="p-stufe">{t(lang, 'p_stufe')}</label>
      <select id="p-stufe" class="input" bind:value={e.unterstuetzung}>
        {#each Object.keys(UNTERSTUETZUNG) as s (s)}<option value={s}>{t(lang, `stufe_${s}`)}</option>{/each}
      </select>
      <label for="p-tempo">{t(lang, 'p_tempo')}: <strong>{e.geschwindigkeit_kmh} km/h</strong></label>
      <input id="p-tempo" type="range" min={EINSTELLUNGEN_GRENZEN.geschwindigkeit_kmh[0]} max={EINSTELLUNGEN_GRENZEN.geschwindigkeit_kmh[1]} step="1" bind:value={e.geschwindigkeit_kmh} />
      <div class="zwei">
        <div>
          <label for="p-eigen">{t(lang, 'p_eigen')} (W)</label>
          <input id="p-eigen" class="input" type="number" min={EINSTELLUNGEN_GRENZEN.eigenleistung_w[0]} max={EINSTELLUNGEN_GRENZEN.eigenleistung_w[1]} step="5" bind:value={e.eigenleistung_w} />
        </div>
        <div>
          <label for="p-eigenmax">{t(lang, 'p_eigenMax')} (W)</label>
          <input id="p-eigenmax" class="input" type="number" min={EINSTELLUNGEN_GRENZEN.eigenleistung_max_w[0]} max={EINSTELLUNGEN_GRENZEN.eigenleistung_max_w[1]} step="5" bind:value={e.eigenleistung_max_w} />
        </div>
      </div>
      <p class="notiz">{t(lang, 'p_eigenHinweis')}</p>
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
      {#if mitSolar}
        <label for="p-sonne">{t(lang, 'p_sonne')}</label>
        <select id="p-sonne" class="input" bind:value={e.einstrahlung_w_m2}>
          {#each SONNE as s (s)}<option value={s}>{t(lang, `sonne_${s}`)}</option>{/each}
        </select>
      {/if}
    </fieldset>

    <details>
      <summary>{t(lang, 'p_mehr')}</summary>
      <div class="zwei">
        <div>
          <label for="p-reserve">{t(lang, 'p_reserve')} (%)</label>
          <input id="p-reserve" class="input" type="number" min="0" max="50" step="1" bind:value={e.reserve_prozent} />
        </div>
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
    </details>

    {#if voraussetzung}
      <div class="hinweiskasten" role="alert">
        <p>{t(lang, `vor_${voraussetzung}`)}</p>
        <button type="button" class="btn btn-outline btn-sm" onclick={zumGespann}>{t(lang, 'p_zumGespann')}</button>
      </div>
    {:else}
      <p class="notiz gespanntext">{t(lang, 'p_mit')}: {rad.name}{#if wagen} + {wagen.name}{/if}</p>
    {/if}

    <div class="aktionen">
      <button type="submit" class="btn btn-primary" disabled={!start || !!voraussetzung || rechnet}>{rechnet ? t(lang, 'p_rechnet') : t(lang, 'p_berechnen')}</button>
      <label class="haken"><input type="checkbox" bind:checked={live} /> {t(lang, 'p_live')}</label>
    </div>
  </form>

  <div class="kartenspalte">
    <div class="kartenrahmen">
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <canvas bind:this={leinwand} tabindex="0" role="img" aria-label={t(lang, 'p_kartenName')}></canvas>
      <div class="zoomknoepfe">
        <button type="button" class="btn btn-outline btn-icon" aria-label={t(lang, 'p_zoomIn')} onclick={() => karte?.zoomen(1.6)}>+</button>
        <button type="button" class="btn btn-outline btn-icon" aria-label={t(lang, 'p_zoomOut')} onclick={() => karte?.zoomen(1 / 1.6)}>−</button>
      </div>
      {#if rechnet}<div class="laden" role="status">{t(lang, 'p_rechnet')}</div>{/if}
    </div>
    <p class="notiz kartenhinweis">{t(lang, 'p_kartenHinweis')}</p>

    {#if meldungFehler}<p class="fehler" role="alert">{meldungFehler}</p>{/if}

    {#if ergebnis}
      <section class="ergebnis" aria-label={t(lang, 'p_ergebnis')}>
        <div class="legende" aria-hidden="true"><span>0 Wh</span><span class="balken"></span><span>{zahlText(lang, Math.round(ergebnis.budget_wh))} Wh</span></div>
        <dl>
          <div><dt>{t(lang, 'p_flaeche')}</dt><dd>{zahlText(lang, ergebnis.kennzahlen.flaeche_km2)} km²</dd></div>
          <div><dt>{t(lang, 'p_weitester')}</dt><dd>{zahlText(lang, ergebnis.kennzahlen.weitester_km)} km</dd></div>
          <div><dt>{t(lang, 'p_energie')}</dt><dd>{zahlText(lang, Math.round(ergebnis.budget_wh))} Wh</dd></div>
          <div><dt>{t(lang, 'totalWeight')}</dt><dd>{zahlText(lang, Math.round(ergebnis.modell.masse_kg))} kg</dd></div>
        </dl>
        {#if ergebnis.annahmen.length}
          <p class="notiz">{t(lang, 'p_annahmen')}</p>
          <ul class="annahmen">{#each ergebnis.annahmen as k (k)}<li>{annahmeText(k)}</li>{/each}</ul>
        {/if}
        <p class="notiz">{t(lang, 'p_vorbehalt')}</p>
      </section>
    {/if}
  </div>
</div>

<style>
  .planer { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
  .steuerung { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
  fieldset { border: none; border-top: 1px solid var(--border); padding: .75rem 0 0; display: flex; flex-direction: column; gap: .375rem; min-width: 0; }
  fieldset:first-of-type { border-top: none; padding-top: 0; }
  legend { font-size: .875rem; font-weight: 600; padding: 0; margin-bottom: .25rem; float: left; width: 100%; }
  legend + * { clear: both; }
  label { margin-bottom: 0; }
  input[type="range"] { width: 100%; accent-color: var(--primary); }
  .zeile { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .zwei { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem .75rem; }
  .suchfeld { position: relative; }
  .treffer { list-style: none; position: absolute; left: 0; right: 0; top: 100%; z-index: 20; margin-top: .125rem; background: var(--bg-card); border: 1px solid var(--border);
    border-radius: var(--radius-sm); box-shadow: 0 4px 12px rgba(0,0,0,.3); max-height: 16rem; overflow-y: auto; }
  .treffer button { width: 100%; text-align: left; padding: .4rem .6rem; background: none; border: none; color: var(--fg); font: inherit; font-size: .8125rem; cursor: pointer; }
  .treffer button:hover, .treffer button:focus-visible { background: var(--bg-hover); outline: none; }
  .art { color: var(--fg-muted); font-size: .75rem; margin-left: .25rem; }
  details summary { cursor: pointer; font-size: .8125rem; color: var(--fg-muted); margin-bottom: .5rem; }
  .hinweiskasten { border: 1px solid var(--amber); background: var(--amber-bg); border-radius: var(--radius-sm); padding: .625rem .75rem; display: flex; flex-direction: column; gap: .5rem; align-items: flex-start; }
  .hinweiskasten p { font-size: .8125rem; }
  .gespanntext { margin-top: -.25rem; }
  .aktionen { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .haken { display: flex; align-items: center; gap: .4rem; font-size: .8125rem; cursor: pointer; }
  .kartenspalte { min-width: 0; display: flex; flex-direction: column; gap: .5rem; }
  .kartenrahmen { position: relative; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; height: min(70vh, 38rem); min-height: 22rem; background: var(--bg); }
  canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
  canvas:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
  .zoomknoepfe { position: absolute; top: .5rem; right: .5rem; display: flex; flex-direction: column; gap: .25rem; }
  .zoomknoepfe .btn { background: var(--bg-card); width: 2rem; height: 2rem; font-size: 1.125rem; }
  .laden { position: absolute; left: .5rem; top: .5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .25rem .625rem; font-size: .8125rem; }
  .kartenhinweis { margin-top: -.125rem; }
  .ergebnis { border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; display: flex; flex-direction: column; gap: .5rem; background: var(--bg-card); }
  .legende { display: flex; align-items: center; gap: .5rem; font-size: .75rem; color: var(--fg-muted); }
  .balken { flex: 1; max-width: 16rem; height: .625rem; border-radius: 999px; background: linear-gradient(90deg, rgb(22,163,74), rgb(234,179,8), rgb(220,38,38)); }
  dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .5rem 1rem; }
  dt { font-size: .75rem; color: var(--fg-muted); }
  dd { font-size: 1.125rem; font-weight: 600; }
  .annahmen { font-size: .8125rem; color: var(--fg-muted); padding-left: 1.25rem; }
  @media (min-width: 960px) { .planer { grid-template-columns: 20rem minmax(0, 1fr); align-items: start; } }
</style>
