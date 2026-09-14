'use strict';

/**
 * 本地预览服务器（零依赖）。
 *
 * 为什么不直接双击 dist/index.html：
 *   file:// 下 navigator.clipboard 不可用（非安全上下文），代码复制会走降级路径；
 *   且 <link>/<script> 的相对路径行为与真实部署有差异。
 * 起一个本地 HTTP 服务能复现线上环境。
 *
 * 用法：node src/serve.js [端口]    默认 4173
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.argv[2]) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

const server = http.createServer((req, res) => {
  // 只取 pathname，丢掉查询串与 hash；再 decode 一次以支持中文文件名（标签页用的就是中文）
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  let target = path.join(DIST, pathname);

  // 目录穿越防护：解析后的路径必须仍在 dist 内
  if (!path.resolve(target).startsWith(DIST)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }

  if (!fs.existsSync(target)) {
    const notFound = path.join(DIST, '404.html');
    res.writeHead(404, { 'Content-Type': MIME['.html'] });
    res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : '404 Not Found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    // 本地预览时禁用缓存，否则改了 CSS 刷新看不到变化
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, () => {
  console.log(`预览地址 http://localhost:${PORT}`);
  console.log('产物目录 dist/，按 Ctrl+C 退出');
});
