/**
 * Asks which local port to share, and whether to publish it beyond the tailnet.
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {CheckBox} from 'resource:///org/gnome/shell/ui/checkBox.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const MIN_PORT = 1;
const MAX_PORT = 65535;

export const PortDialog = GObject.registerClass({
    Signals: {
        // port, publicToInternet
        'confirmed': {param_types: [GObject.TYPE_INT, GObject.TYPE_BOOLEAN]},
    },
}, class PortDialog extends ModalDialog.ModalDialog {
    _init() {
        super._init({styleClass: 'tailscale-port-dialog'});

        const content = new Dialog.MessageDialogContent({
            title: 'Share a Local Port',
            description: 'Tailscale proxies this port over HTTPS at your ' +
                'device’s tailnet address.',
        });
        this.contentLayout.add_child(content);

        this._entry = new St.Entry({
            styleClass: 'tailscale-port-entry',
            hintText: `Port number, ${MIN_PORT}–${MAX_PORT}`,
            canFocus: true,
            xExpand: true,
        });
        this._entry.clutter_text.connect('activate', () => this._confirm());
        this._entry.clutter_text.connect('text-changed', () => this._syncValid());
        content.add_child(this._entry);

        this._funnel = new CheckBox('Also publish on the public internet (Funnel)');
        this._funnel.add_style_class_name('tailscale-funnel-check');
        content.add_child(this._funnel);

        this.addButton({
            label: 'Cancel',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });
        this._shareButton = this.addButton({
            label: 'Share',
            action: () => this._confirm(),
            default: true,
        });

        // addButton focuses the default button; the port is what needs typing.
        this.setInitialKeyFocus(this._entry.clutter_text);

        this._syncValid();
    }

    /**
     * @returns {number|null} the entered port, or null when it is not one
     */
    _port() {
        const text = this._entry.get_text().trim();
        if (!/^\d+$/.test(text))
            return null;

        const port = Number.parseInt(text, 10);
        return port >= MIN_PORT && port <= MAX_PORT ? port : null;
    }

    /** Blocks the action while the port is unusable, rather than reporting it after. */
    _syncValid() {
        const valid = this._port() !== null;

        this._shareButton.reactive = valid;
        this._shareButton.can_focus = valid;
        // St does not derive the pseudo class from `reactive` on its own.
        if (valid)
            this._shareButton.remove_style_pseudo_class('insensitive');
        else
            this._shareButton.add_style_pseudo_class('insensitive');
    }

    _confirm() {
        const port = this._port();
        if (port === null)
            return;

        this.emit('confirmed', port, this._funnel.checked);
        this.close();
    }
});
