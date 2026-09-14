'use strict';

/**
 * 站点配置：全站唯一需要手改的地方。
 * 标题、分类、导航、页脚都从这里读，改完重新构建即可生效。
 */
module.exports = {
  title: '队长笔记',
  subtitle: '科研 · 投资 · 周记 · 读书',
  description:
    '四条线并行记录：钙钛矿光伏与表征方法的科研笔记、可证伪的投资研究方法论、每周复盘，以及读书摘记。',
  author: {
    name: '队长',
    bio: '材料科学与工程 · 钙钛矿光伏方向',
    affiliation: '北京科技大学',
    email: 'hello@example.com',
  },
  // 站点部署地址，用于生成 RSS 绝对链接。必须以 / 结尾。
  // 留空的话 RSS 里会退化成相对路径，多数阅读器解析不了。
  url: 'https://yuanping-1.github.io/notes/',
  nav: [
    { label: '文章', href: 'index.html' },
    { label: '分类', href: 'categories/index.html' },
    { label: '标签', href: 'tags/index.html' },
    { label: '关于', href: 'about.html' },
  ],

  /**
   * 分类是「一篇文章属于哪条线」，单值，必填；
   * 标签是跨分类的自由词，多值。两者职责不同，所以没有合并。
   * slug 用于生成 URL，一旦发布不要改，否则旧链接会 404。
   */
  categories: [
    {
      slug: 'research',
      label: '科研',
      description: '钙钛矿太阳能电池、金属卤化物发光材料、表征数据解析与第一性原理计算。',
    },
    {
      slug: 'investing',
      label: '投资',
      description: '投资研究方法论、财报拆解、策略回测与失效条件。只检验逻辑与证据强度。',
    },
    {
      slug: 'weekly',
      label: '周记',
      description: '每周复盘：读了什么、做了什么、判断被推翻了几次。',
    },
    {
      slug: 'reading',
      label: '读书笔记',
      description: '读书摘记与批判性笔记，保留原书论证链条，也记下我不同意的地方。',
    },
  ],

  footer: {
    links: [
      { label: 'RSS', href: 'feed.xml' },
      { label: 'arXiv', href: 'https://arxiv.org/' },
      { label: 'GitHub', href: 'https://github.com/' },
    ],
    note: '内容为个人研究记录，不构成任何投资建议。',
  },

  // 首页每页文章数。
  // 定得偏大是有意的：首页会把本页文章全渲染进 DOM，客户端的搜索/筛选只能覆盖本页。
  // 分页一旦生效，搜索范围就退化成"仅当前页"，所以不到归档确实变大之前不要调小。
  pageSize: 24,
  // 开启后正文公式走 KaTeX 渲染（需要联网加载 CDN；离线时自动降级为纯文本公式）
  math: true,
};
