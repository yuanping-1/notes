'use strict';

/**
 * 构建产物全量校验：断链 / 缺失锚点 / 重复 id / 标签配平 / 样式引用 / RSS 绝对链接。
 *
 * 为什么自己写而不用现成的 HTML 校验器：站点是零依赖项目，产物也是我们自己生成的，
 * 结构可控，正则足够。引入 htmlhint 之类会破坏"零依赖"这个刻意约束。
 *
 * 用法：node tools/validate.js
 * 退出码：0 = 全过；1 = 有错误
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

/**
 * 子路径部署的前缀，从 site.config.js 的 url 推导。
 * 只有 404.html 允许（也必须）用带这个前缀的绝对路径，理由见 build.js 的 notFoundRoot。
 */
const BASE_PATH = (() => {
  try {
    const url = require(path.join(ROOT, 'site.config')).url;
    if (!url) return '/';
    const p = new URL(url).pathname;
    return p.endsWith('/') ? p : `${p}/`;
  } catch {
    return '/';
  }
})();

// 自闭合 / void 元素，不参与配平统计
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// 只检查这些标签的配平。div/span 数量大且嵌套深，出问题概率低，
// 更重要的是结构性标签：表格、列表、段落、代码块。
const BALANCE_TAGS = [
  'html', 'head', 'body', 'header', 'footer', 'main', 'nav', 'article',
  'section', 'aside', 'div', 'ul', 'ol', 'li', 'table', 'thead', 'tbody',
  'tr', 'td', 'th', 'p', 'pre', 'code', 'blockquote', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'figure', 'figcaption', 'details', 'summary',
];

const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** 把 URL 里的百分号编码还原成文件系统里的真实名字 */
function decode(p) {
  try {
    return decodeURIComponent(p);
  } catch {
    return p; // 非法编码，原样返回，后面按文件找不到处理
  }
}

/** 相对 dist 的展示用路径，统一用 / 分隔 */
function rel(full) {
  return path.relative(DIST, full).split(path.sep).join('/');
}

/** 去掉 HTML 注释，避免把注释里的标签算进配平 */
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** 取出一个页面里所有 id 的集合 */
function collectIds(html) {
  const ids = new Map(); // id -> 出现次数
  const re = /\sid\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    ids.set(id, (ids.get(id) || 0) + 1);
  }
  return ids;
}

/** 收集引用：href / src */
function collectRefs(html) {
  const refs = [];
  const re = /\s(?:href|src)\s*=\s*["']([^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  return refs;
}

function isExternal(url) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) || url.startsWith('data:');
}

/**
 * 把一个引用解析成 dist 下的绝对路径。
 * 返回 { file, anchor } 或 null（外链/空引用）。
 */
function resolveRef(url, fromFile) {
  if (!url) return null;
  if (isExternal(url)) return null;

  let target = url;
  let anchor = '';
  const hashAt = target.indexOf('#');
  if (hashAt !== -1) {
    anchor = decode(target.slice(hashAt + 1));
    target = target.slice(0, hashAt);
  }

  if (target === '') {
    // 纯锚点引用，指向当前页
    return { file: fromFile, anchor };
  }

  const clean = decode(target.split('?')[0]);

  // 以 / 开头的引用只有 404 页会用（见 build.js 的 notFoundRoot）；解析前先剥掉
  // 子路径前缀，否则会被当成 dist/notes/... 然后误报断链。
  let rel0 = clean.startsWith('/') ? clean.slice(1) : clean;
  if (clean.startsWith('/') && BASE_PATH !== '/' && rel0.startsWith(BASE_PATH.slice(1))) {
    rel0 = rel0.slice(BASE_PATH.length - 1);
  }

  const fromDir = path.dirname(fromFile);
  const base = clean.startsWith('/') ? DIST : fromDir;
  let full = path.resolve(base, rel0);

  // 目录引用补 index.html
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    full = path.join(full, 'index.html');
  } else if (!fs.existsSync(full) && !path.extname(full)) {
    const alt = path.join(full, 'index.html');
    if (fs.existsSync(alt)) full = alt;
  }

  return { file: full, anchor };
}

function checkTagBalance(html, label) {
  const clean = stripComments(html);
  for (const tag of BALANCE_TAGS) {
    // 只统计成对的开闭标签，跳过自闭合写法 <br /> 与 <div/>
    const openRe = new RegExp(`<${tag}(?:\\s[^>]*?)?(?<!/)>`, 'gi');
    const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
    const open = (clean.match(openRe) || []).length;
    const close = (clean.match(closeRe) || []).length;
    if (open !== close) {
      errors.push(`标签不配平：${label} 的 <${tag}> 开 ${open} 闭 ${close}`);
    }
  }
  void VOID_TAGS;
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('找不到 dist/，先跑 node src/build.js');
    process.exit(1);
  }

  const files = walk(DIST);
  const htmlFiles = files.filter((f) => f.endsWith('.html'));

  // 预读所有页面的 id 集合，供锚点检查
  const idIndex = new Map();
  let totalIds = 0;

  for (const f of htmlFiles) {
    const html = fs.readFileSync(f, 'utf8');
    const ids = collectIds(html);

    for (const [id, count] of ids) {
      totalIds += count;
      if (count > 1) {
        errors.push(`重复 id：${rel(f)} 里 "${id}" 出现 ${count} 次`);
      }
    }
    idIndex.set(f, ids);

    // 顺带检查每个页面自身的结构
    const doctype = /^\s*<!DOCTYPE html>/i.test(html);
    if (!doctype) errors.push(`缺少 DOCTYPE：${rel(f)}`);

    const lang = /<html[^>]*\slang\s*=\s*["'][^"']+["']/i.test(html);
    if (!lang) warnings.push(`<html> 没写 lang：${rel(f)}`);

    const title = /<title>([\s\S]*?)<\/title>/i.exec(html);
    if (!title || !title[1].trim()) errors.push(`缺少 title：${rel(f)}`);

    checkTagBalance(html, rel(f));
  }

  // 逐页检查引用
  const allFiles = new Set(files.map((f) => path.resolve(f)));
  let checkedRefs = 0;
  let checkedAnchors = 0;
  const rootRefs = [];
  const badBaseRefs = [];

  for (const f of htmlFiles) {
    const html = fs.readFileSync(f, 'utf8');
    const is404 = rel(f) === '404.html';

    for (const url of collectRefs(html)) {
      if (isExternal(url)) continue;
      if (url.startsWith('data:')) continue;

      if (url.startsWith('/')) {
        // 404 页是唯一允许用绝对路径的页面（它被任意深度的错误 URL 复用，
        // 相对路径会被解析到错误目录去），但前缀必须等于配置的部署子路径。
        if (!is404) {
          rootRefs.push(`${rel(f)} → ${url}`);
        } else if (BASE_PATH !== '/' && !url.startsWith(BASE_PATH)) {
          badBaseRefs.push(`${rel(f)} → ${url}（应以前缀 ${BASE_PATH} 开头）`);
        }
      }

      const r = resolveRef(url, f);
      if (!r) continue;
      checkedRefs++;

      if (!fs.existsSync(r.file)) {
        errors.push(`断链：${rel(f)} → ${url}`);
        continue;
      }

      // 锚点只在指向 HTML 时校验
      if (r.anchor && r.file.endsWith('.html')) {
        const targetIds = idIndex.get(path.resolve(r.file));
        if (targetIds) {
          checkedAnchors++;
          if (!targetIds.has(r.anchor)) {
            errors.push(`缺失锚点：${rel(f)} → ${url}（目标页无 id "${r.anchor}"）`);
          }
        }
      }
    }
  }

  // 引用了但没进构建的文件（例如指向源码里的 .md）
  for (const f of htmlFiles) {
    const html = fs.readFileSync(f, 'utf8');
    for (const url of collectRefs(html)) {
      if (isExternal(url)) continue;
      if (/\.md(?:#|$)/i.test(url)) {
        warnings.push(`引用了 Markdown 源文件：${rel(f)} → ${url}`);
      }
    }
  }

  if (rootRefs.length) {
    errors.push(
      `发现 ${rootRefs.length} 处以 / 开头的绝对路径引用，子路径部署会 404：\n    ` +
        rootRefs.slice(0, 5).join('\n    ') +
        (rootRefs.length > 5 ? `\n    …另有 ${rootRefs.length - 5} 处` : '')
    );
  }

  if (badBaseRefs.length) {
    errors.push(
      `404.html 有 ${badBaseRefs.length} 处绝对路径前缀不对（当前部署前缀 ${BASE_PATH}）：\n    ` +
        badBaseRefs.slice(0, 5).join('\n    ')
    );
  }

  // 子路径部署下，404 页若用了相对路径会掉样式；这里反向兜一下
  if (BASE_PATH !== '/') {
    const p404 = path.join(DIST, '404.html');
    if (!fs.existsSync(p404)) {
      errors.push('缺少 404.html；GitHub Pages 会用默认兜底页，站内风格丢失');
    } else {
      const refs404 = collectRefs(fs.readFileSync(p404, 'utf8')).filter(
        (u) => !isExternal(u)
      );
      // 纯锚点（#main 这类跳转链接）指向当前页，不受部署路径影响，不算相对路径
      const relative = refs404.filter((u) => !u.startsWith('/') && !u.startsWith('#'));
      if (relative.length) {
        errors.push(
          `404.html 用了 ${relative.length} 处相对路径（子路径部署下会被解析到错误目录）：` +
            relative.slice(0, 3).join(', ')
        );
      }
    }
  }

  // RSS 必须是绝对链接，否则阅读器解析不了
  const feed = path.join(DIST, 'feed.xml');
  if (fs.existsSync(feed)) {
    const xml = fs.readFileSync(feed, 'utf8');
    const links = [...xml.matchAll(/<link>([\s\S]*?)<\/link>/g)].map((m) => m[1].trim());
    const relative = links.filter((l) => l && !/^https?:\/\//i.test(l));
    if (relative.length) {
      errors.push(
        `RSS 里有 ${relative.length} 个相对链接（site.config.js 的 url 没填？）：` +
          relative.slice(0, 3).join(', ')
      );
    }
  }

  // 打印结果
  const counts = {};
  for (const f of files) {
    const ext = path.extname(f) || '(无扩展名)';
    counts[ext] = (counts[ext] || 0) + 1;
  }

  console.log('构建产物校验');
  console.log('─'.repeat(52));
  console.log(`文件总数    ${files.length}`);
  console.log(
    `  按类型    ${Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join('  ')}`
  );
  console.log(`HTML 页面   ${htmlFiles.length}`);
  console.log(`部署前缀    ${BASE_PATH}${BASE_PATH === '/' ? '（根域 / file://）' : '（子路径）'}`);
  console.log(`页面内 id   ${totalIds}`);
  console.log(`检查引用    ${checkedRefs}（其中锚点 ${checkedAnchors}）`);
  console.log('─'.repeat(52));

  if (warnings.length) {
    console.log(`\n警告 ${warnings.length} 条：`);
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  if (errors.length) {
    console.log(`\n错误 ${errors.length} 条：`);
    for (const e of errors) console.log(`  × ${e}`);
    console.log(`\n校验未通过。`);
    process.exit(1);
  }

  console.log(`\n校验通过，0 错误。`);
}

main();
