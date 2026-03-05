# KiitKaadda – Firebase Setup Instructions

## Step 1 — Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **Add project**
3. Name it `kiitkaadda` (or anything you like)
4. Disable Google Analytics (optional)
5. Click **Create project**

---

## Step 2 — Add a Web App

1. In your Firebase project, click the **</>** (Web) icon
2. Register app name: `KiitKaadda Web`
3. Check **Also set up Firebase Hosting** (optional)
4. Click **Register app**
5. You will see a `firebaseConfig` object like this:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "kiitkaadda.firebaseapp.com",
  projectId: "kiitkaadda",
  storageBucket: "kiitkaadda.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};
```

---

## Step 3 — Replace Config in 3 Files

Replace the `YOUR_*` placeholders in each of these files:

### `script.js` (line ~17)
```js
const FIREBASE_CFG = {
  apiKey:            "AIza...",         // ← replace
  authDomain:        "kiitkaadda.firebaseapp.com",
  projectId:         "kiitkaadda",
  storageBucket:     "kiitkaadda.appspot.com",
  messagingSenderId: "1234567890",
  appId:             "1:1234...:web:abc123"
};
```

### `vendor.html` (line ~67)
Same config block inside the `<script type="module">` tag.

### `token-display.html` (line ~100)
Same config block inside the `<script type="module">` tag.

---

## Step 4 — Enable Firestore Database

1. In Firebase console → **Build** → **Firestore Database**
2. Click **Create database**
3. Choose **Start in test mode** (allows reads/writes without auth for development)
4. Select a region close to India (e.g., `asia-south1`)
5. Click **Done**

---

## Step 5 — Firestore Security Rules

For production, replace the default test rules with these:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /orders/{orderId} {
      // Anyone can create an order (students placing orders)
      allow create: if true;
      // Anyone can read orders (vendor dashboard, token display)
      allow read: if true;
      // Only allow status updates (not deletes)
      allow update: if request.resource.data.keys().hasOnly(['status'])
                    || request.resource.data.keys().hasOnly(['status', 'updatedAt']);
      // Never delete
      allow delete: if false;
    }
  }
}
```

---

## Step 6 — Firestore Index

The vendor dashboard queries orders ordered by `timestamp` descending.
Firestore may prompt you to create a composite index — just click the link
in the browser console error to auto-create it.

Or create it manually:
- Collection: `orders`
- Fields: `timestamp` Descending
- Query scope: Collection

---

## Step 7 — Deploy to Netlify

Make sure your deploy folder contains these files at the **root level**:

```
index.html
vendor.html
token-display.html
style.css
script.js
manifest.json
sw.js               ← create a basic one (see below)
icon-192.png        ← add your app icon
_redirects          ← already created
netlify.toml        ← already created
```

### Minimal `sw.js` (service worker for PWA)
```js
// sw.js – minimal service worker
const CACHE = 'kk-v3';
const ASSETS = ['/', '/index.html', '/style.css', '/script.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
```

---

## UPI Payment Setup

The UPI button uses this deep-link format:
```
upi://pay?pa=kiitkaadda@upi&pn=KiitKaadda&am=TOTAL&cu=INR
```

Replace `kiitkaadda@upi` with your actual UPI ID in `script.js` → `doUPI()` function.

---

## Token Display Screen

Open `token-display.html` on a TV or large screen near the food court.
It auto-refreshes via Firestore real-time listener.

URL: `https://kiitkaadda.netlify.app/token-display.html`

---

## QR Code Ordering

Each food court has a unique URL:
- FC1: `https://kiitkaadda.netlify.app/?fc=FC1`
- FC2: `https://kiitkaadda.netlify.app/?fc=FC2`
- FC3: `https://kiitkaadda.netlify.app/?fc=FC3`
- FC4: `https://kiitkaadda.netlify.app/?fc=FC4`

Use any free QR generator (e.g. qr-code-generator.com) to convert these
URLs into printable QR codes for each food court table/counter.

Students who scan the QR code are taken directly to that food court's menu.

---

## Feature Summary

| # | Feature | Status |
|---|---------|--------|
| 1 | Student vs Vendor login separation | ✅ |
| 2 | Firebase Firestore real-time orders | ✅ |
| 3 | Vendor dashboard with live updates | ✅ |
| 4 | Token number system (#101, #102…) | ✅ |
| 5 | Vendor notification sound (ding) | ✅ |
| 6 | Cart FAB always visible | ✅ |
| 7 | UPI payment button | ✅ |
| 8 | Live token display page | ✅ token-display.html |
| 9 | Vendor earnings report | ✅ |
| 10 | Referral reward system | ✅ |
| 11 | QR code table ordering (?fc=FC1) | ✅ |
| 12 | Navigation / scroll fixes | ✅ |
| 13 | PWA intact (manifest + install banner) | ✅ |
