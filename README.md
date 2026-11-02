# Soccer Training Apps

Small training apps for soccer players. Each app is one self-contained HTML file. There's nothing to install, no server, and no internet needed once it's open.

- **Classroom apps** are for learning on a laptop, projector or phone.
- **Live-session apps** run on a phone at the field and call out cues (beeps and spoken words) for players to react to.

## Apps

| App | Type | What it does |
| --- | --- | --- |
| [Look Up and Pass](apps/look-up-and-pass.html) | Live session | Calls a direction for your first touch after you play the ball off a wall, then which coloured cone to pass to (2 to 4 stations) |
| [Sound check](apps/sound-check.html) | Utility | Tests beeps, the voice and screen-awake on a device before a live session |

## Running the apps

### Laptop or desktop

Double-click any file in `apps/`, or `index.html` for the list. They work in Chrome, Safari, Edge and Firefox.

### iPhone

Copying a single HTML file to an iPhone doesn't work well on its own. Safari can't open files from the Files app, and the Files preview generally doesn't run JavaScript, so the page appears but its buttons do nothing. Two ways around that:

1. **Host the files (recommended).** Publish this folder with GitHub Pages, open the app's link in Safari, then choose Share → Add to Home Screen. The app still runs entirely on the phone; the internet is only needed to load it. Until offline caching is added, open it before you get to the field and leave it open.
2. **Use a local-file viewer app.** Some App Store apps open local HTML files with JavaScript turned on, which lets a copied file run with no internet at all. Run Sound check in one first, because audio and screen-awake support varies by app.

### Before a live session

1. Open Sound check on the phone and make sure you can hear the beeps and the voice.
2. Turn the volume up. On iOS 16 or earlier, also set the ring/silent switch to ring.
3. Keep the app on screen. Phones pause web pages when the screen locks or you switch apps. The apps ask the screen to stay on; if Sound check says that isn't supported, set Auto-Lock to Never for the session.
4. Outdoors, a Bluetooth speaker helps a lot.

## Working on the apps

- `apps/`: the apps, one file each
- `template/app-template.html`: the starting point for a new app
- `shared/base.css` and `shared/kit.js`: shared styles and helpers, copied into every page
- `scripts/sync-shared.mjs`: re-copies `shared/` into every page after you edit it (`node scripts/sync-shared.mjs`; add `--check` to only check)

Conventions are in [CLAUDE.md](CLAUDE.md).
