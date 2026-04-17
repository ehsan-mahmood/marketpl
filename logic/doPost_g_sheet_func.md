# Google Apps Script — `doPost` for Marketpl orders

Paste into your spreadsheet-bound script, **Deploy → New deployment → Web app** (Execute as: Me, Who has access: Anyone). Use the `/exec` URL as `orders_webhook_url` in `data/context.json`.

The server sends:

- **Checkout:** JSON with `orderId`, `placedAt`, customer fields, `lines` (no `action`).
- **Admin Confirm / Despatch / Delivered:** `{ "action": "advance", "orderId": "…", "newStatus": "confirmed" | "despatched" | "delivered" }`.
- **Admin Delete:** `{ "action": "delete", "orderId": "…" }`.

When `newStatus` is `delivered`, all rows for that order are **deleted** (same as local CSV behavior).

```javascript
var SHEET_NAME = 'Sheet1'; // change if needed

function plausibleOrderId_(s) {
  var t = String(s || '').trim();
  if (!t || t.length > 96) return false;
  if (/[\r\n"]/.test(t)) return false;
  if (t.indexOf(',') !== -1) return false;
  if (/^\d{10,}-[a-z0-9]+$/i.test(t)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)) return true;
  if (/^srv-\d+-[a-f0-9]+$/i.test(t)) return true;
  return /^[a-z0-9._-]+$/i.test(t) && t.length >= 6;
}

function normHeader_(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function headerIndex_(headerRow, name) {
  var want = normHeader_(name);
  for (var c = 0; c < headerRow.length; c++) {
    if (normHeader_(headerRow[c]) === want) return c;
  }
  return -1;
}

function buildEffectiveOrderIds_(dataRows, ixOrder, ixPid, ixPname) {
  var eff = [];
  var lastPlausible = null;
  for (var i = 0; i < dataRows.length; i++) {
    var row = dataRows[i];
    var id = String(row[ixOrder] || '').trim();
    var hasLine = !!(
      String(row[ixPid] || '').trim() || String(row[ixPname] || '').trim()
    );
    if (plausibleOrderId_(id)) {
      lastPlausible = id;
      eff[i] = id;
    } else if (lastPlausible && hasLine) {
      eff[i] = lastPlausible;
    } else {
      eff[i] = null;
    }
  }
  return eff;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function ensureSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + SHEET_NAME);
  return sheet;
}

function handleAdvance_(sheet, orderId, newStatusRaw) {
  var orderIdWant = String(orderId || '').trim();
  var newStatus = String(newStatusRaw || '')
    .toLowerCase()
    .trim();
  if (!orderIdWant) throw new Error('orderId required');
  if (newStatus !== 'confirmed' && newStatus !== 'despatched' && newStatus !== 'delivered') {
    throw new Error('Invalid newStatus');
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('No data rows');
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var ixOrder = headerIndex_(header, 'order_id');
  var ixPid = headerIndex_(header, 'product_id');
  var ixPname = headerIndex_(header, 'product_name');
  var ixStatus = headerIndex_(header, 'status');
  if (ixOrder < 0) throw new Error('order_id column missing');
  if (ixPid < 0) ixPid = 0;
  if (ixPname < 0) ixPname = 0;
  if (ixStatus < 0) {
    ixStatus = header.length;
    sheet.getRange(1, ixStatus + 1).setValue('status');
    lastCol = sheet.getLastColumn();
  }
  var data = sheet.getRange(2, 1, lastRow, lastCol).getValues();
  var eff = buildEffectiveOrderIds_(data, ixOrder, ixPid, ixPname);
  var sheetRows = [];
  for (var i = 0; i < eff.length; i++) {
    if (eff[i] === orderIdWant) sheetRows.push(i + 2);
  }
  if (!sheetRows.length) throw new Error('Order not found');

  if (newStatus === 'delivered') {
    sheetRows.sort(function (a, b) {
      return b - a;
    });
    for (var d = 0; d < sheetRows.length; d++) {
      sheet.deleteRow(sheetRows[d]);
    }
    return { ok: true, deleted: sheetRows.length };
  }
  for (var u = 0; u < sheetRows.length; u++) {
    sheet.getRange(sheetRows[u], ixStatus + 1).setValue(newStatus);
  }
  return { ok: true, updated: sheetRows.length, newStatus: newStatus };
}

function handleDelete_(sheet, orderId) {
  var orderIdWant = String(orderId || '').trim();
  if (!orderIdWant) throw new Error('orderId required');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('No data rows');
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var ixOrder = headerIndex_(header, 'order_id');
  var ixPid = headerIndex_(header, 'product_id');
  var ixPname = headerIndex_(header, 'product_name');
  if (ixOrder < 0) throw new Error('order_id column missing');
  if (ixPid < 0) ixPid = 0;
  if (ixPname < 0) ixPname = 0;
  var data = sheet.getRange(2, 1, lastRow, lastCol).getValues();
  var eff = buildEffectiveOrderIds_(data, ixOrder, ixPid, ixPname);
  var sheetRows = [];
  for (var i = 0; i < eff.length; i++) {
    if (eff[i] === orderIdWant) sheetRows.push(i + 2);
  }
  if (!sheetRows.length) throw new Error('Order not found');
  sheetRows.sort(function (a, b) {
    return b - a;
  });
  for (var d = 0; d < sheetRows.length; d++) {
    sheet.deleteRow(sheetRows[d]);
  }
  return { ok: true, deleted: sheetRows.length };
}

function handleAppend_(sheet, body) {
  var lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) throw new Error('lines array required');

  var orderId = String(body.orderId || '');
  var placedAt = String(body.placedAt || new Date().toISOString());
  var customerName = String(body.customerName || '');
  var customerPhone = String(body.customerPhone || '');
  var address = String(body.address || '');
  var city = String(body.city || '');
  var area = String(body.area || '');
  var note = String(body.note || '');
  var payment = String(body.payment || '');
  var subtotal = String(body.orderSubtotal || '');

  var header = [
    'order_id',
    'placed_at',
    'customer_name',
    'customer_phone',
    'address',
    'city',
    'area',
    'note',
    'payment_method',
    'order_subtotal',
    'product_id',
    'product_name',
    'qty',
    'unit_price',
    'line_total',
    'status'
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
  } else {
    var first = sheet.getRange(1, 1, 1, header.length).getValues()[0];
    if (normHeader_(first[0]) !== 'order_id') {
      sheet.getRange(1, 1, 1, header.length).setValues([header]);
    }
  }

  var rows = lines.map(function (L) {
    var qty = Number(L.qty || 1);
    var unit = Number(L.unitPrice != null ? L.unitPrice : L.unit_price || 0);
    var lineTotal = Number(
      L.lineTotal != null
        ? L.lineTotal
        : L.line_total != null
          ? L.line_total
          : qty * unit
    );
    return [
      orderId,
      placedAt,
      customerName,
      customerPhone,
      address,
      city,
      area,
      note,
      payment,
      subtotal,
      String(L.productId != null ? L.productId : L.product_id || ''),
      String(L.productName != null ? L.productName : L.product_name || ''),
      String(Math.floor(qty)),
      String(unit),
      String(lineTotal),
      'placed'
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
  return { ok: true, appended: rows.length };
}

function doPost(e) {
  try {
    var sheet = ensureSheet_();
    var body = JSON.parse(e.postData.contents || '{}');
    var action = String(body.action || '').toLowerCase();

    if (action === 'advance') {
      return jsonOut_(handleAdvance_(sheet, body.orderId, body.newStatus));
    }
    if (action === 'delete') {
      return jsonOut_(handleDelete_(sheet, body.orderId));
    }

    return jsonOut_(handleAppend_(sheet, body));
  } catch (err) {
    return jsonOut_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}
```

After editing, **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy** so the live URL picks up `advance` / `delete`.
