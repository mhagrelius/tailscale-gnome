/**
 * The node's own switches: what it accepts from the tailnet, and what it offers.
 */

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export class OptionsPicker {
    /**
     * @param {object} context {tailscale}
     */
    constructor({tailscale}) {
        this._tailscale = tailscale;

        this.item = new PopupMenu.PopupSubMenuMenuItem('Options', true);
        this.item.icon.icon_name = 'emblem-system-symbolic';

        this._switches = [
            this._addSwitch('Use Tailscale DNS', 'accept-dns',
                () => tailscale.acceptDns, value => tailscale.setAcceptDns(value)),
            this._addSwitch('Accept Subnet Routes', 'accept-routes',
                () => tailscale.acceptRoutes, value => tailscale.setAcceptRoutes(value)),
            this._addSwitch('Block Incoming Connections', 'shields-up',
                () => tailscale.shieldsUp, value => tailscale.setShieldsUp(value)),
            this._addSwitch('Allow Tailscale SSH to This Device', 'run-ssh',
                () => tailscale.runSsh, value => tailscale.setRunSsh(value)),
        ];
    }

    destroy() {
        for (const {handler} of this._switches)
            this._tailscale.disconnect(handler);
        this.item.destroy();
    }

    /**
     * @param {string} label switch text
     * @param {string} property model property that mirrors it
     * @param {function(): boolean} read current value
     * @param {function(boolean): void} write requested value
     * @returns {object} the switch and its signal handler id
     */
    _addSwitch(label, property, read, write) {
        const item = new PopupMenu.PopupSwitchMenuItem(label, read());
        this.item.menu.addMenuItem(item);

        // The daemon is the source of truth: a refused change comes back as a
        // notify that puts the switch where it really is.
        let syncing = false;
        item.connect('toggled', (_item, value) => {
            if (!syncing)
                write(value);
        });

        const handler = this._tailscale.connect(`notify::${property}`, () => {
            syncing = true;
            item.setToggleState(read());
            syncing = false;
        });

        return {item, handler};
    }
}
