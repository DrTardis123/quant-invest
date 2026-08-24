// 개발용 로컬 서버 (http://localhost:5180)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/LG/Documents/quant_invest/public';
const PORT = 5180;
const MIME = {
  'html': 'text/html;charset=utf-8',
  'js': 'application/javascript;charset=utf-8',
  'css': 'text/css;charset=utf-8',
  'json': 'application/json;charset=utf-8',
  'png': 'image/png',
  'svg': 'image/svg+xml',
  'ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0].replace(/\.+/g, '');
  if (url === '/') url = '/index.html';
  let fp = path.join(ROOT, url);
  if (!fs.existsSync(fp)) {
    res.writeHead(404);
    res.end('Not found: ' + url);
    return;
  }
  const ext = path.extname(fp).slice(1).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'text/plain',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(fp).pipe(res);
});

server.listen(PORT, () => {
  console.log(`🚀 Dev server: http://localhost:${PORT}`);
  console.log(`  Root: ${ROOT}`);
});
