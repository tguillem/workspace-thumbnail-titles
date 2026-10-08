# Workspace Thumbnail Titles

A GNOME Shell extension that shows, below each workspace thumbnail in the
overview, the titles of that workspace's first two windows. It also makes the
thumbnails bigger to fit them.

> **AI-generated.**

- One title per line, in the order the windows were opened, so switching
  between windows does not reorder them.
- Dialogs and windows shown on every workspace are ignored.
- The titles follow window title changes while the overview is open.

GNOME shows the thumbnail strip only when there are more than two workspaces
(with dynamic workspaces) or more than one (with a fixed number).

## Requirements

GNOME Shell 48.

## Installing from source

```sh
git clone https://github.com/tguillem/workspace-thumbnail-titles.git
cd workspace-thumbnail-titles
gnome-extensions pack --force
gnome-extensions install --force workspace-thumbnail-titles@tguillem.shell-extension.zip
```

Log out and back in, then enable it:

```sh
gnome-extensions enable workspace-thumbnail-titles@tguillem
```

## Customizing

Two constants at the top of `extension.js` control the layout:

- `THUMBNAIL_SCALE`: thumbnail height as a fraction of the screen. GNOME's
  thumbnails come to about `0.04`.
- `THUMBNAIL_LINES`: how many window titles to show per workspace. With more
  lines, also raise `padding-bottom` in `stylesheet.css`.

## Development

`scripts/test-nested.sh` runs this checkout in a nested GNOME Shell window with
temporary settings, so changes can be tried without logging out. The shell's
output is saved to `nested-shell.log`.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
