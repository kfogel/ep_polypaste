'use strict';

const assert = require('node:assert/strict');
const {describe, it} = require('node:test');
const f = require('../static/js/formats');
const {makeDoc, selectAll} = require('./helpers');

const renderAll = (id, specs) => {
  const doc = makeDoc(specs);
  return f.render(id, f.extractSelection(doc, ...selectAll(doc)));
};

const OUTLINE = [
  {text: 'Fruit', list: 'bullet1'},
  {text: 'apple', list: 'bullet2'},
  {text: 'step one', list: 'number3', start: 1},
  {text: 'step two', list: 'number3', start: 2},
  {text: 'pear', list: 'bullet2'},
  {text: 'Veg', list: 'bullet1'},
];

describe('parseAline', () => {
  it('parses attributes, newlines and base-36 counts', () => {
    assert.deepEqual(f.parseAline('*0*a+1+z*1|1+1'), [
      {attribNums: [0, 10], chars: 1},
      {attribNums: [], chars: 35},
      {attribNums: [1], chars: 1},
    ]);
  });
});

describe('extractSelection', () => {
  it('returns null for an empty selection', () => {
    const doc = makeDoc(['abc']);
    assert.equal(f.extractSelection(doc, [0, 1], [0, 1]), null);
  });

  it('treats part of one line as inline text, without list markup', () => {
    const doc = makeDoc([{text: 'hello world', list: 'bullet2', spans: [[6, 11, {bold: 'true'}]]}]);
    // Columns count the line marker, so "world" is [7, 12).
    const model = f.extractSelection(doc, [0, 7], [0, 12]);
    assert.equal(model.inline, true);
    assert.equal(f.render('tabs-markers', model), 'world');
    assert.equal(f.render('markdown', model), '**world**');
  });

  it('keeps list markup when a whole line is selected', () => {
    const doc = makeDoc([{text: 'hello', list: 'bullet2'}]);
    const model = f.extractSelection(doc, [0, 1], [0, 6]);
    assert.equal(f.render('markdown', model), '- hello');
  });

  it('ends with a newline when the selection ends at the start of a line', () => {
    const doc = makeDoc([{text: 'a', list: 'bullet1'}, {text: 'b', list: 'bullet2'}, 'c']);
    const model = f.extractSelection(doc, [0, 0], [2, 0]);
    assert.equal(f.render('tabs-markers', model), '- a\n\t- b\n');
  });

  it('numbers items as Etherpad does, counting from the top of the list', () => {
    // Stale `start` attributes (as left by an import) are ignored.
    const doc = makeDoc([
      {text: 'a', list: 'number1', start: 1},
      {text: 'a1', list: 'number2', start: 1},
      {text: 'a2', list: 'number2', start: 1},
      {text: 'b', list: 'number1', start: 1},
      {text: 'b1', list: 'number2', start: 1},
      {text: 'bullet', list: 'bullet1'},
      {text: 'c', list: 'number1'},
    ]);
    assert.equal(f.render('tabs-markers', f.extractSelection(doc, [2, 0], [6, 2])),
        '\t2. a2\n2. b\n\t1. b1\n- bullet\n1. c');
  });

  it('numbers items with no start attribute', () => {
    assert.equal(renderAll('tabs-markers', [
      {text: 'x', list: 'number1'},
      {text: 'y', list: 'number1'},
    ]), '1. x\n2. y');
  });
});

describe('tabs', () => {
  it('indents with TABs relative to the shallowest selected level', () => {
    assert.equal(renderAll('tabs', OUTLINE.slice(1, 5)),
        'apple\n\tstep one\n\tstep two\npear');
  });

  it('preserves skipped levels', () => {
    assert.equal(renderAll('tabs', [
      {text: 'a', list: 'bullet1'},
      {text: 'b', list: 'bullet3'},
    ]), 'a\n\t\tb');
  });

  it('adds markers in tabs-markers', () => {
    assert.equal(renderAll('tabs-markers', OUTLINE),
        '- Fruit\n\t- apple\n\t\t1. step one\n\t\t2. step two\n\t- pear\n- Veg');
  });

  it('leaves non-list lines alone', () => {
    assert.equal(renderAll('tabs', ['intro', {text: 'a', list: 'indent2'}, '', 'end']),
        'intro\na\n\nend');
  });
});

describe('markdown', () => {
  it('nests items under their parent text', () => {
    assert.equal(renderAll('markdown', OUTLINE),
        '- Fruit\n  - apple\n    1. step one\n    2. step two\n  - pear\n- Veg');
  });

  it('indents under wide numbers', () => {
    const doc = makeDoc([
      ...Array.from({length: 9}, (_, i) => ({text: `n${i}`, list: 'number1'})),
      {text: 'ten', list: 'number1'},
      {text: 'sub', list: 'bullet2'},
    ]);
    assert.equal(f.render('markdown', f.extractSelection(doc, [9, 0], [10, 4])),
        '10. ten\n    - sub');
  });

  it('closes up skipped levels', () => {
    assert.equal(renderAll('markdown', [
      {text: 'a', list: 'bullet1'},
      {text: 'b', list: 'bullet3'},
      {text: 'c', list: 'bullet1'},
    ]), '- a\n  - b\n- c');
  });

  it('separates lists from paragraphs', () => {
    assert.equal(renderAll('markdown', ['before', {text: 'a', list: 'bullet1'}, 'after']),
        'before\n\n- a\n\nafter');
  });

  it('escapes markup characters but not URLs or intraword underscores', () => {
    assert.equal(renderAll('markdown', ['*x* [y] snake_case _z_ http://a.b/c_d']),
        '\\*x\\* \\[y\\] snake_case \\_z\\_ http://a.b/c_d');
    assert.equal(renderAll('markdown', ['# not a heading']), '\\# not a heading');
  });

  it('renders formatting, keeping spans nested and spaces outside', () => {
    assert.equal(renderAll('markdown', [{text: 'a bold both italic', spans: [
      [2, 7, {bold: 'true'}],
      [7, 11, {bold: 'true', italic: 'true'}],
      [11, 18, {italic: 'true'}],
    ]}]), 'a **bold** **_both_** _italic_');
  });

  it('renders headings, links, and code blocks', () => {
    assert.equal(renderAll('markdown', [
      {text: 'Title', heading: 'h2'},
      {text: 'site', spans: [[0, 4, {hyperlink: 'https://x.org/'}]]},
      {text: 'let a;', heading: 'code'},
    ]), '## Title\nsite'.replace('site', '[site](<https://x.org/>)') + '\n\n```\nlet a;\n```');
  });
});

describe('org', () => {
  it('renders lists, headings, and emphasis', () => {
    assert.equal(renderAll('org', [
      {text: 'Top', heading: 'h1'},
      ...OUTLINE.slice(0, 3),
      {text: 'b i', list: 'bullet1', spans: [[0, 1, {bold: 'true'}], [2, 3, {italic: 'true'}]]},
    ]), '* Top\n- Fruit\n  - apple\n    1. step one\n- *b* /i/');
  });

  it('keeps paragraph lines from becoming headings', () => {
    assert.equal(renderAll('org', ['* star']), ' * star');
  });
});

describe('asciidoc', () => {
  it('uses repeated markers for depth', () => {
    assert.equal(renderAll('asciidoc', ['intro', ...OUTLINE]),
        'intro\n\n* Fruit\n** apple\n... step one\n... step two\n** pear\n* Veg');
  });
});

describe('rst', () => {
  it('separates nested lists with blank lines', () => {
    assert.equal(renderAll('rst', OUTLINE.slice(0, 3)),
        '- Fruit\n\n  - apple\n\n    1. step one');
  });

  it('underlines headings', () => {
    assert.equal(renderAll('rst', [{text: 'Title', heading: 'h1'}, 'text']),
        'Title\n=====\n\ntext');
  });
});

describe('mediawiki', () => {
  it('builds prefixes from the ancestors\' list types', () => {
    assert.equal(renderAll('mediawiki', OUTLINE),
        '* Fruit\n** apple\n**# step one\n**# step two\n** pear\n* Veg');
  });
});

describe('latex', () => {
  it('nests environments and escapes specials', () => {
    assert.equal(renderAll('latex', [
      {text: '50% & more', list: 'bullet1'},
      {text: 'x', list: 'number2'},
      {text: 'y', list: 'bullet1'},
    ]), [
      '\\begin{itemize}',
      '  \\item 50\\% \\& more',
      '  \\begin{enumerate}',
      '    \\item x',
      '  \\end{enumerate}',
      '  \\item y',
      '\\end{itemize}',
    ].join('\n'));
  });
});

describe('typst', () => {
  it('renders nested lists, headings, and formatting', () => {
    assert.equal(renderAll('typst', [
      {text: 'Top', heading: 'h2'},
      {text: 'Fruit', list: 'bullet1'},
      {text: 'b u s', list: 'bullet2', spans: [
        [0, 1, {bold: 'true'}], [2, 3, {underline: 'true'}], [4, 5, {strikethrough: 'true'}]]},
      {text: 'one', list: 'number3'},
      {text: 'two', list: 'number3'},
    ]), '== Top\n\n- Fruit\n  - *b* #underline[u] #strike[s]\n    1. one\n    2. two');
  });

  it('escapes markup characters and comment starters, but not URLs', () => {
    assert.equal(renderAll('typst', ['#a $b <c> @d [e] a // b https://x.org/a_b']),
        '\\#a \\$b \\<c> \\@d \\[e\\] a \\// b https://x.org/a_b');
    assert.equal(renderAll('typst', ['- no', '= no', '12. no']), '\\- no\n\\= no\n12\\. no');
  });

  it('renders links', () => {
    assert.equal(renderAll('typst', [{text: 'say "hi"', spans: [[0, 8, {hyperlink: 'https://x.org/"q"'}]]}]),
        '#link("https://x.org/\\"q\\"")[say "hi"]');
  });
});

describe('html', () => {
  it('nests lists inside list items', () => {
    const doc = makeDoc(OUTLINE.slice(0, 3));
    const model = f.extractSelection(doc, ...selectAll(doc));
    assert.equal(f.renderClipboardHtml(model),
        '<ul class="list-bullet1"><li>Fruit<ul class="list-bullet2"><li>apple' +
        '<ol class="list-number3"><li>step one</li></ol></li></ul></li></ul>');
  });

  it('keeps original levels in the clipboard flavor, for pasting into pads', () => {
    const doc = makeDoc([{text: 'deep', list: 'bullet3'}, {text: 'x <y>', list: 'bullet3'}]);
    const model = f.extractSelection(doc, ...selectAll(doc));
    assert.equal(f.renderClipboardHtml(model),
        '<ul class="list-bullet3"><li>deep</li><li>x &lt;y&gt;</li></ul>');
    assert.equal(f.render('html', model),
        '<ul class="list-bullet1">\n  <li>deep</li>\n  <li>x &lt;y&gt;</li>\n</ul>');
  });

  it('starts a new list when the type changes', () => {
    assert.equal(renderAll('html', [{text: 'a', list: 'bullet1'}, {text: 'b', list: 'number1'}]),
        '<ul class="list-bullet1">\n  <li>a</li>\n</ul>\n<ol class="list-number1">\n  <li>b</li>\n</ol>');
  });
});

describe('every format', () => {
  it('handles an empty-text list item and a lone blank line', () => {
    for (const {id} of f.FORMATS) {
      if (id === 'native') continue;
      assert.doesNotThrow(() => renderAll(id, [{text: '', list: 'bullet1'}, '', 'x']), id);
    }
  });
});
