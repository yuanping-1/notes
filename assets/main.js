'use strict';

/**
 * 客户端交互。全部原生实现，不引任何库。
 *
 * 设计取舍：所有功能都必须"失败可用"——
 * 剪贴板 API 在 file:// 下不可用、KaTeX 离线加载不到、IntersectionObserver 缺失，
 * 这些情况都要退化成能看能读的状态，而不是白屏或报错。
 */

(function () {
  const root = document.documentElement;
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  /* ------------------------------------------------------------------
     主题与字体：两处偏好都存 localStorage，首屏由 <head> 内联脚本抢先应用
     ------------------------------------------------------------------ */

  $$('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try {
        localStorage.setItem('blog-theme', next);
      } catch (e) {
        /* 隐私模式下 localStorage 会抛错，忽略即可，主题仍本次生效 */
      }
    });
  });

  $$('[data-font-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = root.dataset.font === 'serif' ? 'sans' : 'serif';
      root.dataset.font = next;
      try {
        localStorage.setItem('blog-font', next);
      } catch (e) {}
    });
  });

  /* ------------------------------------------------------------------
     首页搜索 + 分类筛选
     ------------------------------------------------------------------ */

  const postListWrap = $('#postListWrap');
  if (postListWrap) {
    const rows = $$('.post-row', postListWrap);
    const searchInput = $('#searchInput');
    const noResult = $('#noResult');
    const chips = $$('[data-filter-cat]');
    const state = { cat: 'all', q: '' };

    // 预先把检索文本拼好，避免每次输入都对每个节点重算 dataset
    const index = rows.map((row) => ({
      el: row,
      cat: row.dataset.category || '',
      text: [
        row.dataset.title || '',
        row.dataset.summary || '',
        row.dataset.tags || '',
      ]
        .join(' ')
        .toLowerCase(),
    }));

    function apply() {
      let visible = 0;
      const q = state.q.trim().toLowerCase();
      for (const item of index) {
        const catOk = state.cat === 'all' || item.cat === state.cat;
        const textOk = !q || item.text.includes(q);
        const show = catOk && textOk;
        item.el.hidden = !show;
        if (show) visible++;
      }
      if (noResult) noResult.hidden = visible > 0;
    }

    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        state.cat = chip.dataset.filterCat || 'all';
        chips.forEach((c) => c.classList.toggle('is-active', c === chip));
        apply();
      });
    });

    if (searchInput) {
      // 输入不防抖：条目数是几十量级，indexOf 足够快，防抖只会引入输入延迟
      searchInput.addEventListener('input', () => {
        state.q = searchInput.value;
        apply();
      });
      // Esc 清空是搜索框的通用预期
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          searchInput.value = '';
          state.q = '';
          apply();
        }
      });
    }
  }

  /* ------------------------------------------------------------------
     代码复制
     ------------------------------------------------------------------ */

  $$('.code-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const block = btn.closest('.code-block');
      const codeEl = block && $('code', block);
      if (!codeEl) return;
      const text = codeEl.textContent;

      let ok = false;
      // navigator.clipboard 需要安全上下文，file:// 下会直接不可用，因此必须留降级路径
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch (e) {
          ok = false;
        }
      }
      if (!ok) {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (e) {
          ok = false;
        }
      }

      btn.textContent = ok ? '已复制' : '复制失败';
      btn.classList.toggle('is-done', ok);
      setTimeout(() => {
        btn.textContent = '复制';
        btn.classList.remove('is-done');
      }, 1600);
    });
  });

  /* ------------------------------------------------------------------
     目录跟随高亮
     ------------------------------------------------------------------ */

  const tocLinks = $$('.toc-link');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const byId = new Map(
      tocLinks.map((a) => [a.dataset.target, a]).filter(([id]) => id)
    );
    const targets = Array.from(byId.keys())
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (targets.length) {
      // 用 rootMargin 把判定线压到视口上方 1/4 处：标题刚进入上半屏就算"当前"，
      // 否则读者已经看完一段、目录还停在上一个标题
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const link = byId.get(entry.target.id);
            if (!link) continue;
            if (entry.isIntersecting) {
              tocLinks.forEach((a) => a.classList.remove('is-active'));
              link.classList.add('is-active');
            }
          }
        },
        { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
      );
      targets.forEach((t) => observer.observe(t));
    }
  }

  /* ------------------------------------------------------------------
     阅读进度条
     ------------------------------------------------------------------ */

  const article = $('[data-article]');
  const progress = $('#progressBar');
  if (article && progress) {
    progress.hidden = false;
    let ticking = false;

    const update = () => {
      const rect = article.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      // 文章短于一屏时不显示进度，否则会一直卡在 100%
      if (total <= 0) {
        progress.style.width = '0%';
      } else {
        const scrolled = Math.min(Math.max(-rect.top, 0), total);
        progress.style.width = `${(scrolled / total) * 100}%`;
      }
      ticking = false;
    };

    // 滚动回调里只置标记，实际计算放到 rAF，避免高频 scroll 造成布局抖动
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true }
    );
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  /* ------------------------------------------------------------------
     公式渲染与离线降级
     ------------------------------------------------------------------ */

  function degradeMath() {
    // KaTeX 没加载成功时，\( \) 与 \[ \] 会以裸文本露出反斜杠；
    // 这里只去掉定界符，保留原始 TeX —— 至少是一段可读的公式
    root.classList.add('no-katex');
    $$('.math-inline, .math-block').forEach((el) => {
      el.textContent = el.textContent
        .replace(/^\s*\\[([]/, '')
        .replace(/\\[)\]]\s*$/, '')
        .trim();
    });
  }

  function renderMath() {
    if (typeof window.renderMathInElement !== 'function') {
      degradeMath();
      return;
    }
    try {
      window.renderMathInElement(document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        // 忽略代码块：里面的 $ 和 \ 是代码内容，不是公式
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
        throwOnError: false,
      });
    } catch (e) {
      degradeMath();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderMath);
  } else {
    renderMath();
  }
})();
