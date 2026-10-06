#!/usr/bin/env bash
# HyperFrames one-shot installer for Dokploy server (root@cloud).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
mkdir -p my-video renders
docker network inspect dokploy-network >/dev/null 2>&1 || docker network create dokploy-network
docker compose up -d --build
echo "--- waiting for health ---"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3002/health >/dev/null 2>&1; then echo "healthy"; break; fi
  sleep 5
  if [ "$i" = "30" ]; then echo "WARNING: not healthy yet, check docker logs hyperframes-dokploy"; fi
done
echo "--- doctor ---"
docker exec hyperframes-dokploy npx hyperframes doctor || true
echo "--- render test ---"
docker exec hyperframes-dokploy bash -c 'cd /app/video && npx hyperframes render --output /app/renders/test.mp4' || true
ls -lh renders/ || true
docker ps --filter "name=hyperframes" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo "DONE. Preview: curl http://127.0.0.1:3002/ | Render: curl -X POST 'http://127.0.0.1:3002/api/render?output=test.mp4'"
