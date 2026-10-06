// This file is part of https://code.librehq.com/kfogel/ep_polypaste.
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

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {describe, it, before, after} = require('node:test');
const f = require('../static/js/formats');
const cli = require('../lib/ep-export');
const {docFromAtext, renderAtext} = require('../lib/atext');
const {makeDoc} = require('./helpers');

// A real .etherpad export (trimmed to the pad record and one revision
// record), made by Etherpad 2.x with ep_headings2 installed.
const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.etherpad'), 'utf8');

const SAMPLE_MARKDOWN = `\
# Shopping notes
Some **bold** and _italic_ text, see the site.

- Fruit
  - apple
    1. step one
    2. step two
  - pear
- Veg

## Code

\`\`\`
let x = 1;
\`\`\`

Done\\_ with \\*stars\\*.
`;

// Collects what is written to it, like a minimal writable stream.
const sink = () => ({text: '', write(s) { this.text += s; }});

describe('parsePadUrl', () => {
  it('finds the server and pad', () => {
    assert.deepEqual(cli.parsePadUrl('https://pad.example.org/p/notes'),
        {base: 'https://pad.example.org', padId: 'notes', rev: null, headers: {}});
  });

  it('keeps a base path and decodes the pad name', () => {
    const pad = cli.parsePadUrl('http://example.org:8080/etherpad/p/my%20notes?lang=en#x');
    assert.equal(pad.base, 'http://example.org:8080/etherpad');
    assert.equal(pad.padId, 'my notes');
    assert.equal(pad.rev, null);
  });

  it('takes the revision from a timeslider URL', () => {
    const pad = cli.parsePadUrl('https://example.org/p/notes/timeslider#42');
    assert.equal(pad.padId, 'notes');
    assert.equal(pad.rev, 42);
  });

  it('turns credentials into a header, leaving them out of the base', () => {
    const pad = cli.parsePadUrl('https://me:s%40cret@example.org/p/notes');
    assert.equal(pad.base, 'https://example.org');
    assert.equal(pad.headers.Authorization, `Basic ${Buffer.from('me:s@cret').toString('base64')}`);
  });

  it('rejects URLs that are not pad URLs', () => {
    assert.throws(() => cli.parsePadUrl('notes'), /not a URL/);
    assert.throws(() => cli.parsePadUrl('https://example.org/notes'), /not a pad URL/);
    assert.throws(() => cli.parsePadUrl('ftp://example.org/p/notes'), /not a pad URL/);
  });
});

describe('findFormat', () => {
  it('finds formats by id or alias', () => {
    assert.equal(f.findFormat('markdown', 'cli'), 'markdown');
    assert.equal(f.findFormat('md', 'url'), 'markdown');
    assert.equal(f.findFormat('tex', 'copy'), 'latex');
    assert.equal(f.findFormat('txt-tabs-markers', 'cli'), 'plaintext-tabs-markers-nesting');
    assert.equal(f.findFormat('txt', 'cli'), null);
    assert.equal(f.findFormat('docx', 'cli'), null);
  });

  it('finds the pass-through formats only where they apply', () => {
    assert.equal(f.findFormat('txt-flat', 'copy'), 'plaintext-flat');
    assert.equal(f.findFormat('plaintext-flat', 'cli'), null);
    assert.equal(f.findFormat('plaintext-flat', 'url'), null);
    assert.equal(f.findFormat('txt-etherpad', 'cli'), 'plaintext-etherpad');
    assert.equal(f.findFormat('plaintext-etherpad', 'copy'), null);
    assert.equal(f.findFormat('plaintext-etherpad', 'url'), null);
  });

  it('has no name that means two formats', () => {
    const names = f.FORMATS.flatMap(({id, aliases}) => [id, ...aliases]);
    assert.equal(new Set(names).size, names.length);
  });

  it('gives every format an extension', () => {
    for (const {id} of f.FORMATS) assert.match(f.extensionOf(id), /^[a-z]+$/);
  });
});

describe('formatFromFileName', () => {
  it('maps extensions to formats', () => {
    assert.equal(cli.formatFromFileName('a.md'), 'markdown');
    assert.equal(cli.formatFromFileName('a.markdown'), 'markdown');
    assert.equal(cli.formatFromFileName('dir.x/A.ORG'), 'org');
    assert.equal(cli.formatFromFileName('a.tex'), 'latex');
    assert.equal(cli.formatFromFileName('a.htm'), 'html');
  });

  it('infers nothing from .txt or unknown extensions', () => {
    assert.equal(cli.formatFromFileName('a.txt'), null);
    assert.equal(cli.formatFromFileName('a.doc'), null);
    assert.equal(cli.formatFromFileName('README'), null);
  });
});

describe('docFromAtext', () => {
  const {atext, pool} = cli.atextFromExport(SAMPLE);
  const doc = docFromAtext(atext, pool);

  it('makes one line per line of text, without the final newline', () => {
    assert.equal(doc.lineCount, 12);
    assert.equal(doc.getLine(1).text, 'Some bold and italic text, see the site.');
    assert.equal(doc.getLine(11).text, '');
  });

  it('marks lines that start with a line marker', () => {
    assert.deepEqual([...Array(doc.lineCount).keys()].map((i) => doc.getLine(i).lineMarker),
        [1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
  });

  it('splits attribute ops that span several lines', () => {
    // The last op in the sample covers the last three lines.
    assert.equal(doc.getLine(10).aline, '*0|1+k');
    assert.equal(doc.getLine(11).aline, '*0|1+1');
  });

  it('renders like a pad', () => {
    assert.equal(renderAtext(atext, pool, 'markdown'), SAMPLE_MARKDOWN);
  });

  it('does not take a revision record for the pad record', () => {
    const data = JSON.parse(SAMPLE);
    delete data['pad:cli-test'];
    assert.throws(() => cli.atextFromExport(JSON.stringify(data)), /no pad text/);
  });

  it('complains when the server sends something else', () => {
    assert.throws(() => cli.atextFromExport('<html>Log in</html>'), /did not send a pad export/);
  });
});

describe('extractDocument', () => {
  it('drops blank lines at the end and ends with a newline', () => {
    const doc = makeDoc([{text: 'a', list: 'bullet1'}, '', 'b', '', '']);
    assert.equal(f.render('plaintext-tabs-markers-nesting', f.extractDocument(doc)), '- a\n\nb\n');
  });

  it('renders a one-line document as a whole line', () => {
    const doc = makeDoc([{text: 'a', list: 'bullet1'}]);
    assert.equal(f.render('markdown', f.extractDocument(doc)), '- a\n');
  });

  it('returns null for a blank document', () => {
    assert.equal(f.extractDocument(makeDoc(['', ''])), null);
    assert.equal(f.extractDocument({lineCount: 0, getLine: () => null, pool: {}}), null);
  });
});

describe('run', () => {
  const realFetch = globalThis.fetch;
  const requested = [];
  let dir;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-export-test-'));
    globalThis.fetch = async (url) => {
      requested.push(url);
      if (url.includes('/p/missing/')) {
        return new Response('Not found', {status: 404, statusText: 'Not Found'});
      }
      if (url.endsWith('/export/etherpad')) return new Response(SAMPLE);
      return new Response('Etherpad text\n');
    };
  });

  after(() => {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, {recursive: true, force: true});
  });

  it('writes the chosen format to standard output', async () => {
    const out = sink();
    await cli.run(['-t', 'markdown', '-o', '-', 'https://example.org/p/cli-test'], out);
    assert.equal(out.text, SAMPLE_MARKDOWN);
    const out2 = sink();
    await cli.run(['-t', 'md', '-o', '-', 'https://example.org/p/cli-test'], out2);
    assert.equal(out2.text, SAMPLE_MARKDOWN);
    assert.equal(requested.pop(), 'https://example.org/p/cli-test/export/etherpad');
  });

  it('saves Etherpad\'s own text export for plaintext-etherpad', async () => {
    const out = sink();
    await cli.run(['--to=txt-etherpad', '-r', '7', '-o', '-', 'https://example.org/p/cli-test'], out);
    assert.equal(out.text, 'Etherpad text\n');
    assert.equal(requested.pop(), 'https://example.org/p/cli-test/7/export/txt');
  });

  it('guesses the format from the output file, and will not overwrite it', async () => {
    const file = path.join(dir, 'notes.md');
    await cli.run(['-o', file, 'https://example.org/p/cli-test']);
    assert.equal(fs.readFileSync(file, 'utf8'), SAMPLE_MARKDOWN);
    await assert.rejects(cli.run(['-o', file, 'https://example.org/p/cli-test']), /already exists/);
    await cli.run(['-f', '-t', 'txt-tabs', '-o', file, 'https://example.org/p/cli-test']);
    assert.match(fs.readFileSync(file, 'utf8'), /^Shopping notes\n/);
  });

  it('names the output file after the pad by default', async () => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await cli.run(['-t', 'org', 'https://example.org/p/cli-test']);
    } finally {
      process.chdir(cwd);
    }
    assert.match(fs.readFileSync(path.join(dir, 'cli-test.org'), 'utf8'), /^\* Shopping notes\n/);
  });

  it('reports HTTP errors', async () => {
    await assert.rejects(cli.run(['-o', '-', 'https://example.org/p/missing']),
        /404 Not Found \(no such pad\?\)/);
  });

  it('lists the formats and their aliases, without plaintext-flat', async () => {
    const out = sink();
    await cli.run(['--list-formats'], out);
    assert.match(out.text, /^ {2}plaintext-tabs-nesting, txt-tabs +Plain text, TAB-indented$/m);
    assert.match(out.text, /^ {2}markdown, md +Markdown$/m);
    assert.match(out.text, /^ {2}plaintext-etherpad, txt-etherpad +Etherpad's own plain-text export/m);
    assert.doesNotMatch(out.text, /plaintext-flat/);
  });

  it('rejects bad usage', async () => {
    await assert.rejects(cli.run([]), /exactly one pad URL/);
    await assert.rejects(cli.run(['-t', 'docx', 'https://example.org/p/a']), /unknown format "docx"/);
    await assert.rejects(cli.run(['-r', 'x', 'https://example.org/p/a']), /not a revision number/);
    await assert.rejects(cli.run(['--bogus', 'https://example.org/p/a']), /bogus/);
  });
});
