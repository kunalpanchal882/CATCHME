# Melody 🎵

> A fast, lightweight real-time group chat designed for Wi-Fi hotspots and captive portal popup browsers.

---

## 💡 Purpose

When people connect to a local Wi-Fi hotspot (café, event, campsite, festival, pop-up space), they are often redirected to a sign-in or captive portal page. **Melody** gives everyone on that network an instant, frictionless public room to chat together.

Because many users open the site inside their phone's lightweight "Sign in to network" browser popup, Melody is engineered to be:
- **Instantaneous & Featherweight:** Loads in under 1 second even on weak connections.
- **Zero External Dependencies:** No CDNs, no Google Fonts, no external JS/CSS, no images. Strictly system fonts (`system-ui`) and clean inline SVGs.
- **Resilient Real-time:** Uses **Server-Sent Events (SSE)** for push delivery with automatic **2-second polling fallback** if SSE or WebSockets are restricted by the captive portal browser.
- **Zero Friction:** No passwords, emails, or accounts. Users enter a display name (2–20 chars) which is saved in `localStorage` (`try/catch` guarded) for instant re-entry.

---

## 🎨 Design & Aesthetic

- **Light Theme Only:**
  - Page Background: `#F7F9FC`
  - Cards & Header: `#FFFFFF`
  - Primary Accent: `#7C9CFF` (Soft periwinkle blue)
  - Own Message Bubble: `#E3EBFF`
  - Others' Message Bubble: `#FFFFFF` with thin `#E6EAF2` border
  - Text: `#1F2937`, Timestamps & Secondary: `#6B7280`
- **Ergonomics & Mobile First:**
  - Full-height layout using `100dvh` with `safe-area-inset` support.
  - Sticky bottom message input with large tap targets (≥ 44px).
  - Minimum `16px` font size on inputs to prevent iOS Safari auto-zooming.
  - Responsive from 320px wide up to full desktop width.

---

## 🚀 Key Features

1. **Quick Join Screen:** Display name (2–20 characters), instant local persistence, and a "Change Name" modal inside the chat room.
2. **Instant Message Feed:** Real-time push via SSE (`/api/events`). User's own messages align to the right, others align to the left with unique initials avatars.
3. **Smart Auto-Scroll:** Automatically scrolls down when you send or receive messages, but pauses auto-scroll if you scroll up to read history—revealing a floating `↓ New messages below` pill button.
4. **Active Presence & Connection Status:** Live `X online` counter and pulsing `connected` / `reconnecting` indicator.
5. **100-Message Memory Buffer:** New joiners instantly receive the last 100 messages stored in memory.
6. **Built-in Security & Anti-Spam:**
   - HTML injection protection (safe text rendering via React text nodes).
   - Rate limit: max 1 message per second per user/IP.
   - 500-character max message length with live character countdown.
   - Whitespace and empty message rejection.
7. **Gentle Chime:** Synthesized two-note notification chime using the Web Audio API (zero audio files needed), toggleable via header button.

---

## 🛠️ Tech Stack

- **Framework:** Next.js (App Router, Node.js runtime)
- **Frontend:** React 19, TypeScript, Vanilla CSS
- **Real-Time Delivery:** Server-Sent Events (SSE) + Fallback Polling (`/api/messages`)
- **State Store:** In-memory circular buffer with active client tracking

---

## 🏃 Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Run the development server
npm run dev

# 3. Build and run production server
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Running Automated Multi-Tab Chat Test

Melody includes an automated simulation test that verifies two clients chatting with each other in real-time over SSE and verifies presence updates and polling fallback:

```bash
npm test
```

---

## 🚢 Deployment

Melody reads the `PORT` environment variable automatically.

### 1. Render

1. Connect your GitHub repository to [Render](https://render.com).
2. Create a new **Web Service**.
3. Settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
4. Add environment variable:
   - `NODE_ENV` = `production`
   - `PORT` = `10000` (or leave default assigned by Render)

### 2. Railway

1. Click **New Project** → **Deploy from GitHub Repo**.
2. Railway detects Next.js automatically.
3. Build command: `npm run build`
4. Start command: `npm start`
5. Railway injects `PORT` automatically.

### 3. VPS (Ubuntu / Debian with PM2 + Nginx)

```bash
# 1. Clone repository on server
git clone <your-repo-url> melody
cd melody

# 2. Install and build
npm install
npm run build

# 3. Start with PM2
npm install -g pm2
pm2 start npm --name "melody" -- start -- -p 3000
pm2 save
pm2 startup
```

#### Nginx Reverse Proxy Configuration (with SSE streaming support)

Ensure `proxy_buffering off;` and `proxy_cache off;` are enabled so Server-Sent Events stream instantly:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Crucial for SSE:
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

## 📶 Wi-Fi Hotspot Captive Portal Setup

To route hotspot users directly to Melody upon Wi-Fi connection:

1. **Raspberry Pi / OpenWrt / CoovaChilli / Nodogsplash:**
   - In your captive portal gateway config (e.g. `/etc/nodogsplash/nodogsplash.conf` or OpenWrt `opennds`):
   ```text
   RedirectURL http://192.168.1.1:3000
   ```
2. **DNS Hijacking:**
   - Configure `dnsmasq` to resolve captive portal check domains (`captive.apple.com`, `connectivitycheck.gstatic.com`, `msftconnecttest.com`) to the hotspot IP where Melody is running.
3. Users connecting to the Wi-Fi will immediately see their native network sign-in popup launch directly into **Melody**.

---

## 📄 License

MIT. Built with love for real-time local community communication.
