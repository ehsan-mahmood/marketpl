# Deploying Marketpl to Render (Free Tier)

Render's free web service runs your existing `server.mjs` with almost no changes.
Your shop, admin, static files, and all API routes work as-is.

**What survives sleep/wake:** everything (disk is persistent while the service is running).  
**What gets wiped on redeploy:** `data/orders.csv`, `data/context.json`, `data/products.csv`, `admin-auth.json`.  
**How we fix the auth wipe:** you copy your credentials into Render env vars once — then redeploys never reset your password again. See Step 5.

---

## Prerequisites

- Your project is in a **GitHub repository** (public or private, both work).
- `package.json` has `"start": "node server.mjs"` in scripts — it already does.
- The updated `server.mjs` from this guide is committed.

---

## Step 1 — Create a Render account

1. Go to **[render.com](https://render.com)** and click **Get Started for Free**.
2. Sign up with your **GitHub account** (recommended — makes connecting repos easy).
3. Verify your email if prompted.

No credit card required for the free tier.

---

## Step 2 — Push your code to GitHub

If your project isn't on GitHub yet:

```bash
cd marketpl/
git init
git add .
git commit -m "Initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/marketpl.git
git push -u origin main
```

Make sure `.gitignore` includes:
```
admin-auth.json
google-service-account.json
data/orders.csv
node_modules/
```

---

## Step 3 — Create a new Web Service on Render

1. In the Render dashboard, click **New +** → **Web Service**.
2. Click **Connect a repository** → authorize Render to access your GitHub → select your `marketpl` repo.
3. Fill in the settings:

| Field | Value |
|---|---|
| **Name** | `marketpl` (or anything you like) |
| **Region** | Closest to you |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** |

4. Click **Create Web Service**.

Render will immediately start a first deploy. It takes about 2 minutes.

---

## Step 4 — Get your auth credentials from the first deploy log

The first deploy creates `admin-auth.json` fresh (since env vars aren't set yet) and prints the credentials in the log.

1. In your Render service page, click **Logs** (top right area).
2. Wait for the deploy to finish. Look for output like this:

```
── Admin auth (first run) ─────────────────────────────
  Password: changeme   ← change after first login
  Dev key:  abc123xyz...

── For Render / cloud deploys ──
  Set these env vars in your Render dashboard:
  ADMIN_PHONE          = 614xxxxxxxx
  ADMIN_PASSWORD_HASH  = a1b2c3...
  ADMIN_SALT           = d4e5f6...
  ADMIN_SESSION_SECRET = 7890ab...
  ADMIN_DEV_KEY        = abc123...
```

**Copy all five values.** You'll paste them in the next step.

> If the phone is empty (no `data/context.json` yet), that's fine — you'll set it via dev-reset after deploy.

---

## Step 5 — Set environment variables (so auth survives redeploys)

1. In your Render service, go to **Environment** (left sidebar).
2. Click **Add Environment Variable** for each of these:

| Key | Value |
|---|---|
| `ADMIN_PHONE` | your phone digits from the log |
| `ADMIN_PASSWORD_HASH` | hex hash from the log |
| `ADMIN_SALT` | hex salt from the log |
| `ADMIN_SESSION_SECRET` | hex secret from the log |
| `ADMIN_DEV_KEY` | dev key from the log |

3. Click **Save Changes**. Render will automatically redeploy.

After this redeploy, auth is loaded from env vars — `admin-auth.json` is no longer needed on disk. **Future redeploys will never reset your password.**

---

## Step 6 — First login and setup

Once deployed, your URLs are:
- **Shop:** `https://marketpl.onrender.com/shop.html`  
- **Admin:** `https://marketpl.onrender.com/admin.html`

1. Go to `/admin.html` → log in with your phone digits and password `changeme`.
2. **Immediately change your password** (Admin → Settings → Change Password). 
   - After changing, update `ADMIN_PASSWORD_HASH` and `ADMIN_SALT` in Render env vars with the new values printed to logs, otherwise the next redeploy reverts to the old password.
3. Set up your store: go to the **Context** tab and fill in your WhatsApp number, store name, etc. → Save.
4. Upload your products via the **Products** tab.

> **Tip for avoiding the password update hassle:** use a Google Sheet for products and context, so your real data lives outside Render entirely. Then redeploys truly have zero impact on anything important.

---

## Step 7 — Handle the cold start (free tier spin-down)

Render's free tier spins down your service after **15 minutes of inactivity**. The next visitor waits ~30 seconds for it to wake up.

**To minimise this for customers:**

Option A — **UptimeRobot ping** (simplest, free):
1. Go to [uptimerobot.com](https://uptimerobot.com) → free account.
2. Add a monitor: HTTP(s), URL = `https://YOUR-APP.onrender.com/`, interval = **14 minutes**.
3. This keeps your service alive 24/7 at no cost.

Option B — Accept it. For a small shop with infrequent visitors, a one-time 30s delay is usually fine.

---

## How data behaves on Render

| Data | Survives sleep/wake | Survives redeploy |
|---|---|---|
| `data/orders.csv` | ✅ Yes | ❌ Wiped |
| `data/context.json` | ✅ Yes | ❌ Wiped |
| `data/products.csv` | ✅ Yes | ❌ Wiped |
| `admin-auth.json` | ✅ Yes | ❌ Wiped |
| Auth via env vars | ✅ Yes | ✅ **Survives** |
| `assets/` images | ✅ Yes (if in repo) | ✅ **Survives** (they're in Git) |

**Practical implication:** orders placed between deploys will be lost on your next deploy. If that's a problem, switch `orders_source` to `google_apps_script` or `google_sheets` in your context config — those options write orders to Google Sheets instead of the local CSV, so they're safe forever.

---

## Deploying updates

Any `git push` to `main` triggers an automatic redeploy on Render. Your env vars stay intact.

```bash
# Make your changes locally, then:
git add .
git commit -m "Update products"
git push
```

Render deploys in ~1–2 minutes. The old instance stays live until the new one is ready.

---

## Troubleshooting

**"Not found" on all pages** — Check that your start command is `npm start` and that `server.mjs` is in the repo root (not in a subfolder).

**Login says "Vendor phone is not set"** — Your `ADMIN_PHONE` env var is empty. Use dev-reset to fix:
```bash
curl -X POST https://YOUR-APP.onrender.com/api/admin/dev-reset \
  -H "Content-Type: application/json" \
  -d '{"devKey":"YOUR_DEV_KEY","newPassword":"newpass123","newPhone":"614xxxxxxxx"}'
```
Then update `ADMIN_PHONE` in env vars.

**Build fails with "Cannot find module googleapis"** — Make sure `googleapis` is in `package.json` dependencies (not devDependencies) and run `npm install` locally to confirm `package-lock.json` is up to date, then push.

**Service keeps sleeping despite UptimeRobot** — Confirm the monitor interval is ≤14 minutes and the URL returns HTTP 200 (it should — `/` serves `shop.html`).
