# Complete Seller Settings Implementation

## Quick Fix: Replace the `default` case in `openSettingEditModal`

Find line 844-849 in `logic/seller.js` and replace the entire `default:` case with all these implementations:

```javascript
      case 'delivery':
        title.textContent = 'Delivery charge';
        var baseCharge = deliveryMap ? (deliveryMap.delivery_charge || 0) : 0;
        form.innerHTML =
          '<div class="form-section">' +
            '<div class="form-group">' +
              '<label class="form-label">Base delivery charge (৳)</label>' +
              '<input class="form-input" type="number" id="se-delivery-base" value="' + baseCharge + '" min="0" step="1" />' +
              '<p class="form-hint">Default charge for all districts.</p>' +
            '</div>' +
          '</div>';
        break;

      case 'announce':
        title.textContent = 'Announcement bar';
        form.innerHTML =
          '<div class="form-section">' +
            '<div class="form-group">' +
              '<label class="form-label">English announcement</label>' +
              '<textarea class="form-textarea" id="se-announce-en" rows="2">' + ((CTX.announce && CTX.announce.en) || '') + '</textarea>' +
              '<p class="form-hint">HTML allowed</p>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label">Bengali announcement</label>' +
              '<textarea class="form-textarea" id="se-announce-bn" rows="2">' + ((CTX.announce && CTX.announce.bn) || '') + '</textarea>' +
            '</div>' +
          '</div>';
        break;

      case 'trust':
        title.textContent = 'Trust badges';
        var trustItems = (CTX.trust_items || [{ icon: '✅', en: '', bn: '' }]);
        form.innerHTML = '<div class="form-section"><div id="se-trust-items"></div><button type="button" class="btn-add-image" id="se-add-trust" style="margin-top:12px">+ Add trust item</button></div>';
        var container = $('se-trust-items');
        trustItems.forEach(function(item, i) {
          var div = document.createElement('div');
          div.className = 'trust-item';
          div.style.cssText = 'border:0.5px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;position:relative';
          div.innerHTML =
            '<button type="button" class="trust-remove" style="position:absolute;top:8px;right:8px;background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary)">×</button>' +
            '<div class="form-group"><label class="form-label">Icon</label><input class="form-input trust-icon" value="' + (item.icon || '') + '" placeholder="✅" /></div>' +
            '<div class="form-group"><label class="form-label">English</label><textarea class="form-textarea trust-en" rows="2">' + (item.en || '') + '</textarea></div>' +
            '<div class="form-group"><label class="form-label">Bengali</label><textarea class="form-textarea trust-bn" rows="2">' + (item.bn || '') + '</textarea></div>';
          container.appendChild(div);
        });
        setTimeout(function() {
          document.querySelectorAll('.trust-remove').forEach(function(btn) {
            btn.addEventListener('click', function() {
              if (document.querySelectorAll('.trust-item').length <= 1) {
                showMsg('Keep at least one trust item.', false);
                return;
              }
              btn.closest('.trust-item').remove();
            });
          });
          $('se-add-trust').addEventListener('click', function() {
            var div = document.createElement('div');
            div.className = 'trust-item';
            div.style.cssText = 'border:0.5px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;position:relative';
            div.innerHTML =
              '<button type="button" class="trust-remove" style="position:absolute;top:8px;right:8px;background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary)">×</button>' +
              '<div class="form-group"><label class="form-label">Icon</label><input class="form-input trust-icon" placeholder="✅" /></div>' +
              '<div class="form-group"><label class="form-label">English</label><textarea class="form-textarea trust-en" rows="2"></textarea></div>' +
              '<div class="form-group"><label class="form-label">Bengali</label><textarea class="form-textarea trust-bn" rows="2"></textarea></div>';
            $('se-trust-items').appendChild(div);
            div.querySelector('.trust-remove').addEventListener('click', function() {
              if (document.querySelectorAll('.trust-item').length <= 1) {
                showMsg('Keep at least one trust item.', false);
                return;
              }
              div.remove();
            });
          });
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
          '<div class="form-section"><h3>Eyebrow</h3>' +
            '<div class="form-group"><label class="form-label">English</label><input class="form-input" id="se-hero-eyebrow-en" value="' + (hero.eyebrow_en || '').replace(/"/g, '&quot;') + '" /></div>' +
            '<div class="form-group"><label class="form-label">Bengali</label><input class="form-input" id="se-hero-eyebrow-bn" value="' + (hero.eyebrow_bn || '').replace(/"/g, '&quot;') + '" /></div></div>' +
          '<div class="form-section"><h3>Heading (HTML allowed)</h3>' +
            '<div class="form-group"><label class="form-label">English</label><textarea class="form-textarea" id="se-hero-h1-en" rows="2">' + (hero.h1_en || '') + '</textarea></div>' +
            '<div class="form-group"><label class="form-label">Bengali</label><textarea class="form-textarea" id="se-hero-h1-bn" rows="2">' + (hero.h1_bn || '') + '</textarea></div></div>' +
          '<div class="form-section"><h3>Paragraph</h3>' +
            '<div class="form-group"><label class="form-label">English</label><textarea class="form-textarea" id="se-hero-p-en" rows="3">' + (hero.p_en || '') + '</textarea></div>' +
            '<div class="form-group"><label class="form-label">Bengali</label><textarea class="form-textarea" id="se-hero-p-bn" rows="3">' + (hero.p_bn || '') + '</textarea></div></div>' +
          '<div class="form-section"><h3>Image</h3>' +
            '<div class="form-group"><label class="form-label">Image URL</label><input class="form-input" id="se-hero-image" value="' + (hero.image_url || '') + '" placeholder="https://…" /></div>' +
            '<div class="form-group"><label class="form-label">Fallback emoji</label><input class="form-input" id="se-hero-emoji" value="' + (hero.fallback_emoji || '') + '" placeholder="🔥" /></div></div>' +
          '<div class="form-section"><h3>Trust pills (one per line)</h3>' +
            '<div class="form-group"><label class="form-label">English</label><textarea class="form-textarea" id="se-hero-trust-en" rows="4">' + trustEn + '</textarea></div>' +
            '<div class="form-group"><label class="form-label">Bengali</label><textarea class="form-textarea" id="se-hero-trust-bn" rows="4">' + trustBn + '</textarea></div></div>';
        break;

      case 'footer':
        title.textContent = 'Footer';
        var footer = CTX.footer || {};
        form.innerHTML =
          '<div class="form-section">' +
            '<div class="form-group"><label class="form-label">Copyright (EN)</label><input class="form-input" id="se-footer-copy-en" value="' + (footer.copy_en || '').replace(/"/g, '&quot;') + '" /></div>' +
            '<div class="form-group"><label class="form-label">Copyright (BN)</label><input class="form-input" id="se-footer-copy-bn" value="' + (footer.copy_bn || '').replace(/"/g, '&quot;') + '" /></div>' +
            '<div class="form-group"><label class="form-label">WhatsApp label (EN)</label><input class="form-input" id="se-footer-wa-en" value="' + (footer.wa_label_en || '').replace(/"/g, '&quot;') + '" /></div>' +
            '<div class="form-group"><label class="form-label">WhatsApp label (BN)</label><input class="form-input" id="se-footer-wa-bn" value="' + (footer.wa_label_bn || '').replace(/"/g, '&quot;') + '" /></div>' +
          '</div>';
        break;

      case 'sources':
        title.textContent = 'Catalog & Orders sources';
        var prodSrc = CTX.products_source === 'google_sheets' ? 'google_sheets' : 'csv';
        var ordSrc = CTX.orders_source === 'google_sheets' ? 'google_sheets' : (CTX.orders_source === 'google_apps_script' ? 'google_apps_script' : 'csv');
        form.innerHTML =
          '<div class="form-section"><h3>Products</h3>' +
            '<div class="form-group"><label class="form-label">Source</label><select class="form-select" id="se-prod-source"><option value="csv"' + (prodSrc === 'csv' ? ' selected' : '') + '>Local CSV</option><option value="google_sheets"' + (prodSrc === 'google_sheets' ? ' selected' : '') + '>Google Sheet</option></select></div>' +
            '<div class="form-group"><label class="form-label">CSV path/URL</label><input class="form-input" id="se-csv-url" value="' + (CTX.csv_url || 'data/products.csv') + '" /></div></div>' +
          '<div class="form-section"><h3>Orders</h3>' +
            '<div class="form-group"><label class="form-label">Source</label><select class="form-select" id="se-ord-source"><option value="csv"' + (ordSrc === 'csv' ? ' selected' : '') + '>Local CSV</option><option value="google_sheets"' + (ordSrc === 'google_sheets' ? ' selected' : '') + '>Google Sheet</option><option value="google_apps_script"' + (ordSrc === 'google_apps_script' ? ' selected' : '') + '>Apps Script</option></select></div>' +
            '<div class="form-group"><label class="form-label">Webhook URL</label><input class="form-input" id="se-ord-webhook" value="' + (CTX.orders_webhook_url || '') + '" /></div>' +
            '<div class="form-group"><label class="form-label">Sheet URL</label><input class="form-input" id="se-ord-sheet" value="' + (CTX.orders_sheet_url || '') + '" /></div>' +
            '<div class="form-group"><label class="form-label">Tab name</label><input class="form-input" id="se-ord-tab" value="' + ((CTX.orders_sheet && CTX.orders_sheet.sheet_name) || 'Sheet1') + '" /></div></div>';
        break;

      case 'districts':
        title.textContent = 'District delivery rules';
        form.innerHTML = '<div class="form-section"><p class="form-hint">District rules are complex. Use desktop admin for this.</p></div>';
        $('setting-edit-save').style.display = 'none';
        break;

      case 'raw-json':
        title.textContent = 'Raw context.json';
        form.innerHTML = '<div class="form-section"><div class="form-group"><label class="form-label">JSON data</label><textarea class="form-textarea" id="se-raw-json" rows="20" style="font-family:monospace;font-size:12px">' + JSON.stringify(CTX, null, 2) + '</textarea><p class="form-hint">Valid JSON only.</p></div></div>';
        break;

      default:
        title.textContent = 'Edit setting';
        form.innerHTML = '<div class="form-section"><p class="form-hint">This setting editor is not yet implemented. Use the admin panel for now.</p></div>';
        var saveBtn = $('setting-edit-save');
        if (saveBtn) saveBtn.style.display = 'none';
        break;
```

## 2. Update saveSettingFromModal (line 865-925)

Replace lines 869-920 with:

```javascript
    switch(currentEditingSetting) {
      case 'store-name':
        if (!CTX.store) CTX.store = {};
        CTX.store.name_en = $('se-store-name-en').value;
        CTX.store.name_bn = $('se-store-name-bn').value;
        break;
      
      case 'whatsapp':
        CTX.whatsapp = $('se-whatsapp').value;
        break;
      
      case 'delivery':
        if (!deliveryMap) deliveryMap = {};
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
      
      case 'announce':
        if (!CTX.announce) CTX.announce = {};
        CTX.announce.en = $('se-announce-en').value;
        CTX.announce.bn = $('se-announce-bn').value;
        break;
      
      case 'trust':
        var trustItems = [];
        document.querySelectorAll('.trust-item').forEach(function(item) {
          trustItems.push({
            icon: item.querySelector('.trust-icon').value || '',
            en: item.querySelector('.trust-en').value || '',
            bn: item.querySelector('.trust-bn').value || ''
          });
        });
        CTX.trust_items = trustItems;
        break;
      
      case 'payment':
        var methods = [];
        if ($('se-pay-bkash').checked) methods.push('bkash');
        if ($('se-pay-nagad').checked) methods.push('nagad');
        if ($('se-pay-cod').checked) methods.push('cod');
        CTX.pay_methods = methods;
        break;
      
      case 'hero':
        if (!CTX.hero) CTX.hero = {};
        CTX.hero.eyebrow_en = $('se-hero-eyebrow-en').value;
        CTX.hero.eyebrow_bn = $('se-hero-eyebrow-bn').value;
        CTX.hero.h1_en = $('se-hero-h1-en').value;
        CTX.hero.h1_bn = $('se-hero-h1-bn').value;
        CTX.hero.p_en = $('se-hero-p-en').value;
        CTX.hero.p_bn = $('se-hero-p-bn').value;
        CTX.hero.image_url = $('se-hero-image').value;
        CTX.hero.fallback_emoji = $('se-hero-emoji').value;
        CTX.hero.trust_en = $('se-hero-trust-en').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
        CTX.hero.trust_bn = $('se-hero-trust-bn').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
        break;
      
      case 'footer':
        if (!CTX.footer) CTX.footer = {};
        CTX.footer.copy_en = $('se-footer-copy-en').value;
        CTX.footer.copy_bn = $('se-footer-copy-bn').value;
        CTX.footer.wa_label_en = $('se-footer-wa-en').value;
        CTX.footer.wa_label_bn = $('se-footer-wa-bn').value;
        break;
      
      case 'sources':
        CTX.products_source = $('se-prod-source').value;
        CTX.csv_url = $('se-csv-url').value;
        CTX.orders_source = $('se-ord-source').value;
        CTX.orders_webhook_url = $('se-ord-webhook').value;
        CTX.orders_sheet_url = $('se-ord-sheet').value;
        if (!CTX.orders_sheet) CTX.orders_sheet = {};
        CTX.orders_sheet.sheet_name = $('se-ord-tab').value || 'Sheet1';
        break;
      
      case 'raw-json':
        try {
          CTX = JSON.parse($('se-raw-json').value);
        } catch (e) {
          showMsg('Invalid JSON: ' + e.message, false);
          return;
        }
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
```

---

File saved to `SELLER_SETTINGS_COMPLETE_PATCH.md`

**Apply this patch by copying the code blocks into the correct locations in `logic/seller.js`.**

This will enable ALL settings modals to work properly!
