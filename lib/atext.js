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

// Renders a whole pad, given its attributed text ("atext": the text
// plus attributes, as Etherpad stores it) and attribute pool.  Used
// by the server's export URLs (index.js) and by the ep-export command
// (ep-export.js), which get the atext from Etherpad's database and from
// a .etherpad export, respectively.

const formats = require('../static/js/formats');

const OP_RE = /((?:\*[0-9a-z]+)*)(?:\|([0-9a-z]+))?[-+=]([0-9a-z]+)/g;

// Adapts an atext ({text, attribs}) and its attribute pool to the
// document interface formats.js expects.
const docFromAtext = ({text, attribs}, pool) => {
  // Split the attributes into one attribute string per line, as
  // Etherpad's splitAttributionLines() does.
  const alines = [];
  let aline = '';
  let pos = 0;
  const append = (attrs, chars, newline) => {
    aline += `${attrs}${newline ? '|1' : ''}+${chars.toString(36)}`;
    if (newline) {
      alines.push(aline);
      aline = '';
    }
    pos += chars;
  };
  for (const m of attribs.matchAll(OP_RE)) {
    let chars = parseInt(m[3], 36);
    let newlines = m[2] ? parseInt(m[2], 36) : 0;
    for (; newlines > 1; newlines--) {
      const len = text.indexOf('\n', pos) + 1 - pos;
      append(m[1], len, true);
      chars -= len;
    }
    append(m[1], chars, newlines === 1);
  }
  if (aline) alines.push(aline);

  const hasLineMarker = (a) => (/^(?:\*[0-9a-z]+)*/.exec(a)[0].match(/[0-9a-z]+/g) || [])
      .some((n) => (pool.numToAttrib[parseInt(n, 36)] || [])[0] === 'lmkr');
  const texts = text.split('\n');
  if (texts[texts.length - 1] === '') texts.pop(); // the final newline
  const lines = texts.map((t, i) => ({
    text: t,
    aline: alines[i] || '',
    lineMarker: t[0] === '*' && hasLineMarker(alines[i] || '') ? 1 : 0,
  }));
  return {lineCount: lines.length, getLine: (i) => lines[i], pool};
};

// Returns the whole pad rendered in format `format`.
const renderAtext = (atext, pool, format) => {
  const model = formats.extractDocument(docFromAtext(atext, pool));
  return model ? formats.render(format, model) : '';
};

module.exports = {docFromAtext, renderAtext};
