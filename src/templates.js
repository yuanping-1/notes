'use strict';

/**
 * 页面模板。全部返回字符串，构建期一次性生成静态 HTML。
 *
 * 链接一律用相对路径 + root 前缀，好处是同一份产物在
 * file:// 直接打开、GitHub Pages 根域、子路径部署三种场景下都能用，
 * 不需要改配置或加 <base>。
 */

const { escapeHtml } = require('./markdown');

const esc = escapeHtml;

/** 把日期统一渲染成 2026-09-14；无效日期原样输出，避免显示 Invalid Date */
function formatDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 文件系统安全的 slug：保留中文（可读 URL），只清理非法字符 */
function safeSlug(label) {
  return String(label)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ------------------------------------------------------------------ */
/* 基础布局                                                            */
/* ------------------------------------------------------------------ */

function layout(ctx) {
  const { site, root, title, description, activeNav, bodyClass, content, head = '', bodyEnd = '' } = ctx;
  const pageTitle = title ? `${esc(title)} · ${esc(site.title)}` : esc(site.title);

  const navHtml = site.nav
    .map((item) => {
      const active = activeNav === item.href ? ' is-active' : '';
      return `<a class="nav-link${active}" href="${root}${esc(item.href)}">${esc(item.label)}</a>`;
    })
    .join('');

  const footerLinks = (site.footer.links || [])
    .map((l) => {
      const href = /^https?:\/\//.test(l.href) ? l.href : root + l.href;
      return `<a href="${esc(href)}"${
        /^https?:\/\//.test(l.href) ? ' target="_blank" rel="noopener noreferrer"' : ''
      }>${esc(l.label)}</a>`;
    })
    .join('<span class="dot">·</span>');

  // 数学渲染脚本：离线时 KaTeX 加载失败，靠 main.js 把 \( \) 包装去掉降级显示
  const mathHead = site.math
    ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" crossorigin="anonymous"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN" data-root="${root}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${esc(description || site.description)}">
<meta name="author" content="${esc(site.author.name)}">
<meta name="color-scheme" content="light dark">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${esc(description || site.description)}">
<meta property="og:type" content="${title ? 'article' : 'website'}">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)}" href="${root}feed.xml">
<link rel="stylesheet" href="${root}assets/style.css">
<script>
// 主题与字体偏好必须在样式表应用前定下，否则首屏会闪一下默认配色
(function () {
  try {
    var t = localStorage.getItem('blog-theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    var f = localStorage.getItem('blog-font');
    if (f) document.documentElement.dataset.font = f;
  } catch (e) {}
})();
</script>
${mathHead}
${head}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<div class="progress-bar" id="progressBar" hidden></div>
<a class="skip-link" href="#main">跳到正文</a>

<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${root}index.html">
      <span class="brand-title">${esc(site.title)}</span>
      <span class="brand-sub">${esc(site.subtitle)}</span>
    </a>
    <nav class="nav" aria-label="主导航">${navHtml}</nav>
    <div class="header-tools">
      <button class="icon-btn font-btn" type="button" data-font-toggle title="切换正文字体" aria-label="切换正文字体">Aa</button>
      <button class="icon-btn" type="button" data-theme-toggle title="切换深浅色" aria-label="切换深浅色">
        <svg class="i-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>
        <svg class="i-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      </button>
    </div>
  </div>
</header>

<main id="main">
${content}
</main>

<footer class="site-footer">
  <div class="wrap footer-inner">
    <div class="footer-links">${footerLinks}</div>
    <p class="footer-note">${esc(site.footer.note)}</p>
    <p class="footer-copy">© ${new Date().getFullYear()} ${esc(site.author.name)}${
      site.author.affiliation ? ` · ${esc(site.author.affiliation)}` : ''
    }</p>
  </div>
</footer>

<script src="${root}assets/main.js" defer></script>
${bodyEnd}
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* 组件                                                                */
/* ------------------------------------------------------------------ */

function categoryOf(site, slug) {
  return (site.categories || []).find((c) => c.slug === slug) || null;
}

function categoryBadge(site, root, slug) {
  const cat = categoryOf(site, slug);
  if (!cat) return '';
  // data-cat 供 CSS 取色；用属性而不是内联样式，方便统一改主题色
  return `<a class="cat-badge" data-cat="${esc(cat.slug)}" href="${root}categories/${esc(
    cat.slug
  )}.html">${esc(cat.label)}</a>`;
}

function tagLinks(root, tags) {
  if (!tags || !tags.length) return '';
  return tags
    .map(
      (t) =>
        `<a class="tag-chip" href="${root}tags/${esc(safeSlug(t))}.html">${esc(t)}</a>`
    )
    .join('');
}

/** 文章列表中的一行 */
function postRow(site, root, post) {
  const tags = tagLinks(root, post.tags);
  return `<li class="post-row" data-category="${esc(post.category)}" data-tags="${esc(
    (post.tags || []).join(',')
  )}" data-title="${esc(post.title)}" data-summary="${esc(post.excerpt)}">
  <div class="post-row-date">${esc(formatDate(post.date))}</div>
  <div class="post-row-main">
    <h3 class="post-row-title"><a href="${root}posts/${esc(post.slug)}.html">${esc(post.title)}</a></h3>
    <p class="post-row-excerpt">${esc(post.excerpt)}</p>
    <div class="post-row-meta">
      ${categoryBadge(site, root, post.category)}
      ${tags}
      <span class="reading-time">${post.readingTime} 分钟</span>
    </div>
  </div>
</li>`;
}

function postList(site, root, posts) {
  if (!posts.length) {
    return `<p class="empty-state">这个条件下还没有文章。换个分类或清空搜索词再试。</p>`;
  }
  return `<ul class="post-list">${posts.map((p) => postRow(site, root, p)).join('\n')}</ul>`;
}

function pagination(root, current, total) {
  if (total <= 1) return '';
  const href = (n) => (n === 1 ? `${root}index.html` : `${root}page/${n}.html`);
  const parts = [];
  if (current > 1) parts.push(`<a class="page-link" href="${href(current - 1)}">← 上一页</a>`);
  else parts.push(`<span class="page-link is-disabled">← 上一页</span>`);

  parts.push(`<span class="page-status">${current} / ${total}</span>`);

  if (current < total) parts.push(`<a class="page-link" href="${href(current + 1)}">下一页 →</a>`);
  else parts.push(`<span class="page-link is-disabled">下一页 →</span>`);

  return `<nav class="pagination" aria-label="分页">${parts.join('')}</nav>`;
}

/** 首页/分类页顶部的筛选与搜索工具条 */
function filterBar(site, root, { showCategories = true } = {}) {
  const cats = (site.categories || [])
    .map(
      (c) =>
        `<button class="filter-chip" type="button" data-filter-cat="${esc(c.slug)}">${esc(
          c.label
        )}</button>`
    )
    .join('');
  return `<div class="filter-bar">
  ${
    showCategories
      ? `<div class="filter-group" role="group" aria-label="按分类筛选">
    <button class="filter-chip is-active" type="button" data-filter-cat="all">全部</button>${cats}
  </div>`
      : ''
  }
  <div class="search-box">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
    <input type="search" id="searchInput" placeholder="搜索标题、摘要、标签…" aria-label="搜索文章" autocomplete="off">
  </div>
</div>`;
}

function tocHtml(headings) {
  // 少于 3 个二级及以上标题时目录只是噪音
  if (headings.length < 3) return '';
  const items = headings
    .map(
      (h) =>
        `<a class="toc-link toc-lv${h.level}" href="#${esc(h.id)}" data-target="${esc(h.id)}">${esc(
          h.text
        )}</a>`
    )
    .join('');
  return `<aside class="toc" aria-label="目录">
  <div class="toc-title">目录</div>
  <nav class="toc-list">${items}</nav>
</aside>`;
}

/* ------------------------------------------------------------------ */
/* 页面                                                                */
/* ------------------------------------------------------------------ */

function renderHome(site, posts, { page = 1, totalPages = 1 } = {}) {
  const root = page === 1 ? '' : '../';
  const content = `<div class="wrap">
  <section class="hero">
    <h1 class="hero-title">${esc(site.title)}</h1>
    <p class="hero-sub">${esc(site.subtitle)}</p>
    <p class="hero-desc">${esc(site.description)}</p>
  </section>

  ${filterBar(site, root)}

  <div id="postListWrap">
    ${postList(site, root, posts)}
  </div>
  <p class="empty-state" id="noResult" hidden>没有匹配的文章。</p>

  ${pagination(root, page, totalPages)}
</div>`;

  return layout({
    site,
    root,
    title: page === 1 ? '' : `第 ${page} 页`,
    description: site.description,
    activeNav: 'index.html',
    bodyClass: 'page-home',
    content,
  });
}

function renderPost(site, root, post, { prev, next }) {
  const allTags = tagLinks(root, post.tags);
  const nav = [
    prev
      ? `<a class="post-nav-item post-nav-prev" href="${root}posts/${esc(prev.slug)}.html">
    <span class="post-nav-label">← 上一篇</span>
    <span class="post-nav-title">${esc(prev.title)}</span>
  </a>`
      : `<span class="post-nav-item is-empty"></span>`,
    next
      ? `<a class="post-nav-item post-nav-next" href="${root}posts/${esc(next.slug)}.html">
    <span class="post-nav-label">下一篇 →</span>
    <span class="post-nav-title">${esc(next.title)}</span>
  </a>`
      : `<span class="post-nav-item is-empty"></span>`,
  ].join('');

  const content = `<div class="wrap">
  <div class="article-layout">
    <article class="article" data-article>
      <nav class="breadcrumb"><a href="${root}index.html">文章</a><span class="sep">/</span>${categoryBadge(
        site,
        root,
        post.category
      )}</nav>

      <header class="article-header">
        <h1 class="article-title">${esc(post.title)}</h1>
        <div class="article-meta">
          <time datetime="${esc(formatDate(post.date))}">${esc(formatDate(post.date))}</time>
          <span class="dot">·</span>
          <span>${post.readingTime} 分钟阅读</span>
          ${post.updated ? `<span class="dot">·</span><span>修订于 ${esc(formatDate(post.updated))}</span>` : ''}
        </div>
        ${allTags ? `<div class="article-tags">${allTags}</div>` : ''}
      </header>

      <div class="prose">
${post.html}
      </div>

      <nav class="post-nav">${nav}</nav>
    </article>

    ${tocHtml(post.headings)}
  </div>
</div>`;

  return layout({
    site,
    root,
    title: post.title,
    description: post.excerpt,
    activeNav: 'index.html',
    bodyClass: 'page-post',
    content,
    bodyEnd: `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      datePublished: formatDate(post.date),
      dateModified: formatDate(post.updated || post.date),
      author: { '@type': 'Person', name: site.author.name },
      description: post.excerpt,
      keywords: (post.tags || []).join(','),
    })}</script>`,
  });
}

function renderTagIndex(site, tagStats) {
  const root = '../';
  const sorted = [...tagStats.entries()].sort((a, b) => b[1].length - a[1].length);
  const body = sorted.length
    ? `<ul class="tag-cloud">${sorted
        .map(
          ([tag, list]) =>
            `<li><a class="tag-cloud-item" href="${root}tags/${esc(safeSlug(tag))}.html">
          <span class="tag-cloud-name">${esc(tag)}</span>
          <span class="tag-cloud-count">${list.length}</span>
        </a></li>`
        )
        .join('')}</ul>`
    : `<p class="empty-state">还没有任何标签。</p>`;

  const content = `<div class="wrap">
  <header class="page-header">
    <h1 class="page-title">标签</h1>
    <p class="page-desc">共 ${sorted.length} 个标签。标签跨分类使用，用来串起一条具体的技术线索。</p>
  </header>
  ${body}
</div>`;

  return layout({
    site,
    root,
    title: '标签',
    description: '全部标签',
    activeNav: 'tags/index.html',
    bodyClass: 'page-tags',
    content,
  });
}

function renderTagPage(site, tag, posts) {
  const root = '../';
  const content = `<div class="wrap">
  <header class="page-header">
    <p class="page-kicker">标签</p>
    <h1 class="page-title">${esc(tag)}</h1>
    <p class="page-desc">共 ${posts.length} 篇文章</p>
  </header>
  ${postList(site, root, posts)}
  <p class="back-link"><a href="${root}tags/index.html">← 全部标签</a></p>
</div>`;

  return layout({
    site,
    root,
    title: `标签：${tag}`,
    description: `标签 ${tag} 下的全部文章`,
    activeNav: 'tags/index.html',
    bodyClass: 'page-tag',
    content,
  });
}

function renderCategoryIndex(site, stats) {
  const root = '../';
  const cards = (site.categories || [])
    .map((c) => {
      const list = stats.get(c.slug) || [];
      const latest = list.slice(0, 3);
      return `<li class="cat-card" data-cat="${esc(c.slug)}">
  <a class="cat-card-head" href="${root}categories/${esc(c.slug)}.html">
    <span class="cat-card-name">${esc(c.label)}</span>
    <span class="cat-card-count">${list.length} 篇</span>
  </a>
  <p class="cat-card-desc">${esc(c.description || '')}</p>
  ${
    latest.length
      ? `<ul class="cat-card-recent">${latest
          .map(
            (p) =>
              `<li><a href="${root}posts/${esc(p.slug)}.html">${esc(p.title)}</a><time>${esc(
                formatDate(p.date)
              )}</time></li>`
          )
          .join('')}</ul>`
      : `<p class="cat-card-empty">暂无文章</p>`
  }
</li>`;
    })
    .join('');

  const content = `<div class="wrap">
  <header class="page-header">
    <h1 class="page-title">分类</h1>
    <p class="page-desc">四条线各自独立推进。分类是主线，标签是横切的技术线索。</p>
  </header>
  <ul class="cat-grid">${cards}</ul>
</div>`;

  return layout({
    site,
    root,
    title: '分类',
    description: '全部分类',
    activeNav: 'categories/index.html',
    bodyClass: 'page-categories',
    content,
  });
}

function renderCategoryPage(site, cat, posts) {
  const root = '../';
  const content = `<div class="wrap">
  <header class="page-header">
    <p class="page-kicker">分类</p>
    <h1 class="page-title">${esc(cat.label)}</h1>
    <p class="page-desc">${esc(cat.description || '')}</p>
  </header>
  ${postList(site, root, posts)}
  <p class="back-link"><a href="${root}categories/index.html">← 全部分类</a></p>
</div>`;

  return layout({
    site,
    root,
    title: cat.label,
    description: cat.description,
    activeNav: 'categories/index.html',
    bodyClass: 'page-category',
    content,
  });
}

function renderAbout(site, page) {
  const { author } = site;
  const content = `<div class="wrap">
  <header class="page-header">
    <h1 class="page-title">${esc(page.title)}</h1>
  </header>
  <div class="about-layout">
    <div class="prose about-prose">
${page.html}
    </div>
    <aside class="about-side">
      <div class="side-card">
        <div class="side-card-title">${esc(author.name)}</div>
        <p class="side-card-line">${esc(author.bio)}</p>
        ${author.affiliation ? `<p class="side-card-line">${esc(author.affiliation)}</p>` : ''}
        ${
          author.email
            ? `<p class="side-card-line"><a href="mailto:${esc(author.email)}">${esc(
                author.email
              )}</a></p>`
            : ''
        }
      </div>
      <div class="side-card">
        <div class="side-card-title">订阅</div>
        <p class="side-card-line"><a href="feed.xml">RSS 订阅</a> — 支持任意阅读器。</p>
      </div>
    </aside>
  </div>
</div>`;

  return layout({
    site,
    root: '',
    title: page.title,
    description: page.excerpt,
    activeNav: 'about.html',
    bodyClass: 'page-about',
    content,
  });
}

function render404(site, root) {
  const content = `<div class="wrap">
  <header class="page-header">
    <h1 class="page-title">404</h1>
    <p class="page-desc">这个地址下没有内容。</p>
  </header>
  <p class="back-link"><a href="${root}index.html">← 回到首页</a></p>
</div>`;
  return layout({
    site,
    root,
    title: '页面不存在',
    description: '404',
    activeNav: '',
    bodyClass: 'page-404',
    content,
  });
}

module.exports = {
  layout,
  formatDate,
  safeSlug,
  renderHome,
  renderPost,
  renderTagIndex,
  renderTagPage,
  renderCategoryIndex,
  renderCategoryPage,
  renderAbout,
  render404,
};
