/**
 * The tailnet device list: one expandable row per peer, whose actions copy the
 * peer's addresses or open a session to it.
 */

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {localUserName, sshCommand} from '../daemon/cli.js';
import {openUri, runInTerminal} from '../ui/launcher.js';
import {noticeItem} from '../ui/menuItems.js';

/** Devices beyond this are omitted; the admin console is the place for a big tailnet. */
const MAX_ROWS = 40;

export class DeviceList {
    /**
     * @param {object} context {tailscale, settings, feedback}
     */
    constructor({tailscale, settings, feedback}) {
        this._tailscale = tailscale;
        this._settings = settings;
        this._feedback = feedback;

        this.section = new PopupMenu.PopupMenuSection();

        this._handlers = [
            tailscale.connect('notify::peers', () => this._rebuild()),
            tailscale.connect('notify::self-node', () => this._rebuild()),
        ];
        this._settingsHandler = settings.connect(
            'changed::show-offline-devices', () => this._rebuild());

        this._rebuild();
    }

    destroy() {
        for (const id of this._handlers)
            this._tailscale.disconnect(id);
        this._settings.disconnect(this._settingsHandler);
        this.section.destroy();
    }

    _rebuild() {
        this.section.removeAll();

        if (!this._tailscale.reachable) {
            this._addNotice('Tailscale is not running');
            return;
        }

        const showOffline = this._settings.get_boolean('show-offline-devices');
        const peers = this._tailscale.peers.filter(peer => showOffline || peer.online);

        const self = this._tailscale.selfNode;
        if (self)
            this.section.addMenuItem(this._deviceRow(self, true));

        if (peers.length === 0) {
            this._addNotice(showOffline
                ? 'No other devices on this tailnet'
                : 'No other devices online');
            return;
        }

        for (const peer of peers.slice(0, MAX_ROWS))
            this.section.addMenuItem(this._deviceRow(peer, false));

        const hidden = peers.length - MAX_ROWS;
        if (hidden > 0)
            this._addNotice(`and ${hidden} more`);
    }

    /**
     * @param {string} text an explanation, not an action
     */
    _addNotice(text) {
        this.section.addMenuItem(noticeItem(text));
    }

    /**
     * @param {object} peer a normalized peer
     * @param {boolean} isSelf whether this row is this device
     * @returns {PopupMenu.PopupSubMenuMenuItem} the row
     */
    _deviceRow(peer, isSelf) {
        const label = isSelf ? `${peer.name} (this device)` : peer.name;
        const row = new PopupMenu.PopupSubMenuMenuItem(label, true);
        row.icon.icon_name = deviceIcon(peer);

        if (!peer.online) {
            row.label.add_style_class_name('tailscale-offline');
            row.icon.add_style_class_name('tailscale-offline');
        }
        if (peer.isExitNode)
            row.label.text = `${label} — exit node`;

        this._addCopyActions(row.menu, peer);

        if (peer.url) {
            row.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const open = new PopupMenu.PopupImageMenuItem(
                'Open in Browser', 'insert-link-symbolic');
            open.connect('activate', () => this._report(openUri(peer.url)));
            open.setSensitive(peer.online);
            row.menu.addMenuItem(open);
        }

        if (!isSelf) {
            const ssh = new PopupMenu.PopupImageMenuItem(
                'Open SSH Session', 'utilities-terminal-symbolic');
            ssh.connect('activate', () => this._openSsh(peer));
            ssh.setSensitive(peer.online);
            row.menu.addMenuItem(ssh);
        }

        if (!peer.online)
            row.menu.addMenuItem(noticeItem('Offline — addresses can still be copied'));

        return row;
    }

    /**
     * @param {PopupMenu.PopupSubMenu} menu the peer's submenu
     * @param {object} peer a normalized peer
     */
    _addCopyActions(menu, peer) {
        const entries = [
            ['Copy IP Address', peer.ipv4],
            ['Copy MagicDNS Name', peer.fqdn],
            ['Copy URL', peer.url],
        ];

        for (const [label, value] of entries) {
            if (!value)
                continue;

            const item = new PopupMenu.PopupImageMenuItem(label, 'edit-copy-symbolic');
            item.connect('activate', () => this._feedback.copy(value, value));
            menu.addMenuItem(item);
        }
    }

    /**
     * @param {object} peer a normalized peer
     */
    _openSsh(peer) {
        const configured = this._settings.get_string('ssh-user').trim();
        const user = configured || localUserName();
        const command = sshCommand(peer, user);
        const terminal = this._settings.get_string('terminal-command');

        this._report(runInTerminal(command, terminal));
    }

    /**
     * @param {{ok: boolean, message?: string}} result outcome of a launch
     */
    _report(result) {
        if (!result.ok)
            this._feedback.reportFailure(result.message);
    }
}

/**
 * @param {object} peer a normalized peer
 * @returns {string} a symbolic icon name that exists in the Adwaita theme
 */
function deviceIcon(peer) {
    if (!peer.online)
        return 'network-offline-symbolic';

    switch (peer.os) {
    case 'iOS':
    case 'android':
        return 'phone-symbolic';
    case 'linux':
    case 'windows':
    case 'macOS':
        return 'computer-symbolic';
    default:
        return 'network-workgroup-symbolic';
    }
}
