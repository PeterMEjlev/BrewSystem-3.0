# Notes for Claude

## This repo runs on a Pi you can't reach directly

`brew-system-v3` is the brewing rig's own control system. It lives on the
brewery LAN (`192.168.3.4`, user `pi`) with an unauthenticated API on `:8000`,
and it is deliberately never exposed to the internet.

To get a shell on it, hop through the **BrewPlanner Pi** (the web server,
`brewplanner@192.168.3.3` / `brewplanner.local`), which is the internet-facing
machine — reachable from off-LAN over its Cloudflare Tunnel at
`ssh.konfusbrewing.com`. Then from there:

```bash
ssh pi@192.168.3.4      # passwordless; brewplanner's key is authorised here
```

Full details — Cloudflare Access login, the service unit, where the checkout
lives — are in [README.md](README.md#ssh-access--hop-via-the-brewplanner-pi).
SSH credentials for the BrewPlanner Pi are intentionally not in this repo (it's
public); ask the user, or check the BrewPlanner project's notes.

## Related repos on the dev machine

- `../BrewPlanner` — the web-server Pi's dashboard. Mirrors this rig's brewing
  screen, proxies control over the LAN, hosts Bruce (voice) and the
  "Update brew system" deploy button that SSHes into this rig.
- `../Bruce-v2` — the voice assistant package this repo depends on.
