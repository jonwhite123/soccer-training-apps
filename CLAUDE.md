# Soccer Training Apps

Small, single-purpose apps that help soccer players train. Two kinds:

- **Classroom**: offline learning on a laptop, projector or phone (quizzes, scenarios, tactics boards). Usually no audio.
- **Live session**: runs on a phone at the field and gives audio cues (beeps plus spoken calls) that players react to in real time.

Targets: desktop Chrome/Safari and **iPhone Safari**. Design and check for the phone first.

## Non-negotiables

- **One app = one self-contained `.html` file in `apps/`** (kebab-case name). Everything is inline: CSS, JS, images (inline SVG or `data:` URIs). Sounds are synthesized with Web Audio, not audio files.
- **No network, ever.** No CDN scripts, web fonts, analytics, `fetch`/XHR or external asset URLs. The phone may have no signal at the field.
- **Must run from `file://`** as well as https. That rules out `<script type="module" src>`/`import`, service workers inside an app, `fetch` of sibling files, and anything else that needs a server. Use classic inline `<script>`.
- No build step to *run* an app. `scripts/sync-shared.mjs` is only a dev-time copy step.
- Keep each file small (a few hundred KB at most) so it moves easily between devices.

## Shared code (`shared/`)

`shared/base.css` (tokens, layout, buttons, form controls, the `.session`/`.cue` screen) and `shared/kit.js` (`window.Kit`) are copied into every page between markers:

```
/* SHARED:kit.js BEGIN — ... */
...
/* SHARED:kit.js END */
```

- Edit `shared/*`, never the inlined copy, then run `node scripts/sync-shared.mjs` to update every page. `--check` exits 1 if any copy is stale.
- App-specific CSS and JS go in their own `<style>`/`<script>` after the shared block.
- Move code into the kit only once a second app needs it.

`Kit` API (options are documented in `shared/kit.js`):

- `Kit.unlock()`: call inside the Start tap handler. iOS needs it before any sound or speech.
- `Kit.beep({freq, ms, volume, type, delay})`, `Kit.beeps(n, opts)`: synthesized tones scheduled on the audio clock.
- `Kit.speak(text, opts)` returns a Promise; `Kit.hush()` stops speech. Uses the voice and speed saved in Sound check.
- `Kit.keepAwake(on)` returns a Promise of a boolean: the screen wake lock, re-acquired when the page is visible again.
- `Kit.run(drill)` returns `{ stop(), done }`. Inside `drill(signal)`, use `await Kit.sleep(ms, signal)` so Stop exits at once.
- `Kit.rand`, `Kit.randInt`, `Kit.pick`, `Kit.shuffle`, `Kit.store.get/set` (namespaced localStorage that never throws; key app data by app name) and `Kit.support()`.

## Live-session apps

- Start from a big tap target whose handler calls `Kit.unlock()` and `Kit.keepAwake()` synchronously, before any `await`.
- Every cue is both audible and visible: a beep, then speech, plus the cue text full-screen (`.cue`). Beep first because speech can lag a beat, especially the first time.
- A Stop button is always on screen. Stopping cancels timers and speech (`Kit.run` does both) and releases the wake lock.
- Page JS stops when the screen locks or Safari goes to the background. If `keepAwake()` resolves `false`, tell the user to set Auto-Lock to Never.
- Persist settings (timings, cue lists) with `Kit.store` so a coach sets them once.

## UI conventions

- Mobile-first: works at 375px wide with no horizontal scroll; content max-width 640px.
- Tap targets at least 48px; primary actions use `.big` (full width, 80px tall). No hover-only interactions.
- High contrast, readable at arm's length outdoors. System font stack only. Light and dark come from the `prefers-color-scheme` tokens in `base.css`.
- Text in inputs is at least 16px, or iOS zooms in on focus.

## Adding an app

1. `cp template/app-template.html apps/<name>.html`. Set `<title>`, the meta description, the `<h1>` and `STORE_KEY`.
2. Replace the placeholder drill, or delete the session screen for a classroom app.
3. Add the app to `index.html` and to the table in `README.md`.
4. Run `node scripts/sync-shared.mjs --check`.
5. Verify it (below).

## Verifying

- Open the file through `file://` in the browser pane at the mobile preset (375×812) and at desktop size. Check for no console errors, no horizontal scroll, a working Start and Stop, and that Stop returns to setup.
- Audio can't be heard from here. Check that calls don't throw and the flow advances; real sound gets checked on the phone with `apps/sound-check.html`.
- Say plainly what has not been checked on a real iPhone.
