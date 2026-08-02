/**
 * Live view of the local Tailscale node.
 *
 * State arrives on the IPN bus, which pushes a message whenever prefs, the
 * network map or the backend state change. Peers are read back from
 * `/localapi/v0/status` rather than adapted from the raw network map, so there
 * is one peer shape in the extension instead of two.
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import {LocalApi} from './localApi.js';

/** ipn.State */
export const BackendState = {
    NO_STATE: 0,
    IN_USE_OTHER_USER: 1,
    NEEDS_LOGIN: 2,
    NEEDS_MACHINE_AUTH: 3,
    STOPPED: 4,
    STARTING: 5,
    RUNNING: 6,
};

const RECONNECT_DELAY_MS = 5000;
const REFRESH_DEBOUNCE_MS = 250;

export const Tailscale = GObject.registerClass({
    Properties: {
        'backend-state': GObject.ParamSpec.int(
            'backend-state', null, null, GObject.ParamFlags.READABLE,
            0, 10, BackendState.NO_STATE),
        'connected': GObject.ParamSpec.boolean(
            'connected', null, null, GObject.ParamFlags.READABLE, false),
        'reachable': GObject.ParamSpec.boolean(
            'reachable', null, null, GObject.ParamFlags.READABLE, false),
        'accept-dns': GObject.ParamSpec.boolean(
            'accept-dns', null, null, GObject.ParamFlags.READABLE, false),
        'accept-routes': GObject.ParamSpec.boolean(
            'accept-routes', null, null, GObject.ParamFlags.READABLE, false),
        'allow-lan-access': GObject.ParamSpec.boolean(
            'allow-lan-access', null, null, GObject.ParamFlags.READABLE, false),
        'shields-up': GObject.ParamSpec.boolean(
            'shields-up', null, null, GObject.ParamFlags.READABLE, false),
        'run-ssh': GObject.ParamSpec.boolean(
            'run-ssh', null, null, GObject.ParamFlags.READABLE, false),
        'exit-node-id': GObject.ParamSpec.string(
            'exit-node-id', null, null, GObject.ParamFlags.READABLE, ''),
        'peers': GObject.ParamSpec.jsobject(
            'peers', null, null, GObject.ParamFlags.READABLE),
        'self-node': GObject.ParamSpec.jsobject(
            'self-node', null, null, GObject.ParamFlags.READABLE),
        'health': GObject.ParamSpec.jsobject(
            'health', null, null, GObject.ParamFlags.READABLE),
        'shares': GObject.ParamSpec.jsobject(
            'shares', null, null, GObject.ParamFlags.READABLE),
    },
    Signals: {
        // Emitted for failures a person should see, e.g. a refused pref change.
        'failed': {param_types: [GObject.TYPE_STRING]},
    },
}, class Tailscale extends GObject.Object {
    constructor() {
        super();

        this._api = new LocalApi();
        this._cancellable = new Gio.Cancellable();
        this._timeouts = new Set();
        this._sleepResolvers = new Set();

        this._backendState = BackendState.NO_STATE;
        this._reachable = false;
        this._prefs = null;
        this._peers = [];
        this._selfNode = null;
        this._health = [];
        this._shares = [];
        this._magicDnsSuffix = '';
        this._refreshQueued = false;

        this._watch();
    }

    get backendState() {
        return this._backendState;
    }

    /** @returns {boolean} true when the node is up and carrying traffic */
    get connected() {
        return this._backendState === BackendState.RUNNING;
    }

    /** @returns {boolean} true when tailscaled answered us at all */
    get reachable() {
        return this._reachable;
    }

    get acceptDns() {
        return this._prefs?.CorpDNS ?? false;
    }

    get acceptRoutes() {
        return this._prefs?.RouteAll ?? false;
    }

    get allowLanAccess() {
        return this._prefs?.ExitNodeAllowLANAccess ?? false;
    }

    get shieldsUp() {
        return this._prefs?.ShieldsUp ?? false;
    }

    get runSsh() {
        return this._prefs?.RunSSH ?? false;
    }

    get exitNodeId() {
        return this._prefs?.ExitNodeID ?? '';
    }

    get peers() {
        return this._peers;
    }

    get selfNode() {
        return this._selfNode;
    }

    get health() {
        return this._health;
    }

    get shares() {
        return this._shares;
    }

    get magicDnsSuffix() {
        return this._magicDnsSuffix;
    }

    /** @returns {object|null} the peer currently acting as exit node */
    get exitNode() {
        const id = this.exitNodeId;
        return id ? this._peers.find(peer => peer.id === id) ?? null : null;
    }

    /** @returns {object[]} peers this tailnet offers as exit nodes */
    get exitNodeOptions() {
        return this._peers.filter(peer => peer.exitNodeOption);
    }

    /**
     * Brings the node up or down.
     *
     * @param {boolean} value desired connection state
     */
    setConnected(value) {
        this._setPrefs({WantRunning: value});
    }

    setAcceptDns(value) {
        this._setPrefs({CorpDNS: value});
    }

    setAcceptRoutes(value) {
        this._setPrefs({RouteAll: value});
    }

    setAllowLanAccess(value) {
        this._setPrefs({ExitNodeAllowLANAccess: value});
    }

    setShieldsUp(value) {
        this._setPrefs({ShieldsUp: value});
    }

    setRunSsh(value) {
        this._setPrefs({RunSSH: value});
    }

    /**
     * @param {string} id stable node ID, or '' to stop using an exit node
     */
    setExitNode(id) {
        this._setPrefs({ExitNodeID: id});
    }

    /** Re-reads status and serve config; cheap enough to call on menu open. */
    refresh() {
        this._refreshStatus();
        this._refreshShares();
    }

    destroy() {
        this._cancellable.cancel();

        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();

        // Removing the source means a pending `_sleep` would never settle,
        // leaving the watch loop suspended and holding on to this object.
        // Let it resume so it can see the cancellation and return.
        for (const resolve of this._sleepResolvers)
            resolve();
        this._sleepResolvers.clear();

        this._api.destroy();
        this._api = null;
    }

    /**
     * PATCHes prefs. tailscaled ignores any field whose matching `<Name>Set`
     * flag is absent, so each key is paired with its own flag.
     *
     * @param {object} changes partial ipn.Prefs
     */
    async _setPrefs(changes) {
        const body = {...changes};
        for (const key of Object.keys(changes))
            body[`${key}Set`] = true;

        const result = await this._api.request('PATCH', '/localapi/v0/prefs', body);
        if (!result.ok) {
            this.emit('failed', result.message);
            // Drop the optimistic value the UI may have painted.
            this._applyPrefs(this._prefs);
            return;
        }
        this._applyPrefs(result.value);
    }

    async _watch() {
        while (!this._cancellable.is_cancelled()) {
            let sawAnything = false;

            for await (const notify of this._api.watchIpnBus(
                this._cancellable, message => this._onBusError(message))) {
                sawAnything = true;
                this._setReachable(true);
                this._applyNotify(notify);
            }

            if (this._cancellable.is_cancelled())
                return;

            if (!sawAnything)
                this._setReachable(false);

            await this._sleep(RECONNECT_DELAY_MS);
        }
    }

    _onBusError(message) {
        this._setReachable(false);
        console.debug(`tailscale: IPN bus ended: ${message}`);
    }

    /**
     * @param {object} notify an ipn.Notify message
     */
    _applyNotify(notify) {
        if (notify.State !== undefined && notify.State !== null)
            this._setBackendState(notify.State);

        if (notify.Prefs)
            this._applyPrefs(notify.Prefs);

        // The network map is large and arrives on every peer change; rather
        // than adapt it, use it as a signal to re-read the digested status.
        if (notify.NetMap || notify.State !== undefined)
            this._queueRefresh();

        if (notify.ErrMessage)
            this.emit('failed', notify.ErrMessage);
    }

    _queueRefresh() {
        if (this._refreshQueued)
            return;
        this._refreshQueued = true;

        this._addTimeout(REFRESH_DEBOUNCE_MS, () => {
            this._refreshQueued = false;
            this._refreshStatus();
            this._refreshShares();
        });
    }

    async _refreshStatus() {
        const result = await this._api.request('GET', '/localapi/v0/status');
        if (!result.ok) {
            this._setReachable(false);
            return;
        }

        const status = result.value;
        this._setReachable(true);
        this._magicDnsSuffix = status.MagicDNSSuffix ?? '';

        const suffix = this._magicDnsSuffix;
        const exitNodeId = this.exitNodeId;
        this._peers = Object.values(status.Peer ?? {})
            .map(raw => normalizePeer(raw, suffix, exitNodeId))
            .sort(comparePeers);
        this.notify('peers');

        this._selfNode = status.Self
            ? normalizePeer(status.Self, suffix, exitNodeId)
            : null;
        this.notify('self-node');

        const health = status.Health ?? [];
        if (!sameStrings(health, this._health)) {
            this._health = health;
            this.notify('health');
        }
    }

    async _refreshShares() {
        const result = await this._api.request('GET', '/localapi/v0/serve-config');
        if (!result.ok)
            return;

        this._shares = parseServeConfig(result.value);
        this.notify('shares');
    }

    /**
     * @param {object|null} prefs full ipn.Prefs
     */
    _applyPrefs(prefs) {
        if (!prefs)
            return;

        const previous = this._prefs;
        this._prefs = prefs;

        const changed = [
            ['CorpDNS', 'accept-dns'],
            ['RouteAll', 'accept-routes'],
            ['ExitNodeAllowLANAccess', 'allow-lan-access'],
            ['ShieldsUp', 'shields-up'],
            ['RunSSH', 'run-ssh'],
            ['ExitNodeID', 'exit-node-id'],
        ].filter(([key]) => previous?.[key] !== prefs[key]);

        for (const [, property] of changed)
            this.notify(property);

        if (previous?.ExitNodeID !== prefs.ExitNodeID)
            this._queueRefresh();
    }

    _setBackendState(state) {
        if (this._backendState === state)
            return;
        this._backendState = state;
        this.notify('backend-state');
        this.notify('connected');
    }

    _setReachable(value) {
        if (this._reachable === value)
            return;
        this._reachable = value;
        this.notify('reachable');
    }

    /**
     * @param {number} ms delay
     * @param {function(): void} callback runs once
     */
    _addTimeout(ms, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    /**
     * @param {number} ms delay
     * @returns {Promise<void>} resolves after the delay, or on destroy
     */
    _sleep(ms) {
        return new Promise(resolve => {
            const settle = () => {
                this._sleepResolvers.delete(settle);
                resolve();
            };
            this._sleepResolvers.add(settle);
            this._addTimeout(ms, settle);
        });
    }
});

/**
 * @param {object} raw an ipnstate.PeerStatus
 * @param {string} magicDnsSuffix the tailnet's MagicDNS suffix
 * @param {string} exitNodeId the stable ID of the active exit node
 * @returns {object} the peer shape the rest of the extension uses
 */
function normalizePeer(raw, magicDnsSuffix, exitNodeId) {
    const fqdn = (raw.DNSName ?? '').replace(/\.$/, '');
    const ips = raw.TailscaleIPs ?? [];
    const name = fqdn.split('.')[0] || raw.HostName || ips[0] || 'Unknown device';

    return {
        id: raw.ID ?? '',
        name,
        fqdn,
        hostName: raw.HostName ?? '',
        os: raw.OS ?? '',
        online: raw.Online === true,
        expired: raw.Expired === true,
        ips,
        ipv4: ips.find(ip => !ip.includes(':')) ?? ips[0] ?? '',
        // A node can offer to be an exit node without being the chosen one.
        exitNodeOption: raw.ExitNodeOption === true,
        isExitNode: exitNodeId !== '' && raw.ID === exitNodeId,
        sshAvailable: (raw.sshHostKeys?.length ?? 0) > 0,
        shared: raw.ShareeNode === true,
        tags: raw.Tags ?? [],
        // Only meaningful when the tailnet has MagicDNS on.
        url: fqdn && magicDnsSuffix ? `https://${fqdn}` : '',
    };
}

/**
 * Online devices first, then alphabetical. Keeps the list stable across
 * refreshes so items do not jump under the pointer.
 *
 * @param {object} a first peer
 * @param {object} b second peer
 * @returns {number} sort order
 */
function comparePeers(a, b) {
    if (a.online !== b.online)
        return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
}

/**
 * @param {string[]} a first list
 * @param {string[]} b second list
 * @returns {boolean} whether both hold the same strings in the same order
 */
function sameStrings(a, b) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * Flattens an ipn.ServeConfig into one entry per published URL.
 *
 * @param {object|string} config the serve-config document
 * @returns {object[]} entries of {url, target, funnel}
 */
function parseServeConfig(config) {
    if (typeof config !== 'object' || config === null)
        return [];

    const shares = [];
    for (const [hostPort, web] of Object.entries(config.Web ?? {})) {
        const funnel = config.AllowFunnel?.[hostPort] === true;
        const host = hostPort.replace(/:443$/, '');

        for (const [path, handler] of Object.entries(web.Handlers ?? {})) {
            shares.push({
                url: `https://${host}${path === '/' ? '' : path}`,
                target: describeHandler(handler),
                funnel,
            });
        }
    }

    for (const [port, tcp] of Object.entries(config.TCP ?? {})) {
        if (!tcp.TCPForward)
            continue;
        shares.push({
            url: `tcp://${port}`,
            target: tcp.TCPForward,
            funnel: config.AllowFunnel?.[`:${port}`] === true,
        });
    }

    return shares;
}

/**
 * @param {object} handler an ipn.HTTPHandler
 * @returns {string} what the handler serves, for display
 */
function describeHandler(handler) {
    if (handler.Proxy)
        return handler.Proxy;
    if (handler.Path)
        return handler.Path;
    if (handler.Text !== undefined)
        return 'text';
    return 'unknown';
}
