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

// Server side: adds the format menu to the pad's Settings panel, passes
// the site-wide default format (if any) to the client, and adds export URLs
// for the formats.
//
// To set the default for users who haven't chosen a format, add this to
// settings.json:
//
//   "ep_polypaste": {"defaultFormat": "markdown"}
//
// See the value of FORMATS in static/js/formats.js for a list of all
// available formats.

const formats = require('./static/js/formats');
const {renderAtext} = require('./lib/atext');

// Loads an Etherpad server module.
const core = (name) => {
  const mod = require(`ep_etherpad-lite/${name}`);
  return (mod && mod.default) || mod;
};

const getConfig = () => {
  try {
    return core('node/utils/Settings').ep_polypaste || {};
  } catch (err) {
    // Never let a configuration problem keep pads from loading.
    console.error('[ep_polypaste] could not read settings; using built-in defaults', err);
    return {};
  }
};

const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

exports.eejsBlockMySettingsDropdowns = (hookName, context) => {
  const options = formats.formatsFor('copy').map(({id, label}) => (
    `<option value="${escapeHtml(id)}" data-l10n-id="ep_polypaste.format.${escapeHtml(id)}">` +
    `${escapeHtml(label)}</option>`)).join('');
  context.content += `
    <p class="dropdown-line">
      <label for="ep_polypaste-format" data-l10n-id="ep_polypaste.settings.format">Copy→Paste format:</label>
      <select id="ep_polypaste-format">${options}</select>
    </p>`;
};

exports.clientVars = async (hookName, context) => {
  const config = getConfig();
  const defaultFormat = formats.findFormat(config.defaultFormat, 'copy') || formats.DEFAULT_FORMAT;
  return {ep_polypaste: {defaultFormat}};
};

// Export URLs: /p/PAD/export/ep-polypaste-FORMAT (or /p/PAD/REV/export/...)
// downloads the pad in FORMAT, which is a format id or its file extension:
// for instance, ep-polypaste-org, ep-polypaste-markdown, or ep-polypaste-md.
//
// These live alongside Etherpad's own export URLs (/p/PAD/export/txt etc.),
// whose route passes on any type it doesn't know.  The "ep-polypaste-"
// prefix keeps our names from colliding with any Etherpad might add later.
const EXPORT_PREFIX = 'ep-polypaste-';

const exportPad = async (req, res, next) => {
  const {type} = req.params;
  const format = type.startsWith(EXPORT_PREFIX) &&
      formats.findFormat(type.slice(EXPORT_PREFIX.length), 'url');
  if (!format) return next();

  // Check access, validate the revision, and find the pad the way Etherpad's
  // own export route does.
  if (!(await core('node/padaccess')(req, res))) return;
  const rev = req.params.rev === undefined ? null
    : core('node/utils/checkValidRev').checkValidRev(req.params.rev);
  const readOnlyManager = core('node/db/ReadOnlyManager');
  const padManager = core('node/db/PadManager');
  let padId = req.params.pad;
  let readOnlyId = null;
  if (readOnlyManager.isReadOnlyId(padId)) {
    readOnlyId = padId;
    padId = await readOnlyManager.getPadId(readOnlyId);
  }
  if (!padId || !(await padManager.doesPadExist(padId))) return next();

  const pad = await padManager.getPad(padId);
  const atext = rev == null ? pad.atext : await pad.getInternalRevisionAText(rev);
  const text = renderAtext(atext, pad.apool(), format);

  const hookFileName = await core('static/js/pluginfw/hooks').aCallFirst('exportFileName', padId);
  const fileName = hookFileName.length ? hookFileName : readOnlyId || padId;
  res.header('Access-Control-Allow-Origin', '*');
  res.attachment(`${fileName}.${formats.extensionOf(format)}`);
  res.type(`${format === 'html' ? 'text/html' : 'text/plain'}; charset=utf-8`);
  res.send(text);
};

exports.expressCreateServer = (hookName, {app}) => {
  app.get('/p/:pad{/:rev}/export/:type', (req, res, next) => {
    exportPad(req, res, next).catch((err) => {
      console.error(`[ep_polypaste] could not export pad "${req.params.pad}" as ${req.params.type}`,
          err);
      if (res.headersSent) return next(err);
      res.status(500).type('text/plain').send(`Failed to export pad as ${req.params.type}.`);
    });
  });
};
