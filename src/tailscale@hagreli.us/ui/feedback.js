/**
 * Confirmations and failures, in the two surfaces the shell offers a extension
 * with no window of its own: the OSD for transient confirmations, and a
 * notification for failures that need to survive the menu closing.
 */

import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

export class Feedback {
    /**
     * @param {string} iconPath absolute path to the extension's icon directory
     */
    constructor(iconPath) {
        this._iconPath = iconPath;
        this._source = null;
    }

    /**
     * Copies text and confirms it, so the click is never silent.
     *
     * @param {string} text what lands on the clipboard
     * @param {string} description short human label, e.g. the value copied
     */
    copy(text, description) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        this.transient('edit-copy-symbolic', description);
    }

    /**
     * @param {string} iconName symbolic icon name
     * @param {string} label one short line
     */
    transient(iconName, label) {
        Main.osdWindowManager.showOne(
            Main.layoutManager.primaryIndex,
            new Gio.ThemedIcon({name: iconName}),
            label);
    }

    /**
     * @param {string} message what went wrong, in a sentence
     */
    reportFailure(message) {
        const source = this._ensureSource();
        source.addNotification(new MessageTray.Notification({
            source,
            title: 'Tailscale',
            body: message,
            gicon: this._icon(),
            isTransient: false,
        }));
    }

    destroy() {
        this._source?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
        this._source = null;
    }

    _ensureSource() {
        if (this._source)
            return this._source;

        this._source = new MessageTray.Source({
            title: 'Tailscale',
            icon: this._icon(),
        });
        this._source.connect('destroy', () => {
            this._source = null;
        });
        Main.messageTray.add(this._source);
        return this._source;
    }

    _icon() {
        return Gio.icon_new_for_string(`${this._iconPath}/tailscale-symbolic.svg`);
    }
}
