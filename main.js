/**
 * Ultra Paste — a dependency-free JavaScript Obsidian community plugin.
 * Copyright (c) 2026 Ultra Paste contributors. MIT License.
 * Independent implementation inspired by the workflows of Clean AI Paste,
 * Paste Transform and Defuddle. Does not embed the Defuddle extraction engine.
 */
'use strict';
const { Plugin, PluginSettingTab, Setting, Notice, Modal, htmlToMarkdown, requestUrl, Platform } = require('obsidian');

const DEFAULTS = {
  enabled: true,
  mode: 'auto',                 // auto | rich | plain
  convertMath: true,
  detectBracketMath: true,      // Conservative AI [ math ] and quoted bracket repair
  detectParenMath: false,      // Opt-in: (x=y) style guesses can change prose
  repairMathArtifacts: false,  // Opt-in: repair common broken separators inside new display math
  cleanTracking: true,
  autoLinkTitles: true,          // fetch page title for a single pasted URL
  autoTitleMaxLength: 0,        // 0 = keep full title
  autoTitleBlacklist: '',      // newline / comma separated hostnames
  normalizeHeadings: true,
  condenseBlankLines: true,
  preserveCode: true,
  preferPlainMarkdown: true,
  stripAIReferences: false,
  wrapSelectedTextWithUrl: true,
  enableCustomRules: true,
  allowJavaScriptRules: false,
  smartStructureLists: true,    // Context-aware, only when the pasted content is a pure list
  smartStructureQuotes: true,   // Continue quote/callout prefix over subsequent lines
  smartImagePaste: true,        // Images are claimed only when clipboard has actual image Files
  imageNamingPreview: true,
  imageNameTemplate: '{{noteName}}-{{date}}-{{counter}}',
  imageDetectDuplicates: true,
  imageNoteFolders: false,
  imageFolderName: 'images',
  imageAutoWidth: false,
  imagePortraitWidth: 300,
  imageMaxDisplayWidth: 600,
  imageCompression: false,
  imageMaxWidth: 1920,
  imageQuality: 0.85,
  showNotifications: false,
  debug: false,
  rules: []
};

const TRACK_KEYS = /^(?:utm_[\w-]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|igshid|mc_cid|mc_eid|_hsenc|_hsmi|vero_id|ref_src|s_cid)$/i;
const AI_CITATIONS = /(?:【turn\d+(?:search|news|file|image|fetch)\d+】|cite[^]*)/g;
const RULE_LIMIT = 100;
// Avoid synchronous, multi-pass transforms on exceptionally large clipboard payloads.
const SMART_PASTE_MAX_CHARS = 900000;
const TITLE_MAX_HTML_BYTES = 1_000_000;
const REMOTE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
// Guard all Node.js-only features. Obsidian Mobile has no Node or Electron.
// On test harnesses which do not supply Platform, retain the legacy desktop path.
function isMobileRuntime() {
  return !!(Platform && (Platform.isMobile || Platform.isIosApp || Platform.isAndroidApp || Platform.isDesktopApp === false));
}
function isDesktopRuntime() { return !isMobileRuntime() && (!Platform || Platform.isDesktopApp === true); }


function nl(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n'); }
function longestRun(s, symbol) { const m = s.match(new RegExp('\\' + symbol + '+', 'g')); return m ? Math.max(...m.map(x => x.length)) : 0; }
function escapeInlineCode(s) { const ticks = '`'.repeat(Math.max(1, longestRun(s, '`') + 1)); return ticks + (s.startsWith('`') || s.endsWith('`') ? ' ' + s + ' ' : s) + ticks; }
function fencedCode(s, lang = '') {
  s = nl(s).replace(/\n+$/, '');
  const fence = '`'.repeat(Math.max(3, longestRun(s, '`') + 1));
  return '\n\n' + fence + (lang || '') + '\n' + s + '\n' + fence + '\n\n';
}
function normalizeLanguage(s) {
  const v = String(s || '').trim().toLowerCase().replace(/[^a-z0-9+#_.-]/g, '');
  const names = { 'py': 'python', 'js': 'javascript', 'ts': 'typescript', 'sh': 'bash', 'shell': 'bash', 'json5': 'json' };
  return names[v] || v.slice(0, 32);
}
function inferLanguage(pre) {
  const code = pre.querySelector('code');
  for (const el of [code, pre]) {
    if (!el) continue;
    const c = (el.getAttribute('class') || '') + ' ' + (el.getAttribute('data-language') || '');
    const m = c.match(/(?:language-|lang-)([\w+#.-]+)/i);
    if (m) return normalizeLanguage(m[1]);
    const attr = el.getAttribute('data-language');
    if (attr) return normalizeLanguage(attr);
  }
  let prev = pre.previousElementSibling;
  if (prev && /^(?:div|span|p)$/i.test(prev.tagName)) {
    const label = (prev.textContent || '').trim();
    if (/^(?:python|javascript|typescript|bash|shell|json|html|xml|sql|css|java|c\+\+|ruby|r|powershell)$/i.test(label)) return normalizeLanguage(label);
  }
  return '';
}
function preText(root) {
  const code = root.querySelector('code') || root;
  function walk(n) {
    if (n.nodeType === 3) return n.nodeValue || '';
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    let out = Array.from(n.childNodes).map(walk).join('');
    if ((tag === 'div' || tag === 'p') && n !== code && !out.endsWith('\n')) out += '\n';
    return out;
  }
  return nl(walk(code)).replace(/\n$/, '');
}
function texEscape(s) { return String(s).replace(/([\\{}#$%&_])/g, '\\$1'); }
function mathMLToTex(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const tag = node.localName.toLowerCase();
  const children = Array.from(node.children);
  const child = i => mathMLToTex(children[i]);
  const joined = () => Array.from(node.childNodes).map(mathMLToTex).join('');
  if (tag === 'annotation') return '';
  if (tag === 'semantics') return child(0);
  if (tag === 'math' || tag === 'mrow' || tag === 'mstyle' || tag === 'mpadded' || tag === 'mphantom') return joined();
  if (tag === 'mi' || tag === 'mn') return (node.textContent || '').trim();
  if (tag === 'mtext') return '\\text{' + texEscape(node.textContent || '') + '}';
  if (tag === 'mo') {
    const sym = (node.textContent || '').trim();
    return ({'−':'-', '×':'\\times ', '÷':'\\div ', '≤':'\\leq ', '≥':'\\geq ', '∑':'\\sum ', '∫':'\\int ', '∞':'\\infty ', '≠':'\\neq ', '→':'\\to '})[sym] || sym;
  }
  if (tag === 'mfrac') return '\\frac{' + child(0) + '}{' + child(1) + '}';
  if (tag === 'msup') return '{' + child(0) + '}^{' + child(1) + '}';
  if (tag === 'msub') return '{' + child(0) + '}_{' + child(1) + '}';
  if (tag === 'msubsup') return '{' + child(0) + '}_{' + child(1) + '}^{' + child(2) + '}';
  if (tag === 'msqrt') return '\\sqrt{' + joined() + '}';
  if (tag === 'mroot') return '\\sqrt[' + child(1) + ']{' + child(0) + '}';
  if (tag === 'mover') return '\\overset{' + child(1) + '}{' + child(0) + '}';
  if (tag === 'munder') return '\\underset{' + child(1) + '}{' + child(0) + '}';
  if (tag === 'munderover') return '\\underset{' + child(1) + '}{\\overset{' + child(2) + '}{' + child(0) + '}}';
  if (tag === 'mtable') return '\\begin{matrix}' + children.map(mathMLToTex).join('\\\\') + '\\end{matrix}';
  if (tag === 'mtr' || tag === 'mlabeledtr') return children.map(mathMLToTex).join(' & ');
  if (tag === 'mtd') return joined();
  if (tag === 'mfenced') return (node.getAttribute('open') || '(') + children.map(mathMLToTex).join(node.getAttribute('separators') || ',') + (node.getAttribute('close') || ')');
  if (tag === 'mspace') return ' ';
  return joined();
}
function getTexFromElement(node) {
  const ann = node.querySelector && node.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="application/x-tex; mode=display"]');
  if (ann && ann.textContent && ann.textContent.trim()) return ann.textContent.trim();
  for (const a of ['data-tex', 'data-latex']) { const t = node.getAttribute(a); if (t) return t; }
  if (node.matches('script[type^="math/tex"]')) return node.textContent.trim();
  const math = node.matches('math') ? node : node.querySelector('math');
  if (math) return mathMLToTex(math).trim();
  return '';
}
function isBlockMath(node) {
  const math = node.matches('math') ? node : node.querySelector('math');
  return !!(node.closest('.katex-display,.MathJax_Display,.math-display') || (math && math.getAttribute('display') === 'block') || node.getAttribute('data-display') === 'block');
}
function makeMarkerFactory(doc) {
  const entries = [];
  const prefix = 'ULTRAPASTETOKEN' + Math.random().toString(36).slice(2).toUpperCase() + 'X';
  function put(node, value, block = false) {
    const token = prefix + entries.length + 'END';
    entries.push({ token, value });
    const wrapper = doc.createElement(block ? 'p' : 'span');
    wrapper.textContent = token;
    node.replaceWith(wrapper);
  }
  function restore(s) {
    for (const { token, value } of entries) s = s.split(token).join(value);
    return s;
  }
  return { put, restore, count: () => entries.length };
}
function selectArticleRoot(doc) {
  const body = doc.body;
  const exact = body.querySelector('article, main, [role="main"], [itemprop="articleBody"]');
  if (exact && (exact.textContent || '').trim().length > 150) return exact;
  let best = body, bestScore = 0;
  for (const el of body.querySelectorAll('section,div,article')) {
    const ps = Array.from(el.querySelectorAll('p')).map(p => (p.textContent || '').trim().length);
    const density = ps.filter(n => n > 60).reduce((a, b) => a + b, 0);
    const links = Array.from(el.querySelectorAll('a')).reduce((n, a) => n + (a.textContent || '').length, 0);
    const score = density - links * .45 - Math.max(0, (el.textContent || '').length - density) * .03;
    if (score > bestScore && density > 200) { best = el; bestScore = score; }
  }
  return best;
}
function htmlToSafeMarkdown(html, options = {}) {
  // Windows/Chromium CF_HTML may include both the full document and selection fragment.
  const start = String(html).indexOf('<!--StartFragment-->');
  const end = String(html).indexOf('<!--EndFragment-->');
  if (start >= 0 && end > start) html = String(html).slice(start + '<!--StartFragment-->'.length, end);
  const parser = new DOMParser();
  let doc = parser.parseFromString(String(html), 'text/html');
  if (options.article) {
    const articleRoot = selectArticleRoot(doc);
    const cloned = articleRoot.cloneNode(true);
    doc.body.replaceChildren(cloned);
    for (const el of Array.from(doc.body.querySelectorAll('nav,header,footer,aside,form,button,script,style,[aria-hidden="true"],.advertisement,.ads,.sidebar'))) el.remove();
  } else {
    for (const el of Array.from(doc.querySelectorAll('script:not([type^="math/tex"]),style,template'))) el.remove();
  }
  const markers = makeMarkerFactory(doc);
  // Replace the outermost math containers first, so rendered KaTeX is never duplicated.
  for (const node of Array.from(doc.body.querySelectorAll('.katex-display,.katex,.MathJax_Display,math,script[type^="math/tex"],[data-tex],[data-latex]'))) {
    if (!node.isConnected) continue;
    const latex = getTexFromElement(node);
    if (!latex) continue;
    markers.put(node, isBlockMath(node) ? '\n\n$$\n' + latex + '\n$$\n\n' : '$' + latex + '$', isBlockMath(node));
  }
  // Protect code before letting the built-in Markdown converter see HTML snippets.
  for (const pre of Array.from(doc.body.querySelectorAll('pre'))) {
    if (!pre.isConnected) continue;
    markers.put(pre, fencedCode(preText(pre), inferLanguage(pre)), true);
  }
  for (const code of Array.from(doc.body.querySelectorAll('code'))) {
    if (!code.isConnected) continue;
    markers.put(code, escapeInlineCode(code.textContent || ''), false);
  }
  // Obsidian Markdown supports highlights and safe inline HTML for underline/sub/sup.
  for (const el of Array.from(doc.body.querySelectorAll('mark,u,sub,sup'))) {
    if (!el.isConnected) continue;
    const name = el.localName.toLowerCase();
    const val = el.textContent || '';
    const formatted = name === 'mark' ? '==' + val + '==' : '<' + name + '>' + val.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</' + name + '>';
    markers.put(el, formatted, false);
  }
  // Obsidian ships the HTML -> Markdown converter; no extra runtime dependencies.
  let converted = htmlToMarkdown(doc.body.innerHTML);
  converted = markers.restore(nl(converted));
  // Make the protected block boundaries independent of the converter's paragraph spacing.
  return converted.replace(/[ \t]+\n/g, '\n');
}
function hasSemanticHtml(html) {
  return /<(?:h[1-6]|strong|b|em|i|table|pre|code|ul|ol|li|blockquote|a\b|math\b|div\b|p\b|img\b|br\b)/i.test(html || '');
}
function looksLikeAlreadyMarkdown(plain) {
  // Headings alone are not evidence that plain text is preferable: AI rich HTML
  // often has actual headings plus strong/em/table nodes that need preserving.
  return /(^|\n)\s*```(?:\w+)?\s*\n|(^|\n)\s*\|[^\n]+\|\s*\n|(^|\n)\s*\$\$\s*\n/m.test(plain);
}
function protectMarkdown(input, options = {}) {
  let text = nl(input);
  const held = [], prefix = '\uE010UP' + Math.random().toString(36).slice(2) + 'K';
  const hold = match => { const t = prefix + held.length + '\uE011'; held.push(match); return t; };
  // Fences and unfinished fences must stay byte-for-byte intact.
  const lines = text.split('\n'), chunks = [];
  let i = 0;
  while (i < lines.length) {
    const op = lines[i].match(/^ {0,3}(`{3,}|~{3,})[^\n]*$/);
    if (!op) { chunks.push(lines[i++]); continue; }
    const start = i, sym = op[1][0], len = op[1].length;
    i++;
    while (i < lines.length && !(new RegExp('^ {0,3}' + (sym === '`' ? '`' : '~') + '{' + len + ',}[ \\t]*$')).test(lines[i])) i++;
    if (i < lines.length) i++;
    chunks.push(hold(lines.slice(start, i).join('\n')));
  }
  text = chunks.join('\n');
  text = text.replace(/(`+)([\s\S]*?)\1/g, hold);
  if (options.math !== false) {
    text = text.replace(/\$\$[\s\S]*?\$\$/g, hold);
    // Avoid lookbehind for older iOS WebViews. Keep preceding character intact.
    text = text.replace(/(^|[^\\])\$(?!\s|\$)(?:\\.|[^$\n])*?\$(?!\$)/g,
      (match, before) => before + hold(match.slice(before.length)));
  }
  if (options.links) {
    text = text.replace(/!?\[[^\]\n]*\]\(<?https?:\/\/[^\s)]+>?\)|<https?:\/\/[^>\n]+>|https?:\/\/[^\s<>]+/g, hold);
  }
  // Restore all opaque markers in ONE scan; avoid O(text length × marker count).
  const markerRe = new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)\\uE011', 'g');
  return { text, restore: value => String(value).replace(markerRe, (match, index) => {
    const item = held[Number(index)];
    return item === undefined ? match : item;
  }) };
}
function convertMathOutsideCode(text) {
  const masked = protectMarkdown(text, { math: true });
  let out = masked.text;
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => '\n\n$$\n' + math.trim() + '\n$$\n\n');
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => '$' + math.trim() + '$');
  return masked.restore(out);
}
/**
 * Fix Math-inspired repair of AI copy artifacts. This independent implementation
 * never changes fenced/inline code, existing $...$ or $$...$$, links or URLs.
 * Only confident bracket patterns are enabled by default.
 */
function likelyMathExpression(source, mode = 'bracket') {
  const s = String(source).trim();
  if (!s || s.length > 5000 || /https?:\/\//i.test(s)) return false;
  if (/^\d+(?:\s*[,،]\s*\d+)*$/.test(s)) return false; // references
  if (/^\^|^\[[^\]]+\]$/.test(s)) return false;
  // Strong signals of mathematics; avoid naive matching of punctuation alone.
  if (/\\(?:frac|dfrac|tfrac|sum|prod|int|lim|sqrt|begin|end|left|right|mathbf|mathrm|mathbb|partial|nabla|alpha|beta|gamma|delta|theta|lambda|sigma|pi|infty|to|rightarrow|leq|geq|neq|times|cdot|sin|cos|log|exp|text|hat|bar|vec|overline|underbrace|binom)\b/.test(s)) return true;
  if (/[∑∫∞±≤≥≠→∂∇]/.test(s)) return true;
  if (/\d\s*[+\-*\/=]\s*\d/.test(s)) return true;
  if (/\b[a-zA-Z]\s*(?:[=<>+\-*\/]\s*)[a-zA-Z0-9]/.test(s) && !/\b[a-zA-Z]{3,}\b/.test(s)) return true;
  if (/[a-zA-Z0-9]\s*[\^_]\s*(?:\{|[a-zA-Z0-9])/.test(s)) return true;
  if (mode === 'paren' && /^\s*[A-Za-z](?:'+)?\s*$/.test(s)) return true;
  return false;
}
function quotedMathLines(lines, options, stats) {
  const output = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Inline standalone bracket or quoted \[ blocks; permit heading export artifact '# ['
    const one = line.match(/^([ \t]*>[ \t]*|[ \t]*)(?:#[ \t]*)?\[[ \t]+(.+?)[ \t]+\][ \t]*$/);
    if (one && likelyMathExpression(one[2])) {
      const prefix = one[1].includes('>') ? one[1] : '';
      output.push(prefix + '$$', prefix + one[2].trim(), prefix + '$$');
      stats.blockCount++;
      i++; continue;
    }
    // Single-line quoted \[ content \] (not handled cleanly by generic delimiter converter)
    const quotedOne = line.match(/^([ \t]*>[ \t]*)\\\[([\s\S]+)\\\][ \t]*$/);
    if (quotedOne) {
      output.push(quotedOne[1] + '$$', quotedOne[1] + quotedOne[2].trim(), quotedOne[1] + '$$');
      stats.blockCount++;
      i++; continue;
    }
    const opening = line.match(/^([ \t]*>[ \t]*|[ \t]*)(?:#[ \t]*)?(\\\[|\[)[ \t]*$/);
    if (!opening) { output.push(line); i++; continue; }
    const prefix = opening[1];
    const quote = prefix.includes('>');
    const backslash = opening[2] === '\\[';
    const captured = [];
    let depth = 1, j = i + 1, found = false;
    while (j < lines.length && j - i < 120) {
      let current = lines[j];
      if (quote) {
        const q = current.match(/^[ \t]*>[ \t]?(.*)$/);
        if (!q) break;
        current = q[1];
      }
      const closeRe = backslash ? /^\s*\\\]\s*$/ : /^\s*\]\s*$/;
      if (closeRe.test(current) && (backslash || depth === 1)) { found = true; break; }
      if (!backslash) {
        // Account for nested [..] without mistaking the final standalone ] for a close.
        for (let k = 0; k < current.length; k++) {
          if (current[k] === '[' && current[k-1] !== '\\') depth++;
          else if (current[k] === ']' && current[k-1] !== '\\') depth--;
        }
        if (depth < 1) break;
      }
      captured.push(current);
      j++;
    }
    const inner = captured.join('\n');
    const confident = backslash || likelyMathExpression(inner);
    if (!found || !confident || !inner.trim()) { output.push(line); i++; continue; }
    const qp = quote ? prefix : '';
    output.push(qp + '$$');
    for (const mathline of captured) output.push(qp + mathline);
    output.push(qp + '$$');
    stats.blockCount++;
    i = j + 1;
  }
  return output;
}
function convertBareParens(text, stats, allowBareVariables = true) {
  let out = '', i = 0;
  while (i < text.length) {
    if (text[i] !== '(' || (i > 0 && !/[\s(،؛:]/.test(text[i-1]))) { out += text[i++]; continue; }
    let depth = 1, j = i + 1;
    for (; j < text.length && depth; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') depth--;
      if (text[j] === '\n') {depth = -1; break;}
    }
    if (depth !== 0) { out += text[i++]; continue; }
    const inner = text.slice(i+1,j-1);
    let k = j; while (text[k] === "'") k++;
    const suffix = text.slice(j,k);
    const after = text[k] || '';
    if (!allowBareVariables && /^[A-Za-z](?:'+)?$/.test(inner.trim())) {out+=text[i++];continue;}
    if (!likelyMathExpression(inner,'paren') || /\\\(|\\\)/.test(inner) || (after && !/[\s),.;:?!،؛؟\]}]/.test(after))) {
      out += text[i++]; continue;
    }
    out += '$' + inner.trim() + suffix + '$';
    stats.inlineCount++;
    i = k;
  }
  return out;
}
function conservativeDisplayRepair(text) {
  // Only amend visibly broken matrix rows. Never act on a normal prose line.
  return text.replace(/\$\$([\s\S]*?)\$\$/g, (block, body) => {
    if (!/\\begin\{(?:[pbBvV]?matrix|array|aligned|align\*?|cases)\}/.test(body)) return block;
    return '$$' + body.replace(/(^|[^\\])\\[ \t]*$/gm,(_m,pre)=>pre+'\\\\') + '$$';
  });
}
/**
 * Recognize balanced inline [ math ] in AI output without consuming Markdown
 * links, citations or WikiLinks. Only Balanced/Aggressive commands use this.
 * A display block is emitted on its own lines: no $$ embedded within prose.
 */
function convertInlineBracketMath(text, stats) {
  const masked = protectMarkdown(text, { math:true, links:true });
  const lines = masked.text.split('\n');
  const output = [];
  for (const source of lines) {
    // Quote math is handled by quotedMathLines. Never reinterpret callout metadata.
    if (/^\s*>/.test(source) || /^\s*\|/.test(source)) { output.push(source); continue; }
    let rest = source, result = '', changed = false;
    while (rest) {
      const opener = rest.indexOf('[');
      if (opener === -1) { result += rest; break; }
      const prior = opener ? rest[opener-1] : '';
      if (prior === '\\' || prior === '[' || !/^\s/.test(rest.slice(opener+1))) {
        result += rest.slice(0,opener+1); rest = rest.slice(opener+1); continue;
      }
      let depth=1, end=-1;
      for (let j=opener+1; j<rest.length; j++) {
        if (rest[j]==='\\' && (rest[j+1]==='[' || rest[j+1]===']')) {j++;continue;}
        if (rest[j]==='[') depth++;
        if (rest[j]===']' && --depth===0) {end=j;break;}
      }
      if (end===-1 || /[(:]/.test(rest[end+1] || '') && /\]\(|\]:/.test(rest.slice(end,end+2))) {
        result += rest.slice(0,opener+1);rest=rest.slice(opener+1);continue;
      }
      const expr=rest.slice(opener+1,end).trim();
      // Require an unambiguous math marker AND conservative mathematical content.
      if (!likelyMathExpression(expr) ||
          !(/\\[A-Za-z]+|[∑∫∞±≤≥≠→∂∇]|[\^_]/.test(expr)) ||
          /^\d+(?:\s*,\s*\d+)*$/.test(expr)) {
        result += rest.slice(0,opener+1); rest=rest.slice(opener+1);continue;
      }
      const pre = (result+rest.slice(0,opener)).trimEnd();
      result = (pre ? pre+'\n' : '') + '$$\n' + expr + '\n$$';
      stats.blockCount++;changed=true;
      rest=rest.slice(end+1);
      if (rest.trim()) result+='\n';
    }
    output.push(changed?result:source);
  }
  return masked.restore(output.join('\n'));
}
/** Fix known AI export artefacts only inside display math; aggressive is
 * deliberately opt-in and ALWAYS previewed before insertion. */
function repairDisplayMathArtifacts(text, stats) {
  const masked = protectMarkdown(text,{ math:false, links:true });
  // Split protected code and non-code with an explicit display-only matcher.
  const out = masked.text.replace(/\$\$([\s\S]*?)\$\$/g, (block, content) => {
    let body=content;
    if (/\\begin\{(?:[pbBvV]?matrix|array|aligned|align\*?|cases)\}/.test(body)) {
      body=body.replace(/(^|[^\\])\\[ \t]*$/gm,(_m,pre)=>pre+'\\\\');
      body=body.replace(/(^|[^\\])\\(?=[0-9-])/g,(_m,pre)=>pre+'\\\\');
    }
    body=body.replace(/^#{1,6}[ \t]+(?=\\(?:begin|frac|sum|int|sqrt|left)\b)/gm,'');
    body=body.replace(/^={3,}[ \t]*$/gm,'=');
    body=body.replace(/^-{3,}[ \t]*$/gm,'-');
    body=body.replace(/^([+-]),(?=\\|[\dA-Za-z])/gm,'$1');
    body=body.replace(/(^|[^\\])#/g,(_m,pre)=>pre+'\\#');
    if (body!==content) stats.artifactCount=(stats.artifactCount||0)+1;
    return '$$'+body+'$$';
  });
  return masked.restore(out);
}
function fixMathWithProfile(text, profile='safe') {
  if (!['safe','balanced','aggressive'].includes(profile)) throw new Error('Unknown math profile');
  const options={convertMath:true, detectBracketMath:true,
    detectParenMath:profile!=='safe',allowBareVariables:profile==='aggressive',repairMathArtifacts:profile==='balanced'};
  const stats={inlineCount:0,blockCount:0,artifactCount:0};
  let output=String(text);
  // Balance adjacent display delimiters without changing literal code or links.
  if (profile!=='safe') {
    const masked=protectMarkdown(output,{math:true,links:true});
    output=masked.restore(masked.text.replace(/\\\][ \t]*\\\[/g,'\\]\n\\['));
  }
  const result=fixAIMath(output,options,stats);
  output=result.text;
  if (profile!=='safe') output=convertInlineBracketMath(output,stats);
  if (profile==='aggressive') {
    output=repairDisplayMathArtifacts(output,stats);
  }
  // Preserve the note's existing line-ending convention for manual commands.
  if (/\r\n/.test(text)) output=output.replace(/\r?\n/g,'\r\n');
  else if (/\r(?!\n)/.test(text)) output=output.replace(/\r?\n/g,'\r');
  return {text:output,stats,profile,changed:output!==String(text)};
}

function fixAIMath(text, settings = {}, stats = {inlineCount:0,blockCount:0}) {
  // Input protection is re-applied after each step; the original Markdown code
  // and valid math spans are restored verbatim. No custom rules run here.
  let output = text;
  if (settings.detectBracketMath !== false) {
    const masked = protectMarkdown(output, { math:true, links:true });
    output = masked.restore(quotedMathLines(masked.text.split('\n'), settings, stats).join('\n'));
  }
  if (settings.convertMath !== false) {
    const before = output;
    output = convertMathOutsideCode(output);
    const newDisplay = (output.match(/\$\$[\s\S]*?\$\$/g)||[]).length - (before.match(/\$\$[\s\S]*?\$\$/g)||[]).length;
    const newInline = (output.match(/(^|[^$])\$(?!\$)[^\n$]+\$(?!\$)/g)||[]).length - (before.match(/(^|[^$])\$(?!\$)[^\n$]+\$(?!\$)/g)||[]).length;
    stats.blockCount += Math.max(0,newDisplay);
    stats.inlineCount += Math.max(0,newInline);
  }
  if (settings.detectParenMath) {
    const masked = protectMarkdown(output, {math:true,links:true});
    output = masked.restore(convertBareParens(masked.text,stats,settings.allowBareVariables !== false));
  }
  if (settings.repairMathArtifacts) output = conservativeDisplayRepair(output);
  return {text:output,stats};
}

function stripTrackingUrl(raw) {
  try {
    if (!/^https?:\/\//i.test(raw)) return raw;
    // Do not decode or reserialize nontracking URL parameters (e.g. %20 vs +).
    const h = raw.indexOf('#');
    const hash = h >= 0 ? raw.slice(h) : '';
    const beforeHash = h >= 0 ? raw.slice(0, h) : raw;
    const q = beforeHash.indexOf('?');
    if (q === -1) return raw;
    const args = beforeHash.slice(q + 1).split('&').filter(part => {
      const key = part.split('=')[0];
      let decoded = key;
      try { decoded = decodeURIComponent(key.replace(/\+/g, ' ')); } catch (_) { /* unchanged */ }
      return !TRACK_KEYS.test(decoded);
    });
    return beforeHash.slice(0, q) + (args.length ? '?' + args.join('&') : '') + hash;
  } catch (_) { return raw; }
}
function cleanLinks(text) {
  const masked = protectMarkdown(text, { math: true });
  let s = masked.text;
  // URL capture leaves punctuation and closing Markdown delimiters outside.
  s = s.replace(/https?:\/\/[^\s<>\])}"']+/gi, raw => stripTrackingUrl(raw));
  return masked.restore(s);
}
/** Auto Link Title integration: only request titles for standalone HTTP(S) links. */
function getStandaloneUrl(text) {
  const value = String(text || '').trim();
  if (!/^https?:\/\/[^\s<>]+$/i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
    return value;
  } catch (_) { return null; }
}
function urlHostname(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch (_) { return ''; }
}
function isExcludedTitleHost(url, blacklist = '') {
  const host = urlHostname(url);
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  // Do not make automatic background fetches to local/network IP addresses.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || host.startsWith('[')) return true;
  return String(blacklist).split(/[,\n]/).map(x => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
    .some(domain => host === domain || host.endsWith('.' + domain));
}
function isDirectAssetUrl(url) {
  try { return /\.(?:png|jpe?g|gif|svg|webp|bmp|tiff?|pdf|zip|7z|rar|mp[34]|mov|avi|woff2?|exe|dmg|apk|docx?|xlsx?|pptx?)(?:$)/i.test(new URL(url).pathname); }
  catch (_) { return false; }
}
function normalizePageTitle(title) {
  return String(title || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function escapeMarkdownLinkTitle(title) {
  return normalizePageTitle(title).replace(/\\/g, '\\\\').replace(/([\\\[\]`*_~|<>])/g, '\\$1');
}
function titleFromHtml(html) {
  if (!html || typeof DOMParser !== 'function') return '';
  const doc = new DOMParser().parseFromString(String(html).slice(0, 1000000), 'text/html');
  const el = doc.querySelector('title');
  const title = el && el.textContent && el.textContent.trim();
  const meta = doc.querySelector('meta[property="og:title"],meta[name="twitter:title"]');
  return (title || (meta && meta.getAttribute('content')) || '').trim();
}
function htmlProvidesLinkLabel(html, url) {
  if (!html || !/<a\b/i.test(html) || typeof DOMParser !== 'function') return false;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a[href]'));
    if (links.length !== 1) return false;
    const a = links[0];
    const label = (a.textContent || '').trim();
    return !!label && label !== url && label !== stripTrackingUrl(url) && !/^https?:\/\//i.test(label);
  } catch (_) { return false; }
}
function isInsideLinkTargetOrQuotedAttribute(editor) {
  if (!editor || typeof editor.getCursor !== 'function' || typeof editor.getLine !== 'function') return false;
  const pos = editor.getCursor('from');
  const before = editor.getLine(pos.line).slice(0, pos.ch);
  return /\]\(\s*<?$/.test(before) || /(?:href|src)\s*=\s*["']$/.test(before) || /["']$/.test(before);
}
function autoTitleCandidate(plain, html, editor, settings, options = {}) {
  if (!settings.autoLinkTitles || options.plain || options.article) return null;
  if (options.selectedText && settings.wrapSelectedTextWithUrl) return null;
  const url = getStandaloneUrl(plain);
  if (!url || isDirectAssetUrl(url) || isExcludedTitleHost(url, settings.autoTitleBlacklist)) return null;
  if (htmlProvidesLinkLabel(html, url) || isInsideLinkTargetOrQuotedAttribute(editor)) return null;
  if (settings.preserveCode && (isInsideFence(editor) || isInsideInlineCode(editor))) return null;
  return settings.cleanTracking ? stripTrackingUrl(url) : url;
}
function titledMarkdown(url, pageTitle, maxLength = 0) {
  let rawTitle = normalizePageTitle(pageTitle);
  if (!rawTitle) return url;
  const maximum = Math.max(0, Number(maxLength) || 0);
  if (maximum && rawTitle.length > maximum) rawTitle = rawTitle.slice(0, Math.max(0, maximum - 1)).trimEnd() + '…';
  const title = escapeMarkdownLinkTitle(rawTitle);
  // Angle-wrapped destinations retain URLs containing parentheses safely.
  return '[' + title + '](<' + url.replace(/>/g, '%3E') + '>)';
}
function normalizeHeadingsAndSpacing(text, settings) {
  const masked = protectMarkdown(text, { math: true, links: true });
  let s = masked.text;
  if (settings.normalizeHeadings) {
    s = s.replace(/^( {0,3}#{1,6}\s+)\*\*(.+?)\*\*\s*$/gm, '$1$2');
  }
  if (settings.condenseBlankLines) s = s.replace(/\n(?:[ \t]*\n){3,}/g, '\n\n\n');
  return masked.restore(s);
}
function cleanAIReferences(text) {
  const masked = protectMarkdown(text, { math: true, links: true });
  return masked.restore(masked.text.replace(AI_CITATIONS, ''));
}
function normalizeRule(rule) {
  return {
    id: String(rule.id || ('rule-' + Math.random().toString(36).slice(2))),
    name: String(rule.name || 'Untitled rule').slice(0, 100),
    enabled: !!rule.enabled,
    type: rule.type === 'javascript' ? 'javascript' : 'regex',
    pattern: String(rule.pattern || ''),
    flags: String(rule.flags || 'g').replace(/[^gimsu]/g, ''),
    replacement: String(rule.replacement || ''),
    script: String(rule.script || ''),
    scope: rule.scope === 'all' ? 'all' : 'prose'
  };
}
function applyCustomRules(text, rules, settings, selectedText = '') {
  if (!settings.enableCustomRules) return text;
  let output = text;
  for (const raw of (rules || []).slice(0, RULE_LIMIT)) {
    const r = normalizeRule(raw);
    if (!r.enabled) continue;
    const protectedText = r.scope === 'all' ? { text: output, restore: x => x } : protectMarkdown(output, { math: true, links: true });
    let s = protectedText.text;
    try {
      if (r.type === 'javascript') {
        if (!settings.allowJavaScriptRules || !r.script) continue;
        // Explicit opt-in only. JavaScript rules are NOT sandboxed.
        const fn = new Function('ctx', '"use strict";\n' + r.script);
        if (r.pattern) {
          const reg = new RegExp(r.pattern, r.flags || 'g');
          s = s.replace(reg, (...args) => {
            const captured = args.slice(1, args.length - (typeof args[args.length - 1] === 'object' ? 3 : 2));
            const matched = [args[0], ...captured];
            const ctx = Object.freeze({ text: s, foundText: args[0], match: matched,
              selectedText, source: 'paste', debug: !!settings.debug });
            const result = fn(ctx);
            if (typeof result !== 'string') throw new Error('JavaScript rule must synchronously return a string (async unsupported)');
            return result;
          });
        } else {
          const ctx = Object.freeze({ text: s, foundText: s, match: [s],
            selectedText, source: 'paste', debug: !!settings.debug });
          const result = fn(ctx);
          if (typeof result !== 'string') throw new Error('JavaScript rule must synchronously return a string (async unsupported)');
          s = result;
        }
      } else if (r.pattern) {
        const reg = new RegExp(r.pattern, r.flags || 'g');
        s = s.replace(reg, r.replacement.split('$SEL').join(selectedText));
      }
      output = protectedText.restore(s);
    } catch (err) {
      console.warn('Ultra Paste rule failed:', r.name, err);
      // Fail closed for this rule, preserve output from previous rules.
      if (settings.debug) new Notice('Ultra Paste: rule "' + r.name + '" failed; skipped.');
    }
  }
  return output;
}
function isInsideFence(editor) {
  if (!editor || typeof editor.getCursor !== 'function' || typeof editor.getLine !== 'function') return false;
  const cursor = editor.getCursor('from');
  let opened = null;
  for (let i = 0; i <= cursor.line; i++) {
    const line = editor.getLine(i);
    const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!m) continue;
    if (!opened) { opened = { c: m[1][0], n: m[1].length }; continue; }
    if (m[1][0] === opened.c && m[1].length >= opened.n && /^\s*$/.test(line.slice(m[0].length))) opened = null;
  }
  return opened !== null;
}
function isInsideInlineCode(editor) {
  if (!editor || typeof editor.getCursor !== 'function' || typeof editor.getLine !== 'function') return false;
  const pos = editor.getCursor('from');
  const preceding = editor.getLine(pos.line).slice(0, pos.ch);
  const runs = preceding.match(/`+/g) || [];
  return runs.length % 2 === 1; // conservative for ordinary single-backtick inline code
}
function formatPaste(plain, html, settings, options = {}) {
  let text = nl(plain);
  const mode = options.mode || settings.mode;
  const article = !!options.article;
  const htmlExists = !!html && hasSemanticHtml(html);
  const useHtml = !!html && (article || mode === 'rich' || (mode === 'auto' && htmlExists && !(settings.preferPlainMarkdown && looksLikeAlreadyMarkdown(text))));
  if (useHtml) {
    try {
      const converted = htmlToSafeMarkdown(html, { article });
      if (converted.trim()) text = converted;
    } catch (error) {
      console.warn('Ultra Paste: HTML conversion failed, falling back to plain text', error);
      if (settings.debug) new Notice('Ultra Paste: HTML conversion failed; using plain text.');
    }
  }
  if (settings.convertMath || settings.detectBracketMath || settings.detectParenMath) text = fixAIMath(text, settings).text;
  if (settings.cleanTracking) text = cleanLinks(text);
  if (settings.stripAIReferences) text = cleanAIReferences(text);
  text = normalizeHeadingsAndSpacing(text, settings);
  text = applyCustomRules(text, settings.rules, settings, options.selectedText || '');
  if (settings.wrapSelectedTextWithUrl && options.selectedText && /^https?:\/\/\S+$/.test(text.trim())) {
    const safeLabel = options.selectedText.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
    text = '[' + safeLabel + '](' + text.trim() + ')';
  }
  return text.replace(/^\n+|\n+$/g, '');
}

/* ---------- On-demand PDF text cleanup (never runs in ordinary paste) -------- */
function expandPdfLigatures(text) {
  const chars = {'\uFB00':'ff','\uFB01':'fi','\uFB02':'fl','\uFB03':'ffi','\uFB04':'ffl','\uFB05':'st','\uFB06':'st'};
  return text.replace(/[\uFB00-\uFB06]/g, c => chars[c] || c);
}
function pdfProtectedLine(line, state) {
  const trimmed=line.trim();
  const fence=trimmed.match(/^(`{3,}|~{3,})/);
  if (fence) {
    if (!state.fence) state.fence={char:fence[1][0],size:fence[1].length};
    else if (state.fence.char===fence[1][0] && fence[1].length>=state.fence.size &&
       new RegExp('^'+(state.fence.char==='`'?'`':'~')+'{'+state.fence.size+',}\\s*$').test(trimmed)) state.fence=null;
    return true;
  }
  if (state.fence) return true;
  if (trimmed==='$$') {state.math=!state.math;return true;}
  if (state.math) return true;
  // Do not merge Markdown structure, links, equations, URL-only lines or code.
  return /^(?:#{1,6}\s|>|[-*+]\s|\d{1,9}[.)]\s|\|.*\||\[\^|<|https?:\/\/|\s{4,}\S)/.test(line)
      || /(?:`|\\(?:frac|begin|end|\[|\]|\(|\))|\$\$|\[[^\]]+\]\(https?:\/\/)/.test(line);
}
function cleanPdfText(source, options={}) {
  const removePageNumbers=!!options.removePageNumbers;
  const singleParagraph=!!options.singleParagraph;
  const raw=expandPdfLigatures(nl(source)).split('\n');
  const state={fence:null,math:false};
  const lines=raw.map(text=>({text,protected:pdfProtectedLine(text,state)}));
  // A page number can be a valid scientific value: never remove unless explicitly requested.
  if (removePageNumbers) {
    for (let i=0;i<lines.length;i++) {
      const line=lines[i], t=line.text.trim();
      const isolated=(i===0||lines[i-1].text.trim()==='')&&(i===lines.length-1||lines[i+1].text.trim()==='');
      if (!line.protected && isolated && /^(?:-\s*)?\d{1,3}(?:\s*[-/|]\s*\d{1,3})?(?:\s*-)?$/.test(t)) line.removed=true;
    }
  }
  const output=[];
  let paragraph='';let previous='';
  const flush=()=>{if(paragraph!=='')output.push(paragraph);paragraph='';previous='';};
  for (let i=0;i<lines.length;i++) {
    const item=lines[i];
    if (item.removed) continue;
    const txt=item.text;
    if (item.protected) {flush();output.push(txt);continue;}
    if (!txt.trim()) {flush(); if (!singleParagraph && output.length && output[output.length-1]!=='') output.push(''); continue;}
    if (!paragraph) {paragraph=txt.trim();previous=txt;continue;}
    const next=txt.trim();
    // Preserve clear sentence boundaries unless the user opted to force one paragraph.
    const isWrap=singleParagraph || /[\p{L}]-\s*$/u.test(previous) ||
      (previous.trimEnd().length>=32 && !/[.!?؛؟:]\s*$/.test(previous.trimEnd())) ||
      (!/[.!?؛؟:]\s*$/.test(previous.trimEnd()) && /^[\p{Ll}]/u.test(next));
    if (!isWrap) {flush();paragraph=next;previous=txt;continue;}
    if (/[A-Za-z]-\s*$/.test(paragraph) && /^[a-z]/.test(next)) paragraph=paragraph.replace(/-\s*$/,'')+next;
    else paragraph+=' '+next;
    previous=txt;
  }
  flush();
  if (!singleParagraph) return output.join('\n').replace(/\n{3,}/g,'\n\n');
  // Single paragraph affects prose only: protected structures remain on their own lines.
  let out=[];let prose='';
  const push=()=>{if(prose){out.push(prose);prose='';}};
  for (const part of output) {
    if (part==='') continue;
    if (lines.some(line=>line.protected&&line.text===part)) {push();out.push(part);}
    else prose+= (prose?' ':'')+part.trim();
  }
  push();return out.join('\n\n');
}

/* ------ Context-sensitive Markdown structure; only smart-paste paths ------ */
function classifyListLines(text) {
  const lines=nl(text).split('\n');
  if (lines.length<2) return null;
  const re=/^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX-]\][ \t]+)?(.*)$/;
  const result=[];
  let count=0;
  for(const line of lines) {
    if (!line.trim()) {result.push(null);continue;}
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,})$/.test(line)) return null;
    const match=line.match(re);
    if(!match) return null;
    const indent=match[1], marker=match[2], after=match[3], checked=match[4]||'', body=match[5];
    result.push({indent,marker,after,checked,body});count++;
  }
  if (count<2) return null;
  const first=result.find(Boolean);
  if(result[0]!==first) return null;
  // Only rebase a list whose root starts at the minimum indentation.
  if (result.some(x=>x&&x.indent.length<first.indent.length)) return null;
  return result;
}
function structurePaste(text, editor, settings={}) {
  if (!text || !editor || typeof editor.getCursor!=='function' || typeof editor.getLine!=='function') return text;
  if (!(settings.smartStructureLists || settings.smartStructureQuotes)) return text;
  const from=editor.getCursor('from'), to=editor.getCursor('to');
  if(!from || !to || from.line!==to.line) return text;
  const line=editor.getLine(from.line)||'';
  const left=line.slice(0,from.ch), right=line.slice(to.ch);
  if(right.trim()!=='' || /^\s*(?:`{3,}|~{3,})/.test(line)) return text;
  // Quote prefix may contain multiple >, including nested callouts.
  const quote=left.match(/^([ \t]*(?:>[ \t]*)+)([^\n]*)$/);
  if (settings.smartStructureQuotes && quote && nl(text).includes('\n')) {
    const prefix=quote[1];
    // On a callout header, only continue quotes on the following dedicated > line.
    if (/^\[![\w-]+\]/.test(quote[2].trim())) return text;
    return nl(text).split('\n').map((ln,i)=>i===0?ln:(ln.trim()?prefix+ln:prefix.trimEnd())).join('\n');
  }
  if (!settings.smartStructureLists) return text;
  const dest=left.match(/^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/);
  if(!dest) return text;
  const src=classifyListLines(text);
  if(!src) return text;
  const [_, destIndent, destMarker, destSpace, destBody] = dest;
  // Avoid modifying a checkbox or prose beyond the destination marker.
  const first=src[0];
  const nested=src.find(x=>x&&x!==first&&x.indent.length>first.indent.length);
  const step= nested ? nested.indent.slice(first.indent.length) : (destIndent.includes('\t')?'\t':'  ');
  const nestedStep=step.includes('\t') ? '\t' : ' '.repeat(Math.max(destMarker.length+destSpace.length,step.length));
  const base=destIndent + (destBody.trim()? nestedStep : '');
  const remap=(entry)=>{
    if (!entry) return '';
    const offset=entry.indent.slice(first.indent.length);
    return base+offset+entry.marker+entry.after+entry.checked+entry.body;
  };
  if(destBody.trim()) return '\n'+src.map(remap).join('\n');
  // Empty destination list item supplies the first list marker; do not duplicate it.
  const rootContent=first.checked+first.body;
  const subsequent=src.slice(1).map(remap);
  return rootContent+(subsequent.length?'\n'+subsequent.join('\n'):'');
}

/* ------ Deterministic synchronous detector pipeline ------ */
const SMART_PASTE_DETECTORS = Object.freeze([
  {
    id: 'code-context',
    detect(ctx) {
      if (!(ctx.settings.preserveCode && (isInsideFence(ctx.editor) || isInsideInlineCode(ctx.editor)))) return undefined;
      // HTML-only inside code: do not guess a plain-text representation.
      return ctx.plain ? {kind:'insert', source:'code-context', text:ctx.plain} : null;
    }
  },
  {
    id: 'single-url',
    detect(ctx) {
      const url=autoTitleCandidate(ctx.plain,ctx.html,ctx.editor,ctx.settings,{selectedText:ctx.selectedText});
      return url ? {kind:'title',source:'single-url',url} : undefined;
    }
  },
  {
    id: 'html-or-text',
    detect(ctx) {
      const result=formatPaste(ctx.plain,ctx.html,ctx.settings,{selectedText:ctx.selectedText});
      // Never erase an existing selection because a converter returned empty text.
      if (!result) return null;
      return {kind:'insert',source:ctx.html&&hasSemanticHtml(ctx.html)?'rich-html':'plain-markdown',
        text:structurePaste(result,ctx.editor,ctx.settings)};
    }
  }
]);
function detectSmartPaste(plain,html,editor,settings,options={}) {
  // null = let Obsidian process the paste natively. First matching detector wins.
  const ctx={plain,html,editor,settings,selectedText:options.selectedText||''};
  for (const detector of SMART_PASTE_DETECTORS) {
    const result=detector.detect(ctx);
    if (result!==undefined) return result;
  }
  return null;
}


/* ------ Smart Image Paste: independent clipboard file detector ------
 * No image processing is ever called from the strict text/plain shortcut.
 * Images remain in the Obsidian vault: no cloud service or automatic deletion.
 */
const IMAGE_EXT_BY_MIME = Object.freeze({
  'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp',
  'image/gif':'gif', 'image/bmp':'bmp', 'image/avif':'avif'
});
const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_NAME_FORBIDDEN = /[\\/:*?"<>|\x00-\x1f]/g;
const IMAGE_RESERVED_WIN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
function imageExt(mime, name='') {
  const actual=String(mime||'').split(';')[0].toLowerCase();
  if (IMAGE_EXT_BY_MIME[actual]) return IMAGE_EXT_BY_MIME[actual];
  if(actual.startsWith('image/')) return ''; // refuse unknown/mismatched image MIME
  const match=String(name).match(/\.([a-zA-Z0-9]{2,5})$/);
  const byName=match && match[1].toLowerCase();
  return (byName==='jpeg'?'jpg':Object.values(IMAGE_EXT_BY_MIME).includes(byName)?byName:'');
}
function safeImageStem(value) {
  let stem=String(value==null?'':value).normalize('NFC').replace(IMAGE_NAME_FORBIDDEN,'-')
    .replace(/\s+/g,' ').replace(/[. ]+$/g,'').replace(/^[-. ]+/g,'').trim();
  if (IMAGE_RESERVED_WIN.test(stem)) stem='image-'+stem;
  return (stem.slice(0,150).replace(/[. ]+$/g,'')||'Image');
}
function imageDate(now=new Date()) {
  return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
}
function imageNameFromTemplate(pattern, note, originalStem, count, frontmatter, now=new Date()) {
  const props=frontmatter&&typeof frontmatter==='object'?frontmatter:{};
  const filename=note&&note.basename || 'Note';
  const tokens={
    noteName:filename, date:imageDate(now),
    datetime:imageDate(now)+'-'+String(now.getHours()).padStart(2,'0')+String(now.getMinutes()).padStart(2,'0')+String(now.getSeconds()).padStart(2,'0'),
    counter:String(count).padStart(3,'0'), originalName:originalStem||'Image',
    imageNameKey:props.imageNameKey==null?'':String(props.imageNameKey)
  };
  return safeImageStem(String(pattern||DEFAULTS.imageNameTemplate).replace(/\{\{(noteName|date|datetime|counter|originalName|imageNameKey|frontmatter:[\w-]+)\}\}/g,(_whole,key)=>{
    if(key.startsWith('frontmatter:')) {const val=props[key.slice(12)];return val==null?'':String(val);}
    return tokens[key];
  }));
}
function joinedVaultPath(...parts) {
  return parts.filter(Boolean).join('/').replace(/\\/g,'/').replace(/\/+/g,'/');
}
function eligibleImageFiles(transfer) {
  if(!transfer) return [];
  const files=Array.from(transfer.files||[]);
  if(!files.length && transfer.items) {
    for(const item of Array.from(transfer.items)) {
      if(item && item.kind==='file' && typeof item.getAsFile==='function') {
        const f=item.getAsFile();if(f) files.push(f);
      }
    }
  }
  // Do not steal mixed file/image clipboard transfers from Obsidian.
  if(!files.length || files.length>12 || files.reduce((n,f)=>n+f.size,0)>IMAGE_MAX_BYTES*4 || files.some(f=>!imageExt(f.type,f.name)||f.size>IMAGE_MAX_BYTES)) return [];
  return files;
}
async function imageHash(bytes) {
  const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(typeof crypto!=='undefined' && crypto.subtle && crypto.subtle.digest) {
    const digest=await crypto.subtle.digest('SHA-256',u8);
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }
  if (isDesktopRuntime()) return require('node:crypto').createHash('sha256').update(Buffer.from(u8)).digest('hex');
  // Missing Web Crypto on a mobile WebView must not abort a user image paste.
  return null;
}
function imageDimensions(blob) {
  if(typeof URL==='undefined' || !URL.createObjectURL || typeof Image==='undefined') return Promise.resolve(null);
  return new Promise(resolve=>{
    const url=URL.createObjectURL(blob);const img=new Image();
    const finish=val=>{URL.revokeObjectURL(url);resolve(val);};
    img.onload=()=>finish({width:img.naturalWidth,height:img.naturalHeight});
    img.onerror=()=>finish(null);
    img.src=url;
  });
}
async function optionallyCompressImage(blob, settings) {
  if(!settings.imageCompression || !/^image\/(?:jpeg|webp|png)$/.test(blob.type||'')) return blob;
  if(typeof URL==='undefined'||!URL.createObjectURL ||typeof Image==='undefined'||typeof document==='undefined') return blob;
  return new Promise(resolve=>{
    const url=URL.createObjectURL(blob);const img=new Image();
    const fallback=()=>{URL.revokeObjectURL(url);resolve(blob);};
    img.onerror=fallback;
    img.onload=()=>{
      try {
        const maxWidth=Math.max(100,Math.min(8000,Number(settings.imageMaxWidth)||1920));
        const scale=Math.min(1,maxWidth/img.naturalWidth);
        // Recompress PNG only if resized; preserve alpha and source format.
        if(scale===1 && blob.type==='image/png')return fallback();
        const canvas=document.createElement('canvas');
        canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
        if(!canvas.width||!canvas.height||!canvas.getContext('2d'))return fallback();
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        canvas.toBlob(result=>{
          URL.revokeObjectURL(url);
          resolve(result && result.size>0 && (scale<1||result.size<blob.size) ? result : blob);
        },blob.type,Math.max(0.1,Math.min(1,Number(settings.imageQuality)||0.85)));
      }catch(_error){fallback();}
    };
    img.src=url;
  });
}
function imageDisplayWidth(dimensions, settings) {
  if(!settings.imageAutoWidth||!dimensions) return 0;
  const {width,height}=dimensions;
  const suggested=height>width?Number(settings.imagePortraitWidth):Number(settings.imageMaxDisplayWidth);
  if(!(suggested>0))return 0;
  return width>suggested?Math.floor(suggested):0;
}
function imageEmbedLink(link,width) {
  // Obsidian creates syntax matching the user's preferred Wiki/Markdown links.
  if(!link) return '';
  const embed=link.startsWith('!')?link:'!'+link;
  if(!width) return embed;
  if(/^!\[\[[\s\S]*\]\]$/.test(embed)) return embed.replace(/\]\]$/,`|${width}]]`);
  if(/^!\[[^\]]*\]\([\s\S]*\)$/.test(embed)) return embed.replace(/^!\[([^\]]*)\]/,(_m,alt)=>`![${alt}|${width}]`);
  return embed;
}
function validateImageUrl(raw) {
  try {
    const u=new URL(String(raw).trim());
    if(u.protocol!=='https:'||u.username||u.password) return null;
    const host=u.hostname.toLowerCase().replace(/\.$/,'');
    if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host==='0.0.0.0'||host==='[::1]')return null;
    // Do not turn Ultra Paste into a local-network image downloader.
    if(/^\d+(?:\.\d+){3}$/.test(host)||host.startsWith('['))return null;
    return u.href;
  }catch(_e){return null;}
}
class UltraPasteImageNamingModal extends Modal {
  constructor(app, proposal, blob, targetDir, filenameExt, dimensions, onFinish) {
    super(app);this.proposal=proposal;this.blob=blob;this.targetDir=targetDir;this.filenameExt=filenameExt;
    this.onFinish=onFinish;this.dimensions=dimensions;this.done=false;this.url=null;
  }
  finish(value) {if(this.done)return;this.done=true;this.onFinish(value);this.close();}
  onOpen() {
    const el=this.contentEl;el.empty();el.createEl('h2',{text:'Ultra Paste — Smart Image Paste'});
    el.createEl('p',{text:'Review the image and filename. No files are saved until you confirm.'});
    if(typeof URL!=='undefined'&&URL.createObjectURL){
      this.url=URL.createObjectURL(this.blob);
      const pic=el.createEl('img');pic.src=this.url;pic.alt='Image preview';
      pic.style.maxWidth='100%';pic.style.maxHeight='250px';pic.style.objectFit='contain';
    }
    const dims=this.dimensions?`${this.dimensions.width} × ${this.dimensions.height} px · `:'';
    el.createEl('p',{text:`${dims}${(this.blob.size/1024).toFixed(1)} KB`});
    const path=el.createEl('p');
    new Setting(el).setName('Image filename (without extension)').addText(t=>{
      t.setValue(this.proposal);
      t.onChange(v=>{const stem=safeImageStem(v);path.setText(`Destination: ${joinedVaultPath(this.targetDir,stem+'.'+this.filenameExt)} (collision-safe)`);});
      this.input=t.inputEl;
    });
    path.setText(`Destination: ${joinedVaultPath(this.targetDir,this.proposal+'.'+this.filenameExt)} (collision-safe)`);
    new Setting(el).addButton(b=>b.setButtonText('Save image').setCta().onClick(()=>this.finish(safeImageStem(this.input.value))))
      .addButton(b=>b.setButtonText('Cancel').onClick(()=>this.finish(null)));
    if(this.input) {this.input.focus();this.input.select();}
  }
  onClose() {if(this.url)URL.revokeObjectURL(this.url);if(!this.done){this.done=true;this.onFinish(null);}this.contentEl.empty();}
}
class UltraPasteRenameImageModal extends Modal {
  constructor(app, file, onFinish) {super(app);this.file=file;this.onFinish=onFinish;this.done=false;}
  finish(value) {if(this.done)return;this.done=true;this.onFinish(value);this.close();}
  onOpen(){const el=this.contentEl;el.empty();el.createEl('h2',{text:'Rename image safely'});
    el.createEl('p',{text:'Only the filename will change. Obsidian must have automatic internal-link updates enabled.'});
    el.createEl('p',{text:'Current: '+this.file.path});
    new Setting(el).setName('New filename (without extension)').addText(t=>{t.setValue(this.file.basename);this.input=t.inputEl;});
    new Setting(el).addButton(b=>b.setButtonText('Rename').setCta().onClick(()=>this.finish(safeImageStem(this.input.value))))
      .addButton(b=>b.setButtonText('Cancel').onClick(()=>this.finish(null)));
    this.input.focus();this.input.select();
  }
  onClose(){if(!this.done){this.done=true;this.onFinish(null);}this.contentEl.empty();}
}
function imageRefAtCursor(line, ch) {
  // Return only an image embed covering the cursor, including Markdown <paths with spaces>.
  for(const re of [
    /!\[\[([^\]|]+\.(?:png|jpe?g|webp|gif|bmp|avif))(?:\|[^\]]*)?\]\]/gi,
    /!\[[^\]]*\]\(\s*(?:<([^>]+\.(?:png|jpe?g|webp|gif|bmp|avif))>|([^\s)>]+\.(?:png|jpe?g|webp|gif|bmp|avif)))\s*\)/gi
  ]) {
    let m;while((m=re.exec(line)))if(ch>=m.index&&ch<=m.index+m[0].length)return m[1]||m[2];
  }
  return null;
}

class UltraPastePreview extends Modal {
  constructor(app, plain, html, formatted, onInsert) {
    super(app);
    this.plain = plain; this.html = html; this.formatted = formatted; this.onInsert = onInsert;
  }
  onOpen() {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'Ultra Paste — Clipboard preview' });
    contentEl.createEl('p', { text: 'Compare clipboard text, HTML and the final Markdown. Changes have not been inserted.' });
    for (const [label, value] of [['Original plain text', this.plain], ['Original HTML (first 15,000 characters)', this.html.slice(0, 15000)], ['Output Markdown', this.formatted]]) {
      contentEl.createEl('h4', { text: label });
      const ta = contentEl.createEl('textarea'); ta.value = value; ta.readOnly = true; ta.rows = label.startsWith('Output') ? 12 : 5;
      ta.style.width = '100%'; ta.style.fontFamily = 'monospace';
    }
    new Setting(contentEl).addButton(b => b.setButtonText('Insert formatted').setCta().onClick(() => { this.close(); this.onInsert(this.formatted); }))
      .addButton(b => b.setButtonText('Insert original').onClick(() => { this.close(); this.onInsert(this.plain); }))
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()));
  }
  onClose() { this.contentEl.empty(); }
}

class UltraPastePdfPreview extends Modal {
  constructor(app,editor,source) { super(app);this.editor=editor;this.source=source;this.filePath=(app.workspace.getActiveFile()||{}).path;this.originalNote=editor.getValue();this.from=editor.getCursor('from');this.to=editor.getCursor('to');this.options={removePageNumbers:false,singleParagraph:false}; }
  onOpen() {
    const el=this.contentEl;el.empty();
    el.createEl('h2',{text:'Ultra Paste — Clean PDF text'});
    el.createEl('p',{text:'Review the cleaned selection before replacing it. Math, links and code lines are preserved where detected. Nothing changes until Apply.'});
    const render=()=>{
      const revised=cleanPdfText(this.source,this.options);
      output.value=revised;
      count.textContent=revised===this.source?'No changes detected.':'Review changes carefully before applying.';
    };
    new Setting(el).setName('Remove isolated page numbers').setDesc('May remove legitimate standalone numeric values; off by default.').addToggle(t=>t.setValue(false).onChange(v=>{this.options.removePageNumbers=v;render();}));
    new Setting(el).setName('Join prose into one paragraph').setDesc('Aggressive: leaves recognized code and Markdown structure alone.').addToggle(t=>t.setValue(false).onChange(v=>{this.options.singleParagraph=v;render();}));
    el.createEl('h4',{text:'Original selection'});
    const original=el.createEl('textarea');original.value=this.source;original.readOnly=true;original.rows=5;original.style.width='100%';original.style.fontFamily='monospace';
    el.createEl('h4',{text:'Cleaned preview'});
    const output=el.createEl('textarea');output.readOnly=true;output.rows=12;output.style.width='100%';output.style.fontFamily='monospace';
    const count=el.createEl('p');render();
    new Setting(el).addButton(b=>b.setButtonText('Apply cleaned text').setCta().onClick(()=>{
      // Never overwrite edits made in the background while the modal is open.
      if ((this.app.workspace.getActiveFile()||{}).path!==this.filePath ||
        (this.app.workspace.activeEditor && this.app.workspace.activeEditor.editor!==this.editor) ||
        this.editor.getValue()!==this.originalNote || this.editor.getSelection()!==this.source ||
        this.editor.getCursor('from').line!==this.from.line || this.editor.getCursor('from').ch!==this.from.ch ||
        this.editor.getCursor('to').line!==this.to.line || this.editor.getCursor('to').ch!==this.to.ch) {
        new Notice('Ultra Paste: selection changed while preview was open; no changes applied.');return;
      }
      if (output.value!==this.source) this.editor.replaceSelection(output.value);
      this.close();
    })).addButton(b=>b.setButtonText('Cancel').onClick(()=>this.close()));
  }
  onClose(){this.contentEl.empty();}
}

class UltraPasteMathPreview extends Modal {
  constructor(app, source, result, onApply) {
    super(app);
    this.source=source;this.result=result;this.onApply=onApply;
  }
  onOpen() {
    const {contentEl}=this; contentEl.empty();
    contentEl.createEl('h2',{text:'Ultra Paste — Aggressive math repair preview'});
    contentEl.createEl('p',{text:'Aggressive repairs may change ambiguous notation. Review the entire output before applying. No changes have been inserted.'});
    const stats=this.result.stats;
    contentEl.createEl('p',{text:`Detected ${stats.inlineCount} inline math, ${stats.blockCount} display math, ${stats.artifactCount || 0} artifact repairs.`});
    for (const [label,value] of [['Original text',this.source],['Repaired text',this.result.text]]) {
      contentEl.createEl('h4',{text:label});
      const area=contentEl.createEl('textarea');area.readOnly=true;area.value=value;area.rows=12;
      area.style.width='100%';area.style.fontFamily='monospace';
    }
    new Setting(contentEl).addButton(b=>b.setButtonText('Apply repaired math').setCta().onClick(()=>{this.close();this.onApply();}))
      .addButton(b=>b.setButtonText('Cancel').onClick(()=>this.close()));
  }
  onClose(){this.contentEl.empty();}
}

class UltraPasteSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  // Structural rule edits rebuild the settings UI. Capture scroll positions up
  // through Obsidian's settings pane so the user stays in the same section.
  // Calling display() directly used to reset the scrolling container to top.
  refreshPreservingScroll() {
    const positions = [];
    for (let el = this.containerEl; el; el = el.parentElement) {
      if (typeof el.scrollTop === 'number') {
        positions.push({ el, top: el.scrollTop, left: el.scrollLeft });
      }
    }
    this.display();
    const restore = () => {
      for (const { el, top, left } of positions) {
        if (el.isConnected !== false) {
          el.scrollTop = top;
          el.scrollLeft = left;
        }
      }
    };
    restore();
    // Obsidian can finish layout/resize after display() returns.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
  }
  display() {
    const p = this.plugin, s = p.settings, root = this.containerEl; root.empty();
    root.createEl('h2', { text: 'Ultra Paste' });
    if(isMobileRuntime()) root.createEl('p', {text:'Mobile: native Paste is supported. If Clipboard commands are blocked, use “Paste next OS clipboard event as plain text (mobile)” from the mobile toolbar, then tap system Paste. Network titles/images use bounded fetch and may fail on sites without CORS.'});
    root.createEl('p', { text: 'HTML/AI Markdown conversion + protected code/math + tracking cleanup + optional custom rules. Plain-text fallback is always available.' });
    const toggle = (name, desc, key) => new Setting(root).setName(name).setDesc(desc).addToggle(t => t.setValue(!!s[key]).onChange(async v => { s[key] = v; await p.saveSettings(); }));
    toggle('Enable Ultra Paste', 'Intercept ordinary editor paste.', 'enabled');
    new Setting(root).setName('Paste mode').setDesc('Auto chooses HTML when useful; Rich forces HTML; Plain ignores HTML.').addDropdown(d => d
      .addOption('auto', 'Auto (recommended)').addOption('rich', 'Prefer rich HTML').addOption('plain', 'Plain text only')
      .setValue(s.mode).onChange(async v => { s.mode = v; await p.saveSettings(); }));
    toggle('Prefer existing Markdown', 'If plain text already contains a fenced block, table or heading, do not replace it with its HTML rendering in Auto mode.', 'preferPlainMarkdown');
    root.createEl('h3', { text: 'Smart structure paste' });
    toggle('Keep nested list indentation', 'Only when pasting a pure Markdown list into another list item. Does not run in Plain Paste.', 'smartStructureLists');
    toggle('Continue blockquotes and callouts', 'When pasting multiple lines into an existing quote, prefix subsequent lines with the local > marker.', 'smartStructureQuotes');

    root.createEl('h3', { text: 'Smart Image Paste' });
    toggle('Enable Smart Image Paste', 'Handles actual image files in clipboard and drag/drop. Other files keep native Obsidian behavior; strict Plain Paste is unaffected.', 'smartImagePaste');
    toggle('Image naming preview', 'Ask for a filename with an image preview before saving. Cancel leaves the note untouched.', 'imageNamingPreview');
    new Setting(root).setName('Image filename template').setDesc('Tokens: {{noteName}}, {{date}}, {{datetime}}, {{counter}}, {{originalName}}, {{imageNameKey}}, {{frontmatter:key}}. Filename only, no folders.')
      .addText(t=>t.setPlaceholder('{{noteName}}-{{date}}-{{counter}}').setValue(s.imageNameTemplate||DEFAULTS.imageNameTemplate)
        .onChange(async v=>{s.imageNameTemplate=v||DEFAULTS.imageNameTemplate;await p.saveSettings();}));
    toggle('Detect identical images (SHA-256)', 'Reuse an identical image in the destination folder instead of creating another file.', 'imageDetectDuplicates');
    toggle('Use per-note image folders', 'When off (default), honor the native Obsidian attachment location. When on, save to images/<note-name> next to the note.', 'imageNoteFolders');
    new Setting(root).setName('Per-note image folder name').setDesc('A single folder name, not a path. Used only when per-note folders are enabled.')
      .addText(t=>t.setValue(s.imageFolderName||'images').onChange(async v=>{s.imageFolderName=safeImageStem(v);await p.saveSettings();}));
    toggle('Apply image display width', 'Add width to embeds using native Markdown/Wikilink syntax; never resize original pixels.', 'imageAutoWidth');
    const imageNum=(name,desc,key,min,max)=>new Setting(root).setName(name).setDesc(desc).addText(t=>t.setValue(String(s[key]))
      .onChange(async v=>{const num=Number(v);if(Number.isFinite(num)) {s[key]=Math.max(min,Math.min(max,Math.round(num)));await p.saveSettings();}}));
    imageNum('Portrait display width (px)', 'When automatic display width is enabled.', 'imagePortraitWidth',0,4000);
    imageNum('Landscape max display width (px)', 'Only caps wider landscape images.', 'imageMaxDisplayWidth',0,4000);
    toggle('Compress images (opt-in)', 'Off by default. Keep image format; PNG is only re-encoded if resizing. Animated GIFs are untouched.', 'imageCompression');
    imageNum('Compression max source width (px)', 'Resize wide images when compression is on.', 'imageMaxWidth',100,8000);
    new Setting(root).setName('JPEG/WebP quality').setDesc('0.1–1.0, compression is off by default.')
      .addText(t=>t.setValue(String(s.imageQuality)).onChange(async v=>{const n=Number(v);if(n>=0.1&&n<=1){s.imageQuality=n;await p.saveSettings();}}));
    root.createEl('p',{text:'Commands: “Save image from clipboard URL (confirm)” and “Rename image at cursor (confirm)”. No automatic URL downloads, mass moves, or deletion of files.'});

    toggle('Protect code', 'Pasting inside a fenced or inline code region bypasses all transformations.', 'preserveCode');
    toggle('Convert AI math delimiters', 'Convert \\(...\\) and \\[...\\] to $...$ and $$...$$ outside code.', 'convertMath');
    toggle('Repair AI bracket math (recommended)', 'Convert confident [ formula ] blocks, including multiline, blockquotes and AI heading artifacts. Existing code, links and math stay unchanged.', 'detectBracketMath');
    toggle('Detect bare parenthesis math (optional)', 'Convert possible math such as (x=y), (0/0) and (p). OFF by default to avoid modifying ordinary prose.', 'detectParenMath');
    toggle('Repair ambiguous formula formatting (experimental)', 'Only repairs a trailing single backslash within existing matrix/aligned math blocks. OFF by default.', 'repairMathArtifacts');
    toggle('Strip link tracking', 'Remove utm_*, fbclid, gclid etc. Preserve all other query parameters exactly.', 'cleanTracking');
    root.createEl('h3', { text: 'Automatic link titles' });
    toggle('Auto-fetch link titles (default: on)', 'When pasting one URL, request that webpage directly to find its title. No third-party title API; Plain Paste never fetches.', 'autoLinkTitles');
    new Setting(root).setName('Maximum link title length').setDesc('0 = unlimited. Longer titles are shortened with an ellipsis.').addText(t => t
      .setPlaceholder('0').setValue(String(s.autoTitleMaxLength || 0)).onChange(async v => { s.autoTitleMaxLength = /^\d+$/.test(v.trim()) ? Math.min(Number(v), 1000) : 0; await p.saveSettings(); }));
    new Setting(root).setName('Excluded websites').setDesc('One hostname per line or comma-separated (e.g. example.com). Local hosts and IP addresses are always excluded.').addTextArea(t => t
      .setPlaceholder('example.com\nprivate.example.org').setValue(s.autoTitleBlacklist || '').onChange(async v => { s.autoTitleBlacklist = v; await p.saveSettings(); }));
    toggle('Normalize bold headings', 'Unwrap **bold** inside headings outside code.', 'normalizeHeadings');
    toggle('Condense excessive empty lines', 'Keep at most three consecutive line breaks outside code.', 'condenseBlankLines');
    toggle('Wrap selected text with pasted URL', 'Selecting words and pasting a URL produces [selected words](URL).', 'wrapSelectedTextWithUrl');
    toggle('Strip invalid AI citation markers', 'Optional: delete synthetic markers such as 【turn0search1】 and internal citation tokens.', 'stripAIReferences');
    toggle('Show successful-paste notifications', 'Disabled by default to avoid interruptions.', 'showNotifications');
    toggle('Debug', 'Log errors and diagnostics to developer console.', 'debug');
    root.createEl('h3', { text: 'Custom rules' });
    toggle('Enable custom rules', 'Run enabled custom rules after built-in cleanup.', 'enableCustomRules');
    toggle('Permit JavaScript rules (unsafe)', 'Code supplied here runs with Obsidian permissions and is NOT sandboxed. Only enable for scripts you reviewed.', 'allowJavaScriptRules');
    new Setting(root).setName('Add rule').setDesc('Regex is the default. Prose scope protects code, math and URLs.').addButton(b => b.setButtonText('Add new rule').onClick(async () => {
      s.rules.push(normalizeRule({ name: 'New regex rule', enabled: false, type: 'regex', pattern: '', flags: 'g', scope: 'prose' }));
      await p.saveSettings(); this.refreshPreservingScroll();
    }));
    s.rules.forEach((rule, i) => {
      const div = root.createDiv(); div.style.border = '1px solid var(--background-modifier-border)'; div.style.padding = '12px'; div.style.margin = '8px 0'; div.style.borderRadius = '8px';
      new Setting(div).setName('Rule ' + (i + 1)).addText(t => t.setPlaceholder('Rule name').setValue(rule.name).onChange(async v => { rule.name = v; await p.saveSettings(); }))
        .addToggle(t => t.setValue(rule.enabled).onChange(async v => { rule.enabled = v; await p.saveSettings(); }))
        .addButton(b => b.setButtonText('↑').setDisabled(i === 0).onClick(async () => { [s.rules[i-1],s.rules[i]]=[s.rules[i],s.rules[i-1]]; await p.saveSettings(); this.refreshPreservingScroll(); }))
        .addButton(b => b.setButtonText('↓').setDisabled(i === s.rules.length-1).onClick(async () => { [s.rules[i+1],s.rules[i]]=[s.rules[i],s.rules[i+1]]; await p.saveSettings(); this.refreshPreservingScroll(); }))
        .addExtraButton(b => b.setIcon('trash').setTooltip('Delete').onClick(async () => { s.rules.splice(i,1); await p.saveSettings(); this.refreshPreservingScroll(); }));
      new Setting(div).setName('Type').addDropdown(d => d.addOption('regex','Regular expression').addOption('javascript','JavaScript').setValue(rule.type).onChange(async v => { rule.type = v; await p.saveSettings(); this.refreshPreservingScroll(); }));
      new Setting(div).setName('Scope').setDesc('Prose is safer; All can edit code and math.').addDropdown(d => d.addOption('prose','Prose only').addOption('all','All content (unsafe)').setValue(rule.scope).onChange(async v => { rule.scope = v; await p.saveSettings(); }));
      if (rule.type === 'regex') {
        new Setting(div).setName('Pattern').addText(t => t.setPlaceholder('Regex pattern').setValue(rule.pattern).onChange(async v => { rule.pattern=v; await p.saveSettings(); }));
        new Setting(div).setName('Flags').addText(t => t.setValue(rule.flags).onChange(async v => { rule.flags=v; await p.saveSettings(); }));
        new Setting(div).setName('Replacement').setDesc('Supports $1, $2 and $SEL for editor selection.').addText(t => t.setValue(rule.replacement).onChange(async v => { rule.replacement=v; await p.saveSettings(); }));
      } else {
        div.createEl('p', { text: 'JavaScript is NOT isolated. Return a string synchronously. ctx.text, ctx.match, ctx.foundText, ctx.selectedText. No async/await in v0.1.' });
        const area = div.createEl('textarea'); area.rows=6; area.style.width='100%'; area.value=rule.script;
        area.addEventListener('change', async () => { rule.script=area.value; await p.saveSettings(); });
      }
    });
    root.createEl('h3', { text: 'Import and export' });
    new Setting(root).setName('Export settings').setDesc('Copy the entire configuration to the clipboard.').addButton(b => b.setButtonText('Copy settings JSON').onClick(async () => {
      try { if(!navigator.clipboard || !navigator.clipboard.writeText) throw Error('Clipboard write is unavailable');
        await navigator.clipboard.writeText(JSON.stringify(s, null, 2)); new Notice('Ultra Paste settings copied.'); }
      catch(error) {new Notice('Ultra Paste: cannot copy settings: '+error.message);}
    }));
    new Setting(root).setName('Import settings').setDesc('Paste Ultra Paste settings JSON, or a Paste Transform data.json. Imported JavaScript rules are disabled by default.').addButton(b => b.setButtonText('Import from clipboard').onClick(async () => {
      try { await p.importSettings(await navigator.clipboard.readText()); new Notice('Ultra Paste rules/settings imported.'); this.refreshPreservingScroll(); }
      catch(e) { new Notice('Ultra Paste import error: ' + e.message); }
    }));
    root.createEl('p', { text: 'Reader extraction is available as a separate command: Ultra Paste: paste article from clipboard. It is a lightweight local heuristic, NOT the complete Defuddle library.' });
  }
}



function normalizeSettings(data) {
  const input = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const result = { ...DEFAULTS };
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (key === 'rules') continue;
    const next = input[key];
    if (typeof value === 'boolean' && typeof next === 'boolean') result[key] = next;
    else if (typeof value === 'string' && typeof next === 'string') result[key] = next.slice(0, key === 'imageNameTemplate' ? 240 : 4000);
    else if (typeof value === 'number' && typeof next === 'number' && Number.isFinite(next)) result[key] = next;
  }
  if (!['auto','plain','rich'].includes(result.mode)) result.mode = 'auto';
  for (const [key, lo, hi] of [['autoTitleMaxLength',0,2000],['imagePortraitWidth',0,5000],
    ['imageMaxDisplayWidth',0,5000],['imageMaxWidth',100,8000],['imageQuality',0.1,1]]) {
    result[key] = Math.min(hi, Math.max(lo, result[key]));
  }
  result.rules = Array.isArray(input.rules) ? input.rules.slice(0,RULE_LIMIT).map(normalizeRule) : [];
  return result;
}

/** Capture the note/editor and insertion range before an awaited clipboard operation. */
function captureEditTarget(app, editor, file) {
  const note = file || (app.workspace && app.workspace.getActiveFile && app.workspace.getActiveFile());
  const from = editor.getCursor('from');
  const to = editor.getCursor('to');
  return {
    editor, file: note, filePath: note && note.path,
    original: editor.getValue(), selected: editor.getSelection(),
    from: {line: from.line, ch: from.ch}, to: {line: to.line, ch: to.ch}
  };
}
function validEditTarget(app, snapshot, options = {}) {
  if (!snapshot || !snapshot.editor || !snapshot.filePath || !app.workspace) return false;
  const file = app.workspace.getActiveFile && app.workspace.getActiveFile();
  if (!file || file.path !== snapshot.filePath) return false;
  // On a reused workspace editor, an identical note path alone is insufficient.
  const activeEditor = app.workspace.activeEditor && app.workspace.activeEditor.editor;
  if (activeEditor && activeEditor !== snapshot.editor) return false;
  const ed = snapshot.editor;
  if (ed.getValue() !== (options.expectedValue === undefined ? snapshot.original : options.expectedValue)) return false;
  if (options.contentOnly) return true;
  const f = ed.getCursor('from'), t = ed.getCursor('to');
  return f.line === snapshot.from.line && f.ch === snapshot.from.ch &&
    t.line === snapshot.to.line && t.ch === snapshot.to.ch &&
    ed.getSelection() === snapshot.selected;
}
function safeSnapshotInsert(app, snapshot, text) {
  if (!validEditTarget(app, snapshot)) {
    new Notice('Ultra Paste: note, cursor or selection changed. Paste cancelled to protect your work.');
    return false;
  }
  snapshot.editor.replaceSelection(text);
  return true;
}
/** Never claim mixed rich text+image; native Obsidian preserves all clipboard types. */
function hasMeaningfulMixedText(data) {
  if (!data || typeof data.getData !== 'function') return false;
  const html = data.getData('text/html') || '';
  const plain = data.getData('text/plain') || '';
  if (html) {
    if (typeof DOMParser !== 'undefined') {
      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const body = doc.body;
        if ((body.textContent || '').trim().length > 0) return true;
      } catch (_e) { return true; }
    } else if (html.replace(/<[^>]*>/g, '').trim()) return true;
  }
  // Some browsers include an image source URL with image/png: this is metadata,
  // not prose. But arbitrary clipboard text must not be discarded.
  return !!plain.trim() && !/^https?:\/\/\S+$/i.test(plain.trim());
}

/** Bound desktop title requests by time and bytes and block private DNS destinations. */
function isPublicAddress(address) {
  const ip=String(address||'').toLowerCase();
  if (ip.includes(':')) {
    if (ip.startsWith('::ffff:')) {
      const mapped=ip.slice(7);
      // Hexadecimal IPv4-mapped addresses are denied instead of guessed.
      return mapped.includes(':') ? false : isPublicAddress(mapped);
    }
    return !(/^(?:fc|fd|fe[89ab]|::|0:|2001:db8:)/.test(ip));
  }
  const parts=ip.split('.').map(Number);
  if (parts.length!==4 || parts.some(n=>!Number.isInteger(n)||n<0||n>255)) return false;
  const [a,b,c]=parts;
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||
    a===172&&b>=16&&b<=31||a===192&&b===168||
    a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||
    a===192&&b===0&&c===0);
}
function boundedNodeTitleHtml(url, maxBytes=TITLE_MAX_HTML_BYTES, redirects=0, kind='html') {
  if (redirects>3) return Promise.reject(new Error('Too many redirects'));
  const parsed=new URL(url);
  if (parsed.protocol!=='https:' || parsed.port && parsed.port!=='443' || parsed.username || parsed.password ||
      isExcludedTitleHost(url) || !parsed.hostname) return Promise.reject(new Error('Unsafe webpage title destination'));
  const https=require('node:https'), dns=require('node:dns');
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(result);};
    const req=https.get(url,{
      headers:{Accept:'text/html,application/xhtml+xml;q=0.9', 'Accept-Encoding':'identity', 'User-Agent':'Ultra-Paste/0.2'},
      lookup(host,options,callback){
        dns.lookup(host,{all:true},(err,values)=>{
          if(err)return callback(err);
          const allowed=(values||[]).filter(item=>isPublicAddress(item.address));
          if(!allowed.length)return callback(new Error('Non-public DNS destination blocked'));
          if(options && options.all) callback(null,allowed);
          else callback(null,allowed[0].address,allowed[0].family);
        });
      }
    },response=>{
      response.on('error',e=>finish(e));
      if(response.statusCode>=300&&response.statusCode<400) {
        response.resume();const next=response.headers.location;
        if(!next)return finish(new Error('Redirect without location'));
        let target;try{target=new URL(next,url).href;}catch(e){return finish(e);}
        return boundedNodeTitleHtml(target,maxBytes,redirects+1,kind).then(x=>finish(null,x),e=>finish(e));
      }
      if(response.statusCode<200||response.statusCode>=300){response.resume();return finish(new Error('HTTP '+response.statusCode));}
      const contentType=String(response.headers['content-type']||'').toLowerCase();
      if(kind==='html' && contentType && !/text\/html|application\/xhtml\+xml/.test(contentType)){
        response.resume();return finish(new Error('Not HTML'));
      }
      if(kind==='image' && !imageExt(contentType.split(';')[0])){
        response.resume();return finish(new Error('Not an image'));
      }
      const headerSize=Number(response.headers['content-length']);
      if(headerSize>maxBytes){response.destroy();return finish(new Error('HTML too large'));}
      let length=0;const chunks=[];
      response.on('data',chunk=>{
        length+=chunk.length;
        if(length>maxBytes){response.destroy();return finish(new Error('HTML exceeded byte limit'));}
        chunks.push(chunk);
      });
      response.on('end',()=>{
        const buffer=Buffer.concat(chunks);
        const data=kind==='image' ? {headers:response.headers,arrayBuffer:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.length)} :
          {headers:response.headers,text:buffer.toString('utf8')};
        finish(null,data);
      });
    });
    const timer=setTimeout(()=>req.destroy(new Error('Title fetch timeout')),6500);
    req.on('error',e=>finish(e));
  });
}
async function retrieveTitleHtml(url) {
  if (isMobileRuntime()) return boundedWebFetch(url, TITLE_MAX_HTML_BYTES, 'html');
  // Desktop retains the DNS-pinned Node HTTPS reader. Test-only adapters remain
  // supported when Node modules are absent; this fallback is NEVER used on mobile.
  try {require('node:https');require('node:dns');}
  catch (_error) { return requestUrl({url,method:'GET',headers:{Accept:'text/html'}}); }
  return boundedNodeTitleHtml(url);
}

/** Streamed web fetch for mobile. No redirects, credentials or unbounded requestUrl
 * fallback. WebView CORS may prevent fetching some websites: in that case,
 * paste remains a raw URL, and user-confirmed image download fails closed. */
async function boundedWebFetch(url, limit, kind='html') {
  if (!validatePublicWebUrl(url)) throw new Error('Unsafe or non-public HTTPS destination');
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') throw new Error('Web streaming fetch is unavailable');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(), kind==='html'?6500:12000);
  let reader=null;
  try {
    const response=await fetch(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
      headers:{Accept:kind==='html'?'text/html,application/xhtml+xml':'image/*'},signal:controller.signal});
    if (!response.ok || response.type==='opaque' || response.redirected) throw new Error('HTTP / redirect not allowed');
    const type=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(kind==='html' && !['text/html','application/xhtml+xml'].includes(type)) throw new Error('Not HTML');
    if(kind==='image' && !imageExt(type)) throw new Error('Not a supported image');
    const declared=Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared>limit) throw new Error('Response exceeds byte limit');
    if(!response.body || typeof response.body.getReader!=='function') throw new Error('Streaming response unavailable');
    reader=response.body.getReader();
    let size=0; const chunks=[];
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>limit) throw new Error('Response exceeded byte limit');
      chunks.push(value);
    }
    if (!size) throw new Error('Empty response');
    const bytes=new Uint8Array(size); let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    if(kind==='image') return {headers:{'content-type':type},arrayBuffer:bytes.buffer};
    return {headers:{'content-type':type},text:new TextDecoder('utf-8').decode(bytes)};
  } finally {
    if(reader){ try{await reader.cancel();}catch(_e){} }
    clearTimeout(timeout);controller.abort();
  }
}
function validatePublicWebUrl(raw) {
  try {
    const u=new URL(raw), host=u.hostname.toLowerCase().replace(/\.$/,'');
    if(u.protocol!=='https:' || u.port && u.port!=='443' || !host || u.username || u.password) return null;
    // No IP literals, local hostnames or special-use networks. Unlike the desktop
    // path this cannot pin the result of a DNS lookup on the mobile WebView.
    if(host==='localhost'||/\.(?:localhost|local|internal|lan|home|test|invalid)$/.test(host))return null;
    if(/^[0-9.]+$/.test(host)||host.startsWith('[')||!host.includes('.'))return null;
    return u.href;
  }catch(_e){return null;}
}


/** Bounded, cancellable fetch for user-confirmed image downloads. No silent full-body requestUrl fallback. */
async function downloadRemoteImageLimited(url, limit=REMOTE_IMAGE_MAX_BYTES) {
  if (!validateImageUrl(url)) throw new Error('Image URL must be public HTTPS.');
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') throw new Error('Streaming downloads unavailable.');
  if (isMobileRuntime()) return boundedWebFetch(url, limit, 'image');
  // Desktop: Node reader pins public DNS and limits redirects and response size.
  try {require('node:https');require('node:dns'); return await boundedNodeTitleHtml(url,limit,0,'image');}
  catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND' && e.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw e;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    // Refuse redirects rather than follow them to an unvalidated private destination.
    const response = await fetch(url, {method:'GET',redirect:'error',credentials:'omit',signal:controller.signal});
    if (!response.ok) throw new Error('Image HTTP status '+response.status);
    const type = (response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if (!imageExt(type)) throw new Error('Remote response is not a supported image.');
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) throw new Error('Image exceeds '+limit+' byte limit.');
    if (!response.body || typeof response.body.getReader!=='function') throw new Error('Streaming response unavailable.');
    const reader=response.body.getReader(), chunks=[];
    let size=0;
    while(true){
      const {value,done}=await reader.read();
      if(done) break;
      size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new Error('Image exceeds '+limit+' byte limit.');}
      chunks.push(value);
    }
    if(!size)throw new Error('Remote image is empty.');
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return { headers: {'content-type':type}, arrayBuffer:bytes.buffer };
  } finally {clearTimeout(timeout);controller.abort();}
}

function dropEditorPosition(evt, editor) {
  if (!evt || !editor || !editor.cm || !Number.isFinite(evt.clientX) || !Number.isFinite(evt.clientY)) return null;
  try {
    // CodeMirror 6 uses offsets; CodeMirror 5 uses coordsChar.
    if (typeof editor.cm.posAtCoords === 'function') {
      const offset = editor.cm.posAtCoords({x:evt.clientX,y:evt.clientY});
      if (Number.isInteger(offset) && offset >= 0) return editor.offsetToPos(offset);
    }
    if (typeof editor.cm.coordsChar === 'function') {
      const pos = editor.cm.coordsChar({left:evt.clientX,top:evt.clientY});
      if (pos && Number.isInteger(pos.line) && Number.isInteger(pos.ch)) return pos;
    }
  } catch (_e) { /* fall through to native drop */ }
  return null;
}

module.exports = class UltraPaste extends Plugin {
  async onload() {
    this.settings = normalizeSettings(await this.loadData());
    this._titleCache = new Map();
    this._imageRenameQueue = Promise.resolve();
    this._imageWriteQueue = Promise.resolve();
    this._imageHashCache = new Map();
    this.addSettingTab(new UltraPasteSettingTab(this.app, this));
    // Strict literal paste: catch the key chord BEFORE Obsidian's normal
    // key handlers. Do not enter formatPaste(), link fetching, or custom rules.
    // Suppress the follow-up native paste event if an OS generates one, so
    // a single keypress never inserts the clipboard twice.
    this._plainPasteKeyHeld = false;
    this._plainPasteConsumed = false;
    this._plainNextUntil = 0;
    this.addCommand({id:'arm-plain-next-paste',name:'Paste next OS clipboard event as plain text (mobile)',callback:()=>{
      this.armPlainNextPaste();
    }});
    this.registerDomEvent(window, 'keydown', evt => {
      const v = evt.code === 'KeyV' || String(evt.key).toLowerCase() === 'v';
      if (!v || !(evt.ctrlKey || evt.metaKey) || !evt.shiftKey || evt.altKey || evt.isComposing) return;
      this._plainPasteKeyHeld = true;
      // Never steal the shortcut from a settings field, modal, or other UI.
      const targetIsEditor = !!(evt.target && typeof evt.target.closest === 'function' &&
        evt.target.closest('.cm-editor, .CodeMirror'));
      const active = this.app.workspace.activeEditor && this.app.workspace.activeEditor.editor;
      if (!targetIsEditor || !active) return;
      evt.preventDefault();
      if (typeof evt.stopImmediatePropagation === 'function') evt.stopImmediatePropagation();
      if (evt.repeat || this._plainPasteConsumed) return;
      this._plainPasteConsumed = true;
      void this.pastePlainLiteral(active);
    }, { capture: true });
    this.registerDomEvent(window, 'keyup', evt => {
      if (evt.code === 'KeyV' || String(evt.key).toLowerCase() === 'v' ||
          !(evt.ctrlKey || evt.metaKey) || !evt.shiftKey) {
        this._plainPasteKeyHeld = false;
        this._plainPasteConsumed = false;
      }
    }, { capture: true });
    this.registerDomEvent(window, 'blur', () => {
      this._plainPasteKeyHeld = false;
      this._plainPasteConsumed = false;
    });
    this.registerEvent(this.app.workspace.on('editor-paste', (evt, editor, info) => this.onEditorPaste(evt, editor, info)));
    this.registerEvent(this.app.workspace.on('editor-drop', (evt, editor, info) => this.onEditorDrop(evt, editor, info)));
    this.addCommand({ id: 'toggle-ultra-paste', name: 'Toggle Ultra Paste', callback: async () => {
      this.settings.enabled = !this.settings.enabled; await this.saveSettings(); new Notice('Ultra Paste ' + (this.settings.enabled ? 'enabled' : 'disabled'));
    }});
    this.addCommand({ id: 'paste-preview', name: 'Preview clipboard and paste', hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'v' }], editorCallback: async editor => {
      const target = captureEditTarget(this.app, editor);
      try { const c = await this.readClipboard();
        if (!validEditTarget(this.app,target)) { new Notice('Ultra Paste: note changed before preview.'); return; }
        const selectedText = target.selected;
        const url = autoTitleCandidate(c.plain, c.html, editor, this.settings, { selectedText });
        const result = url ? titledMarkdown(url, await this.fetchPageTitle(url), this.settings.autoTitleMaxLength)
          : structurePaste(formatPaste(c.plain, c.html, this.settings, { selectedText }), editor, this.settings);
        new UltraPastePreview(this.app, c.plain, c.html, result, text => safeSnapshotInsert(this.app, target, text)).open(); }
      catch (e) { new Notice('Ultra Paste: clipboard preview failed: ' + e.message); }
    }});
    this.addCommand({ id: 'paste-as-plain', name: 'Paste as plain text (no transforms)', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'v' }], editorCallback: async editor => {
      await this.pastePlainLiteral(editor);
    }});

    this.addCommand({ id:'save-image-from-clipboard-url', name:'Save image from clipboard URL (confirm)', editorCallback:async editor=>{
      const target=captureEditTarget(this.app,editor);
      try{
        const text=await this.readPlainClipboard();if(!validEditTarget(this.app,target))return;
        const url=validateImageUrl(text);
        if(!url||String(text).trim()!==url){new Notice('Ultra Paste: copy one public HTTPS image URL first.');return;}
        if(typeof requestUrl!=='function')throw new Error('Obsidian requestUrl is unavailable.');
        // This is an explicit, user-triggered download command, never normal paste.
        const response=await downloadRemoteImageLimited(url,REMOTE_IMAGE_MAX_BYTES);
        const type=String((response.headers&&(response.headers['content-type']||response.headers['Content-Type']))||'').split(';')[0].toLowerCase();
        const ext=imageExt(type);
        if(!ext)throw new Error('URL did not return a supported image MIME type.');
        if(!response.arrayBuffer||response.arrayBuffer.byteLength>IMAGE_MAX_BYTES)throw new Error('Image is empty or over 25 MB.');
        const bytes=response.arrayBuffer;
        const name=decodeURIComponent(new URL(url).pathname.split('/').pop()||('Web-image.'+ext));
        const file={name,type,size:bytes.byteLength,arrayBuffer:async()=>bytes};
        if(!validEditTarget(this.app,target))return;
        await this.handleImageFiles([file],editor,target.file,{manual:true});
      }catch(e){new Notice('Ultra Paste: image download failed: '+e.message);}
    }});
    this.addCommand({ id:'rename-image-at-cursor', name:'Rename image at cursor (confirm)', editorCallback:editor=>{void this.renameImageAtCursor(editor);} });
    this.addCommand({ id: 'clean-pdf-text', name: 'Clean PDF text in selection (preview)', editorCallback: editor => {
      if (!editor.somethingSelected() || !editor.getSelection()) { new Notice('Ultra Paste: select PDF text first, then run Clean PDF text.'); return; }
      new UltraPastePdfPreview(this.app,editor,editor.getSelection()).open();
    }});
    this.addCommand({ id: 'fix-math-safe', name: 'Fix Math — Safe (selection or note)', editorCallback: editor => this.fixMathCommand(editor,'safe') });
    this.addCommand({ id: 'fix-math-balanced', name: 'Fix Math — Balanced (selection or note)', editorCallback: editor => this.fixMathCommand(editor,'balanced') });
    this.addCommand({ id: 'fix-math-aggressive', name: 'Fix Math — Aggressive (preview required)', editorCallback: editor => this.fixMathCommand(editor,'aggressive') });
    this.addCommand({ id: 'fix-math-selection-or-note', name: 'Fix AI math in selection or current note', editorCallback: editor => {
      const selected = editor.somethingSelected();
      const source = selected ? editor.getSelection() : editor.getValue();
      const settings = {...this.settings};
      // This command runs math ONLY, never tracking, title fetching, custom rules, etc.
      const processed = fixAIMath(source, settings);
      if (processed.text === source) { new Notice('Ultra Paste: no math repairs needed.'); return; }
      if (selected) editor.replaceSelection(processed.text);
      else {
        const cursor = editor.getCursor();
        editor.replaceRange(processed.text, {line:0,ch:0}, editor.offsetToPos(source.length));
        editor.setCursor({line:Math.min(cursor.line,editor.lineCount()-1),ch:cursor.ch});
      }
      const n = processed.stats.inlineCount + processed.stats.blockCount;
      new Notice('Ultra Paste: repaired ' + n + ' math expression' + (n === 1?'':'s') + '.');
    }});
    this.addCommand({ id: 'paste-article', name: 'Paste article from clipboard (reader extraction)', editorCallback: async editor => {
      const target=captureEditTarget(this.app,editor);
      try { const c = await this.readClipboard(); if (!validEditTarget(this.app,target)) return;
        const text = formatPaste(c.plain,c.html,this.settings,{article:!!c.html,selectedText:target.selected});
        safeSnapshotInsert(this.app,target,structurePaste(text,editor,this.settings)); }
      catch(e) { new Notice('Ultra Paste: article paste failed: ' + e.message); }
    }});
    // Unlike 'Paste rich HTML', this explicit command pastes the original
    // text/html clipboard payload as literal HTML source. No Markdown
    // conversion, title fetching, whitespace cleanup or custom rules run.
    // Only invoke from the Command Palette; Ctrl+V and Ctrl+Shift+V are unchanged.
    this.addCommand({ id: 'paste-as-html', name: 'Paste as HTML (raw clipboard HTML)', editorCallback: async editor => {
      const target = captureEditTarget(this.app, editor);
      try {
        const html = await this.readRawHtmlClipboard();
        safeSnapshotInsert(this.app, target, html);
      } catch (error) {
        new Notice('Ultra Paste: Paste as HTML failed: ' + error.message);
      }
    }});
    this.addCommand({ id: 'paste-rich', name: 'Paste rich HTML from clipboard', editorCallback: async editor => {
      const target=captureEditTarget(this.app,editor);
      try { const c=await this.readClipboard(); if (!validEditTarget(this.app,target)) return;
        safeSnapshotInsert(this.app,target,structurePaste(formatPaste(c.plain,c.html,this.settings,{mode:'rich',selectedText:target.selected}),editor,this.settings)); }
      catch(e) { new Notice('Ultra Paste: rich paste failed: ' + e.message); }
    }});
  }
  fixMathCommand(editor,profile) {
    const selected=editor.somethingSelected();
    const source=selected?editor.getSelection():editor.getValue();
    const originalSelection=selected?editor.getSelection():null;
    const originalNote=editor.getValue();
    const originalPath=(this.app.workspace.getActiveFile()||{}).path;
    const startPosition=selected?editor.getCursor('from'):null;
    const cursor=editor.getCursor();
    const result=fixMathWithProfile(source,profile);
    if (!result.changed) {new Notice('Ultra Paste: no math repairs needed ('+profile+').');return;}
    const apply=()=>{
      // The user may edit or change selection while preview is open.
      if (!this.app.workspace.getActiveFile() || (this.app.workspace.activeEditor && this.app.workspace.activeEditor.editor!==editor) ||
          this.app.workspace.getActiveFile().path!==originalPath ||
          editor.getValue()!==originalNote || (selected && (editor.getSelection()!==originalSelection || editor.getCursor('from').line!==startPosition.line || editor.getCursor('from').ch!==startPosition.ch))) {
        new Notice('Ultra Paste: note changed while preview was open. Please try again.');return;
      }
      if (selected) editor.replaceSelection(result.text);
      else {
        editor.replaceRange(result.text,{line:0,ch:0},editor.offsetToPos(source.length));
        editor.setCursor({line:Math.min(cursor.line,editor.lineCount()-1),ch:Math.min(cursor.ch,editor.getLine(Math.min(cursor.line,editor.lineCount()-1)).length)});
      }
      const n=result.stats.inlineCount+result.stats.blockCount;
      new Notice('Ultra Paste: '+profile+' repaired '+n+' math expressions'+(result.stats.artifactCount?' and '+result.stats.artifactCount+' artifact blocks':'')+'.');
    };
    if (profile==='aggressive') new UltraPasteMathPreview(this.app,source,result,apply).open();
    else apply();
  }
  async fetchPageTitle(url) {
    if (!getStandaloneUrl(url) || isDirectAssetUrl(url) || isExcludedTitleHost(url, this.settings.autoTitleBlacklist)) return '';
    const cached = this._titleCache && this._titleCache.get(url);
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.value;
    if (typeof requestUrl !== 'function') return '';
    try {
      // Node's bounded desktop request: streamed, 1 MB maximum, timeout,
      // guarded DNS and HTTPS-only redirects. Never let a timeout continue
      // downloading a huge HTML document in the background.
      const result = await retrieveTitleHtml(url);
      const contentType = String((result.headers && (result.headers['content-type'] || result.headers['Content-Type'])) || '').toLowerCase();
      if (contentType && !/text\/html|application\/xhtml\+xml/.test(contentType)) return '';
      if (String(result.text || '').length > TITLE_MAX_HTML_BYTES) return '';
      const title = titleFromHtml(result.text || '');
      if (this._titleCache) {
        if (this._titleCache.size >= 100) this._titleCache.delete(this._titleCache.keys().next().value);
        this._titleCache.set(url, { value:title, at:Date.now() });
      }
      return title;
    } catch (error) {
      if (this.settings.debug) console.warn('Ultra Paste: failed to fetch webpage title', urlHostname(url), error);
      return '';
    }
  }
  pasteUrlWithTitle(editor, url) {
    // Insert immediately: never freeze the paste operation while fetching.
    const beginning = editor.getCursor('from');
    const start = editor.posToOffset(beginning);
    editor.replaceSelection(url);
    const pendingValue = editor.getValue();
    const filePath = (this.app.workspace.getActiveFile()||{}).path;
    this.fetchPageTitle(url).then(title => {
      if (!title || !editor || typeof editor.getValue !== 'function') return;
      if (!filePath || (this.app.workspace.getActiveFile()||{}).path!==filePath ||
        (this.app.workspace.activeEditor && this.app.workspace.activeEditor.editor!==editor) ||
        editor.getValue() !== pendingValue) return;
      // Verify that the exact original URL still occupies this range.
      // If the note changed around the pasted link, leave the user's edits alone.
      if (editor.getValue().slice(start, start + url.length) !== url) return;
      const replacement = titledMarkdown(url, title, this.settings.autoTitleMaxLength);
      if (replacement !== url) editor.replaceRange(replacement, editor.offsetToPos(start), editor.offsetToPos(start + url.length));
    }).catch(error => { if (this.settings.debug) console.warn('Ultra Paste: title insertion failed', error); });
  }
  async saveSettings() { await this.saveData(this.settings); }
  armPlainNextPaste() {
    this._plainNextUntil=Date.now()+20000;
    new Notice('Ultra Paste: use the system Paste action within 20 seconds. Only text/plain will be inserted, without ANY rules.');
  }
  async pastePlainLiteral(editor) {
    const target = captureEditTarget(this.app, editor);
    try {
      const raw = await this.readPlainClipboard();
      // Never replace a selection with an empty string because the Clipboard
      // offers HTML only, or because a clipboard read failed.
      if (!raw) return;
      safeSnapshotInsert(this.app, target, raw);
    } catch (error) {
      if(isMobileRuntime()) {
        // A Command Palette action cannot always read mobile clipboard; the
        // next native editor-paste event can supply its exact text/plain.
        this.armPlainNextPaste();
      } else new Notice('Ultra Paste: literal plain text unavailable: ' + error.message);
    }
  }
  async readPlainClipboard() {
    // Read *only* the text/plain clipboard format. No HTML conversion,
    // newline normalization, trimming, link rewriting, or user-defined rules.
    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      try { return await navigator.clipboard.readText(); }
      catch (error) { if (this.settings.debug) console.warn('Ultra Paste: readText failed', error); }
    }
    // Strict fallback: do NOT call readClipboard(), which can legitimately
    // return HTML without any plain text.
    if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/plain')) return await (await item.getType('text/plain')).text();
      }
    }
    throw new Error('Clipboard does not provide text/plain.');
  }
  async readRawHtmlClipboard() {
    // Fetch exactly text/html and preserve every byte that its text decoder
    // returns, including inline styles, spacing, and original HTML markup.
    // Never silently fall back to text/plain or change the active selection
    // when clipboard HTML is missing, empty or permissions are unavailable.
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      throw new Error('Rich clipboard access is unavailable.');
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!Array.from(item.types || []).includes('text/html')) continue;
      const blob = await item.getType('text/html');
      const html = typeof blob.text === 'function' ? await blob.text() : await new Response(blob).text();
      if (html) return html;
    }
    throw new Error('Clipboard has no non-empty text/html. Copy formatted content from a web page first.');
  }
  async readClipboard() {
    let plain = '', html = '';
    if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('text/plain')) plain = await (await item.getType('text/plain')).text();
          if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
          if (plain || html) break;
        }
      } catch (error) {
        if (this.settings.debug) console.warn('Ultra Paste: rich clipboard read unavailable', error);
      }
    }
    if (!plain && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      try { plain = await navigator.clipboard.readText(); }
      catch (error) { if (this.settings.debug) console.warn('Ultra Paste: plain clipboard read unavailable', error); }
    }
    if (!plain && !html) throw new Error('No text or HTML in clipboard.');
    return { plain, html };
  }


  onEditorDrop(evt, editor, info) {
    if(evt.defaultPrevented || !this.settings.enabled || !this.settings.smartImagePaste || !editor) return;
    const pictures=eligibleImageFiles(evt.dataTransfer);
    if(!pictures.length || hasMeaningfulMixedText(evt.dataTransfer))return;
    const note=(info && info.file) || this.app.workspace.getActiveFile();
    if(!note||note.extension!=='md')return;
    const dropPosition=dropEditorPosition(evt,editor);
    if(!dropPosition) return; // Native Obsidian handles drops we cannot position safely.
    editor.setCursor(dropPosition);
    evt.preventDefault();
    if(typeof evt.stopPropagation==='function')evt.stopPropagation();
    void this.handleImageFiles(pictures,editor,note).catch(e=>{console.error('Ultra Paste: image drop failed',e);new Notice('Ultra Paste: image drop failed: '+e.message);});
  }
  getImageTargetDir(note) {
    const parent=String(note.path||'').split('/').slice(0,-1).join('/');
    const root=safeImageStem(this.settings.imageFolderName||'images');
    return joinedVaultPath(parent,root,safeImageStem(note.basename||'Note'));
  }
  async availableImagePath(note,stem,ext) {
    const safeStem=safeImageStem(stem), fileName=safeStem+'.'+ext;
    if(this.settings.imageNoteFolders) {
      const target=joinedVaultPath(this.getImageTargetDir(note),fileName);
      return this.uniqueImagePath(target);
    }
    const path=await this.app.fileManager.getAvailablePathForAttachment(fileName,note.path);
    if(typeof path!=='string'||!path.endsWith('.'+ext))throw new Error('Obsidian did not return a valid attachment path.');
    return path;
  }
  uniqueImagePath(path) {
    if(!this.app.vault.getAbstractFileByPath(path))return path;
    const dot=path.lastIndexOf('.');const first=path.slice(0,dot),extension=path.slice(dot);
    for(let i=1;i<=10000;i++){
      const proposal=first+'-'+i+extension;
      if(!this.app.vault.getAbstractFileByPath(proposal))return proposal;
    }
    throw new Error('Too many files with same image name.');
  }
  async proposeImagePath(note,originalStem,ext) {
    const template=this.settings.imageNameTemplate||DEFAULTS.imageNameTemplate;
    const cache=(this.app.metadataCache && this.app.metadataCache.getFileCache(note))||{};
    const frontmatter=cache.frontmatter||{};
    const now=new Date();
    for(let count=1;count<=9999;count++){
      const stem=imageNameFromTemplate(template,note,originalStem,count,frontmatter,now);
      const path=await this.availableImagePath(note,stem,ext);
      // If {{counter}} is present, use it to avoid native collisions.
      if(!template.includes('{{counter}}') || path.split('/').pop()===stem+'.'+ext) return {stem,path};
    }
    throw new Error('Unable to allocate image counter.');
  }
  async ensureImageFolder(path) {
    const folder=path.split('/').slice(0,-1).join('/');
    if(!folder) return;
    let current='';
    for(const segment of folder.split('/')) {
      current=joinedVaultPath(current,segment);
      if(!this.app.vault.getAbstractFileByPath(current)){
        try{await this.app.vault.createFolder(current);}
        catch(e){if(!this.app.vault.getAbstractFileByPath(current))throw e;}
      }
    }
  }
  async findImageDuplicate(buffer,path) {
    if(!this.settings.imageDetectDuplicates) return null;
    const directory=path.split('/').slice(0,-1).join('/');
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const candidates=(this.app.vault.getFiles()||[]).filter(f=>f.path.split('/').slice(0,-1).join('/')===directory &&
      imageExt('',f.name) && f.stat && f.stat.size===bytes.byteLength);
    if(!candidates.length)return null;
    const candidateHash=await imageHash(bytes);
    if (!candidateHash) return null; // Duplicate detection unavailable; never discard the image.
    for(const f of candidates){
      try{
        const key=f.path+'|'+f.stat.size+'|'+f.stat.mtime;
        let hash=this._imageHashCache && this._imageHashCache.get(key);
        if(!hash){hash=await imageHash(await this.app.vault.readBinary(f));
          if(this._imageHashCache){if(this._imageHashCache.size>500)this._imageHashCache.clear();this._imageHashCache.set(key,hash);}}
        if(hash===candidateHash)return f;}
      catch(_e){ /* read failures do not block pasting */ }
    }
    return null;
  }
  editorImageSnapshot(editor, note) {
    const from=editor.getCursor('from'),to=editor.getCursor('to');
    return {value:editor.getValue(),from:{...from},to:{...to}, notePath:note.path};
  }
  isSameImageSnapshot(editor,note,snapshot) {
    const from=editor.getCursor('from'),to=editor.getCursor('to');
    const active=this.app.workspace.getActiveFile();
    return (!this.app.workspace.activeEditor || this.app.workspace.activeEditor.editor===editor) &&
      editor.getValue()===snapshot.value && from.line===snapshot.from.line && from.ch===snapshot.from.ch &&
      to.line===snapshot.to.line && to.ch===snapshot.to.ch && note.path===snapshot.notePath && active && active.path===snapshot.notePath;
  }
  imageNamingPrompt(stem,blob,path,ext,dimensions) {
    return new Promise(resolve=>new UltraPasteImageNamingModal(this.app,stem,blob,path,ext,dimensions,resolve).open());
  }
  async handleImageFiles(files,editor,note,opts={}) {
    if(!note||note.extension!=='md')return;
    const snapshot=this.editorImageSnapshot(editor,note);
    const prepared=[];
    const initialPath=this.settings.imageNoteFolders?this.getImageTargetDir(note):'';
    for(const f of files){
      const ext=imageExt(f.type,f.name);
      if(!ext||f.size>IMAGE_MAX_BYTES)throw new Error('Unsupported image or larger than 25 MB.');
      const originalStem=String(f.name||'Image').replace(/\.[a-z0-9]{2,5}$/i,'');
      const original=new Blob([await f.arrayBuffer()],{type:String(f.type||'image/'+ext)});
      const compressed=await optionallyCompressImage(original,this.settings);
      const bytes=await compressed.arrayBuffer();
      const dims=await imageDimensions(compressed);
      const allocation=await this.proposeImagePath(note,originalStem,ext);
      const existing=await this.findImageDuplicate(bytes,allocation.path);
      let path=allocation.path;
      let stem=allocation.stem;
      if(!existing && this.settings.imageNamingPreview){
        const destination=path.split('/').slice(0,-1).join('/');
        const choice=await this.imageNamingPrompt(stem,compressed,destination,ext,dims);
        if(choice===null)return; // Cancel before any files are written.
        stem=choice;
        path=await this.availableImagePath(note,stem,ext);
      }
      prepared.push({blob:compressed,bytes,dimensions:dims,ext,stem,path,existing});
    }
    if(!this.isSameImageSnapshot(editor,note,snapshot)){
      new Notice('Ultra Paste: note or cursor changed while naming; no image files were saved.');return;
    }
    const embeds=[];
    const batchHashes=new Map();
    for(const p of prepared){
      let attachment=p.existing;
      // Multiple identical images in one clipboard batch reuse the first one.
      const hash=this.settings.imageDetectDuplicates?await imageHash(p.bytes):null;
      const groupKey=hash?p.path.split('/').slice(0,-1).join('/')+'|'+hash:null;
      if(!attachment && groupKey && batchHashes.has(groupKey))attachment=batchHashes.get(groupKey);
      if(!attachment){
        // Serialize the filesystem boundary: two simultaneous paste operations
        // must never allocate/overwrite the same filename. Recheck SHA under lock.
        const writing=this._imageWriteQueue.then(async()=>{
          if(!this.isSameImageSnapshot(editor,note,snapshot)) throw new Error('Note changed before image write; no file created.');
          const duplicate=await this.findImageDuplicate(p.bytes,p.path);
          if(duplicate)return duplicate;
          const target=this.uniqueImagePath(p.path);
          await this.ensureImageFolder(target);
          return await this.app.vault.createBinary(target,p.bytes);
        });
        this._imageWriteQueue=writing.catch(()=>{});
        attachment=await writing;
      }
      if(groupKey)batchHashes.set(groupKey,attachment);
      const link=this.app.fileManager.generateMarkdownLink(attachment,note.path);
      const width=imageDisplayWidth(p.dimensions,this.settings);
      embeds.push(imageEmbedLink(link,width));
    }
    // If the note changed while async file creation was in progress, do not
    // overwrite new editor content. Files are preserved in the vault, not deleted.
    if(!this.isSameImageSnapshot(editor,note,snapshot)){
      new Notice('Ultra Paste: images saved, but note changed; links not inserted. Find images in attachments folder.');return;
    }
    if(embeds.length)editor.replaceSelection(embeds.join('\n'));
    if(this.settings.showNotifications)new Notice('Ultra Paste: '+embeds.length+' image(s) inserted.');
  }
  async renameImageAtCursor(editor) {
    const note=this.app.workspace.getActiveFile();
    if(!note || note.extension!=='md')return new Notice('Ultra Paste: open a Markdown note first.');
    const cursor=editor.getCursor();
    const raw=imageRefAtCursor(editor.getLine(cursor.line),cursor.ch);
    if(!raw)return new Notice('Ultra Paste: place the cursor inside an embedded image link.');
    let path;try{path=decodeURIComponent(raw.replace(/^<|>$/g,''));}
    catch(_error){return new Notice('Ultra Paste: image link is malformed.');}
    const file=this.app.metadataCache.getFirstLinkpathDest(path,note.path);
    if(!file || !imageExt('',file.name))return new Notice('Ultra Paste: local image was not found.');
    if(typeof this.app.vault.getConfig==='function' && this.app.vault.getConfig('alwaysUpdateLinks')===false)
      return new Notice('Ultra Paste: enable Settings → Files and links → Automatically update internal links first.');
    const originalPath=file.path;
    const newStem=await new Promise(resolve=>new UltraPasteRenameImageModal(this.app,file,resolve).open());
    if(!newStem||newStem===file.basename)return;
    // Queue renames to avoid concurrent allocation of the same final filename.
    const operation=this._imageRenameQueue.then(async()=>{
      if(this.app.vault.getAbstractFileByPath(originalPath)!==file || this.app.workspace.getActiveFile().path!==note.path)
        throw new Error('Image or active note changed before rename.');
      const base=joinedVaultPath(file.parent&&file.parent.path,newStem+'.'+file.extension);
      const destination=this.uniqueImagePath(base);
      await this.app.fileManager.renameFile(file,destination);
      new Notice('Ultra Paste: renamed image to '+file.name);
    });
    this._imageRenameQueue=operation.catch(()=>{});
    try{await operation;}catch(e){new Notice('Ultra Paste: rename failed: '+e.message);}
  }

  onEditorPaste(evt, editor, info) {
    if (!editor || evt.defaultPrevented) return;
    const data = evt.clipboardData;
    if (!data) return;
    const types = Array.from(data.types || []);
    // Honor the keyboard's plain-paste intent before ANY smart-paste logic.
    if (this._plainPasteKeyHeld) {
      evt.preventDefault();
      if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
      if (this._plainPasteConsumed) return; // keyboard handler already handled it
      this._plainPasteConsumed = true;
      if (types.includes('text/plain')) {
        // Direct clipboard event data: bypass ALL transformations and rules.
        const literal = data.getData('text/plain');
        if (literal) editor.replaceSelection(literal);
      } else {
        new Notice('Ultra Paste: text/plain unavailable; nothing pasted.');
      }
      return;
    }
    // Mobile fallback: let the user trigger native Paste after arming a single
    // strict-text operation. Unlike smart mode, never read text/html or Files.
    if(this._plainNextUntil){
      const armed=this._plainNextUntil>Date.now();this._plainNextUntil=0;
      if(armed){
        evt.preventDefault();
        if(typeof evt.stopPropagation==='function')evt.stopPropagation();
        const literal=types.includes('text/plain')?data.getData('text/plain'):'';
        if(literal)editor.replaceSelection(literal);
        else new Notice('Ultra Paste: text/plain unavailable; selection not changed.');
        return;
      }
    }
    if (!this.settings.enabled) return;
    if (types.includes('Files') || (data.files && data.files.length)) {
      if(!this.settings.smartImagePaste) return;
      const pictures=eligibleImageFiles(data);
      if(!pictures.length || hasMeaningfulMixedText(data)) return; // Preserve rich text+image via native Obsidian.
      const note=(info && info.file)||this.app.workspace.getActiveFile();
      if(!note || note.extension!=='md') return;
      evt.preventDefault();
      if(typeof evt.stopPropagation==='function')evt.stopPropagation();
      void this.handleImageFiles(pictures,editor,note).catch(error=>{
        console.error('Ultra Paste: image clipboard processing failed',error);
        new Notice('Ultra Paste: image paste failed: '+error.message);
      });
      return;
    }
    if (!types.includes('text/plain') && !types.includes('text/html')) return;
    const plain = data.getData('text/plain');
    const html = data.getData('text/html');
    if (!plain && !html) return;
    if (plain.length + html.length > SMART_PASTE_MAX_CHARS) return; // Native paste for large documents.
    if (html.includes('<!-- obsidian -->')) return; // preserve native internal pastes
    const selection = editor.getSelection();
    let intercepted = false;
    try {
      const decision=detectSmartPaste(plain,html,editor,this.settings,{selectedText:selection});
      if (!decision) return; // No detector claimed this content; use native Obsidian.
      evt.preventDefault();
      intercepted = true;
      if (decision.kind==='title') this.pasteUrlWithTitle(editor,decision.url);
      else if (decision.kind==='insert') editor.replaceSelection(decision.text);
      if (this.settings.showNotifications) new Notice('Ultra Paste: pasted ('+decision.source+').');
    } catch (err) {
      console.error('Ultra Paste failed; leaving clipboard contents intact:', err);
      if (intercepted && plain) {
        try { editor.replaceSelection(plain); } catch (fallbackError) { console.error('Ultra Paste fallback also failed', fallbackError); }
      }
      new Notice('Ultra Paste: formatting error; original text preserved where possible.');
    }
  }

  async importSettings(json) {
    const source = JSON.parse(json);
    if (!source || typeof source !== 'object') throw new Error('Invalid JSON settings');
    if (Array.isArray(source.rules) && Object.prototype.hasOwnProperty.call(source, 'settingsFormatVersion')) {
      const mapped = source.rules.map((r,i) => normalizeRule({
        name: r.name || 'Imported rule '+(i+1), enabled: r.type !== 'script' && !!r.enabled,
        type: r.type === 'script' ? 'javascript' : 'regex', pattern: r.pattern,
        flags: 'g', replacement: r.replacer, script: r.script,
        scope:'prose'
      }));
      this.settings.rules.push(...mapped);
      this.settings.allowJavaScriptRules = false;
    } else if (Array.isArray(source.rules)) {
      this.settings = normalizeSettings({...source, allowJavaScriptRules:false, rules:source.rules.map(r => ({...normalizeRule(r),enabled:r.type === 'javascript' ? false : !!r.enabled}))});
    } else throw new Error('No supported rules array found');
    if (this.settings.rules.length > RULE_LIMIT) this.settings.rules = this.settings.rules.slice(0,RULE_LIMIT);
    await this.saveSettings();
  }
};

// Export pure helpers only for external testing, not required by Obsidian runtime.
module.exports._internal = {
  getStandaloneUrl, isExcludedTitleHost, isDirectAssetUrl, escapeMarkdownLinkTitle, titleFromHtml, htmlProvidesLinkLabel, autoTitleCandidate, titledMarkdown,
  cleanPdfText, structurePaste, classifyListLines, detectSmartPaste, SMART_PASTE_DETECTORS,
  formatPaste, htmlToSafeMarkdown, convertMathOutsideCode, fixAIMath, fixMathWithProfile, convertInlineBracketMath, repairDisplayMathArtifacts, likelyMathExpression, cleanLinks,
  stripTrackingUrl, protectMarkdown, applyCustomRules, isInsideFence,
  imageExt, safeImageStem, imageDate, imageNameFromTemplate, eligibleImageFiles, imageHash, imageDisplayWidth, imageEmbedLink, validateImageUrl, imageRefAtCursor,
  mathMLToTex, selectArticleRoot, normalizeRule, preText, isPublicAddress, boundedNodeTitleHtml, normalizeSettings, captureEditTarget, validEditTarget, hasMeaningfulMixedText, dropEditorPosition, downloadRemoteImageLimited, isMobileRuntime, validatePublicWebUrl, boundedWebFetch
};
