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

// The ep-export command: saves an Etherpad pad, given its URL, in one
// of the formats the plugin offers for copying.
//
// It downloads the pad's ".etherpad" export, which contains the pad's
// attributed text (the text plus attributes that the editor itself
// works with), and renders that with atext.js.  This needs no API key
// and nothing installed on the server.
//
// The "native" format is instead Etherpad's own plain-text export,
// saved as is.

const fs = require('node:fs');
const path = require('node:path');
const {parseArgs} = require('node:util');
const formats = require('../static/js/formats');
const {renderAtext} = require('./atext');

const USAGE = `\
Usage: ep-export [OPTIONS] PAD_URL

Save an Etherpad pad in a text-based format.

Options:
  -t, --to FORMAT      Output format (see --list-formats), or its file
                       extension (such as "md" for Markdown).  If not
                       given, it is guessed from the output file's
                       extension, or else is "${formats.DEFAULT_FORMAT}".
  -o, --output FILE    Write to FILE ("-" for standard output).  By
                       default, writes to the pad's name plus an
                       extension for the format, in the current directory.
  -r, --rev N          Save revision N of the pad instead of the latest.
                       (A timeslider URL ending in "#N" does the same.)
  -f, --force          Overwrite the output file if it exists.
  -l, --list-formats   List the output formats.
  -h, --help           Show this help.
`;

// Other extensions that imply a format.
const MORE_EXTENSIONS = {
  markdown: 'markdown', htm: 'html', latex: 'latex', asciidoc: 'asciidoc', mediawiki: 'mediawiki',
};

// Labels that read differently outside the browser.
const LABELS = {native: 'Etherpad\'s own plain-text export (no conversion)'};

class UsageError extends Error {}

// Returns the format implied by a file name's extension, or null.
// ".txt" implies nothing, since several formats use it.
const formatFromFileName = (name) => {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!ext) return null;
  return formats.FORMATS.some((f) => f.ext === ext) ? formats.findFormat(ext)
    : MORE_EXTENSIONS[ext] || null;
};

// Parses a pad URL such as https://pad.example.org/p/notes into
// {base, padId, rev, headers}.  `base` is the server's root URL,
// which can include a path (for servers behind a proxy at
// https://example.org/etherpad/).  Trailing parts such as
// "/timeslider" are allowed, and a timeslider URL's "#N" gives `rev`.
// A user name and password in the URL become a Basic authorization
// header.
const parsePadUrl = (str) => {
  let url;
  try {
    url = new URL(str);
  } catch (err) {
    throw new UsageError(`not a URL: ${str}`);
  }
  const m = /^(.*?)\/p\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!/^https?:$/.test(url.protocol) || !m) {
    throw new UsageError(`not a pad URL (expected something like https://example.org/p/PAD): ${str}`);
  }
  const headers = {};
  if (url.username || url.password) {
    const creds = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    headers.Authorization = `Basic ${Buffer.from(creds).toString('base64')}`;
  }
  const rev = m[3] === '/timeslider' && /^#[0-9]+$/.test(url.hash) ? Number(url.hash.slice(1)) : null;
  return {base: `${url.origin}${m[1]}`, padId: decodeURIComponent(m[2]), rev, headers};
};

const exportUrl = (pad, type) => `${pad.base}/p/${encodeURIComponent(pad.padId)}` +
    `${pad.rev != null ? `/${pad.rev}` : ''}/export/${type}`;

// Downloads one of Etherpad's own exports of the pad.
const fetchExport = async (pad, type) => {
  const url = exportUrl(pad, type);
  let res;
  try {
    res = await fetch(url, {headers: pad.headers});
  } catch (err) {
    throw new Error(`could not reach ${url}: ${(err.cause && err.cause.message) || err.message}`);
  }
  if (!res.ok) {
    const hint = {401: ' (a login is required)', 403: ' (access denied)', 404: ' (no such pad?)'};
    throw new Error(`${url}: ${res.status} ${res.statusText}${hint[res.status] || ''}`);
  }
  return res.text();
};

// Returns {atext, pool} from the text of a .etherpad export.
const atextFromExport = (json) => {
  let data;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error('the server did not send a pad export (does it require a login?)');
  }
  // Revision records keep their text under `meta`, so the only record
  // with `atext` at the top is the pad's own.
  const record = Object.values(data || {}).find((v) => v && v.atext && v.pool);
  if (!record) throw new Error('the pad export has no pad text in it');
  return {atext: record.atext, pool: record.pool};
};

// Returns the pad's text in format `format`.
const exportPad = async (pad, format) => {
  if (format === 'native') return fetchExport(pad, 'txt');
  const {atext, pool} = atextFromExport(await fetchExport(pad, 'etherpad'));
  return renderAtext(atext, pool, format);
};

const listFormats = () => formats.FORMATS
    .map(({id, label}) => `  ${id.padEnd(14)}${LABELS[id] || label}\n`).join('');

// Runs the command with the given arguments (not including the
// program name), writing to `out` as needed.
const run = async (argv, out = process.stdout) => {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'to': {type: 'string', short: 't'},
        'output': {type: 'string', short: 'o'},
        'rev': {type: 'string', short: 'r'},
        'force': {type: 'boolean', short: 'f'},
        'list-formats': {type: 'boolean', short: 'l'},
        'help': {type: 'boolean', short: 'h'},
      },
    });
  } catch (err) {
    throw new UsageError(err.message);
  }
  const {values: opts, positionals} = args;
  if (opts.help) return out.write(USAGE);
  if (opts['list-formats']) return out.write(listFormats());
  if (positionals.length !== 1) throw new UsageError('expected exactly one pad URL');

  const pad = parsePadUrl(positionals[0]);
  if (opts.rev != null) {
    if (!/^[0-9]+$/.test(opts.rev)) throw new UsageError(`not a revision number: ${opts.rev}`);
    pad.rev = Number(opts.rev);
  }
  const format = opts.to ? formats.findFormat(opts.to)
    : (opts.output && opts.output !== '-' && formatFromFileName(opts.output)) ||
      formats.DEFAULT_FORMAT;
  if (!format) {
    throw new UsageError(`unknown format "${opts.to}"; one of these is needed:\n${listFormats()}`);
  }
  const file = opts.output ||
      `${pad.padId.replace(/[/\\\0]/g, '_')}.${formats.extensionOf(format)}`;

  const text = await exportPad(pad, format);
  if (file === '-') return out.write(text);
  try {
    fs.writeFileSync(file, text, {flag: opts.force ? 'w' : 'wx'});
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`${file} already exists (use --force to overwrite it)`);
    throw err;
  }
};

const main = () => {
  run(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`ep-export: ${err.message}\n`);
    if (err instanceof UsageError) process.stderr.write('Try "ep-export --help".\n');
    process.exitCode = err instanceof UsageError ? 2 : 1;
  });
};

module.exports = {
  main,
  run,
  // For tests.
  parsePadUrl,
  formatFromFileName,
  atextFromExport,
};
