(function () {
  var CTX = null;
  /** Mirrors context + last /api/admin/products load: "csv" | "google_sheets" */
  var productsSource = 'csv';
  /** "csv" | "google_sheets" | "google_apps_script" — from GET /api/admin/orders */
  var ordersSource = 'csv';
  var ordersCanMutate = true;
  var deliveryMap = null;
  var deliveryDistricts = [];
  var productRows = [];
  var contextBaselineSig = '';
  var productsBaselineSig = '';
  var suppressDirtyWatch = false;
  var PRODUCT_FIELDS = [
    'id', 'name', 'price', 'original_price', 'category', 'image_urls', 'desc',
    'badge', 'in_stock', 'views', 'bundle', 'variations'
  ];

  function $(id) { return document.getElementById(id); }

  var lastOrders = [];
  var orderFilter = 'all';

  function showLoginScreen() {
    $('login-screen').style.display = '';
    $('seller-app').style.display = 'none';
  }
  function showSellerApp() {
    $('login-screen').style.display = 'none';
    $('seller-app').style.display = '';
    updateGreeting();
  }

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

  function showMsg(text, ok) {
    var el = $('msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'msg seller-msg on ' + (ok ? 'ok' : 'err');
    clearTimeout(showMsg._t);
    showMsg._t = setTimeout(function () { el.className = 'msg seller-msg'; }, 4500);
  }

  function linesToArr(t) {
    return (t || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function arrToLines(a) {
    return (a || []).join('\n');
  }

  function toNonNegativeNumber(v) {
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : 0;
  }

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
        $('dc-base-charge').value = String(toNonNegativeNumber(deliveryMap.delivery_charge));
        renderDeliveryRules();
      });
  }

  function saveDeliveryMap() {
    if (!deliveryMap) throw new Error('Delivery rules are not loaded.');
    return fetch('/api/save-delivery-map', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(deliveryMap)
    }).then(function (r) {
      if (r.status === 401) {
        showLoginScreen();
        showMsg('Session expired — sign in again.', false);
        throw new Error('Unauthorized');
      }
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) throw new Error((j && j.error) || String(r.status));
        return j;
      });
    });
  }

  function districtSelectHtml(selected) {
    var opts = ['<option value="">Select district</option>'];
    deliveryDistricts.forEach(function (d) {
      var sel = d.name === selected ? ' selected' : '';
      opts.push('<option value="' + d.name.replace(/"/g, '&quot;') + '"' + sel + '>' + d.name + '</option>');
    });
    return opts.join('');
  }

  function renderDeliveryRules() {
    var host = $('dc-rules');
    if (!host) return;
    if (!deliveryDistricts.length) {
      host.innerHTML = '<p class="hint">No districts found in map file.</p>';
      return;
    }
    var withCharge = deliveryDistricts.filter(function (d) {
      return toNonNegativeNumber(d.ref.delivery_charge) > 0;
    });
    if (!withCharge.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = withCharge.map(function (d, idx) {
      return '' +
        '<div class="dc-rule" data-rule-idx="' + idx + '">' +
          '<div class="fgrid fgrid2">' +
            '<div>' +
              '<label class="small">District</label>' +
              '<select class="dc-district">' + districtSelectHtml(d.name) + '</select>' +
            '</div>' +
            '<div class="dc-rule-actions">' +
              '<div style="flex:1">' +
                '<label class="small">Delivery charge</label>' +
                '<input type="number" class="dc-charge" min="0" step="1" value="' + toNonNegativeNumber(d.ref.delivery_charge) + '" />' +
              '</div>' +
              '<button type="button" class="btn btn-primary dc-confirm">Confirm</button>' +
              '<button type="button" class="btn btn-ghost dc-remove">Remove</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
    bindDeliveryRuleButtons();
  }

  function findDistrictByName(name) {
    var key = String(name || '').trim();
    for (var i = 0; i < deliveryDistricts.length; i++) {
      if (deliveryDistricts[i].name === key) return deliveryDistricts[i].ref;
    }
    return null;
  }

  function addDeliveryRuleBlock() {
    var host = $('dc-rules');
    if (!host) return;
    var wrap = document.createElement('div');
    wrap.className = 'dc-rule';
    wrap.innerHTML = '' +
      '<div class="fgrid fgrid2">' +
        '<div>' +
          '<label class="small">District</label>' +
          '<select class="dc-district">' + districtSelectHtml('') + '</select>' +
        '</div>' +
        '<div class="dc-rule-actions">' +
          '<div style="flex:1">' +
            '<label class="small">Delivery charge</label>' +
            '<input type="number" class="dc-charge" min="0" step="1" value="0" />' +
          '</div>' +
          '<button type="button" class="btn btn-primary dc-confirm">Confirm</button>' +
          '<button type="button" class="btn btn-ghost dc-remove">Remove</button>' +
        '</div>' +
      '</div>';
    host.appendChild(wrap);
    bindDeliveryRuleButtons();
  }

  function bindDeliveryRuleButtons() {
    document.querySelectorAll('#dc-rules .dc-confirm').forEach(function (btn) {
      btn.onclick = function () {
        if (!deliveryMap) return;
        var row = btn.closest('.dc-rule');
        var district = row.querySelector('.dc-district').value;
        var chargeVal = toNonNegativeNumber(row.querySelector('.dc-charge').value);
        if (!district) {
          showMsg('Select a district first.', false);
          return;
        }
        var ref = findDistrictByName(district);
        if (!ref) {
          showMsg('District not found in map.', false);
          return;
        }
        ref.delivery_charge = chargeVal;
        saveDeliveryMap()
          .then(function () {
            showMsg('District delivery rule saved.', true);
            return loadDeliveryMap();
          })
          .catch(function (e) {
            if (String(e.message) !== 'Unauthorized') {
              showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
            }
          });
      };
    });
    document.querySelectorAll('#dc-rules .dc-remove').forEach(function (btn) {
      btn.onclick = function () {
        if (!deliveryMap) return;
        var row = btn.closest('.dc-rule');
        var district = row.querySelector('.dc-district').value;
        if (!district) {
          row.remove();
          return;
        }
        var ref = findDistrictByName(district);
        if (ref && Object.prototype.hasOwnProperty.call(ref, 'delivery_charge')) {
          delete ref.delivery_charge;
          saveDeliveryMap()
            .then(function () {
              showMsg('District rule removed.', true);
              return loadDeliveryMap();
            })
            .catch(function (e) {
              if (String(e.message) !== 'Unauthorized') {
                showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
              }
            });
          return;
        }
        row.remove();
      };
    });
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
        refreshContextDirtyState();
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
      refreshContextDirtyState();
    });
    refreshContextDirtyState();
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

  function serializeProductRows(rows) {
    return JSON.stringify((rows || []).map(function (r) {
      var o = {};
      PRODUCT_FIELDS.forEach(function (f) { o[f] = r[f] != null ? String(r[f]) : ''; });
      return o;
    }));
  }

  function readProductRowsFromDom() {
    return Array.from(document.querySelectorAll('#prod-tbody tr')).map(function (tr) {
      return rowToObject(tr);
    });
  }

  function refreshContextDirtyState() {
    if (suppressDirtyWatch) return;
    var btn = $('btn-save-context');
    if (!btn) return;
    var sig = JSON.stringify(contextFromForm());
    var dirty = sig !== contextBaselineSig;
    btn.disabled = !dirty;
    btn.title = dirty ? 'Save context changes' : 'No context changes';
  }

  function setContextBaseline() {
    contextBaselineSig = JSON.stringify(contextFromForm());
    refreshContextDirtyState();
  }

  function refreshProductsDirtyState() {
    if (suppressDirtyWatch) return;
    var btn = $('btn-save-products');
    if (!btn) return;
    var readOnly = productsSource === 'google_sheets';
    var dirty = serializeProductRows(readProductRowsFromDom()) !== productsBaselineSig;
    btn.disabled = readOnly || !dirty;
    if (readOnly) btn.title = 'Catalog is read-only in Google Sheets mode.';
    else btn.title = dirty ? 'Save product table changes' : 'No product changes';
  }

  function setProductsBaseline(rows) {
    productsBaselineSig = serializeProductRows(rows || []);
    refreshProductsDirtyState();
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
    refreshProductsDirtyState();
  }

  function applyContext(ctx) {
    suppressDirtyWatch = true;
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
    var ns = $('seller-store-name');
    if (ns) {
      if (ctx.store) {
        var raw = (ctx.store.name_en || ctx.store.name_bn || 'Your store').trim();
        ns.textContent = stripTags(raw) || 'Your store';
      } else {
        ns.textContent = 'Your store';
      }
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
    suppressDirtyWatch = false;
    setContextBaseline();
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
        if (p && typeof onDone === 'function') {
          onDone(p);
        }
        showMsg('Image saved to ' + p + '. Click “Update products” to keep the path in the catalog.', true);
      })
      .catch(function (e) {
        if (String(e.message) !== 'Unauthorized') {
          showMsg(e && e.message ? e.message : 'Upload failed', false);
        }
      });
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
        } else if (f === 'image_urls') {
          td.className = 'col-image_urls';
          var listWrap = document.createElement('div');
          listWrap.className = 'prod-image-list';
          var hidden = document.createElement('input');
          hidden.type = 'hidden';
          hidden.dataset.f = f;
          hidden.value = val;

          var list = document.createElement('div');
          list.className = 'prod-image-list-items';
          var rowAdd = document.createElement('div');
          rowAdd.className = 'prod-image-list-add';
          var addInput = document.createElement('input');
          addInput.type = 'text';
          addInput.placeholder = 'https://… or assets/products/…';
          addInput.readOnly = readOnly;
          var btnAdd = document.createElement('button');
          btnAdd.type = 'button';
          btnAdd.className = 'btn-mini';
          btnAdd.textContent = 'Add';
          btnAdd.disabled = readOnly;
          var btnUpList = document.createElement('button');
          btnUpList.type = 'button';
          btnUpList.className = 'btn-mini';
          btnUpList.textContent = 'Upload';
          btnUpList.disabled = readOnly;
          var fileInpList = document.createElement('input');
          fileInpList.type = 'file';
          fileInpList.className = 'prod-image-file';
          fileInpList.accept = 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml';
          fileInpList.disabled = readOnly;

          function syncHidden(items) {
            hidden.value = joinImageUrls(items);
          }

          function renderList(items) {
            list.innerHTML = '';
            items.forEach(function (u, itemIdx) {
              var item = document.createElement('div');
              item.className = 'prod-image-list-item';
              var thumb = document.createElement('img');
              thumb.className = 'prod-image-mini';
              thumb.alt = '';
              thumb.src = u;
              thumb.onerror = function () { thumb.style.visibility = 'hidden'; };
              var txt = document.createElement('span');
              txt.className = 'prod-image-list-text';
              txt.textContent = u;
              item.appendChild(thumb);
              item.appendChild(txt);
              if (!readOnly) {
                var rm = document.createElement('button');
                rm.type = 'button';
                rm.className = 'btn-mini';
                rm.textContent = '×';
                rm.title = 'Remove';
                rm.addEventListener('click', function () {
                  var now = splitImageUrls(hidden.value);
                  now.splice(itemIdx, 1);
                  syncHidden(now);
                  renderList(now);
                });
                item.appendChild(rm);
              }
              list.appendChild(item);
            });
          }

          function addImageUrl(u) {
            var v = String(u || '').trim();
            if (!v) return;
            var now = splitImageUrls(hidden.value);
            if (now.indexOf(v) === -1) now.push(v);
            syncHidden(now);
            renderList(now);
            addInput.value = '';
          }

          btnAdd.addEventListener('click', function () {
            addImageUrl(addInput.value);
          });
          addInput.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              addImageUrl(addInput.value);
            }
          });
          btnUpList.addEventListener('click', function () {
            fileInpList.click();
          });
          fileInpList.addEventListener('change', function () {
            if (!fileInpList.files || !fileInpList.files[0]) return;
            var nameInput = tr.querySelector('[data-f="name"]');
            var currentProductName = nameInput ? String(nameInput.value || '').trim() : '';
            uploadProductImage(fileInpList.files[0], currentProductName, function (p) {
              addImageUrl(p);
            });
            fileInpList.value = '';
          });

          rowAdd.appendChild(addInput);
          rowAdd.appendChild(btnAdd);
          rowAdd.appendChild(btnUpList);
          rowAdd.appendChild(fileInpList);
          listWrap.appendChild(hidden);
          listWrap.appendChild(list);
          listWrap.appendChild(rowAdd);
          td.appendChild(listWrap);
          renderList(splitImageUrls(val));
        } else {
          var inp2 = document.createElement('input');
          inp2.type = 'text';
          inp2.dataset.f = f;
          inp2.value = val;
          inp2.readOnly = readOnly;
          td.appendChild(inp2);
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
    refreshProductsDirtyState();
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
        setProductsBaseline(productRows);
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
    empty.in_stock = 'TRUE';
    productRows.push(empty);
    renderProductTable();
    refreshProductsDirtyState();
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
        setProductsBaseline(productRows);
        showMsg('Saved data/products.csv', true);
      })
      .catch(function (e) {
        if (String(e.message) !== 'Unauthorized') {
          showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
        }
      });
  });

  $('btn-save-base-charge').addEventListener('click', function () {
    if (!deliveryMap) {
      showMsg('Delivery map is not loaded yet.', false);
      return;
    }
    deliveryMap.delivery_charge = toNonNegativeNumber($('dc-base-charge').value);
    saveDeliveryMap()
      .then(function () {
        showMsg('Base delivery rule saved.', true);
        return loadDeliveryMap();
      })
      .catch(function (e) {
        if (String(e.message) !== 'Unauthorized') {
          showMsg('Save failed: ' + (e && e.message ? e.message : e), false);
        }
      });
  });

  $('btn-add-district-rule').addEventListener('click', function () {
    if (!deliveryMap) {
      showMsg('Delivery map is not loaded yet.', false);
      return;
    }
    addDeliveryRuleBlock();
  });

  $('p-context').addEventListener('input', function () { refreshContextDirtyState(); });
  $('p-context').addEventListener('change', function () { refreshContextDirtyState(); });
  $('raw-json').addEventListener('input', function () {
    if ($('raw-json-wrap').classList.contains('on')) {
      var btn = $('btn-save-context');
      if (btn) btn.disabled = false;
    }
  });
  $('prod-tbody').addEventListener('input', function () { refreshProductsDirtyState(); });
  $('prod-tbody').addEventListener('change', function () { refreshProductsDirtyState(); });

  /* Orders */
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
          ? placedN + ' new order' + (placedN === 1 ? '' : 's') + ' — confirm and dispatch from here'
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
          '<div class="ep-title">No orders yet</div><p class="ep-sub">When customers check out, orders will appear here. Refresh anytime.</p></div>';
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
      btnN.title = ordersCanMutate ? 'Move to next status' : ordersMutateDisabledTitle();
      btnN.disabled = !ordersCanMutate;
      var oid = o.orderId || '';
      btnN.addEventListener('click', function () {
        ordersAdvance(oid);
      });
      var btnD = document.createElement('button');
      btnD.type = 'button';
      btnD.className = 'btn-s btn-del';
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
        updateOrdersChrome();
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

  function setActivePanel(id) {
    document.querySelectorAll('#seller-nav .nav-i').forEach(function (x) {
      x.classList.toggle('on', x.getAttribute('data-panel') === id);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('on', p.id === id);
    });
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
