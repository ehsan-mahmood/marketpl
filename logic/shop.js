// ╔══════════════════════════════════════════════════════════════════╗
// ║  SECTION 1 — STORE CONFIG & SITE TEXT (data/context.json)         ║
// ║  Edit data/context.json (csv_url e.g. data/products.csv). HTTP.   ║
// ║  fetch() does not work for file:// URLs.                        ║
// ╚══════════════════════════════════════════════════════════════════╝
var CTX = null;

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
}

function si(id){ return document.getElementById(id); }



// ── CSV COLUMN GUIDE ───────────────────────────────────────────────
// Required columns (must be present in header row):
//   id, name, price, category, emoji, desc, in_stock
// Optional columns (can be omitted; sensible defaults applied):
//   original_price  — strike-through price; leave blank for none
//   image_url       — URL or site path e.g. assets/photo.jpg; blank → emoji
//   rating          — e.g. 4.8   (default 4.5)
//   reviews         — e.g. 124   (default 0)
//   badge           — one of: sale | hot | new  (leave blank for none)
//   stock           — integer stock count; 0 treated as out-of-stock
//   views           — "X people viewed today" social proof number
//   bundle          — comma-separated IDs of 1–2 bundle partners e.g. "2,16"
//                     wrap in quotes in the CSV if using commas: "2,16"

// ╔══════════════════════════════════════════════════════════════════╗
// ║  SECTION 2 — PRODUCTS (inline CSV fallback)                    ║
// ║  Set csv_url in data/context.json (e.g. data/products.csv).        ║
// ║  If csv_url is "" or fetch fails, this embedded CSV is used.   ║
// ║  Columns: id, name, price, original_price, category, emoji,   ║
// ║           image_url, desc, rating, reviews, badge, in_stock,   ║
// ║           stock, views, bundle                                 ║
// ║  • badge: sale | hot | new | (blank)                          ║
// ║  • in_stock: TRUE or FALSE                                     ║
// ║  • bundle: quote the cell if it has a comma e.g. "2,16"       ║
// ╚══════════════════════════════════════════════════════════════════╝
var INLINE_CSV = `id,name,price,original_price,category,emoji,image_url,desc,rating,reviews,badge,in_stock,stock,views,bundle
1,Premium Cotton T-Shirt — S,450,600,clothing,👕,,Ultra-soft 100% combed cotton. Pre-shrunk. Size S.,4.8,124,sale,TRUE,12,34,"2,16"
2,Premium Cotton T-Shirt — M,450,600,clothing,👕,,Ultra-soft 100% combed cotton. Pre-shrunk. Size M.,4.8,124,sale,TRUE,3,51,"1,16"
3,Premium Cotton T-Shirt — L,450,600,clothing,👕,,Ultra-soft 100% combed cotton. Pre-shrunk. Size L.,4.8,124,sale,TRUE,7,29,"1,25"
4,Premium Cotton T-Shirt — XL,450,600,clothing,👕,,Ultra-soft 100% combed cotton. Pre-shrunk. Size XL.,4.8,124,sale,TRUE,2,18,"1,26"
5,Premium Cotton T-Shirt — XXL,450,600,clothing,👕,,Ultra-soft 100% combed cotton. Pre-shrunk. Size XXL.,4.8,124,sale,TRUE,9,22,"1,28"
6,Running Sneakers (EU 38),1800,2500,footwear,👟,,Lightweight EVA sole with breathable mesh upper. EU 38.,4.9,87,hot,TRUE,4,67,"16,23"
7,Running Sneakers (EU 39),1800,2500,footwear,👟,,Lightweight EVA sole with breathable mesh upper. EU 39.,4.9,87,hot,TRUE,11,43,"16,23"
8,Running Sneakers (EU 40),1800,2500,footwear,👟,,Lightweight EVA sole with breathable mesh upper. EU 40.,4.9,87,hot,TRUE,2,88,"16,20"
9,Running Sneakers (EU 41),1800,2500,footwear,👟,,Lightweight EVA sole with breathable mesh upper. EU 41.,4.9,87,hot,TRUE,6,71,"16,20"
10,Running Sneakers (EU 42),1800,2500,footwear,👟,,Lightweight EVA sole with breathable mesh upper. EU 42.,4.9,87,hot,TRUE,1,94,"16,21"
11,Running Sneakers (EU 43),1800,2500,footwear,👟,,Lightweight EVA sole with breathable mesh upper. EU 43.,4.9,87,hot,TRUE,8,55,"16,22"
12,Running Sneakers (EU 44),1800,2500,footwear,👟,,Lightweight EVA sole with breathable mesh upper. EU 44.,4.9,87,hot,TRUE,5,38,"16,22"
13,Genuine Leather Handbag — Black,1200,,accessories,👜,,Full-grain genuine leather. Black.,4.7,56,new,TRUE,15,42,"29,16"
14,Genuine Leather Handbag — Brown,1200,,accessories,👜,,Full-grain genuine leather. Brown.,4.7,56,new,TRUE,3,33,"30,16"
15,Genuine Leather Handbag — Tan,1200,,accessories,👜,,Full-grain genuine leather. Tan.,4.7,56,new,TRUE,7,27,"29,16"
16,UV400 Polarized Sunglasses,380,550,accessories,🕶️,,Polarized UV400 protection. Unisex design. Includes hard case.,4.6,203,sale,TRUE,20,112,"6,1"
17,Smart Watch Pro — Black,2800,3500,electronics,⌚,,1.4" AMOLED heart rate SpO2 7-day battery. Black.,4.8,341,hot,TRUE,2,143,"23,20"
18,Smart Watch Pro — Silver,2800,3500,electronics,⌚,,1.4" AMOLED heart rate SpO2 7-day battery. Silver.,4.8,341,hot,TRUE,5,98,"23,21"
19,Smart Watch Pro — Rose Gold,2800,3500,electronics,⌚,,1.4" AMOLED heart rate SpO2 7-day battery. Rose gold.,4.8,341,hot,TRUE,3,87,"23,22"
20,Laptop Backpack 30L — Black,1100,,accessories,🎒,,30L padded 15.6" laptop slot USB-C charge port. Black.,4.7,178,new,TRUE,10,76,"17,23"
21,Laptop Backpack 30L — Navy,1100,,accessories,🎒,,30L padded 15.6" laptop slot USB-C charge port. Navy.,4.7,178,new,TRUE,6,54,"18,23"
22,Laptop Backpack 30L — Olive,1100,,accessories,🎒,,30L padded 15.6" laptop slot USB-C charge port. Olive.,4.7,178,new,TRUE,4,41,"19,23"
23,True Wireless Earbuds — Black,950,1400,electronics,🎧,,30h total battery ANC IPX5. Black.,4.5,92,sale,TRUE,8,63,"17,20"
24,True Wireless Earbuds — White,950,1400,electronics,🎧,,30h total battery ANC IPX5. White.,4.5,92,sale,TRUE,2,49,"18,21"
25,Linen Kurta — S,680,850,clothing,👘,,Premium linen blend. Traditional cut. Size S.,4.9,215,,TRUE,9,88,"1,16"
26,Linen Kurta — M,680,850,clothing,👘,,Premium linen blend. Traditional cut. Size M.,4.9,215,,TRUE,12,102,"2,16"
27,Linen Kurta — L,680,850,clothing,👘,,Premium linen blend. Traditional cut. Size L.,4.9,215,,TRUE,7,79,"3,16"
28,Linen Kurta — XL,680,850,clothing,👘,,Premium linen blend. Traditional cut. Size XL.,4.9,215,,TRUE,3,56,"4,16"
29,Slim Leather Wallet — Black,550,700,accessories,👛,,Slim genuine leather bifold. RFID blocking. Black.,4.8,144,new,FALSE,0,38,"13,16"
30,Slim Leather Wallet — Brown,550,700,accessories,👛,,Slim genuine leather bifold. RFID blocking. Brown.,4.8,144,new,FALSE,0,29,"14,16"
31,Canvas Slip-On — White,650,,footwear,👟,,Classic canvas. Flexible rubber sole. White.,4.6,67,,TRUE,14,45,"16,1"
32,Canvas Slip-On — Black,650,,footwear,👟,,Classic canvas. Flexible rubber sole. Black.,4.6,67,,TRUE,5,61,"16,2"
33,Canvas Slip-On — Red,650,,footwear,👟,,Classic canvas. Flexible rubber sole. Red.,4.6,67,,TRUE,2,33,"16,3"
34,Canvas Slip-On — Navy,650,,footwear,👟,,Classic canvas. Flexible rubber sole. Navy.,4.6,67,,TRUE,8,52,"16,4"`;
// ── end of Section 2 ─────────────────────────────────────────────

var PRODUCTS=[], cart=[], activeProd=null, activeQty=1, lang='en';
var activeChip=null, searchQuery='', activeCat='all';
/* card qty state: pid -> qty */
var cardQty={};
/* 4. Recently Viewed */
var recentlyViewed=[];

/* ── LANG ── */
function setLang(l){
  lang=l;
  document.body.className=l==='bn'?'bn fade':'fade';
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

/* ── CARD INLINE QTY ── */
function getCardQty(pid){ return cardQty[pid]||1; }
function setCardQty(pid,delta,e){
  e.stopPropagation();
  var q=Math.max(1,(cardQty[pid]||1)+delta);
  cardQty[pid]=q;
  var el=document.getElementById('cqv-'+pid);
  if(el) el.textContent=q;
}

/* ── BUY NOW (direct WhatsApp, skip cart) ── */
function buyNow(pid,qty,e){
  if(e) e.stopPropagation();
  var p=PRODUCTS.find(function(x){return x.id===pid;});
  if(!p||!p.inStock) return;
  var q=qty||getCardQty(pid);
  var msg='🛍️ *Quick Order — '+CFG.STORE_NAME+'*\n\n'
    +'Product: *'+p.name+'*\n'
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

/* ── COMBINED FILTER ── */
function applyFilters(){
  var list=PRODUCTS;
  if(activeCat!=='all') list=list.filter(function(p){return p.category===activeCat;});
  if(activeChip==='hot') list=list.filter(function(p){return p.badge==='hot'||p.badge==='sale';});
  if(activeChip==='cheap') list=list.filter(function(p){return p.price<1000;});
  if(activeChip==='new') list=list.filter(function(p){return p.badge==='new';});
  if(searchQuery) list=list.filter(function(p){return p.name.toLowerCase().includes(searchQuery)||(p.desc||'').toLowerCase().includes(searchQuery);});
  var labels={all:t('All Products','সব পণ্য'),clothing:t('Clothing','পোশাক'),footwear:t('Footwear','জুতা'),accessories:t('Accessories','আনুষাঙ্গিক'),electronics:t('Electronics','ইলেকট্রনিক্স')};
  document.getElementById('sec-label').textContent=searchQuery?t('Search Results','সার্চ ফলাফল'):(labels[activeCat]||activeCat);
  document.getElementById('sec-count').textContent=list.length+' '+t('items','টি পণ্য');
  renderGrid(list);
}

/* ── RENDER GRID ── */
function renderGrid(list){
  var g=document.getElementById('pgrid');
  if(!list.length){g.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--ink3)">'+t('No products found.','কোনো পণ্য পাওয়া যায়নি।')+'</div>';return;}
  g.innerHTML=list.map(function(p){
    var badge='';
    if(!p.inStock)            badge='<div class="pbadge pb-oos">'+t('Out of Stock','স্টক নেই')+'</div>';
    else if(p.badge==='sale') badge='<div class="pbadge pb-sale">SALE</div>';
    else if(p.badge==='new')  badge='<div class="pbadge pb-new">NEW</div>';
    else if(p.badge==='hot')  badge='<div class="pbadge pb-hot">HOT</div>';
    var img=p.image_url?'<img src="'+p.image_url+'" alt="'+p.name+'" loading="lazy">':'<div class="pcard-emoji">'+(p.emoji||'🛍️')+'</div>';
    var orig=p.original?'<span class="porig">'+taka(p.original)+'</span>':'';
    /* 2. Star ratings */
    var ratingRow='<div class="prating-row">'+starsHtml(p.rating||0)+'<span class="prating-count">('+p.reviews+')</span></div>';
    /* 3. Social proof */
    var social=p.views&&p.inStock?'<div class="psocial"><span class="psocial-dot"></span>'+p.views+' '+t('people viewed today','জন আজ দেখেছেন')+'</div>':'';
    /* urgency */
    var urgency=(p.inStock&&p.stock&&p.stock<=3)?'<div class="purgency">'+t('Only '+p.stock+' left!','মাত্র '+p.stock+'টি বাকি!')+'</div>':'';
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
    return '<div class="pcard'+(p.inStock?'':' oos')+'" data-pid="'+p.id+'">'
      +'<div class="pcard-img" style="position:relative">'+img+badge+'</div>'
      +'<div class="pcard-body">'
      +'<div class="pname">'+p.name+'</div>'
      +'<div class="price-row"><span class="pprice">'+taka(p.price)+'</span>'+orig+'</div>'
      +ratingRow+social+urgency+delivery
      +'<div class="pcard-foot">'+cardFoot+'</div>'
      +'</div></div>';
  }).join('');
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
function cartKey(p){return 'p'+p.id;}
function cartSub(){return cart.reduce(function(s,i){return s+i.prod.price*i.qty;},0);}
function updBadge(){
  var n=cart.reduce(function(s,i){return s+i.qty;},0);
  var b=document.getElementById('cbadge');
  b.textContent=n; b.classList.toggle('on',n>0);
}
function addToCart(p,qty){
  var k=cartKey(p),item=cart.find(function(i){return i.key===k;});
  if(item){item.qty+=qty;}else{cart.push({key:k,prod:p,qty:qty});}
  updBadge();
}

/* ── PRODUCT DRAWER ── */
var bundleProds=[];
function openDrawer(pid){
  var p=PRODUCTS.find(function(x){return x.id===pid;}); if(!p) return;
  activeProd=p; activeQty=1;
  /* 4. Track recently viewed */
  addToRV(pid);
  var di=document.getElementById('d-img');
  di.innerHTML=p.image_url?'<img src="'+p.image_url+'" alt="'+p.name+'">':'<div class="dimg-emoji">'+(p.emoji||'🛍️')+'</div>';
  var db=document.getElementById('d-badges'); db.innerHTML='';
  if(!p.inStock){db.innerHTML='<div class="pbadge pb-oos">'+t('Out of Stock','স্টক নেই')+'</div>';}
  else if(p.badge==='sale'){db.innerHTML='<div class="pbadge pb-sale">SALE</div>';}
  else if(p.badge==='new'){db.innerHTML='<div class="pbadge pb-new">NEW</div>';}
  else if(p.badge==='hot'){db.innerHTML='<div class="pbadge pb-hot">HOT</div>';}
  if(p.inStock&&p.stock&&p.stock<=3){db.innerHTML+='<div class="pbadge" style="background:#fff3ee;color:#e8440a;border:1px solid #ffd4c2">⚠ '+t('Only '+p.stock+' left','মাত্র '+p.stock+'টি বাকি')+'</div>';}
  document.getElementById('d-name').textContent=p.name;
  document.getElementById('d-price').textContent=taka(p.price);
  document.getElementById('d-orig').textContent=p.original?taka(p.original):'';
  var dsave=document.getElementById('d-save');
  if(p.original){dsave.style.display='';dsave.textContent=t('Save '+taka(p.original-p.price),'বাঁচছে '+taka(p.original-p.price));}
  else{dsave.style.display='none';}
  /* 2. Stars in drawer */
  document.getElementById('d-rating').innerHTML=starsHtml(p.rating||0)+' <span style="font-size:12px;color:var(--ink3)">('+p.reviews+' '+t('reviews','রিভিউ')+')</span>';
  document.getElementById('d-desc').textContent=p.desc||'';

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

/* ── CART DRAWER ── */
function renderCart(){
  var ci=document.getElementById('citems'),cf=document.getElementById('cftr');
  if(!cart.length){
    ci.innerHTML='<div class="cempty"><div class="cempty-icon">🛒</div><div class="cempty-title">'+t('Your cart is empty','কার্ট খালি')+'</div><div class="cempty-sub">'+t('Add some Joss finds!','কিছু জোস জিনিস যোগ করুন!')+'</div></div>';
    cf.style.display='none'; return;
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
function openCart(){renderCart();document.getElementById('cart-ovl').classList.add('on');document.getElementById('cart-drw').classList.add('on');document.body.style.overflow='hidden';}
function closeCart(){document.getElementById('cart-ovl').classList.remove('on');document.getElementById('cart-drw').classList.remove('on');document.body.style.overflow='';}

/* ── CHECKOUT ── */
function openCheckout(){
  closeCart();
  document.getElementById('co-lines').innerHTML=cart.map(function(item){
    var p=item.prod;
    var img=p.image_url?'<img src="'+p.image_url+'">':'<div class="ol-em">'+(p.emoji||'🛍️')+'</div>';
    return '<div class="oline"><div class="ol-thumb">'+img+'</div><div class="ol-info"><div class="ol-name">'+p.name+'</div><div class="ol-sub">'+t('Qty','পরিমাণ')+': '+item.qty+'</div></div><div class="ol-price">'+taka(p.price*item.qty)+'</div></div>';
  }).join('');
  var sub=cartSub();
  document.getElementById('co-sub').textContent=taka(sub);
  document.getElementById('co-total').textContent=taka(sub);
  document.getElementById('coscreen').classList.add('on');
  document.body.style.overflow='hidden';
}
function closeCheckout(){document.getElementById('coscreen').classList.remove('on');document.body.style.overflow='';}

/* ── PLACE ORDER ── */
function placeOrder(){
  var name=document.getElementById('co-name').value.trim();
  var phone=document.getElementById('co-phone').value.trim();
  var addr=document.getElementById('co-addr').value.trim();
  if(!name){toast(t('Please enter your name','আপনার নাম লিখুন'));return;}
  if(!phone){toast(t('Please enter your phone','ফোন নম্বর লিখুন'));return;}
  if(!addr){toast(t('Please enter your address','ঠিকানা লিখুন'));return;}
  var city=document.getElementById('co-city').value.trim();
  var area=document.getElementById('co-area').value.trim();
  var note=document.getElementById('co-note').value.trim();
  var fullAddr=[addr,area,city].filter(Boolean).join(', ');
  var payEl=document.querySelector('input[name="payment"]:checked');
  var payMethod=payEl?payEl.value:'cod';
  var payLabels={cod:'Cash on Delivery',bkash:'bKash (Send Money)',nagad:'Nagad (Send Money)'};
  if(!cart.length){
    toast(t('Your cart is empty','কার্ট খালি'));
    return;
  }
  var lines=cart.map(function(item,i){
    return (i+1)+'. '+item.prod.name+'\n   Qty: '+item.qty+' × '+taka(item.prod.price)+' = '+taka(item.prod.price*item.qty);
  }).join('\n');
  var sub=cartSub();
  var orderId=(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2,11);
  var placedAt=new Date().toISOString();
  var logLines=cart.map(function(item){
    return{
      productId:item.prod.id,
      productName:item.prod.name,
      qty:item.qty,
      unitPrice:item.prod.price,
      lineTotal:item.prod.price*item.qty
    };
  });
  fetch('/api/log-order',{
    method:'POST',
    headers:{'Content-Type':'application/json; charset=utf-8'},
    body:JSON.stringify({
      orderId:orderId,
      placedAt:placedAt,
      customerName:name,
      customerPhone:phone,
      address:addr,
      city:city,
      area:area,
      note:note,
      payment:payMethod,
      orderSubtotal:sub,
      lines:logLines
    })
  }).catch(function(){});
  var msg='🛒 *New Order — '+CFG.STORE_NAME+'*\n\n'
    +'👤 *Name:* '+name+'\n📞 *Phone:* '+phone+'\n📍 *Address:* '+fullAddr+'\n\n'
    +'*Order Items:*\n'+lines+'\n\n'
    +'💰 *Estimated Total:* '+taka(sub)+'\n💳 *Payment:* '+(payLabels[payMethod]||'Cash on Delivery')
    +(note?'\n\n📝 *Note:* '+note:'');
  window.open('https://wa.me/'+CFG.WHATSAPP+'?text='+encodeURIComponent(msg));
  cart=[]; updBadge(); closeCheckout();
  toast(t('Order sent! We\'ll confirm shortly 🎉','অর্ডার পাঠানো হয়েছে! 🎉'));
}

/* ── CSV ROW → PRODUCT OBJECT ── */
function rowToProduct(row, index) {
  // Parse the bundle field: accepts "2,16" or "2" or blank
  var bundleRaw = (row.bundle || '').toString().trim();
  var bundle = bundleRaw
    ? bundleRaw.split(',').map(function(x){ return parseInt(x.trim(), 10); }).filter(Boolean)
    : [];

  var stockVal  = parseInt(row.stock, 10);
  var inStockRaw = (row.in_stock || '').toString().trim().toUpperCase();
  // Treat: TRUE / 1 / YES / (non-zero stock when field missing) as in stock
  var inStock = (inStockRaw === 'TRUE' || inStockRaw === '1' || inStockRaw === 'YES')
    ? true
    : (inStockRaw === 'FALSE' || inStockRaw === '0' || inStockRaw === 'NO')
      ? false
      : stockVal > 0; // fallback: derive from stock count

  var price = parseFloat(row.price) || 0;
  var origIn = parseFloat(row.original_price);
  var original = null;
  if (!isNaN(origIn) && origIn > price) original = origIn;

  var badge = (row.badge || '').trim().toLowerCase() || null;
  if (badge === 'sale' && !original) badge = null;

  return {
    id:       parseInt(row.id, 10) || (index + 1),
    name:     (row.name || '').trim(),
    price:    price,
    original: original,
    category: (row.category || '').trim().toLowerCase(),
    emoji:    (row.emoji    || '🛍️').trim(),
    image_url:(row.image_url|| '').trim(),
    desc:     (row.desc     || '').trim(),
    rating:   parseFloat(row.rating)  || 4.5,
    reviews:  parseInt(row.reviews,10)|| 0,
    badge:    badge,
    inStock:  inStock,
    stock:    isNaN(stockVal) ? 99 : stockVal,
    views:    parseInt(row.views, 10) || Math.floor(Math.random() * 80 + 10),
    bundle:   bundle
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
  applyFilters();
}

/* ── EVENTS ── */
function closestFrom(e,sel){
  var el=e.target; if(!el) return null;
  if(el.nodeType!==1) el=el.parentElement;
  return el?el.closest(sel):null;
}

document.addEventListener('DOMContentLoaded',function(){
  loadContext().then(function(){
    applyContext();
    loadProducts();
  }).catch(function (err) {
    console.error(err);
    alert('Could not load data/context.json. Serve this folder over HTTP (e.g. npm start), or open the browser console for details.');
  });

  var si=document.getElementById('search-input');
  if(si) si.addEventListener('input',function(){handleSearch(this.value);});

  document.getElementById('cats-bar').addEventListener('click',function(e){
    var btn=closestFrom(e,'.cat'); if(!btn) return;
    document.querySelectorAll('.cat').forEach(function(b){b.classList.remove('on');});
    btn.classList.add('on'); filterCat(btn.getAttribute('data-cat'));
  });

  document.getElementById('pgrid').addEventListener('click',function(e){
    var ab=closestFrom(e,'.btn-add');
    if(ab){
      e.stopPropagation();
      var pid=parseInt(ab.getAttribute('data-pid'),10);
      var p=PRODUCTS.find(function(x){return x.id===pid;});
      if(!p||!p.inStock) return;
      var qty=getCardQty(pid);
      addToCart(p,qty);
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
    try{addToCart(activeProd,activeQty);toast(t('Added to cart! 🛒','কার্টে যোগ হয়েছে! 🛒'));}
    finally{closeDrawer();}
  });
  document.getElementById('btn-buy-now-drw').addEventListener('click',function(){
    if(!activeProd||!activeProd.inStock) return;
    var p=activeProd, q=activeQty;
    closeDrawer();
    var msg='🛍️ *Quick Order — '+CFG.STORE_NAME+'*\n\n'
      +'Product: *'+p.name+'*\n'
      +'Quantity: '+q+'\n'
      +'Price: '+taka(p.price)+' × '+q+' = *'+taka(p.price*q)+'*\n\n'
      +'Please confirm my order and share delivery details. 🙏';
    window.open('https://wa.me/'+CFG.WHATSAPP+'?text='+encodeURIComponent(msg));
  });
  /* 5. Bundle add to cart */
  document.getElementById('btn-bundle').addEventListener('click',function(){
    bundleProds.forEach(function(p){if(p.inStock) addToCart(p,1);});
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
  document.getElementById('btn-to-checkout').addEventListener('click',openCheckout);
  document.getElementById('co-back').addEventListener('click',closeCheckout);
  document.getElementById('btn-wa-order').addEventListener('click', placeOrder);
  var btnWaInline = document.getElementById('btn-wa-order-inline');
  if (btnWaInline) btnWaInline.addEventListener('click', placeOrder);
});
