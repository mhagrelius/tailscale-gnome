/**
 * Exit node selection: route all traffic through one peer, or none.
 */

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {noticeItem} from '../ui/menuItems.js';

export class ExitNodePicker {
    /**
     * @param {object} context {tailscale}
     */
    constructor({tailscale}) {
        this._tailscale = tailscale;

        this.item = new PopupMenu.PopupSubMenuMenuItem('Exit Node', true);
        this.item.icon.icon_name = 'network-vpn-symbolic';

        this._handlers = [
            tailscale.connect('notify::peers', () => this._rebuild()),
            tailscale.connect('notify::exit-node-id', () => this._rebuild()),
            tailscale.connect('notify::allow-lan-access', () => this._rebuild()),
        ];

        this._rebuild();
    }

    destroy() {
        for (const id of this._handlers)
            this._tailscale.disconnect(id);
        this.item.destroy();
    }

    _rebuild() {
        this.item.menu.removeAll();

        const options = this._tailscale.exitNodeOptions;
        const activeId = this._tailscale.exitNodeId;
        const active = this._tailscale.exitNode;

        this.item.label.text = active
            ? `Exit Node — ${active.name}`
            : 'Exit Node';

        if (options.length === 0 && !activeId) {
            // Advertising an exit node is a per-device opt-in, so an empty list
            // is a normal state rather than a failure.
            this.item.menu.addMenuItem(noticeItem(
                'No device on this tailnet offers to be an exit node'));
            return;
        }

        this.item.menu.addMenuItem(this._option('None', '', activeId === ''));

        for (const peer of options) {
            const label = peer.online ? peer.name : `${peer.name} (offline)`;
            this.item.menu.addMenuItem(
                this._option(label, peer.id, peer.id === activeId));
        }

        // The chosen node can drop out of the advertised list, e.g. when it
        // goes offline. Keep it selectable so it can be turned off.
        if (activeId && !options.some(peer => peer.id === activeId)) {
            this.item.menu.addMenuItem(
                this._option(active?.name ?? 'Current exit node', activeId, true));
        }

        this.item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const lan = new PopupMenu.PopupSwitchMenuItem(
            'Allow Local Network Access', this._tailscale.allowLanAccess);
        lan.connect('toggled', (_item, value) => this._tailscale.setAllowLanAccess(value));
        lan.setSensitive(activeId !== '');
        this.item.menu.addMenuItem(lan);
    }

    /**
     * @param {string} label row text
     * @param {string} id stable node ID, '' for none
     * @param {boolean} selected whether this is the active choice
     * @returns {PopupMenu.PopupMenuItem} the row
     */
    _option(label, id, selected) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.setOrnament(selected ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NO_DOT);
        item.connect('activate', () => this._tailscale.setExitNode(id));
        return item;
    }
}
