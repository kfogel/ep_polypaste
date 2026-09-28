# ep_polypaste

Etherpad plugin to enable layout-respecting client-side
copy-and-paste, with the user able to choose from a menu of output
formats (e.g., plain text, Markdown, Org Mode, Typst, Asciidoc,
reStructuredText, MediaWiki syntax, LaTeX, HTML).

ep_polypaste is free and open source software, under the [Apache-2.0
License](LICENSE.md).

## What problem does this solve?

Copying from an Etherpad and pasting into a plain-text destination
(such as a file, an editor buffer, or a browser `<textarea>`) normally
just pastes the words without any of the list nesting structure --
lists get flattened.

With this plugin installed on the Etherpad server, pasting using
Ctrl-C (or Ctrl-X, or the Copy/Cut menu items) preserves formatting.

It works by storing two versions of the selection on the clipboard:

* **text/plain**: Whichever format the user picked in the pad's
  Settings panel (say, Markdown, or Org Mode, or whatever).  Pasting
  into a plain-text destination use this.

* **text/html**: HTML with properly nested lists.  Pasting into a
  rich-text destination (e.g., word processors, many email composers,
  and Etherpad itself) use this, so copying from one etherpad to
  another still preserves all the formatting.

## Supported Paste Formats

In Etherpad, under **`Settings → Copy format`**, the user picks a
paste format -- as of this writing, one of the choices below:

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

Valid values: `tabs`, `tabs-markers`, `markdown`, `org`, `asciidoc`,
`rst`, `mediawiki`, `latex`, `typst`, `html`, `native`.

## Development

The conversion code, in `static/js/formats.js`, has no dependencies on the
browser or on Etherpad, and has unit tests:

```
  npm test
```

The hook for the Etherpad editor's copy and cut events is in
`static/js/index.js`, and `index.js` is what adds the menu to the
`Settings` panel and tells the site's default to the browser.

## Contribution

Patches welcome.

## Author's Note

I built this with LLM assistance; see the 
[session transcripts](.llm/llm-session-transcripts.txt) for details.


