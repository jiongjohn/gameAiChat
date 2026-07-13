# Deployment

Production deployment of AI Companion Chat on a single Ubuntu server, fronted
by nginx, with the Next.js app managed by pm2.

## Architecture

```
Browser ──HTTP :80──▶ nginx ──▶ 127.0.0.1:3000 (Next.js, pm2 "ai_chat")
                        │
                        └─ /api/assets/*  ──▶ static files from /opt/ai_chat/.data/assets/
```

- **Runtime**: Node 20 LTS, Next.js production build (`npm run build` + `npm start`)
- **Process manager**: pm2 (auto-restart + boot persistence via systemd)
- **Reverse proxy**: nginx on `:80` → app on `:3000`
- **Storage**: JSON backend (zero-config); state at `/opt/ai_chat/.data/`
- **Image assets**: served statically by nginx (see note below)

## Prerequisites (one-time server setup)

```bash
# Node 20 LTS + nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

# pm2
sudo npm install -g pm2
```

## First deploy

```bash
sudo git clone https://github.com/jiongjohn/gameAiChat.git /opt/ai_chat
cd /opt/ai_chat

# Dependencies. The committed package-lock.json may be out of sync across
# platforms (optional native deps); use `npm install` if `npm ci` fails.
npm install --no-audit --no-fund

# Environment. Required: ADMIN_USER, ADMIN_PASSWORD, SESSION_SECRET.
cat > .env.local <<EOF
AI_CHAT_STORE=json
AI_CHAT_STATE_PATH=/opt/ai_chat/.data/companion-state.json
ADMIN_USER=admin
ADMIN_PASSWORD=$(openssl rand -base64 18)
SESSION_SECRET=$(openssl rand -hex 32)
EOF
chmod 600 .env.local
mkdir -p /opt/ai_chat/.data

# Build (2GB heap cap is safe on small RAM boxes with swap)
NODE_OPTIONS=--max-old-space-size=2048 npm run build

# Start under pm2 + enable on boot
pm2 start npm --name ai_chat -- start
pm2 save
pm2 startup systemd -u root --hp /root   # run the command it prints

# nginx
sudo cp deploy/nginx.conf              /etc/nginx/sites-available/ai_chat
sudo cp deploy/nginx-upgrade-map.conf  /etc/nginx/conf.d/upgrade-map.conf
sudo ln -sf /etc/nginx/sites-available/ai_chat /etc/nginx/sites-enabled/ai_chat
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx && sudo systemctl enable nginx
```

Then log into `/admin` (Basic Auth with `ADMIN_USER` / `ADMIN_PASSWORD`) and
configure model provider / apiKey / baseUrl under "模型设置". Chat and image
generation stay inert until a model is configured.

## Updating an existing deploy

```bash
cd /opt/ai_chat
git pull
npm install --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=2048 npm run build
pm2 restart ai_chat
```

## Image assets: public static serving

The app stores generated images on disk and emits URLs like
`/api/assets/<key>.png`. The Node route `/api/assets/[key]` is session-gated,
which means an `<img>` tag only loads when the browser sends a valid session
cookie.

`deploy/nginx.conf` serves `/api/assets/` **directly from disk**, bypassing the
auth gate so images always render. Keys are random 40-hex hashes (unguessable),
which is acceptable for this app's threat model.

If you need per-user private images instead, delete the `location /api/assets/`
and `location @assets_fallback` blocks from the nginx config so all requests go
through the Node auth route.

## Common operations

```bash
pm2 status                 # process state
pm2 logs ai_chat           # app logs
pm2 restart ai_chat        # restart after config/env change
sudo systemctl reload nginx
```
