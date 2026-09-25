'use strict';

// Builds fake Etherpad documents for the tests.
//
// Each line is either a string or {text, list, start, heading, spans}, where
// spans is [[from, to, {bold: 'true', ...}], ...] over the text (not counting
// any line marker).

const makeDoc = (specs) => {
  const numToAttrib = [];
  const num = (k, v) => {
    let i = numToAttrib.findIndex(([kk, vv]) => kk === k && vv === v);
    if (i < 0) i = numToAttrib.push([k, v]) - 1;
    return i.toString(36);
  };
  const attribStr = (attrs) => Object.entries(attrs).map(([k, v]) => `*${num(k, String(v))}`).join('');
  const lines = specs.map((spec) => {
    if (typeof spec === 'string') spec = {text: spec};
    const lineAttrs = {};
    if (spec.list) lineAttrs.list = spec.list;
    if (spec.start) lineAttrs.start = spec.start;
    if (spec.heading) lineAttrs.heading = spec.heading;
    const marker = Object.keys(lineAttrs).length ? 1 : 0;
    let aline = marker ? `${attribStr({...lineAttrs, lmkr: 1})}+1` : '';
    let pos = 0;
    for (const [from, to, attrs] of spec.spans || []) {
      if (from > pos) aline += `+${(from - pos).toString(36)}`;
      aline += `${attribStr(attrs)}+${(to - from).toString(36)}`;
      pos = to;
    }
    if (spec.text.length > pos) aline += `+${(spec.text.length - pos).toString(36)}`;
    aline += '|1+1';
    return {text: (marker ? '*' : '') + spec.text, lineMarker: marker, aline};
  });
  return {lineCount: lines.length, getLine: (i) => lines[i], pool: {numToAttrib}};
};

// Selects all of the given document (like Ctrl-A).
const selectAll = (doc) => [[0, 0], [doc.lineCount - 1, doc.getLine(doc.lineCount - 1).text.length]];

module.exports = {makeDoc, selectAll};
