# 队长笔记

个人博客。**Markdown 源文件 + 零依赖构建脚本**，构建期生成纯静态 HTML。不需要服务器、不需要数据库、不需要 npm install。

四条内容线：科研 / 投资 / 周记 / 读书笔记。

## 快速开始

```bash
node src/build.js        # 构建 → dist/
node src/serve.js        # 本地预览 http://localhost:4173
```

有 npm 的话等价于 `npm run build` / `npm run preview`。项目**没有任何依赖**，`package.json` 只为了挂脚本。

`node src/build.js --drafts` 会连 `draft: true` 的文章一起构建，用于本地预览未完成的稿子。

## 目录结构

```
blog/
├── site.config.js          # 站点配置：标题、分类、导航、页脚、每页文章数
├── content/
│   ├── posts/              # 文章，文件名格式 YYYY-MM-DD-slug.md
│   └── pages/about.md      # 关于页
├── src/
│   ├── build.js            # 构建入口：读内容 → 渲染 → 套模板 → 写 dist/
│   ├── markdown.js         # 自写的 Markdown 渲染器（含 frontmatter 与公式占位）
│   ├── highlight.js        # 自写的语法高亮
│   ├── templates.js        # 页面模板与组件
│   └── serve.js            # 本地预览服务器
├── assets/                 # style.css + main.js，构建时原样复制到 dist/assets/
├── tools/                  # 开发期验证脚本（不参与站点产物）
└── dist/                   # 构建产物，可整体删除重建
```

`dist/` 是纯静态产物，直接丢到任何静态托管即可。它可随时删除，重新构建会完整重建。

## 写一篇文章

在 `content/posts/` 下新建 `YYYY-MM-DD-英文短名.md`。文件名里的日期会作为 `date` 的兜底，slug 从文件名解析。

```markdown
---
title: 文章标题
date: 2026-09-14
category: research
tags: [钙钛矿, 稳定性, XRD]
excerpt: 列表和 RSS 里显示的摘要。不写则自动截取正文前 120 字。
---

正文从这里开始。
```

### frontmatter 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 文章标题。缺省时退回文件名 |
| `date` | 是 | `YYYY-MM-DD`。缺省时用文件名日期，再退回文件修改时间 |
| `category` | 是 | 分类，**单值**。可写 slug（`research`）或中文名（`科研`），两者都识别 |
| `tags` | 否 | 标签，**多值**，跨分类自由使用。支持 `[a, b]` 或换行 `- a` 写法 |
| `excerpt` | 否 | 摘要。不写则截取正文前 120 字 |
| `updated` | 否 | 修订日期，填了会在文章头部显示 |
| `draft` | 否 | `true` 则不参与正式构建，只在本 `--drafts` 时出现 |
| `slug` | 否 | 覆盖从文件名解析的 URL 短名。**发布后不要改，否则旧链接 404** |

分类由 `site.config.js` 的 `categories` 定义。写错了构建不会失败，但会在终端给出警告并生成一个临时分类页——这是有意为之，静默丢文章比报错更难排查。

### 草稿要放 `content/drafts/`

**不要**用 `draft: true` 存未完成的稿子。仓库是公开的，`content/posts/` 会随 git 上传，`draft: true` 只让它不进构建产物，**挡不住别人翻仓库看到 `.md` 原文**。

草稿放 `content/drafts/`，该目录已在 `.gitignore` 里，物理上不进 git：

```bash
node src/build.js            # 跳过 drafts/ 全部内容
node src/build.js --drafts   # 把它们一起构建，用于本地预览
```

文件名与 frontmatter 格式和 `content/posts/` 完全一致，不需要写 `draft: true`——那个目录下的一切都算草稿。定稿后把文件移到 `content/posts/` 即可发布。

## 支持的 Markdown 语法

标题（`#`–`######`，正文里的 `#` 自动降为 `h2`，避免和文章标题抢文档大纲）、段落、**粗体**、*斜体*、~~删除线~~、==高亮==、`行内代码`、围栏代码块（带语言标识即高亮）、引用块、有序/无序/**嵌套列表**、任务列表、GFM 表格（支持 `:---:` 对齐）、分隔线、链接（外链自动加 `target="_blank"`）、图片（渲染为 `figure` + `figcaption`）。

代码块语言支持 python / javascript / bash / json / yaml / sql / r / matlab / latex / html / css，以及常见别名（`py`、`js`、`sh`、`yml`、`tex`…）。未识别的语言按纯文本转义输出，不会报错。

数学公式：行内 `$...$`，块级 `$$` 独占一行包围。用 KaTeX 渲染。

````markdown
行内公式 $\langle\tau\rangle = \frac{\sum A_i \tau_i^2}{\sum A_i \tau_i}$。

$$
E_g(x) = (1-x)E_g(\mathrm{I}) + x\,E_g(\mathrm{Br}) - b\,x(1-x)
$$
````

行内公式的 `$` 首尾不允许空白，因此「价格从 $5 到 $10」这类文本不会被误判成公式。

## 自定义

改 `site.config.js` 就够了：

- `title` / `subtitle` / `description` — 站名与副标题
- `author` — 名字、简介、单位、邮箱（关于页右侧卡片用）
- `nav` — 顶部导航
- `categories` — 分类列表，含 `slug` / `label` / `description`
- `footer` — 页脚链接与声明
- `pageSize` — 首页每页文章数（见下方"已知限制"）
- `math` — 是否加载 KaTeX
- `url` — 部署域名，用于 RSS 绝对链接

配色在 `assets/style.css` 顶部的 `:root` 与 `html[data-theme="dark"]` 两块里。分类色是 `--cat-*` 变量；标签色统一走 `[data-cat="..."]` 选择器，改一处即可。

## 部署

产物是纯静态文件，任选一种：

- **GitHub Pages** — 把 `dist/` 内容推到 `gh-pages` 分支（已生成 `.nojekyll`，避免下划线文件被忽略）
- **任意静态托管** — 腾讯云 COS / 阿里云 OSS / Vercel / Netlify / Cloudflare Pages，上传 `dist/` 即可

站内链接全部是相对路径，所以根域部署、子路径部署、`file://` 直接打开三种情况都能用，不需要改配置或加 `<base>`。

## 设计取舍与已知限制

**为什么构建期生成而不是浏览器里 fetch .md**：`file://` 下 fetch 会被 CORS 拦掉，且搜索引擎抓到的是空壳。构建期生成后，产物可直接双击打开，也天然对 SEO 友好。

**为什么自写 Markdown 渲染器和高亮**：本机 npm 不在 PATH，引第三方包要么装不上要么引入离线风险。自写还让标题锚点策略可控——中文标题保留中文作为 id（`#现象-光照诱导的可逆带隙收缩`），复制出去的链接是可读的。

**构建是原子的。** 产物先写到 `.dist-build-<pid>/`，全部成功后才替换 `dist/`。替换用的是**改名**而不是「删除再改名」：

- 直接清空 `dist/` 再写，一旦中途抛错或进程被中断，上一次可用的产物也没了，本地和线上同时变成 404。
- 删除整个目录要遍历清空内容，Windows 上只要有一个文件或句柄被占用（杀软扫描、Windows Search、编辑器 watcher，甚至有 shell 的 CWD 停在 `dist/` 里）就会抛 `EPERM`，`maxRetries` 也救不回来。改名只动目录项、不碰内容，因此不受影响。

所以构建失败时 `dist/` 保持上一次的版本，退出码为 1；旧产物删不掉只会留下一个 `.dist-old-<pid>/` 垃圾目录，下次构建自动清理，不影响本次已经成功这个事实。

**已知限制**，用之前需要知道：

1. **客户端搜索只覆盖当前页。** 首页会把本页文章全渲染进 DOM，搜索与分类筛选都在前端做，不请求后端。所以 `pageSize` 一旦调小、分页生效，搜索范围就退化成"仅当前页"。目前定为 24，7 篇文章都在这页上。文章过百以后要么调大 `pageSize`，要么把搜索改成构建期生成索引。
2. **公式依赖 CDN。** KaTeX 从 jsdelivr 加载。离线或 CDN 不可达时会自动降级：去掉 `\(` `\)` 定界符，把原始 TeX 以等宽字体显示。**能读，但不好看。** 要彻底离线就把 KaTeX 下载到 `assets/` 并改 `templates.js` 里的引入路径。
3. **标签页文件名是中文**（`tags/钙钛矿.html`）。浏览器地址栏会显示为原文，链接可读，但要求服务器正确处理 UTF-8 文件名。极少数老服务器可能有问题。
4. **没有增量构建。** 每次构建会清空 `dist/` 全量重建。当前规模下耗时约 1 秒，不值得为增量引入复杂度。
5. **分类是单值。** 一篇文章只能属于一条线。需要横切就用标签。
6. **没有图片处理管线。** 文章里的图片要么放外链，要么自己放进 `assets/` 并在 Markdown 里用相对路径引用。构建不会压缩或转格式。
7. **没有评论系统**，也没有浏览量统计。

## 开发期工具

`tools/` 下两个脚本只在开发时用，不参与站点产物：

```bash
node tools/probe-overflow.js   # 生成 dist/__probe_*.html，用 headless Chrome 测各宽度是否横向溢出
node tools/preview-dark.js     # 生成 dist/__dark_*.html，绕过 <head> 内联脚本强制暗色主题
```

它们解决的是两个具体的坑，值得记下来：

- 无头 Chrome 的 `--window-size` 有约 **497px 的最小视口**，请求 390px 时实际按 497px 排版，截图只截左半边——看起来像移动端文字被切了，其实是截图裁切。判断是否真的溢出要看 `documentElement.scrollWidth === clientWidth`，别靠肉眼看截图。
- 页面 `<head>` 里的内联主题脚本会按 `localStorage` / `prefers-color-scheme` 覆写 `data-theme`，所以直接给 `<html>` 加 `data-theme="dark"` 会被冲掉，截图和浅色一模一样。必须先摘掉那段脚本。
