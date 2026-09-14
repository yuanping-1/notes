'use strict';

/**
 * 布局溢出探针（仅开发期使用，不属于站点产物）。
 *
 * 用途：把 dist 里的页面复制一份，在 </body> 前注入一段同步测量脚本，
 * 输出 scrollWidth / clientWidth 以及所有右边界超出视口的元素。
 * 配合 headless Chrome 的 --dump-dom 就能拿到真实布局数据，
 * 比肉眼看截图判断"是不是溢出了"可靠得多。
 *
 * 用法：node tools/probe-overflow.js           # 生成探针副本
 *       （随后用 chrome --dump-dom 打开 dist/__probe_*.html 读取结果）
 */

const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');

const TARGETS = [
  'index.html',
  'posts/perovskite-halide-segregation.html',
  'posts/trpl-lifetime-fitting.html',
  'posts/jv-measurement-pitfalls.html',
  'tags/index.html',
  'categories/index.html',
  'about.html',
];

const PROBE = `<div id="probeout"></div>
<script>
(function () {
  var de = document.documentElement;
  var over = [];
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var r = el.getBoundingClientRect();
    // 只报告真正的越界元素；子元素跟随父元素越界会重复报告，交给调用方自行判读
    if (r.right > de.clientWidth + 1) {
      var cls = el.className ? '.' + String(el.className).split(' ')[0] : '';
      over.push(el.tagName.toLowerCase() + cls + '@' + Math.round(r.right) + ',w' + Math.round(r.width));
    }
  }
  document.getElementById('probeout').textContent =
    'PROBE sw=' + de.scrollWidth + ' cw=' + de.clientWidth +
    ' over=' + over.length + ' :: ' + over.slice(0, 8).join(' | ');
})();
</script>`;

let n = 0;
for (const rel of TARGETS) {
  const src = path.join(DIST, rel);
  if (!fs.existsSync(src)) continue;
  const html = fs.readFileSync(src, 'utf8');
  if (!html.includes('</body>')) continue;
  const out = path.join(DIST, `__probe_${rel.replace(/[\\/]/g, '_')}`);
  fs.writeFileSync(out, html.replace('</body>', PROBE + '\n</body>'), 'utf8');
  n++;
}
console.log(`已生成 ${n} 个探针文件到 dist/__probe_*.html`);
