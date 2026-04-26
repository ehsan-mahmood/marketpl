(function () {
  'use strict';

  // ===== STATE =====
  var CTX = null;
  var productRows = [];
  var lastOrders = [];
  var orderFilter = 'all';
  var orderSearchQuery = '';
  var productSearchQuery = '';
  var productCategoryFilter = 'all';
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

  function formatTaka(v) {
    var n = parseSubtotalNum(v);
    if (isFinite(n) && n > 0) return '৳' + Math.round(n).toLocaleString();
    var raw = String(v == null ? '' : v).trim();
    if (!raw) return '৳0';
    return raw.indexOf('৳') >= 0 ? raw : ('৳' + raw);
  }

  function formatPlacedAtForBangladesh(v) {
    var raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    var d = new Date(raw);
    if (!(d instanceof Date) || isNaN(d.getTime())) return raw;
    try {
      var fmt = new Intl.DateTimeFormat('en-BD', {
        timeZone: 'Asia/Dhaka',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return fmt.format(d) + ' (BDT)';
    } catch (e) {
      return d.toLocaleString();
    }
  }

  function lineTotalFromLineItem(line) {
    if (!line) return 0;
    var raw = line.line_total != null ? line.line_total : (line.lineTotal != null ? line.lineTotal : '');
    var n = parseFloat(String(raw || '').replace(/[^\d.-]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function totalProductViews() {
    var total = 0;
    (productRows || []).forEach(function (p) {
      var n = parseInt(String((p && p.views) || '0'), 10);
      if (isFinite(n) && n > 0) total += n;
    });
    return total;
  }

  function websiteVisitsTodayFromViews() {
    // views in CSV are cumulative; use daily baseline to estimate today's visits.
    var today = todayYmd();
    var baseDateKey = 'marketpl_views_baseline_date';
    var baseCountKey = 'marketpl_views_baseline_total';
    var current = totalProductViews();
    var baseDate = '';
    var baseCount = 0;
    try {
      baseDate = localStorage.getItem(baseDateKey) || '';
      baseCount = parseInt(localStorage.getItem(baseCountKey) || '0', 10);
      if (!isFinite(baseCount) || baseCount < 0) baseCount = 0;
      if (baseDate !== today) {
        baseDate = today;
        baseCount = current;
        localStorage.setItem(baseDateKey, baseDate);
        localStorage.setItem(baseCountKey, String(baseCount));
      }
    } catch (e) {
      // localStorage may be unavailable; fall back to cumulative count.
      return current;
    }
    var delta = current - baseCount;
    return delta > 0 ? delta : 0;
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

  function uploadProductImage(file, productName, onDone) {
    if (!file) return;
    var fd = new FormData();
    fd.append('file', file, file.name || 'upload');
    fd.append('productName', String(productName || '').trim());
    fetch('/api/admin/upload-product-image', { method: 'POST', body: fd, credentials: 'include' })
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
        if (!x.ok || !x.j.ok) throw new Error((x.j && x.j.error) || 'Upload failed');
        var p = x.j.path != null ? String(x.j.path) : '';
        if (p && typeof onDone === 'function') onDone(p);
        showMsg('Image uploaded. Save product to keep changes.', true);
      })
      .catch(function (e) {
        if (String(e.message) !== 'Unauthorized') {
          showMsg(e && e.message ? e.message : 'Upload failed', false);
        }
      });
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

  function orderMatchesSearch(o) {
    var q = String(orderSearchQuery || '').trim().toLowerCase();
    if (!q) return true;
    var parts = [];
    parts.push(o.customerPhone || '');
    parts.push(o.address || '');
    parts.push(o.city || '');
    parts.push(o.area || '');
    parts.push(o.note || '');
    var lines = o.lines || [];
    lines.forEach(function (L) {
      parts.push(L.productName || '');
      parts.push(L.productId || '');
      parts.push(L.variation || L.variations || '');
    });
    var hay = parts.join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
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

  function orderLinesTableHtml(order) {
    var lines = order && order.lines ? order.lines : [];
    if (!lines.length) return '<p class="oc-details-empty">No line items.</p>';
    var rows = lines.map(function (L) {
      var name = (L.productName || L.productId || '—');
      var qty = (L.qty != null && String(L.qty).trim() !== '') ? String(L.qty) : '1';
      var variation = '';
      if (L.variation != null && String(L.variation).trim() !== '') variation = String(L.variation).trim();
      else if (L.variations != null && String(L.variations).trim() !== '') variation = String(L.variations).trim();
      else variation = '—';
      var lt = lineTotalFromLineItem(L);
      var lineTotalTxt = lt > 0 ? ('৳' + Math.round(lt).toLocaleString()) : formatTaka(L.line_total || L.lineTotal || 0);
      return (
        '<tr>' +
          '<td>' + String(name).replace(/</g, '&lt;') + '</td>' +
          '<td>' + String(qty).replace(/</g, '&lt;') + '</td>' +
          '<td>' + String(variation).replace(/</g, '&lt;') + '</td>' +
          '<td>' + lineTotalTxt + '</td>' +
        '</tr>'
      );
    }).join('');
    return (
      '<div class="oc-details-table-wrap">' +
        '<table class="oc-details-table">' +
          '<thead><tr><th>Product</th><th>Qty</th><th>Variation</th><th>Line total</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>'
    );
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
    var totalOrders = (orders || []).length;
    var rev = 0;
    var visitsToday = websiteVisitsTodayFromViews();
    var delv = 0;
    (orders || []).forEach(function (o) {
      var s = String(o.status || 'placed').toLowerCase();
      if (s === 'placed') {
        placedN++;
      }
      // Revenue card: only confirmed orders, summed from line_total.
      if (s === 'confirmed') {
        var lines = o.lines || [];
        if (lines.length) {
          lines.forEach(function (ln) {
            rev += lineTotalFromLineItem(ln);
          });
        } else {
          rev += parseSubtotalNum(o.subtotal);
        }
      }
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
    if (sn) sn.textContent = String(totalOrders);
    var sr = $('seller-stat-rev');
    if (sr) sr.textContent = '৳' + (Math.round(rev) || 0).toLocaleString();
    var sd = $('seller-stat-desp');
    if (sd) sd.textContent = String(visitsToday);
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
    var list = lastOrders.filter(function (o) {
      return orderMatchesFilter(o) && orderMatchesSearch(o);
    });
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
      var phone = o.customerPhone != null ? String(o.customerPhone).trim() : '';
      var placedAt = formatPlacedAtForBangladesh(o.placedAt);
      var delText = formatFullDelivery(o);
      var phoneHtml = phone ? '<span class="oc-phone">📞 ' + phone.replace(/</g, '&lt;') + '</span>' : '';
      var placedHtml = placedAt ? '<span class="oc-placed">⏱ ' + placedAt.replace(/</g, '&lt;') + '</span>' : '';
      var delHtml = delText ? '<span class="oc-address">📍 ' + delText.replace(/</g, '&lt;') + '</span>' : '';
      time.innerHTML = [phoneHtml, placedHtml, delHtml].filter(Boolean).join('');
      left.appendChild(nm);
      left.appendChild(time);
      var badge = document.createElement('span');
      badge.className = 'oc-badge ' + badgeClassForStatus(o.status);
      badge.textContent = capStatus(o.status);
      row1.appendChild(left);
      row1.appendChild(badge);
      var foot = document.createElement('div');
      foot.className = 'oc-foot';
      var total = document.createElement('div');
      total.className = 'oc-total';
      total.textContent = formatTaka(o.subtotal);
      var btns = document.createElement('div');
      btns.className = 'oc-btns';
      var btnDetails = document.createElement('button');
      btnDetails.type = 'button';
      btnDetails.className = 'btn-s btn-sec';
      btnDetails.textContent = 'Details';
      var details = document.createElement('div');
      details.className = 'oc-details';
      details.hidden = true;
      details.innerHTML = orderLinesTableHtml(o);
      btnDetails.addEventListener('click', function () {
        var open = details.hidden;
        details.hidden = !open;
        btnDetails.textContent = open ? 'Hide' : 'Details';
      });
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
      btns.appendChild(btnDetails);
      btns.appendChild(btnD);
      btns.appendChild(btnN);
      foot.appendChild(total);
      foot.appendChild(btns);
      card.appendChild(row1);
      card.appendChild(foot);
      card.appendChild(details);
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

  var ordersSearchEl = $('orders-search');
  if (ordersSearchEl) {
    ordersSearchEl.addEventListener('input', function () {
      orderSearchQuery = String(ordersSearchEl.value || '');
      renderOrdersList(lastOrders);
    });
  }

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
  function productMatchesFilters(p) {
    var q = String(productSearchQuery || '').trim().toLowerCase();
    var category = String(productCategoryFilter || 'all').trim().toLowerCase();
    var pCategory = String((p && p.category) || '').trim().toLowerCase();
    if (category && category !== 'all' && pCategory !== category) return false;
    if (!q) return true;
    var hay = [
      p && p.name,
      p && p.category,
      p && p.badge,
      p && p.desc,
      p && p.variations
    ].map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
    return hay.indexOf(q) !== -1;
  }

  function renderProductCategoryFilter() {
    var sel = $('products-category-filter');
    if (!sel) return;
    var current = String(productCategoryFilter || 'all');
    var seen = { all: true };
    var cats = ['all'];
    (productRows || []).forEach(function (p) {
      var c = String((p && p.category) || '').trim().toLowerCase();
      if (!c) return;
      if (!seen[c]) {
        seen[c] = true;
        cats.push(c);
      }
    });
    sel.innerHTML = cats.map(function (c) {
      var label = c === 'all' ? 'All categories' : (c.charAt(0).toUpperCase() + c.slice(1));
      var selected = c === current ? ' selected' : '';
      return '<option value="' + c.replace(/"/g, '&quot;') + '"' + selected + '>' + label + '</option>';
    }).join('');
  }

  function renderProductCards() {
    var list = $('product-cards-list');
    if (!list) return;
    list.innerHTML = '';
    
    var readOnly = productsSource === 'google_sheets';
    var filtered = (productRows || []).filter(productMatchesFilters);
    
    filtered.forEach(function (p) {
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
    if (countEl) {
      if (filtered.length === (productRows || []).length) countEl.textContent = filtered.length + ' product(s)';
      else countEl.textContent = filtered.length + ' of ' + (productRows || []).length + ' product(s)';
    }
    
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
        renderProductCategoryFilter();
        renderProductCards();
        // refresh stat card that depends on product views
        updateOrderStats(lastOrders);
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
    renderProductCategoryFilter();
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
          '<button type="button" class="btn-add-image" id="pe-upload-image-btn">Upload</button>' +
          '<input type="file" id="pe-upload-image-file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml" style="display:none" />' +
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

    $('pe-upload-image-btn').addEventListener('click', function () {
      var inp = $('pe-upload-image-file');
      if (inp) inp.click();
    });

    $('pe-upload-image-file').addEventListener('change', function () {
      var inp = $('pe-upload-image-file');
      if (!inp || !inp.files || !inp.files[0]) return;
      var file = inp.files[0];
      uploadProductImage(file, product.name, function (savedPath) {
        var current = splitImageUrls(product.image_urls);
        if (current.indexOf(savedPath) === -1) current.push(savedPath);
        product.image_urls = joinImageUrls(current);
        renderProductImageList(product.image_urls);
      });
      inp.value = '';
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
    renderProductCategoryFilter();
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

  var productsSearchEl = $('products-search');
  if (productsSearchEl) {
    productsSearchEl.addEventListener('input', function () {
      productSearchQuery = String(productsSearchEl.value || '');
      renderProductCards();
    });
  }
  var productsCategoryEl = $('products-category-filter');
  if (productsCategoryEl) {
    productsCategoryEl.addEventListener('change', function () {
      productCategoryFilter = String(productsCategoryEl.value || 'all').toLowerCase();
      renderProductCards();
    });
  }

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
      });
  }

  function updateSettingPreviews() {
    if (!CTX) return;
    var headStore = $('seller-store-name');
    if (headStore && CTX.store) {
      var t = (CTX.store.name_en || CTX.store.name_bn || 'Your store').trim();
      headStore.textContent = stripTags(t) || 'Your store';
    }
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
    var saveBtnTop = $('setting-edit-save');
    if (saveBtnTop) saveBtnTop.style.display = '';
    
    function escInputAttr(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    }
    function safeInTextarea(s) {
      return String(s == null ? '' : s).replace(/<\/textarea/gi, '<\\\/textarea');
    }
    
    switch (settingKey) {
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
      
      case 'delivery':
        title.textContent = 'Delivery charge';
        var baseCharge = deliveryMap ? (deliveryMap.delivery_charge || 0) : 0;
        form.innerHTML =
          '<div class="form-section">' +
            '<div class="form-group">' +
              '<label class="form-label">Base delivery charge (৳)</label>' +
              '<input class="form-input" type="number" id="se-delivery-base" value="' + baseCharge + '" min="0" step="1" />' +
              '<p class="form-hint">Default charge for all districts. Use desktop admin for per-district overrides.</p>' +
            '</div>' +
          '</div>';
        break;
      
      case 'announce':
        title.textContent = 'Announcement bar';
        var annEn = (CTX.announce && CTX.announce.en) || '';
        var annBn = (CTX.announce && CTX.announce.bn) || '';
        form.innerHTML =
          '<div class="form-section">' +
            '<div class="form-group">' +
              '<label class="form-label">English announcement</label>' +
              '<textarea class="form-textarea" id="se-announce-en" rows="2">' + safeInTextarea(annEn) + '</textarea>' +
              '<p class="form-hint">HTML allowed</p>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Bengali announcement</label>' +
              '<textarea class="form-textarea" id="se-announce-bn" rows="2">' + safeInTextarea(annBn) + '</textarea>' +
            '</div>' +
          '</div>';
        break;
      
      case 'trust':
        title.textContent = 'Trust badges';
        var trustItems = (CTX.trust_items && CTX.trust_items.length) ? CTX.trust_items : [{ icon: '✅', en: '', bn: '' }];
        form.innerHTML = '<div class="form-section"><div id="se-trust-items"></div><button type="button" class="btn-add-image" id="se-add-trust" style="margin-top:12px">+ Add trust item</button></div>';
        var container = $('se-trust-items');
        if (container) {
          trustItems.forEach(function (item) {
            var div = document.createElement('div');
            div.className = 'trust-item';
            div.style.cssText = 'border:0.5px solid #e2e4e0;border-radius:8px;padding:12px;margin-bottom:10px;position:relative';
            div.innerHTML =
              '<button type="button" class="trust-remove" style="position:absolute;top:8px;right:8px;background:none;border:none;font-size:18px;cursor:pointer;color:#6b7280">×</button>' +
              '<div class="form-group"><label class="form-label">Icon</label><input class="form-input trust-icon" value="' + escInputAttr(item.icon) + '" placeholder="✅" /></div>' +
              '<div class="form-group"><label class="form-label">English</label><textarea class="form-textarea trust-en" rows="2">' + safeInTextarea(item.en) + '</textarea></div>' +
              '<div class="form-group"><label class="form-label">Bengali</label><textarea class="form-textarea trust-bn" rows="2">' + safeInTextarea(item.bn) + '</textarea></div>';
            container.appendChild(div);
          });
        }
        setTimeout(function () {
          var rem = function (btn) {
            btn.addEventListener('click', function () {
              if (document.querySelectorAll('.trust-item').length <= 1) {
                showMsg('Keep at least one trust item.', false);
                return;
              }
              btn.closest('.trust-item').remove();
            });
          };
          document.querySelectorAll('.trust-remove').forEach(rem);
          var addBtn = $('se-add-trust');
          if (addBtn) {
            addBtn.addEventListener('click', function () {
              var div = document.createElement('div');
              div.className = 'trust-item';
              div.style.cssText = 'border:0.5px solid #e2e4e0;border-radius:8px;padding:12px;margin-bottom:10px;position:relative';
              div.innerHTML =
                '<button type="button" class="trust-remove" style="position:absolute;top:8px;right:8px;background:none;border:none;font-size:18px;cursor:pointer;color:#6b7280">×</button>' +
                '<div class="form-group"><label class="form-label">Icon</label><input class="form-input trust-icon" placeholder="✅" /></div>' +
                '<div class="form-group"><label class="form-label">English</label><textarea class="form-textarea trust-en" rows="2"></textarea></div>' +
                '<div class="form-group"><label class="form-label">Bengali</label><textarea class="form-textarea trust-bn" rows="2"></textarea></div>';
              var wrap = $('se-trust-items');
              if (wrap) wrap.appendChild(div);
              rem(div.querySelector('.trust-remove'));
            });
          }
        }, 0);
        break;
      
      case 'payment':
        title.textContent = 'Payment methods';
        var payMethods = CTX.pay_methods || [];
        var hasBkash = payMethods.indexOf('bkash') !== -1;
        var hasNagad = payMethods.indexOf('nagad') !== -1;
        var hasCod = payMethods.indexOf('cod') !== -1;
        form.innerHTML =
          '<div class="form-section">' +
            '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;font-size:15px;cursor:pointer"><input type="checkbox" id="se-pay-bkash" value="bkash"' + (hasBkash ? ' checked' : '') + ' />bKash</label></div>' +
            '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;font-size:15px;cursor:pointer"><input type="checkbox" id="se-pay-nagad" value="nagad"' + (hasNagad ? ' checked' : '') + ' />Nagad</label></div>' +
            '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;font-size:15px;cursor:pointer"><input type="checkbox" id="se-pay-cod" value="cod"' + (hasCod ? ' checked' : '') + ' />Cash on Delivery (COD)</label></div>' +
          '</div>';
        break;
      
      case 'hero':
        title.textContent = 'Hero section';
        var hero = CTX.hero || {};
        var trustEn = (hero.trust_en || []).join('\n');
        var trustBn = (hero.trust_bn || []).join('\n');
        form.innerHTML =
          '<div class="form-section"><h3 style="font-size:13px;margin-bottom:8px">Eyebrow</h3>' +
            '<div class="form-group"><label class="form-label">English</label><input class="form-input" id="se-hero-eyebrow-en" value="' + escInputAttr(hero.eyebrow_en) + '" /></div>' +
            '<div class="form-group"><label class="form-label">Bengali</label><input class="form-input" id="se-hero-eyebrow-bn" value="' + escInputAttr(hero.eyebrow_bn) + '" /></div></div>' +
          '<div class="form-section"><h3 style="font-size:13px;margin-bottom:8px">Heading (HTML allowed)</h3>' +
            '<div class="form-group"><label class="form-label">English</label><textarea class="form-textarea" id="se-hero-h1-en" rows="2">' + safeInTextarea(hero.h1_en) + '</textarea></div>' +
            '<div class="form-group"><label class="form-label">Bengali</label><textarea class="form-textarea" id="se-hero-h1-bn" rows="2">' + safeInTextarea(hero.h1_bn) + '</textarea></div></div>' +
          '<div class="form-section"><h3 style="font-size:13px;margin-bottom:8px">Paragraph</h3>' +
            '<div class="form-group"><label class="form-label">English</label><textarea class="form-textarea" id="se-hero-p-en" rows="3">' + safeInTextarea(hero.p_en) + '</textarea></div>' +
            '<div class="form-group"><label class="form-label">Bengali</label><textarea class="form-textarea" id="se-hero-p-bn" rows="3">' + safeInTextarea(hero.p_bn) + '</textarea></div></div>' +
          '<div class="form-section"><h3 style="font-size:13px;margin-bottom:8px">Image</h3>' +
            '<div class="form-group"><label class="form-label">Image URL</label><input class="form-input" id="se-hero-image" value="' + escInputAttr(hero.image_url) + '" placeholder="https://…" /></div>' +
            '<div class="form-group"><label class="form-label">Fallback emoji</label><input class="form-input" id="se-hero-emoji" value="' + escInputAttr(hero.fallback_emoji) + '" placeholder="🔥" /></div></div>' +
          '<div class="form-section"><h3 style="font-size:13px;margin-bottom:8px">Trust pills (one per line)</h3>' +
            '<div class="form-group"><label class="form-label">English</label><textarea class="form-textarea" id="se-hero-trust-en" rows="4">' + safeInTextarea(trustEn) + '</textarea></div>' +
            '<div class="form-group"><label class="form-label">Bengali</label><textarea class="form-textarea" id="se-hero-trust-bn" rows="4">' + safeInTextarea(trustBn) + '</textarea></div></div>';
        break;
      
      case 'footer':
        title.textContent = 'Footer';
        var footer = CTX.footer || {};
        form.innerHTML =
          '<div class="form-section">' +
            '<div class="form-group"><label class="form-label">Copyright (EN)</label><input class="form-input" id="se-footer-copy-en" value="' + escInputAttr(footer.copy_en) + '" /></div>' +
            '<div class="form-group"><label class="form-label">Copyright (BN)</label><input class="form-input" id="se-footer-copy-bn" value="' + escInputAttr(footer.copy_bn) + '" /></div>' +
            '<div class="form-group"><label class="form-label">WhatsApp label (EN)</label><input class="form-input" id="se-footer-wa-en" value="' + escInputAttr(footer.wa_label_en) + '" /></div>' +
            '<div class="form-group"><label class="form-label">WhatsApp label (BN)</label><input class="form-input" id="se-footer-wa-bn" value="' + escInputAttr(footer.wa_label_bn) + '" /></div>' +
          '</div>';
        break;
      
      case 'sources':
        title.textContent = 'Catalog & Orders sources';
        var prodSrc = CTX.products_source === 'google_sheets' ? 'google_sheets' : 'csv';
        var ordSrc = CTX.orders_source === 'google_sheets' ? 'google_sheets' : (CTX.orders_source === 'google_apps_script' ? 'google_apps_script' : 'csv');
        var csvU = (CTX.csv_url != null) ? String(CTX.csv_url) : 'data/products.csv';
        var owh = (CTX.orders_webhook_url != null) ? String(CTX.orders_webhook_url) : '';
        var osh = (CTX.orders_sheet_url != null) ? String(CTX.orders_sheet_url) : '';
        var otab = (CTX.orders_sheet && CTX.orders_sheet.sheet_name) ? String(CTX.orders_sheet.sheet_name) : 'Sheet1';
        form.innerHTML =
          '<div class="form-section"><h3 style="font-size:13px;margin-bottom:8px">Products</h3>' +
            '<div class="form-group"><label class="form-label">Source</label><select class="form-select" id="se-prod-source"><option value="csv"' + (prodSrc === 'csv' ? ' selected' : '') + '>Local CSV</option><option value="google_sheets"' + (prodSrc === 'google_sheets' ? ' selected' : '') + '>Google Sheet</option></select></div>' +
            '<div class="form-group"><label class="form-label">CSV path/URL</label><input class="form-input" id="se-csv-url" value="' + escInputAttr(csvU) + '" /></div></div>' +
          '<div class="form-section"><h3 style="font-size:13px;margin-bottom:8px">Page title (browser tab)</h3><div class="form-group"><label class="form-label">Page title</label><input class="form-input" id="se-page-title" value="' + escInputAttr(CTX.page_title) + '" /></div></div>' +
          '<div class="form-section"><h3 style="font-size:13px;margin-bottom:8px">Store taglines (optional)</h3>' +
            '<div class="form-group"><label class="form-label">Tagline (EN)</label><input class="form-input" id="se-store-tagline-en" value="' + escInputAttr(CTX.store && CTX.store.tagline_en) + '" /></div>' +
            '<div class="form-group"><label class="form-label">Tagline (BN)</label><input class="form-input" id="se-store-tagline-bn" value="' + escInputAttr(CTX.store && CTX.store.tagline_bn) + '" /></div></div>' +
          '<div class="form-section"><h3 style="font-size:13px;margin-bottom:8px">Orders</h3>' +
            '<div class="form-group"><label class="form-label">Source</label><select class="form-select" id="se-ord-source"><option value="csv"' + (ordSrc === 'csv' ? ' selected' : '') + '>Local CSV</option><option value="google_sheets"' + (ordSrc === 'google_sheets' ? ' selected' : '') + '>Google Sheet</option><option value="google_apps_script"' + (ordSrc === 'google_apps_script' ? ' selected' : '') + '>Apps Script</option></select></div>' +
            '<div class="form-group"><label class="form-label">Webhook URL</label><input class="form-input" id="se-ord-webhook" value="' + escInputAttr(owh) + '" placeholder="https://…" /></div>' +
            '<div class="form-group"><label class="form-label">Google Sheet URL</label><input class="form-input" id="se-ord-sheet" value="' + escInputAttr(osh) + '" placeholder="https://…" /></div>' +
            '<div class="form-group"><label class="form-label">Tab name</label><input class="form-input" id="se-ord-tab" value="' + escInputAttr(otab) + '" placeholder="Sheet1" /></div>' +
            '<p class="form-hint">Google: share sheet with the service account as Editor. Row 1 needs order_id, etc.</p></div>';
        break;
      
      case 'districts': {
        title.textContent = 'District delivery rules';
        form.innerHTML =
          '<div class="form-section">' +
            '<p class="form-hint" style="margin-bottom:10px">Set per-district delivery overrides. Any district left empty uses the base delivery charge.</p>' +
            '<div id="se-district-rules"></div>' +
            '<button type="button" class="btn-add-image" id="se-add-district-rule" style="margin-top:8px">+ Add district rule</button>' +
          '</div>';
        var host = $('se-district-rules');
        var list = (deliveryDistricts || []).slice().sort(function (a, b) {
          return String(a.name || '').localeCompare(String(b.name || ''));
        });
        function districtOptions(selectedName) {
          var out = ['<option value="">Select district</option>'];
          list.forEach(function (d) {
            var sel = d.name === selectedName ? ' selected' : '';
            out.push('<option value="' + escInputAttr(d.name) + '"' + sel + '>' + escInputAttr(d.name) + '</option>');
          });
          return out.join('');
        }
        function bindRow(rowEl) {
          var rm = rowEl.querySelector('.se-d-rule-remove');
          if (rm) {
            rm.addEventListener('click', function () {
              rowEl.remove();
              if (!host.querySelector('.se-d-rule')) addRow('', '');
            });
          }
        }
        function addRow(name, charge) {
          if (!host) return;
          var row = document.createElement('div');
          row.className = 'se-d-rule';
          row.style.cssText = 'border:0.5px solid #e2e4e0;border-radius:8px;padding:10px;margin-bottom:8px';
          row.innerHTML =
            '<div class="form-group">' +
              '<label class="form-label">District</label>' +
              '<select class="form-select se-d-rule-name">' + districtOptions(name) + '</select>' +
            '</div>' +
            '<div class="form-group" style="margin-bottom:0">' +
              '<label class="form-label">Charge (৳)</label>' +
              '<div style="display:flex;gap:8px;align-items:center">' +
                '<input class="form-input se-d-rule-charge" type="number" min="0" step="1" value="' + escInputAttr(charge || '') + '" />' +
                '<button type="button" class="btn-sec se-d-rule-remove" style="padding:10px 12px">Remove</button>' +
              '</div>' +
            '</div>';
          host.appendChild(row);
          bindRow(row);
        }
        var existing = list.filter(function (d) {
          return Number(d.ref && d.ref.delivery_charge) > 0;
        });
        if (existing.length) {
          existing.forEach(function (d) {
            addRow(d.name, String(Number(d.ref.delivery_charge) || 0));
          });
        } else {
          addRow('', '');
        }
        var addBtnRule = $('se-add-district-rule');
        if (addBtnRule) addBtnRule.addEventListener('click', function () { addRow('', ''); });
        break;
      }
      
      case 'raw-json':
        title.textContent = 'Raw context.json';
        var rawJ = (function () {
          try { return JSON.stringify(CTX, null, 2); } catch (e) { return '{}'; }
        })();
        form.innerHTML = '<div class="form-section"><div class="form-group"><label class="form-label">JSON data</label><textarea class="form-textarea" id="se-raw-json" rows="20" style="font-family:monospace;font-size:12px">' + safeInTextarea(rawJ) + '</textarea><p class="form-hint">Valid JSON only. Saving overwrites the rest of the form the next time you use those screens.</p></div></div>';
        break;
      
      default:
        title.textContent = 'Edit setting';
        form.innerHTML = '<div class="form-section"><p class="form-hint">Unknown setting. Use the desktop admin if something is missing.</p></div>';
        if (saveBtnTop) saveBtnTop.style.display = 'none';
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

  function saveContextPostClose() {
    closeSettingEditModal();
    return fetch('/api/save-context', {
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
        showMsg('Context saved.', true);
        return loadProducts().catch(function () {});
      })
      .catch(function (e) {
        if (String(e.message) !== 'Unauthorized') {
          showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
        }
      });
  }

  function saveSettingFromModal() {
    if (!currentEditingSetting) return;

    switch (currentEditingSetting) {
      case 'store-name':
        if (!CTX.store) CTX.store = {};
        CTX.store.name_en = $('se-store-name-en').value;
        CTX.store.name_bn = $('se-store-name-bn').value;
        return saveContextPostClose();

      case 'whatsapp':
        CTX.whatsapp = $('se-whatsapp').value;
        return saveContextPostClose();

      case 'delivery': {
        if (!deliveryMap) {
          showMsg('Delivery map not loaded yet.', false);
          return;
        }
        deliveryMap.delivery_charge = parseInt($('se-delivery-base').value, 10) || 0;
        return fetch('/api/save-delivery-map', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(deliveryMap)
        })
          .then(function (r) {
            if (r.status === 401) {
              showLoginScreen();
              showMsg('Session expired — sign in again.', false);
              throw new Error('Unauthorized');
            }
            return r.json().then(function (j) {
              if (!r.ok || !j.ok) throw new Error((j && j.error) || String(r.status));
              return j;
            });
          })
          .then(function () {
            closeSettingEditModal();
            updateSettingPreviews();
            showMsg('Delivery charge saved.', true);
          })
          .catch(function (e) {
            if (String(e.message) !== 'Unauthorized') {
              showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
            }
          });
      }

      case 'announce':
        if (!CTX.announce) CTX.announce = {};
        CTX.announce.en = $('se-announce-en').value;
        CTX.announce.bn = $('se-announce-bn').value;
        return saveContextPostClose();

      case 'trust': {
        var trustOut = [];
        document.querySelectorAll('.trust-item').forEach(function (el) {
          var ic = el.querySelector('.trust-icon');
          var e = el.querySelector('.trust-en');
          var b = el.querySelector('.trust-bn');
          trustOut.push({
            icon: ic ? ic.value : '',
            en: e ? e.value : '',
            bn: b ? b.value : ''
          });
        });
        CTX.trust_items = trustOut;
        return saveContextPostClose();
      }

      case 'payment': {
        var methods = [];
        if ($('se-pay-bkash') && $('se-pay-bkash').checked) methods.push('bkash');
        if ($('se-pay-nagad') && $('se-pay-nagad').checked) methods.push('nagad');
        if ($('se-pay-cod') && $('se-pay-cod').checked) methods.push('cod');
        CTX.pay_methods = methods;
        return saveContextPostClose();
      }

      case 'hero': {
        if (!CTX.hero) CTX.hero = {};
        CTX.hero.eyebrow_en = $('se-hero-eyebrow-en') ? $('se-hero-eyebrow-en').value : '';
        CTX.hero.eyebrow_bn = $('se-hero-eyebrow-bn') ? $('se-hero-eyebrow-bn').value : '';
        CTX.hero.h1_en = $('se-hero-h1-en') ? $('se-hero-h1-en').value : '';
        CTX.hero.h1_bn = $('se-hero-h1-bn') ? $('se-hero-h1-bn').value : '';
        CTX.hero.p_en = $('se-hero-p-en') ? $('se-hero-p-en').value : '';
        CTX.hero.p_bn = $('se-hero-p-bn') ? $('se-hero-p-bn').value : '';
        CTX.hero.image_url = $('se-hero-image') ? $('se-hero-image').value : '';
        CTX.hero.fallback_emoji = $('se-hero-emoji') ? $('se-hero-emoji').value : '';
        var tEn = $('se-hero-trust-en') ? $('se-hero-trust-en').value : '';
        var tBn = $('se-hero-trust-bn') ? $('se-hero-trust-bn').value : '';
        CTX.hero.trust_en = tEn.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        CTX.hero.trust_bn = tBn.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        return saveContextPostClose();
      }

      case 'footer':
        if (!CTX.footer) CTX.footer = {};
        CTX.footer.copy_en = $('se-footer-copy-en') ? $('se-footer-copy-en').value : '';
        CTX.footer.copy_bn = $('se-footer-copy-bn') ? $('se-footer-copy-bn').value : '';
        CTX.footer.wa_label_en = $('se-footer-wa-en') ? $('se-footer-wa-en').value : '';
        CTX.footer.wa_label_bn = $('se-footer-wa-bn') ? $('se-footer-wa-bn').value : '';
        return saveContextPostClose();

      case 'sources': {
        if (!CTX.store) CTX.store = {};
        CTX.page_title = $('se-page-title') ? $('se-page-title').value : CTX.page_title;
        CTX.store.tagline_en = $('se-store-tagline-en') ? $('se-store-tagline-en').value : (CTX.store.tagline_en || '');
        CTX.store.tagline_bn = $('se-store-tagline-bn') ? $('se-store-tagline-bn').value : (CTX.store.tagline_bn || '');
        CTX.products_source = $('se-prod-source') && $('se-prod-source').value === 'google_sheets' ? 'google_sheets' : 'csv';
        CTX.csv_url = $('se-csv-url') ? $('se-csv-url').value.trim() : '';
        var os = $('se-ord-source') ? $('se-ord-source').value : 'csv';
        CTX.orders_source = os === 'google_sheets' ? 'google_sheets' : (os === 'google_apps_script' ? 'google_apps_script' : 'csv');
        CTX.orders_webhook_url = $('se-ord-webhook') ? $('se-ord-webhook').value.trim() : '';
        CTX.orders_sheet_url = $('se-ord-sheet') ? $('se-ord-sheet').value.trim() : '';
        if (!CTX.orders_sheet) CTX.orders_sheet = {};
        CTX.orders_sheet.sheet_name = ($('se-ord-tab') && $('se-ord-tab').value.trim()) || 'Sheet1';
        return saveContextPostClose();
      }

      case 'raw-json': {
        try {
          CTX = JSON.parse($('se-raw-json').value);
        } catch (e) {
          showMsg('Invalid JSON: ' + e.message, false);
          return;
        }
        return saveContextPostClose();
      }

      case 'password': {
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
      }

      case 'districts': {
        if (!deliveryMap || !deliveryDistricts || !deliveryDistricts.length) {
          showMsg('Delivery map not loaded yet.', false);
          return;
        }
        // Clear existing district overrides first; base charge stays unchanged.
        deliveryDistricts.forEach(function (d) {
          if (d && d.ref && Object.prototype.hasOwnProperty.call(d.ref, 'delivery_charge')) {
            delete d.ref.delivery_charge;
          }
        });
        var used = {};
        document.querySelectorAll('#se-district-rules .se-d-rule').forEach(function (row) {
          var districtSel = row.querySelector('.se-d-rule-name');
          var chargeInp = row.querySelector('.se-d-rule-charge');
          var name = districtSel ? String(districtSel.value || '').trim() : '';
          var chargeNum = chargeInp ? Number(chargeInp.value) : NaN;
          if (!name) return;
          if (!isFinite(chargeNum) || chargeNum < 0) return;
          if (used[name]) return;
          used[name] = true;
          var refObj = null;
          for (var i = 0; i < deliveryDistricts.length; i++) {
            if (deliveryDistricts[i].name === name) {
              refObj = deliveryDistricts[i].ref;
              break;
            }
          }
          if (refObj) refObj.delivery_charge = Math.round(chargeNum);
        });
        return fetch('/api/save-delivery-map', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(deliveryMap)
        })
          .then(function (r) {
            if (r.status === 401) {
              showLoginScreen();
              showMsg('Session expired — sign in again.', false);
              throw new Error('Unauthorized');
            }
            return r.json().then(function (j) {
              if (!r.ok || !j.ok) throw new Error((j && j.error) || String(r.status));
              return j;
            });
          })
          .then(function () {
            return loadDeliveryMap().catch(function () {});
          })
          .then(function () {
            closeSettingEditModal();
            updateSettingPreviews();
            showMsg('District delivery rules saved.', true);
          })
          .catch(function (e) {
            if (String(e.message) !== 'Unauthorized') {
              showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
            }
          });
      }

      default:
        closeSettingEditModal();
        return;
    }
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
