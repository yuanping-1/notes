'use strict';

/**
 * 零依赖 Markdown 渲染器。
 *
 * 为什么不用 marked / markdown-it：
 * 本机 npm 不在 PATH，引第三方包要么装不上、要么引入离线风险；
 * 且博客正文需要两个强约束——稳定的标题锚点、以及数学公式不被强调语法吃掉。
 * 自己实现可以让这两点完全受控，输出结构也不会随依赖版本漂移。
 *
 * 支持范围：frontmatter、标题、段落、围栏代码、引用、有序/无序/嵌套列表、
 * 任务列表、GFM 表格、分隔线、行内代码、链接、图片、粗体/斜体/删除线/高亮、行内与块级公式。
 */

const { highlight } = require('./highlight');

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** FNV-1a：给锚点做短哈希，避免中文标题产生无法稳定复现的 id */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * 生成标题锚点。
 * 保留中文与 ASCII 字母数字，其余字符折叠成连字符：
 * 「现象：光照诱导的可逆带隙收缩」→「现象-光照诱导的可逆带隙收缩」。
 * 这样复制出去的链接是可读的，浏览器地址栏会显示原文而不是一串哈希。
 * 纯符号标题会退化成空串，此时用内容哈希兜底，保证 id 始终合法且稳定。
 */
function slugify(text, used) {
  let base = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) base = `sec-${fnv1a(text)}`;
  let id = base;
  if (used) {
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* frontmatter                                                         */
/* ------------------------------------------------------------------ */

/**
 * 解析极简 YAML frontmatter。只支持博客会用到的形态：
 * key: value、key: [a, b]、以及 key: 换行后的 "- item" 列表。
 * 不做完整 YAML —— 引一个 YAML 解析器不值得，而多行嵌套对象在博客里没有场景。
 */
function parseFrontmatter(raw) {
  const m = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: raw };

  const data = {};
  const lines = m[1].split(/\r?\n/);
  let pendingKey = null;

  for (const line of lines) {
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;

    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && pendingKey) {
      data[pendingKey].push(unquote(listItem[1].trim()));
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();

    if (value === '') {
      data[key] = [];
      pendingKey = key;
      continue;
    }
    if (/^\[.*\]$/.test(value)) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
    } else {
      data[key] = unquote(value);
    }
    pendingKey = null;
  }
  return { data, body: raw.slice(m[0].length) };
}

function unquote(v) {
  const m = String(v).match(/^(['"])([\s\S]*)\1$/);
  return m ? m[2] : v;
}

/* ------------------------------------------------------------------ */
/* 行内渲染                                                            */
/* ------------------------------------------------------------------ */

function renderInline(text) {
  const stash = [];
  const keep = (html) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let s = String(text);

  // 先摘出代码段与公式：它们内部的下划线、星号不能被当成强调语法。
  // 顺序不能反 —— 代码段优先，否则 `a_b` 里的内容会被当数学处理。
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(/\$\$([^$\n]+?)\$\$/g, (_, tex) =>
    keep(`<span class="math-inline math-inline--display">\\displaystyle ${escapeHtml(tex.trim())}</span>`)
  );
  // 行内公式：首尾不允许空白，避免把 "价格是 $5 到 $10" 这种文本误判成公式
  s = s.replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (_, tex) =>
    keep(`<span class="math-inline">\\(${escapeHtml(tex)}\\)</span>`)
  );

  s = escapeHtml(s);

  // 图片须在链接之前处理，否则 ![...] 的前导感叹号会被遗留
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, src, title) =>
      `<figure class="figure"><img src="${src}" alt="${alt}" loading="lazy">${
        alt ? `<figcaption>${alt}</figcaption>` : ''
      }</figure>`
  );
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, label, href, title) => {
      const external = /^https?:\/\//i.test(href);
      // 外链加 target/rel：博客正文里的引用链接不该把读者带离当前上下文后无法返回
      const attrs = external
        ? ' target="_blank" rel="noopener noreferrer"'
        : '';
      return `<a href="${href}"${title ? ` title="${title}"` : ''}${attrs}>${label}</a>`;
    }
  );

  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<![\w*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\w*])/g, '<em>$1</em>');
  s = s.replace(/(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/==(.+?)==/g, '<mark>$1</mark>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => stash[Number(n)]);
}

/* ------------------------------------------------------------------ */
/* 块级解析                                                            */
/* ------------------------------------------------------------------ */

const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_FENCE = /^(\s*)(`{3,}|~{3,})\s*([A-Za-z0-9+#._-]*)\s*$/;
const RE_BQ = /^\s{0,3}>\s?(.*)$/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+([\s\S]*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function isTableSeparator(line) {
  return RE_TABLE_SEP.test(line) && line.includes('-') && line.includes('|');
}

/** 判断某行是否会开启新的块，用于决定段落是否该终止 */
function startsBlock(line) {
  return (
    RE_HEADING.test(line) ||
    RE_HR.test(line) ||
    RE_FENCE.test(line) ||
    RE_BQ.test(line) ||
    RE_LIST.test(line) ||
    /^\s*\$\$\s*$/.test(line) ||
    /^\s*<!--/.test(line)
  );
}

/** 渲染列表：先按缩进把扁平行序列装配成树，再递归输出 */
function renderList(buf) {
  const root = { indent: -1, children: [], lines: [] };
  const stack = [root];

  for (const raw of buf) {
    const m = raw.match(RE_LIST);
    if (m) {
      const indent = m[1].replace(/\t/g, '    ').length;
      // 缩进不大于栈顶说明是同级或更外层，先弹到真正的父节点
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const marker = m[2];
      const ordered = /\d/.test(marker);
      const node = {
        indent,
        ordered,
        start: ordered ? parseInt(marker, 10) : 1,
        lines: [m[3]],
        children: [],
      };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else if (stack.length > 1) {
      // 无标记的续行归属于当前项（支持列表项内换行成段）
      stack[stack.length - 1].lines.push(raw.trim());
    }
  }

  return renderNodes(root.children);

  function renderNodes(nodes) {
    if (!nodes.length) return '';
    const ordered = nodes[0].ordered;
    const startAttr = ordered && nodes[0].start !== 1 ? ` start="${nodes[0].start}"` : '';
    const items = nodes
      .map((node) => {
        const text = node.lines.join(' ').trim();
        const task = text.match(/^\[([ xX])\]\s+([\s\S]*)$/);
        let inner;
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          inner =
            `<input type="checkbox" disabled${checked ? ' checked' : ''}> ` +
            renderInline(task[2]);
        } else {
          inner = renderInline(text);
        }
        const sub = renderNodes(node.children);
        // 任务列表需给 <li> 打标，CSS 才能去掉圆点并左移
        const cls = task ? ' class="task-item"' : '';
        return `<li${cls}>${inner}${sub}</li>`;
      })
      .join('\n');
    return `<${ordered ? 'ol' : 'ul'}${startAttr}>\n${items}\n</${ordered ? 'ol' : 'ul'}>`;
  }
}

/** 解析 GFM 表格，返回 [html, 下一行索引] */
function renderTable(lines, start) {
  const splitRow = (line) =>
    line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.trim());

  const header = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });

  let i = start + 2;
  const rows = [];
  while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
    rows.push(splitRow(lines[i]));
    i++;
  }

  const cell = (content, idx, tag) => {
    const a = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
    return `<${tag}${a}>${renderInline(content)}</${tag}>`;
  };

  const html = [
    '<div class="table-wrap">',
    '<table>',
    '<thead><tr>' + header.map((c, idx) => cell(c, idx, 'th')).join('') + '</tr></thead>',
    '<tbody>',
    ...rows.map((r) => '<tr>' + r.map((c, idx) => cell(c, idx, 'td')).join('') + '</tr>'),
    '</tbody>',
    '</table>',
    '</div>',
  ].join('\n');

  return [html, i];
}

/**
 * 主入口。
 * @returns {{html: string, headings: Array<{level:number,text:string,id:string}>}}
 */
function renderMarkdown(src, options = {}) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  const used = new Set();
  const out = [];
  let i = 0;

  // 段落收集的终止条件依赖 startsBlock，所以段落放在分支最后作为兜底
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // HTML 注释整块丢弃：构建产物里不留注释，避免暴露草稿标记
    if (/^\s*<!--/.test(line)) {
      while (i < lines.length && !/-->/.test(lines[i])) i++;
      i++;
      continue;
    }

    const fence = line.match(RE_FENCE);
    if (fence) {
      const marker = fence[2][0];
      const lang = fence[3] || '';
      const body = [];
      i++;
      while (i < lines.length) {
        const cur = lines[i];
        if (new RegExp(`^\\s*${marker === '`' ? '`' : '~'}{3,}\\s*$`).test(cur)) break;
        body.push(cur);
        i++;
      }
      i++;
      const code = body.join('\n');
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
      out.push(
        `<div class="code-block"${langAttr}>` +
          `<div class="code-head"><span class="code-lang">${escapeHtml(lang || 'text')}</span>` +
          `<button class="code-copy" type="button" aria-label="复制代码">复制</button></div>` +
          `<pre><code class="language-${escapeHtml(lang || 'text')}">${highlight(code, lang)}</code></pre>` +
          `</div>`
      );
      continue;
    }

    const heading = line.match(RE_HEADING);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      // 正文里的 h1 一律降级为 h2：h1 已被文章标题占用，重复会破坏文档大纲
      const outLevel = options.demoteH1 && level === 1 ? 2 : level;
      const id = slugify(text, used);
      const inner = renderInline(text);
      const anchor =
        `<a class="heading-anchor" href="#${id}" aria-label="锚点链接">#</a>`;
      // h2/h3 记入目录，更深层级收进目录反而噪音
      if (outLevel >= 2 && outLevel <= 3) headings.push({ level: outLevel, text, id });
      out.push(`<h${outLevel} id="${id}" class="heading">${anchor}${inner}</h${outLevel}>`);
      i++;
      continue;
    }

    if (RE_HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 块级公式：$$\n...\n$$ 或单行 $$...$$
    if (/^\s*\$\$\s*$/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++;
      out.push(
        `<div class="math-block">\\[${escapeHtml(body.join('\n'))}\\]</div>`
      );
      continue;
    }
    const inlineMathBlock = line.match(/^\s*\$\$(.+?)\$\$\s*$/);
    if (inlineMathBlock) {
      out.push(`<div class="math-block">\\[${escapeHtml(inlineMathBlock[1].trim())}\\]</div>`);
      i++;
      continue;
    }

    if (RE_BQ.test(line)) {
      const body = [];
      while (i < lines.length && (RE_BQ.test(lines[i]) || /^\s*$/.test(lines[i]))) {
        const mm = lines[i].match(RE_BQ);
        body.push(mm ? mm[1] : '');
        i++;
      }
      // 递归渲染，让引用块里也能放列表和代码
      const inner = renderMarkdown(body.join('\n'), options).html;
      out.push(`<blockquote>\n${inner}\n</blockquote>`);
      continue;
    }

    if (RE_LIST.test(line)) {
      const buf = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (/^\s*$/.test(cur)) {
          // 空行仅在后面紧跟缩进行时才算列表内部，否则列表结束
          const next = lines[i + 1];
          if (next && /^\s+\S/.test(next) && !startsBlock(next)) {
            buf.push(cur);
            i++;
            continue;
          }
          break;
        }
        if (RE_LIST.test(cur) || /^\s+\S/.test(cur)) {
          buf.push(cur);
          i++;
          continue;
        }
        break;
      }
      out.push(renderList(buf));
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const [html, next] = renderTable(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    // 兜底：段落
    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !startsBlock(lines[i])) {
      // 表格需要在段落中途截断
      if (lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
      para.push(lines[i]);
      i++;
    }
    if (para.length) out.push(`<p>${renderInline(para.join('\n'))}</p>`);
    else i++; // 防御：不满足任何分支时也推进，避免死循环
  }

  return { html: out.join('\n'), headings };
}

/* ------------------------------------------------------------------ */
/* 纯文本提取与统计                                                    */
/* ------------------------------------------------------------------ */

/** 去掉标记只留文字，用于摘要与阅读时长 */
function toPlainText(md) {
  return String(md)
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~=|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 阅读时长：中文按字符、英文按词分别估算再相加。
 * 只按词数算会严重低估中文文章（中文没有空格分词）。
 */
function readingTime(md) {
  const text = toPlainText(md);
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(1, Math.round(cjk / 380 + words / 200));
}

module.exports = {
  renderMarkdown,
  parseFrontmatter,
  toPlainText,
  readingTime,
  slugify,
  escapeHtml,
};
