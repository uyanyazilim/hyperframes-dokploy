# hyperframes-dokploy

HyperFrames local Docker render on Dokploy. No Vercel/Cloudflare/Modal/Lambda. No API keys.

## Server install (one command)

```bash
rm -rf /opt/hyperframes-dokploy && git clone https://github.com/uyanyazilim/hyperframes-dokploy /opt/hyperframes-dokploy && cd /opt/hyperframes-dokploy && bash install.sh
```

## Verify

```bash
docker exec hyperframes-dokploy npx hyperframes doctor
docker exec hyperframes-dokploy bash -c 'cd /app/video && npx hyperframes init my-video-test --yes 2>/dev/null || npx hyperframes init my-video-test; ls'
docker exec hyperframes-dokploy bash -c 'cd /app/video && npx hyperframes render --output /app/renders/test.mp4'
ls -lh /opt/hyperframes-dokploy/renders/
```

## Dokploy UI (from Git + Compose)

1. Projects > Create `hyperframes` > production > Create Service > Compose > `hyperframes`.
2. Provider: GitHub `uyanyazilim/hyperframes-dokploy`, branch `main`, Compose path `docker-compose.yml`.
3. Env: `PORT=3002`. Deploy.
4. Domains > add domain, port `3002` (`/` and `/health` healthy).
5. Preview `https://DOMAIN/preview/`, renders `https://DOMAIN/renders/`, `POST https://DOMAIN/api/render?output=x.mp4`.
