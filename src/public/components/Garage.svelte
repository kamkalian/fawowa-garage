<script>
  import { onMount } from 'svelte';
  import { ARTEN, GESPANN_FELDER } from '../../../lib/felder.js';
  import Icon from '../../shared/Icon.svelte';
  import { t, pick } from '../lib/i18n.js';
  import { verkleinern } from '../lib/foto.js';
  import * as api from '../lib/api.js';
  import EintragForm from './EintragForm.svelte';
  import EintragKarte from './EintragKarte.svelte';
  import GarageRaum from './GarageRaum.svelte';
  import { portal } from '../lib/portal.js';
  import Fenster from './Fenster.svelte';
  import EmailFenster from './EmailFenster.svelte';
  import Planer from './Planer.svelte';

  // Die Garage eines Nutzers: zwei Tabs. „Gespann“ (Standard) und „Stellplätze“ (alle Fahrräder und Anhänger als Kacheln, per Drag and Drop ordnen)
  let { lang, token, melde, onungueltig, ongeloescht, emailAktiv = false, einst = {} } = $props();

  const ARTEN_LISTE = ['fahrraeder', 'anhaenger', 'gepaecke'];
  const planerAktiv = $derived(!!einst.reichweite?.aktiv);
  let planerOffen = $state(false); // Reichweiten-Planer als Vollbild-Seite, geöffnet über einen Knopf
  let fotos = $state({}); // Anzeige der Fotos je Stellplatz (Schlüssel art-id)
  let fotoZiel = null;
  let fotoInput;
  let fahrer = $state(null); // Fahrergewicht, gilt für das ganze Gespann (Profil oben rechts)
  let profilOffen = $state(false);
  let status = $state('laden'); // laden | bereit | fehler
  let daten = $state({ fahrraeder: [], anhaenger: [], gepaecke: [], gespann: null, email: null, email_offen: null });
  let form = $state(null);        // { art, eintrag } oder null
  let loeschen = $state(null);    // { art, eintrag } oder null
  let garageLoeschen = $state(false);
  let kopiert = $state(false);
  let infoOffen = $state(false); // Hinweis zum Link: bei Hover und Fokus sichtbar, per Klick festgehalten
  let laeuft = $state(false);
  let emailFenster = $state(false);
  let artWahl = $state(false);    // Auswahlfenster „Fahrrad oder Anhänger hinzufügen“
  let ziehend = $state(null);     // { art, id } der gerade gezogenen Kachel
  let ziel = $state(null);        // Schlüssel der Kachel, über der gezogen wird, oder 'ende'

  const link = $derived(`${location.origin}/#g=${token}`);
  // Alle Fahrzeuge in einer gemeinsamen Reihenfolge; bei gleicher Nummer Fahrräder vor Anhängern, dann nach Nummer
  const rang = { fahrraeder: 0, anhaenger: 1, gepaecke: 2 };
  const fahrzeuge = $derived([
    ...daten.fahrraeder.map(e => ({ art: 'fahrraeder', e })),
    ...daten.anhaenger.map(e => ({ art: 'anhaenger', e })),
    ...(daten.gepaecke ?? []).map(e => ({ art: 'gepaecke', e }))
  ].sort((a, b) => a.e.sortierung - b.e.sortierung || (a.art === b.art ? a.e.id - b.e.id : rang[a.art] - rang[b.art])));
  const schluessel = (f) => `${f.art}-${f.e.id}`;
  const alleVoll = $derived(ARTEN_LISTE.every(a => daten[a].length >= ARTEN[a].max));

  const imInGespann = (art, e) => (daten.mitglieder?.[art] ?? []).includes(e.id);
  // Der Reichweitenplaner braucht mindestens ein Zugfahrzeug im Gespann
  const hatZugfahrzeug = $derived((daten.mitglieder?.fahrraeder ?? []).length > 0);
  const gespannNamen = $derived([
    ...(daten.mitglieder?.fahrraeder ?? []).map(id => daten.fahrraeder.find(x => x.id === id)?.name),
    ...(daten.mitglieder?.anhaenger ?? []).map(id => daten.anhaenger.find(x => x.id === id)?.name)
  ].filter(Boolean).join(' + '));

  /** Ein Stellplatz kommt ins Gespann oder fliegt wieder heraus (beliebig viele Zugfahrzeuge und Anhänger) */
  async function umschalten(f) {
    const im = !imInGespann(f.art, f.e);
    try {
      daten = await api.mitgliedSetzen(token, f.art, f.e.id, im);
      melde(t(lang, im ? 'toGespannDone' : 'removeGespannDone'));
    } catch (e) {
      melde(fehlerMeldung(e), 'error');
    }
  }

  /** Fahrergewicht speichern (gilt für das ganze Gespann) */
  async function profilSpeichern(e) {
    e.preventDefault();
    try {
      daten.gespann = await api.gespannSetzen(token, { fahrer_gewicht_kg: fahrer });
      profilOffen = false;
      melde(t(lang, 'saved'));
    } catch (err) {
      melde(fehlerMeldung(err), 'error');
    }
  }


  onMount(async () => {
    try {
      daten = await api.garageLaden(token);
      fahrer = daten.gespann?.fahrer_gewicht_kg ?? null;
      await ladeFotos();
      status = 'bereit';
    } catch (e) {
      if (e.status === 401) onungueltig();
      else status = 'fehler';
    }
  });

  const fehlerMeldung = (e) => {
    const text = t(lang, e?.code ? `e_${e.code}` : 'e_allgemein');
    return text.startsWith('e_') ? t(lang, 'e_allgemein') : text;
  };

  /** Speichert Fahrzeug und Motoren/Akkus; antriebe = { motoren, akkus } aus dem Formular */
  async function speichere(werte, antriebe) {
    const { art, eintrag } = form;
    const neu = eintrag
      ? await api.eintragAendern(token, art, eintrag.id, werte)
      : await api.eintragAnlegen(token, art, werte);
    // Gepäck hat keine Motoren und Akkus
    const antrieb = art === 'gepaecke' ? { motoren: [], akkus: [] } : await api.antriebSetzen(token, art, neu.id, antriebe);
    // Die Serverantwort enthält keine Motoren, Akkus und keine Fotoangabe: die bisherigen Werte bleiben erhalten
    const eintragNeu = { ...neu, motoren: antrieb.motoren, akkus: antrieb.akkus };
    daten[art] = eintrag
      ? daten[art].map(x => (x.id === neu.id ? { ...x, ...eintragNeu } : x))
      : [...daten[art], { foto_vorhanden: false, ...eintragNeu }];
    form = null;
    melde(t(lang, 'saved'));
  }

  // --- Drag and Drop (HTML5): Kacheln neu anordnen ---
  function ziehStart(e, f) {
    ziehend = { art: f.art, id: f.e.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${f.art}:${f.e.id}`); // Firefox startet das Ziehen nur mit Daten
  }
  function ziehEnde() { ziehend = null; ziel = null; }
  function ueberKachel(e, key) {
    if (!ziehend) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    ziel = key;
  }

  /** Legt die gezogene Kachel an die Stelle von zielFahrzeug (null: ans Ende) und speichert die neue Reihenfolge */
  async function ablegenKachel(e, zielFahrzeug) {
    e.preventDefault();
    const z = ziehend;
    ziehEnde();
    if (!z) return;
    const liste = fahrzeuge.map(f => ({ art: f.art, id: f.e.id }));
    const von = liste.findIndex(x => x.art === z.art && x.id === z.id);
    const nach = zielFahrzeug ? liste.findIndex(x => x.art === zielFahrzeug.art && x.id === zielFahrzeug.e.id) : liste.length - 1;
    if (von < 0 || nach < 0 || von === nach) return;
    const [x] = liste.splice(von, 1);
    liste.splice(nach, 0, x);
    liste.forEach((f, i) => { daten[f.art] = daten[f.art].map(e => (e.id === f.id ? { ...e, sortierung: i + 1 } : e)); });
    try {
      await api.reihenfolgeSetzen(token, liste);
    } catch (err) {
      melde(fehlerMeldung(err), 'error');
      try { daten = await api.garageLaden(token); } catch { /* Anzeige bleibt, wie sie ist */ }
    }
  }

  // --- Fotos der Stellplätze: Anzeige mit dem Zugangsschlüssel laden, hochladen (verkleinert) und entfernen ---
  async function ladeFotos() {
    const neu = {};
    for (const f of fahrzeuge) {
      if (!f.e.foto_vorhanden || f.art === 'gepaecke') continue;
      try { neu[schluessel(f)] = await api.fotoLaden(token, f.art, f.e.id); } catch { /* ohne Foto zeigt die Kachel das Icon */ }
    }
    fotos = neu;
  }

  /** Aktionen im Bearbeiten-Fenster: Foto oben (bleibt offen), Entfernen unten (öffnet die Rückfrage) */
  function formAktionen() {
    const f = { art: form.art, e: form.eintrag };
    // Den aktuellen Stand aus der Liste nehmen: ein Foto-Upload ändert die Anzeige, während das Fenster offen ist
    const aktuell = daten[f.art].find(x => x.id === f.e.id) ?? f.e;
    // Gepäck hat kein Foto: dann fehlen die Foto-Aktionen im Fenster
    const mitFoto = f.art !== 'gepaecke';
    return {
      fotoVorhanden: !!aktuell.foto_vorhanden,
      onfoto: mitFoto ? () => fotoWaehlen(f) : undefined,
      onfotoloeschen: mitFoto ? () => fotoEntfernen(f) : undefined,
      onloeschen: () => { loeschen = { art: f.art, eintrag: f.e }; form = null; }
    };
  }

  function fotoWaehlen(f) {
    fotoZiel = f;
    fotoInput?.click();
  }

  async function fotoGewaehlt(e) {
    const datei = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!datei || !fotoZiel) return;
    const ziel = fotoZiel;
    if (!datei.type.startsWith('image/')) { melde(t(lang, 'photoBad'), 'error'); return; }
    try {
      const klein = await verkleinern(datei);
      await api.fotoHochladen(token, ziel.art, ziel.e.id, klein);
      daten[ziel.art] = daten[ziel.art].map(x => (x.id === ziel.e.id ? { ...x, foto_vorhanden: true } : x));
      await ladeFotos();
      melde(t(lang, 'saved'));
    } catch (err) {
      melde(err?.code === 'foto_ungueltig' ? t(lang, 'photoBad') : fehlerMeldung(err), 'error');
    }
  }

  async function fotoEntfernen(f) {
    try {
      await api.fotoLoeschen(token, f.art, f.e.id);
      daten[f.art] = daten[f.art].map(x => (x.id === f.e.id ? { ...x, foto_vorhanden: false } : x));
      const { [schluessel(f)]: _alt, ...rest } = fotos; // eslint-disable-line no-unused-vars
      fotos = rest;
      melde(t(lang, 'deleted'));
    } catch (err) {
      melde(fehlerMeldung(err), 'error');
    }
  }

  async function entferne() {
    const { art, eintrag } = loeschen;
    laeuft = true;
    try {
      await api.eintragLoeschen(token, art, eintrag.id);
      // Ein Platz im Gespann, der den Eintrag benutzte, ist jetzt leer: alles neu laden, damit die Anzeige stimmt
      daten = await api.garageLaden(token);
      melde(t(lang, 'deleted'));
    } catch (e) {
      melde(fehlerMeldung(e), 'error');
    } finally {
      laeuft = false;
      loeschen = null;
    }
  }

  async function entferneGarage() {
    laeuft = true;
    try {
      await api.garageLoeschen(token);
      ongeloescht();
    } catch (e) {
      melde(fehlerMeldung(e), 'error');
      garageLoeschen = false;
    } finally {
      laeuft = false;
    }
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(link);
      kopiert = true;
      setTimeout(() => (kopiert = false), 2000);
    } catch {
      document.getElementById('garage-link')?.select();
    }
  }
</script>

<!-- Esc und Klick daneben schließen den festgehaltenen Hinweis -->
<svelte:window onkeydown={(e) => { if (e.key === 'Escape') infoOffen = false; }}
  onclick={(e) => { if (infoOffen && !e.target.closest?.('.info')) infoOffen = false; }} />

{#if status === 'laden'}
  <p class="muted">{t(lang, 'loading')}</p>
{:else if status === 'fehler'}
  <p class="fehler" role="alert">{t(lang, 'loadError')}</p>
{:else}
  <section class="link" aria-label={t(lang, 'linkTitle')}>
    <div class="linkkopf">
      <label for="garage-link">{t(lang, 'linkTitle')}</label>
      <span class="info">
        <button type="button" class="infoknopf" aria-label={t(lang, 'linkInfo')} aria-expanded={infoOffen} aria-describedby="link-info"
          onclick={() => (infoOffen = !infoOffen)}>
          <Icon name="ui-info" size={16} />
        </button>
        <span id="link-info" role="tooltip" class="tip" class:offen={infoOffen}>{t(lang, 'linkText')}</span>
      </span>
    </div>
    <input id="garage-link" class="input" type="text" readonly value={link} onfocus={(e) => e.currentTarget.select()} />
    <button type="button" class="btn btn-outline btn-sm" onclick={kopieren}><Icon name="ui-copy" size={14} /> {kopiert ? t(lang, 'copied') : t(lang, 'copy')}</button>
    {#if planerAktiv}
      <button type="button" class="btn btn-outline planer-knopf" disabled={!hatZugfahrzeug} onclick={() => (planerOffen = true)}
        title={hatZugfahrzeug ? undefined : pick({ de: 'Zuerst ein Zugfahrzeug ins Gespann nehmen', en: 'First add a towing vehicle to the convoy' }, lang)}>{t(lang, 'p_planerOeffnen')}</button>
    {/if}
    {#if emailAktiv}
      <button type="button" class="btn btn-outline btn-sm emailknopf" class:ok={!!daten.email} class:offen={!daten.email && !!daten.email_offen}
        title={daten.email ?? daten.email_offen ?? undefined} onclick={() => (emailFenster = true)}>
        <Icon name="ui-mail" size={14} />
        {daten.email ? t(lang, 'emailDone') : daten.email_offen ? t(lang, 'emailOpen') : t(lang, 'emailAdd')}
      </button>
    {/if}
  </section>

  {#if planerAktiv}
    <Planer {lang} {token} {daten} {einst} offen={planerOffen} zurueck={() => (planerOffen = false)} />
  {/if}

  {#snippet profilKnopf()}
    <button type="button" class="profil-knopf" use:portal={'kopf-aktionen'} aria-label={pick({ de: 'Fahrer und Gewicht', en: 'Rider and weight' }, lang)}
      title={pick({ de: 'Fahrer und Gewicht', en: 'Rider and weight' }, lang)} onclick={() => (profilOffen = true)}>
      <Icon name="ui-user" size={20} />
    </button>
  {/snippet}

  <GarageRaum {lang} kopf={profilKnopf}>
  <div class="stellplaetze">
    <input bind:this={fotoInput} type="file" accept="image/*" hidden onchange={fotoGewaehlt} />
    <div class="liste" role="list">
      {#each fahrzeuge as f (schluessel(f))}
        <div class="kachel" role="listitem" draggable="true" class:gezogen={ziehend?.art === f.art && ziehend?.id === f.e.id} class:ziel={ziel === schluessel(f)}
          ondragstart={(e) => ziehStart(e, f)} ondragend={ziehEnde}
          ondragover={(e) => ueberKachel(e, schluessel(f))} ondrop={(e) => ablegenKachel(e, f)}>
          <EintragKarte {lang} art={f.art} eintrag={f.e} imGespann={imInGespann(f.art, f.e)} foto={fotos[schluessel(f)] ?? null}
            onGespann={() => umschalten(f)}
            onedit={() => (form = { art: f.art, eintrag: f.e })} />
        </div>
      {/each}
      <div class="plus-wrap" role="listitem" ondragover={(e) => ueberKachel(e, 'ende')} ondrop={(e) => ablegenKachel(e, null)}>
        <button type="button" class="plus-kachel" class:ziel={ziel === 'ende'} disabled={alleVoll}
          aria-label={t(lang, 'addVehicleTitle')} onclick={() => (artWahl = true)}>
          <Icon name="ui-plus" size={32} />
          <span>{t(lang, 'addVehicle')}</span>
        </button>
      </div>
    </div>
  </div>
  </GarageRaum>

  <p class="unten"><button type="button" class="btn btn-ghost btn-sm" onclick={() => (garageLoeschen = true)}><Icon name="ui-trash" size={14} /> {t(lang, 'deleteGarage')}</button></p>
{/if}

{#if emailFenster}
  <EmailFenster {lang} {token} {daten} {melde} onclose={() => (emailFenster = false)} />
{/if}

{#if artWahl}
  <Fenster {lang} titel={t(lang, 'addVehicleTitle')} onclose={() => (artWahl = false)}>
    <div class="artwahl">
      {#each ARTEN_LISTE as art (art)}
        <button type="button" class="artknopf" disabled={daten[art].length >= ARTEN[art].max}
          onclick={() => { artWahl = false; form = { art, eintrag: null }; }}>
          <Icon name={art === 'fahrraeder' ? 'veh-bike' : art === 'anhaenger' ? 'veh-trailer' : 'ui-box'} size={48} />
          <span>{art === 'gepaecke' ? pick({ de: 'Gepäck', en: 'Luggage' }, lang) : t(lang, `slot_${art}`)}</span>
        </button>
      {/each}
    </div>
  </Fenster>
{/if}

{#if profilOffen}
  <Fenster {lang} titel={daten.fahrer_name ? `${daten.fahrer_name} und Gewicht` : pick({ de: 'Fahrer und Gewicht', en: 'Rider and weight' }, lang)} onclose={() => (profilOffen = false)}>
    <form class="profil-form" onsubmit={profilSpeichern}>
      <label for="profil-gewicht">{pick(GESPANN_FELDER[0].label, lang)} (kg)</label>
      <input id="profil-gewicht" class="input" type="number" inputmode="decimal" min="20" max="250" step="any" bind:value={fahrer} />
      <p class="profil-hinweis">{pick({ de: 'Gilt für das ganze Gespann. Das Gepäck ist eine eigene Kachel.', en: 'Applies to the whole convoy. Luggage is its own tile.' }, lang)}</p>
      <div class="profil-aktionen">
        <button type="button" class="btn btn-ghost" onclick={() => (profilOffen = false)}>{t(lang, 'cancel')}</button>
        <button type="submit" class="btn btn-primary">{t(lang, 'save')}</button>
      </div>
    </form>
  </Fenster>
{/if}

{#if form}
  <EintragForm {lang} art={form.art} eintrag={form.eintrag} onsave={speichere} onclose={() => (form = null)} aktionen={form.eintrag ? formAktionen() : null} />
{/if}

{#if loeschen}
  <Fenster {lang} titel={t(lang, 'remove')} onclose={() => (loeschen = null)}>
    <p class="text">{t(lang, 'confirmDelete', loeschen.eintrag.name)}</p>
    {#if imInGespann(loeschen.art, loeschen.eintrag)}<p class="text">{t(lang, 'confirmDeleteGespann')}</p>{/if}
    <div class="aktionen">
      <button type="button" class="btn btn-ghost" onclick={() => (loeschen = null)}>{t(lang, 'cancel')}</button>
      <button type="button" class="btn btn-danger" disabled={laeuft} onclick={entferne}>{t(lang, 'remove')}</button>
    </div>
  </Fenster>
{/if}

{#if garageLoeschen}
  <Fenster {lang} titel={t(lang, 'deleteGarageTitle')} onclose={() => (garageLoeschen = false)}>
    <p class="text">{t(lang, 'deleteGarageText')}</p>
    <div class="aktionen">
      <button type="button" class="btn btn-ghost" onclick={() => (garageLoeschen = false)}>{t(lang, 'cancel')}</button>
      <button type="button" class="btn btn-danger" disabled={laeuft} onclick={entferneGarage}>{t(lang, 'deleteGarageAll')}</button>
    </div>
  </Fenster>
{/if}

<style>
  /* Persönlicher Link: eine schmale Zeile, die Erklärung steht hinter dem i-Symbol */
  .link { position: relative; display: flex; align-items: center; gap: .5rem .75rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .linkkopf { display: flex; align-items: center; gap: .25rem; }
  .linkkopf label { margin: 0; white-space: nowrap; }
  /* Link, Kopieren und Reichweitenplaner: alle gleich hoch wie das Textfeld */
  .link .input { flex: 1; min-width: 12rem; height: 2.5rem; font-family: ui-monospace, monospace; }
  .link .btn { height: 2.5rem; display: inline-flex; align-items: center; }
  .info { display: inline-flex; }
  .emailknopf.ok { border-color: var(--primary); color: var(--primary); }
  .emailknopf.offen { border-color: var(--amber); color: var(--amber); }
  .infoknopf {
    display: inline-flex; align-items: center; justify-content: center; padding: .125rem; background: transparent; border: none;
    border-radius: 999px; color: var(--fg-muted); cursor: pointer; transition: color .15s;
  }
  .infoknopf:hover, .infoknopf[aria-expanded="true"] { color: var(--primary); }
  .infoknopf:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .tip {
    display: none; position: absolute; top: calc(100% + .375rem); left: 0; z-index: 30; width: min(22rem, 100%);
    padding: .75rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0,0,0,.3); font-size: .8125rem; line-height: 1.5; color: var(--fg-muted);
  }
  .info:hover .tip, .info:focus-within .tip, .tip.offen { display: block; }
  .planer-knopf { margin: 0; }
  .kachel { display: flex; }
  /* Profil oben rechts im Garagenbild: Fahrergewicht */
  .profil-knopf {
    width: 2.4rem; height: 2.4rem; border-radius: 999px; padding: 0; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--bg-card) 85%, transparent); color: var(--fg); border: 1px solid var(--border);
  }
  .profil-knopf:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .profil-form { display: flex; flex-direction: column; gap: .5rem; }
  .profil-hinweis { font-size: .8125rem; color: var(--fg-muted); margin: 0; }
  .profil-aktionen { display: flex; justify-content: flex-end; gap: .5rem; margin-top: .5rem; }

  /* Echte Tabs: eine Linie unter dem Tab-Streifen; der aktive Tab ist oben grün abgesetzt und mit dem Inhalt darunter verbunden */
  .tabs { display: flex; gap: .25rem; margin-bottom: 1.5rem; padding: 0 .5rem; border-bottom: 1px solid var(--border); }
  .tab {
    display: inline-flex; align-items: center; margin-bottom: -1px; padding: .625rem 1.25rem;
    border: 1px solid var(--border); border-top-width: 2px; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    background: var(--bg-card); color: var(--fg-muted); font-family: inherit; font-size: .9375rem; font-weight: 500; cursor: pointer; transition: all .15s;
  }
  .tab:hover { background: var(--bg-hover); color: var(--fg); }
  .tab.aktiv { background: var(--bg); color: var(--fg); font-weight: 600; border-top-color: var(--primary); border-bottom-color: var(--bg); }
  .tab:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
  /* Anzahl als eigene Marke (Zahl in einem Kreis), damit sie nicht wie ein Teil des Namens wirkt */
  .anzahl {
    display: inline-flex; align-items: center; justify-content: center; min-width: 1.375rem; height: 1.375rem; margin-left: .5rem; padding: 0 .4rem;
    border: 1px solid var(--border); border-radius: 999px; background: var(--bg-hover); color: var(--fg); font-size: .75rem; font-weight: 700; line-height: 1;
  }
  .tab.aktiv .anzahl { background: var(--primary-bg); border-color: var(--primary); color: var(--primary); }
  .hinweis { margin-bottom: 1rem; }
  /* Die Kacheln stehen links; rechts bleibt Platz für den Lichtschalter im Garagenbild */
  .liste { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.25rem, 1fr)); gap: .75rem; padding: 0; width: 72%; }
  .kachel { cursor: grab; border-radius: var(--radius); aspect-ratio: 1 / 1; display: flex; }
  .kachel:active { cursor: grabbing; }
  .kachel > :global(article) { height: 100%; }
  .gezogen { opacity: .4; }
  .ziel { outline: 2px dashed var(--primary); outline-offset: 3px; }
  .plus-wrap { display: flex; aspect-ratio: 1 / 1; }
  .plus-kachel {
    flex: 1;
    min-height: 9rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5rem;
    background: transparent; color: var(--fg-muted); border: 1px dashed var(--border); border-radius: var(--radius);
    font-family: inherit; font-size: .875rem; cursor: pointer; transition: all .15s;
  }
  .plus-kachel:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
  .plus-kachel:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .plus-kachel:disabled { opacity: .5; cursor: not-allowed; }
  .artwahl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  .artknopf {
    display: flex; flex-direction: column; align-items: center; gap: .5rem; padding: 1.5rem 1rem; background: var(--bg-input); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius); font-family: inherit; font-size: .9375rem; font-weight: 600; cursor: pointer; transition: all .15s;
  }
  .artknopf :global(svg) { color: var(--primary); }
  .artknopf:hover:not(:disabled) { border-color: var(--primary); background: var(--primary-bg); }
  .artknopf:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .artknopf:disabled { opacity: .5; cursor: not-allowed; }
  .unten { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
  .aktionen { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
  @media (min-width: 640px) { .liste { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1000px) { .liste { grid-template-columns: repeat(3, 1fr); } }
</style>
