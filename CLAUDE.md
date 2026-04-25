# cpab — Docker Build Instructions

## Multi-Platform Image Builds

All Docker images MUST be built for **both** `linux/amd64` and `linux/arm64`.
Never push a single-platform image to a tag that users pull (`:latest`, version tags).

### CI (GitHub Actions)

- **`ci-docker.yml`** (on push to `main`): builds `linux/amd64,linux/arm64` in one `docker buildx` step using QEMU emulation, pushes as `:latest` and `:<sha>`.
- **`docker-image.yml`** (on version tag `v*`): builds each platform on its native runner, then creates a combined multi-arch manifest with `docker buildx imagetools create`.

### Local Development

Build and run locally (no push needed):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t abwebplode/cpab:local .
```

To push a multi-arch image manually:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t abwebplode/cpab:latest \
  --push .
```

> Requires `docker buildx` and QEMU. Install QEMU emulation once with:
> `docker run --privileged --rm tonistiigi/binfmt --install all`

### Common Mistakes to Avoid

- Do **not** build with `--platform linux/amd64` only — arm64 users (Apple Silicon) will get `no matching manifest` errors on `docker compose pull`.
- Do **not** add an `image:` field to `docker-compose.yml` pointing to the Hub image while also using `build:` — it causes confusion between local builds and pulled images.
