// SPDX-License-Identifier: GPL-2.0-or-later
//
// Shows the titles of each workspace's first windows below its thumbnail in
// the overview, and makes the thumbnails bigger to leave room for them.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ThumbnailsBox} from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

// Height of the overview's workspace thumbnails, as a fraction of the screen
// (GNOME's come to about 0.04). The titles below them come on top of that.
const THUMBNAIL_SCALE = 0.08;

// Lines below each thumbnail: the titles of that many of the workspace's
// oldest windows, oldest first.
const THUMBNAIL_LINES = 2;

// Some windows retitle themselves several times per second (shell prompts,
// progress spinners); batch the updates.
const UPDATE_DELAY_MS = 300;

export default class WorkspaceThumbnailTitles extends Extension {
    enable() {
        this._windows = new Set();
        this._thumbnailBoxes = new Map(); // box -> its scale before ours
        this._thumbnailLabels = new Map(); // thumbnail -> its lines of titles
        this._updateId = 0;

        global.display.connectObject('window-created',
            (display, win) => this._watchWindow(win), this);
        for (const actor of global.get_window_actors())
            this._watchWindow(actor.meta_window);

        // The overview creates its thumbnails each time it opens. Each one gets
        // lines of titles, placed below it once the box has laid the
        // thumbnails out.
        this._injections = new InjectionManager();
        const extension = this;
        this._injections.overrideMethod(ThumbnailsBox.prototype, 'addThumbnails',
            addThumbnails => function (start, count) {
                addThumbnails.call(this, start, count);
                extension._decorateThumbnails(this,
                    this._thumbnails.slice(this._thumbnails.length - count));
            });
        this._injections.overrideMethod(ThumbnailsBox.prototype, 'vfunc_allocate',
            allocate => function (box) {
                allocate.call(this, box);
                extension._centerThumbnails(this);
                for (const thumbnail of this._thumbnails)
                    extension._allocateThumbnailLabel(thumbnail);
            });

        if (Main.overview.visible) {
            for (const box of this._findThumbnailBoxes(Main.layoutManager.overviewGroup))
                this._decorateThumbnails(box, box._thumbnails);
        }
    }

    disable() {
        if (this._updateId) {
            GLib.source_remove(this._updateId);
            this._updateId = 0;
        }

        global.display.disconnectObject(this);
        for (const win of this._windows)
            win.disconnectObject(this);
        this._windows = null;

        this._injections.clear();
        this._injections = null;

        for (const label of [...this._thumbnailLabels.values()])
            label.destroy();
        this._thumbnailLabels = null;

        for (const [box, scale] of this._thumbnailBoxes) {
            box.disconnectObject(this);
            box._maxThumbnailScale = scale;
            box.queue_relayout();
        }
        this._thumbnailBoxes = null;
    }

    _watchWindow(win) {
        if (this._windows.has(win))
            return;

        this._windows.add(win);
        win.connectObject(
            'notify::title', () => this._queueUpdate(),
            'workspace-changed', () => this._queueUpdate(),
            'unmanaged', () => {
                win.disconnectObject(this);
                this._windows.delete(win);
                this._queueUpdate();
            },
            this);
        this._queueUpdate();
    }

    _queueUpdate() {
        // Thumbnails, and so titles to update, only exist while the overview
        // is open.
        if (this._updateId || this._thumbnailLabels.size === 0)
            return;

        this._updateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, UPDATE_DELAY_MS, () => {
            this._updateId = 0;
            this._syncThumbnailLabels();
            return GLib.SOURCE_REMOVE;
        });
    }

    _findThumbnailBoxes(actor, boxes = []) {
        if (actor instanceof ThumbnailsBox)
            boxes.push(actor);
        else
            actor.get_children().forEach(child => this._findThumbnailBoxes(child, boxes));
        return boxes;
    }

    _decorateThumbnails(box, thumbnails) {
        this._enlargeThumbnails(box);
        for (const thumbnail of thumbnails)
            this._addThumbnailLabel(box, thumbnail);
        this._syncThumbnailLabels();
    }

    _enlargeThumbnails(box) {
        if (!this._thumbnailBoxes.has(box)) {
            this._thumbnailBoxes.set(box, box._maxThumbnailScale);
            box.connectObject(
                'style-changed', () => this._enlargeThumbnails(box),
                'destroy', () => this._thumbnailBoxes.delete(box),
                this);
        }

        // GNOME caps the whole box at this fraction of the screen and fits
        // the thumbnails in what its padding leaves. The padding holds the
        // titles and grows with the text size, so add it to the cap rather
        // than let it squeeze the thumbnails.
        const node = box.get_theme_node();
        const padding = node.get_vertical_padding() +
            node.get_border_width(St.Side.TOP) + node.get_border_width(St.Side.BOTTOM);
        box._maxThumbnailScale = THUMBNAIL_SCALE + padding / box._porthole.height;
        box.queue_relayout();
    }

    _addThumbnailLabel(box, thumbnail) {
        if (this._thumbnailLabels.has(thumbnail))
            return;

        const label = new St.Widget({
            style_class: 'workspace-thumbnail-titles',
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
        });
        for (let i = 0; i < THUMBNAIL_LINES; i++)
            label.add_child(new St.Label());
        box.add_child(label);

        thumbnail.connectObject('destroy', () => label.destroy(), label);
        label.connect('destroy', () => this._thumbnailLabels.delete(thumbnail));
        this._thumbnailLabels.set(thumbnail, label);
    }

    // GNOME centers the thumbnails assuming the box got all the width it asked
    // for. When they don't fit on screen it gets less, and they would spill
    // off the right edge, so center what was actually laid out instead.
    _centerThumbnails(box) {
        const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
        const extents = box._thumbnails.map(thumbnail => {
            // A thumbnail collapsing away keeps its full size until it is
            // destroyed, but the next one already moves into its place.
            const {x1, x2} = thumbnail.get_allocation_box();
            const width = (x2 - x1) * (1 - thumbnail.collapse_fraction);
            return rtl ? {x1: x2 - width, x2} : {x1, x2: x1 + width};
        });
        if (box._dropPlaceholderPos !== -1)
            extents.push(box._dropPlaceholder.get_allocation_box());
        if (extents.length === 0)
            return;

        const left = Math.min(...extents.map(extent => extent.x1));
        const right = Math.max(...extents.map(extent => extent.x2));
        const content = box.get_theme_node().get_content_box(box.get_allocation_box());
        const dx = Math.round((content.x1 + content.x2 - left - right) / 2);
        if (dx === 0)
            return;

        for (const child of box.get_children()) {
            const {x1, y1, x2, y2} = child.get_allocation_box();
            child.allocate(new Clutter.ActorBox({x1: x1 + dx, y1, x2: x2 + dx, y2}));
        }
    }

    _allocateThumbnailLabel(thumbnail) {
        const label = this._thumbnailLabels.get(thumbnail);
        if (!label)
            return;

        const {x1, x2, y2} = thumbnail.get_allocation_box();
        const [, height] = label.get_preferred_height(x2 - x1);
        label.allocate(new Clutter.ActorBox({x1, x2, y1: y2, y2: y2 + height}));

        // Follow the thumbnail as it fades in or out when workspaces change.
        label.opacity = thumbnail.opacity;
    }

    _syncThumbnailLabels() {
        const workspaceManager = global.workspace_manager;
        const workspaces = [];
        for (let i = 0; i < workspaceManager.n_workspaces; i++)
            workspaces.push(workspaceManager.get_workspace_by_index(i));

        for (const [thumbnail, label] of this._thumbnailLabels) {
            // A removed workspace's thumbnail keeps its titles while it slides out.
            if (!workspaces.includes(thumbnail.metaWorkspace))
                continue;

            const titles = thumbnail.metaWorkspace.list_windows()
                .filter(win => this._isRegularWindow(win))
                .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence())
                .map(win => win.get_title()?.replace(/\s+/g, ' ').trim() ?? '');
            label.get_children().forEach((line, i) => (line.text = titles[i] ?? ''));
        }
    }

    _isRegularWindow(win) {
        return win.get_window_type() === Meta.WindowType.NORMAL &&
            !win.is_skip_taskbar() && !win.is_on_all_workspaces();
    }
}
