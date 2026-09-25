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

// Server side: adds the format menu to the pad's Settings panel and passes
// the site-wide default format (if any) to the client.
//
// To set the default for users who haven't chosen a format, add this to
// settings.json:
//
//   "ep_org_export": {"defaultFormat": "markdown"}
//
// See the value of FORMATS in static/js/formats.js for a list of all
// available formats.

const formats = require('./static/js/formats');

const getConfig = () => {
  try {
    const mod = require('ep_etherpad-lite/node/utils/Settings');
    return ((mod && mod.default) || mod).ep_org_export || {};
  } catch (err) {
    // Never let a configuration problem keep pads from loading.
    console.error('[ep_org_export] could not read settings; using built-in defaults', err);
    return {};
  }
};

const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

exports.eejsBlockMySettingsDropdowns = (hookName, context) => {
  const options = formats.FORMATS.map(({id, label}) => (
    `<option value="${escapeHtml(id)}" data-l10n-id="ep_org_export.format.${escapeHtml(id)}">` +
    `${escapeHtml(label)}</option>`)).join('');
  context.content += `
    <p class="dropdown-line">
      <label for="ep_org_export-format" data-l10n-id="ep_org_export.settings.format">Copy format:</label>
      <select id="ep_org_export-format">${options}</select>
    </p>`;
};

exports.clientVars = async (hookName, context) => {
  const config = getConfig();
  const defaultFormat = formats.isFormat(config.defaultFormat)
    ? config.defaultFormat : formats.DEFAULT_FORMAT;
  return {ep_org_export: {defaultFormat}};
};
