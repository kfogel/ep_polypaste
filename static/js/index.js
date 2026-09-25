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

// Client side: replaces what the browser puts on the clipboard when the user
// copies or cuts text from the pad, so that list nesting survives the trip.
//
// Browsers build the clipboard's text from the pad's DOM, in which every line
// is a separate <div> and list nesting exists only as a CSS class, so the
// nesting is lost.  Instead, we build the clipboard contents from Etherpad's
// document model:
//
//   * text/plain: The format the user chose in Settings (TAB-indented text,
//                 Markdown, Org Mode, etc).  This is what plain-text
//                 destinations such as terminals, text editors, and
//                 <textarea>s paste.
// 
//   * text/html:  Properly nested HTML lists; this is what rich-text
//                 targets (word processors, email composers, Etherpad
//                 itself) paste.

const formats = require('./formats');

const STORAGE_KEY = 'ep_org_export.format';
const SELECT_ID = 'ep_org_export-format';

// Set from the server's settings.json when the pad loads.
let serverDefault = formats.DEFAULT_FORMAT;

const getFormat = () => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (formats.isFormat(stored)) return stored;
  } catch (err) { /* storage unavailable */ }
  return serverDefault;
};

const setFormat = (id) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch (err) { /* storage unavailable */ }
};

// Adapts Etherpad's rep to the document interface formats.js expects.
const docFromRep = (rep) => ({
  lineCount: rep.lines.length(),
  getLine: (i) => {
    const entry = rep.lines.atIndex(i);
    return {text: entry.text, lineMarker: entry.lineMarker || 0, aline: rep.alines[i]};
  },
  pool: rep.apool,
});

const handleCopyOrCut = (evt, ace, isCut, readOnly) => {
  const format = getFormat();
  if (format === 'native' || !evt.clipboardData) return;

  let model = null;
  let range = null;
  try {
    // The `true` makes Etherpad first bring rep (including its idea of the
    // selection) up to date with the DOM.
    ace.callWithAce((editor) => {
      const rep = editor.ace_getRep();
      if (!rep.selStart || !rep.selEnd) return;
      model = formats.extractSelection(docFromRep(rep), rep.selStart, rep.selEnd);
      range = [rep.selStart.slice(), rep.selEnd.slice()];
    }, 'ep_org_export_copy', true);
  } catch (err) {
    console.error('[ep_org_export] could not read the selection; using browser default', err);
    return;
  }
  if (!model) return;

  let text, html;
  try {
    text = formats.render(format, model);
    html = formats.renderClipboardHtml(model);
  } catch (err) {
    console.error('[ep_org_export] could not convert the selection; using browser default', err);
    return;
  }
  evt.clipboardData.setData('text/plain', text);
  evt.clipboardData.setData('text/html', html);
  evt.preventDefault();

  // Having prevented the default action, we must do the "cut" part ourselves.
  if (isCut && !readOnly) {
    ace.callWithAce((editor) => {
      const [start, end] = range;
      editor.ace_performDocumentReplaceRange(start, end, '');
      editor.ace_performSelectionChange(start, start, false);
      editor.ace_updateBrowserSelectionFromRep();
      // Deleting may have split or joined numbered lists.
      if (editor.ace_renumberList(start[0] + 1) == null) editor.ace_renumberList(start[0]);
    }, 'ep_org_export_cut', true);
  }
};

const setUpSettingsMenu = () => {
  const $ = window.$;
  const $select = $ && $(`#${SELECT_ID}`);
  if (!$select || !$select.length) return;
  $select.val(getFormat());
  if ($select.niceSelect) $select.niceSelect('update');
  $select.on('change', () => {
    const id = $select.val();
    if (formats.isFormat(id)) setFormat(id);
  });
};

exports.postAceInit = (hookName, {ace, clientVars}) => {
  const cv = (clientVars && clientVars.ep_org_export) || {};
  if (formats.isFormat(cv.defaultFormat)) serverDefault = cv.defaultFormat;
  const readOnly = !!(clientVars && clientVars.readonly);

  setUpSettingsMenu();

  const outer = document.querySelector('iframe[name="ace_outer"]');
  const inner = outer && outer.contentDocument.querySelector('iframe[name="ace_inner"]');
  if (!inner) {
    console.error('[ep_org_export] editor iframe not found; copy/paste conversion disabled');
    return;
  }
  const innerDoc = inner.contentDocument;
  innerDoc.addEventListener('copy', (evt) => handleCopyOrCut(evt, ace, false, readOnly));
  innerDoc.addEventListener('cut', (evt) => handleCopyOrCut(evt, ace, true, readOnly));
};
