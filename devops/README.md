# CPAB Production VPS Deployment

This deployment runs CPAB behind nginx on `openapi.io.vn`.

- Public API: `https://openapi.io.vn/v1/*`
- No dashboard/admin/user routes are exposed by this nginx deployment.
- Public VPS port: `80`
- Private Docker-only CPAB port: `8318`
- Cloudflare or the upstream nginx terminates public HTTPS and connects to this origin over HTTP.

## 1. VPS Prerequisites

Install Docker Engine and the Docker Compose plugin on the VPS.

Open inbound TCP port `80` on the VPS firewall/security group. Do not expose port `8318`; it is only used inside the Docker network.

## 2. Copy Files To The VPS

From this repository root on your local machine:

```bash
SSH_PORT=<your-vps-ssh-port>
ssh -p "$SSH_PORT" <ssh-user>@<vps-ip> 'sudo mkdir -p /opt/cpab && sudo chown "$USER:$USER" /opt/cpab'
rsync -az -e "ssh -p $SSH_PORT" devops/ <ssh-user>@<vps-ip>:/opt/cpab/
```

If you prefer `scp`, its SSH port flag is uppercase `-P`:

```bash
SSH_PORT=<your-vps-ssh-port>
scp -P "$SSH_PORT" -r devops/* <ssh-user>@<vps-ip>:/opt/cpab/
```

On the VPS:

```bash
cd /opt/cpab
```

The compose file expects this layout:

```text
/opt/cpab/
|-- docker-compose.production.yml
`-- nginx/
    `-- openapi.io.vn.conf
```

## 3. Create The Runtime Environment

Create `/opt/cpab/.env` on the VPS:

```bash
POSTGRES_USER=cpab
POSTGRES_PASSWORD=replace-with-a-strong-database-password
POSTGRES_DB=cpab
JWT_SECRET=replace-with-output-of-openssl-rand-hex-32
JWT_EXPIRY=720h
CORS_ORIGINS=https://openapi.io.vn
HTTP_PORT=80
```

Generate a JWT secret if needed:

```bash
openssl rand -hex 32
```

## 4. Configure Cloudflare DNS

Create an `A` record:

```text
Name: openapi
Target: <vps-public-ip>
Proxy status: Proxied
```

The inner nginx config does not enforce Cloudflare source IP checks. If there is an upstream/front nginx, point it at this service over HTTP and avoid HTTP-to-HTTPS redirects for this origin path.

## 5. Configure Cloudflare TLS

Cloudflare automatically issues and renews the public edge certificate for browser/client traffic to `https://openapi.io.vn`.

This deployment listens on origin port `80` only, so the layer directly in front of this service must connect over HTTP. If Cloudflare connects directly to this service, use Cloudflare SSL/TLS mode `Flexible` for this hostname/zone, or another Cloudflare rule that makes the origin request use HTTP.

Do not use `Full` or `Full (strict)` while this origin only listens on port `80`; those modes make Cloudflare try HTTPS to the origin.

No origin certificate files are needed for this HTTP-only deployment.

## 6. Configure Cloudflare Access

The nginx config only exposes `/v1` and `/v1/*`. Everything else returns `404` before reaching CPAB.

If you still create a Cloudflare Zero Trust application, configure a public bypass for the API path:

```text
Domain: openapi.io.vn
Path: /v1*
Policy: Bypass, Include Everyone
```

Do not add a protected `/*` Access application for this hostname unless you also change nginx to expose those dashboard/admin/user paths. With the current nginx config, non-`/v1` paths are intentionally unavailable.

## 7. Start The Stack

On the VPS:

```bash
cd /opt/cpab
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
```

Check container status:

```bash
docker compose -f docker-compose.production.yml ps
```

Check nginx syntax after any config change:

```bash
docker compose -f docker-compose.production.yml exec nginx nginx -t
```

Reload nginx without restarting the whole stack:

```bash
docker compose -f docker-compose.production.yml exec nginx nginx -s reload
```

## 8. Smoke Test

From your local machine:

```bash
curl -I https://openapi.io.vn/v1/models
curl -I https://openapi.io.vn/dashboard
```

Expected behavior:

- `/v1/*` reaches CPAB publicly, subject to CPAB API key authentication for protected API operations.
- `/dashboard`, `/user`, `/admin`, `/v0/*`, `/v1beta/*`, and other non-`/v1` paths return `404`.

## 9. Updating

To pull the latest `abwebplode/cpab:development` image and restart:

```bash
cd /opt/cpab
docker compose -f docker-compose.production.yml pull cpab
docker compose -f docker-compose.production.yml up -d cpab
```

## Cloudflare SSL Automation Answer

Yes, Cloudflare automatically issues the public edge SSL certificate for `openapi.io.vn` when the DNS record is active on Cloudflare. That covers client-to-Cloudflare HTTPS.

This HTTP-only origin deployment does not need Cloudflare to install any certificate inside nginx, because nginx no longer listens on `443`. Cloudflare serves HTTPS publicly and connects to the VPS over HTTP port `80`.

If you later want encrypted Cloudflare-to-origin traffic again, re-enable nginx `443`, mount an origin certificate, and switch Cloudflare back to `Full (strict)`.

## References

- Cloudflare Universal SSL: https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/
- Cloudflare Flexible mode: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/flexible/
- Cloudflare Access application paths: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- Cloudflare Access policies: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
