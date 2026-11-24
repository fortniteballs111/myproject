import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = new URL('../dist/', import.meta.url);
const index = new URL('index.html', dist);
const html = await readFile(index, 'utf8');
if (!html.includes('href="/manifest.webmanifest"')) await writeFile(index, html.replace('<html lang="en">', '<html lang="ru">').replace('</head>', `
  <meta name="theme-color" content="#09090B" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icon-192.png" />
</head>`));
const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => pathToFileURL(join(entry.parentPath, entry.name)))
  .map(url => url.href.slice(dist.href.length))
  .filter(path => path !== 'sw.js' && !path.endsWith('.map'))
  .sort();
const version = createHash('sha256');
const worker = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
version.update(worker);
for (const path of files) {
  version.update(path);
  version.update(await readFile(new URL(path, dist)));
}
await writeFile(new URL('sw.js', dist),
  'const BUILD = ' + JSON.stringify(version.digest('hex').slice(0, 16)) + ';\n' +
  'const FILES = ' + JSON.stringify(files) + ';\n' + worker);
