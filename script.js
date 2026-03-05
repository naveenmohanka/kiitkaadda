/* ══════════════════════════════════════════════════════════════
   KIITKAADDA – script.js  v4
   Key fixes vs v3:
   ① Firebase Auth imported once, lazily, in initFirebaseAuth()
   ② Firestore imported once, lazily, in initFirebase()
   ③ Local app state object renamed from 'auth' → 'usr' to avoid
      collision with the Firebase Auth instance (fbAuth)
   ④ sendOtp() / verOtp() use the module-level fbAuth handle
   ⑤ verOtp() advances vendor to the secret-code step, students
      to the name step — no more skipping straight to the app
   ⑥ verVendorSecret() checks secret then goes to name step
   ⑦ FIREBASE_CFG typo fixed (was referencing undefined variable)
   ⑧ RecaptchaVerifier created once, lazily, on first sendOtp()
   ⑨ Demo OTP "123456" hint removed; real Firebase OTP used
   ⑩ Google login restricted to @kiit.ac.in emails
   ⑪ All functions exposed to window via Object.assign at bottom
══════════════════════════════════════════════════════════════ */

/* ══ FIREBASE CONFIG ══════════════════════════════════════════
   Replace with your real credentials from Firebase Console.
   This is the single source of truth — vendor.html and
   token-display.html must use the same values.
══════════════════════════════════════════════════════════════ */

const FIREBASE_CFG = {
  apiKey:            "AIzaSyCbqQji9tEeBBUiJsM2y2-GgXlbHevMi2M",
  authDomain:        "kiitkaadda.firebaseapp.com",
  projectId:         "kiitkaadda",
  storageBucket:     "kiitkaadda.firebasestorage.app",
  messagingSenderId: "328400914164",
  appId:             "1:328400914164:web:40c08e40aa198c1f8c00a1",
  measurementId:     "G-6LJLET1CW7"
};

/* ══ VENDOR SECRET CODE ═══════════════════════════════════════
   Change this to whatever code you issue to your vendors.
   In production, validate this server-side or store a hashed
   version in Firestore instead of hardcoding.
══════════════════════════════════════════════════════════════ */
const VENDOR_SECRET = "KIIT2025";

/* ══ FIREBASE LAZY HANDLES ════════════════════════════════════
   Firestore handles
══════════════════════════════════════════════════════════════ */
let _db = null;
let _addDoc = null, _collection = null, _serverTimestamp = null;
let _onSnapshot = null, _query = null, _orderBy = null;
let _doc = null, _updateDoc = null, _where = null, _getDocs = null;

/* Firebase Auth handles */
let fbApp  = null;   // shared Firebase app instance
let fbAuth = null;   // Firebase Auth instance
let _signInWithPhoneNumber = null;
let _RecaptchaVerifier     = null;
let _GoogleAuthProvider    = null;
let _signInWithPopup       = null;

/* OTP confirmation result (returned by signInWithPhoneNumber) */
let confirmationResult = null;

/* reCAPTCHA verifier (created once, reused) */
let recaptchaVerifier = null;

/* ── Init Firestore ── */
async function initFirebase() {
  if (_db) return true;
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js");
    const fs = await import("https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js");
    if (!fbApp) fbApp = initializeApp(FIREBASE_CFG);
    _db              = fs.getFirestore(fbApp);
    _addDoc          = fs.addDoc;
    _collection      = fs.collection;
    _serverTimestamp = fs.serverTimestamp;
    _onSnapshot      = fs.onSnapshot;
    _query           = fs.query;
    _orderBy         = fs.orderBy;
    _doc             = fs.doc;
    _updateDoc       = fs.updateDoc;
    _where           = fs.where;
    _getDocs         = fs.getDocs;
    return true;
  } catch(e) {
    console.warn("Firestore unavailable:", e.message);
    return false;
  }
}

/* ── Init Firebase Auth ── */
async function initFirebaseAuth() {
  if (fbAuth) return true;
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js");
    const authMod = await import("https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js");
    if (!fbApp) fbApp = initializeApp(FIREBASE_CFG);
    fbAuth                 = authMod.getAuth(fbApp);
    _signInWithPhoneNumber = authMod.signInWithPhoneNumber;
    _RecaptchaVerifier     = authMod.RecaptchaVerifier;
    _GoogleAuthProvider    = authMod.GoogleAuthProvider;
    _signInWithPopup       = authMod.signInWithPopup;
    return true;
  } catch(e) {
    console.warn("Firebase Auth unavailable:", e.message);
    return false;
  }
}

/* ── Ensure reCAPTCHA is ready ──
   IMPORTANT:
   • size:"invisible" means NO visible checkbox — it runs silently in background.
   • We do NOT pre-render on page load — only create it when user actually
     taps "Send OTP", to avoid the widget appearing before it's needed.
   • On any failure we destroy and recreate it so the next attempt works.
── */
async function ensureRecaptcha() {
  await initFirebaseAuth();
  if (!recaptchaVerifier) {
    recaptchaVerifier = new _RecaptchaVerifier(fbAuth, 'recaptcha-container', {
      size: 'invisible',
      callback: () => {},          // OTP sent successfully
      'expired-callback': () => {  // token expired — reset so next try works
        resetRecaptcha();
      }
    });
  }
}

function resetRecaptcha() {
  try {
    if (recaptchaVerifier) { recaptchaVerifier.clear(); }
  } catch(e) {}
  recaptchaVerifier = null;
  /* Also wipe the container so Firebase can re-inject cleanly */
  const c = document.getElementById('recaptcha-container');
  if (c) c.innerHTML = '';
}

/* ══ MENU DATA ════════════════════════════════════════════════ */
const MENUS = {
  FC1: {
    title: '<span class="fa">FC1</span> — South Indian',
    subtitle: 'South Indian & Snacks', emoji: '🍛', status: 'open',
    cats: ['All','Breakfast','Main','Snacks','Drinks'],
    items: [
      {id:1,  name:'Masala Dosa',    desc:'Crispy dosa with spiced potato filling',     price:60,  emoji:'🫓', cat:'Breakfast', veg:true},
      {id:2,  name:'Idli Sambar',    desc:'3 steamed rice cakes with sambar & chutney', price:40,  emoji:'🍚', cat:'Breakfast', veg:true},
      {id:3,  name:'Medu Vada',      desc:'2 crispy vadas with coconut chutney',        price:35,  emoji:'🍩', cat:'Snacks',    veg:true},
      {id:4,  name:'Bisi Bele Bath', desc:'Spiced rice & lentil one-pot dish',          price:55,  emoji:'🥘', cat:'Main',      veg:true},
      {id:5,  name:'Filter Coffee',  desc:'Authentic South Indian filter coffee',        price:20,  emoji:'☕', cat:'Drinks',    veg:true},
      {id:6,  name:'Rava Upma',      desc:'Semolina cooked with curry leaves',          price:45,  emoji:'🍲', cat:'Breakfast', veg:true},
    ]
  },
  FC2: {
    title: '<span class="fa">FC2</span> — Chinese',
    subtitle: 'Chinese & Fast Food', emoji: '🍜', status: 'busy',
    cats: ['All','Rice','Noodles','Starters','Drinks'],
    items: [
      {id:7,  name:'Veg Fried Rice',     desc:'Wok-tossed rice with mixed veggies',   price:80,  emoji:'🍚', cat:'Rice',     veg:true},
      {id:8,  name:'Chow Mein',          desc:'Stir-fried noodles with veggies',       price:75,  emoji:'🍜', cat:'Noodles',  veg:true},
      {id:9,  name:'Gobi Manchurian',    desc:'Crispy cauliflower in tangy sauce',     price:90,  emoji:'🥦', cat:'Starters', veg:true},
      {id:10, name:'Spring Rolls',       desc:'4 crispy vegetable spring rolls',       price:60,  emoji:'🌯', cat:'Starters', veg:true},
      {id:11, name:'Schezwan Noodles',   desc:'Fiery Indo-Chinese noodles',            price:85,  emoji:'🍝', cat:'Noodles',  veg:true},
      {id:12, name:'Chicken Fried Rice', desc:'Wok-tossed rice with tender chicken',   price:110, emoji:'🍗', cat:'Rice',     veg:false},
    ]
  },
  FC3: {
    title: '<span class="fa">FC3</span> — Rolls & Sandwiches',
    subtitle: 'Rolls, Wraps & Sandwiches', emoji: '🥪', status: 'open',
    cats: ['All','Wraps','Sandwiches','Burgers'],
    items: [
      {id:13, name:'Paneer Frankie', desc:'Spiced paneer rolled in paratha',       price:70, emoji:'🌯', cat:'Wraps',      veg:true},
      {id:14, name:'Egg Roll',       desc:'Egg & veggie roll with mint chutney',   price:55, emoji:'🥚', cat:'Wraps',      veg:false},
      {id:15, name:'Club Sandwich',  desc:'Triple-decker toasted veg sandwich',    price:65, emoji:'🥪', cat:'Sandwiches', veg:true},
      {id:16, name:'Veg Burger',     desc:'Crispy veg patty, lettuce & sauces',    price:80, emoji:'🍔', cat:'Burgers',    veg:true},
      {id:17, name:'Cheese Toast',   desc:'Loaded cheese toast with veggies',      price:50, emoji:'🍞', cat:'Sandwiches', veg:true},
    ]
  },
  FC4: {
    title: '<span class="fa">FC4</span> — Beverages & Desserts',
    subtitle: 'Beverages & Desserts', emoji: '☕', status: 'open',
    cats: ['All','Hot Drinks','Cold Drinks','Desserts'],
    items: [
      {id:18, name:'Cold Coffee',  desc:'Chilled blended coffee with ice cream', price:55, emoji:'🧋', cat:'Cold Drinks', veg:true},
      {id:19, name:'Mango Lassi',  desc:'Thick yoghurt mango smoothie',          price:45, emoji:'🥭', cat:'Cold Drinks', veg:true},
      {id:20, name:'Masala Chai',  desc:'Freshly brewed spiced tea',             price:15, emoji:'🫖', cat:'Hot Drinks',  veg:true},
      {id:21, name:'Brownie',      desc:'Fudgy chocolate brownie',               price:40, emoji:'🍫', cat:'Desserts',    veg:true},
      {id:22, name:'Oreo Shake',   desc:'Thick Oreo milkshake',                  price:65, emoji:'🥤', cat:'Cold Drinks', veg:true},
    ]
  }
};



/* ══ APP STATE ════════════════════════════════════════════════
   NOTE: renamed from 'auth' → 'usr' to avoid shadowing the
   Firebase Auth instance (fbAuth) used in OTP functions.
══════════════════════════════════════════════════════════════ */
const AK = 'kk_auth', DK = 'kk_data';
let usr   = {role:'student', method:'', phone:'', gemail:'', name:'', in:false, refCode:'', coins:0};
let state = {cart:{}, fc:'FC1', cat:'All', coins:0, hist:[]};
let lRole = 'student';
let selGA = null;   // index of selected Google account

/* ══ PERSIST ══════════════════════════════════════════════════ */
function ldAuth()  {
  try { const s=localStorage.getItem(AK); if(s) Object.assign(usr,JSON.parse(s)); } catch(e){}
}
function svAuth()  {
  try { localStorage.setItem(AK, JSON.stringify(usr)); } catch(e){}
}
function ldState() {
  try {
    const s=localStorage.getItem(DK);
    if(s){ const p=JSON.parse(s); state.cart=p.cart||{}; state.coins=p.coins??0; state.hist=p.hist||[]; }
  } catch(e){}
}
function svState() {
  try { localStorage.setItem(DK, JSON.stringify({cart:state.cart,coins:state.coins,hist:state.hist})); } catch(e){}
}

/* ══ TOAST ════════════════════════════════════════════════════ */
function toast(msg, type='') {
  const c  = document.getElementById('tc');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' '+type : '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'tOut .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

/* ── Set button loading state ── */
function setBtnLoading(id, loading, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  if (label) btn.textContent = label;
}

/* ══ NAVIGATION ═══════════════════════════════════════════════ */
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const t = document.getElementById(id);
  if (t) t.classList.add('active');
}

function switchNav(tab) {
  ['home','cart','orders','profile'].forEach(t =>
    document.getElementById('nv-'+t)?.classList.remove('active')
  );
  document.getElementById('nv-'+tab)?.classList.add('active');
  if (tab === 'home')    goTo('sc-home');
  if (tab === 'cart')    { rCart();    goTo('sc-cart');    }
  if (tab === 'orders')  { rOrders();  goTo('sc-orders');  }
  if (tab === 'profile') { rProfile(); goTo('sc-profile'); }
}

/* ══ LOGIN FLOW ════════════════════════════════════════════════

   Student path:
     selRole('student') → showGoogle() → types @kiit.ac.in email → doGoogle()
                        → showPhone()  → sendOtp() → verOtp()
       → showName() → finLogin() → launchApp()

   Vendor path:
     selRole('vendor') → showPhone() → sendOtp() → verOtp()
       → showVendorSecret() → verVendorSecret()
       → showName() → finLogin() → vendor.html

══════════════════════════════════════════════════════════════ */

function selRole(r) {
  lRole = r;
  document.getElementById('rt-student').classList.toggle('active', r==='student');
  document.getElementById('rt-vendor').classList.toggle('active',  r==='vendor');

  /* For vendors: hide Google/email button AND the "or" divider — phone only */
  const isVendor = r === 'vendor';
  const gBtn  = document.getElementById('google-btn');
  const gDiv  = document.getElementById('google-divider');
  if (gBtn) gBtn.style.display  = isVendor ? 'none' : '';
  if (gDiv) gDiv.style.display  = isVendor ? 'none' : '';

  /* Hide referral field for vendors */
  const rr = document.getElementById('ref-row');
  if (rr) rr.style.display = isVendor ? 'none' : '';

  backMethod();
}

function backMethod() {
  document.getElementById('s-method').style.display = '';
  ['s-phone','s-google','s-name','s-vendor-code'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.classList.remove('on'); }
  });
}

function showPhone() {
  document.getElementById('s-method').style.display = 'none';
  const el = document.getElementById('s-phone');
  el.style.display = 'flex'; el.classList.add('on');
  document.getElementById('oe').style.display = 'none';
  document.getElementById('pe').style.display = '';
  setTimeout(() => document.getElementById('ph').focus(), 100);
}

/* ── sendOtp: called when user taps "Send OTP →" ── */
async function sendOtp() {
  let num = document.getElementById('ph').value.trim().replace(/\D/g, '');
  if (num.length !== 10) {
    toast('⚠️ Enter a valid 10-digit number', 'e');
    return;
  }
  const phone = '+91' + num;

  /* Show loading state */
  const btn = document.getElementById('send-otp-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    await ensureRecaptcha();
    confirmationResult = await _signInWithPhoneNumber(fbAuth, phone, recaptchaVerifier);

    /* Success — show OTP input */
    document.getElementById('opd').textContent = phone;
    document.getElementById('pe').style.display = 'none';
    document.getElementById('oe').style.display = 'block';
    document.getElementById('o0').focus();
    toast('📱 OTP sent to ' + phone, 's');

  } catch(err) {
    console.error('sendOtp error:', err);

    /* Reset captcha so user can try again without refreshing */
    resetRecaptcha();

    /* Show a human-readable error */
    const code = err.code || '';
    let msg = '❌ Failed to send OTP. Please try again.';
    if (code === 'auth/invalid-phone-number')  msg = '❌ Invalid phone number. Check and retry.';
    if (code === 'auth/too-many-requests')     msg = '⏳ Too many attempts. Wait a minute and retry.';
    if (code === 'auth/captcha-check-failed')  msg = '❌ Captcha failed. Please retry.';
    if (code === 'auth/quota-exceeded')        msg = '⚠️ SMS quota exceeded. Try later.';
    toast(msg, 'e');

  } finally {
    /* Restore button regardless of success/failure */
    if (btn) { btn.disabled = false; btn.textContent = 'Send OTP →'; }
  }
}

function backPe() {
  document.getElementById('pe').style.display = '';
  document.getElementById('oe').style.display = 'none';
  /* Clear OTP digits */
  for (let i=0; i<6; i++) document.getElementById('o'+i).value = '';
}

/* OTP digit input helpers */
function oi(el, i) {
  el.value = el.value.replace(/\D/g,'').slice(-1);
  if (el.value && i < 5) document.getElementById('o'+(i+1)).focus();
}
function ok(el, i) {
  if (event.key === 'Backspace' && !el.value && i > 0)
    document.getElementById('o'+(i-1)).focus();
}

/* ── verOtp: called when user taps "Verify OTP →" ── */
async function verOtp() {
  let code = '';
  for (let i=0; i<6; i++) code += document.getElementById('o'+i).value;

  if (code.length !== 6) {
    toast('⚠️ Enter all 6 OTP digits', 'e');
    return;
  }

  const verBtn = document.querySelector('#oe .lcta');
  if (verBtn) { verBtn.disabled = true; verBtn.textContent = 'Verifying…'; }

  try {
    if (!confirmationResult) throw new Error('No OTP session. Please resend OTP.');
    const result = await confirmationResult.confirm(code);
    const firebasePhone = result.user.phoneNumber; // e.g. "+911234567890"

    /* Store verified phone in usr */
    usr.phone  = firebasePhone.replace('+91','');
    usr.method = 'phone';

    toast('✅ Phone verified!', 's');

    if (lRole === 'vendor') {
      /* Vendors must pass the secret code check next */
      showVendorSecret();
    } else {
      /* Students go to name entry (or launch app if returning user) */
      if (usr.in && usr.name) {
        finLogin();
      } else {
        showName();
      }
    }

  } catch(err) {
    console.error('verOtp error:', err);
    toast('❌ Wrong or expired OTP. Try again.', 'e');
  } finally {
    if (verBtn) { verBtn.disabled = false; verBtn.textContent = 'Verify OTP →'; }
  }
}

/* ── showVendorSecret: transition to secret-code step ── */
function showVendorSecret() {
  ['s-phone','s-google','s-method','s-name'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.classList.remove('on'); }
  });
  const el = document.getElementById('s-vendor-code');
  if (el) { el.style.display = 'flex'; el.classList.add('on'); }
  setTimeout(() => { const inp = document.getElementById('vc-inp'); if(inp) inp.focus(); }, 120);
}

/* ── verVendorCode: validate secret code (called by onclick="verVendorCode()") ── */
function verVendorCode() {
  const entered = document.getElementById('vc-inp').value.trim();
  const errEl   = document.getElementById('vc-err');
  if (entered !== VENDOR_SECRET) {
    if (errEl) errEl.style.display = 'block';
    document.getElementById('vc-inp').value = '';
    document.getElementById('vc-cta').disabled = true;
    return;
  }
  if (errEl) errEl.style.display = 'none';
  toast('&#x2705; Vendor verified!', 's');
  showName();
}
/* Alias so internal calls to verVendorSecret() still work */
const verVendorSecret = verVendorCode;

/* ── showGoogle: show KIIT email input step ── */
function showGoogle() {
  document.getElementById('s-method').style.display = 'none';
  const el = document.getElementById('s-google');
  el.style.display = 'flex'; el.classList.add('on');
  document.getElementById('gcta').disabled = true;
  const inp = document.getElementById('gemail-inp');
  if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 120); }
  const err = document.getElementById('gemail-err');
  if (err) err.style.display = 'none';
}

/* Called on every keystroke in the email input */
function onGEmailInput(val) {
  const err  = document.getElementById('gemail-err');
  const gcta = document.getElementById('gcta');
  const v    = val.trim().toLowerCase();
  const ok   = v.length > 0 && v.endsWith('@kiit.ac.in');
  /* Show error only after user has typed enough to look like an email */
  if (err) err.style.display = (v.includes('@') && !ok) ? 'block' : 'none';
  if (gcta) gcta.disabled = !ok;
}

/* pickGA kept as no-op so any leftover reference won't crash */
function pickGA() {}

/* ── doGoogle: validate email then proceed to name step ── */
function doGoogle() {
  const inp = document.getElementById('gemail-inp');
  const email = inp ? inp.value.trim().toLowerCase() : '';
  if (!email.endsWith('@kiit.ac.in')) {
    const err = document.getElementById('gemail-err');
    if (err) err.style.display = 'block';
    toast('Only @kiit.ac.in emails are allowed', 'e');
    return;
  }
  usr.method = 'google';
  usr.gemail = email;
  /* Pre-fill name from email local-part (e.g. "naveen.kumar" → "Naveen Kumar") */
  const local    = email.split('@')[0];
  const autoName = local.split(/[._]/).map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  const ni       = document.getElementById('ni');
  if (ni) { ni.value = autoName; }
  const ncta = document.getElementById('ncta');
  if (ncta) ncta.disabled = autoName.trim().length < 2;
  showName();
}

/* ── showName: transition to name entry step ── */
function showName() {
  document.getElementById('s-method').style.display = 'none';
  ['s-phone','s-google','s-vendor-code'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.classList.remove('on'); }
  });
  const el = document.getElementById('s-name');
  el.style.display = 'flex'; el.classList.add('on');
  setTimeout(() => {
    const ni = document.getElementById('ni');
    if (ni && !ni.value) ni.focus();
  }, 150);
}

/* ── Generate referral code ── */
function makeRefCode(name) {
  const clean = (name||'KK').replace(/\s+/g,'').toUpperCase().slice(0,4);
  const rand   = Math.floor(1000 + Math.random()*9000);
  return clean + rand;
}

/* ── finLogin: called when name step is confirmed ── */
function finLogin() {
  const name = document.getElementById('ni').value.trim();
  if (name.length < 2) { toast('⚠️ Please enter your name','e'); return; }

  /* Process referral code (students only) */
  const refInp    = document.getElementById('ref-inp');
  const enteredRef = refInp ? refInp.value.trim().toUpperCase() : '';

  usr.name = name;
  usr.role = lRole;
  usr.in   = true;

  /* Assign referral code if new student */
  if (lRole === 'student' && !usr.refCode) {
    usr.refCode = makeRefCode(name);
  }

  /* Award referral coins if a valid external code was entered */
  if (lRole === 'student' && enteredRef && enteredRef !== usr.refCode) {
    state.coins = (state.coins||0) + 20;
    svState();
    toast('🎁 Referral bonus! +20 coins credited','s');
  }

  svAuth();

  if (usr.role === 'vendor') {
    toast('🧑‍🍳 Logging in as Vendor…','s');
    setTimeout(() => { window.location.href = 'vendor.html'; }, 800);
    return;
  }
  launchApp();
}

/* ══ APP LAUNCH ══════════════════════════════════════════════ */
function launchApp() {
  document.getElementById('login-ov').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  ldState();
  /* Sync coins */
  if ((usr.coins||0) > (state.coins||0)) state.coins = usr.coins;
  updateGreeting(); updBadge();
  document.getElementById('cdis').textContent = state.coins;

  /* QR deep-link: ?fc=FC1 opens that food court directly */
  const urlFC = new URLSearchParams(window.location.search).get('fc');
  if (urlFC && MENUS[urlFC]) {
    setTimeout(() => openMenu(urlFC), 300);
  }

  toast(`👋 Welcome, ${usr.name}!`, 's');
}

function updateGreeting() {
  const el = document.getElementById('gname');
  if (el) el.textContent = usr.name || 'KIITian';
}

/* ══ LOGOUT ══════════════════════════════════════════════════ */
function logout() {
  if (!confirm('Logout from KiitKaadda?')) return;
  localStorage.clear();
  window.location.href = window.location.pathname;
}

/* ══ MENU ════════════════════════════════════════════════════ */
function openMenu(fc) {
  state.fc = fc; state.cat = 'All';
  const m = MENUS[fc];
  document.getElementById('mt').innerHTML = m.title;
  document.getElementById('mm').innerHTML =
    `<span class="mpill">🍽️ ${m.items.length} items</span>` +
    `<span class="mpill fcst ${m.status}" style="padding:3px 10px;">${m.status==='open'?'Open':'Busy'}</span>`;
  const o = Math.floor(2+Math.random()*8), w = Math.floor(o*1.5+3);
  document.getElementById('qo').textContent = o;
  document.getElementById('qw').textContent = w + ' min';
  document.getElementById('qs').textContent = o>6 ? '🔴 High' : o>3 ? '🟡 Med' : '🟢 Low';
  rTabs(m.cats); rItems(m.items); updFAB(); goTo('sc-menu');
}

function rTabs(cats) {
  document.getElementById('ctabs').innerHTML = cats.map(c =>
    `<div class="tab ${c===state.cat?'active':''}" onclick="selCat('${c}')">${c}</div>`
  ).join('');
}

function selCat(c) {
  state.cat = c;
  const m = MENUS[state.fc];
  rTabs(m.cats);
  rItems(c === 'All' ? m.items : m.items.filter(i => i.cat === c));
}

function rItems(items) {
  const l = document.getElementById('mlist');
  if (!items.length) {
    l.innerHTML = '<div style="padding:40px 0;text-align:center;color:var(--muted);font-size:14px;">No items here</div>';
    return;
  }
  l.innerHTML = items.map(it => {
    const ic = state.cart[it.id];
    const ctrl = ic
      ? `<div class="iqty"><button class="qbtn" onclick="cmq(${it.id},-1)">−</button><span class="qnum">${ic.qty}</span><button class="qbtn" onclick="cmq(${it.id},1)">+</button></div>`
      : `<button class="abtn" onclick="addC(${it.id})">+</button>`;
    return `<div class="mit">
      <div class="mie">${it.emoji}</div>
      <div class="mii">
        <div class="min"><span class="vdot ${it.veg?'v':'nv'}"></span>${it.name}</div>
        <div class="mid">${it.desc}</div>
        <div class="mip">₹${it.price}</div>
      </div>
      <div class="ic" id="ic${it.id}">${ctrl}</div>
    </div>`;
  }).join('');
}

/* ══ CART ════════════════════════════════════════════════════ */
function allItems() { return Object.values(MENUS).flatMap(m => m.items); }

function addC(id) {
  const it = allItems().find(i => i.id===id); if (!it) return;
  if (state.cart[id]) state.cart[id].qty++;
  else state.cart[id] = {item:it, qty:1};
  svState(); rfCtrl(id); updFAB(); updBadge();
  toast(`✅ ${it.name} added`, 's');
}

function cmq(id, d) {
  if (!state.cart[id]) return;
  state.cart[id].qty += d;
  if (state.cart[id].qty <= 0) delete state.cart[id];
  svState(); rfCtrl(id); updFAB(); updBadge();
}

function rfCtrl(id) {
  const el = document.getElementById('ic'+id); if (!el) return;
  const ic = state.cart[id];
  el.innerHTML = ic
    ? `<div class="iqty"><button class="qbtn" onclick="cmq(${id},-1)">−</button><span class="qnum">${ic.qty}</span><button class="qbtn" onclick="cmq(${id},1)">+</button></div>`
    : `<button class="abtn" onclick="addC(${id})">+</button>`;
}

function cTot() { return Object.values(state.cart).reduce((s,c) => s+c.item.price*c.qty, 0); }
function cCnt() { return Object.values(state.cart).reduce((s,c) => s+c.qty, 0); }

function updFAB() {
  const fab = document.getElementById('cfab'); if (!fab) return;
  const n   = cCnt();
  const fbc = document.getElementById('fbc');
  const fbl = document.getElementById('fbl');
  const fbt = document.getElementById('fbt');
  if (n === 0) {
    fab.classList.add('empty');
    fbc.textContent = 'Cart is empty';
    if (fbl) fbl.textContent = '';
    if (fbt) fbt.textContent = '';
    fab.onclick = null;
  } else {
    fab.classList.remove('empty');
    fbc.textContent = n + ' item' + (n>1?'s':'');
    if (fbl) fbl.textContent = 'View Cart •';
    if (fbt) fbt.textContent = '₹' + cTot();
    fab.onclick = goCart;
  }
}

function updBadge() {
  const n = cCnt(), b = document.getElementById('nbadge'); if (!b) return;
  b.textContent = n; b.classList.toggle('on', n>0);
}

function goCart() {
  rCart(); goTo('sc-cart');
  ['home','cart','orders','profile'].forEach(t =>
    document.getElementById('nv-'+t)?.classList.remove('active')
  );
  document.getElementById('nv-cart').classList.add('active');
}

function rCart() {
  const ent   = Object.entries(state.cart);
  const body  = document.getElementById('cbody');
  const empty = document.getElementById('cempty');
  document.getElementById('cftag').textContent = state.fc;
  if (!ent.length) { body.style.display='none'; empty.style.display='flex'; return; }
  body.style.display='flex'; empty.style.display='none';
  document.getElementById('citems').innerHTML = ent.map(([id,{item:it,qty}]) => `
    <div class="cr">
      <div class="ce">${it.emoji}</div>
      <div class="ci2">
        <div class="cn2">${it.name}</div>
        <div class="cp2">₹${it.price} × ${qty} = ₹${it.price*qty}</div>
      </div>
      <div class="iqty">
        <button class="qbtn" onclick="ccq(${id},-1)">−</button>
        <span class="qnum">${qty}</span>
        <button class="qbtn" onclick="ccq(${id},1)">+</button>
      </div>
    </div>`).join('');
  const s = cTot();
  document.getElementById('ssub').textContent = '₹'+s;
  document.getElementById('stot').textContent = '₹'+(s+2);
  document.getElementById('chkbtn').disabled  = s===0;
  const ua = document.getElementById('upi-amt');
  if (ua) ua.textContent = '₹'+(s+2);
  const ub = document.getElementById('upi-btn');
  if (ub) ub.disabled = s===0;
}

function ccq(id, d) {
  id = Number(id); if (!state.cart[id]) return;
  state.cart[id].qty += d;
  if (state.cart[id].qty <= 0) delete state.cart[id];
  svState(); rCart(); updFAB(); updBadge(); rfCtrl(id);
}

/* ══ UPI PAYMENT ═════════════════════════════════════════════ */
function doUPI() {
  const tot = cTot();
  if (!tot) { toast('Cart is empty', 'e'); return; }
  const total  = tot + 2;
  const upiUrl = `upi://pay?pa=7070676297@ybl&pn=KiitKaadda&am=${total}&cu=INR&tn=KiitKaadda+Order`;
  const link   = document.createElement('a');
  link.href    = upiUrl;
  link.click();
  toast('💳 Opening UPI app… confirming in 2s (demo)', 's');
  setTimeout(() => placeOrder(), 2000);
}

/* ══ TOKEN NUMBER SYSTEM ════════════════════════════════════ */
function getNextToken(fc) {
  const key = 'kk_tok_' + fc;
  const n   = parseInt(localStorage.getItem(key)||'100', 10) + 1;
  localStorage.setItem(key, String(n));
  return n;
}

/* ══ PLACE ORDER (Firebase + local) ════════════════════════ */
async function placeOrder() {
  const tot = cTot(); if (!tot) return;
  const coins     = Math.max(5, Math.floor(tot/100)*5);
  const tokenNum  = getNextToken(state.fc);
  const tok       = '#' + tokenNum;
  const wait      = 8 + Math.floor(Math.random()*10);
  const orderId   = 'ORD' + Date.now().toString(36).toUpperCase();
  const itemsList = Object.values(state.cart).map(c => ({name:c.item.name, qty:c.qty, price:c.item.price}));
  const itemNames = itemsList.map(i => i.name);

  /* Save to Firestore */
  try {
    const ok = await initFirebase();
    if (ok) await _addDoc(_collection(_db,'orders'), {
      orderId,
      tokenNumber: tokenNum,
      token:       tok,
      fc:          state.fc,
      foodCourt:   state.fc,
      items:       itemsList,
      itemNames,
      totalPrice:  tot + 2,
      status:      'new',
      studentName: usr.name || 'Student',
      wait,
      timestamp:   _serverTimestamp()
    });
  } catch(e) { console.warn('Firestore:', e.message); }

  /* Local history */
  state.hist.unshift({
    id:orderId, tok, tokenNum, fc:state.fc,
    items:itemNames, total:tot+2, coins, wait,
    time:new Date().toISOString(), status:'preparing'
  });
  state.coins = (state.coins||0) + coins;
  svState();

  /* Update UI */
  document.getElementById('tnum').textContent  = tok;
  document.getElementById('tfc').textContent   = state.fc + ' · ' + MENUS[state.fc].subtitle;
  document.getElementById('twait').textContent = '⏱ Est. ready in ' + wait + ' min';
  document.getElementById('cen').textContent   = ' ' + coins + ' ';
  document.getElementById('cdis').textContent  = state.coins;

  state.cart = {}; updFAB(); updBadge();
  goTo('sc-confirm'); toast('🎉 Order placed! Token ' + tok, 's');
}

/* ══ ORDERS HISTORY ══════════════════════════════════════════ */
function rOrders() {
  const l = document.getElementById('olist');
  if (!state.hist.length) {
    l.innerHTML = '<div class="nord"><div class="oi">📋</div><p>No orders yet.<br>Place your first order!</p></div>';
    return;
  }
  l.innerHTML = state.hist.map(o => {
    const d = new Date(o.time);
    return `<div class="ocard">
      <div class="ocH">
        <div><div class="ocT">${o.tok}</div><div class="ocfc">${o.fc}</div></div>
        <div class="octime">
          ${d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}<br>
          ${d.toLocaleDateString('en-IN',{day:'numeric',month:'short'})}
        </div>
      </div>
      <div class="ocitems">${o.items.join(' · ')}</div>
      <div class="ocfoot">
        <div class="osb ${o.status}">${o.status.charAt(0).toUpperCase()+o.status.slice(1)}</div>
        <div class="otv">₹${o.total}</div>
      </div>
    </div>`;
  }).join('');
}

/* ══ PROFILE ══════════════════════════════════════════════════ */
function rProfile() {
  const ini = usr.name ? usr.name.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '?';
  document.getElementById('pav').textContent  = ini;
  document.getElementById('pdn').textContent  = usr.name || '–';
  const rt = document.getElementById('prt');
  rt.textContent = usr.role==='vendor' ? '🧑‍🍳 Vendor' : '🎓 Student';
  rt.className   = 'prt ' + usr.role;
  document.getElementById('pcoins').textContent = state.coins + ' 🪙';
  document.getElementById('pords').textContent  = state.hist.length;
  const rc = document.getElementById('p-refcode');
  if (rc) rc.textContent = usr.refCode || '––';
  const mm = {
    phone:  '📱 Phone (+91 ' + (usr.phone||'–') + ')',
    google: '🔵 Google (' + (usr.gemail||'–') + ')'
  };
  document.getElementById('plm').textContent = mm[usr.method] || '–';
}

/* ══ REFERRAL SYSTEM ══════════════════════════════════════════ */
function showReferral() {
  const card = document.getElementById('ref-card');
  if (!card) return;
  const code = usr.refCode || makeRefCode(usr.name||'KK');
  usr.refCode = code; svAuth();
  document.getElementById('ref-code-disp').textContent = code;
  card.style.display = card.style.display==='none' ? 'block' : 'none';
  if (card.style.display==='block') toast('💡 Collect 100 coins for a free item!', 's');
}

function copyReferralCode() {
  const code = usr.refCode || '';
  if (!code) { toast('Login first to get your code','e'); return; }
  navigator.clipboard.writeText(code)
    .then(()  => toast('📋 Code '+code+' copied!','s'))
    .catch(()  => toast('Your code: '+code,'s'));
}

/* ══ QR DEEP LINK ══════════════════════════════════════════════ */
function copyQR(fc) {
  const url = window.location.origin + window.location.pathname + '?fc=' + fc;
  navigator.clipboard.writeText(url)
    .then(()  => toast('🔗 '+fc+' link copied! Share as QR','s'))
    .catch(()  => toast('Link: '+url));
}

/* ══ SEARCH ═══════════════════════════════════════════════════ */
function doSearch(q) {
  q = q.toLowerCase().trim(); if (!q) return;
  for (const [fc,m] of Object.entries(MENUS)) {
    if (m.items.some(i => i.name.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q))) {
      openMenu(fc);
      setTimeout(() => rItems(m.items.filter(i =>
        i.name.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q)
      )), 60);
      document.getElementById('srchi').value = ''; return;
    }
  }
  toast('🔍 No results for "'+q+'"');
}

/* ══ SHARE ════════════════════════════════════════════════════ */
async function shareApp() {
  try {
    if (navigator.share)
      await navigator.share({title:'KiitKaadda',text:'Skip the queue at KIIT food courts!',url:window.location.origin+window.location.pathname});
    else {
      await navigator.clipboard.writeText(window.location.origin+window.location.pathname);
      toast('🔗 Link copied!','s');
    }
  } catch(e) { if (e.name !== 'AbortError') toast('Copy the URL manually'); }
}

/* ══ PWA ══════════════════════════════════════════════════════ */
let dp = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); dp = e;
  if (!localStorage.getItem('ins_dis'))
    document.getElementById('iban').style.display = 'flex';
});
async function trigInst() {
  if (!dp) { toast('📲 Use "Add to Home Screen" in browser'); return; }
  dp.prompt();
  const {outcome} = await dp.userChoice;
  dp = null; document.getElementById('iban').style.display = 'none';
  if (outcome === 'accepted') toast('✅ App installed!','s');
}
function disInst() {
  localStorage.setItem('ins_dis','1');
  document.getElementById('iban').style.display = 'none';
}
window.addEventListener('appinstalled', () => {
  document.getElementById('iban').style.display = 'none';
  toast('🎉 Installed!','s');
});

/* ══ SERVICE WORKER ═══════════════════════════════════════════ */
if ('serviceWorker' in navigator)
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  );

/* ══ EXPOSE ALL FUNCTIONS TO WINDOW ══════════════════════════
   script.js is loaded as a classic (non-module) script so that
   we can use dynamic import() inside it AND still have all
   function declarations globally available.  We re-export them
   explicitly here to be explicit and safe.
══════════════════════════════════════════════════════════════ */
Object.assign(window, {
  /* login */
  selRole,
  backMethod,
  showPhone,
  sendOtp,
  backPe,
  oi,
  ok,
  verOtp,
  resetRecaptcha,
  showGoogle,
  pickGA,
  doGoogle,
  onGEmailInput,
  showVendorSecret,
  verVendorSecret,
  verVendorCode,
  finLogin,
  /* app */
  logout,
  shareApp,
  trigInst,
  disInst,
  /* navigation */
  goTo,
  switchNav,
  /* menu */
  openMenu,
  selCat,
  /* cart */
  addC,
  cmq,
  ccq,
  goCart,
  /* order */
  placeOrder,
  doUPI,
  /* search */
  doSearch,
  /* referral */
  showReferral,
  copyReferralCode,
  /* QR */
  copyQR,
  /* toast */
  toast,
});

/* ══ INIT ═════════════════════════════════════════════════════ */
(function init() {
  ldAuth();
  if (usr.in && usr.name) {
    if (usr.role === 'vendor') { window.location.href = 'vendor.html'; return; }
    launchApp();
  } else {
    document.getElementById('login-ov').style.display = 'flex';
    document.getElementById('app').style.display      = 'none';
    /* Firebase Auth will be lazily initialized when user taps Send OTP */
  }
})();
