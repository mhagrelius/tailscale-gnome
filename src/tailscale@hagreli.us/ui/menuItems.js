import Pango from 'gi://Pango';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/**
 * A row that explains rather than acts: empty states, status lines, hints.
 *
 * These are written as sentences, so they wrap instead of ellipsizing — a
 * truncated explanation is worse than none.
 *
 * @param {string} text the explanation
 * @returns {PopupMenu.PopupMenuItem} a non-interactive row
 */
export function noticeItem(text) {
    const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
    item.label.add_style_class_name('tailscale-notice');
    item.label.clutter_text.set({
        lineWrap: true,
        ellipsize: Pango.EllipsizeMode.NONE,
    });
    return item;
}
