// Part of the https://code.librehq.com/kfogel/ep_polypaste Etherpad plugin.
//
// Copyright (C) Karl Fogel
//     
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//    http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

// Converts a selection of an Etherpad document into various
// plain-text markup formats (and HTML).
//
// This module is pure: it touches neither the DOM nor Etherpad
// internals, so it can be loaded by the browser, by the server (to
// build the settings menu), and by the unit tests.  The only
// Etherpad-specific knowledge here is the format of attribute strings
// ("alines") and the names of the attributes Etherpad and some common
// plugins put on text:
//
//   * Line attributes, carried by the line-marker character that
//     starts a "special" line (rep.lines entries have lineMarker ===
//     1 on such lines):
// 
//     - list    bullet<N> | number<N> | indent<N>  (N = nesting level, 1-based)
//     - heading h1..h6 | code                      (ep_headings2)
// 
//   * Character attributes:
// 
//     - bold, italic, underline, strikethrough     (core)
//     - hyperlink = <url>                          (ep_hyperlinked_text)

// The formats, in menu order.  Each has an id, a label, the usual
// file extension for it, and short aliases that can be used in place
// of the id.  Formats with `only` set are offered in just one place:
// 'copy' is the copy-and-paste menu in the browser, and 'cli' is the
// ep-export command.  The rest are offered everywhere, including the
// export URLs.
const FORMATS = [
  {id: 'plaintext-tabs-nesting', label: 'Plain text, TAB-indented', ext: 'txt',
    aliases: ['txt-tabs']},
  {id: 'plaintext-tabs-markers-nesting', label: 'Plain text, TAB-indented, with bullets/numbers',
    ext: 'txt', aliases: ['txt-tabs-markers']},
  {id: 'org', label: 'Org Mode', ext: 'org', aliases: []},
  {id: 'markdown', label: 'Markdown', ext: 'md', aliases: ['md']},
  {id: 'typst', label: 'Typst', ext: 'typ', aliases: ['typ']},
  {id: 'latex', label: 'LaTeX', ext: 'tex', aliases: ['tex']},
  {id: 'asciidoc', label: 'AsciiDoc', ext: 'adoc', aliases: ['adoc']},
  {id: 'rst', label: 'reStructuredText', ext: 'rst', aliases: []},
  {id: 'mediawiki', label: 'MediaWiki', ext: 'wiki', aliases: ['wiki']},
  {id: 'html', label: 'HTML source', ext: 'html', aliases: []},
  // The plugin stays out of the way, so the browser copies the pad's text
  // as it normally would, with list nesting flattened.
  {id: 'plaintext-flat', label: 'Browser default (no conversion)', ext: 'txt',
    aliases: ['txt-flat'], only: 'copy'},
  // Etherpad's own plain-text export (/p/PAD/export/txt), as is.
  {id: 'plaintext-etherpad', label: 'Etherpad\'s own plain-text export (no conversion)', ext: 'txt',
    aliases: ['txt-etherpad'], only: 'cli'},
];

const DEFAULT_FORMAT = 'plaintext-tabs-nesting';

// Returns the formats offered in `where`: 'copy', 'cli', or 'url' (the
// export URLs).
const formatsFor = (where) => FORMATS.filter((f) => !f.only || f.only === where);

// Returns the id of the format offered in `where` whose id or alias
// is `name`, or null if there is no such format.
const findFormat = (name, where) => {
  const format = formatsFor(where).find((f) => f.id === name || f.aliases.includes(name));
  return format ? format.id : null;
};

const extensionOf = (id) => (FORMATS.find((f) => f.id === id) || {}).ext;

// ---------------------------------------------------------------------------
// Reading the document model.
// ---------------------------------------------------------------------------

// Parses an Etherpad attribute string into [{attribNums, chars}, ...].
const parseAline = (aline) => {
  const ops = [];
  const re = /((?:\*[0-9a-z]+)*)(?:\|[0-9a-z]+)?[-+=]([0-9a-z]+)/g;
  let m;
  while ((m = re.exec(aline || '')) != null) {
    const attribNums = m[1] ? m[1].split('*').slice(1).map((n) => parseInt(n, 36)) : [];
    ops.push({attribNums, chars: parseInt(m[2], 36)});
  }
  return ops;
};

const lookupAttrib = (pool, num) => {
  const a = typeof pool.getAttrib === 'function' ? pool.getAttrib(num) : pool.numToAttrib[num];
  return a || ['', ''];
};

// Returns [{start, end, attrs}, ...] covering the line, where attrs
// maps attribute name to value.  Attributes whose value is '' are
// absent.
const attributeRuns = (aline, pool) => {
  const runs = [];
  let pos = 0;
  for (const op of parseAline(aline)) {
    const attrs = {};
    for (const n of op.attribNums) {
      const [k, v] = lookupAttrib(pool, n);
      if (k && v !== '' && v != null) attrs[k] = v;
    }
    runs.push({start: pos, end: pos + op.chars, attrs});
    pos += op.chars;
  }
  return runs;
};

// [ref:b3a7827b]
// 
// The Etherpad 'ep_hyperlinked_text' plugin puts a zero-width space
// (ZERO WIDTH SPACE, U+200B / decimal 8203) on each side of linked
// text, presumably to help users pick a text-insertion location that
// is either within or not within the hyperlink, when editing the pad
// in the browser.  But in the context of copying-and-pasting, these
// extra boundary characters are not useful and we should drop them.
const ZWSP = '\u200B';  // '​', but that may appear as the empty string

// In practice the padding can be more than one character per side,
// and some of it can carry the hyperlink attribute itself (e.g., when
// a link is re-applied over already-padded text, a pad might end up
// with "a ZZlinkZZ?", where "link" and the first Z after it are
// linked).  So we treat each run of consecutive zero-width spaces as
// a unit and drop the whole run if it touches a linked character or
// contains one.  Any other zero-width space is assumed to be one that
// someone entered deliberately, so we keep it.  And we check the
// whole line, not just the selection: if the selected text stops
// right next to a link, we still drop the padding at the edge.
const linkPadding = (text, runs) => {
  const drop = new Set();
  if (!text.includes(ZWSP)) return drop;
  const hrefAt = (pos) => {
    const run = runs.find((r) => r.start <= pos && pos < r.end);
    return !!(run && run.attrs.hyperlink);
  };
  for (let p = text.indexOf(ZWSP); p >= 0; p = text.indexOf(ZWSP, p)) {
    let end = p;
    while (text[end] === ZWSP) end++;
    let linked = hrefAt(p - 1) || hrefAt(end);
    for (let q = p; q < end && !linked; q++) linked = hrefAt(q);
    if (linked) for (let q = p; q < end; q++) drop.add(q);
    p = end;
  }
  return drop;
};

// Returns text[a, b) without the characters at positions in `drop`.
const sliceWithout = (text, a, b, drop) => {
  if (!drop.size) return text.slice(a, b);
  let s = '';
  for (let p = a; p < b; p++) if (!drop.has(p)) s += text[p];
  return s;
};

// Splits text[from, to) into formatted segments, leaving out the
// characters at positions in `drop`.
const segmentsOf = (text, runs, from, to, drop = new Set()) => {
  const segs = [];
  for (const run of runs) {
    const a = Math.max(from, run.start);
    const b = Math.min(to, run.end, text.length);
    if (a >= b) continue;
    const segText = sliceWithout(text, a, b, drop);
    if (segText === '') continue;
    const seg = {
      text: segText,
      b: !!run.attrs.bold,
      i: !!run.attrs.italic,
      u: !!run.attrs.underline,
      s: !!run.attrs.strikethrough,
      href: run.attrs.hyperlink || null,
    };
    const prev = segs[segs.length - 1];
    if (prev && prev.b === seg.b && prev.i === seg.i && prev.u === seg.u && prev.s === seg.s &&
        prev.href === seg.href) {
      prev.text += seg.text;
    } else {
      segs.push(seg);
    }
  }
  // Text beyond the end of the attribute runs (shouldn't happen) is
  // kept plain.
  const covered = runs.length ? runs[runs.length - 1].end : 0;
  if (to > covered && covered < text.length) {
    segs.push({text: sliceWithout(text, Math.max(from, covered), to, drop),
      b: false, i: false, u: false, s: false, href: null});
  }
  return segs;
};

// Builds the model of one document line, restricted to columns [from, to).
const lineModel = (docLine, pool, from, to) => {
  const {text, aline, lineMarker} = docLine;
  const runs = attributeRuns(aline, pool);
  const lineAttrs = lineMarker && runs.length ? runs[0].attrs : {};
  const line = {
    kind: 'para',
    segs: segmentsOf(text, runs, Math.max(from, lineMarker), to, linkPadding(text, runs)),
  };
  const list = /^([a-z]+)([0-9]+)$/.exec(lineAttrs.list || '');
  const heading = /^h([1-6])$/.exec(lineAttrs.heading || '');
  if (list) {
    line.kind = 'list';
    line.listType = ['bullet', 'number', 'indent'].includes(list[1]) ? list[1] : 'bullet';
    line.level = Math.max(1, Number(list[2]));
  } else if (heading) {
    line.kind = 'heading';
    line.headingLevel = Number(heading[1]);
  } else if (lineAttrs.heading === 'code') {
    line.kind = 'code';
  } else if (line.segs.every((s) => s.text === '')) {
    line.kind = 'blank';
  }
  return line;
};

// Sets `number` on the numbered-list items in `lines`, which are the
// model of document lines starting at `first`.  Numbers are counted
// the way Etherpad's renumberList() assigns them (which is what the
// pad shows): from the top of the list, restarting when the list type
// changes at a level or when a sublist begins again under a new
// parent item.  Etherpad's `start` attribute is not used, since it
// can be stale (for instance, right after an import).
const numberItems = (doc, first, lines) => {
  const listInfo = (docLine) => {
    const runs = docLine.lineMarker ? attributeRuns(docLine.aline, doc.pool) : [];
    const m = /^([a-z]+)([0-9]+)$/.exec((runs[0] && runs[0].attrs.list) || '');
    return m ? {type: m[1], level: Number(m[2])} : null;
  };
  // Find the top of the list containing the first selected line.
  let top = first;
  for (;;) {
    const info = top > 0 && listInfo(doc.getLine(top - 1));
    if (!info || info.type === 'indent') break;
    top--;
  }
  let counters = [];
  let types = [];
  const step = (info) => {
    if (!info || info.type === 'indent') {
      counters = [];
      types = [];
      return null;
    }
    const i = info.level - 1;
    counters.length = types.length = info.level;
    if (types[i] !== info.type) counters[i] = 0;
    types[i] = info.type;
    counters[i] = (counters[i] || 0) + 1;
    return counters[i];
  };
  for (let i = top; i < first; i++) step(listInfo(doc.getLine(i)));
  for (const line of lines) {
    const n = step(line.kind === 'list' ? {type: line.listType, level: line.level} : null);
    if (line.kind === 'list') line.number = n;
  }
};

// Builds the model of the selected part of a document.
//
// `doc` is {lineCount, getLine(i) -> {text, aline, lineMarker},
// pool}; text excludes the trailing newline.  `selStart` and `selEnd`
// are [line, column] pairs as in Etherpad's rep.
//
// Return null if the selection is empty.  Otherwise return {inline,
// lines, trailingNewline}.  `inline` is true when the selection is
// part of a single line, in which case only character formatting is
// rendered (no list markers, indentation, etc.).
const extractSelection = (doc, selStart, selEnd) => {
  let [sl, sc] = selStart;
  let [el, ec] = selEnd;
  if (sl > el || (sl === el && sc >= ec)) return null;
  el = Math.min(el, doc.lineCount - 1);
  let trailingNewline = false;
  // A selection ending at the start of a line really ends with the newline
  // that terminates the previous line.
  if (el > sl && ec <= doc.getLine(el).lineMarker) {
    el--;
    ec = doc.getLine(el).text.length;
    trailingNewline = true;
  }
  const first = doc.getLine(sl);
  const inline = sl === el && !trailingNewline &&
      !(sc <= first.lineMarker && ec >= first.text.length);
  const lines = [];
  for (let i = sl; i <= el; i++) {
    const docLine = doc.getLine(i);
    const from = i === sl ? sc : 0;
    const to = i === el ? ec : docLine.text.length;
    lines.push(lineModel(docLine, doc.pool, from, to));
  }
  numberItems(doc, sl, lines);
  return {inline, lines, trailingNewline};
};

// Builds the model of a whole document, without any blank lines at
// the end, and ending with a newline like any text file.  Return null
// if the document has nothing but blank lines.
const extractDocument = (doc) => {
  if (!doc.lineCount) return null;
  const last = doc.lineCount - 1;
  const model = extractSelection(doc, [0, 0], [last, doc.getLine(last).text.length]);
  if (!model) return null;
  while (model.lines.length && model.lines[model.lines.length - 1].kind === 'blank') {
    model.lines.pop();
  }
  if (!model.lines.length) return null;
  model.inline = false;
  model.trailingNewline = true;
  return model;
};

// ---------------------------------------------------------------------------
// Structure shared by the renderers.
// ---------------------------------------------------------------------------

// Groups lines into blocks: {kind: 'list', items}, {kind: 'code',
// lines}, {kind: 'para' | 'heading' | 'blank', line}.
// 
// Each list item gets a `depth`, which is its nesting level relative
// to the rest of the selection, with skipped levels closed up: a
// selection starting at level 3 has depth 1, and a level-3 item
// directly under a level-1 item has depth 2.  Formats that can only
// nest one level at a time (all the markup formats) use `depth`; the
// TAB formats use `level` relative to the shallowest level in the
// selection, which preserves skipped levels.
const toBlocks = (lines) => {
  const blocks = [];
  let stack = [];
  for (const line of lines) {
    const prev = blocks[blocks.length - 1];
    if (line.kind === 'list') {
      while (stack.length && stack[stack.length - 1] > line.level) stack.pop();
      if (!stack.length || stack[stack.length - 1] < line.level) stack.push(line.level);
      const item = {line, depth: stack.length};
      if (prev && prev.kind === 'list') prev.items.push(item);
      else blocks.push({kind: 'list', items: [item]});
      continue;
    }
    stack = [];
    if (line.kind === 'code' && prev && prev.kind === 'code') prev.lines.push(line);
    else if (line.kind === 'code') blocks.push({kind: 'code', lines: [line]});
    else blocks.push({kind: line.kind, line});
  }
  return blocks;
};

const plainText = (segs) => segs.map((s) => s.text).join('');

// Matches bare URLs, which Etherpad displays as links.
const URL_RE = /\b(?:(?:https?|ftp|sftp|file|mailto|irc|news|nntp|xmpp):|www\.)[^\s<>"]*[^\s<>".,;:!?'()[\]]/g;

// Calls onText(str) and onUrl(str) for the pieces of `text`.
const splitUrls = (text, onText, onUrl) => {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) out.push(onText(text.slice(last, m.index)));
    out.push(onUrl(m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(onText(text.slice(last)));
  return out.join('');
};

// Renders formatted segments using a table of markup for one format:
// 
//   open/close: {b, i, u, s} -> string   (a missing entry means no markup)
//   text(str)        escapes ordinary text
//   url(str)         renders a bare URL
//   link(href, str)  renders a link whose (already rendered) text is str
//   trimSpace        move whitespace out of formatted spans, as required by
//                    Markdown, Org, reStructuredText, etc.
// 
// Formatting spans are kept properly nested.
const FLAGS = ['b', 'i', 'u', 's'];
const renderInline = (segs, m) => {
  const pieces = [];
  // Split leading/trailing whitespace off formatted segments.
  let parts = segs;
  if (m.trimSpace) {
    parts = [];
    for (const seg of segs) {
      const mm = /^(\s*)([\s\S]*?)(\s*)$/.exec(seg.text);
      const bare = {...seg, b: false, i: false, u: false, s: false};
      if (mm[1]) parts.push({...bare, text: mm[1]});
      if (mm[2]) parts.push({...seg, text: mm[2]});
      if (mm[3]) parts.push({...bare, text: mm[3]});
    }
  }
  // Group consecutive segments with the same link.
  const groups = [];
  for (const seg of parts) {
    const g = groups[groups.length - 1];
    if (g && g.href === seg.href) g.segs.push(seg);
    else groups.push({href: seg.href, segs: [seg]});
  }
  for (const g of groups) {
    const open = [];
    const out = [];
    const closeTo = (n) => {
      while (open.length > n) out.push(m.close[open.pop()] || '');
    };
    for (const seg of g.segs) {
      const want = FLAGS.filter((f) => seg[f] && m.open[f] != null);
      let keep = 0;
      while (keep < open.length && want.includes(open[keep])) keep++;
      closeTo(keep);
      for (const f of want) {
        if (!open.includes(f)) {
          open.push(f);
          out.push(m.open[f]);
        }
      }
      out.push(g.href ? m.text(seg.text) : splitUrls(seg.text, m.text, m.url));
    }
    closeTo(0);
    const body = out.join('');
    pieces.push(g.href ? m.link(g.href, body, plainText(g.segs)) : body);
  }
  return pieces.join('');
};

const identity = (s) => s;

// Adds blank lines between blocks of different kinds where the markup
// language would otherwise run them together.  `out` is a list of
// {kind, text} where text may contain newlines.
const joinBlocks = (out, needsGap) => {
  const lines = [];
  let prev = null;
  for (const b of out) {
    if (prev && b.kind !== 'blank' && prev.kind !== 'blank' && needsGap(prev.kind, b.kind)) {
      lines.push('');
    }
    lines.push(b.text);
    prev = b;
  }
  return lines.join('\n');
};

// Tracks, for formats whose nested list items are indented to line up
// with the text of their parent item, the column at which each
// depth's text starts.
const makeIndenter = () => {
  const textCol = [0];
  return (depth, marker) => {
    const indent = textCol[depth - 1] || 0;
    textCol[depth] = indent + (marker ? marker.length + 1 : 2);
    textCol.length = depth + 1;
    return ' '.repeat(indent);
  };
};

// ---------------------------------------------------------------------------
// The formats.
// ---------------------------------------------------------------------------

const renderTabs = (model, withMarkers) => {
  if (model.inline) return plainText(model.lines[0].segs);
  const levels = model.lines.filter((l) => l.kind === 'list').map((l) => l.level);
  const base = levels.length ? Math.min(...levels) - 1 : 0;
  return model.lines.map((line) => {
    const text = plainText(line.segs);
    if (line.kind !== 'list') return text;
    let marker = '';
    if (withMarkers && line.listType === 'bullet') marker = '- ';
    if (withMarkers && line.listType === 'number') marker = `${line.number}. `;
    return '\t'.repeat(line.level - base - 1) + marker + text;
  }).join('\n');
};

// --- Markdown (CommonMark, plus GitHub's ~~strikethrough~~) ---

const mdText = (s) => s
    .replace(/[\\`*[\]<]/g, '\\$&')
    .replace(/(^|\W)_|_(?=\W|$)/g, (x) => x.replace('_', '\\_'));
// Escapes characters that would otherwise start a block construct.
const mdLineStart = (s) => s
    .replace(/^(\s*)([#>+=|-])/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/, '$1\\$2');
const MD = {
  open: {b: '**', i: '_', s: '~~', u: '<u>'},
  close: {b: '**', i: '_', s: '~~', u: '</u>'},
  text: mdText,
  url: identity,
  link: (href, body) => `[${body}](<${href.replace(/[<>]/g, encodeURIComponent)}>)`,
  trimSpace: true,
};

const renderMarkdown = (model) => {
  const inline = (line) => mdLineStart(renderInline(line.segs, MD));
  if (model.inline) return renderInline(model.lines[0].segs, MD);
  const out = [];
  for (const block of toBlocks(model.lines)) {
    if (block.kind === 'list') {
      const indent = makeIndenter();
      const text = block.items.map(({line, depth}) => {
        const marker = line.listType === 'number' ? `${line.number}.` : '-';
        return `${indent(depth, marker)}${marker} ${inline(line)}`.trimEnd();
      });
      out.push({kind: 'list', text: text.join('\n')});
    } else if (block.kind === 'code') {
      const body = block.lines.map((l) => plainText(l.segs)).join('\n');
      const fence = '`'.repeat(Math.max(3, ...(body.match(/`+/g) || []).map((f) => f.length + 1)));
      out.push({kind: 'code', text: `${fence}\n${body}\n${fence}`});
    } else if (block.kind === 'heading') {
      out.push({kind: 'heading',
        text: `${'#'.repeat(block.line.headingLevel)} ${renderInline(block.line.segs, MD)}`});
    } else {
      out.push({kind: block.kind, text: block.kind === 'blank' ? '' : inline(block.line)});
    }
  }
  return joinBlocks(out, (a, b) => a !== b && !(a === 'heading' && b === 'para'));
};

// --- Org Mode ---

const ORG = {
  open: {b: '*', i: '/', u: '_', s: '+'},
  close: {b: '*', i: '/', u: '_', s: '+'},
  text: identity,
  url: identity,
  link: (href, body, plain) => (plain === href ? `[[${href}]]` : `[[${href}][${body}]]`),
  trimSpace: true,
};

const renderOrg = (model) => {
  if (model.inline) return renderInline(model.lines[0].segs, ORG);
  const out = [];
  for (const block of toBlocks(model.lines)) {
    if (block.kind === 'list') {
      const indent = makeIndenter();
      const text = block.items.map(({line, depth}) => {
        const body = renderInline(line.segs, ORG);
        if (line.listType === 'indent') return `${indent(depth, '')}${body}`.trimEnd();
        const marker = line.listType === 'number' ? `${line.number}.` : '-';
        return `${indent(depth, marker)}${marker} ${body}`.trimEnd();
      });
      out.push({kind: 'list', text: text.join('\n')});
    } else if (block.kind === 'code') {
      const body = block.lines.map((l) => plainText(l.segs).replace(/^(\s*)([*#])/, '$1,$2'));
      out.push({kind: 'code', text: ['#+begin_example', ...body, '#+end_example'].join('\n')});
    } else if (block.kind === 'heading') {
      out.push({kind: 'heading',
        text: `${'*'.repeat(block.line.headingLevel)} ${renderInline(block.line.segs, ORG)}`});
    } else if (block.kind === 'blank') {
      out.push({kind: 'blank', text: ''});
    } else {
      // A line starting with "* " would be a heading; indented, it is a list item.
      const text = renderInline(block.line.segs, ORG).replace(/^\*+(?=\s)/, ' $&');
      out.push({kind: 'para', text});
    }
  }
  return joinBlocks(out, () => false);
};

// --- AsciiDoc ---

const ADOC = {
  open: {b: '**', i: '__', u: '[.underline]#', s: '[.line-through]#'},
  close: {b: '**', i: '__', u: '#', s: '#'},
  text: identity,
  url: identity,
  link: (href, body, plain) => (plain === href ? href : `link:${href.replace(/[\s[\]]/g, encodeURIComponent)}[${body.replace(/]/g, '\\]')}]`),
  trimSpace: true,
};

const renderAsciidoc = (model) => {
  if (model.inline) return renderInline(model.lines[0].segs, ADOC);
  const out = [];
  for (const block of toBlocks(model.lines)) {
    if (block.kind === 'list') {
      const text = block.items.map(({line, depth}) => {
        const marker = (line.listType === 'number' ? '.' : '*').repeat(depth);
        return `${marker} ${renderInline(line.segs, ADOC)}`.trimEnd();
      });
      out.push({kind: 'list', text: text.join('\n')});
    } else if (block.kind === 'code') {
      const body = block.lines.map((l) => plainText(l.segs));
      out.push({kind: 'code', text: ['----', ...body, '----'].join('\n')});
    } else if (block.kind === 'heading') {
      out.push({kind: 'heading',
        text: `${'='.repeat(block.line.headingLevel + 1)} ${renderInline(block.line.segs, ADOC)}`});
    } else {
      out.push({kind: block.kind,
        text: block.kind === 'blank' ? '' : renderInline(block.line.segs, ADOC)});
    }
  }
  return joinBlocks(out, (a, b) => a !== b);
};

// --- reStructuredText ---

const RST = {
  open: {b: '**', i: '*'},
  close: {b: '**', i: '*'},
  text: (s) => s.replace(/[\\`*|]/g, '\\$&').replace(/_(?=\W|$)/g, '\\_'),
  url: identity,
  link: (href, body, plain) => (plain === href ? href : `\`${plain.replace(/[`<\\]/g, '\\$&')} <${href}>\`__`),
  trimSpace: true,
};
const RST_UNDERLINES = ['=', '-', '~', '^', '"', '\''];

const renderRst = (model) => {
  if (model.inline) return renderInline(model.lines[0].segs, RST);
  const out = [];
  for (const block of toBlocks(model.lines)) {
    if (block.kind === 'list') {
      // Nested lists must be separated from their surroundings by blank lines.
      const indent = makeIndenter();
      const text = [];
      let prevDepth = 0;
      for (const {line, depth} of block.items) {
        if (prevDepth && depth !== prevDepth) text.push('');
        const marker = line.listType === 'number' ? `${line.number}.` : '-';
        text.push(`${indent(depth, marker)}${marker} ${renderInline(line.segs, RST)}`.trimEnd());
        prevDepth = depth;
      }
      out.push({kind: 'list', text: text.join('\n')});
    } else if (block.kind === 'code') {
      const body = block.lines.map((l) => `   ${plainText(l.segs)}`.trimEnd());
      out.push({kind: 'code', text: ['::', '', ...body].join('\n')});
    } else if (block.kind === 'heading') {
      const text = renderInline(block.line.segs, RST);
      const ch = RST_UNDERLINES[block.line.headingLevel - 1];
      out.push({kind: 'heading', text: `${text}\n${ch.repeat(Math.max(text.length, 1))}`});
    } else {
      const text = block.kind === 'blank' ? ''
        : renderInline(block.line.segs, RST).replace(/^(\s*)([-+*•]|\d+[.)])(?=\s)/, '$1\\$2');
      out.push({kind: block.kind, text});
    }
  }
  return joinBlocks(out, (a, b) => a !== b || a === 'heading');
};

// --- MediaWiki ---

const htmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const WIKI = {
  open: {b: '\'\'\'', i: '\'\'', u: '<u>', s: '<s>'},
  close: {b: '\'\'\'', i: '\'\'', u: '</u>', s: '</s>'},
  text: (s) => s.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;')),
  url: identity,
  link: (href, body, plain) => (plain === href ? href : `[${href.replace(/[\s\]]/g, encodeURIComponent)} ${body}]`),
  trimSpace: false,
};

const renderMediawiki = (model) => {
  if (model.inline) return renderInline(model.lines[0].segs, WIKI);
  const out = [];
  for (const block of toBlocks(model.lines)) {
    if (block.kind === 'list') {
      const prefix = [];
      const text = block.items.map(({line, depth}) => {
        prefix.length = depth - 1;
        prefix.push({bullet: '*', number: '#', indent: ':'}[line.listType]);
        return `${prefix.join('')} ${renderInline(line.segs, WIKI)}`.trimEnd();
      });
      out.push({kind: 'list', text: text.join('\n')});
    } else if (block.kind === 'code') {
      const body = block.lines.map((l) => htmlEscape(plainText(l.segs)));
      out.push({kind: 'code', text: `<pre>${body.join('\n')}</pre>`});
    } else if (block.kind === 'heading') {
      const eq = '='.repeat(Math.min(block.line.headingLevel + 1, 6));
      out.push({kind: 'heading', text: `${eq} ${renderInline(block.line.segs, WIKI)} ${eq}`});
    } else {
      // Leading whitespace would make a preformatted line.
      const text = block.kind === 'blank' ? ''
        : renderInline(block.line.segs, WIKI).replace(/^[ \t]+|^(?=[*#:;])/, '<nowiki/>$&');
      out.push({kind: block.kind, text});
    }
  }
  return joinBlocks(out, () => false);
};

// --- LaTeX ---

const LATEX_SPECIALS = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#',
  '_': '\\_', '%': '\\%', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
};
const latexText = (s) => s.replace(/[\\{}$&#_%~^]/g, (c) => LATEX_SPECIALS[c]);
const latexUrl = (s) => s.replace(/[\\{}%#]/g, '\\$&');
const TEX = {
  open: {b: '\\textbf{', i: '\\emph{', u: '\\underline{', s: '\\sout{'},
  close: {b: '}', i: '}', u: '}', s: '}'},
  text: latexText,
  url: (u) => `\\url{${latexUrl(u)}}`,
  link: (href, body, plain) => (plain === href ? `\\url{${latexUrl(href)}}` : `\\href{${latexUrl(href)}}{${body}}`),
  trimSpace: false,
};
const LATEX_SECTIONS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph',
  'subparagraph'];

const renderLatex = (model) => {
  if (model.inline) return renderInline(model.lines[0].segs, TEX);
  const out = [];
  for (const block of toBlocks(model.lines)) {
    if (block.kind === 'list') {
      const text = [];
      const envs = []; // envs[d - 1] = environment open at depth d
      const pad = (d) => '  '.repeat(d);
      const close = (n) => {
        while (envs.length > n) text.push(`${pad(envs.length - 1)}\\end{${envs.pop()}}`);
      };
      for (const {line, depth} of block.items) {
        const env = line.listType === 'number' ? 'enumerate' : 'itemize';
        close(depth);
        if (envs.length === depth && envs[depth - 1] !== env) close(depth - 1);
        while (envs.length < depth) {
          text.push(`${pad(envs.length)}\\begin{${env}}`);
          envs.push(env);
        }
        const item = line.listType === 'indent' ? '\\item[]' : '\\item';
        text.push(`${pad(depth)}${item} ${renderInline(line.segs, TEX)}`.trimEnd());
      }
      close(0);
      out.push({kind: 'list', text: text.join('\n')});
    } else if (block.kind === 'code') {
      const body = block.lines.map((l) => plainText(l.segs));
      out.push({kind: 'code', text: ['\\begin{verbatim}', ...body, '\\end{verbatim}'].join('\n')});
    } else if (block.kind === 'heading') {
      const cmd = LATEX_SECTIONS[block.line.headingLevel - 1];
      out.push({kind: 'heading', text: `\\${cmd}{${renderInline(block.line.segs, TEX)}}`});
    } else {
      out.push({kind: block.kind,
        text: block.kind === 'blank' ? '' : renderInline(block.line.segs, TEX)});
    }
  }
  return joinBlocks(out, () => false);
};

// --- Typst ---

// Escapes characters with meaning in Typst markup.  "//" and "/*"
// would start comments; URLs are left alone (Typst links them
// automatically).
const typstText = (s) => s.replace(/[\\*_`#$<@[\]~]|\/(?=[/*])/g, '\\$&');
// Escapes characters that would otherwise start a block construct.
const typstLineStart = (s) => s
    .replace(/^(\s*)([-+=/])/, '$1\\$2')
    .replace(/^(\s*\d+)\./, '$1\\.');
const typstString = (s) => `"${s.replace(/[\\"]/g, '\\$&')}"`;
const TYPST = {
  open: {b: '*', i: '_', u: '#underline[', s: '#strike['},
  close: {b: '*', i: '_', u: ']', s: ']'},
  text: typstText,
  url: identity,
  link: (href, body, plain) => (plain === href && /^https?:\/\//.test(href) ? href
    : `#link(${typstString(href)})[${body}]`),
  trimSpace: true,
};

const renderTypst = (model) => {
  const inline = (line) => typstLineStart(renderInline(line.segs, TYPST));
  if (model.inline) return renderInline(model.lines[0].segs, TYPST);
  const out = [];
  for (const block of toBlocks(model.lines)) {
    if (block.kind === 'list') {
      const indent = makeIndenter();
      const text = block.items.map(({line, depth}) => {
        const marker = line.listType === 'number' ? `${line.number}.` : '-';
        return `${indent(depth, marker)}${marker} ${inline(line)}`.trimEnd();
      });
      out.push({kind: 'list', text: text.join('\n')});
    } else if (block.kind === 'code') {
      const body = block.lines.map((l) => plainText(l.segs)).join('\n');
      const fence = '`'.repeat(Math.max(3, ...(body.match(/`+/g) || []).map((f) => f.length + 1)));
      out.push({kind: 'code', text: `${fence}\n${body}\n${fence}`});
    } else if (block.kind === 'heading') {
      out.push({kind: 'heading',
        text: `${'='.repeat(block.line.headingLevel)} ${renderInline(block.line.segs, TYPST)}`});
    } else {
      out.push({kind: block.kind, text: block.kind === 'blank' ? '' : inline(block.line)});
    }
  }
  return joinBlocks(out, (a, b) => a !== b && !(a === 'heading' && b === 'para'));
};

// --- HTML ---

const attrEscape = (s) => htmlEscape(s).replace(/"/g, '&quot;');
const HTML = {
  open: {b: '<strong>', i: '<em>', u: '<u>', s: '<s>'},
  close: {b: '</strong>', i: '</em>', u: '</u>', s: '</s>'},
  text: htmlEscape,
  url: (u) => `<a href="${attrEscape(/^www\./.test(u) ? `https://${u}` : u)}">${htmlEscape(u)}</a>`,
  // The hyperlink-* class is how ep_hyperlinked_text recognizes its links on paste.
  link: (href, body) => `<a href="${attrEscape(href)}" ` +
      `class="hyperlink hyperlink-${attrEscape(encodeURIComponent(href))}">${body}</a>`,
  trimSpace: false,
};

// Renders HTML.  With `pretty`, the result is indented source meant
// to be read by people; otherwise it is compact, for the clipboard's
// text/html flavor (which is what rich-text editors, including
// Etherpad itself, paste).  The list-<type><N> classes let Etherpad
// restore exact list types on paste.
const renderHtml = (model, pretty) => {
  if (model.inline) return renderInline(model.lines[0].segs, HTML);
  const out = [];
  const nl = pretty ? '\n' : '';
  const pad = (n) => (pretty ? '  '.repeat(n) : '');
  for (const block of toBlocks(model.lines)) {
    if (block.kind === 'list') {
      // Compact output is for pasting, including into other pads, so its
      // classes carry the original level (as Etherpad's own HTML would); a list
      // is split where the level changes without the depth changing.
      const levelOf = (line, depth) => (pretty ? depth : line.level);
      const stack = []; // {tag, type, level} per open list
      const openList = (line, depth) => {
        const tag = line.listType === 'number' ? 'ol' : 'ul';
        const start = line.listType === 'number' && line.number !== 1 ? ` start="${line.number}"` : '';
        const style = line.listType === 'indent' ? ' style="list-style-type: none;"' : '';
        const level = levelOf(line, depth);
        out.push(`${pad(2 * depth - 2)}<${tag} class="list-${line.listType}${level}"${start}${style}>`);
        stack.push({tag, type: line.listType, level});
      };
      const closeList = () => {
        const {tag} = stack.pop();
        out.push(`${pad(2 * stack.length + 1)}</li>`, `${pad(2 * stack.length)}</${tag}>`);
      };
      for (const {line, depth} of block.items) {
        while (stack.length > depth) closeList();
        if (stack.length === depth) {
          const top = stack[depth - 1];
          if (top.type !== line.listType || top.level !== levelOf(line, depth)) {
            closeList();
            openList(line, depth);
          } else {
            out.push(`${pad(2 * depth - 1)}</li>`);
          }
        } else {
          openList(line, depth);
        }
        out.push(`${pad(2 * depth - 1)}<li>${renderInline(line.segs, HTML)}`);
      }
      while (stack.length) closeList();
    } else if (block.kind === 'code') {
      const body = block.lines.map((l) => htmlEscape(plainText(l.segs))).join('\n');
      out.push(`<pre><code>${body}</code></pre>`);
    } else if (block.kind === 'heading') {
      const h = `h${block.line.headingLevel}`;
      out.push(`<${h}>${renderInline(block.line.segs, HTML)}</${h}>`);
    } else if (block.kind === 'blank') {
      if (!pretty) out.push('<p><br></p>');
    } else {
      out.push(`<p>${renderInline(block.line.segs, HTML)}</p>`);
    }
  }
  if (pretty) {
    // Put each <li>'s text and closing tag on the same line when there is no
    // nested list in between.
    return out.join(nl).replace(/(<li>[^\n]*)\n\s*<\/li>/g, '$1</li>');
  }
  return out.join('');
};

// ---------------------------------------------------------------------------

const RENDERERS = {
  'plaintext-tabs-nesting': (model) => renderTabs(model, false),
  'plaintext-tabs-markers-nesting': (model) => renderTabs(model, true),
  'markdown': renderMarkdown,
  'org': renderOrg,
  'asciidoc': renderAsciidoc,
  'rst': renderRst,
  'mediawiki': renderMediawiki,
  'latex': renderLatex,
  'typst': renderTypst,
  'html': (model) => renderHtml(model, true),
};

// Returns the text/plain rendering of `model` in format `id`.
const render = (id, model) => {
  const text = (RENDERERS[id] || RENDERERS[DEFAULT_FORMAT])(model);
  return model.trailingNewline ? `${text}\n` : text;
};

// Returns the text/html rendering of `model`.
const renderClipboardHtml = (model) => renderHtml(model, false);

module.exports = {
  FORMATS,
  DEFAULT_FORMAT,
  formatsFor,
  findFormat,
  extensionOf,
  extractSelection,
  extractDocument,
  render,
  renderClipboardHtml,
  // For tests.
  parseAline,
};
