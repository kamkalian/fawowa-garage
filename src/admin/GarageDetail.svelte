<script>
  import { onMount } from 'svelte';
  import { ARTEN, GESPANN_FELDER, FAHRER_NAME_FELD } from '../../lib/felder.js';
  import { api } from './api.js';
  import { datum } from './anzeige.js';
  import Eintrag from './Eintrag.svelte';
  import Dialog from './Dialog.svelte';

  // Eine Garage mit allen Einträgen: prüfen, Notizen, Name korrigieren, Spam entfernen
  let { id, onzurueck, onaenderung } = $props();

  let g = $state(null);
  let fehler = $state('');
  let meldung = $state('');
  let laeuft = $state(false);
  let namenEdit = $state(null);     // null oder der Text im Eingabefeld
  let loeschen = $state(null);      // { art, eintrag } | 'garage' | null

  async function laden() {
    try {
      g = await api('GET', `/garagen/${id}`);
      fehler = '';
    } catch (e) {
      fehler = e.message;
    }
  }
  onMount(laden);

  const nachId = (art, nr) => (g[art === 'fahrraeder' ? 'fahrraeder' : 'anhaenger'].find(e => e.id === nr)?.name ?? null);
  // Geprüft wird pro Stellplatz (Fahrräder und Anhänger); das Gespann selbst wird nicht mehr geprüft
  const alleEintraege = $derived(g ? [...g.fahrraeder, ...g.anhaenger, ...g.gepaecke] : []);
  const ungeprueft = $derived(alleEintraege.filter(e => e.status !== 'geprueft').length);

  const ABSCHNITTE = [
    { art: 'fahrraeder', titel: 'Fahrräder', felder: ARTEN.fahrraeder.felder },
    { art: 'anhaenger', titel: 'Anhänger', felder: ARTEN.anhaenger.felder },
    { art: 'gepaecke', titel: 'Gepäck', felder: ARTEN.gepaecke.felder }
  ];

  // Welche Einträge im Gespann stecken, mit Namen und Gesamtgewicht des Gepäcks
  const imGespann = (liste, ids) => liste.filter(e => ids.includes(e.id));
  const namenText = (liste) => (liste.length ? liste.map(e => e.name).join(', ') : 'keine');
  const gepaeckKg = (liste) => liste.reduce((s, e) => s + (Number(e.gewicht_kg) || 0), 0);

  async function eintragAendern(art, eintrag, aenderung) {
    const r = await api('PATCH', `/eintraege/${art}/${eintrag.id}`, aenderung);
    Object.assign(eintrag, r);
    onaenderung();
  }

  async function alleSetzen(status) {
    laeuft = true;
    meldung = '';
    try {
      await api('POST', `/garagen/${id}/pruefen`, { status });
      await laden();
      onaenderung();
      meldung = status === 'geprueft' ? 'Alle Einträge sind als geprüft markiert.' : 'Alle Einträge sind zurückgesetzt.';
    } catch (e) { fehler = e.message; } finally { laeuft = false; }
  }

  async function nameSpeichern(e) {
    e.preventDefault();
    laeuft = true;
    fehler = '';
    try {
      const r = await api('PATCH', `/garagen/${id}`, { fahrer_name: namenEdit });
      g.fahrer_name = r.fahrer_name;
      namenEdit = null;
      onaenderung();
    } catch (err) { fehler = err.message; } finally { laeuft = false; }
  }

  async function bestaetigtLoeschen() {
    const ziel = loeschen;
    laeuft = true;
    try {
      if (ziel === 'garage') {
        await api('DELETE', `/garagen/${id}`);
        onaenderung();
        onzurueck();
        return;
      }
      await api('DELETE', `/eintraege/${ziel.art}/${ziel.eintrag.id}`);
      await laden();
      onaenderung();
    } catch (e) { fehler = e.message; } finally { laeuft = false; loeschen = null; }
  }

  const loeschText = $derived(loeschen === 'garage'
    ? `Die Garage von „${g?.fahrer_name ?? 'Ohne Namen'}“ (Nr. ${id}) mit allen Einträgen wird endgültig gelöscht. Ihr Link gilt danach nicht mehr.`
    : loeschen ? `„${loeschen.eintrag.name ?? 'Gespann'}“ wird endgültig gelöscht.` : '');
</script>

<button type="button" class="btn btn-ghost btn-sm zurueck" onclick={onzurueck}>← Alle Garagen</button>

{#if fehler}<p class="meldung-fehler" role="alert">{fehler}</p>{/if}
{#if !g && !fehler}<p class="muted">Lade ...</p>{/if}

{#if g}
  <section class="kopf" aria-labelledby="garage-titel">
    <div class="titelzeile">
      {#if namenEdit === null}
        <h2 id="garage-titel">{g.fahrer_name ?? 'Ohne Namen'} <span class="nr">Nr. {g.id}</span></h2>
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => (namenEdit = g.fahrer_name ?? '')}>Namen ändern</button>
      {:else}
        <form class="namenform" onsubmit={nameSpeichern}>
          <input class="input" type="text" maxlength={FAHRER_NAME_FELD.max} aria-label="Name" bind:value={namenEdit} />
          <button type="submit" class="btn btn-primary btn-sm" disabled={laeuft}>Speichern</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => (namenEdit = null)}>Abbrechen</button>
        </form>
      {/if}
    </div>
    <dl class="info">
      <dt>E-Mail</dt>
      <dd>{#if g.email}{g.email} <span class="notiz">(bestätigt {datum(g.email_bestaetigt_am, true)})</span>{:else}keine bestätigte Adresse{/if}</dd>
      <dt>Angelegt</dt><dd>{datum(g.erstellt_am, true)}</dd>
      <dt>Zuletzt genutzt</dt><dd>{datum(g.zuletzt_genutzt_am, true)}</dd>
    </dl>

    <div class="aktionen">
      <span class="badge {ungeprueft ? 'badge-check' : 'badge-active'}">{ungeprueft ? `${ungeprueft} ungeprüft` : 'alles geprüft'}</span>
      <button type="button" class="btn btn-primary btn-sm" disabled={laeuft || !ungeprueft} onclick={() => alleSetzen('geprueft')}>Alle als geprüft markieren</button>
      <button type="button" class="btn btn-outline btn-sm" disabled={laeuft || ungeprueft === alleEintraege.length} onclick={() => alleSetzen('ungeprueft')}>Alle zurücksetzen</button>
      <span class="abstand"></span>
      <button type="button" class="btn btn-ghost btn-sm gefahr" disabled={laeuft} onclick={() => (loeschen = 'garage')}>Garage löschen</button>
    </div>
    {#if meldung}<p class="meldung-ok" role="status">{meldung}</p>{/if}
  </section>

  {#if g.mitglieder}
    {@const im = g.mitglieder}
    <section class="abschnitt" aria-labelledby="ab-gespann">
      <h3 id="ab-gespann">Gespann</h3>
      <dl class="gespann">
        <dt>Fahrergewicht</dt><dd>{g.gespann?.fahrer_gewicht_kg ? `${g.gespann.fahrer_gewicht_kg} kg` : 'nicht angegeben'}</dd>
        <dt>Zugfahrzeug</dt><dd>{namenText(imGespann(g.fahrraeder, im.fahrraeder))}</dd>
        <dt>Anhänger</dt><dd>{namenText(imGespann(g.anhaenger, im.anhaenger))}</dd>
        <dt>Gepäck</dt><dd>{namenText(imGespann(g.gepaecke, im.gepaecke))} ({gepaeckKg(imGespann(g.gepaecke, im.gepaecke)).toLocaleString('de-DE')} kg)</dd>
      </dl>
    </section>
  {/if}

  {#each ABSCHNITTE as ab (ab.art)}
    <section class="abschnitt" aria-labelledby="ab-{ab.art}">
      <h3 id="ab-{ab.art}">{ab.titel} ({g[ab.art].length})</h3>
      {#if !g[ab.art].length}
        <p class="notiz">Keine {ab.titel}.</p>
      {:else}
        <div class="raster">
          {#each g[ab.art] as e (e.id)}
            <Eintrag eintrag={e} felder={ab.felder} {nachId}
              foto={e.foto_vorhanden ? `/api/admin/garagen/${g.id}/foto/${ab.art}/${e.id}` : null}
              onaendern={(a) => eintragAendern(ab.art, e, a)} onloeschen={() => (loeschen = { art: ab.art, eintrag: e })} />
          {/each}
        </div>
      {/if}
    </section>
  {/each}

{/if}

{#if loeschen}
  <Dialog titel="Endgültig löschen?" onclose={() => (loeschen = null)}>
    <p class="text">{loeschText}</p>
    <div class="dialog-aktionen">
      <button type="button" class="btn btn-ghost" onclick={() => (loeschen = null)}>Abbrechen</button>
      <button type="button" class="btn btn-danger" disabled={laeuft} onclick={bestaetigtLoeschen}>Löschen</button>
    </div>
  </Dialog>
{/if}

<style>
  .zurueck { margin-bottom: 1rem; }
  .kopf { display: flex; flex-direction: column; gap: .75rem; margin-bottom: 1.5rem; }
  .titelzeile { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .nr { font-size: .8125rem; font-weight: 400; color: var(--fg-muted); margin-left: .5rem; }
  .namenform { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
  .namenform .input { width: 16rem; max-width: 100%; }
  .info { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1rem; font-size: .875rem; }
  .info dt { color: var(--fg-muted); }
  .aktionen { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
  .abstand { flex: 1; }
  .gefahr { color: var(--danger); }
  .abschnitt { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
  .abschnitt h3 { font-size: 1rem; margin-bottom: 1rem; }
  .raster { display: grid; grid-template-columns: 1fr; gap: 1rem; }
  @media (min-width: 760px) { .raster { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 1200px) { .raster { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
