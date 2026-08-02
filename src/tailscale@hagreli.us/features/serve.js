/**
 * `tailscale serve` and `tailscale funnel`: publish a local port to the tailnet,
 * or to the internet.
 */

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {share, stopSharing} from '../daemon/cli.js';
import {openUri} from '../ui/launcher.js';
import {noticeItem} from '../ui/menuItems.js';
import {PortDialog} from '../ui/portDialog.js';

export class SharePicker {
    /**
     * @param {object} context {tailscale, feedback}
     */
    constructor({tailscale, feedback}) {
        this._tailscale = tailscale;
        this._feedback = feedback;

        this.item = new PopupMenu.PopupSubMenuMenuItem('Shared', true);
        this.item.icon.icon_name = 'network-server-symbolic';

        this._handler = tailscale.connect('notify::shares', () => this._rebuild());
        this._rebuild();
    }

    destroy() {
        this._tailscale.disconnect(this._handler);
        this.item.destroy();
    }

    _rebuild() {
        this.item.menu.removeAll();

        const shares = this._tailscale.shares;
        this.item.label.text = shares.length > 0
            ? `Shared — ${shares.length} ${shares.length === 1 ? 'address' : 'addresses'}`
            : 'Shared';

        if (shares.length === 0) {
            this.item.menu.addMenuItem(
                noticeItem('Nothing is being served from this device'));
        }

        for (const entry of shares)
            this.item.menu.addMenuItem(this._shareRow(entry));

        if (shares.length > 0)
            this.item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const add = new PopupMenu.PopupImageMenuItem(
            'Share a Local Port…', 'list-add-symbolic');
        add.connect('activate', () => this._promptForPort());
        this.item.menu.addMenuItem(add);

        if (shares.length > 0) {
            const stop = new PopupMenu.PopupImageMenuItem(
                'Stop Sharing Everything', 'list-remove-symbolic');
            stop.connect('activate', () => this._stop());
            this.item.menu.addMenuItem(stop);
        }
    }

    /**
     * @param {object} entry a share from the model
     * @returns {PopupMenu.PopupSubMenuMenuItem} the row
     */
    _shareRow(entry) {
        const scope = entry.funnel ? 'public' : 'tailnet';
        // The row is one narrow line, so drop the scheme; the full URL is what
        // the copy and open actions below use.
        const row = new PopupMenu.PopupSubMenuMenuItem(
            `${entry.url.replace(/^https?:\/\//, '')} (${scope})`, true);
        row.icon.icon_name = entry.funnel
            ? 'network-workgroup-symbolic'
            : 'network-server-symbolic';

        row.menu.addMenuItem(noticeItem(`Serving ${entry.target}`));

        const copy = new PopupMenu.PopupImageMenuItem('Copy URL', 'edit-copy-symbolic');
        copy.connect('activate', () => this._feedback.copy(entry.url, entry.url));
        row.menu.addMenuItem(copy);

        const open = new PopupMenu.PopupImageMenuItem(
            'Open in Browser', 'insert-link-symbolic');
        open.connect('activate', () => {
            const result = openUri(entry.url);
            if (!result.ok)
                this._feedback.reportFailure(result.message);
        });
        row.menu.addMenuItem(open);

        return row;
    }

    _promptForPort() {
        const dialog = new PortDialog();
        dialog.connect('confirmed', (_dialog, port, publicToInternet) =>
            this._share(port, publicToInternet));
        dialog.open();
    }

    /**
     * @param {number} port local port to publish
     * @param {boolean} publicToInternet true for Funnel
     */
    async _share(port, publicToInternet) {
        const result = await share(port, publicToInternet);
        if (!result.ok) {
            this._feedback.reportFailure(result.message);
            return;
        }

        this._feedback.transient('network-server-symbolic', `Sharing port ${port}`);
        this._tailscale.refresh();
    }

    async _stop() {
        const result = await stopSharing();
        if (!result.ok) {
            this._feedback.reportFailure(result.message);
            return;
        }

        this._feedback.transient('network-offline-symbolic', 'Stopped sharing');
        this._tailscale.refresh();
    }
}
