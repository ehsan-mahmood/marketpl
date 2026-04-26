// ╔══════════════════════════════════════════════════════════════════╗
// ║  SECTION 1 — STORE CONFIG & SITE TEXT (data/context.json)         ║
// ║  Edit data/context.json: csv_url + optional products_source.        ║
// ║  Local CSV: csv_url = data/products.csv. Google Sheet: set          ║
// ║  products_source to google_sheets and csv_url to the Sheets CSV     ║
// ║  export URL (https://docs.google.com/.../export?format=csv…).      ║
// ║  fetch() does not work for file:// URLs.                        ║
// ╚══════════════════════════════════════════════════════════════════╝
var CTX = null;
var ASSET_BANNER_SLIDES = [];

function loadContext() {
  /* Query string avoids stale data/context.json when the browser or dev server caches aggressively. */
  return fetch('data/context.json?cb=' + Date.now(), { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('data/context.json HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      CTX = data;
    });
}

function loadAssetBannerSlides() {
  return fetch('/api/banners?cb=' + Date.now(), { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('/api/banners HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      var slides = data && Array.isArray(data.slides) ? data.slides : [];
      ASSET_BANNER_SLIDES = slides.map(function (u) { return String(u || '').trim(); }).filter(Boolean);
    })
    .catch(function () {
      ASSET_BANNER_SLIDES = [];
    });
}

// Internal alias used by the rest of the code (filled in applyContext)
var CFG = {
  WHATSAPP:   '',
  STORE_NAME: '',
  CSV_URL:    ''   // set from data/context.json csv_url in applyContext; '' → inline CSV fallback
};

// ── APPLY CONTEXT TO DOM ─────────────────────────────────────────
// Reads CTX and writes values into the HTML placeholders.
function applyContext() {
  if (!CTX) {
    console.error('CTX is not loaded — check data/context.json and use HTTP, not file://');
    return;
  }
  // Sync CFG from CTX (in case seller edited CTX after page load)
  // Digits only — wa.me expects country code + number, no + or spaces
  CFG.WHATSAPP   = String(CTX.whatsapp != null ? CTX.whatsapp : '').replace(/\D/g, '');
  CFG.STORE_NAME = CTX.store.name_en.replace(/<[^>]+>/g,'').trim();
  CFG.CSV_URL    = (CTX.csv_url != null && String(CTX.csv_url).trim() !== '')
    ? String(CTX.csv_url).trim()
    : '';

  document.title = CTX.page_title;

  // Announce bar
  si('announce-en').innerHTML = CTX.announce.en;
  si('announce-bn').innerHTML = CTX.announce.bn;

  // Logo
  si('logo-text-en').innerHTML  = CTX.store.name_en;
  si('logo-text-bn').innerHTML  = CTX.store.name_bn;
  si('logo-sub-en').textContent = CTX.store.tagline_en;
  si('logo-sub-bn').textContent = CTX.store.tagline_bn;

  // Trust strip
  CTX.trust_items.forEach(function(item, i){
    var el = si('trust-'+i); if (!el) return;
    el.innerHTML = '<span class="trust-icon">'+item.icon+'</span>'
      +'<span class="en">'+item.en+'</span>'
      +'<span class="bn">'+item.bn+'</span>';
  });

  // Payment badges
  var payMap = { bkash:'bKash', nagad:'Nagad', cod:'COD' };
  si('pay-badges').innerHTML = CTX.pay_methods.map(function(m){
    return '<div class="pay-badge '+m+'">'+payMap[m]+'</div>';
  }).join('');

  applyPayMethodVisibility();

  // Hero copy
  si('hero-eyebrow-en').textContent = CTX.hero.eyebrow_en;
  si('hero-eyebrow-bn').textContent = CTX.hero.eyebrow_bn;
  si('hero-h1-en').innerHTML        = CTX.hero.h1_en;
  si('hero-h1-bn').innerHTML        = CTX.hero.h1_bn;
  si('hero-p-en').textContent       = CTX.hero.p_en;
  si('hero-p-bn').textContent       = CTX.hero.p_bn;

  // Hero trust pills
  var trustEn = CTX.hero.trust_en || [], trustBn = CTX.hero.trust_bn || [];
  si('hero-trust').innerHTML = trustEn.map(function(label, i){
    return '<div class="ht-item"><div class="ht-dot"></div>'
      +'<span class="en">'+label+'</span>'
      +'<span class="bn">'+(trustBn[i]||'')+'</span></div>';
  }).join('');

  // Hero visual — image URL or emoji fallback
  var hv = si('hero-visual');
  if (CTX.hero.image_url) {
    hv.innerHTML = '<img src="'+CTX.hero.image_url+'" alt="Hero" style="width:100%;height:100%;object-fit:cover;border-radius:16px">';
    hv.style.fontSize = '0';
  } else {
    hv.textContent = CTX.hero.fallback_emoji || '🔥';
  }

  // Footer
  si('foot-brand').innerHTML     = CTX.store.name_en;
  si('foot-copy-en').textContent = CTX.footer.copy_en;
  si('foot-copy-bn').textContent = CTX.footer.copy_bn;
  si('foot-wa-en').textContent   = CTX.footer.wa_label_en;
  si('foot-wa-bn').textContent   = CTX.footer.wa_label_bn;

  // WhatsApp footer link (uses normalized CFG.WHATSAPP)
  si('foot-wa-link').href = 'https://wa.me/'+CFG.WHATSAPP
    +'?text='+encodeURIComponent(t('Hi! I want to enquire about your products.','হ্যালো! আমি আপনার পণ্য সম্পর্কে জানতে চাই।'));

  applyShowroomBanner();
}

/** Which payment radios to show in cart / checkout — mirrors admin "Payment badges" (CTX.pay_methods). */
function payMethodsAllowedMap() {
  var m = CTX && CTX.pay_methods;
  if (!Array.isArray(m) || !m.length) {
    m = ['cod', 'bkash', 'nagad'];
  }
  var o = {};
  m.forEach(function (x) {
    var k = String(x || '').trim();
    if (k) o[k] = true;
  });
  if (!Object.keys(o).length) {
    o.cod = true;
    o.bkash = true;
    o.nagad = true;
  }
  return o;
}

function applyPayMethodVisibility() {
  if (!CTX) return;
  var allowed = payMethodsAllowedMap();
  function sync(root, radioName) {
    if (!root) return;
    var inputs = root.querySelectorAll('input[type="radio"][name="' + radioName + '"]');
    inputs.forEach(function (inp) {
      var val = String(inp.value || '').trim();
      var row = inp.closest('label');
      if (!row) return;
      row.style.display = allowed[val] ? '' : 'none';
    });
    var visible = Array.from(inputs).filter(function (inp) {
      var row = inp.closest('label');
      return row && row.style.display !== 'none';
    });
    if (!visible.length) return;
    var anyChecked = visible.some(function (inp) { return inp.checked; });
    if (!anyChecked) {
      visible.forEach(function (inp) { inp.checked = false; });
      visible[0].checked = true;
    }
  }
  sync(document.querySelector('#cart-delivery-wrap'), 'cart-payment');
  sync(document.querySelector('#coscreen'), 'payment');
  var codBox = document.querySelector('#coscreen .cod-box');
  if (codBox) codBox.style.display = allowed.cod ? '' : 'none';
}

function si(id){ return document.getElementById(id); }

function isShowroom() {
  if (typeof document === 'undefined' || !document.body) return false;
  if (document.body.classList.contains('shop-showroom')) return true;
  /* shop-showroom template always includes this; use as fallback if body class changes */
  return !!document.getElementById('drawer-var-wrap');
}

var BD_DISTRICTS = [];
var BD_UPAZILAS_BY_DISTRICT = {};
var BD_BASE_DELIVERY_CHARGE = 0;
var BD_DISTRICT_DELIVERY_CHARGE = {};

function fillSelectOptions(selectEl, items, placeholder) {
  if (!selectEl) return;
  var opts = ['<option value="">' + escHtml(placeholder) + '</option>'];
  (items || []).forEach(function (item) {
    var v = String(item || '').trim();
    if (!v) return;
    opts.push('<option value="' + escAttr(v) + '">' + escHtml(v) + '</option>');
  });
  selectEl.innerHTML = opts.join('');
}

function getUpazilasForDistrict(district) {
  var key = String(district || '').trim();
  return BD_UPAZILAS_BY_DISTRICT[key] ? BD_UPAZILAS_BY_DISTRICT[key].slice() : [];
}

function parseDeliveryCharge(v) {
  var n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
}

function resolveDistrictDeliveryCharge(district) {
  var key = String(district || '').trim();
  var districtCharge = parseDeliveryCharge(BD_DISTRICT_DELIVERY_CHARGE[key]);
  if (districtCharge > 0) return districtCharge;
  return parseDeliveryCharge(BD_BASE_DELIVERY_CHARGE);
}

function getSelectedDeliveryCharge(prefix) {
  var districtEl = si(prefix + '-district');
  var upazilaEl = si(prefix + '-upazila');
  if (!districtEl || !upazilaEl) return 0;
  var district = String(districtEl.value || '').trim();
  var upazila = String(upazilaEl.value || '').trim();
  if (!district || !upazila) return 0;
  var validUps = getUpazilasForDistrict(district);
  if (validUps.indexOf(upazila) < 0) return 0;
  return resolveDistrictDeliveryCharge(district);
}

function refreshUpazilaSelect(upazilaSelectId, districtValue, preferValue) {
  var upazilaEl = si(upazilaSelectId);
  if (!upazilaEl) return;
  var list = getUpazilasForDistrict(districtValue);
  fillSelectOptions(upazilaEl, list, t('Select thana/upazila', 'থানা / উপজেলা সিলেক্ট করুন'));
  if (preferValue && list.indexOf(preferValue) >= 0) upazilaEl.value = preferValue;
}

function mirrorDistrictUpazila(fromPrefix, toPrefix) {
  var fromDistrict = si(fromPrefix + '-district');
  var fromUpazila = si(fromPrefix + '-upazila');
  var toDistrict = si(toPrefix + '-district');
  var toUpazila = si(toPrefix + '-upazila');
  if (!fromDistrict || !fromUpazila || !toDistrict || !toUpazila) return;
  toDistrict.value = fromDistrict.value;
  refreshUpazilaSelect(toPrefix + '-upazila', toDistrict.value, fromUpazila.value);
}

function wireDistrictUpazila(prefix, mirrorPrefix) {
  var districtEl = si(prefix + '-district');
  if (!districtEl) return;
  districtEl.addEventListener('change', function () {
    refreshUpazilaSelect(prefix + '-upazila', districtEl.value, '');
    if (mirrorPrefix) mirrorDistrictUpazila(prefix, mirrorPrefix);
  });
  var upazilaEl = si(prefix + '-upazila');
  if (upazilaEl && mirrorPrefix) {
    upazilaEl.addEventListener('change', function () {
      mirrorDistrictUpazila(prefix, mirrorPrefix);
    });
  }
}

function initDistrictUpazilaData() {
  if (!si('cart-dlv-district') && !si('co-district')) return Promise.resolve();
  return fetch('data/bangladesh_districts_upazilas_map.json?cb=' + Date.now(), { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('district map HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      var byDistrict = {};
      BD_BASE_DELIVERY_CHARGE = parseDeliveryCharge(data.delivery_charge);
      (data.divisions || []).forEach(function (division) {
        (division.districts || []).forEach(function (entry) {
          var district = String(entry.district || '').trim();
          if (!district) return;
          byDistrict[district] = (entry.upazilas || []).map(function (u) { return String(u || '').trim(); }).filter(Boolean);
          BD_DISTRICT_DELIVERY_CHARGE[district] = parseDeliveryCharge(entry.delivery_charge);
        });
      });
      BD_UPAZILAS_BY_DISTRICT = byDistrict;
      BD_DISTRICTS = Object.keys(byDistrict).sort(function (a, b) { return a.localeCompare(b); });

      var districtPlaceholder = t('Select district', 'জেলা সিলেক্ট করুন');
      fillSelectOptions(si('cart-dlv-district'), BD_DISTRICTS, districtPlaceholder);
      fillSelectOptions(si('co-district'), BD_DISTRICTS, districtPlaceholder);
      refreshUpazilaSelect('cart-dlv-upazila', '', '');
      refreshUpazilaSelect('co-upazila', '', '');

      wireDistrictUpazila('cart-dlv', 'co');
      wireDistrictUpazila('co', 'cart-dlv');
    })
    .catch(function (err) {
      console.error('Could not load district/upazila map:', err);
      toast(t('Could not load district list. Please refresh.', 'জেলা তালিকা লোড হয়নি। রিফ্রেশ করুন।'));
    });
}

/** Optional top banner (shop-showroom): CTX.banner_slides[] URLs, else hero.image_url, else default image */
function applyShowroomBanner() {
  if (!isShowroom()) return;
  var track = si('showroom-banner-track');
  if (!track || !CTX) return;
  var slides = [];
  if (CTX.banner_slides && CTX.banner_slides.length) {
    slides = CTX.banner_slides.map(function (u) { return String(u || '').trim(); }).filter(Boolean);
  }
  if (!slides.length && ASSET_BANNER_SLIDES && ASSET_BANNER_SLIDES.length) {
    slides = ASSET_BANNER_SLIDES.slice();
  }
  if (!slides.length && CTX.hero && CTX.hero.image_url) {
    slides = [String(CTX.hero.image_url).trim()];
  }
  if (!slides.length) {
    slides = ['https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1400&q=80'];
  }
  var promoSlide = ''
    + '<div class="showroom-slide showroom-slide--promo">'
    +   '<div class="showroom-promo">'
    +     '<div class="showroom-promo__overlay"></div>'
    +     '<div class="showroom-promo__content">'
    +       '<div class="showroom-promo__tag">নতুন কালেকশন</div>'
    +       '<h2>স্টাইলিশ শার্ট ও জুতার সেরা সংগ্রহ</h2>'
    +       '<p>প্রতিদিনের ব্যবহার আর স্পেশাল দিনের জন্য প্রিমিয়াম কোয়ালিটির পণ্য এখন এক জায়গায়।</p>'
    +     '</div>'
    +   '</div>'
    + '</div>';
  var imageSlides = slides.map(function (url, i) {
    return '<div class="showroom-slide" data-banner-i="'+i+'">'
      +'<img src="'+url+'" alt="" loading="'+(i === 0 ? 'eager' : 'lazy')+'" decoding="async">'
      +'</div>';
  }).join('');
  track.innerHTML = promoSlide + imageSlides;
  track.style.display = 'flex';
  track.style.flexDirection = 'row';
  window.__showroomBannerCount = slides.length + 1;
  window.__showroomBannerIndex = 0;
}

function layoutShowroomBanner() {
  var viewport = document.querySelector('.showroom-slider-viewport');
  var track = si('showroom-banner-track');
  if (!viewport || !track || !window.__showroomBannerCount) return;
  var n = window.__showroomBannerCount;
  var w = viewport.offsetWidth;
  var i;
  track.style.width = (n * w) + 'px';
  for (i = 0; i < track.children.length; i++) {
    track.children[i].style.width = w + 'px';
    track.children[i].style.flexShrink = '0';
  }
  var idx = window.__showroomBannerIndex || 0;
  track.style.transform = 'translateX(' + (-idx * w) + 'px)';
}

function syncShowroomBannerDots() {
  var dots = si('showroom-banner-dots');
  if (!dots) return;
  dots.querySelectorAll('.showroom-slider-dot').forEach(function (d, j) {
    d.classList.toggle('active', j === window.__showroomBannerIndex);
  });
}

function goShowroomBanner(delta) {
  var n = window.__showroomBannerCount;
  if (!n || n <= 1) return;
  window.__showroomBannerIndex = (window.__showroomBannerIndex + delta + n) % n;
  layoutShowroomBanner();
  syncShowroomBannerDots();
}

function initShowroomBanner() {
  if (!isShowroom()) return;
  var viewport = document.querySelector('.showroom-slider-viewport');
  var track = si('showroom-banner-track');
  var dots = si('showroom-banner-dots');
  var prev = si('showroom-banner-prev');
  var next = si('showroom-banner-next');
  if (!viewport || !track || !window.__showroomBannerCount) return;
  var n = window.__showroomBannerCount;
  if (dots && n > 1) {
    dots.innerHTML = Array.from({ length: n }, function (_, i) {
      return '<button type="button" class="showroom-slider-dot'+(i === 0 ? ' active' : '')+'" data-banner-dot="'+i+'" aria-label="Slide '+(i + 1)+'"></button>';
    }).join('');
    dots.addEventListener('click', function (e) {
      var b = e.target.closest('[data-banner-dot]');
      if (!b) return;
      window.__showroomBannerIndex = parseInt(b.getAttribute('data-banner-dot'), 10);
      layoutShowroomBanner();
      syncShowroomBannerDots();
    });
  } else if (dots) {
    dots.innerHTML = '';
  }
  if (n <= 1) {
    if (prev) prev.style.display = 'none';
    if (next) next.style.display = 'none';
  }
  layoutShowroomBanner();
  if (n > 1) {
    window.setInterval(function () { goShowroomBanner(1); }, 6000);
  }
  window.addEventListener('resize', function () {
    if (isShowroom()) layoutShowroomBanner();
  });
  if (prev) prev.addEventListener('click', function () { goShowroomBanner(-1); });
  if (next) next.addEventListener('click', function () { goShowroomBanner(1); });
}

function escAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function splitCsvImageUrls(text) {
  return String(text || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

function normalizeProductImages(row) {
  var extra = splitCsvImageUrls(row && row.image_urls);
  var out = [];
  function push(u) {
    var s = String(u || '').trim();
    if (!s) return;
    if (out.indexOf(s) === -1) out.push(s);
  }
  // Legacy fallback only (older CSVs may still carry image_url)
  push(row && row.image_url);
  extra.forEach(push);
  return out;
}



// ── CSV COLUMN GUIDE ───────────────────────────────────────────────
// Core columns: id, name, price, category, image_urls, desc, in_stock, views, bundle, variations
// Optional: original_price, badge
//   original_price  — strike-through; leave blank for none
//   image_urls      — URLs comma-separated (first = cover; legacy image_url also supported in code)
//   badge             — sale | hot | new | (blank)
//   in_stock         — TRUE / FALSE (only availability flag; not an inventory count)
//   views             — social proof number
//   bundle            — 1–2 partner product IDs, e.g. 2,16 (quote the cell if needed: "2,16")
//   variations        — showroom: pipe- or comma-separated, e.g. S|M|L|XL
//
// Product cards use a fixed default emoji and rating display (not from CSV).


// ╔══════════════════════════════════════════════════════════════════╗
// ║  SECTION 2 — PRODUCTS (inline CSV fallback)                    ║
// ║  Set csv_url in data/context.json (e.g. data/products.csv).        ║
// ║  If csv_url is "" or fetch fails, this embedded CSV is used.   ║
// ║  Header must match: id, name, price, original_price, category,  ║
// ║    image_urls, desc, badge, in_stock, views, bundle, variations  ║
// ║  • in_stock: TRUE or FALSE                                      ║
// ║  • bundle: quote the cell if it has a comma e.g. "2,16"        ║
// ╚══════════════════════════════════════════════════════════════════╝
var INLINE_CSV = `id,name,price,original_price,category,image_urls,desc,badge,in_stock,views,bundle,variations
1,Premium Cotton T-Shirt — S,590,600,clothing,,Ultra-soft 100% combed cotton. Pre-shrunk. Size S.,sale,TRUE,34,"2,16",
2,Premium Cotton T-Shirt — M,450,600,clothing,,Ultra-soft 100% combed cotton. Pre-shrunk. Size M.,sale,TRUE,51,"1,16",
3,Premium Cotton T-Shirt — L,450,600,clothing,,Ultra-soft 100% combed cotton. Pre-shrunk. Size L.,sale,TRUE,29,"1,25",
4,Premium Cotton T-Shirt — XL,450,600,clothing,,Ultra-soft 100% combed cotton. Pre-shrunk. Size XL.,sale,TRUE,18,"1,26",
5,Premium Cotton T-Shirt — XXL,450,600,clothing,,Ultra-soft 100% combed cotton. Pre-shrunk. Size XXL.,sale,TRUE,22,"1,28",
6,Running Sneakers (EU 38),2500,2500,footwear,,Lightweight EVA sole with breathable mesh upper. EU 38.,hot,TRUE,67,"16,23",
7,Running Sneakers (EU 39),1800,2500,footwear,,Lightweight EVA sole with breathable mesh upper. EU 39.,hot,TRUE,43,"16,23",
8,Running Sneakers (EU 40),1800,2500,footwear,,Lightweight EVA sole with breathable mesh upper. EU 40.,hot,TRUE,88,"16,20",
9,Running Sneakers (EU 41),1800,2500,footwear,,Lightweight EVA sole with breathable mesh upper. EU 41.,hot,TRUE,71,"16,20",
10,Running Sneakers (EU 42),1800,2500,footwear,,Lightweight EVA sole with breathable mesh upper. EU 42.,hot,TRUE,94,"16,21",
11,Running Sneakers (EU 43),1800,2500,footwear,,Lightweight EVA sole with breathable mesh upper. EU 43.,hot,TRUE,55,"16,22",
12,Running Sneakers (EU 44),1800,2500,footwear,,Lightweight EVA sole with breathable mesh upper. EU 44.,hot,TRUE,38,"16,22",
13,Genuine Leather Handbag — Black,1200,,accessories,,Full-grain genuine leather. Black.,new,TRUE,42,"29,16",
14,Genuine Leather Handbag — Brown,1200,,accessories,,Full-grain genuine leather. Brown.,new,TRUE,33,"30,16",
15,Genuine Leather Handbag — Tan,1200,,accessories,,Full-grain genuine leather. Tan.,new,TRUE,27,"29,16",
16,UV400 Polarized Sunglasses,380,550,accessories,,Polarized UV400 protection. Unisex design. Includes hard case.,sale,TRUE,112,"6,1",
17,Smart Watch Pro — Black,2800,3500,electronics,,"1.4"" AMOLED heart rate SpO2 7-day battery. Black finish.",hot,TRUE,143,"23,20",
18,Smart Watch Pro — Silver,2800,3500,electronics,,"1.4"" AMOLED heart rate SpO2 7-day battery. Silver finish.",hot,TRUE,98,"23,21",
19,Smart Watch Pro — Rose Gold,2800,3500,electronics,,"1.4"" AMOLED heart rate SpO2 7-day battery. Rose gold finish.",hot,TRUE,87,"23,22",
20,Laptop Backpack 30L — Black,1100,,accessories,,"30L padded 15.6"" laptop slot USB-C charge port. Black.",new,TRUE,76,"17,23",
21,Laptop Backpack 30L — Navy,1100,,accessories,,"30L padded 15.6"" laptop slot USB-C charge port. Navy.",new,TRUE,54,"18,23",
22,Laptop Backpack 30L — Olive,1100,,accessories,,"30L padded 15.6"" laptop slot USB-C charge port. Olive.",new,TRUE,41,"19,23",
23,True Wireless Earbuds — Black,950,1400,electronics,,30h total battery ANC IPX5. Black.,sale,TRUE,63,"17,20",
24,True Wireless Earbuds — White,950,1400,electronics,,30h total battery ANC IPX5. White.,sale,TRUE,49,"18,21",
25,Linen Kurta — S,680,850,clothing,,Premium linen blend. Traditional cut. Size S.,,TRUE,88,"1,16",
26,Linen Kurta — M,680,850,clothing,,Premium linen blend. Traditional cut. Size M.,,TRUE,102,"2,16",
27,Linen Kurta — L,680,850,clothing,,Premium linen blend. Traditional cut. Size L.,,TRUE,79,"3,16",
28,Linen Kurta — XL,680,850,clothing,,Premium linen blend. Traditional cut. Size XL.,,TRUE,56,"4,16",
29,Slim Leather Wallet — Black,550,700,accessories,,Slim genuine leather bifold. RFID blocking. Black.,new,FALSE,38,"13,16",
30,Slim Leather Wallet — Brown,550,700,accessories,,Slim genuine leather bifold. RFID blocking. Brown.,new,FALSE,29,"14,16",
31,Canvas Slip-On — White,650,,footwear,,Classic canvas. Flexible rubber sole. White.,,TRUE,45,"16,1",
32,Canvas Slip-On — Black,650,,footwear,,Classic canvas. Flexible rubber sole. Black.,,TRUE,61,"16,2",
33,Canvas Slip-On — Red,650,,footwear,,Classic canvas. Flexible rubber sole. Red.,,TRUE,33,"16,3",
34,Canvas Slip-On — Navy,650,,footwear,,Classic canvas. Flexible rubber sole. Navy.,,TRUE,52,"16,4",`;
// ── end of Section 2 ─────────────────────────────────────────────


var PRODUCTS=[], cart=[], activeProd=null, activeQty=1, lang='en';
/** Where #cart-drw lived before moving into showroom inline anchor (restore when catalog grows). */
var showroomCartSavedParent = null;
var showroomCartSavedNext = null;
var activeChip=null, searchQuery='', activeCat='all';
/* card qty state: pid -> qty */
var cardQty={};
/* 4. Recently Viewed */
var recentlyViewed=[];

/* ── LANG ── */
function setLang(l){
  lang=l;
  document.body.classList.toggle('bn', l === 'bn');
  document.body.classList.add('fade');
  document.getElementById('btn-en').classList.toggle('on',l==='en');
  document.getElementById('btn-bn').classList.toggle('on',l==='bn');
  applyFilters(); renderRV();
}

/* ── HELPERS ── */
function taka(n){return '৳'+Number(n).toLocaleString('en-IN');}
function t(en,bn){return lang==='bn'?bn:en;}
function toast(msg){
  var el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('on');
  setTimeout(function(){el.classList.remove('on');},2400);
}

/* ── 2. STAR RATING HTML ── */
function starsHtml(rating){
  var full=Math.floor(rating), half=(rating-full)>=0.5;
  var s='<span class="stars">';
  for(var i=0;i<5;i++){
    if(i<full) s+='<span class="star">★</span>';
    else if(i===full&&half) s+='<span class="star">★</span>';
    else s+='<span class="star empty">★</span>';
  }
  return s+'</span>';
}

/* ── CARD INLINE QTY (showroom: per size when product has variations) ── */
function productNeedsShowroomVariant(p) {
  return isShowroom() && p && p.variations && p.variations.length;
}
/** Max variation chips on the product card; extra options open in the drawer. */
var SHOWROOM_VAR_CARD_LIMIT = 4;

function getShowroomCardSelectedVariant(pid) {
  var wrap = document.querySelector('#pgrid .showroom-var-chips[data-pid="' + pid + '"]');
  if (!wrap) return '';
  var ch = wrap.querySelector('.showroom-var-chip.is-selected[data-v]');
  if (!ch) return '';
  return String(ch.getAttribute('data-v') != null ? ch.getAttribute('data-v') : '').trim();
}
function showroomCardQtyKey(pid) {
  var p = PRODUCTS.find(function (x) { return x.id === pid; });
  if (!productNeedsShowroomVariant(p)) return String(pid);
  var v = getShowroomCardSelectedVariant(pid);
  if (!v) return String(pid) + '\u0002__pick__';
  return String(pid) + '\u0002' + v;
}
function getCardQtyStoreKey(pid) {
  var p = PRODUCTS.find(function (x) { return x.id === pid; });
  if (productNeedsShowroomVariant(p)) return showroomCardQtyKey(pid);
  return String(pid);
}
function getCardQty(pid) {
  var k = getCardQtyStoreKey(pid);
  return cardQty[k] || 1;
}
function setCardQty(pid, delta, e) {
  e.stopPropagation();
  var k = getCardQtyStoreKey(pid);
  var q = Math.max(1, (cardQty[k] || 1) + delta);
  cardQty[k] = q;
  var el = document.getElementById('cqv-' + pid);
  if (el) el.textContent = q;
}
/** Hint/flash: dimmed red tint, no border — target is .showroom-var-row (card) or #drawer-var-wrap */
function flashShowroomVarHintTarget(el) {
  if (!el) return null;
  if (el.id === 'drawer-var-wrap') return el;
  if (el.closest && el.closest('#drawer-var-wrap')) return document.getElementById('drawer-var-wrap');
  if (el.closest) {
    var row = el.closest('.showroom-var-row');
    if (row) return row;
  }
  return el;
}
function flashShowroomVarWrap(wrap) {
  var target = flashShowroomVarHintTarget(wrap);
  if (!target) return;
  target.classList.remove('showroom-var--shake');
  void target.offsetWidth;
  target.classList.add('showroom-var--hint', 'showroom-var--shake');
  setTimeout(function () { target.classList.remove('showroom-var--shake'); }, 500);
}
function flashShowroomVarRequiredForPid(pid) {
  flashShowroomVarWrap(document.querySelector('#pgrid .showroom-var-chips[data-pid="' + pid + '"]'));
}
function flashShowroomDrawerVarRequired() {
  flashShowroomVarWrap(document.getElementById('drawer-var-wrap'));
}

function showroomVarChipsGroupHtml(p, isDrawer) {
  var label = t('Size / option', 'সাইজ / অপশন');
  if (isDrawer) {
    var listD = p.variations && p.variations.length ? p.variations : [];
    var innerD = listD.map(function (v) {
      return '<button type="button" class="showroom-var-chip" data-v="' + escAttr(v) + '" role="radio" aria-pressed="false">'
        + escHtml(v) + '</button>';
    }).join('');
    return '<div class="showroom-var-chips showroom-var-chips--drawer" role="radiogroup" aria-label="' + escAttr(label) + '">' + innerD + '</div>';
  }
  if (!p.variations || !p.variations.length) return '';
  if (p.variations.length > SHOWROOM_VAR_CARD_LIMIT) {
    var first = p.variations.slice(0, SHOWROOM_VAR_CARD_LIMIT);
    var moreLbl = t('View all sizes', 'সব সাইজ দেখুন');
    var innerCard = first.map(function (v) {
      return '<button type="button" class="showroom-var-chip" data-v="' + escAttr(v) + '" role="radio" aria-pressed="false">'
        + escHtml(v) + '</button>';
    }).join('');
    return '<div class="showroom-var-chips showroom-var-chips--split" data-pid="' + p.id + '">'
      + '<div class="showroom-var-chips-group" role="radiogroup" aria-label="' + escAttr(label) + '">' + innerCard + '</div>'
      + '<button type="button" class="showroom-var-more" data-pid="' + p.id + '" title="' + escAttr(moreLbl) + '" aria-label="' + escAttr(moreLbl) + '">+</button>'
      + '</div>';
  }
  var innerA = p.variations.map(function (v) {
    return '<button type="button" class="showroom-var-chip" data-v="' + escAttr(v) + '" role="radio" aria-pressed="false">'
      + escHtml(v) + '</button>';
  }).join('');
  return '<div class="showroom-var-chips" data-pid="' + p.id + '" role="radiogroup" aria-label="' + escAttr(label) + '">' + innerA + '</div>';
}
function bindShowroomDrawerChips() {
  var w = document.getElementById('drawer-var-wrap');
  if (!w) return;
  w.querySelectorAll('.showroom-var-chip').forEach(function (chip) {
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      var par = chip.closest('.showroom-var-chips');
      if (!par) return;
      par.querySelectorAll('.showroom-var-chip').forEach(function (c) {
        c.classList.remove('is-selected');
        c.setAttribute('aria-pressed', 'false');
      });
      chip.classList.add('is-selected');
      chip.setAttribute('aria-pressed', 'true');
      var drw = document.getElementById('drawer-var-wrap');
      if (drw) {
        drw.classList.remove('showroom-var--hint', 'showroom-var--shake');
      }
    });
  });
}

/* ── BUY NOW: showroom → add to cart + open cart; classic shop → WhatsApp quick order ── */
function buyNow(pid,qty,e){
  if(e) e.stopPropagation();
  var p=PRODUCTS.find(function(x){return x.id===pid;});
  if(!p||!p.inStock) return;
  if (productNeedsShowroomVariant(p)) {
    var v = getShowroomCardSelectedVariant(pid);
    if (!v) {
      flashShowroomVarRequiredForPid(pid);
      toast(t('Please select a size.','অনুগ্রহ করে সাইজ বেছে নিন।'));
      return;
    }
  }
  var q=qty||getCardQty(pid);
  if (isShowroom()) {
    var vCart = productNeedsShowroomVariant(p) ? getShowroomCardSelectedVariant(pid) : null;
    addToCart(p, q, vCart || undefined);
    openCart();
    toast(t('Added to cart! 🛒','কার্টে যোগ হয়েছে! 🛒'));
    return;
  }
  var sizeLine = (productNeedsShowroomVariant(p)
    ? ('\n' + t('Size','সাইজ') + ': *' + getShowroomCardSelectedVariant(pid) + '*\n')
    : '');
  var msg='🛍️ *Quick Order — '+CFG.STORE_NAME+'*\n\n'
    +'Product: *'+p.name+'*' + sizeLine
    +'Quantity: '+q+'\n'
    +'Price: '+taka(p.price)+' × '+q+' = *'+taka(p.price*q)+'*\n\n'
    +'Please confirm my order and share delivery details. 🙏';
  window.open('https://wa.me/'+CFG.WHATSAPP+'?text='+encodeURIComponent(msg));
}

/* ── DEAL CHIPS ── */
function toggleChip(chip){
  activeChip=(activeChip===chip)?null:chip;
  document.getElementById('chip-hot').classList.toggle('on',activeChip==='hot');
  document.getElementById('chip-cheap').classList.toggle('on',activeChip==='cheap');
  document.getElementById('chip-new').classList.toggle('on',activeChip==='new');
  applyFilters();
}

/* ── SEARCH ── */
function handleSearch(val){searchQuery=val.toLowerCase().trim();applyFilters();}

/* Category nav: built from product data (renderCatsBar in showGrid). */
var CATEGORY_LABELS = {
  clothing: { en: 'Clothing', bn: 'পোশাক' },
  footwear: { en: 'Footwear', bn: 'জুতা' },
  accessories: { en: 'Accessories', bn: 'আনুষাঙ্গিক' },
  electronics: { en: 'Electronics', bn: 'ইলেকট্রনিক্স' }
};

function uniqueCategoriesFromProducts() {
  var seen = Object.create(null);
  PRODUCTS.forEach(function (p) {
    var c = (p.category == null ? '' : String(p.category)).trim().toLowerCase();
    if (c) seen[c] = true;
  });
  return Object.keys(seen).sort();
}

function categoryDisplayLabel(slug) {
  if (slug === 'all') return { en: 'All Products', bn: 'সব পণ্য' };
  var L = CATEGORY_LABELS[slug];
  if (L) return L;
  var raw = String(slug || '').replace(/[-_]+/g, ' ').trim();
  if (!raw) return { en: 'Other', bn: 'অন্যান্য' };
  var cap = raw.split(/\s+/).map(function (w) {
    if (!w.length) return '';
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ') || raw;
  return { en: cap, bn: cap };
}

function renderCatsBar() {
  var bar = document.getElementById('cats-bar');
  if (!bar) return;
  var slugs = uniqueCategoriesFromProducts();
  if (activeCat !== 'all' && slugs.indexOf(activeCat) < 0) {
    activeCat = 'all';
  }
  var h =
    '<button class="cat' + (activeCat === 'all' ? ' on' : '') + '" type="button" data-cat="all">'
    + '<span class="en">All</span><span class="bn">সব</span></button>';
  for (var i = 0; i < slugs.length; i++) {
    var slug = slugs[i];
    var L = categoryDisplayLabel(slug);
    h +=
      '<button class="cat' + (activeCat === slug ? ' on' : '') + '" type="button" data-cat="' + escAttr(slug) + '">'
      + '<span class="en">' + escHtml(L.en) + '</span><span class="bn">' + escHtml(L.bn) + '</span></button>';
  }
  bar.innerHTML = h;
}

/* ── COMBINED FILTER ── */
function applyFilters(){
  var list=PRODUCTS;
  if(activeCat!=='all') list=list.filter(function(p){return p.category===activeCat;});
  if(activeChip==='hot') list=list.filter(function(p){return p.badge==='hot'||p.badge==='sale';});
  if(activeChip==='cheap') list=list.filter(function(p){return p.price<1000;});
  if(activeChip==='new') list=list.filter(function(p){return p.badge==='new';});
  if(searchQuery) list=list.filter(function(p){return p.name.toLowerCase().includes(searchQuery)||(p.desc||'').toLowerCase().includes(searchQuery);});
  var secTitle = searchQuery
    ? t('Search Results', 'সার্চ ফলাফল')
    : (activeCat === 'all'
        ? t('All Products', 'সব পণ্য')
        : (function () {
            var cLab = categoryDisplayLabel(activeCat);
            return t(cLab.en, cLab.bn);
          })());
  document.getElementById('sec-label').textContent = secTitle;
  document.getElementById('sec-count').textContent=list.length+' '+t('items','টি পণ্য');
  renderGrid(list);
}

/* ── RENDER GRID ── */
var cardSlideTimer = null;

function stopCardSlideshows() {
  if (cardSlideTimer) {
    clearInterval(cardSlideTimer);
    cardSlideTimer = null;
  }
}

function cardImagesFromAttr(raw) {
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

function applyCardSlideFrame(card, idx) {
  var imgs = card.__cardImages || [];
  if (imgs.length <= 1) return;
  var n = imgs.length;
  var safe = ((idx % n) + n) % n;
  card.__cardSlideIdx = safe;
  var main = card.querySelector('.main-img, .pcard-main-img');
  if (main) main.src = imgs[safe];
  var hover = card.querySelector('.hover-img');
  if (hover) hover.src = imgs[(safe + 1) % n];
  card.querySelectorAll('.card-img-dots span').forEach(function (dot, i) {
    dot.classList.toggle('on', i === safe);
  });
}

function initCardSlideshows() {
  stopCardSlideshows();
  var cards = Array.from(document.querySelectorAll('#pgrid .pcard[data-card-images]'));
  cards = cards.filter(function (card) {
    var imgs = cardImagesFromAttr(card.getAttribute('data-card-images'));
    card.__cardImages = imgs;
    if (imgs.length <= 1) return false;
    applyCardSlideFrame(card, 0);
    return true;
  });
  if (!cards.length) return;
  cardSlideTimer = setInterval(function () {
    cards.forEach(function (card) {
      var next = (card.__cardSlideIdx || 0) + 1;
      applyCardSlideFrame(card, next);
    });
  }, 2400);
}

function renderGridShowroom(list) {
  var g = document.getElementById('pgrid');
  if (!list.length) {
    stopCardSlideshows();
    g.innerHTML = '<div class="showroom-empty" style="grid-column:1/-1;text-align:center;padding:48px;color:var(--ink3)">'+t('No products found.','কোনো পণ্য পাওয়া যায়নি।')+'</div>';
    return;
  }
  g.innerHTML = list.map(function (p) {
    var offerHtml = '';
    if (p.inStock && p.original && p.original > p.price) {
      offerHtml = '<div class="tp-product-offer top-left"><span class="product-offer">'+t('Save','সাশ্রয়')+' '+taka(p.original - p.price)+'</span></div>';
    } else if (p.inStock && p.badge === 'new') {
      offerHtml = '<div class="tp-product-offer top-left"><span class="product-offer">NEW</span></div>';
    } else if (p.inStock && (p.badge === 'hot' || p.badge === 'sale')) {
      offerHtml = '<div class="tp-product-offer top-left"><span class="product-offer">SALE</span></div>';
    }
    var centerBadge = '';
    if (!p.inStock) {
      centerBadge = '<div class="tp-product-badge center"><span class="tp-badge-oos">'+t('Out of Stock','স্টক নেই')+'</span></div>';
    }
    var imgBlock = '';
    var cardImages = (p.images && p.images.length) ? p.images : (p.image_url ? [p.image_url] : []);
    if (cardImages.length) {
      var hero = cardImages[0];
      var hoverSrc = cardImages[1] || cardImages[0];
      imgBlock =
        '<img class="main-img" src="'+escAttr(hero)+'" alt="'+escAttr(p.name)+'" loading="lazy">'
        +'<img class="hover-img" src="'+escAttr(hoverSrc)+'" alt="" loading="lazy" aria-hidden="true">';
    } else {
      imgBlock = '<span class="tp-product-emoji-fallback">'+(p.emoji || '🛍️')+'</span>';
    }
    var dots = cardImages.length > 1
      ? '<div class="card-img-dots">'+cardImages.map(function (_, i) { return '<span'+(i === 0 ? ' class="on"' : '')+'></span>'; }).join('')+'</div>'
      : '';
    var slideAttr = cardImages.length > 1 ? ' data-card-images="'+escAttr(JSON.stringify(cardImages))+'"' : '';
    var priceRow = '<div class="tp-product-price-wrapper"><div class="tp-product-price-inner">';
    if (p.original && p.original > p.price) {
      priceRow += '<span class="tp-product-price old-price">'+taka(p.original)+'</span>'
        +'<span class="tp-product-price new-price">'+taka(p.price)+'</span>';
    } else {
      priceRow += '<span class="tp-product-price new-price tp-price-only">'+taka(p.price)+'</span>';
    }
    priceRow += '</div></div>';
    var ratingMini = '<div class="tp-product-rating-line">'+starsHtml(p.rating || 0)+'<span class="tp-rating-n">('+p.reviews+')</span></div>';
    var varRow = '';
    if (p.inStock && p.variations && p.variations.length) {
      varRow = '<div class="showroom-var-row">'
        + '<div class="showroom-var-lbl">' + t('Size / option', 'সাইজ / অপশন') + '</div>'
        + showroomVarChipsGroupHtml(p, false)
        + '</div>';
    }
    var cardFoot = '';
    if (p.inStock) {
      var needVar = p.variations && p.variations.length;
      var cq = needVar ? 1 : getCardQty(p.id);
      cardFoot = varRow
        + '<div class="card-qty-row tp-card-qty" id="cqr-'+p.id+'">'
        +'<div class="card-qty">'
        +'<button type="button" onclick="setCardQty('+p.id+',-1,event);return false">−</button>'
        +'<span id="cqv-'+p.id+'">'+cq+'</span>'
        +'<button type="button" onclick="setCardQty('+p.id+',1,event);return false">+</button>'
        +'</div></div>'
        +'<div class="tp-product-actions d-flex gap-1 mt-1">'
        +'<button type="button" class="btn btn-sm btn-outline-dark flex-grow-1 btn-add" data-pid="'+p.id+'">'+t('Cart','কার্ট')+'</button>'
        +'<button type="button" class="btn btn-sm btn-dark flex-grow-1 btn-buy-now" data-pid="'+p.id+'">'+t('Buy','কিনুন')+'</button>'
        +'</div>';
    } else {
      cardFoot = '<button type="button" class="btn btn-sm btn-secondary w-100" disabled>'+t('Out of Stock','স্টক নেই')+'</button>';
    }
    return '<div class="pcard tp-product-item'+(p.inStock ? '' : ' oos')+'" data-pid="'+p.id+'"'+slideAttr+'>'
      +'<div class="tp-product-thumb p-relative m-img">'
      +'<div class="product-thumb-area">'+imgBlock+dots+centerBadge+offerHtml+'</div>'
      +'</div>'
      +'<div class="tp-product-content">'
      +'<h3 class="tp-product-title one-line">'+escHtml(p.name)+'</h3>'
      +priceRow
      +ratingMini
      +'<div class="pcard-foot tp-pcard-foot">'+cardFoot+'</div>'
      +'</div></div>';
  }).join('');
  g.querySelectorAll('.showroom-var-chips[data-pid]').forEach(function (wrap) {
    var pid = parseInt(wrap.getAttribute('data-pid'), 10);
    var cqv = document.getElementById('cqv-' + pid);
    if (cqv) cqv.textContent = String(getCardQty(pid));
  });
  initCardSlideshows();
}

function renderGrid(list){
  if (isShowroom()) {
    renderGridShowroom(list);
    return;
  }
  var g=document.getElementById('pgrid');
  if(!list.length){stopCardSlideshows();g.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--ink3)">'+t('No products found.','কোনো পণ্য পাওয়া যায়নি।')+'</div>';return;}
  g.innerHTML=list.map(function(p){
    var badge='';
    if(!p.inStock)            badge='<div class="pbadge pb-oos">'+t('Out of Stock','স্টক নেই')+'</div>';
    else if(p.badge==='sale') badge='<div class="pbadge pb-sale">SALE</div>';
    else if(p.badge==='new')  badge='<div class="pbadge pb-new">NEW</div>';
    else if(p.badge==='hot')  badge='<div class="pbadge pb-hot">HOT</div>';
    var cardImages=(p.images&&p.images.length)?p.images:(p.image_url?[p.image_url]:[]);
    var img=cardImages.length?'<img class="pcard-main-img" src="'+escAttr(cardImages[0])+'" alt="'+escAttr(p.name)+'" loading="lazy">':'<div class="pcard-emoji">'+(p.emoji||'🛍️')+'</div>';
    var dots=cardImages.length>1?'<div class="card-img-dots">'+cardImages.map(function(_,i){return '<span'+(i===0?' class="on"':'')+'></span>';}).join('')+'</div>':'';
    var slideAttr=cardImages.length>1?' data-card-images="'+escAttr(JSON.stringify(cardImages))+'"':'';
    var orig=p.original?'<span class="porig">'+taka(p.original)+'</span>':'';
    /* 2. Star ratings */
    var ratingRow='<div class="prating-row">'+starsHtml(p.rating||0)+'<span class="prating-count">('+p.reviews+')</span></div>';
    /* 3. Social proof */
    var social=p.views&&p.inStock?'<div class="psocial"><span class="psocial-dot"></span>'+p.views+' '+t('people viewed today','জন আজ দেখেছেন')+'</div>':'';
    /* urgency */
    var urgency='';
    var delivery=p.inStock?'<div class="pdelivery">🚚 '+t('Dhaka: Tomorrow','ঢাকা: আগামীকাল')+'</div>':'';
    /* inline qty + action buttons */
    var cardFoot='';
    if(p.inStock){
      var cq=getCardQty(p.id);
      cardFoot=
        '<div class="card-qty-row" id="cqr-'+p.id+'">'
          +'<div class="card-qty">'
            +'<button onclick="setCardQty('+p.id+',-1,event);return false">−</button>'
            +'<span id="cqv-'+p.id+'">'+cq+'</span>'
            +'<button onclick="setCardQty('+p.id+',1,event);return false">+</button>'
          +'</div>'
        +'</div>'
        +'<div class="card-actions">'
          +'<button class="btn-add" data-pid="'+p.id+'"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'+t('Cart','কার্ট')+'</button>'
          +'<button class="btn-buy-now" onclick="buyNow('+p.id+',null,event);return false">'+t('Buy','কিনুন')+'</button>'
        +'</div>';
    } else {
      cardFoot='<button class="btn-add" disabled>'+t('Out of Stock','স্টক নেই')+'</button>';
    }
    return '<div class="pcard'+(p.inStock?'':' oos')+'" data-pid="'+p.id+'"'+slideAttr+'>'
      +'<div class="pcard-img" style="position:relative">'+img+dots+badge+'</div>'
      +'<div class="pcard-body">'
      +'<div class="pname">'+p.name+'</div>'
      +'<div class="price-row"><span class="pprice">'+taka(p.price)+'</span>'+orig+'</div>'
      +ratingRow+social+urgency+delivery
      +'<div class="pcard-foot">'+cardFoot+'</div>'
      +'</div></div>';
  }).join('');
  initCardSlideshows();
}

function filterCat(cat){activeCat=cat;applyFilters();}

/* ── 4. RECENTLY VIEWED ── */
function addToRV(pid){
  recentlyViewed=recentlyViewed.filter(function(id){return id!==pid;});
  recentlyViewed.unshift(pid);
  if(recentlyViewed.length>10) recentlyViewed.pop();
  renderRV();
}
function renderRV(){
  var sec=document.getElementById('rv-section');
  var items=recentlyViewed.map(function(id){return PRODUCTS.find(function(p){return p.id===id;});}).filter(Boolean);
  if(items.length<2){sec.style.display='none';return;}
  sec.style.display='block';
  var scr=document.getElementById('rv-scroll');
  scr.innerHTML=items.map(function(p){
    var img=p.image_url?'<img src="'+p.image_url+'" alt="'+p.name+'">':'<div style="font-size:30px">'+p.emoji+'</div>';
    return '<div class="rv-card" data-pid="'+p.id+'"><div class="rv-img">'+img+'</div><div class="rv-info"><div class="rv-name">'+p.name+'</div><div class="rv-price">'+taka(p.price)+'</div></div></div>';
  }).join('');
  scr.querySelectorAll('.rv-card').forEach(function(c){
    c.addEventListener('click',function(){openDrawer(parseInt(c.getAttribute('data-pid')));});
  });
}

/* ── CART ── */
function cartKey(p, variant) {
  if (productNeedsShowroomVariant(p)) {
    var v = (variant == null) ? '' : String(variant).trim();
    return 'p' + p.id + '\u0001' + v;
  }
  return 'p' + p.id;
}
function cartSub(){return cart.reduce(function(s,i){return s+i.prod.price*i.qty;},0);}
function updBadge(){
  var n=cart.reduce(function(s,i){return s+i.qty;},0);
  var b=document.getElementById('cbadge');
  b.textContent=n; b.classList.toggle('on',n>0);
}
function isShowroomInlineCartMode() {
  return typeof document !== 'undefined' && document.body && document.body.classList.contains('showroom-inline-cart');
}

function maybeScrollShowroomInlineCart() {
  if (!isShowroomInlineCartMode() || !cart.length) return;
  var drw = document.getElementById('cart-drw');
  if (drw) drw.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function refreshShowroomCartIfInline() {
  if (!isShowroomInlineCartMode()) return;
  renderCart();
  maybeScrollShowroomInlineCart();
}

/** Showroom only: when fewer than 6 products, embed cart below the grid instead of a side drawer. */
function syncShowroomCartPlacement() {
  if (!isShowroom()) return;
  var anchor = document.getElementById('showroom-inline-cart-anchor');
  var drw = document.getElementById('cart-drw');
  if (!anchor || !drw) return;
  var small = PRODUCTS.length < 6;
  if (small) {
    if (!showroomCartSavedParent) {
      showroomCartSavedParent = drw.parentNode;
      showroomCartSavedNext = drw.nextSibling;
    }
    document.body.classList.add('showroom-inline-cart');
    if (drw.parentNode !== anchor) anchor.appendChild(drw);
    drw.classList.add('on');
  } else {
    document.body.classList.remove('showroom-inline-cart');
    anchor.setAttribute('hidden', '');
    if (showroomCartSavedParent && drw.parentNode === anchor) {
      if (showroomCartSavedNext && showroomCartSavedNext.parentNode === showroomCartSavedParent) {
        showroomCartSavedParent.insertBefore(drw, showroomCartSavedNext);
      } else {
        showroomCartSavedParent.appendChild(drw);
      }
    }
    drw.classList.remove('on');
  }
  renderCart();
}

function addToCart(p, qty, variant) {
  if (productNeedsShowroomVariant(p)) {
    var v = (variant == null) ? '' : String(variant).trim();
    if (!v) {
      toast(t('Please select a size.','অনুগ্রহ করে সাইজ বেছে নিন।'));
      return;
    }
  } else {
    variant = null;
  }
  var k = cartKey(p, variant);
  var item = cart.find(function (i) { return i.key === k; });
  if (item) { item.qty += qty; }
  else { cart.push({ key: k, prod: p, qty: qty, variant: (productNeedsShowroomVariant(p) ? String(variant).trim() : null) }); }
  updBadge();
  refreshShowroomCartIfInline();
}

/* ── PRODUCT DRAWER ── */
var bundleProds=[];
function renderDrawerImages(p) {
  var di = document.getElementById('d-img');
  if (!di) return;
  var host = document.getElementById('d-img-thumbs');
  if (!host) {
    host = document.createElement('div');
    host.id = 'd-img-thumbs';
    host.className = 'dimg-thumbs';
    di.parentNode.insertBefore(host, di.nextSibling);
  }
  var imgs = (p && p.images && p.images.length) ? p.images.slice() : [];
  if (!imgs.length && p && p.image_url) imgs = [p.image_url];

  if (!imgs.length) {
    di.innerHTML = '<div class="dimg-emoji">' + (p.emoji || '🛍️') + '</div>';
    host.innerHTML = '';
    host.style.display = 'none';
    return;
  }

  function setMain(url) {
    di.innerHTML = '<img src="' + escAttr(url) + '" alt="' + escAttr(p.name) + '">';
  }

  setMain(imgs[0]);
  if (imgs.length <= 1) {
    host.innerHTML = '';
    host.style.display = 'none';
    return;
  }

  host.style.display = '';
  host.innerHTML = imgs.map(function (u, i) {
    return '<button type="button" class="dimg-thumb-btn' + (i === 0 ? ' on' : '') + '" data-dimg-i="' + i + '">' +
      '<img src="' + escAttr(u) + '" alt="">' +
      '</button>';
  }).join('');
  host.querySelectorAll('.dimg-thumb-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var idx = parseInt(btn.getAttribute('data-dimg-i'), 10);
      var url = imgs[idx];
      if (!url) return;
      setMain(url);
      host.querySelectorAll('.dimg-thumb-btn').forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
    });
  });
}

function getDrawerSelectedVariant() {
  var ch = document.querySelector('#drawer-var-wrap .showroom-var-chip.is-selected');
  if (!ch) return '';
  return String(ch.getAttribute('data-v') != null ? ch.getAttribute('data-v') : '').trim();
}

function setShowroomDrawerVarUI(p) {
  var w = document.getElementById('drawer-var-wrap');
  if (!w) return;
  if (!isShowroom() || !p || !p.variations || !p.variations.length) {
    w.style.display = 'none';
    w.setAttribute('hidden', '');
    w.innerHTML = '';
    var atc0 = document.getElementById('btn-atc');
    var bn0 = document.getElementById('btn-buy-now-drw');
    var bad0 = !p || !p.inStock;
    if (atc0) atc0.disabled = bad0;
    if (bn0) bn0.disabled = bad0;
    return;
  }
  w.removeAttribute('hidden');
  w.style.display = '';
  w.innerHTML = '<div class="dlabel" style="margin-bottom:6px">'
    + '<span class="en">Size / option</span>'
    + '<span class="bn">সাইজ / অপশন</span>'
    + '</div>'
    + showroomVarChipsGroupHtml(p, true);
  bindShowroomDrawerChips();
  syncShowroomDrawerVarButtons(p);
}

function syncShowroomDrawerVarButtons(p) {
  var atc = document.getElementById('btn-atc');
  var bnow = document.getElementById('btn-buy-now-drw');
  var bad = !p || !p.inStock;
  if (atc) atc.disabled = bad;
  if (bnow) bnow.disabled = bad;
}

function openDrawer(pid){
  var p=PRODUCTS.find(function(x){return x.id===pid;}); if(!p) return;
  activeProd=p; activeQty=1;
  /* 4. Track recently viewed */
  addToRV(pid);
  renderDrawerImages(p);
  var db=document.getElementById('d-badges'); db.innerHTML='';
  if(!p.inStock){db.innerHTML='<div class="pbadge pb-oos">'+t('Out of Stock','স্টক নেই')+'</div>';}
  else if(p.badge==='sale'){db.innerHTML='<div class="pbadge pb-sale">SALE</div>';}
  else if(p.badge==='new'){db.innerHTML='<div class="pbadge pb-new">NEW</div>';}
  else if(p.badge==='hot'){db.innerHTML='<div class="pbadge pb-hot">HOT</div>';}
  document.getElementById('d-name').textContent=p.name;
  document.getElementById('d-price').textContent=taka(p.price);
  document.getElementById('d-orig').textContent=p.original?taka(p.original):'';
  var dsave=document.getElementById('d-save');
  if(p.original){dsave.style.display='';dsave.textContent=t('Save '+taka(p.original-p.price),'বাঁচছে '+taka(p.original-p.price));}
  else{dsave.style.display='none';}
  /* 2. Stars in drawer */
  document.getElementById('d-rating').innerHTML=starsHtml(p.rating||0)+' <span style="font-size:12px;color:var(--ink3)">('+p.reviews+' '+t('reviews','রিভিউ')+')</span>';
  document.getElementById('d-desc').textContent=p.desc||'';
  setShowroomDrawerVarUI(p);

  /* 5. Bundle */
  bundleProds=[];
  var bb=document.getElementById('d-bundle');
  if(p.bundle&&p.bundle.length){
    var bps=p.bundle.map(function(bid){return PRODUCTS.find(function(x){return x.id===bid&&x.inStock;});}).filter(Boolean).slice(0,2);
    if(bps.length){
      bundleProds=[p].concat(bps);
      var total=bundleProds.reduce(function(s,x){return s+x.price;},0);
      var itemsHtml=bundleProds.map(function(x,i){
        var img=x.image_url?'<img src="'+x.image_url+'" style="width:100%;height:100%;object-fit:cover">':'<span>'+x.emoji+'</span>';
        return (i>0?'<span class="bundle-plus">+</span>':'')+'<div class="bundle-item"><div class="bundle-item-img">'+img+'</div><span>'+x.name.split('—')[0].trim()+'</span></div>';
      }).join('');
      document.getElementById('bundle-items').innerHTML=itemsHtml;
      document.getElementById('bundle-price').textContent=taka(total);
      bb.style.display='';
    } else { bb.style.display='none'; }
  } else { bb.style.display='none'; }

  updQtyUI();
  document.getElementById('pdrawer').classList.add('on');
  document.getElementById('pd-ovl').classList.add('on');
  document.body.style.overflow='hidden';
}
function closeDrawer(){
  document.getElementById('pdrawer').classList.remove('on');
  document.getElementById('pd-ovl').classList.remove('on');
  document.body.style.overflow='';
}
function updQtyUI(){
  document.getElementById('qval').textContent=activeQty;
  document.getElementById('qsubtotal').textContent=activeProd?taka(activeProd.price*activeQty):'৳0';
}

/* ── CART ↔ CHECKOUT delivery fields ── */
function syncCartDeliveryToCheckout() {
  var pairs = [
    ['cart-dlv-name', 'co-name'],
    ['cart-dlv-phone', 'co-phone'],
    ['cart-dlv-addr', 'co-addr'],
    ['cart-dlv-district', 'co-district'],
    ['cart-dlv-upazila', 'co-upazila'],
    ['cart-dlv-note', 'co-note']
  ];
  pairs.forEach(function (pair) {
    var from = si(pair[0]), to = si(pair[1]);
    if (from && to) to.value = from.value;
  });
  var cartPay = document.querySelector('#cart-delivery-wrap input[name="cart-payment"]:checked');
  if (cartPay) {
    document.querySelectorAll('#coscreen input[name="payment"]').forEach(function (r) {
      r.checked = r.value === cartPay.value;
    });
  }
  mirrorDistrictUpazila('cart-dlv', 'co');
  renderCart();
}

function syncCheckoutToCartDelivery() {
  var pairs = [
    ['co-name', 'cart-dlv-name'],
    ['co-phone', 'cart-dlv-phone'],
    ['co-addr', 'cart-dlv-addr'],
    ['co-district', 'cart-dlv-district'],
    ['co-upazila', 'cart-dlv-upazila'],
    ['co-note', 'cart-dlv-note']
  ];
  pairs.forEach(function (pair) {
    var from = si(pair[0]), to = si(pair[1]);
    if (from && to && !String(to.value || '').trim()) to.value = from.value;
  });
  var coPay = document.querySelector('#coscreen input[name="payment"]:checked');
  if (coPay) {
    var match = document.querySelector('#cart-delivery-wrap input[name="cart-payment"][value="' + coPay.value + '"]');
    if (match) match.checked = true;
  }
  mirrorDistrictUpazila('co', 'cart-dlv');
  renderCart();
}

/* ── CART DRAWER (reference: product row = thumb | name + meta + price line + qty stepper | delete) ── */
function cartSizeFromName(name) {
  var s = String(name || '');
  var i = s.lastIndexOf('—');
  if (i < 0) i = s.lastIndexOf('–');
  if (i >= 0) return s.slice(i + 1).trim();
  return '';
}

function renderCartShowroom(){
  var ci=document.getElementById('citems'),cf=document.getElementById('cftr');
  if(!cart.length){
    cf.style.display='none';
    var cdwEmpty=si('cart-delivery-wrap');
    if(cdwEmpty) cdwEmpty.style.display='none';
    var anchEmpty = si('showroom-inline-cart-anchor');
    if (isShowroomInlineCartMode() && anchEmpty) {
      anchEmpty.setAttribute('hidden', '');
      ci.innerHTML = '';
      return;
    }
    ci.innerHTML='<div class="cempty"><div class="cempty-icon">🛒</div><div class="cempty-title">'+t('Your cart is empty','কার্ট খালি')+'</div><div class="cempty-sub">'+t('Add some Joss finds!','কিছু জোস জিনিস যোগ করুন!')+'</div></div>';
    return;
  }
  var anchShow = si('showroom-inline-cart-anchor');
  if (isShowroomInlineCartMode() && anchShow) anchShow.removeAttribute('hidden');
  cf.style.display='';
  ci.innerHTML=cart.map(function(item){
    var p=item.prod;
    var lineTotal=p.price*item.qty;
    var img=p.image_url?'<img src="'+escAttr(p.image_url)+'" alt="'+escAttr(p.name)+'">':'<div class="ci-thumb-em">'+(p.emoji||'🛍️')+'</div>';
    var sizeBit=item.variant||cartSizeFromName(p.name);
    var metaParts=[];
    if(sizeBit){metaParts.push('<span class="ci-meta-line">'+t('Size','সাইজ')+': '+escHtml(sizeBit)+'</span>');}
    if(p.original){metaParts.push('<span class="ci-meta-line">'+t('Original price','মূল মূল্য')+': '+taka(p.original)+'</span>');}
    var metaHtml=metaParts.length?'<div class="ci-meta">'+metaParts.join('')+'</div>':'';
    return '<div class="citem">'
      +'<div class="ci-thumb">'+img+'</div>'
      +'<div class="ci-info">'
        +'<div class="ci-name">'+escHtml(p.name)+'</div>'
        +metaHtml
        +'<div class="ci-price-qty-row">'
          +'<span class="ci-price-current">'+taka(lineTotal)+'</span>'
          +'<span class="ci-qty-x">×'+item.qty+'</span>'
        +'</div>'
        +'<div class="ciqty ciqty--inline"><button type="button" class="ciq-btn" data-key="'+item.key+'" data-d="-1">−</button><span>'+item.qty+'</span><button type="button" class="ciq-btn" data-key="'+item.key+'" data-d="1">+</button></div>'
      +'</div>'
      +'<button type="button" class="ci-del" data-key="'+item.key+'" aria-label="'+t('Remove','সরান')+'">×</button>'
    +'</div>';
  }).join('');
  var sub=cartSub();
  var deliveryCharge = getSelectedDeliveryCharge('cart-dlv');
  var grandTotal = sub + deliveryCharge;
  var elSub=document.getElementById('cf-sub');
  if(elSub) elSub.textContent=taka(sub);
  var elDelivery=document.getElementById('cf-delivery');
  if(elDelivery) elDelivery.textContent=taka(deliveryCharge);
  var elTot=document.getElementById('cf-total');
  if(elTot) elTot.textContent=taka(grandTotal);
  var cdw=si('cart-delivery-wrap');
  if(cdw) cdw.style.display=cart.length?'block':'none';
}

function renderCartClassic(){
  var ci=document.getElementById('citems'),cf=document.getElementById('cftr');
  if(!cart.length){
    ci.innerHTML='<div class="cempty"><div class="cempty-icon">🛒</div><div class="cempty-title">'+t('Your cart is empty','কার্ট খালি')+'</div><div class="cempty-sub">'+t('Add some Joss finds!','কিছু জোস জিনিস যোগ করুন!')+'</div></div>';
    cf.style.display='none';
    return;
  }
  cf.style.display='';
  ci.innerHTML=cart.map(function(item){
    var p=item.prod;
    var img=p.image_url?'<img src="'+p.image_url+'">':'<div class="ci-thumb-em">'+(p.emoji||'🛍️')+'</div>';
    return '<div class="citem"><div class="ci-thumb">'+img+'</div><div class="ci-info"><div class="ci-name">'+p.name+'</div><div class="ci-btm"><div class="ciqty"><button class="ciq-btn" data-key="'+item.key+'" data-d="-1">−</button><span>'+item.qty+'</span><button class="ciq-btn" data-key="'+item.key+'" data-d="1">+</button></div><div class="ci-line-total">'+taka(p.price*item.qty)+'</div><button class="ci-del" data-key="'+item.key+'">×</button></div></div></div>';
  }).join('');
  var sub=cartSub();
  document.getElementById('cf-sub').textContent=taka(sub);
  document.getElementById('cf-total').textContent=taka(sub);
}

function renderCart(){
  if(isShowroom()) renderCartShowroom();
  else renderCartClassic();
}
function openCart(){
  renderCart();
  if(isShowroom()) syncCheckoutToCartDelivery();
  if (isShowroomInlineCartMode()) {
    document.getElementById('cart-drw').classList.add('on');
    maybeScrollShowroomInlineCart();
    return;
  }
  document.getElementById('cart-ovl').classList.add('on');
  document.getElementById('cart-drw').classList.add('on');
  document.body.style.overflow='hidden';
}
function closeCart(){
  if (isShowroomInlineCartMode()) return;
  document.getElementById('cart-ovl').classList.remove('on');
  document.getElementById('cart-drw').classList.remove('on');
  document.body.style.overflow='';
}

/* ── CHECKOUT ── */
function openCheckout(){
  closeCart();
  if(isShowroom()) syncCartDeliveryToCheckout();
  document.getElementById('co-lines').innerHTML=cart.map(function(item){
    var p=item.prod;
    var img=p.image_url?'<img src="'+p.image_url+'">':'<div class="ol-em">'+(p.emoji||'🛍️')+'</div>';
    var nm=p.name+(item.variant?' <span class="ol-var">— '+item.variant+'</span>':'');
    return '<div class="oline"><div class="ol-thumb">'+img+'</div><div class="ol-info"><div class="ol-name">'+nm+'</div><div class="ol-sub">'+t('Qty','পরিমাণ')+': '+item.qty+'</div></div><div class="ol-price">'+taka(p.price*item.qty)+'</div></div>';
  }).join('');
  var sub=cartSub();
  document.getElementById('co-sub').textContent=taka(sub);
  document.getElementById('co-total').textContent=taka(sub);
  document.getElementById('coscreen').classList.add('on');
  document.body.style.overflow='hidden';
}
function closeCheckout(){document.getElementById('coscreen').classList.remove('on');document.body.style.overflow='';}

/* ── PLACE ORDER (shared logging + WhatsApp text) ── */
var PAY_LABELS_ORDER = { cod:'Cash on Delivery', bkash:'bKash (Send Money)', nagad:'Nagad (Send Money)' };

function generateOrderId(){
  return (typeof crypto!=='undefined'&&crypto.randomUUID)
    ? crypto.randomUUID()
    : String(Date.now())+'-'+Math.random().toString(36).slice(2,11);
}

function logLinesFromCart(){
  return cart.map(function(item){
    return{
      productId:item.prod.id,
      productName:item.prod.name,
      variation:item.variant||'',
      qty:item.qty,
      unitPrice:item.prod.price,
      lineTotal:item.prod.price*item.qty
    };
  });
}

function postLogOrder(orderId, cust, payMethod){
  var sub=cartSub();
  var deliveryCharge = Number(cust.deliveryCharge || 0);
  var total = sub + deliveryCharge;
  var placedAt=new Date().toISOString();
  fetch('/api/log-order',{
    method:'POST',
    headers:{'Content-Type':'application/json; charset=utf-8'},
    body:JSON.stringify({
      orderId:orderId,
      placedAt:placedAt,
      customerName:cust.name,
      customerPhone:cust.phone,
      address:cust.addr,
      city:cust.district,
      area:cust.upazila,
      note:cust.note,
      payment:payMethod,
      orderSubtotal:sub,
      deliveryCharge:deliveryCharge,
      orderTotal:total,
      lines:logLinesFromCart()
    })
  }).catch(function(){});
  return { subtotal: sub, deliveryCharge: deliveryCharge, total: total };
}

function buildWhatsAppOrderText(cust, payMethod, pricing){
  var sub = pricing && pricing.subtotal ? pricing.subtotal : cartSub();
  var deliveryCharge = pricing && pricing.deliveryCharge ? pricing.deliveryCharge : 0;
  var total = pricing && pricing.total ? pricing.total : (sub + deliveryCharge);
  var fullAddr=[cust.addr,cust.upazila,cust.district].filter(Boolean).join(', ');
  var lines=cart.map(function(item,i){
    var lineName = item.prod.name + (item.variant ? ' (' + item.variant + ')' : '');
    return (i+1)+'. '+lineName+'\n   Qty: '+item.qty+' × '+taka(item.prod.price)+' = '+taka(item.prod.price*item.qty);
  }).join('\n');
  return '🛒 *New Order — '+CFG.STORE_NAME+'*\n\n'
    +'👤 *Name:* '+cust.name+'\n📞 *Phone:* '+cust.phone+'\n📍 *Address:* '+fullAddr+'\n\n'
    +'*Order Items:*\n'+lines+'\n\n'
    +'🧾 *Subtotal:* '+taka(sub)+'\n'
    +'🚚 *Delivery Charge:* '+taka(deliveryCharge)+'\n'
    +'💰 *Estimated Total:* '+taka(total)+'\n'
    +'💳 *Payment:* '+(PAY_LABELS_ORDER[payMethod]||'Cash on Delivery')
    +(cust.note?'\n\n📝 *Note:* '+cust.note:'');
}

function formatOrderRef(orderId){
  return orderId.replace(/-/g,'').substring(0,12).toUpperCase();
}

function phoneDigitsLen(s){
  return String(s||'').replace(/\D/g,'').length;
}

function validateShowroomDelivery(){
  var nameEl=si('cart-dlv-name'), phoneEl=si('cart-dlv-phone'), addrEl=si('cart-dlv-addr');
  if(!nameEl||!phoneEl||!addrEl){
    return { ok:false, msg:t('Cart form is missing. Refresh the page.','কার্ট ফর্ম পাওয়া যায়নি। পেজ রিফ্রেশ করুন।') };
  }
  var name=nameEl.value.trim();
  var phone=phoneEl.value.trim();
  var addr=addrEl.value.trim();
  var district=(si('cart-dlv-district')&&si('cart-dlv-district').value.trim())||'';
  var upazila=(si('cart-dlv-upazila')&&si('cart-dlv-upazila').value.trim())||'';
  var note=(si('cart-dlv-note')&&si('cart-dlv-note').value.trim())||'';
  if(!name){
    nameEl.focus();
    return { ok:false, msg:t('Please enter your full name.','পুরো নাম লিখুন।') };
  }
  if(!phone){
    phoneEl.focus();
    return { ok:false, msg:t('Please enter your phone number.','ফোন নম্বর লিখুন।') };
  }
  if(phoneDigitsLen(phone)<10){
    phoneEl.focus();
    return { ok:false, msg:t('Please enter a valid phone number (at least 10 digits).','সঠিক ফোন নম্বর দিন (কমপক্ষে ১০ ডিজিট)।') };
  }
  if(!addr){
    addrEl.focus();
    return { ok:false, msg:t('Please enter your delivery address.','ডেলিভারি ঠিকানা লিখুন।') };
  }
  if(!district){
    var districtEl=si('cart-dlv-district');
    if(districtEl) districtEl.focus();
    return { ok:false, msg:t('Please select your district.','আপনার জেলা সিলেক্ট করুন।') };
  }
  if(!upazila){
    var upazilaEl=si('cart-dlv-upazila');
    if(upazilaEl) upazilaEl.focus();
    return { ok:false, msg:t('Please select your thana/upazila.','আপনার থানা/উপজেলা সিলেক্ট করুন।') };
  }
  return { ok:true, name:name, phone:phone, addr:addr, district:district, upazila:upazila, note:note, deliveryCharge:getSelectedDeliveryCharge('cart-dlv') };
}

function clearCartDeliveryFields(){
  ['cart-dlv-name','cart-dlv-phone','cart-dlv-addr','cart-dlv-note'].forEach(function(id){
    var el=si(id); if(el) el.value='';
  });
  var districtEl=si('cart-dlv-district');
  if(districtEl) districtEl.value='';
  refreshUpazilaSelect('cart-dlv-upazila', '', '');
  mirrorDistrictUpazila('cart-dlv', 'co');
  var codPay=document.querySelector('#cart-delivery-wrap input[name="cart-payment"][value="cod"]');
  if(codPay) codPay.checked=true;
}

function showOrderCompleteScreen(orderId){
  var wrap=si('order-complete-screen');
  var numEl=si('order-complete-number');
  var wa=si('order-complete-wa');
  if(!wrap||!numEl) return;
  numEl.textContent=formatOrderRef(orderId);
  if(wa){
    if(window.__showroomOrderWaText&&CFG.WHATSAPP){
      wa.href='https://wa.me/'+CFG.WHATSAPP+'?text='+encodeURIComponent(window.__showroomOrderWaText);
      wa.style.display='';
    }else{
      wa.style.display='none';
    }
  }
  wrap.classList.add('on');
  wrap.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
}

function hideOrderCompleteScreen(){
  var wrap=si('order-complete-screen');
  if(wrap){
    wrap.classList.remove('on');
    wrap.setAttribute('aria-hidden','true');
  }
  document.body.style.overflow='';
  window.__showroomOrderWaText='';
}

function checkoutFromShowroomCart(){
  if(!cart.length){
    toast(t('Your cart is empty','কার্ট খালি'));
    return;
  }
  var v=validateShowroomDelivery();
  if(!v.ok){
    toast(v.msg);
    return;
  }
  var cust={ name:v.name, phone:v.phone, addr:v.addr, district:v.district, upazila:v.upazila, note:v.note, deliveryCharge:v.deliveryCharge };
  syncCartDeliveryToCheckout();
  var payEl=document.querySelector('#cart-delivery-wrap input[name="cart-payment"]:checked');
  var payMethod=payEl?payEl.value:'cod';
  var orderId=generateOrderId();
  var pricing=postLogOrder(orderId, cust, payMethod);
  window.__showroomOrderWaText=buildWhatsAppOrderText(cust, payMethod, pricing);
  cart=[]; updBadge(); renderCart();
  clearCartDeliveryFields();
  closeCart();
  showOrderCompleteScreen(orderId);
}

function onCheckoutButtonClick(){
  if(isShowroom()) checkoutFromShowroomCart();
  else openCheckout();
}

/* ── PLACE ORDER (full checkout screen — shop.html) ── */
function placeOrder(){
  var name=document.getElementById('co-name').value.trim();
  var phone=document.getElementById('co-phone').value.trim();
  var addr=document.getElementById('co-addr').value.trim();
  if(!name){toast(t('Please enter your name','আপনার নাম লিখুন'));return;}
  if(!phone){toast(t('Please enter your phone','ফোন নম্বর লিখুন'));return;}
  if(!addr){toast(t('Please enter your address','ঠিকানা লিখুন'));return;}
  if(phoneDigitsLen(phone)<10){
    toast(t('Please enter a valid phone number (at least 10 digits).','সঠিক ফোন নম্বর দিন (কমপক্ষে ১০ ডিজিট)।'));
    return;
  }
  var districtEl=si('co-district');
  var upazilaEl=si('co-upazila');
  var cityEl=si('co-city');
  var areaEl=si('co-area');
  var district=(districtEl&&districtEl.value.trim()) || (cityEl&&cityEl.value.trim()) || '';
  var upazila=(upazilaEl&&upazilaEl.value.trim()) || (areaEl&&areaEl.value.trim()) || '';
  var note=document.getElementById('co-note').value.trim();
  var payEl=document.querySelector('input[name="payment"]:checked');
  var payMethod=payEl?payEl.value:'cod';
  if(!cart.length){
    toast(t('Your cart is empty','কার্ট খালি'));
    return;
  }
  var cust={ name:name, phone:phone, addr:addr, district:district, upazila:upazila, note:note, deliveryCharge:getSelectedDeliveryCharge('co') };
  var orderId=generateOrderId();
  var pricing=postLogOrder(orderId, cust, payMethod);
  var msg=buildWhatsAppOrderText(cust, payMethod, pricing);
  window.open('https://wa.me/'+CFG.WHATSAPP+'?text='+encodeURIComponent(msg));
  cart=[]; updBadge(); renderCart(); closeCheckout();
  toast(t('Order sent! We\'ll confirm shortly 🎉','অর্ডার পাঠানো হয়েছে! 🎉'));
}

/* ── CSV ROW → PRODUCT OBJECT ── */
function rowToProduct(row, index) {
  // Parse the bundle field: accepts "2,16" or "2" or blank
  var bundleRaw = (row.bundle || '').toString().trim();
  var bundle = bundleRaw
    ? bundleRaw.split(',').map(function(x){ return parseInt(x.trim(), 10); }).filter(Boolean)
    : [];

  var inStockRaw = (row.in_stock || '').toString().trim().toUpperCase();
  // Availability only (no per-SKU stock counts). Default to in stock when blank.
  var inStock;
  if (inStockRaw === 'TRUE' || inStockRaw === '1' || inStockRaw === 'YES') inStock = true;
  else if (inStockRaw === 'FALSE' || inStockRaw === '0' || inStockRaw === 'NO') inStock = false;
  else inStock = true;

  var price = parseFloat(row.price) || 0;
  var origIn = parseFloat(row.original_price);
  var original = null;
  if (!isNaN(origIn) && origIn > price) original = origIn;

  var badge = (row.badge || '').trim().toLowerCase() || null;
  if (badge === 'sale' && !original) badge = null;
  var images = normalizeProductImages(row);

  var varRaw = (row.variations != null ? row.variations : row.variation);
  varRaw = (varRaw != null ? varRaw : '').toString().trim();
  var variations = varRaw
    ? (varRaw.indexOf('|') >= 0 ? varRaw.split('|') : varRaw.split(','))
        .map(function (x) { return x.trim(); })
        .filter(Boolean)
    : [];

  return {
    id:       parseInt(row.id, 10) || (index + 1),
    name:     (row.name || '').trim(),
    price:    price,
    original: original,
    category: (row.category || '').trim().toLowerCase(),
    emoji:    '🛍️',
    image_url:images[0] || '',
    image_urls:(row.image_urls || '').trim(),
    images:   images,
    desc:     (row.desc     || '').trim(),
    rating:   4.5,
    reviews:  0,
    badge:    badge,
    inStock:  inStock,
    views:    parseInt(row.views, 10) || Math.floor(Math.random() * 80 + 10),
    bundle:   bundle,
    variations: variations
  };
}

function parseInlineProducts() {
  var result = Papa.parse(INLINE_CSV, {
    header:         true,
    skipEmptyLines: true
  });
  if (result.data && result.data.length) {
    PRODUCTS = result.data.map(rowToProduct).filter(function(p){ return p.name; });
  } else {
    console.warn('INLINE_CSV parse failed — check your CSV syntax.');
    PRODUCTS = [];
  }
  showGrid();
}

/* ── LOAD PRODUCTS — data/products.csv via csv_url, else inline ── */
function loadProducts() {
  var url = (CFG.CSV_URL || '').trim();
  if (!url) {
    parseInlineProducts();
    return;
  }
  Papa.parse(url, {
    download:       true,
    header:         true,
    skipEmptyLines: true,
    complete: function (results) {
      if (!results.data || !results.data.length) {
        console.warn('CSV empty or parse failed, using inline product data.');
        parseInlineProducts();
        return;
      }
      PRODUCTS = results.data
        .map(rowToProduct)
        .filter(function (p) { return p.name; });
      showGrid();
    },
    error: function (err) {
      console.error('CSV fetch error:', err);
      toast(t('Could not load CSV — using built-in demo products', 'CSV লোড হয়নি — ডেমো পণ্য দেখানো হচ্ছে'));
      parseInlineProducts();
    }
  });
}

function showGrid(){
  document.getElementById('lgrid').style.display='none';
  document.getElementById('pgrid').style.display='grid';
  renderCatsBar();
  applyFilters();
  syncShowroomCartPlacement();
}

/* ── EVENTS ── */
function closestFrom(e,sel){
  var el=e.target; if(!el) return null;
  if(el.nodeType!==1) el=el.parentElement;
  return el?el.closest(sel):null;
}

document.addEventListener('DOMContentLoaded',function(){
  initDistrictUpazilaData();
  Promise.all([loadContext(), loadAssetBannerSlides()]).then(function(){
    if (isShowroom()) {
      lang = 'bn';
      document.body.classList.add('bn');
      document.body.classList.add('fade');
    }
    applyContext();
    if (isShowroom()) setLang('bn');
    initShowroomBanner();
    loadProducts();
  }).catch(function (err) {
    console.error(err);
    alert('Could not load data/context.json. Serve this folder over HTTP (e.g. npm start), or open the browser console for details.');
  });

  var searchInput=document.getElementById('search-input');
  if(searchInput) searchInput.addEventListener('input',function(){handleSearch(this.value);});

  document.getElementById('cats-bar').addEventListener('click',function(e){
    var btn=closestFrom(e,'.cat'); if(!btn) return;
    document.querySelectorAll('.cat').forEach(function(b){b.classList.remove('on');});
    btn.classList.add('on'); filterCat(btn.getAttribute('data-cat'));
  });

  document.getElementById('pgrid').addEventListener('click',function(e){
    var moreBtn=closestFrom(e,'.showroom-var-more');
    if(moreBtn && closestFrom(e,'#pgrid .pcard')){
      e.stopPropagation();
      var morePid=parseInt(moreBtn.getAttribute('data-pid'),10);
      if(!isNaN(morePid)) openDrawer(morePid);
      return;
    }
    var vchip=closestFrom(e,'.showroom-var-chip');
    if(vchip && vchip.getAttribute('data-v')!=null && vchip.getAttribute('data-v')!=='' && closestFrom(e,'#pgrid .pcard')){
      e.stopPropagation();
      var par=vchip.closest('.showroom-var-chips');
      if(!par) return;
      var pid=parseInt(par.getAttribute('data-pid'),10);
      if(isNaN(pid)) return;
      par.querySelectorAll('button.showroom-var-chip[data-v]').forEach(function(c){
        c.classList.remove('is-selected');
        c.setAttribute('aria-pressed','false');
      });
      vchip.classList.add('is-selected');
      vchip.setAttribute('aria-pressed','true');
      var rowHint=par.closest('.showroom-var-row');
      if(rowHint) rowHint.classList.remove('showroom-var--hint','showroom-var--shake');
      var cqv=document.getElementById('cqv-'+pid);
      if(cqv) cqv.textContent=String(getCardQty(pid));
      return;
    }
    var buy=closestFrom(e,'.btn-buy-now');
    if(buy && buy.getAttribute('data-pid')){
      e.stopPropagation();
      var pidBuy=parseInt(buy.getAttribute('data-pid'),10);
      buyNow(pidBuy,null,e);
      return;
    }
    var ab=closestFrom(e,'.btn-add');
    if(ab){
      e.stopPropagation();
      var pid=parseInt(ab.getAttribute('data-pid'),10);
      var p=PRODUCTS.find(function(x){return x.id===pid;});
      if(!p||!p.inStock) return;
      var v = getShowroomCardSelectedVariant(pid);
      if (productNeedsShowroomVariant(p) && !v) {
        flashShowroomVarRequiredForPid(pid);
        toast(t('Please select a size.','অনুগ্রহ করে সাইজ বেছে নিন।'));
        return;
      }
      var qty=getCardQty(pid);
      addToCart(p, qty, v || undefined);
      /* show qty row permanently after adding */
      var qr=document.getElementById('cqr-'+pid);
      if(qr) qr.classList.add('show');
      toast(t('Added to cart! 🛒','কার্টে যোগ হয়েছে! 🛒')); return;
    }
    var card=closestFrom(e,'.pcard');
    if(card) openDrawer(parseInt(card.getAttribute('data-pid'),10));
  });

  document.getElementById('pd-ovl').addEventListener('click',closeDrawer);
  document.getElementById('qminus').addEventListener('click',function(){if(activeQty>1){activeQty--;updQtyUI();}});
  document.getElementById('qplus').addEventListener('click',function(){activeQty++;updQtyUI();});
  document.getElementById('btn-atc').addEventListener('click',function(){
    if(!activeProd||!activeProd.inStock) return;
    var v = (productNeedsShowroomVariant(activeProd) ? getDrawerSelectedVariant() : '');
    if (productNeedsShowroomVariant(activeProd) && !v) {
      flashShowroomDrawerVarRequired();
      toast(t('Please select a size.','অনুগ্রহ করে সাইজ বেছে নিন।'));
      return;
    }
    addToCart(activeProd, activeQty, v || undefined);
    toast(t('Added to cart! 🛒','কার্টে যোগ হয়েছে! 🛒'));
    closeDrawer();
  });
  document.getElementById('btn-buy-now-drw').addEventListener('click',function(){
    if(!activeProd||!activeProd.inStock) return;
    var p=activeProd, q=activeQty;
    if (productNeedsShowroomVariant(p) && !getDrawerSelectedVariant()) {
      flashShowroomDrawerVarRequired();
      toast(t('Please select a size.','অনুগ্রহ করে সাইজ বেছে নিন।'));
      return;
    }
    var v = productNeedsShowroomVariant(p) ? getDrawerSelectedVariant() : null;
    if (isShowroom()) {
      addToCart(p, q, v || undefined);
      closeDrawer();
      openCart();
      toast(t('Added to cart! 🛒','কার্টে যোগ হয়েছে! 🛒'));
      return;
    }
    var drwV = productNeedsShowroomVariant(p) ? getDrawerSelectedVariant() : '';
    closeDrawer();
    var sizeL = drwV ? ('\n' + t('Size', 'সাইজ') + ': *' + drwV + '*\n') : '';
    var msg='🛍️ *Quick Order — '+CFG.STORE_NAME+'*\n\n'
      +'Product: *'+p.name+'*' + sizeL
      +'Quantity: '+q+'\n'
      +'Price: '+taka(p.price)+' × '+q+' = *'+taka(p.price*q)+'*\n\n'
      +'Please confirm my order and share delivery details. 🙏';
    window.open('https://wa.me/'+CFG.WHATSAPP+'?text='+encodeURIComponent(msg));
  });
  /* 5. Bundle add to cart */
  document.getElementById('btn-bundle').addEventListener('click',function(){
    var v0 = getDrawerSelectedVariant();
    if (activeProd && productNeedsShowroomVariant(activeProd) && !v0) {
      flashShowroomDrawerVarRequired();
      toast(t('Please select a size.','অনুগ্রহ করে সাইজ বেছে নিন।'));
      return;
    }
    bundleProds.forEach(function (p, i) {
      if (!p.inStock) return;
      if (i === 0 && activeProd && productNeedsShowroomVariant(activeProd)) addToCart(p, 1, v0);
      else if (productNeedsShowroomVariant(p) && p.variations && p.variations.length) {
        addToCart(p, 1, p.variations[0]);
      } else addToCart(p, 1);
    });
    toast(t('Bundle added to cart! 🛒','বান্ডেল কার্টে যোগ হয়েছে! 🛒'));
    closeDrawer();
  });

  document.getElementById('cart-open-btn').addEventListener('click',openCart);
  document.getElementById('cart-close').addEventListener('click',closeCart);
  document.getElementById('cart-ovl').addEventListener('click',closeCart);
  document.getElementById('citems').addEventListener('click',function(e){
    var qb=closestFrom(e,'.ciq-btn');
    if(qb){
      var k=qb.getAttribute('data-key'),d=parseInt(qb.getAttribute('data-d'),10);
      var item=cart.find(function(i){return i.key===k;}); if(!item) return;
      item.qty+=d;
      if(item.qty<=0) cart=cart.filter(function(i){return i.key!==k;});
      updBadge(); renderCart(); return;
    }
    var del=closestFrom(e,'.ci-del');
    if(del){cart=cart.filter(function(i){return i.key!==del.getAttribute('data-key');});updBadge();renderCart();}
  });
  document.getElementById('btn-to-checkout').addEventListener('click',onCheckoutButtonClick);
  document.getElementById('co-back').addEventListener('click',closeCheckout);
  var ocClose=si('order-complete-close');
  if(ocClose) ocClose.addEventListener('click',hideOrderCompleteScreen);
  document.getElementById('btn-wa-order').addEventListener('click', placeOrder);
  var btnWaInline = document.getElementById('btn-wa-order-inline');
  if (btnWaInline) btnWaInline.addEventListener('click', placeOrder);
  ['cart-dlv-district', 'cart-dlv-upazila'].forEach(function (id) {
    var el = si(id);
    if (!el) return;
    el.addEventListener('change', function () { renderCart(); });
  });
});
