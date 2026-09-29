# Deploying to the Ubuntu server

Same shape as MyPortfolio and azwebsite on this box: the stack is only ever
exposed on `127.0.0.1` and the host's Tailscale IP (never `0.0.0.0`), and the
`cloudflared` systemd service already running on the server (tunnel
`azwebtech`, token-based — its routing is configured in the Cloudflare Zero
Trust dashboard, not a local file) is pointed at `localhost:8445` to serve
the public hostname `videodl.azwebtech.net`. No new tunnel is needed — this
just adds one more Public Hostname route to the existing `azwebtech` tunnel.

Server hardening (ufw, fail2ban, unattended-upgrades, SSH-via-Tailscale) is
already done host-wide from the azwebsite deploy — nothing project-specific
to repeat here.

## 1. Point the existing Cloudflare Tunnel at nginx

In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/) →
**Networks → Tunnels → azwebtech → Public Hostname** (or "Routes"), add a
new hostname entry:

- Public hostname: `videodl.azwebtech.net`
- Service type: `HTTPS`
- URL: `localhost:8445`
- Additional application settings → TLS → **enable "No TLS Verify"** —
  required, since nginx's cert is self-signed and won't validate against a
  public CA.

That's it — once this deploy's `web` container is up and listening on
`127.0.0.1:8445`, the existing tunnel starts serving it. Cloudflare↔cloudflared
and cloudflared↔nginx are both encrypted end to end ("No TLS Verify" only
skips certificate *validation*, the hop is still TLS).

**This is the one step I can't do myself** — it needs your Cloudflare
dashboard access. Everything else below is already done on this server.

## 2. First deploy (already done)

```sh
cd /home/hassane/homelab/projects/video-dl-sass
cp .env.production.example .env   # then filled in with generated secrets
chmod 600 .env
docker compose -f docker-compose.prod.yml up -d --build
```

`.env` holds `COOKIE_SECRET`, `JWT_SECRET` (each `openssl rand -base64 48`)
and `POSTGRES_PASSWORD` — freshly generated for this deploy, never reused
from local dev. `FRONTEND_ORIGINS` and `VITE_API_URL` are both
`https://videodl.azwebtech.net`: nginx reverse-proxies `/api/` to the `app`
service (see `frontend/nginx.conf`), so the browser only ever talks to one
origin — no cross-site cookie complications for the httpOnly auth cookies.

Verify from the server itself:

```sh
curl -Ik https://localhost:8445/                # 200, self-signed cert
curl -ks https://localhost:8445/api/platforms   # public endpoint, JSON
```

## 3. Redeploying after code changes

```sh
cd /home/hassane/homelab/projects/video-dl-sass
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

`sql/schema.sql` only runs against a *fresh* `pgdata` volume (Postgres
entrypoint convention) — a schema change on an existing deploy needs a
manual migration, not a rebuild.

## 4. Ongoing maintenance

- `docker compose -f docker-compose.prod.yml pull` periodically for
  Postgres/Redis base-image security patches, then `up -d --build` (the
  `web` image needs a rebuild anyway since its self-signed cert step runs
  at build time).
- Bump `YTDLP_VERSION`/`DENO_VERSION` build args in `Dockerfile` deliberately
  — they're pinned for reproducible builds, not auto-updated. yt-dlp in
  particular breaks against platform changes often enough to check every
  few weeks.
- Run `npm audit` (root and `frontend/`) before each deploy; fix any
  high/critical advisories.
- Back up the `pgdata` volume regularly, e.g.
  `docker run --rm -v video-dl-sass_pgdata:/data -v $PWD:/backup alpine tar czf /backup/pgdata-backup.tgz /data`.
  Redis holds only quota counters/cache/pub-sub state — nothing that needs
  backing up.
- Rotate `JWT_SECRET`/`COOKIE_SECRET`/`POSTGRES_PASSWORD` if any is ever
  suspected to have leaked (rotating `JWT_SECRET` signs every user out).
- Keep the host `cloudflared` package updated
  (`sudo apt update && sudo apt upgrade cloudflared`).

## Not automated here — do before/soon after going live

- **No auto-recovery watchdog is installed on this host yet** — azwebsite's
  `DEPLOY.md` documents one (`deploy/systemd/docker-restart-watchdog.*`,
  covers every container on the host, not just one project) but it isn't
  actually running here (`systemctl list-timers` shows nothing). Worth
  installing once, from azwebsite's copy, if a host reboot ever leaves a
  container network-attachment broken and restart-looping.
- **Login-gated platforms** (Instagram, Facebook, often TikTok) need a
  cookies export to work at all — see `.env.example` for
  `COOKIES_HOST_PATH`/`YTDLP_COOKIES_FILE`. Not set up yet; those platforms
  will return "contenu privé ou protégé" until they are.
- **No CDN/cache in front of downloads** — every download streams through
  this one `app` container from the source platform in real time. Fine for
  current expected load; revisit if concurrent downloads become a
  bottleneck (`max_concurrent_streams` in the pricing table is the current
  lever).
