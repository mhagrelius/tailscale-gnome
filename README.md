# Tailscale for GNOME Shell

Control Tailscale from the Quick Settings panel: connect, browse the tailnet,
copy device addresses, open SSH sessions, pick an exit node, and manage
`tailscale serve`.

Built against GNOME Shell 50; declares support for 48–50.

## What it does

**Connect** — the toggle brings the node up and down. Its subtitle says whether
you are connected, and names the exit node when traffic is leaving through one.

**Devices** — every peer on the tailnet, this device first, online before
offline. Expanding a device offers:

- Copy IP address, MagicDNS name, or `https://` URL
- Open in browser
- Open SSH session — `tailscale ssh` for devices that advertise Tailscale SSH,
  otherwise ordinary `ssh` over the tailnet

Offline devices stay listed (their addresses are still worth copying) with the
actions that need a live host greyed out.

**Exit node** — pick one, or none, and toggle local network access while one is
in use.

**Shared** — what this device publishes over `tailscale serve`, with a dialog to
share a local port, optionally over Funnel, and actions to copy or open each
URL.

**Options** — Tailscale DNS, subnet routes, blocking incoming connections, and
whether this device accepts Tailscale SSH.

Health warnings from the daemon appear at the top of the menu.

## Install

```sh
make install
gnome-extensions enable tailscale@hagreli.us
```

On Wayland the shell only discovers a newly installed extension at startup, so
log out and back in the first time.

## Permissions

Reading status works for any local user. Connecting, choosing an exit node and
sharing ports are writes, and the daemon only accepts those from root or the
configured operator:

```sh
sudo tailscale set --operator=$USER
```

Without it the menu still shows everything, and changes come back as a
notification explaining that Tailscale refused them.

## How it talks to Tailscale

State comes from the tailscaled LocalAPI on
`/var/run/tailscale/tailscaled.sock`. The extension holds open
`/localapi/v0/watch-ipn-bus`, so prefs and network map changes arrive as pushes
rather than polling; there is no timer. Peers are read back from
`/localapi/v0/status` when the map changes, which keeps one peer shape in the
extension instead of adapting the raw network map into a second one.

`serve` and `funnel` go through the CLI instead, because it validates ports,
provisions certificates and enforces the tailnet's Funnel policy — work that
writing the serve config directly would mean redoing.

Failures cross that boundary as values, not exceptions: `daemon/result.js`
defines `ok`/`err`, and everything above `daemon/` branches on `ok`.

## Layout

```
daemon/     the two external seams: LocalAPI socket, tailscale CLI
  result.js     typed success/failure
  localApi.js   HTTP over the daemon's unix socket
  cli.js        subprocess wrapper
  tailscale.js  GObject model fed by the IPN bus
features/   one file per capability, each owning its menu section
  devices.js exitNodes.js serve.js options.js
ui/         shared shell widgets: clipboard/OSD/notifications, launching, dialog
extension.js  assembles the indicator and quick settings toggle
prefs.js      libadwaita preferences
```

## Development

```sh
make install    # compile schemas, copy into ~/.local/share/gnome-shell/extensions
make logs       # follow this extension's shell output
make pack       # zip for extensions.gnome.org
```

To try changes without touching your session, run a headless shell against an
isolated dconf profile:

```sh
gnome-shell --headless --virtual-monitor 1400x900 --wayland-display=wayland-ts
```

`gnome-shell --nested` was removed in GNOME 50; nesting is the default and
`--headless` is what works without taking over the seat.
