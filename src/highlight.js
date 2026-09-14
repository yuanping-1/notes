'use strict';

/**
 * 轻量语法高亮，零依赖。
 *
 * 实现要点：正则跑在「未转义」的源码上，命中的片段再逐个 escapeHtml。
 * 若先转义后匹配，`<` 变成 `&lt;` 会制造出假的标识符 token，进而错标。
 *
 * 分词优先级由 alternation 的书写顺序决定：注释 > 字符串 > 数字 > 关键字 > 函数调用。
 * 这个顺序很关键——注释里的引号不能被当成字符串起始，否则整段代码颜色会串掉。
 */

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const kwToAlt = (list) =>
  list
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length) // 长关键字优先，避免 `in` 抢走 `instanceof` 的前缀
    .join('|');

const PY_KW = [
  'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or',
  'is', 'None', 'True', 'False', 'import', 'from', 'as', 'with', 'try', 'except', 'finally',
  'raise', 'lambda', 'yield', 'global', 'nonlocal', 'pass', 'break', 'continue', 'async',
  'await', 'assert', 'del', 'print', 'len', 'range', 'enumerate', 'zip', 'open', 'int',
  'float', 'str', 'list', 'dict', 'set', 'tuple', 'sum', 'min', 'max', 'abs', 'round',
  'sorted', 'isinstance', 'self',
];

const JS_KW = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'of', 'in',
  'new', 'class', 'extends', 'this', 'super', 'import', 'export', 'from', 'default', 'try',
  'catch', 'finally', 'throw', 'typeof', 'instanceof', 'null', 'undefined', 'true', 'false',
  'async', 'await', 'yield', 'delete', 'void', 'switch', 'case', 'break', 'continue', 'do',
];

const SH_KW = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac',
  'function', 'return', 'in', 'local', 'export', 'echo', 'cd', 'printf', 'exit', 'set',
  'unset', 'source', 'sudo', 'pip', 'python', 'npm', 'node', 'git', 'ls', 'mkdir', 'rm',
  'cp', 'mv', 'cat', 'grep', 'sed', 'awk', 'find', 'curl', 'wget',
];

const SQL_KW = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP',
  'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'TABLE', 'INDEX', 'VIEW', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'DISTINCT',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CASE', 'WHEN', 'THEN', 'END', 'WITH', 'UNION', 'select',
  'from', 'where', 'join', 'on', 'group', 'order', 'by', 'limit', 'as', 'and', 'or', 'not',
  'null', 'count', 'sum', 'avg', 'case', 'when', 'then', 'end', 'with',
];

const R_KW = [
  'function', 'return', 'if', 'else', 'for', 'while', 'repeat', 'break', 'next', 'in',
  'TRUE', 'FALSE', 'NULL', 'NA', 'Inf', 'NaN', 'library', 'require', 'source', 'c', 'list',
  'data.frame', 'matrix', 'vector', 'mean', 'sd', 'median', 'summary', 'print', 'plot',
];

const MATLAB_KW = [
  'function', 'end', 'if', 'elseif', 'else', 'for', 'while', 'switch', 'case', 'otherwise',
  'break', 'continue', 'return', 'try', 'catch', 'global', 'persistent', 'clc', 'clear',
  'close', 'load', 'save', 'plot', 'hold', 'figure', 'zeros', 'ones', 'linspace', 'squeeze',
  'mean', 'std', 'size', 'length', 'reshape', 'transpose', 'true', 'false', 'nan',
];

/** 定义各语言的分词正则；用函数返回新实例，避免 lastIndex 在多次调用间串状态 */
const LANGS = {
  python: () =>
    new RegExp(
      [
        '(?<comment>#[^\\n]*)',
        '(?<string>[rbfu]{0,2}(?:"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'))',
        '(?<number>\\b(?:0[xXbBoO][0-9a-fA-F_]+|\\d+\\.?\\d*(?:[eE][-+]?\\d+)?)\\b)',
        `(?<keyword>\\b(?:${kwToAlt(PY_KW)})\\b)`,
        '(?<func>[A-Za-z_][\\w]*(?=\\s*\\())',
        '(?<decorator>@[A-Za-z_][\\w.]*)',
      ].join('|'),
      'g'
    ),
  javascript: () =>
    new RegExp(
      [
        '(?<comment>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
        '(?<string>`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')',
        '(?<number>\\b(?:0[xX][0-9a-fA-F]+|\\d+\\.?\\d*(?:[eE][-+]?\\d+)?)\\b)',
        `(?<keyword>\\b(?:${kwToAlt(JS_KW)})\\b)`,
        '(?<func>[A-Za-z_$][\\w$]*(?=\\s*\\())',
      ].join('|'),
      'g'
    ),
  bash: () =>
    new RegExp(
      [
        '(?<comment>#[^\\n]*)',
        '(?<string>"(?:\\\\.|[^"\\\\])*"|\'(?:[^\']*)\')',
        '(?<variable>\\$\\{[^}]*\\}|\\$[A-Za-z_][\\w]*|\\$[0-9@*#?])',
        `(?<keyword>\\b(?:${kwToAlt(SH_KW)})\\b)`,
        '(?<number>\\b\\d+\\b)',
      ].join('|'),
      'g'
    ),
  json: () =>
    new RegExp(
      [
        '(?<key>"(?:\\\\.|[^"\\\\])*"(?=\\s*:))',
        '(?<string>"(?:\\\\.|[^"\\\\])*")',
        '(?<keyword>\\b(?:true|false|null)\\b)',
        '(?<number>-?\\b\\d+\\.?\\d*(?:[eE][-+]?\\d+)?\\b)',
      ].join('|'),
      'g'
    ),
  yaml: () =>
    new RegExp(
      [
        '(?<comment>#[^\\n]*)',
        '(?<key>^[ \\t-]*[A-Za-z_][\\w.-]*(?=\\s*:))',
        '(?<string>"(?:\\\\.|[^"\\\\])*"|\'(?:[^\']*)\')',
        '(?<keyword>\\b(?:true|false|null|yes|no|on|off)\\b)',
        '(?<number>\\b\\d+\\.?\\d*\\b)',
      ].join('|'),
      'gm'
    ),
  sql: () =>
    new RegExp(
      [
        '(?<comment>--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
        "(?<string>'(?:''|[^'])*')",
        `(?<keyword>\\b(?:${kwToAlt(SQL_KW)})\\b)`,
        '(?<number>\\b\\d+\\.?\\d*\\b)',
      ].join('|'),
      'g'
    ),
  r: () =>
    new RegExp(
      [
        '(?<comment>#[^\\n]*)',
        '(?<string>"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')',
        '(?<number>\\b\\d+\\.?\\d*(?:[eE][-+]?\\d+)?\\b)',
        `(?<keyword>\\b(?:${kwToAlt(R_KW)})\\b)`,
        '(?<func>[A-Za-z_.][\\w.]*(?=\\s*\\())',
      ].join('|'),
      'g'
    ),
  matlab: () =>
    new RegExp(
      [
        '(?<comment>%[^\\n]*)',
        "(?<string>'(?:''|[^'])*')",
        '(?<number>\\b\\d+\\.?\\d*(?:[eE][-+]?\\d+)?\\b)',
        `(?<keyword>\\b(?:${kwToAlt(MATLAB_KW)})\\b)`,
        '(?<func>[A-Za-z_]\\w*(?=\\s*\\())',
      ].join('|'),
      'g'
    ),
  latex: () =>
    new RegExp(
      [
        '(?<comment>%.*)',
        '(?<keyword>\\\\(?:begin|end|frac|sqrt|sum|int|alpha|beta|gamma|delta|theta|lambda|sigma|omega|mu|pi|times|cdot|pm|leq|geq|neq|approx|infty|partial|nabla|left|right|text|mathrm|mathbf|cite|ref|label|section|subsection|documentclass|usepackage)\\b\\*?)',
        '(?<string>\\{[^{}]*\\})',
      ].join('|'),
      'gm'
    ),
  html: () =>
    new RegExp(
      [
        '(?<comment>&lt;!--[\\s\\S]*?--&gt;|<!--[\\s\\S]*?-->)',
        '(?<string>"[^"]*"|\'[^\']*\')',
        '(?<keyword>&lt;\\/?[a-zA-Z][\\w-]*|</?[a-zA-Z][\\w-]*)',
      ].join('|'),
      'g'
    ),
  css: () =>
    new RegExp(
      [
        '(?<comment>\\/\\*[\\s\\S]*?\\*\\/)',
        '(?<string>"[^"]*"|\'[^\']*\')',
        '(?<number>#[0-9a-fA-F]{3,8}\\b|\\b\\d+\\.?\\d*(?:px|em|rem|%|s|ms|vh|vw|fr|deg|ch)?\\b)',
        '(?<key>[a-z-]+(?=\\s*:))',
        '(?<func>[a-z-]+(?=\\())',
      ].join('|'),
      'g'
    ),
};

// 语言别名：写 md 时习惯不同，别名表让 `js`/`ts`/`sh` 都能命中同一套规则
const ALIAS = {
  py: 'python', python3: 'python', ipython: 'python',
  js: 'javascript', ts: 'javascript', jsx: 'javascript', tsx: 'javascript', node: 'javascript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  yml: 'yaml',
  postgres: 'sql', mysql: 'sql', sqlite: 'sql',
  tex: 'latex',
  xml: 'html', vue: 'html',
  scss: 'css', less: 'css',
};

const TOKEN_CLASS = {
  comment: 'tok-comment',
  string: 'tok-string',
  number: 'tok-number',
  keyword: 'tok-keyword',
  func: 'tok-func',
  variable: 'tok-variable',
  decorator: 'tok-decorator',
  key: 'tok-key',
  tag: 'tok-tag',
};

/**
 * @param {string} code 源码
 * @param {string} lang 语言标识（支持别名）
 * @returns {string} 带 token span 的 HTML（内容已转义）
 */
function highlight(code, lang) {
  const key = ALIAS[String(lang).toLowerCase()] || String(lang).toLowerCase();
  const build = LANGS[key];
  if (!build) return escapeHtml(code);

  const re = build();
  let out = '';
  let last = 0;
  let m;

  while ((m = re.exec(code)) !== null) {
    // 零宽匹配会让 lastIndex 原地踏步，必须手动推进，否则死循环
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out += escapeHtml(code.slice(last, m.index));

    const groups = m.groups || {};
    let cls = null;
    for (const name of Object.keys(TOKEN_CLASS)) {
      if (groups[name]) {
        cls = TOKEN_CLASS[name];
        break;
      }
    }
    out += cls
      ? `<span class="${cls}">${escapeHtml(m[0])}</span>`
      : escapeHtml(m[0]);
    last = re.lastIndex;
  }

  out += escapeHtml(code.slice(last));
  return out;
}

module.exports = { highlight, escapeHtml };
