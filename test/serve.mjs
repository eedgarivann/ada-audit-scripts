import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = new URL('./fixtures/', import.meta.url).pathname;
const PORT = Number(process.argv[2] || 4175);
http
  .createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end('read-only test site');
    }
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index-good.html');
    if (!p.startsWith(root) || !fs.existsSync(p)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(p));
  })
  .listen(PORT, '127.0.0.1', () => console.log('journey test site on', PORT));
