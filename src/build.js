'use strict';

/**
 * 静态站点生成器。
 *
 * 构建流程：读 content/ → 解析 frontmatter → 渲染 Markdown → 套模板 → 写 dist/。
 * 之所以在构建期把所有 HTML 生成好（而不是浏览器里 fetch .md 再渲染）：
 *   1. 产物可以直接双击打开，也能被任何静态托管服务；
 *   2. 不需要服务器，file:// 下的 fetch 会被 CORS 拦掉；
 *   3. 搜索引擎和大纲抓取拿到的就是最终 HTML。
 *
 * 用法：
 *   node src/build.js            # 正式构建
 *   node src/build.js --drafts   # 连 draft: true 的文章一起构建
 */

const fs = require('fs');
const path = require('path');

const site = require('../site.config');
const { renderMarkdown, parseFrontmatter, toPlainText, readingTime, escapeHtml } = require('./markdown');
const T = require('./templates');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const POSTS_DIR = path.join(CONTENT_DIR, 'posts');
/**
 * 草稿目录。放在这里而不是给 content/posts/ 里的文件打 draft: true，
 * 是因为仓库是公开的：content/posts/ 会被 git 上传，
 * 标注 draft 只能让它不进构建产物，挡不住别人从仓库里翻到。
 * 这个目录已加入 .gitignore，草稿留在本地，只有 --drafts 构建时才会出现。
 */
const DRAFTS_DIR = path.join(CONTENT_DIR, 'drafts');
const PAGES_DIR = path.join(CONTENT_DIR, 'pages');
const ASSETS_DIR = path.join(ROOT, 'assets');
const DIST_DIR = path.join(ROOT, 'dist');
/**
 * 构建先落到临时目录，全部成功后再原子替换 dist。
 *
 * 原因：如果直接清空 dist 再往里面写，一旦构建中途抛错（或进程被中断），
 * 上一次可用的产物也一起没了，本地预览和线上会同时变成 404。
 * 先写临时目录能让"构建失败"退化为"产物保持旧版本"，而不是"没有产物"。
 *
 * 目录名带 pid：Windows 上文件可能被索引器/杀软瞬时占用，
 * 固定名字会让残留目录锁住下一次构建，带 pid 则每次都拿到干净路径。
 */
const BUILD_DIR = path.join(ROOT, `.dist-build-${process.pid}`);
/** 旧产物在被替换时先改名到这里，稍后再删；改名失败不影响新产物落地 */
const OLD_DIR = path.join(ROOT, `.dist-old-${process.pid}`);

const INCLUDE_DRAFTS = process.argv.includes('--drafts');
const warnings = [];

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function writeFile(rel, content) {
  const target = path.join(BUILD_DIR, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return rel;
}

/**
 * 删除目录，带退避重试。
 * Windows 上 rmSync 会因瞬时文件占用抛 EPERM/EBUSY（Windows Search、杀软扫描、
 * 编辑器 watcher 都会造成），maxRetries/retryDelay 是 Node 为此提供的机制。
 * 用默认值（无重试）会在这些机器上随机构建失败。
 */
function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 15, retryDelay: 120 });
}

/** 尽力清理历史残留的临时构建目录；清不掉就跳过，绝不因此中断本次构建 */
function cleanStaleBuilds() {
  let entries;
  try {
    entries = fs.readdirSync(ROOT);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!/^\.dist-(build|old)(-\d+)?$/.test(name)) continue;
    const dir = path.join(ROOT, name);
    if (path.resolve(dir) === path.resolve(BUILD_DIR)) continue;
    if (path.resolve(dir) === path.resolve(OLD_DIR)) continue;
    try {
      removeDir(dir);
    } catch {
      /* 被占用则留给下次；这不是本次构建的问题 */
    }
  }
}

/** 递归复制目录，保持二进制文件原样 */
function copyDir(from, to) {
  if (!fs.existsSync(from)) return 0;
  let count = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) count += copyDir(src, dst);
    else {
      fs.copyFileSync(src, dst);
      count++;
    }
  }
  return count;
}

/** 从文件名解析排序用的日期与 slug：2026-09-14-xrd-workflow.md → 2026-09-14 / xrd-workflow */
function parseFilename(file) {
  const base = file.replace(/\.md$/i, '');
  const m = base.match(/^(\d{4}-\d{2}-\d{2})[-_](.*)$/);
  if (m) return { date: m[1], slug: m[2] };
  return { date: null, slug: base };
}

/**
 * 404 页的链接前缀。
 *
 * 其他页面都是「相对自己所在目录」，但 404 页不行：GitHub Pages 对任意不存在的路径
 * 都返回 404.html，浏览器会把它的基准 URL 当成那个错误路径，所以 /notes/posts/typo
 * 下的相对链接会被解析到 /notes/posts/assets/... 去。
 *
 * 于是 404 只能用绝对路径。而绝对路径必须带上子路径前缀，否则样式会指向
 * 域根下的 /assets/ 而不是 /notes/assets/。前缀从 site.url 推导。
 * url 没配时退回 '/'，此时根域部署与 file:// 直开仍正常，只有「子路径 + 404」这一种
 * 组合会掉样式——这是能接受的降级，不配 url 的人本来也不在子路径下发。
 */
function notFoundRoot(site) {
  if (!site.url) return '/';
  try {
    const p = new URL(site.url).pathname;
    return p.endsWith('/') ? p : `${p}/`;
  } catch {
    warnings.push(`site.config.js 的 url 不是合法地址，404 页退回根路径：${site.url}`);
    return '/';
  }
}

/**
 * 分类解析：先按 slug 匹配，再按中文 label 匹配。
 * 两种写法都接受是有意的——写 frontmatter 时人更容易直接写「科研」而不是 research，
 * 静默失配会让文章掉出所有分类页，属于难发现的问题。
 */
function resolveCategory(raw) {
  if (!raw) {
    warnings.push('有文章缺少 category 字段，已归入「未分类」');
    return { slug: 'uncategorized', label: '未分类', description: '', unknown: true };
  }
  const bySlug = site.categories.find((c) => c.slug === raw);
  if (bySlug) return bySlug;
  const byLabel = site.categories.find((c) => c.label === raw);
  if (byLabel) return byLabel;
  warnings.push(
    `分类 "${raw}" 不在 site.config.js 的 categories 中，已按原值生成分类页（slug 取原值）`
  );
  return { slug: T.safeSlug(raw), label: raw, description: '', unknown: true };
}

/* ------------------------------------------------------------------ */
/* 读取内容                                                            */
/* ------------------------------------------------------------------ */

function loadPosts() {
  const posts = [];

  /**
   * 从一个目录读文章。
   * @param {string} dir 源目录
   * @param {boolean} forcedDraft 该目录下的文章是否一律视为草稿（草稿目录用）
   */
  function readFrom(dir, forcedDraft) {
    for (const file of readDirSafe(dir)) {
      if (!/\.md$/i.test(file)) continue;
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const { data, body } = parseFrontmatter(raw);

      const isDraft = forcedDraft || data.draft === true || data.draft === 'true';
      if (isDraft && !INCLUDE_DRAFTS) {
        console.log(`  · 跳过草稿 ${file}`);
        continue;
      }

      const fromName = parseFilename(file);
      const fallbackDate = fs.statSync(path.join(dir, file)).mtime;
      const date = data.date || fromName.date;
      if (!date) {
        warnings.push(`${file} 缺少 date 字段且文件名不含日期，已改用文件修改时间`);
      }

      const { html, headings } = renderMarkdown(body, { demoteH1: true });
      const plain = toPlainText(body);

      const tags = Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [];
      // 摘要优先用 frontmatter 指定，否则截首段文字；截断处补省略号以免看起来像被吃掉
      const excerpt = data.excerpt || (plain.length > 120 ? plain.slice(0, 120) + '…' : plain);

      posts.push({
        slug: data.slug || fromName.slug || file.replace(/\.md$/i, ''),
        title: data.title || fromName.slug || file,
        date: date || fallbackDate,
        updated: data.updated || null,
        category: resolveCategory(data.category).slug,
        tags,
        excerpt,
        html,
        headings,
        readingTime: readingTime(body),
        draft: isDraft,
        source: file,
      });
    }
  }

  readFrom(POSTS_DIR, false);
  readFrom(DRAFTS_DIR, true);

  // 时间倒序；同日则按标题稳定排序，保证多次构建产物一致
  posts.sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    if (tb !== ta) return tb - ta;
    return String(a.title).localeCompare(String(b.title), 'zh');
  });

  const seen = new Set();
  for (const p of posts) {
    if (seen.has(p.slug)) warnings.push(`文章 slug 重复：${p.slug}（来自 ${p.source}），后者会覆盖前者`);
    seen.add(p.slug);
  }
  return posts;
}

function loadPage(name) {
  const file = path.join(PAGES_DIR, `${name}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const { html, headings } = renderMarkdown(body, { demoteH1: true });
  const plain = toPlainText(body);
  return {
    title: data.title || name,
    html,
    headings,
    excerpt: data.excerpt || plain.slice(0, 120),
  };
}

/** XML 转义：RSS 里 & < > 未转义会直接解析失败 */
function xml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildFeed(posts) {
  const base = site.url ? site.url.replace(/\/$/, '') : '';
  const link = (rel) => (base ? `${base}/${rel}` : rel);
  const items = posts
    .slice(0, 30)
    .map((p) => {
      const url = link(`posts/${p.slug}.html`);
      const cat = site.categories.find((c) => c.slug === p.category);
      return `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(url)}</link>
      <guid isPermaLink="true">${xml(url)}</guid>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      ${cat ? `<category>${xml(cat.label)}</category>` : ''}
      ${p.tags.map((t) => `<category>${xml(t)}</category>`).join('\n      ')}
      <description>${xml(p.excerpt)}</description>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(site.title)}</title>
    <link>${xml(link('index.html'))}</link>
    <description>${xml(site.description)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${xml(link('feed.xml'))}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

/** 生成全部页面到 BUILD_DIR，返回写入的页面数。抛错时由调用方处理。 */
function generate() {
  const written = [];

  const allPosts = loadPosts();
  const posts = INCLUDE_DRAFTS ? allPosts : allPosts.filter((p) => !p.draft);
  console.log(`  · 文章 ${posts.length} 篇${INCLUDE_DRAFTS ? '（含草稿）' : ''}`);

  /* 首页 + 分页 */
  const pageSize = site.pageSize || 8;
  const totalPages = Math.max(1, Math.ceil(posts.length / pageSize));
  for (let page = 1; page <= totalPages; page++) {
    const slice = posts.slice((page - 1) * pageSize, page * pageSize);
    const html = T.renderHome(site, slice, { page, totalPages });
    written.push(writeFile(page === 1 ? 'index.html' : `page/${page}.html`, html));
  }

  /* 文章详情：上下篇按时间倒序列表中的相邻关系取，符合「更新 / 更旧」的直觉 */
  posts.forEach((post, idx) => {
    const html = T.renderPost(site, '../', post, {
      prev: posts[idx + 1] || null,
      next: posts[idx - 1] || null,
    });
    written.push(writeFile(`posts/${post.slug}.html`, html));
  });

  /* 分类 */
  const catStats = new Map();
  for (const p of posts) {
    if (!catStats.has(p.category)) catStats.set(p.category, []);
    catStats.get(p.category).push(p);
  }
  // 配置里声明但暂无文章的分类也要出页，否则导航点过去是 404
  for (const c of site.categories) if (!catStats.has(c.slug)) catStats.set(c.slug, []);

  written.push(writeFile('categories/index.html', T.renderCategoryIndex(site, catStats)));
  for (const [slug, list] of catStats) {
    const cat =
      site.categories.find((c) => c.slug === slug) || { slug, label: slug, description: '' };
    written.push(writeFile(`categories/${slug}.html`, T.renderCategoryPage(site, cat, list)));
  }

  /* 标签 */
  const tagStats = new Map();
  for (const p of posts) {
    for (const t of p.tags) {
      if (!tagStats.has(t)) tagStats.set(t, []);
      tagStats.get(t).push(p);
    }
  }
  written.push(writeFile('tags/index.html', T.renderTagIndex(site, tagStats)));
  for (const [tag, list] of tagStats) {
    written.push(writeFile(`tags/${T.safeSlug(tag)}.html`, T.renderTagPage(site, tag, list)));
  }

  /* 关于页 */
  const about = loadPage('about');
  if (about) written.push(writeFile('about.html', T.renderAbout(site, about)));
  else warnings.push('content/pages/about.md 不存在，未生成关于页');

  /* 404 与 RSS */
  written.push(writeFile('404.html', T.render404(site, notFoundRoot(site))));
  written.push(writeFile('feed.xml', buildFeed(posts)));

  /* 静态资源 */
  const assetCount = copyDir(ASSETS_DIR, path.join(BUILD_DIR, 'assets'));
  // GitHub Pages 默认忽略下划线开头的文件，留个标记位避免以后踩坑
  writeFile('.nojekyll', '');

  /* 报告 */
  console.log(`  · 生成页面 ${written.length} 个，资源 ${assetCount} 个`);
  console.log(`  · 分类 ${catStats.size} 个，标签 ${tagStats.size} 个`);
  const totalWords = posts.reduce((sum, p) => sum + toPlainText(p.html).length, 0);
  console.log(`  · 正文约 ${totalWords} 字，合计阅读 ${posts.reduce((s, p) => s + p.readingTime, 0)} 分钟`);

  if (warnings.length) {
    console.log('\n警告：');
    for (const w of [...new Set(warnings)]) console.log(`  ! ${w}`);
  }

  return written.length;
}

/**
 * 构建并提交产物。
 * 成功才替换 dist；失败则保留上一次的产物并返回非零退出码，
 * 便于在 CI 里区分"构建失败"和"构建成功但内容为空"。
 */
function build() {
  const started = Date.now();
  console.log(`\n构建 ${site.title} …`);

  cleanStaleBuilds();
  // 全量重建：增量构建在这个体量下没有收益，反而容易留下过期页面
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  let pageCount;
  try {
    pageCount = generate();
  } catch (err) {
    try {
      removeDir(BUILD_DIR);
    } catch {
      /* 清理失败不影响结论：错误信息比残留目录重要 */
    }
    console.error('\n构建失败，dist/ 未被改动（仍是上一次的产物）：\n');
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
    return;
  }

  // 提交产物：用「改名」而不是「删除再改名」。
  // 删除要遍历清空一整个目录，Windows 上只要有一个文件/句柄被占用（杀软扫描、
  // Windows Search、编辑器 watcher、甚至有 shell 的 CWD 停在里面）就报 EPERM。
  // 改名只动目录项，不碰内容，因此不受单文件占用影响。
  try {
    if (fs.existsSync(DIST_DIR)) {
      // 上一轮的垃圾目录先尽量挪开，挪不掉也无妨，它不占用 dist 这个名字
      if (fs.existsSync(OLD_DIR)) {
        try {
          removeDir(OLD_DIR);
        } catch {
          /* 留给下次构建清理 */
        }
      }
      fs.renameSync(DIST_DIR, OLD_DIR);
    }
    fs.renameSync(BUILD_DIR, DIST_DIR);
  } catch (err) {
    console.error('\n产物提交失败，dist/ 仍是上一次的版本：');
    console.error(`  ${err && err.message ? err.message : err}`);
    console.error(`  新产物保留在 ${path.basename(BUILD_DIR)}/，可直接改名成 dist/ 使用`);
    process.exitCode = 1;
    return;
  }

  // 旧产物删除失败只留下一个垃圾目录，不影响本次构建已经成功这个事实
  if (fs.existsSync(OLD_DIR)) {
    try {
      removeDir(OLD_DIR);
    } catch {
      console.log(`  · 旧产物未能删除（${path.basename(OLD_DIR)}/），下次构建会自动清理`);
    }
  }

  console.log(`\n完成，用时 ${Date.now() - started} ms → dist/（${pageCount} 个页面）\n`);
}

build();
