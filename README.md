# URBEX·DB — Deployment Guide

A fast, single-user urbex location map built with Leaflet.js, Vercel serverless functions, and MongoDB Atlas.

---

## Project Structure

```
urbex-map/
├── public/
│   ├── index.html       ← App shell
│   ├── styles.css       ← All styles
│   └── app.js           ← Map logic, API calls, caching
├── api/
│   └── locations.js     ← Vercel serverless function (all CRUD)
├── vercel.json          ← Routing + CORS headers
├── package.json
└── .gitignore
```

---

## Step 1 — MongoDB Atlas Setup

1. Go to [https://cloud.mongodb.com](https://cloud.mongodb.com) and sign in.
2. Open your **urbexcluster1** cluster.
3. Click **Connect → Drivers** and copy the connection string. It looks like:
   ```
   mongodb+srv://<username>:<password>@urbexcluster1.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<username>` and `<password>` with your Atlas credentials.
5. Add `urbexdb` as the database name:
   ```
   mongodb+srv://user:pass@urbexcluster1.xxxxx.mongodb.net/urbexdb?retryWrites=true&w=majority
   ```
6. In **Network Access**, add `0.0.0.0/0` (allow all IPs) so Vercel can connect.

---

## Step 2 — Create GitHub Repository

```bash
# In the urbex-map project folder:
git init
git add .
git commit -m "Initial commit: URBEX·DB"

# On GitHub, create a new repo named 'urbex-map' (no README, no .gitignore)
# Then:
git remote add origin https://github.com/YOUR_USERNAME/urbex-map.git
git branch -M main
git push -u origin main
```

---

## Step 3 — Deploy on Vercel

1. Go to [https://vercel.com](https://vercel.com) and log in.
2. Click **Add New → Project**.
3. Import your `urbex-map` GitHub repository.
4. Under **Framework Preset**, choose **Other** (not Next.js).
5. Leave **Root Directory** as `/`.
6. Under **Environment Variables**, add:
   - **Name:** `MONGO_URI`
   - **Value:** your full MongoDB connection string from Step 1
7. Click **Deploy**.

---

## Step 4 — Verify API Routes

After deployment, test these endpoints in your browser or with curl:

```bash
# Should return [] or an array of locations:
curl https://your-app.vercel.app/api/locations

# Create a test location:
curl -X POST https://your-app.vercel.app/api/locations \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Site","latitude":51.5,"longitude":-0.09}'
```

---

## Local Development

```bash
# Install dependencies
npm install

# Create a .env.local file:
echo 'MONGO_URI=your_connection_string_here' > .env.local

# Run local dev server (requires Vercel CLI)
npm run dev
# → App at http://localhost:3000
```

---

## Features

| Feature | Details |
|---|---|
| 🗺️ Map | Leaflet.js, OSM + Satellite (ESRI) tile layers |
| 📍 Markers | Grey = unvisited, Blue = visited. Clustered for performance |
| ➕ Add | FAB → click map to place pin → fill form |
| 📋 Detail view | Image, title, desc, coords, visited toggle, edit, delete |
| ✏️ Edit | Pre-filled form, PATCH to MongoDB |
| 🗑️ Delete | Confirm dialog, removes from DB + map |
| 🔍 Search | Debounced, real-time marker dimming |
| 🗂️ Cache | localStorage cache with 5-min TTL, background refresh |
| 📡 API | 4 endpoints: GET / POST / PATCH / DELETE |
| 📱 Mobile | Mobile-first responsive, bottom-sheet modals on small screens |
| 🍎 / 🗺️ Maps | Clickable coordinates → Apple Maps or Google Maps |

---

## Environment Variables

| Variable | Description |
|---|---|
| `MONGO_URI` | Full MongoDB Atlas connection string |

---

## Troubleshooting

**API returns 500 errors**
- Check your `MONGO_URI` in Vercel's Environment Variables panel.
- Ensure your Atlas cluster has `0.0.0.0/0` in Network Access.
- Redeploy after changing environment variables.

**Markers not showing**
- Open DevTools → Network tab and check `/api/locations`.
- Confirm your MongoDB `urbexdb.locations` collection exists (it's auto-created on first insert).

**CORS errors**
- The `vercel.json` handles CORS headers. Make sure you haven't modified it.
- For local dev, use `vercel dev` — not a plain HTTP server.
