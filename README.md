# ep_polypaste (Etherpad plugin) / ep-export (CLI-based export tool)

Paste or export Etherpads to your choice of format: nested plain text,
Markdown, Org Mode, Typst, Asciidoc, reStructuredText, MediaWiki
syntax, LaTeX, HTML.

There are two independent but similar tools here:

* `ep_polypaste` is a server-side Etherpad plugin that enables
  browsers to copy and paste while preserving the formatting +
  nesting from the pad, with the user choosing the output (paste)
  format;

* `ep-export` is a command-line export tool that likewise respects
  formatting + nesting, and allows choice of output format.

ep_polypaste and ep-export are free and open source software, under
the [Apache-2.0 License](LICENSE.md).

A guide to the reader: most of this README explains `ep_polypaste`,
and then toward the end it covers the very similar `ep-export`.

## What problem does `ep_polypaste` solve?

Copying from an Etherpad and pasting into a plain-text destination
(such as a file, an editor buffer, or a browser `<textarea>`) normally
just pastes the words without any of the list nesting structure --
lists get flattened.

With this plugin installed on the Etherpad server, copying using
Ctrl-C (or Ctrl-X, or the Copy/Cut menu items) and then pasting
preserves formatting.

It works by storing two versions of the selection on the clipboard:

* **text/plain**: Whichever format the user picked in the pad's
  Settings panel (say, Markdown, or Org Mode, or whatever).  Pasting
  into a plain-text destination use this.

* **text/html**: HTML with properly nested lists.  Pasting into a
  rich-text destination (e.g., word processors, many email composers,
  and Etherpad itself) use this, so copying from one etherpad to
  another still preserves all the formatting.

## Supported Paste Formats

In Etherpad, under **`Settings`→`Copy→Paste format`**, the user picks
a paste format -- as of this writing, one of the choices below:

<div style="margin-left: 40px;">

| Format | Example |
| :--- | :--- |
| Plain text, TAB-indented | `Fruit` / `⇥apple` / `⇥⇥step one` |
| Plain text, TAB-indented, with bullets/numbers&emsp;&emsp; | `- Fruit` / `⇥- apple` / `⇥⇥1. step one` |
| Markdown | `- Fruit` / `  - apple` / `    1. step one` |
| Org Mode | `- Fruit` / `  - apple` / `    1. step one` |
| AsciiDoc | `* Fruit` / `** apple` / `... step one` |
| reStructuredText | nested `-` / `1.` lists, blank lines between levels |
| MediaWiki | `* Fruit` / `** apple` / `**# step one` |
| LaTeX | nested `itemize` / `enumerate` environments |
| Typst | `- Fruit` / `  - apple` / `    1. step one` |
| HTML source | nested `<ul>` / `<ol>` markup |
| Browser default | the plugin stays out of the way |

</div>

Notes:

* TABs indent relative to the shallowest list level *in the
  selection*, so copying a level-3 subtree produces level-1 subtree.
  Skipped levels are preserved (but markup formats collapse skipped
  levels, since those formats can't express them).

* Etherpad's bullet-less indentation (what you get from hitting Tab on
  a plain line) is rendered as indented text in the TAB formats and in
  Org Mode, as `:` in MediaWiki, as `\item[]` in LaTeX, and as a
  bulleted item in the others (since the others have no unbulleted
  nesting).

* Headings (from
  [ep_headings2](https://www.npmjs.com/package/ep_headings2)), code
  lines, bold, italic, underline, strikethrough, and links (from
  [ep_hyperlinked_text](https://www.npmjs.com/package/ep_hyperlinked_text))
  are rendered in each format's own syntax to the extent possible.

* Numbered items are numbered the way Etherpad counts them, even if the
  selection starts in the middle of a list.

* When the selection is part of a single line, the paste is just that
  text, with no list markers (but with character formatting
  preserved).

* Search for `FORMATS` in [static/js/formats.js](static/js/formats.js)
  to see an up-to-date list of all supported formats.

## Tips and limitations

* Rich-text destinations (Google Docs, LibreOffice, Gmail, etc.)
  always paste the HTML version by default.  To paste your chosen
  non-HTML format in that situation, do a "paste as plain text" (often
  Ctrl-Shift-V).

* On X11 and Wayland, selecting text and middle-click-pasting uses the
  "primary selection", which never passes through the page's copy
  event; thus middle-click pasting just gets the browser's flattened
  text.  Solution: paste with Ctrl-C.

## Installation

As the Etherpad server administrator, run this from the Etherpad
directory:

```
  pnpm run plugins i --path /path/to/ep_polypaste
```

then restart Etherpad.  Restart Etherpad after upgrading the plugin,
as the client code is bundled at startup.

## Configuration

Users who haven't picked a format normally get the TAB-indented format
by default.  To change this default, add this to Etherpad's
`settings.json`:

```
  "ep_polypaste": {
    "defaultFormat": "markdown"
  }
```

Valid values, with short aliases in parentheses:

* `plaintext-tabs-nesting` (`txt-tabs`)
* `plaintext-tabs-markers-nesting` (`txt-tabs-markers`)
* `org`
* `markdown` (`md`)
* `typst` (`typ`)
* `latex` (`tex`)
* `asciidoc` (`adoc`)
* `rst`
* `mediawiki` (`wiki`)
* `html`
* `plaintext-flat` (`txt-flat`): the browser's default copying, which
  flattens list nesting.  The plugin stays out of the way.

The same names and aliases work in the export URLs and in `ep-export`
(both described below), except that `plaintext-flat` only makes sense
in the browser.  `ep-export` has one format of its own,
`plaintext-etherpad` (`txt-etherpad`).

## Export URLs

With the plugin installed, the server also offers each format for
export at a URL similar to Etherpad's own export URLs (such as
`/p/PAD/export/txt`):

```
  https://pad.example.org/p/meeting-notes/export/ep-polypaste-org
  https://pad.example.org/p/meeting-notes/export/ep-polypaste-md
  https://pad.example.org/p/meeting-notes/42/export/ep-polypaste-latex
```

(The third example above names revision 42 of the pad.)

The response is a download of the whole pad (named, e.g.,
`meeting-notes.org`), with the same access rules as Etherpad's own
exports; read-only pad IDs work too.  Note that there is no
`ep-polypaste-plaintext-etherpad`, since that would be the same as
the `/export/txt` that Etherpad already offers.

We use the `ep-polypaste-` prefix to keep these names from colliding
with new export types that upstream Etherpad might add in the future.

## Command-line export tool: `ep-export`

This package also includes `ep-export`, a command-line tool that saves
a whole pad locally in any of the formats above, using the same
conversion code as the plugin:

```
  ep-export -t org https://pad.example.org/p/meeting-notes
  ep-export -o notes.md https://pad.example.org/p/meeting-notes
  ep-export -t md -o - https://pad.example.org/p/meeting-notes | less
```

The first command writes `meeting-notes.org` in the current directory.
The second guesses the format from the output file's extension.  The
third writes to stdout.  Run `ep-export --help` for all the options,
and `ep-export --list-formats` for the formats.  Some details:

* The `plaintext-etherpad` format (alias `txt-etherpad`) is
  Etherpad's own plain-text export (the pad's **Import/Export → Plain
  text** download), saved without conversion.

* `-r N` (or a timeslider URL ending in `#N`) saves revision N of the
  pad instead of the latest.

* `ep-export` won't overwrite an existing file unless given `-f`.

* For LaTeX and HTML, the output is the document body, not a complete
  document: there's no `\documentclass` or `<html>` wrapper.

* Blank lines at the end of the pad are left out.

The plugin does *not* need to be installed on the Etherpad server for
`ep-export` to work: `ep-export` downloads the pad from the same
export URL that the pad's own **Import/Export → Etherpad** link would
use (which gives the pad's full text with its formatting attributes)
and does the conversion locally.  So this will works with any recent
Etherpad server (it has been tested with Etherpad 3.3), on any pad you
can open in a browser without logging in, or on pads behind HTTP Basic
authentication if you include the user name and password in the URL
(`https://user:password@pad.example.org/p/...`).  Note that it can't
follow a login page or use a browser session, so it can't export pads
that need those.  The server must also allow exports, of course.

To install `ep-export` (Node.js 18 or later is needed):

```
  npm install -g /path/to/ep_polypaste
```

or run `/path/to/ep_polypaste/bin/ep-export` directly.

### How `ep-export` differs from `etherpad-cli`

The Etherpad project's
[etherpad-cli](https://github.com/ether/etherpad-cli) (command name
`etherpad-pp-cli`) is a general client for Etherpad's HTTP API.  It
has dozens of commands for administering a server: creating and
deleting pads, managing authors, groups, and sessions, reading chat
history, and getting or setting a pad's contents as raw text or as
HTML.  It needs an API token, which normally only the server's
administrators have.

By contrast, `ep-export` does just one thing: it saves a pad as a
file, in a format chosen from the list above, and keeps the pad's list
nesting, headings, and other formatting.  It needs no API token nor
any other special access.  The pad's URL is enough.

## Development

The conversion code, in `static/js/formats.js`, has no dependencies on the
browser or on Etherpad, and has unit tests:

```
  npm test
```

The hook for the Etherpad editor's copy and cut events is in
`static/js/index.js`.  On the server, `index.js` adds the menu to the
`Settings` panel, tells the site's default to the browser, and serves
the export URLs.

`lib/atext.js` adapts a whole pad, as Etherpad stores it, to the
document interface that `formats.js` uses (the same interface the
browser code provides for the selection).  The export URLs and
`ep-export` both use it.

The `ep-export` command is in `lib/ep-export.js`; all it adds is
downloading the pad and handling options.  Its tests use a real
`.etherpad` export in `test/fixtures/` and don't need a server.

## Contribution

Patches welcome.

## Author's Note

I built this with LLM assistance; see the 
[session transcripts](.llm/llm-session-transcripts.txt) for details.
