(function () {
  var CTX = null;
  /** Mirrors context + last /api/admin/products load: "csv" | "google_sheets" */
  var productsSource = 'csv';
  /** "csv" | "google_sheets" | "google_apps_script" — from GET /api/admin/orders */
  var ordersSource = 'csv';
  var ordersCanMutate = true;
  var productRows = [];
  var PRODUCT_FIELDS = [
    'id', 'name', 'price', 'original_price', 'category', 'emoji', 'image_url', 'desc',
    'rating', 'reviews', 'badge', 'in_stock', 'stock', 'views', 'bundle'
  ];

  function $(id) { return document.getElementById(id); }

  function showLoginScreen() {
    $('login-screen').style.display = '';
    $('admin-app').style.display = 'none';
  }
  function showAdminApp() {
    $('login-screen').style.display = 'none';
    $('admin-app').style.display = '';
  }

  function showMsg(text, ok) {
    var el = $('msg');
    el.textContent = text;
    el.className = 'msg on ' + (ok ? 'ok' : 'err');
    clearTimeout(showMsg._t);
    showMsg._t = setTimeout(function () { el.className = 'msg'; }, 4500);
  }

  function linesToArr(t) {
    return (t || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function arrToLines(a) {
    return (a || []).join('\n');
  }

  function trustHtml(i) {
    return (
      '<div class="trust-block" data-i="' + i + '">' +
      '<button type="button" class="rm" title="Remove">&times;</button>' +
      '<div class="fgrid fgrid2">' +
      '<div><label class="small">Icon</label><input type="text" class="t-icon" placeholder="✅" /></div>' +
      '<div></div>' +
      '<div><label class="small">English — HTML ok</label><textarea class="t-en" rows="2"></textarea></div>' +
      '<div><label class="small">Bengali — HTML ok</label><textarea class="t-bn" rows="2"></textarea></div>' +
      '</div></div>'
    );
  }

  function renderTrustItems(items) {
    var host = $('trust-items');
    host.innerHTML = '';
    items = items && items.length ? items : [{ icon: '✅', en: '', bn: '' }];
    items.forEach(function (it, i) {
      host.insertAdjacentHTML('beforeend', trustHtml(i));
      var block = host.lastElementChild;
      block.querySelector('.t-icon').value = it.icon || '';
      block.querySelector('.t-en').value = it.en != null ? String(it.en) : '';
      block.querySelector('.t-bn').value = it.bn != null ? String(it.bn) : '';
    });
    host.querySelectorAll('.rm').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var b = btn.closest('.trust-block');
        if (host.querySelectorAll('.trust-block').length <= 1) {
          showMsg('Keep at least one trust item.', false);
          return;
        }
        b.remove();
      });
    });
  }

  $('btn-add-trust').addEventListener('click', function () {
    var host = $('trust-items');
    var n = host.querySelectorAll('.trust-block').length;
    host.insertAdjacentHTML('beforeend', trustHtml(n));
    var block = host.lastElementChild;
    block.querySelector('.rm').addEventListener('click', function () {
      if (host.querySelectorAll('.trust-block').length <= 1) {
        showMsg('Keep at least one trust item.', false);
        return;
      }
      block.remove();
    });
  });

  function readTrustItems() {
    var out = [];
    document.querySelectorAll('#trust-items .trust-block').forEach(function (b) {
      out.push({
        icon: (b.querySelector('.t-icon').value || '').trim(),
        en: b.querySelector('.t-en').value || '',
        bn: b.querySelector('.t-bn').value || ''
      });
    });
    return out;
  }

  function setPayMethods(arr) {
    var set = {};
    (arr || []).forEach(function (x) { set[String(x).toLowerCase()] = true; });
    document.querySelectorAll('#pay-methods input[type=checkbox]').forEach(function (cb) {
      cb.checked = !!set[cb.value];
    });
  }
  function readPayMethods() {
    var out = [];
    document.querySelectorAll('#pay-methods input[type=checkbox]:checked').forEach(function (cb) {
      out.push(cb.value);
    });
    return out;
  }

  function contextFromForm() {
    return {
      whatsapp: $('c-whatsapp').value.trim(),
      page_title: $('c-page_title').value,
      products_source: $('c-products_source').value === 'google_sheets' ? 'google_sheets' : 'csv',
      csv_url: $('c-csv_url').value.trim(),
      orders_source:
        $('c-orders_source').value === 'google_sheets'
          ? 'google_sheets'
          : ($('c-orders_source').value === 'google_apps_script' ? 'google_apps_script' : 'csv'),
      orders_webhook_url: $('c-orders_webhook_url').value.trim(),
      orders_sheet_url: $('c-orders_sheet_url').value.trim(),
      orders_sheet: {
        sheet_name: ($('c-orders_sheet_name').value || '').trim() || 'Sheet1'
      },
      store: {
        name_en: $('c-store-name_en').value,
        name_bn: $('c-store-name_bn').value,
        tagline_en: $('c-store-tagline_en').value,
        tagline_bn: $('c-store-tagline_bn').value
      },
      announce: {
        en: $('c-announce-en').value,
        bn: $('c-announce-bn').value
      },
      trust_items: readTrustItems(),
      pay_methods: readPayMethods(),
      hero: {
        eyebrow_en: $('c-hero-eyebrow_en').value,
        eyebrow_bn: $('c-hero-eyebrow_bn').value,
        h1_en: $('c-hero-h1_en').value,
        h1_bn: $('c-hero-h1_bn').value,
        p_en: $('c-hero-p_en').value,
        p_bn: $('c-hero-p_bn').value,
        image_url: $('c-hero-image_url').value.trim(),
        fallback_emoji: $('c-hero-fallback_emoji').value.trim(),
        trust_en: linesToArr($('c-hero-trust_en').value),
        trust_bn: linesToArr($('c-hero-trust_bn').value)
      },
      footer: {
        copy_en: $('c-footer-copy_en').value,
        copy_bn: $('c-footer-copy_bn').value,
        wa_label_en: $('c-footer-wa_label_en').value,
        wa_label_bn: $('c-footer-wa_label_bn').value
      }
    };
  }

  function syncCsvUrlFieldHelp() {
    var mode = $('c-products_source').value;
    var lab = $('c-csv_url-label');
    var hint = $('c-csv_url-hint');
    if (mode === 'google_sheets') {
      lab.textContent = 'Google Sheet CSV export URL';
      hint.textContent =
        'Paste the CSV export URL from Google Sheets (https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=...). Publish or share the sheet so the link returns data.';
    } else {
      lab.textContent = 'Products CSV path';
      hint.textContent = 'Path under the site root, usually data/products.csv (served as a static file).';
    }
  }

  function updateProductsPanel() {
    var sheets = productsSource === 'google_sheets';
    $('prod-panel-title').textContent = sheets ? 'Products (Google Sheet)' : 'Products (data/products.csv)';
    $('prod-panel-hint').style.display = sheets ? 'none' : '';
    $('products-sheets-notice').style.display = sheets ? 'block' : 'none';
    $('btn-add-product').disabled = sheets;
    $('btn-save-products').disabled = sheets;
    $('btn-save-products').title = sheets
      ? 'Turn off “Google Sheet” in Context → Product catalog source to save CSV on disk.'
      : 'Write the table to data/products.csv';
  }

  function applyContext(ctx) {
    CTX = ctx;
    $('c-whatsapp').value = ctx.whatsapp != null ? String(ctx.whatsapp) : '';
    $('c-page_title').value = ctx.page_title != null ? String(ctx.page_title) : '';
    $('c-products_source').value = ctx.products_source === 'google_sheets' ? 'google_sheets' : 'csv';
    $('c-csv_url').value = ctx.csv_url != null ? String(ctx.csv_url) : '';
    $('c-orders_source').value =
      ctx.orders_source === 'google_sheets'
        ? 'google_sheets'
        : (ctx.orders_source === 'google_apps_script' ? 'google_apps_script' : 'csv');
    $('c-orders_webhook_url').value =
      ctx.orders_webhook_url != null ? String(ctx.orders_webhook_url) : '';
    $('c-orders_sheet_url').value =
      ctx.orders_sheet_url != null ? String(ctx.orders_sheet_url) : '';
    var os = ctx.orders_sheet || {};
    $('c-orders_sheet_name').value =
      os.sheet_name != null && String(os.sheet_name).trim()
        ? String(os.sheet_name)
        : 'Sheet1';
    syncCsvUrlFieldHelp();
    productsSource = $('c-products_source').value;
    updateProductsPanel();
    if (ctx.store) {
      $('c-store-name_en').value = ctx.store.name_en || '';
      $('c-store-name_bn').value = ctx.store.name_bn || '';
      $('c-store-tagline_en').value = ctx.store.tagline_en || '';
      $('c-store-tagline_bn').value = ctx.store.tagline_bn || '';
    }
    if (ctx.announce) {
      $('c-announce-en').value = ctx.announce.en || '';
      $('c-announce-bn').value = ctx.announce.bn || '';
    }
    renderTrustItems(ctx.trust_items);
    setPayMethods(ctx.pay_methods);
    if (ctx.hero) {
      $('c-hero-eyebrow_en').value = ctx.hero.eyebrow_en || '';
      $('c-hero-eyebrow_bn').value = ctx.hero.eyebrow_bn || '';
      $('c-hero-h1_en').value = ctx.hero.h1_en || '';
      $('c-hero-h1_bn').value = ctx.hero.h1_bn || '';
      $('c-hero-p_en').value = ctx.hero.p_en || '';
      $('c-hero-p_bn').value = ctx.hero.p_bn || '';
      $('c-hero-image_url').value = ctx.hero.image_url || '';
      $('c-hero-fallback_emoji').value = ctx.hero.fallback_emoji || '';
      $('c-hero-trust_en').value = arrToLines(ctx.hero.trust_en);
      $('c-hero-trust_bn').value = arrToLines(ctx.hero.trust_bn);
    }
    if (ctx.footer) {
      $('c-footer-copy_en').value = ctx.footer.copy_en || '';
      $('c-footer-copy_bn').value = ctx.footer.copy_bn || '';
      $('c-footer-wa_label_en').value = ctx.footer.wa_label_en || '';
      $('c-footer-wa_label_bn').value = ctx.footer.wa_label_bn || '';
    }
    $('raw-json').value = JSON.stringify(ctx, null, 2);
    ordersSource = $('c-orders_source').value;
    updateOrdersChrome();
  }

  $('c-products_source').addEventListener('change', function () {
    syncCsvUrlFieldHelp();
  });

  function loadContext() {
    return fetch('data/context.json?cb=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('data/context.json ' + r.status);
        return r.json();
      })
      .then(function (data) {
        applyContext(data);
      });
  }

  $('btn-save-context').addEventListener('click', function () {
    var obj;
    if ($('raw-json-wrap').classList.contains('on')) {
      try {
        obj = JSON.parse($('raw-json').value);
      } catch (e) {
        showMsg('Invalid JSON: ' + e.message, false);
        return;
      }
    } else {
      obj = contextFromForm();
    }
    fetch('/api/save-context', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(obj)
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
        applyContext(obj);
        showMsg('Saved data/context.json', true);
        return loadProducts();
      })
      .catch(function (e) {
        if (String(e.message) !== 'Unauthorized') {
          showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
        }
      });
  });

  $('raw-toggle').addEventListener('click', function () {
    var w = $('raw-json-wrap');
    var on = !w.classList.contains('on');
    w.classList.toggle('on', on);
    $('raw-toggle').textContent = on ? 'Advanced: hide raw JSON ▴' : 'Advanced: edit raw JSON ▾';
    if (on) $('raw-json').value = JSON.stringify(contextFromForm(), null, 2);
  });

  /* Products */
  function nextProductId() {
    var max = 0;
    productRows.forEach(function (r) {
      var id = parseInt(r.id, 10);
      if (!isNaN(id) && id > max) max = id;
    });
    return max + 1;
  }

  function rowToObject(tr) {
    var o = {};
    PRODUCT_FIELDS.forEach(function (f) {
      var cell = tr.querySelector('[data-f="' + f + '"]');
      o[f] = cell ? cell.value : '';
    });
    return o;
  }

  function renderProductTable() {
    var readOnly = productsSource === 'google_sheets';
    var tb = $('prod-tbody');
    tb.innerHTML = '';
    productRows.forEach(function (row, idx) {
      var tr = document.createElement('tr');
      tr.dataset.idx = String(idx);
      PRODUCT_FIELDS.forEach(function (f) {
        var td = document.createElement('td');
        if (f === 'id') td.className = 'col-id';
        var val = row[f] != null ? String(row[f]) : '';
        if (f === 'desc') {
          var ta = document.createElement('textarea');
          ta.dataset.f = f;
          ta.value = val;
          ta.readOnly = readOnly;
          td.appendChild(ta);
        } else {
          var inp = document.createElement('input');
          inp.type = 'text';
          inp.dataset.f = f;
          inp.value = val;
          inp.readOnly = readOnly;
          td.appendChild(inp);
        }
        tr.appendChild(td);
      });
      var tdAct = document.createElement('td');
      tdAct.className = 'col-actions';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-mini';
      del.textContent = 'Remove';
      del.disabled = readOnly;
      del.addEventListener('click', function () {
        syncRowsFromDom();
        productRows.splice(idx, 1);
        renderProductTable();
      });
      tdAct.appendChild(del);
      tr.appendChild(tdAct);
      tb.appendChild(tr);
    });
    $('prod-count').textContent = productRows.length + ' product(s)';
  }

  function syncRowsFromDom() {
    var tb = $('prod-tbody');
    var rows = tb.querySelectorAll('tr');
    productRows = [];
    rows.forEach(function (tr) {
      productRows.push(rowToObject(tr));
    });
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
        updateProductsPanel();
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
        renderProductTable();
      });
  }

  $('btn-reload-products').addEventListener('click', function () {
    loadProducts().catch(function (e) {
      if (String(e.message) !== 'Unauthorized') {
        showMsg(e && e.message ? e.message : 'Refresh failed', false);
      }
    });
  });

  $('btn-add-product').addEventListener('click', function () {
    syncRowsFromDom();
    var empty = {};
    PRODUCT_FIELDS.forEach(function (f) {
      empty[f] = f === 'id' ? String(nextProductId()) : '';
    });
    empty.price = '0';
    empty.category = 'clothing';
    empty.emoji = '🛍️';
    empty.in_stock = 'TRUE';
    empty.stock = '0';
    empty.rating = '4.5';
    empty.reviews = '0';
    productRows.push(empty);
    renderProductTable();
  });

  $('btn-save-products').addEventListener('click', function () {
    syncRowsFromDom();
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
        showMsg('Saved data/products.csv', true);
      })
      .catch(function (e) {
        if (String(e.message) !== 'Unauthorized') {
          showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
        }
      });
  });

  /* Orders */
  function tdText(text) {
    var td = document.createElement('td');
    td.textContent = text != null ? String(text) : '';
    return td;
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

  function updateOrdersChrome() {
    var h = $('orders-heading');
    var hint = $('orders-hint');
    if (!h || !hint) return;
    if (ordersSource === 'google_sheets') {
      h.textContent = 'Orders (Google Sheet)';
      hint.innerHTML =
        'One row per line item in your connected sheet. Status starts as <strong>placed</strong> at checkout; use <strong>Confirm</strong> / <strong>Despatch</strong> / <strong>Delivered</strong> (delivered removes the order). <strong>Delete</strong> removes every line for that order.';
    } else if (ordersSource === 'google_apps_script') {
      h.textContent = 'Orders (Google Sheet via webhook)';
      hint.innerHTML =
        'Orders are loaded from your sheet (published CSV). <strong>Confirm</strong>, <strong>Delivered</strong>, and <strong>Delete</strong> POST to your Apps Script URL (<code>orders_webhook_url</code>). Update and <strong>redeploy</strong> the script after changing <code>doPost</code> (see <code>logic/doPost_g_sheet_func.md</code>).';
    } else {
      h.textContent = 'Orders (data/orders.csv)';
      hint.innerHTML =
        'One row per line item in <strong>data/orders.csv</strong>. Status starts as <strong>placed</strong> at checkout; use <strong>Confirm</strong> / <strong>Despatch</strong> / <strong>Delivered</strong> (delivered removes the order). <strong>Delete</strong> removes every line for that order.';
    }
  }

  function ordersMutateDisabledTitle() {
    if (ordersSource !== 'google_apps_script') return 'Disabled';
    return 'Set a valid orders webhook URL in Context (https://script.google.com/macros/.../exec)';
  }

  $('c-orders_source').addEventListener('change', function () {
    ordersSource = $('c-orders_source').value;
    updateOrdersChrome();
  });

  function renderOrdersTable(orders) {
    var tb = $('orders-tbody');
    tb.innerHTML = '';
    $('orders-count').textContent = (orders && orders.length ? orders.length : 0) + ' order(s)';
    if (!orders || !orders.length) {
      var trE = document.createElement('tr');
      var tdE = document.createElement('td');
      tdE.colSpan = 8;
      tdE.className = 'hint';
      tdE.style.padding = '16px';
      tdE.textContent = 'No orders yet.';
      trE.appendChild(tdE);
      tb.appendChild(trE);
      return;
    }
    orders.forEach(function (o) {
      var tr = document.createElement('tr');
      tr.appendChild(tdText(o.orderId || ''));
      tr.appendChild(tdText(o.placedAt || ''));
      tr.appendChild(tdText(o.customerName || ''));
      tr.appendChild(tdText(o.customerPhone || ''));
      var tdIt = document.createElement('td');
      tdIt.className = 'orders-items';
      tdIt.textContent = summarizeOrderLines(o);
      tr.appendChild(tdIt);
      tr.appendChild(tdText(o.subtotal || ''));
      var tdSt = document.createElement('td');
      tdSt.className = 'col-st';
      tdSt.textContent = o.status || 'placed';
      tr.appendChild(tdSt);
      var tdAct = document.createElement('td');
      tdAct.className = 'col-actions';
      var wrap = document.createElement('div');
      wrap.className = 'orders-actions';
      var btnN = document.createElement('button');
      btnN.type = 'button';
      btnN.className = 'btn-mini btn-next';
      btnN.textContent = nextOrderActionLabel(o.status);
      btnN.title = ordersCanMutate ? 'Move to next status' : ordersMutateDisabledTitle();
      btnN.disabled = !ordersCanMutate;
      var oid = o.orderId || '';
      btnN.addEventListener('click', function () {
        ordersAdvance(oid);
      });
      var btnD = document.createElement('button');
      btnD.type = 'button';
      btnD.className = 'btn-mini btn-del';
      btnD.textContent = 'Delete';
      btnD.title = ordersCanMutate
        ? ordersSource === 'csv'
          ? 'Remove this order from the CSV'
          : 'Remove this order from the sheet'
        : ordersMutateDisabledTitle();
      btnD.disabled = !ordersCanMutate;
      btnD.addEventListener('click', function () {
        ordersDelete(oid, o.customerName || oid);
      });
      wrap.appendChild(btnN);
      wrap.appendChild(btnD);
      tdAct.appendChild(wrap);
      tr.appendChild(tdAct);
      tb.appendChild(tr);
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
        updateOrdersChrome();
        renderOrdersTable(x.j.orders || []);
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
      'Remove order for “' +
      (label || orderId) +
      '” (' +
      orderId +
      ')? Every line for this order will be removed from ' +
      (ordersSource === 'csv' ? 'data/orders.csv' : 'the sheet') +
      '. This cannot be undone.';
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

  /* Tabs */
  document.querySelectorAll('#tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      var id = t.getAttribute('data-panel');
      document.querySelectorAll('#tabs .tab').forEach(function (x) {
        x.classList.toggle('on', x === t);
      });
      document.querySelectorAll('.panel').forEach(function (p) {
        p.classList.toggle('on', p.id === id);
      });
      if (id === 'p-orders') {
        loadOrders().catch(function (e) {
          if (String(e.message) !== 'Unauthorized') {
            showMsg(e && e.message ? e.message : 'Could not load orders', false);
          }
        });
      }
    });
  });

  function startAdminData() {
    loadContext()
      .then(loadProducts)
      .catch(function (e) {
        showMsg('Load error: ' + (e && e.message ? e.message : e), false);
      });
  }

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
        showAdminApp();
        startAdminData();
      })
      .catch(function (e) {
        lm.textContent = e && e.message ? e.message : 'Network error';
        lm.className = 'msg login-msg on err';
      });
  });

  $('login-pass').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') $('btn-login').click();
  });

  $('btn-logout').addEventListener('click', function () {
    fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }).then(function () {
      showLoginScreen();
    });
  });

  $('btn-change-pw').addEventListener('click', function () {
    var o = $('pw-old').value;
    var n = $('pw-new').value;
    var n2 = $('pw-new2').value;
    if (n.length < 6) {
      showMsg('New password must be at least 6 characters.', false);
      return;
    }
    if (n !== n2) {
      showMsg('New passwords do not match.', false);
      return;
    }
    fetch('/api/admin/change-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ oldPassword: o, newPassword: n })
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
        $('pw-old').value = '';
        $('pw-new').value = '';
        $('pw-new2').value = '';
        showMsg('Password updated.', true);
      })
      .catch(function (e) {
        if (String(e.message) !== 'Unauthorized') {
          showMsg('Error: ' + (e && e.message ? e.message : e), false);
        }
      });
  });

  if (location.protocol === 'file:') {
    showMsg('Open this page via the local server (npm start), not file:// — saving will not work.', false);
  }

  fetch('/api/admin/status', { credentials: 'include' })
    .then(function (r) {
      return r.json();
    })
    .then(function (s) {
      if (s.loggedIn) {
        showAdminApp();
        startAdminData();
      } else {
        showLoginScreen();
      }
    })
    .catch(function () {
      showLoginScreen();
    });
})();
