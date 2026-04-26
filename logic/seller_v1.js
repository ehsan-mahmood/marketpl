(function () {
  'use strict';

  // ===== STATE =====
  var CTX = null;
  var productRows = [];
  var lastOrders = [];
  var orderFilter = 'all';
  var productsSource = 'csv';
  var ordersSource = 'csv';
  var ordersCanMutate = true;
  var deliveryMap = null;
  var deliveryDistricts = [];
  
  var currentEditingProductId = null;
  var currentEditingSetting = null;

  var PRODUCT_FIELDS = [
    'id', 'name', 'price', 'original_price', 'category', 'image_urls', 'desc',
    'badge', 'in_stock', 'views', 'bundle', 'variations'
  ];

  function $(id) { return document.getElementById(id); }

  // ===== HELPERS =====
  function stripTags(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.innerHTML = String(s);
    return d.textContent || d.innerText || '';
  }

  function updateGreeting() {
    var h = new Date().getHours();
    var g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    var el = $('seller-greeting');
    if (el) el.textContent = g;
  }

  function todayYmd() {
    var d = new Date();
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function isPlacedOnLocalDay(placed) {
    if (placed == null) return false;
    var t = String(placed).replace('T', ' ').trim().slice(0, 10);
    return t === todayYmd();
  }

  function parseSubtotalNum(v) {
    var n = parseFloat(String(v || '').replace(/[^\d.-]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function splitImageUrls(text) {
    return String(text || '')
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function joinImageUrls(arr) {
    return (arr || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean).join(', ');
  }

  function showMsg(text, ok) {
    var el = $('msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'msg seller-msg on ' + (ok ? 'ok' : 'err');
    clearTimeout(showMsg._t);
    showMsg._t = setTimeout(function () { el.className = 'msg seller-msg'; }, 4500);
  }

  function showLoginScreen() {
    $('login-screen').style.display = '';
    $('seller-app').style.display = 'none';
  }

  function showSellerApp() {
    $('login-screen').style.display = 'none';
    $('seller-app').style.display = '';
    updateGreeting();
  }

  // ===== ORDERS =====
  function orderMatchesFilter(o) {
    if (orderFilter === 'all') return true;
    var s = String(o.status || 'placed').toLowerCase();
    if (orderFilter === 'new') return s === 'placed';
    if (orderFilter === 'confirmed') return s === 'confirmed';
    if (orderFilter === 'despatched') return s === 'despatched';
    if (orderFilter === 'delivered') return s === 'delivered';
    return true;
  }

  function ocardClassForStatus(status) {
    var s = String(status || 'placed').toLowerCase();
    if (s === 'placed') return 'new';
    if (s === 'confirmed') return 'conf';
    if (s === 'despatched') return 'desp';
    if (s === 'delivered') return 'desp';
    return 'new';
  }

  function badgeClassForStatus(status) {
    var s = String(status || 'placed').toLowerCase();
    if (s === 'placed') return 'b-placed';
    if (s === 'confirmed') return 'b-conf';
    if (s === 'despatched') return 'b-desp';
    if (s === 'delivered') return 'b-desp';
    return 'b-placed';
  }

  function capStatus(status) {
    var s = String(status || 'placed');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Placed';
  }

  function summarizeOrderLines(o) {
    var lines = o.lines || [];
    if (!lines.length) return '—';
    var parts = lines.map(function (L) {
      var q = L.qty != null && L.qty !== '' ? String(L.qty) : '1';
      var n = (L.productName || L.productId || '').trim();
      return '×' + q + ' ' + n;
    });
    var s = parts.join('; ');
    if (s.length > 140) s = s.slice(0, 137) + '…';
    return s;
  }

  function nextOrderActionLabel(status) {
    var s = String(status || 'placed').toLowerCase();
    if (s === 'placed') return 'Confirm';
    if (s === 'confirmed') return 'Despatch';
    if (s === 'despatched') return 'Delivered';
    return 'Next';
  }

  function formatFullDelivery(o) {
    var parts = [];
    function add(x) {
      var s = x != null ? String(x).trim() : '';
      if (s) parts.push(s);
    }
    add(o.address);
    add(o.city);
    add(o.area);
    var line = parts.join(', ');
    var note = o.note != null ? String(o.note).trim() : '';
    if (note) line = line ? line + ' · ' + note : note;
    return line;
  }

  function updateOrderStats(orders) {
    var placedN = 0;
    var need = 0;
    var rev = 0;
    var desp = 0;
    var delv = 0;
    (orders || []).forEach(function (o) {
      var s = String(o.status || 'placed').toLowerCase();
      if (s === 'placed') {
        placedN++;
        need++;
      }
      if (s === 'confirmed') need++;
      if (isPlacedOnLocalDay(o.placedAt)) {
        rev += parseSubtotalNum(o.subtotal);
      }
      if (s === 'despatched') desp++;
      if (s === 'delivered') delv++;
    });
    var tEl = $('seller-ticker-text');
    if (tEl) {
      tEl.textContent =
        placedN > 0
          ? placedN + ' new order' + (placedN === 1 ? '' : 's') + ' — tap to confirm and dispatch'
          : "You're all caught up — no new orders waiting";
    }
    var sn = $('seller-stat-need');
    if (sn) sn.textContent = String(need);
    var sr = $('seller-stat-rev');
    if (sr) sr.textContent = '৳' + (Math.round(rev) || 0).toLocaleString();
    var sd = $('seller-stat-desp');
    if (sd) sd.textContent = String(desp);
    var sdel = $('seller-stat-del');
    if (sdel) sdel.textContent = String(delv);
    var pip = $('seller-notif-pip');
    if (pip) {
      if (placedN > 0) pip.removeAttribute('hidden');
      else pip.setAttribute('hidden', '');
    }
  }

  function syncOrderFilterPills(orders) {
    var nPlaced = 0;
    (orders || []).forEach(function (o) {
      if (String(o.status || 'placed').toLowerCase() === 'placed') nPlaced++;
    });
    var pNew = $('order-pill-new');
    if (pNew) pNew.textContent = nPlaced ? 'New (' + nPlaced + ')' : 'New';
  }

  function renderOrdersList(orders) {
    lastOrders = orders || [];
    updateOrderStats(lastOrders);
    syncOrderFilterPills(lastOrders);
    var list = lastOrders.filter(orderMatchesFilter);
    var host = $('orders-list');
    if (!host) return;
    var countEl = $('orders-count');
    if (countEl) {
      if (orderFilter === 'all' || !lastOrders.length) {
        countEl.textContent = (list.length || 0) + ' order(s)';
      } else {
        countEl.textContent = list.length + ' of ' + lastOrders.length + ' order(s)';
      }
    }
    if (!list.length) {
      if (!lastOrders.length) {
        host.innerHTML =
          '<div class="empty-promo" role="status"><div class="ep-icon" aria-hidden="true">🛍</div>' +
          '<div class="ep-title">No orders yet</div><p class="ep-sub">When customers check out, orders will appear here.</p></div>';
      } else {
        host.innerHTML =
          '<div class="empty-promo" role="status"><div class="ep-icon" aria-hidden="true">↻</div>' +
          '<div class="ep-title">No orders in this filter</div><p class="ep-sub">Try "All orders" or pick another status.</p></div>';
      }
      return;
    }
    host.innerHTML = '';
    list.forEach(function (o) {
      var card = document.createElement('div');
      card.className = 'ocard ' + ocardClassForStatus(o.status);
      var row1 = document.createElement('div');
      row1.className = 'oc-row1';
      var left = document.createElement('div');
      var nm = document.createElement('div');
      nm.className = 'oc-name';
      nm.textContent = o.customerName || '—';
      var time = document.createElement('div');
      time.className = 'oc-time';
      var tParts = [o.customerPhone, o.placedAt, formatFullDelivery(o)].filter(function (x) {
        return (x != null && String(x).trim() !== '');
      });
      time.textContent = tParts.join(' · ');
      left.appendChild(nm);
      left.appendChild(time);
      var badge = document.createElement('span');
      badge.className = 'oc-badge ' + badgeClassForStatus(o.status);
      badge.textContent = capStatus(o.status);
      row1.appendChild(left);
      row1.appendChild(badge);
      var items = document.createElement('div');
      items.className = 'oc-items';
      items.textContent = summarizeOrderLines(o);
      var foot = document.createElement('div');
      foot.className = 'oc-foot';
      var total = document.createElement('div');
      total.className = 'oc-total';
      total.textContent = o.subtotal != null && String(o.subtotal).trim() ? String(o.subtotal) : '—';
      var btns = document.createElement('div');
      btns.className = 'oc-btns';
      var btnN = document.createElement('button');
      btnN.type = 'button';
      btnN.className = 'btn-s btn-main';
      btnN.textContent = nextOrderActionLabel(o.status);
      btnN.disabled = !ordersCanMutate;
      var oid = o.orderId || '';
      btnN.addEventListener('click', function () {
        ordersAdvance(oid);
      });
      var btnD = document.createElement('button');
      btnD.type = 'button';
      btnD.className = 'btn-s btn-del';
      btnD.textContent = 'Delete';
      btnD.disabled = !ordersCanMutate;
      btnD.addEventListener('click', function () {
        ordersDelete(oid, o.customerName || oid);
      });
      btns.appendChild(btnD);
      btns.appendChild(btnN);
      foot.appendChild(total);
      foot.appendChild(btns);
      card.appendChild(row1);
      card.appendChild(items);
      card.appendChild(foot);
      host.appendChild(card);
    });
  }

  function loadOrders() {
    return fetch('/api/admin/orders?cb=' + Date.now(), { credentials: 'include', cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) {
          showLoginScreen();
          showMsg('Session expired — sign in again.', false);
          throw new Error('Unauthorized');
        }
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (x) {
        if (!x.ok || !x.j.ok) throw new Error((x.j && x.j.error) || 'Load failed');
        ordersCanMutate = x.j.canMutate !== false;
        ordersSource = x.j.source != null ? String(x.j.source) : 'csv';
        renderOrdersList(x.j.orders || []);
      });
  }

  function ordersAdvance(orderId) {
    fetch('/api/admin/orders/advance', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ orderId: orderId })
    })
      .then(function (r) {
        if (r.status === 401) {
          showLoginScreen();
          showMsg('Session expired — sign in again.', false);
          throw new Error('Unauthorized');
        }
        return r.json().then(function (j) {
          return { httpOk: r.ok, j: j };
        });
      })
      .then(function (result) {
        var success = !!(result && result.httpOk && result.j && result.j.ok);
        return loadOrders()
          .catch(function () {})
          .then(function () {
            if (success) showMsg('Orders updated.', true);
          });
      })
      .catch(function (e) {
        if (String(e.message) === 'Unauthorized') return;
        return loadOrders().catch(function () {});
      });
  }

  var orderDeletePendingId = null;

  function openOrderDeleteModal(orderId, label) {
    orderDeletePendingId = orderId;
    var el = $('order-delete-modal');
    var p = $('order-delete-msg');
    p.textContent =
      'Remove order for "' +
      (label || orderId) +
      '" (' +
      orderId +
      ')? This cannot be undone.';
    el.removeAttribute('hidden');
    el.setAttribute('aria-hidden', 'false');
    $('order-delete-confirm').focus();
  }

  function closeOrderDeleteModal() {
    orderDeletePendingId = null;
    var el = $('order-delete-modal');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
  }

  function ordersDelete(orderId, label) {
    openOrderDeleteModal(orderId, label);
  }

  function runPendingOrderDelete() {
    var orderId = orderDeletePendingId;
    if (!orderId) return;
    closeOrderDeleteModal();
    fetch('/api/admin/orders/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ orderId: orderId })
    })
      .then(function (r) {
        if (r.status === 401) {
          showLoginScreen();
          showMsg('Session expired — sign in again.', false);
          throw new Error('Unauthorized');
        }
        return r.json().then(function (j) {
          return { httpOk: r.ok, j: j };
        });
      })
      .then(function (result) {
        var success = !!(result && result.httpOk && result.j && result.j.ok);
        return loadOrders()
          .catch(function () {})
          .then(function () {
            if (success) showMsg('Orders updated.', true);
          });
      })
      .catch(function (e) {
        if (String(e.message) === 'Unauthorized') return;
        return loadOrders().catch(function () {});
      });
  }

  $('order-delete-cancel').addEventListener('click', closeOrderDeleteModal);
  $('order-delete-confirm').addEventListener('click', runPendingOrderDelete);
  $('order-delete-modal').addEventListener('click', function (ev) {
    if (ev.target === $('order-delete-modal')) closeOrderDeleteModal();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('order-delete-modal').hasAttribute('hidden')) {
      closeOrderDeleteModal();
    }
  });

  $('btn-orders-refresh').addEventListener('click', function () {
    loadOrders().catch(function (e) {
      if (String(e.message) !== 'Unauthorized') {
        showMsg(e && e.message ? e.message : 'Refresh failed', false);
      }
    });
  });

  document.querySelectorAll('#order-filter-pills .pill').forEach(function (p) {
    p.addEventListener('click', function () {
      var f = p.getAttribute('data-filter') || 'all';
      orderFilter = f;
      document.querySelectorAll('#order-filter-pills .pill').forEach(function (x) {
        x.classList.toggle('on', (x.getAttribute('data-filter') || 'all') === f);
        x.setAttribute('aria-pressed', (x.getAttribute('data-filter') || 'all') === f ? 'true' : 'false');
      });
      renderOrdersList(lastOrders);
    });
  });

  // ===== PRODUCTS (CARD UI) =====
  function renderProductCards() {
    var list = $('product-cards-list');
    if (!list) return;
    list.innerHTML = '';
    
    var readOnly = productsSource === 'google_sheets';
    
    productRows.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'prod-card';
      
      // Thumb: first image or emoji/letter fallback
      var thumbUrl = splitImageUrls(p.image_urls)[0];
      var thumbHtml;
      if (thumbUrl) {
        thumbHtml = '<img class="prod-thumb" src="' + thumbUrl + '" onerror="this.style.display=\'none\'" alt="" />';
      } else {
        var emoji = p.name ? p.name.charAt(0).toUpperCase() : '📦';
        thumbHtml = '<div class="prod-thumb">' + emoji + '</div>';
      }
      
      var priceHtml = '৳' + (p.price || '0');
      if (p.original_price && p.original_price !== p.price) {
        priceHtml += ' <del>৳' + p.original_price + '</del>';
      }
      priceHtml += ' · ' + (p.category || 'general');
      
      var inStock = String(p.in_stock || '').toUpperCase() === 'TRUE';
      
      card.innerHTML =
        thumbHtml +
        '<div class="prod-card-mid">' +
          '<div class="prod-name">' + (p.name || 'Untitled') + '</div>' +
          '<div class="prod-price">' + priceHtml + '</div>' +
        '</div>' +
        '<div class="prod-right">' +
          '<span class="stk ' + (inStock ? 'stk-in">In stock' : 'stk-out">Out') + '</span>' +
          (readOnly ? '' : '<button class="edit-btn" data-product-id="' + (p.id || '') + '">Edit →</button>') +
        '</div>';
      
      list.appendChild(card);
    });
    
    // Bind edit buttons
    if (!readOnly) {
      list.querySelectorAll('.edit-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          openProductEditModal(btn.getAttribute('data-product-id'));
        });
      });
    }
    
    var countEl = $('prod-count');
    if (countEl) countEl.textContent = productRows.length + ' product(s)';
    
    var notice = $('products-sheets-notice');
    if (notice) notice.style.display = readOnly ? 'block' : 'none';
  }

  function loadProducts() {
    return fetch('/api/admin/products?cb=' + Date.now(), { credentials: 'include', cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) {
          showLoginScreen();
          showMsg('Session expired — sign in again.', false);
          throw new Error('Unauthorized');
        }
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (x) {
        if (!x.ok || !x.j.ok) throw new Error((x.j && x.j.error) || 'Could not load products');
        productsSource = x.j.source === 'google_sheets' ? 'google_sheets' : 'csv';
        var text = x.j.csv != null ? String(x.j.csv) : '';
        var parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        productRows = (parsed.data || []).map(function (row) {
          var o = {};
          PRODUCT_FIELDS.forEach(function (f) {
            o[f] = row[f] != null && row[f] !== undefined ? String(row[f]) : '';
          });
          return o;
        }).filter(function (row) {
          return (row.name || '').trim() !== '';
        });
        renderProductCards();
      });
  }

  $('btn-reload-products').addEventListener('click', function () {
    loadProducts().catch(function (e) {
      if (String(e.message) !== 'Unauthorized') {
        showMsg(e && e.message ? e.message : 'Refresh failed', false);
      }
    });
  });

  $('btn-add-product-card').addEventListener('click', function () {
    if (productsSource === 'google_sheets') {
      showMsg('Cannot add products in Google Sheets mode.', false);
      return;
    }
    // Create new empty product
    var newId = Math.max(0, ...productRows.map(function(p) { return parseInt(p.id, 10) || 0; })) + 1;
    var newProduct = {};
    PRODUCT_FIELDS.forEach(function(f) {
      newProduct[f] = f === 'id' ? String(newId) : (f === 'in_stock' ? 'TRUE' : '');
    });
    newProduct.name = 'New product';
    newProduct.price = '0';
    newProduct.category = 'clothing';
    productRows.push(newProduct);
    renderProductCards();
    openProductEditModal(String(newId));
  });

  // Product edit modal
  function openProductEditModal(productId) {
    var product = productRows.find(function(p) { return String(p.id) === String(productId); });
    if (!product) return;
    
    currentEditingProductId = productId;
    var modal = $('product-edit-modal');
    var title = $('product-edit-title');
    var form = $('product-edit-form');
    
    title.textContent = product.name || 'Edit product';
    
    form.innerHTML =
      '<div class="form-section">' +
        '<h3>Basic info</h3>' +
        '<div class="form-group">' +
          '<label class="form-label">Product name</label>' +
          '<input class="form-input" type="text" id="pe-name" value="' + (product.name || '').replace(/"/g, '&quot;') + '" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Price (৳)</label>' +
          '<input class="form-input" type="number" id="pe-price" value="' + (product.price || '') + '" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Original price (৳)</label>' +
          '<input class="form-input" type="number" id="pe-original-price" value="' + (product.original_price || '') + '" />' +
          '<p class="form-hint">Optional. Shows as strikethrough.</p>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Category</label>' +
          '<select class="form-select" id="pe-category">' +
            '<option value="clothing"' + (product.category === 'clothing' ? ' selected' : '') + '>Clothing</option>' +
            '<option value="footwear"' + (product.category === 'footwear' ? ' selected' : '') + '>Footwear</option>' +
            '<option value="accessories"' + (product.category === 'accessories' ? ' selected' : '') + '>Accessories</option>' +
            '<option value="home"' + (product.category === 'home' ? ' selected' : '') + '>Home</option>' +
            '<option value="electronics"' + (product.category === 'electronics' ? ' selected' : '') + '>Electronics</option>' +
            '<option value="other"' + (product.category === 'other' ? ' selected' : '') + '>Other</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Description</label>' +
          '<textarea class="form-textarea" id="pe-desc">' + (product.desc || '').replace(/</g, '&lt;') + '</textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">In stock</label>' +
          '<select class="form-select" id="pe-in-stock">' +
            '<option value="TRUE"' + (String(product.in_stock).toUpperCase() === 'TRUE' ? ' selected' : '') + '>Yes</option>' +
            '<option value="FALSE"' + (String(product.in_stock).toUpperCase() === 'FALSE' ? ' selected' : '') + '>No</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="form-section">' +
        '<h3>Images</h3>' +
        '<div id="pe-images-list" class="prod-image-mini-list"></div>' +
        '<div class="prod-image-add-row">' +
          '<input class="form-input" type="text" id="pe-new-image-url" placeholder="https://… or assets/…" />' +
          '<button type="button" class="btn-add-image" id="pe-add-image">Add</button>' +
        '</div>' +
        '<p class="form-hint" style="margin-top:8px">Paste image URLs or upload from your device.</p>' +
      '</div>';
    
    renderProductImageList(product.image_urls);
    
    $('pe-add-image').addEventListener('click', function() {
      var url = $('pe-new-image-url').value.trim();
      if (!url) return;
      var current = splitImageUrls(product.image_urls);
      if (current.indexOf(url) === -1) current.push(url);
      product.image_urls = joinImageUrls(current);
      renderProductImageList(product.image_urls);
      $('pe-new-image-url').value = '';
    });
    
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  function renderProductImageList(imageUrlsString) {
    var list = $('pe-images-list');
    if (!list) return;
    list.innerHTML = '';
    var urls = splitImageUrls(imageUrlsString);
    if (!urls.length) {
      list.innerHTML = '<p class="form-hint">No images yet.</p>';
      return;
    }
    urls.forEach(function(url, idx) {
      var item = document.createElement('div');
      item.className = 'prod-image-mini-item';
      item.innerHTML =
        '<img src="' + url + '" alt="" />' +
        '<button type="button" class="prod-image-mini-remove" data-idx="' + idx + '">×</button>';
      list.appendChild(item);
    });
    
    list.querySelectorAll('.prod-image-mini-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var product = productRows.find(function(p) { return String(p.id) === String(currentEditingProductId); });
        if (!product) return;
        var urls = splitImageUrls(product.image_urls);
        urls.splice(idx, 1);
        product.image_urls = joinImageUrls(urls);
        renderProductImageList(product.image_urls);
      });
    });
  }

  function closeProductEditModal() {
    var modal = $('product-edit-modal');
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    currentEditingProductId = null;
  }

  function saveProductFromModal() {
    var idx = productRows.findIndex(function(p) { return String(p.id) === String(currentEditingProductId); });
    if (idx === -1) return;
    
    productRows[idx].name = $('pe-name').value;
    productRows[idx].price = $('pe-price').value;
    productRows[idx].original_price = $('pe-original-price').value;
    productRows[idx].category = $('pe-category').value;
    productRows[idx].desc = $('pe-desc').value;
    productRows[idx].in_stock = $('pe-in-stock').value;
    
    closeProductEditModal();
    renderProductCards();
    
    // Save to server
    var csv = Papa.unparse({ fields: PRODUCT_FIELDS, data: productRows.map(function (r) {
      return PRODUCT_FIELDS.map(function (f) {
        return r[f] != null ? String(r[f]) : '';
      });
    })});
    
    fetch('/api/save-products', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ csv: csv })
    })
      .then(function (r) {
        if (r.status === 401) {
          showLoginScreen();
          showMsg('Session expired — sign in again.', false);
          throw new Error('Unauthorized');
        }
        return r.json().then(function (j) {
          if (!r.ok || !j.ok) {
            if (j && j.readOnly) {
              showMsg(j.error || 'Catalog is read-only for Google Sheets mode.', false);
              return null;
            }
            throw new Error((j && j.error) || String(r.status));
          }
          return j;
        });
      })
      .then(function (j) {
        if (!j) return;
        showMsg('Product saved.', true);
      })
      .catch(function (e) {
        if (String(e.message) !== 'Unauthorized') {
          showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
        }
      });
  }

  $('product-edit-back').addEventListener('click', closeProductEditModal);
  $('product-edit-save').addEventListener('click', saveProductFromModal);
  $('product-edit-modal').addEventListener('click', function (ev) {
    if (ev.target === $('product-edit-modal')) closeProductEditModal();
  });

  // ===== SETTINGS (ROWS → MODALS) =====
  function loadContext() {
    return fetch('data/context.json?cb=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('data/context.json ' + r.status);
        return r.json();
      })
      .then(function (data) {
        CTX = data;
        updateSettingPreviews();
        var ns = $('seller-store-name');
        if (ns && CTX.store) {
          var raw = (CTX.store.name_en || CTX.store.name_bn || 'Your store').trim();
          ns.textContent = stripTags(raw) || 'Your store';
        }
      });
  }

  function updateSettingPreviews() {
    if (!CTX) return;
    
    var storeName = $('setting-preview-store-name');
    if (storeName && CTX.store) {
      var name = stripTags(CTX.store.name_en || CTX.store.name_bn || 'Joss Finds');
      storeName.textContent = name + ' →';
    }
    
    var whatsapp = $('setting-preview-whatsapp');
    if (whatsapp) {
      var wa = CTX.whatsapp || '';
      whatsapp.textContent = wa ? '+880' + wa.slice(-7) + '… →' : 'Not set →';
    }
    
    var delivery = $('setting-preview-delivery');
    if (delivery && deliveryMap) {
      var charge = deliveryMap.delivery_charge || 0;
      delivery.textContent = '৳' + charge + ' →';
    }
    
    var trust = $('setting-preview-trust');
    if (trust && CTX.trust_items) {
      trust.textContent = (CTX.trust_items.length || 0) + ' items →';
    }
    
    var payment = $('setting-preview-payment');
    if (payment && CTX.pay_methods) {
      var pm = CTX.pay_methods || [];
      payment.textContent = pm.length ? pm.join(', ') + ' →' : 'None →';
    }
  }

  function openSettingEditModal(settingKey) {
    currentEditingSetting = settingKey;
    var modal = $('setting-edit-modal');
    var title = $('setting-edit-title');
    var form = $('setting-edit-form');
    
    // Simple settings only for now - full implementation would handle all
    switch(settingKey) {
      case 'store-name':
        title.textContent = 'Store name';
        form.innerHTML =
          '<div class="form-section">' +
            '<div class="form-group">' +
              '<label class="form-label">English name</label>' +
              '<input class="form-input" type="text" id="se-store-name-en" value="' + ((CTX.store && CTX.store.name_en) || '').replace(/"/g, '&quot;') + '" />' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Bengali name</label>' +
              '<input class="form-input" type="text" id="se-store-name-bn" value="' + ((CTX.store && CTX.store.name_bn) || '').replace(/"/g, '&quot;') + '" />' +
            '</div>' +
          '</div>';
        break;
      
      case 'whatsapp':
        title.textContent = 'WhatsApp number';
        form.innerHTML =
          '<div class="form-section">' +
            '<div class="form-group">' +
              '<label class="form-label">Phone (digits only)</label>' +
              '<input class="form-input" type="tel" id="se-whatsapp" value="' + (CTX.whatsapp || '') + '" placeholder="8801XXXXXXXXX" />' +
              '<p class="form-hint">Used for customer inquiries</p>' +
            '</div>' +
          '</div>';
        break;
      
      case 'password':
        title.textContent = 'Change password';
        form.innerHTML =
          '<div class="form-section">' +
            '<div class="form-group">' +
              '<label class="form-label">Current password</label>' +
              '<input class="form-input" type="password" id="se-pw-old" autocomplete="current-password" />' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">New password</label>' +
              '<input class="form-input" type="password" id="se-pw-new" autocomplete="new-password" />' +
              '<p class="form-hint">At least 6 characters</p>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Confirm new password</label>' +
              '<input class="form-input" type="password" id="se-pw-new2" autocomplete="new-password" />' +
            '</div>' +
          '</div>';
        break;
      
      default:
        title.textContent = 'Edit setting';
        form.innerHTML = '<div class="form-section"><p class="form-hint">This setting editor is not yet implemented. Use the admin panel for now.</p></div>';
        var saveBtn = $('setting-edit-save');
        if (saveBtn) saveBtn.style.display = 'none';
        break;
    }
    
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeSettingEditModal() {
    var modal = $('setting-edit-modal');
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    currentEditingSetting = null;
    var saveBtn = $('setting-edit-save');
    if (saveBtn) saveBtn.style.display = '';
  }

  function saveSettingFromModal() {
    if (!currentEditingSetting) return;
    
    switch(currentEditingSetting) {
      case 'store-name':
        if (!CTX.store) CTX.store = {};
        CTX.store.name_en = $('se-store-name-en').value;
        CTX.store.name_bn = $('se-store-name-bn').value;
        break;
      
      case 'whatsapp':
        CTX.whatsapp = $('se-whatsapp').value;
        break;
      
      case 'password':
        var oldPw = $('se-pw-old').value;
        var newPw = $('se-pw-new').value;
        var newPw2 = $('se-pw-new2').value;
        if (newPw.length < 6) {
          showMsg('New password must be at least 6 characters.', false);
          return;
        }
        if (newPw !== newPw2) {
          showMsg('New passwords do not match.', false);
          return;
        }
        fetch('/api/admin/change-password', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw })
        })
          .then(function (r) {
            if (r.status === 401) {
              showLoginScreen();
              showMsg('Session expired — sign in again.', false);
              throw new Error('Unauthorized');
            }
            return r.json().then(function (j) {
              return { ok: r.ok, j: j };
            });
          })
          .then(function (x) {
            if (!x.ok) {
              showMsg((x.j && x.j.error) ? x.j.error : 'Could not change password', false);
              return;
            }
            closeSettingEditModal();
            showMsg('Password updated.', true);
          })
          .catch(function (e) {
            if (String(e.message) !== 'Unauthorized') {
              showMsg('Error: ' + (e && e.message ? e.message : e), false);
            }
          });
        return;
      
      default:
        closeSettingEditModal();
        return;
    }
    
    closeSettingEditModal();
    
    // Save context to server
    fetch('/api/save-context', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(CTX)
    })
      .then(function (r) {
        if (r.status === 401) {
          showLoginScreen();
          showMsg('Session expired — sign in again.', false);
          throw new Error('Unauthorized');
        }
        return r.json().then(function (j) {
          if (!r.ok || !j.ok) throw new Error((j && j.error) || r.status);
          return j;
        });
      })
      .then(function () {
        updateSettingPreviews();
        showMsg('Setting saved.', true);
      })
      .catch(function (e) {
        if (String(e.message) !== 'Unauthorized') {
          showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
        }
      });
  }

  document.querySelectorAll('.sg-row[data-setting]').forEach(function(row) {
    row.addEventListener('click', function() {
      var setting = row.getAttribute('data-setting');
      openSettingEditModal(setting);
    });
  });

  $('setting-edit-back').addEventListener('click', closeSettingEditModal);
  $('setting-edit-save').addEventListener('click', saveSettingFromModal);
  $('setting-edit-modal').addEventListener('click', function (ev) {
    if (ev.target === $('setting-edit-modal')) closeSettingEditModal();
  });

  function loadDeliveryMap() {
    return fetch('data/bangladesh_districts_upazilas_map.json?cb=' + Date.now(), {
      cache: 'no-store',
      credentials: 'include'
    })
      .then(function (r) {
        if (r.status === 401) {
          showLoginScreen();
          showMsg('Session expired — sign in again.', false);
          throw new Error('Unauthorized');
        }
        if (!r.ok) throw new Error('Could not load delivery map (' + r.status + ')');
        return r.json();
      })
      .then(function (data) {
        deliveryMap = data || {};
        var list = [];
        (deliveryMap.divisions || []).forEach(function (div) {
          (div.districts || []).forEach(function (d) {
            var name = d && d.district != null ? String(d.district).trim() : '';
            if (!name) return;
            list.push({ name: name, ref: d });
          });
        });
        list.sort(function (a, b) { return a.name.localeCompare(b.name); });
        deliveryDistricts = list;
        updateSettingPreviews();
      });
  }

  // ===== NAVIGATION =====
  function setActivePanel(id) {
    document.querySelectorAll('#seller-nav .nav-i').forEach(function (x) {
      x.classList.toggle('on', x.getAttribute('data-panel') === id);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('on', p.id === id);
    });
    
    // Scroll to top
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('#seller-nav .nav-i').forEach(function (t) {
    t.addEventListener('click', function () {
      var id = t.getAttribute('data-panel');
      if (!id) return;
      setActivePanel(id);
      if (id === 'p-orders') {
        loadOrders().catch(function (e) {
          if (String(e.message) !== 'Unauthorized') {
            showMsg(e && e.message ? e.message : 'Could not load orders', false);
          }
        });
      }
    });
  });

  // ===== LOGIN =====
  $('btn-login').addEventListener('click', function () {
    var lm = $('login-msg');
    lm.className = 'msg login-msg';
    lm.textContent = '';
    fetch('/api/admin/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        phone: $('login-phone').value,
        password: $('login-pass').value
      })
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (x) {
        if (!x.ok) {
          lm.textContent = (x.j && x.j.error) ? x.j.error : 'Login failed';
          lm.className = 'msg login-msg on err';
          return;
        }
        $('login-pass').value = '';
        lm.className = 'msg login-msg';
        lm.textContent = '';
        showSellerApp();
        startSellerData();
      })
      .catch(function (e) {
        lm.textContent = e && e.message ? e.message : 'Network error';
        lm.className = 'msg login-msg on err';
      });
  });

  $('login-pass').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') $('btn-login').click();
  });

  $('btn-logout-row').addEventListener('click', function () {
    fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }).then(function () {
      showLoginScreen();
    });
  });

  // ===== STARTUP =====
  function startSellerData() {
    loadContext()
      .then(loadProducts)
      .then(loadDeliveryMap)
      .then(function () {
        return loadOrders().catch(function () {});
      })
      .catch(function (e) {
        showMsg('Load error: ' + (e && e.message ? e.message : e), false);
      });
  }

  if (location.protocol === 'file:') {
    showMsg('Open this page via the local server (npm start), not file:// — saving will not work.', false);
  }

  fetch('/api/admin/status', { credentials: 'include' })
    .then(function (r) {
      return r.json();
    })
    .then(function (s) {
      if (s.loggedIn) {
        showSellerApp();
        startSellerData();
      } else {
        showLoginScreen();
      }
    })
    .catch(function () {
      showLoginScreen();
    });
})();
