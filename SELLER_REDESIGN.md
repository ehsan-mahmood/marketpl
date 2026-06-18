# Seller Dashboard — Mobile-First Redesign

## Overview

The new **`seller.html`** is a complete mobile-first redesign inspired by `bangladesh_seller_admin_energetic.html`, tailored for Facebook sellers in Bangladesh who manage their business on-the-go via smartphones.

## Key Design Philosophy

### For Bangladesh Facebook Sellers:
- **Mobile-first**: Touch-optimized, thumb-friendly navigation
- **Quick actions**: Tap to confirm orders, edit products
- **Visual cards**: No complex tables, everything is scannable
- **Bottom navigation**: Easy one-handed use
- **Settings as menu**: Grouped settings with tap-to-edit rows
- **Teal + Amber palette**: Energetic, trustworthy colors

## What's Different from `admin.html`

| Feature | Admin (Desktop) | Seller (Mobile) |
|---------|----------------|-----------------|
| **Navigation** | Top tabs | Bottom nav (fixed) |
| **Products** | Editable table | Product cards + edit modal |
| **Settings** | All forms visible | Grouped rows → tap to edit modal |
| **Orders** | Table with actions | Visual cards with colored status |
| **Layout** | Wide (1100px) | Narrow (560px max) |
| **Edit flow** | Inline table cells | Fullscreen modals |
| **Visual style** | Corporate (Syne/DM Sans) | Modern (Inter, rounded) |

## Implementation Plan

### Phase 1: UI Structure ✅ DONE
- [x] Mobile-first HTML with bottom nav
- [x] Product cards placeholder
- [x] Settings as tappable rows
- [x] Order cards (already working)
- [x] Fullscreen modals structure
- [x] Responsive CSS (teal/amber palette)

### Phase 2: JavaScript Refactor (TODO)

#### Product Cards Rendering
```javascript
function renderProductCards() {
  var list = $('product-cards-list');
  list.innerHTML = '';
  
  productRows.forEach(function(p) {
    var card = document.createElement('div');
    card.className = 'prod-card';
    
    // Thumb: first image or emoji fallback
    var thumbUrl = splitImageUrls(p.image_urls)[0];
    var thumb = thumbUrl 
      ? '<img class="prod-thumb" src="' + thumbUrl + '" alt="" />'
      : '<div class="prod-thumb">📦</div>';
    
    card.innerHTML = 
      thumb +
      '<div class="prod-card-mid">' +
        '<div class="prod-name">' + (p.name || 'Untitled') + '</div>' +
        '<div class="prod-price">৳' + (p.price || '0') + 
          (p.original_price ? ' <del>৳' + p.original_price + '</del>' : '') +
          ' · ' + (p.category || 'general') + '</div>' +
      '</div>' +
      '<div class="prod-right">' +
        '<span class="stk ' + (p.in_stock === 'TRUE' ? 'stk-in">In stock' : 'stk-out">Out') + '</span>' +
        '<button class="edit-btn" data-product-id="' + p.id + '">Edit →</button>' +
      '</div>';
    
    list.appendChild(card);
  });
  
  // Bind edit buttons
  list.querySelectorAll('.edit-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openProductEditModal(btn.getAttribute('data-product-id'));
    });
  });
}
```

#### Product Edit Modal (Fullscreen)
```javascript
function openProductEditModal(productId) {
  var product = productRows.find(function(p) { return String(p.id) === String(productId); });
  if (!product) return;
  
  var modal = $('product-edit-modal');
  var form = $('product-edit-form');
  
  // Build form sections
  form.innerHTML = 
    '<div class="form-section">' +
      '<h3>Basic Info</h3>' +
      '<div class="form-group">' +
        '<label class="form-label">Product name</label>' +
        '<input class="form-input" type="text" id="pe-name" value="' + (product.name || '') + '" />' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">Price (৳)</label>' +
        '<input class="form-input" type="number" id="pe-price" value="' + (product.price || '') + '" />' +
      '</div>' +
      // ... more fields
    '</div>' +
    '<div class="form-section">' +
      '<h3>Images</h3>' +
      '<div class="prod-image-list-wrap" id="pe-images"></div>' +
    '</div>';
  
  // Render image list
  renderProductImageList(product.image_urls);
  
  modal.removeAttribute('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function saveProductFromModal() {
  // Read form values
  var idx = productRows.findIndex(function(p) { return String(p.id) === currentEditingProductId; });
  if (idx === -1) return;
  
  productRows[idx].name = $('pe-name').value;
  productRows[idx].price = $('pe-price').value;
  // ... update all fields
  
  closeProductEditModal();
  renderProductCards();
  saveProductsToServer();
}
```

#### Settings Rows → Edit Modals
```javascript
// Settings rows listener
document.querySelectorAll('.sg-row[data-setting]').forEach(function(row) {
  row.addEventListener('click', function() {
    var setting = row.getAttribute('data-setting');
    openSettingEditModal(setting);
  });
});

function openSettingEditModal(settingKey) {
  var modal = $('setting-edit-modal');
  var form = $('setting-edit-form');
  var title = $('setting-edit-title');
  
  switch(settingKey) {
    case 'store-name':
      title.textContent = 'Store name';
      form.innerHTML = 
        '<div class="form-section">' +
          '<div class="form-group">' +
            '<label class="form-label">English name</label>' +
            '<input class="form-input" type="text" id="se-store-name-en" value="' + (CTX.store.name_en || '') + '" />' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Bengali name</label>' +
            '<input class="form-input" type="text" id="se-store-name-bn" value="' + (CTX.store.name_bn || '') + '" />' +
          '</div>' +
        '</div>';
      break;
    
    case 'whatsapp':
      title.textContent = 'WhatsApp number';
      form.innerHTML = 
        '<div class="form-section">' +
          '<div class="form-group">' +
            '<label class="form-label">Phone (digits only)</label>' +
            '<input class="form-input" type="tel" id="se-whatsapp" value="' + (CTX.whatsapp || '') + '" />' +
            '<p class="form-hint">Used for customer inquiries</p>' +
          '</div>' +
        '</div>';
      break;
    
    // ... more settings
  }
  
  modal.removeAttribute('hidden');
  currentEditingSetting = settingKey;
}

function saveSettingFromModal() {
  switch(currentEditingSetting) {
    case 'store-name':
      CTX.store.name_en = $('se-store-name-en').value;
      CTX.store.name_bn = $('se-store-name-bn').value;
      break;
    case 'whatsapp':
      CTX.whatsapp = $('se-whatsapp').value;
      break;
    // ... more
  }
  
  closeSettingEditModal();
  updateSettingPreviews();
  saveContextToServer();
}
```

### Phase 3: Mobile Optimizations (TODO)
- [ ] Swipe gestures for order cards
- [ ] Pull-to-refresh on lists
- [ ] Image upload via camera/gallery
- [ ] Haptic feedback on actions
- [ ] Offline mode indicators
- [ ] Progressive Web App manifest

## File Structure

```
marketpl/
├── seller.html          ← Mobile-first UI (NEW)
├── admin.html           ← Desktop UI (UNCHANGED)
├── style/
│   ├── seller.css       ← Mobile styles (NEW)
│   └── admin.css        ← Desktop styles (UNCHANGED)
├── logic/
│   ├── seller.js        ← Mobile logic (NEEDS REWRITE)
│   ├── seller_backup.js ← Original copy
│   └── admin.js         ← Desktop logic (UNCHANGED)
└── server.mjs           ← Routes /seller → seller.html ✅
```

## Current Status

### ✅ Complete
1. **HTML structure**: Mobile-first layout with bottom nav
2. **CSS styling**: Teal/amber, cards, modals, responsive
3. **Server routing**: `/seller` alias works
4. **Orders tab**: Fully functional with stats, filters, cards
5. **Login screen**: Beautiful Bengali/English hero

### ⚠️ In Progress
1. **Products tab**: Needs card rendering + edit modal
2. **Settings tab**: Needs modal handlers for each setting
3. **Context saving**: Same API, different UI flow

### 🎯 Next Steps

**Option A: Full Rewrite (Recommended)**
- Start fresh `seller.js` with mobile-first architecture
- Product cards + fullscreen edit modal
- Settings modals for each group
- Preserve all admin.js API calls

**Option B: Gradual Migration**
- Keep existing table rendering
- Add "Switch to Cards" toggle
- Migrate features one-by-one

## Testing Checklist

- [ ] Login with phone/password
- [ ] View orders, filter by status
- [ ] Tap order → see actions (Confirm/Despatch/Delete)
- [ ] Products tab shows cards (not table)
- [ ] Tap "Edit →" on product → fullscreen modal
- [ ] Edit product name, price, images
- [ ] Save product → updates card
- [ ] Settings → tap row → edit modal
- [ ] Change store name → updates header
- [ ] Bottom nav switches tabs smoothly
- [ ] Works on iPhone (Safari)
- [ ] Works on Android (Chrome)
- [ ] No horizontal scroll
- [ ] Touch targets ≥44px

## Design Inspiration

From `bangladesh_seller_admin_energetic.html`:
- ✅ Login hero with stats
- ✅ Greeting + store name header
- ✅ Ticker for new orders
- ✅ 2×2 stat grid
- ✅ Filter pills (horizontally scrollable)
- ✅ Order cards with colored left border
- ✅ Product cards (thumb + name + price + stock)
- ✅ Settings as grouped tappable rows
- ✅ Bottom navigation (Orders/Products/Settings)

## Browser Support

- iOS Safari 14+
- Android Chrome 90+
- Edge 90+ (desktop fallback)
- Firefox 88+ (desktop fallback)

## Performance

- Target: <100KB initial HTML+CSS+JS
- Images: WebP with JPEG fallback
- Lazy load order/product lists
- Debounce search/filter
- Cache context.json (5min)

---

**For immediate use**: The current `seller.html` works for **Orders** tab (fully functional). Products and Settings tabs need JavaScript implementation.

**Quick fix**: Use `admin.html` for products/settings editing, and `seller.html` for order management on mobile.
