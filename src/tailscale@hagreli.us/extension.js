/**
 * Tailscale in the Quick Settings panel.
 */

import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Tailscale} from './daemon/tailscale.js';
import {Feedback} from './ui/feedback.js';
import {TailscaleIndicator} from './ui/indicator.js';

export default class TailscaleExtension extends Extension {
    enable() {
        const iconPath = `${this.path}/icons`;

        this._tailscale = new Tailscale();
        this._feedback = new Feedback(iconPath);
        this._settings = this.getSettings();

        this._failedHandler = this._tailscale.connect('failed',
            (_model, message) => this._feedback.reportFailure(message));

        this._indicator = new TailscaleIndicator({
            tailscale: this._tailscale,
            settings: this._settings,
            feedback: this._feedback,
            icon: Gio.icon_new_for_string(`${iconPath}/tailscale-symbolic.svg`),
            openPreferences: () => this.openPreferences(),
        });

        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._tailscale.disconnect(this._failedHandler);
        this._failedHandler = null;

        this._indicator.destroy();
        this._indicator = null;

        this._tailscale.destroy();
        this._tailscale = null;

        this._feedback.destroy();
        this._feedback = null;

        this._settings = null;
    }
}
