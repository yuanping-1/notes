'use strict';

/**
 * 生成暗色主题预览副本（仅开发期验证用）。
 *
 * 为什么需要单独处理：<head> 里那段内联脚本会在解析时按
 * localStorage / prefers-color-scheme 覆写 data-theme，
 * 所以直接给 <html> 加 data-theme="dark" 会被它冲掉，
 * 截图看起来和浅色完全一样，容易误判成"暗色样式没生效"。
 *
 * 这里做两件事：摘掉那段内联引导脚本，再强制 data-theme="dark"。
 */

const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');

const TARGETS = ['index.html', 'posts/perovskite-halide-segregation.html', 'tags/index.html'];

let n = 0;
for (const rel of TARGETS) {
  const src = path.join(DIST, rel);
  if (!fs.existsSync(src)) continue;

  let html = fs.readFileSync(src, 'utf8');

  // 摘掉含 blog-theme 的内联脚本，否则 data-theme 会被它覆盖
  const before = html.length;
  html = html.replace(/<script>[\s\S]*?blog-theme[\s\S]*?<\/script>/, '');
  if (html.length === before) {
    console.warn(`  ! ${rel}: 没找到内联主题脚本，跳过`);
    continue;
  }

  html = html.replace('<html lang="zh-CN"', '<html lang="zh-CN" data-theme="dark"');

  const out = path.join(DIST, `__dark_${rel.replace(/[\\/]/g, '_')}`);
  fs.writeFileSync(out, html, 'utf8');
  n++;
}
console.log(`已生成 ${n} 个暗色预览副本到 dist/__dark_*.html`);
