**Title:** Settings dropdowns (Font type, Language, …) never show their options when the browser prefers reduced motion

### Describe the bug

With `prefers-reduced-motion: reduce` in effect, no dropdown in the Settings
popup (colibris skin) can be used.  Clicking one flips its arrow to the
"open" state, but the list of options never appears, so the value can't be
changed.  This affects the core "Font type" and "Language" menus and any
dropdown a plugin adds to the `mySettings.dropdowns` block.

Many Linux desktops report reduced motion to the browser when desktop
animations are turned off, so users can hit this without ever having
knowingly asked for reduced motion.

### To Reproduce

1. Make the browser report reduced motion, using either of these:
   - **Chromium/Chrome:** DevTools → ⋮ → More tools → Rendering →
     "Emulate CSS media feature prefers-reduced-motion" → `reduce`
     (keep DevTools open for the following steps).
   - **Firefox:** `about:config` → set `ui.prefersReducedMotion` to `1`
     (Number).
   - Or turn off animations / turn on "reduce motion" in the OS settings.
2. Open any pad with the default colibris skin.
3. Click the gear icon to open Settings.
4. Click the "Font type" dropdown.

**Expected:** The list of fonts appears below the dropdown.

**Actual:** The dropdown's arrow flips to the open state, but no list appears.
The list does get the `open` class; it's just positioned off-screen (see below).

Repeat step 1 with "no preference" (or `ui.prefersReducedMotion` = `0`) and
the list appears as expected.

Automated reproduction with Puppeteer (`npm install puppeteer`, then
`node repro.mjs https://<your-etherpad>/p/<any-pad>`):

```js
import puppeteer from 'puppeteer';

const padUrl = process.argv[2];
const browser = await puppeteer.launch({headless: 'shell'});
for (const motion of ['no-preference', 'reduce']) {
  const page = await browser.newPage();
  await page.setViewport({width: 1400, height: 900});
  await page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: motion}]);
  await page.goto(padUrl, {waitUntil: 'networkidle2'});
  await page.waitForSelector('iframe[name="ace_outer"]');
  await new Promise((r) => setTimeout(r, 2000));
  await page.click('.buttonicon-settings');           // open Settings
  await new Promise((r) => setTimeout(r, 800));
  await page.click('#viewfontmenu + .nice-select');    // open "Font type"
  await new Promise((r) => setTimeout(r, 600));
  const result = await page.evaluate(() => {
    const list = document.querySelector('#viewfontmenu + .nice-select .list');
    const r = list.getBoundingClientRect();
    return {
      popupTransform: getComputedStyle(document.querySelector('#settings > .popup-content')).transform,
      listLeft: Math.round(r.left), listTop: Math.round(r.top),
      viewport: `${innerWidth}x${innerHeight}`,
      listOnScreen: r.left < innerWidth && r.top < innerHeight,
    };
  });
  console.log(motion.padEnd(14), JSON.stringify(result));
  await page.close();
}
await browser.close();
```

Output:

```
no-preference  {"popupTransform":"none","listLeft":1136,"listTop":450,"viewport":"1400x900","listOnScreen":true}
reduce         {"popupTransform":"matrix(1, 0, 0, 1, 0, 0)","listLeft":2123,"listTop":502,"viewport":"1400x900","listOnScreen":false}
```

### Cause

`src/static/skins/colibris/src/components/popup.css` has:

```css
@media (prefers-reduced-motion) {
  .popup>.popup-content {
    transform: scale(1);
    transition: none;
  }
  ...
}
```

`scale(1)` doesn't change how the popup looks, but any `transform` other than
`none` makes the element the
[containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/Containing_block#identifying_the_containing_block)
for its `position: fixed` descendants.

Since #7696, dropdown lists inside popups use `position: fixed` (see
`form.css`), and `src/static/js/vendors/nice-select.ts` sets their `left`/`top`
from `getBoundingClientRect()`, i.e. relative to the viewport.  With the
transform in place, those coordinates are measured from `.popup-content`'s
corner instead, so the popup's own offset from the viewport gets added again.
The list ends up that far down and to the right, typically outside the window
and clipped by the popup's scroll container.

With no motion preference the rule doesn't apply, `.popup-content`'s transform
is `none` (the `scale(0.7)` in `css/pad/popup.css` is on the hidden `.popup`
itself and is removed by `.popup-show`), so the lists are positioned correctly.

### Suggested fix

Use `none` in place of the identity transform:

```diff
 @media (prefers-reduced-motion) {
   .popup>.popup-content {
-    transform: scale(1);
+    transform: none;
     transition: none;
   }
```

I tested this by injecting the override into the page from the Puppeteer script
above.  With `transform: none`, the reduced-motion run matches the
no-preference run exactly (`listLeft: 1136, listTop: 450, listOnScreen: true`).

(The `.nice-select .list` rule in the same media query also uses
`scale(1) translateY(0px)`, but it's on the list itself, not an ancestor, so it
doesn't affect this bug.)

### Environment

- Etherpad version: <!-- TODO: fill in from the admin page / package.json -->
- Skin: colibris (default)
- Browsers: Chromium 154.0.8037.57 and Firefox 140.16.0esr on Debian
  forky/sid (x86_64); also reproduced with Puppeteer's headless Chromium
  154.0.8037.57.
- The same `popup.css` rule is present on the `develop` branch as of 2026-09-28.
