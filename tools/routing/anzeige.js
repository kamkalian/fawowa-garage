// Kleiner lokaler Server zum Ansehen der Ergebnisse (nur Zeichnung der erreichbaren Fläche, ohne Kartenkacheln).
// Aufruf: node tools/routing/anzeige.js <Ergebnisordner> [Port]   →   http://localhost:3499
import { createServer } from 'http';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ordner = process.argv[2];
const port = Number(process.argv[3]) || 3499;
const hier = dirname(fileURLToPath(import.meta.url));
createServer((req, res) => {
  const pfad = decodeURIComponent(req.url.split('?')[0]);
  if (pfad === '/') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(readFileSync(join(hier, 'anzeige.html')));
  if (pfad === '/liste') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(readdirSync(ordner).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))));
  const m = /^\/ergebnisse\/([\w.-]+)\.json$/.exec(pfad);
  if (m && existsSync(join(ordner, `${m[1]}.json`))) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(readFileSync(join(ordner, `${m[1]}.json`)));
  res.writeHead(404).end('nicht gefunden');
}).listen(port, '127.0.0.1', () => console.log(`Anzeige auf http://localhost:${port}`));
