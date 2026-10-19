# Archaic Sidebar

Arc-style browsing for Chrome: a sidebar with Favorites, pinned tabs (with folders) and Today
tabs, a floating launcher, auto-archive for idle tabs, and keyboard shortcuts.

Requires Chrome 141+.

## Install

```sh
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick
`dist/`. Click the toolbar icon to open the sidebar.

For development, run `npm run dev`: it rebuilds on save and the extension reloads itself
within a second (dev builds only). Reloading closes the side panel, so reopen it after.

## Using it

- **Favorites / Pinned**: drag a Today tab into either to pin it. Closing a pinned tab keeps the
  entry; clicking it reopens. If you browse away, ↺ takes you back to the pinned URL.
- **Multi-select**: click a tab, then Shift-click another to select the range (Cmd/Ctrl-click
  toggles single items). Right-click the selection to pin, favorite, move to a folder, unpin,
  copy URLs, archive, or close them all at once. Escape clears it.
- **Set pinned URL**: right-click an open pin that you've browsed away from → "Set pinned URL to
  this page" makes the current page its new home.
- **Rename**: double-click any item (or right-click → Rename). Names only show in the sidebar and
  launcher.
- **Folders**: right-click the pinned area → New folder, or use "+ Folder" in the footer.
  Right-click a folder → Change icon… to give it one of ~60 Arc-style icons.
- **Profile label**: click "Name this profile" at the top of the sidebar to label it ("Work",
  "Personal"). Each profile keeps its own; it's never exported.
- **Color**: ◐ in the sidebar footer picks a preset or custom color.
- **Archive**: unpinned tabs idle for 12h (configurable) are closed and kept for 30 days.
  Tabs playing audio are skipped.
- **Launcher**: the "Open launcher" shortcut (assign it at `chrome://extensions/shortcuts`)
  floats a search box over the page you're on; with nothing typed it lists recent tabs and pages.
  Ctrl+N/P (or arrows) moves the selection. Cmd+T and "+ New Tab" open Chrome's New Tab page.

## Shortcuts

Vim-style sidebar navigation ships bound:

| Key | Action |
| --- | --- |
| Ctrl+J / Ctrl+K | Move down / up the sidebar. Open tabs are switched to; folders and closed pins get a cursor outline instead. |
| Ctrl+L | On a folder: expand it and step inside. On a closed pin: open it. |
| Ctrl+H | Inside a folder: collapse it and step out. On an open folder: collapse it. |

These four are bound automatically when the extension is installed in a profile. Everything
else (toggle sidebar, launcher overlay, copy URL / Markdown link / title / clean URL, pin,
rename, reset, archive, reopen archived, duplicate) is assigned at
`chrome://extensions/shortcuts`; Settings has a button that opens it. Chrome keeps shortcuts
per profile, so set them up in each one.

## Data

Everything is stored locally, per profile. Settings → Backup exports whichever parts you tick
(pinned & favorites, sidebar color, archive settings, archive). Import replaces only
the parts the file contains.

## Development

```sh
npm test          # vitest
npm run typecheck # tsc
```
