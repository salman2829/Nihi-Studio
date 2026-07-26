/* ===================================================
   NIHI STUDIO — Interactive JavaScript & Supabase Auth
   =================================================== */

// Global State
let cart = [];
let wishlist = new Set();
let currentUser = null; // { email, fullName, id }
let pendingAuthAction = null; // Callback after successful login/signup

// ===== SUPABASE CART & ORDERS DATABASE SYNC =====

async function syncCartToSupabase() {
  if (!currentUser || !window.supabaseClient) return;
  try {
    const { error } = await window.supabaseClient
      .from('carts')
      .upsert({ user_id: currentUser.id, items: cart, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    console.log('✅ Cart synced to Supabase.');
  } catch (e) {
    // Silently fall back to localStorage
    console.warn('⚠️ Cart sync to Supabase failed. Saving to localStorage.', e.message);
    saveCartLocally();
  }
}

function saveCartLocally() {
  if (!currentUser) return;
  localStorage.setItem(`nihi_cart_${currentUser.id}`, JSON.stringify(cart));
}

function loadCartLocally() {
  if (!currentUser) return;
  try {
    const saved = localStorage.getItem(`nihi_cart_${currentUser.id}`);
    if (saved) { cart = JSON.parse(saved); updateCartUI(false); }
  } catch (e) { cart = []; }
}

async function loadCartFromSupabase() {
  if (!currentUser || !window.supabaseClient) { loadCartLocally(); return; }
  try {
    const { data, error } = await window.supabaseClient
      .from('carts')
      .select('items')
      .eq('user_id', currentUser.id)
      .single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found
    if (data && Array.isArray(data.items)) {
      cart = data.items;
      console.log(`✅ Cart loaded from Supabase — ${cart.length} item(s)`);
    } else {
      loadCartLocally();
    }
    updateCartUI(false);
  } catch (e) {
    console.warn('⚠️ Could not load cart from Supabase:', e.message);
    loadCartLocally();
  }
}

async function saveOrderToDatabase(paymentId, paymentStatus) {
  if (!currentUser) return;
  const orderData = {
    user_id: currentUser.id,
    items: cart,
    total_amount: cart.reduce((sum, item) => sum + item.price * item.qty, 0),
    razorpay_payment_id: paymentId,
    payment_status: paymentStatus,
    created_at: new Date().toISOString()
  };

  if (window.supabaseClient) {
    try {
      const { error } = await window.supabaseClient.from('orders').insert(orderData);
      if (error) throw error;
      console.log('✅ Order saved to Supabase.');
    } catch (e) {
      console.warn('⚠️ Could not save order to Supabase:', e.message);
      saveOrderLocally(orderData);
    }
  } else {
    saveOrderLocally(orderData);
  }
}

function saveOrderLocally(orderData) {
  if (!currentUser) return;
  const key = `nihi_orders_${currentUser.id}`;
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  existing.unshift({ ...orderData, id: 'local_' + Date.now() });
  localStorage.setItem(key, JSON.stringify(existing));
}

async function loadOrders() {
  if (!currentUser) return [];
  if (window.supabaseClient) {
    try {
      const { data, error } = await window.supabaseClient
        .from('orders')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('⚠️ Could not load orders from Supabase:', e.message);
    }
  }
  // Fallback: localStorage
  const key = `nihi_orders_${currentUser.id}`;
  return JSON.parse(localStorage.getItem(key) || '[]');
}

// ===== RAZORPAY CHECKOUT =====

function launchRazorpayCheckout() {
  if (!currentUser) return;
  if (cart.length === 0) { alert('Your cart is empty!'); return; }

  const totalAmount = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const razorpayKey = (window.NIHI_RAZORPAY_CONFIG && window.NIHI_RAZORPAY_CONFIG.KEY_ID) || '';

  if (!razorpayKey || razorpayKey === 'rzp_test_your_key_id') {
    // No valid key — show helpful message
    alert(`⚠️ Razorpay is not yet configured.\n\nPlease add your Razorpay Key ID to:\n  supabase_config.js → window.NIHI_RAZORPAY_CONFIG.KEY_ID\n\nGet your keys at: https://dashboard.razorpay.com`);
    return;
  }

  if (typeof Razorpay === 'undefined') {
    alert('⚠️ Razorpay SDK failed to load. Please check your internet connection and try again.');
    return;
  }

  const options = {
    key: razorpayKey,
    amount: totalAmount * 100, // Razorpay uses paise (₹1 = 100 paise)
    currency: 'INR',
    name: 'Nihi Studio',
    description: `${cart.reduce((s, i) => s + i.qty, 0)} item(s) — Premium Jewelry`,
    image: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💎</text></svg>',
    handler: async function(response) {
      const paymentId = response.razorpay_payment_id;
      // Save order to database
      await saveOrderToDatabase(paymentId, 'PAID');
      // Clear cart
      const clearedCart = [...cart];
      cart = [];
      await syncCartToSupabase();
      updateCartUI(false);
      window.closeCart();
      // Show success message
      showOrderSuccessModal(paymentId, clearedCart, totalAmount);
    },
    prefill: {
      name: currentUser.fullName || '',
      email: currentUser.email || ''
    },
    theme: { color: '#B8922A' },
    modal: {
      ondismiss: function() {
        console.log('Razorpay checkout closed by user.');
      }
    }
  };

  const rzp = new Razorpay(options);
  rzp.on('payment.failed', async function(response) {
    await saveOrderToDatabase(response.error.metadata?.payment_id || 'UNKNOWN', 'FAILED');
    alert(`❌ Payment failed: ${response.error.description}`);
  });
  rzp.open();
}

function showOrderSuccessModal(paymentId, items, total) {
  const successHtml = `
  <div id="orderSuccessOverlay" style="
    position:fixed;inset:0;z-index:9999;background:rgba(10,10,10,0.7);
    backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;
  ">
    <div style="
      background:#fff;border-radius:24px;padding:48px 40px;max-width:480px;width:90%;
      text-align:center;box-shadow:0 32px 80px rgba(0,0,0,0.3);
    ">
      <div style="font-size:64px;margin-bottom:16px;">🎉</div>
      <h2 style="font-family:'Playfair Display',serif;font-size:1.8rem;margin-bottom:8px;color:#1a1a1a;">Order Confirmed!</h2>
      <p style="color:#666;font-size:0.9rem;margin-bottom:4px;">Thank you, <strong>${currentUser.fullName || currentUser.email}</strong>!</p>
      <p style="color:#888;font-size:0.8rem;margin-bottom:24px;">Payment ID: <code>${paymentId}</code></p>
      <div style="background:#faf7f0;border-radius:12px;padding:16px;margin-bottom:24px;text-align:left;">
        ${items.map(i => `<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:0.85rem;"><span>${i.name} ×${i.qty}</span><strong>₹${(i.price * i.qty).toLocaleString()}</strong></div>`).join('')}
        <div style="border-top:1px solid #e0d5c5;margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-weight:700;"><span>Total Paid</span><span style="color:#B8922A;">₹${total.toLocaleString()}</span></div>
      </div>
      <button onclick="document.getElementById('orderSuccessOverlay').remove()" style="
        background:#B8922A;color:#fff;border:none;padding:14px 40px;border-radius:100px;
        font-size:0.9rem;font-weight:700;cursor:pointer;letter-spacing:1px;
      ">CONTINUE SHOPPING</button>
    </div>
  </div>`;
  const div = document.createElement('div');
  div.innerHTML = successHtml;
  document.body.appendChild(div.firstElementChild);
}

// ===== ORDERS MODAL LOGIC =====

function openOrdersModal() {
  const modal = document.getElementById('ordersModal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    renderOrdersList();
  }
}

function closeOrdersModal() {
  const modal = document.getElementById('ordersModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

async function renderOrdersList() {
  const listEl = document.getElementById('ordersList');
  const emptyEl = document.getElementById('ordersEmpty');
  if (!listEl) return;

  // Show loading state
  listEl.innerHTML = `<div style="text-align:center;padding:48px 24px;color:#888;"><p>Loading your orders…</p></div>`;

  const orders = await loadOrders();

  if (!orders || orders.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) listEl.appendChild(emptyEl);
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  listEl.innerHTML = orders.map(order => {
    const items = Array.isArray(order.items) ? order.items : [];
    const date = order.created_at ? new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
    const shortId = (order.razorpay_payment_id || order.id || '').toString().slice(-10).toUpperCase();
    return `
    <div class="order-card">
      <div class="order-card-header">
        <div class="order-meta-left">
          <span class="order-id">Order #${shortId}</span>
          <span class="order-date">${date}</span>
        </div>
        <span class="order-status-badge">${order.payment_status === 'PAID' ? '✓ Paid' : order.payment_status || 'Completed'}</span>
      </div>
      <div class="order-card-items">
        ${items.map(item => `
          <div class="order-item-row">
            <span class="order-item-name">${item.name} <span class="order-item-qty">×${item.qty}</span></span>
            <span class="order-item-price">₹${(item.price * item.qty).toLocaleString()}</span>
          </div>
        `).join('')}
      </div>
      <div class="order-card-footer">
        <span class="order-total-label">Total Paid</span>
        <span class="order-total-value">₹${Number(order.total_amount).toLocaleString()}</span>
      </div>
    </div>`;
  }).join('');
}

// Products Data
const products = {
  1: { id: 1, name: 'Celestial Diamond Ring', price: 2499, original: 3999, discount: '38% off', img: 'images/ring.png', rating: '★★★★★', reviews: '(128)', desc: 'A breathtaking solitaire diamond ring set in 18K gold. The celestial-inspired design features a brilliant-cut diamond that catches light from every angle.' },
  2: { id: 2, name: 'Eternal Gold Necklace', price: 3299, original: 4999, discount: '34% off', img: 'images/necklace.png', rating: '★★★★★', reviews: '(96)', desc: 'An elegant gold chain necklace with a delicate diamond pendant. Crafted in 22K gold, this timeless piece drapes beautifully for any occasion.' },
  3: { id: 3, name: 'Aurora Drop Earrings', price: 1699, original: 2499, discount: '30% off', img: 'images/earring.png', rating: '★★★★☆', reviews: '(74)', desc: 'Stunning drop earrings featuring aurora-inspired designs with small diamonds set in rose gold.' },
  4: { id: 4, name: 'Luxe Tennis Bracelet', price: 4999, original: 7999, discount: '37% off', img: 'images/bracelet.png', rating: '★★★★★', reviews: '(112)', desc: 'A luxurious tennis bracelet adorned with round brilliant diamonds set in a continuous row.' },
  5: { id: 5, name: 'Heart Diamond Pendant', price: 1999, original: 2999, discount: '33% off', img: 'images/pendant.png', rating: '★★★★★', reviews: '(58)', desc: 'A romantic heart-shaped diamond pendant on a fine gold chain.' },
  6: { id: 6, name: 'Royal Gold Bangles Set', price: 5499, original: 8999, discount: '39% off', img: 'images/bangles.png', rating: '★★★★☆', reviews: '(89)', desc: 'A set of three beautifully crafted gold bangles with intricate traditional Indian patterns.' },
  7: { id: 7, name: 'Moonstone Pendant', price: 1499, original: 1999, discount: '25% off', img: 'images/pendant.png', rating: '★★★★★', reviews: '(32)', desc: 'A mystical moonstone pendant that glows with an ethereal blue sheen set in sterling silver.' },
  8: { id: 8, name: 'Sapphire Stud Earrings', price: 2199, original: 2999, discount: '27% off', img: 'images/earring.png', rating: '★★★★★', reviews: '(18)', desc: 'Classic stud earrings featuring vivid blue sapphires surrounded by a halo of micro-diamonds.' },
  9: { id: 9, name: 'Eternity Band Ring', price: 3799, original: 5499, discount: '31% off', img: 'images/ring.png', rating: '★★★★☆', reviews: '(45)', desc: 'An eternity band ring encrusted with diamonds all around, symbolizing never-ending love.' },
  10: { id: 10, name: 'Rose Gold Chain Necklace', price: 2799, original: 3999, discount: '30% off', img: 'images/necklace.png', rating: '★★★★★', reviews: '(27)', desc: 'A delicate rose gold chain necklace with a minimalist pendant.' }
};

// Global Cart & UI Helpers
window.openCart = function() {
  const cartSidebar = document.getElementById('cartSidebar');
  const cartOverlay = document.getElementById('cartOverlay');
  if (cartSidebar && cartOverlay) {
    cartSidebar.classList.add('active');
    cartOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
};

window.closeCart = function() {
  const cartSidebar = document.getElementById('cartSidebar');
  const cartOverlay = document.getElementById('cartOverlay');
  if (cartSidebar && cartOverlay) {
    cartSidebar.classList.remove('active');
    cartOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }
};

window.removeFromCart = function(id) {
  cart = cart.filter(item => item.id !== id);
  updateCartUI(true);
};

window.updateQty = function(id, delta) {
  const item = cart.find(i => i.id === id);
  if (item) {
    item.qty += delta;
    if (item.qty <= 0) {
      window.removeFromCart(id);
      return;
    }
  }
  updateCartUI(true);
};

function updateCartUI(shouldSync = true) {
  const cartItems = document.getElementById('cartItems');
  const cartEmpty = document.getElementById('cartEmpty');
  const cartFooter = document.getElementById('cartFooter');
  const cartTotal = document.getElementById('cartTotal');
  const cartCount = document.getElementById('cartCount');
  const cartItemCount = document.getElementById('cartItemCount');

  if (!cartItems) return;

  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  if (cartCount) {
    if (totalItems > 0) {
      cartCount.style.display = 'flex';
      cartCount.textContent = totalItems;
    } else {
      cartCount.style.display = 'none';
    }
  }

  if (cartItemCount) cartItemCount.textContent = totalItems;
  if (cartTotal) cartTotal.textContent = `₹${totalPrice.toLocaleString()}`;

  if (cart.length === 0) {
    if (cartEmpty) cartEmpty.style.display = 'block';
    if (cartFooter) cartFooter.style.display = 'none';
    cartItems.querySelectorAll('.cart-item').forEach(el => el.remove());
  } else {
    if (cartEmpty) cartEmpty.style.display = 'none';
    if (cartFooter) cartFooter.style.display = 'block';

    cartItems.querySelectorAll('.cart-item').forEach(el => el.remove());

    cart.forEach(item => {
      const el = document.createElement('div');
      el.className = 'cart-item';
      el.innerHTML = `
        <div class="cart-item-img">
          <img src="${item.img}" alt="${item.name}">
        </div>
        <div class="cart-item-info">
          <h4>${item.name}</h4>
          <div class="cart-item-price">₹${item.price.toLocaleString()}</div>
          <div class="cart-item-qty">
            <button onclick="window.updateQty(${item.id}, -1)">−</button>
            <span>${item.qty}</span>
            <button onclick="window.updateQty(${item.id}, 1)">+</button>
          </div>
        </div>
        <button class="cart-item-remove" onclick="window.removeFromCart(${item.id})" aria-label="Remove item">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      `;
      cartItems.appendChild(el);
    });
  }
  // Sync cart to database whenever UI updates with items
  if (shouldSync && currentUser) {
    syncCartToSupabase();
  } else if (shouldSync && currentUser) {
    saveCartLocally();
  }
}

function executeAddToCart(product) {
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ ...product, qty: 1 });
  }
  updateCartUI(true);
  window.openCart();
}

// ===== AUTHENTICATION & AUTH GATING =====

function openAuthModal(noticeText = null, tabToOpen = 'signIn') {
  const authModal = document.getElementById('authModal');
  const authNoticeBanner = document.getElementById('authNoticeBanner');
  const authNoticeText = document.getElementById('authNoticeText');

  if (noticeText && authNoticeBanner && authNoticeText) {
    authNoticeText.textContent = noticeText;
    authNoticeBanner.style.display = 'block';
  } else if (authNoticeBanner) {
    authNoticeBanner.style.display = 'none';
  }

  switchAuthTab(tabToOpen);

  if (authModal) {
    authModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeAuthModal() {
  const authModal = document.getElementById('authModal');
  if (authModal) {
    authModal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function switchAuthTab(tab) {
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const formSignIn = document.getElementById('formSignIn');
  const formSignUp = document.getElementById('formSignUp');
  const authSubtitle = document.getElementById('authSubtitle');

  const signInError = document.getElementById('signInError');
  const signUpError = document.getElementById('signUpError');
  if (signInError) signInError.style.display = 'none';
  if (signUpError) signUpError.style.display = 'none';

  if (tab === 'signIn') {
    if (tabSignIn) tabSignIn.classList.add('active');
    if (tabSignUp) tabSignUp.classList.remove('active');
    if (formSignIn) formSignIn.style.display = 'flex';
    if (formSignUp) formSignUp.style.display = 'none';
    if (authSubtitle) authSubtitle.textContent = 'Welcome back! Sign in to access your saved cart & wishlist';
  } else {
    if (tabSignUp) tabSignUp.classList.add('active');
    if (tabSignIn) tabSignIn.classList.remove('active');
    if (formSignUp) formSignUp.style.display = 'flex';
    if (formSignIn) formSignIn.style.display = 'none';
    if (authSubtitle) authSubtitle.textContent = 'Create your account to unlock free shipping & luxury rewards';
  }
}

// Perform action after checking Auth
function requireAuth(actionCallback, noticeMessage = "Please sign in or create an account to proceed.") {
  if (currentUser) {
    actionCallback();
  } else {
    pendingAuthAction = actionCallback;
    openAuthModal(noticeMessage, 'signIn');
  }
}

function onAuthSuccess(userObj) {
  currentUser = userObj;
  updateUserUI();
  closeAuthModal();

  // Load this user's saved cart from database
  loadCartFromSupabase();

  // Execute pending action if user tried to add item / checkout before logging in
  if (pendingAuthAction) {
    const action = pendingAuthAction;
    pendingAuthAction = null;
    setTimeout(() => { action(); }, 300);
  }
}

function updateUserUI() {
  const dropdownUserName = document.getElementById('dropdownUserName');
  const dropdownUserEmail = document.getElementById('dropdownUserEmail');
  const dropdownAuthBtn = document.getElementById('dropdownAuthBtn');
  const dropdownLogoutBtn = document.getElementById('dropdownLogoutBtn');
  const userAvatarBadge = document.getElementById('userAvatarBadge');

  if (currentUser) {
    if (dropdownUserName) dropdownUserName.textContent = currentUser.fullName || currentUser.email.split('@')[0];
    if (dropdownUserEmail) dropdownUserEmail.textContent = currentUser.email;
    if (dropdownAuthBtn) dropdownAuthBtn.style.display = 'none';
    if (dropdownLogoutBtn) dropdownLogoutBtn.style.display = 'flex';
    if (userAvatarBadge) {
      userAvatarBadge.style.display = 'flex';
      const initial = (currentUser.fullName || currentUser.email).charAt(0).toUpperCase();
      userAvatarBadge.textContent = initial;
    }
  } else {
    if (dropdownUserName) dropdownUserName.textContent = 'Guest User';
    if (dropdownUserEmail) dropdownUserEmail.textContent = 'Not signed in';
    if (dropdownAuthBtn) dropdownAuthBtn.style.display = 'flex';
    if (dropdownLogoutBtn) dropdownLogoutBtn.style.display = 'none';
    if (userAvatarBadge) userAvatarBadge.style.display = 'none';
  }
}

// ===== LOCAL STORAGE USER FALLBACK REGISTRY =====
function saveLocalUser(email, password, fullName) {
  try {
    const users = JSON.parse(localStorage.getItem('nihi_local_users') || '{}');
    users[email.toLowerCase().trim()] = { email: email.trim(), password, fullName, id: 'local_' + Date.now() };
    localStorage.setItem('nihi_local_users', JSON.stringify(users));
  } catch (e) {
    console.error('Failed to save user to local storage:', e);
  }
}

function verifyLocalUser(email, password) {
  try {
    const users = JSON.parse(localStorage.getItem('nihi_local_users') || '{}');
    const user = users[email.toLowerCase().trim()];
    if (user && user.password === password) {
      return user;
    }
  } catch (e) {
    console.error('Failed to verify local user:', e);
  }
  return null;
}

// ===== SUPABASE AUTH HANDLERS =====

async function processSignIn(email, password) {
  const signInError = document.getElementById('signInError');
  const btnSubmitSignIn = document.getElementById('btnSubmitSignIn');

  if (btnSubmitSignIn) btnSubmitSignIn.textContent = 'Signing in...';
  if (signInError) signInError.style.display = 'none';

  if (window.supabaseClient) {
    try {
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const user = data.user;
      const fullName = user.user_metadata?.full_name || email.split('@')[0];
      onAuthSuccess({ email: user.email, fullName: fullName, id: user.id });
    } catch (err) {
      // Check if it is a network connectivity/adblocker issue
      if (err.message && (err.message.includes('Failed to fetch') || err.name === 'TypeError')) {
        console.warn('⚠️ Supabase connection failed. Trying local storage database fallback...');
        const localUser = verifyLocalUser(email, password);
        if (localUser) {
          // Show quick local auth success alert
          alert('ℹ️ Connected via Local Offline Mode.');
          onAuthSuccess(localUser);
          return;
        } else {
          if (signInError) {
            signInError.textContent = 'Network error: Could not reach server, and no local account matches.';
            signInError.style.display = 'block';
          }
          return;
        }
      }
      
      if (signInError) {
        signInError.textContent = err.message || 'Invalid email or password.';
        signInError.style.display = 'block';
      }
    } finally {
      if (btnSubmitSignIn) btnSubmitSignIn.textContent = 'Sign In to Nihi Studio';
    }
  } else {
    // Local session fallback mode
    setTimeout(() => {
      const localUser = verifyLocalUser(email, password);
      if (localUser) {
        onAuthSuccess(localUser);
      } else {
        // If not registered locally, auto-create one for frictionless test
        const fullName = email.split('@')[0];
        saveLocalUser(email, password, fullName);
        onAuthSuccess({ email, fullName, id: 'local_' + Date.now() });
      }
      if (btnSubmitSignIn) btnSubmitSignIn.textContent = 'Sign In to Nihi Studio';
    }, 600);
  }
}

async function processSignUp(fullName, email, password) {
  const signUpError = document.getElementById('signUpError');
  const btnSubmitSignUp = document.getElementById('btnSubmitSignUp');

  if (btnSubmitSignUp) btnSubmitSignUp.textContent = 'Creating account...';
  if (signUpError) {
    signUpError.style.display = 'none';
    signUpError.style.background = '';
    signUpError.style.borderColor = '';
    signUpError.style.color = '';
  }

  // Pre-save locally in case of network issue
  saveLocalUser(email, password, fullName);

  if (window.supabaseClient) {
    try {
      const { data, error } = await window.supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName }
        }
      });
      if (error) throw error;
      
      const user = data.user;
      const session = data.session;
      
      if (session) {
        // Auto-login active (Email Confirmation is disabled in Supabase)
        onAuthSuccess({ email: user.email, fullName: fullName, id: user.id });
      } else {
        // Email Confirmation is enabled (Supabase default)
        if (signUpError) {
          signUpError.style.background = "#EBF5EB";
          signUpError.style.borderColor = "var(--green)";
          signUpError.style.color = "#276A27";
          signUpError.textContent = "Account created! Please check your email to verify and sign in.";
          signUpError.style.display = 'block';
        }
      }
    } catch (err) {
      // Check if it is a network connectivity/adblocker issue
      if (err.message && (err.message.includes('Failed to fetch') || err.name === 'TypeError')) {
        console.warn('⚠️ Supabase connection failed. Successfully saved user locally.');
        alert('🎉 Account created successfully in Local Offline Mode!');
        onAuthSuccess({ email, fullName, id: 'local_' + Date.now() });
        return;
      }

      if (signUpError) {
        signUpError.textContent = err.message || 'Failed to create account.';
        signUpError.style.display = 'block';
      }
    } finally {
      if (btnSubmitSignUp) btnSubmitSignUp.textContent = 'Create Free Account';
    }
  } else {
    // Local session fallback mode
    setTimeout(() => {
      onAuthSuccess({ email, fullName, id: 'local_' + Date.now() });
      if (btnSubmitSignUp) btnSubmitSignUp.textContent = 'Create Free Account';
    }, 600);
  }
}

async function processLogout() {
  if (window.supabaseClient) {
    try { await window.supabaseClient.auth.signOut(); } catch (e) {}
  }
  currentUser = null;
  cart = [];
  wishlist = new Set();
  updateCartUI(false);
  updateUserUI();
  console.log('👋 User signed out. Cart cleared.');
}

// ===== DOM INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {

  // Page Loader
  const pageLoader = document.getElementById('pageLoader');
  if (pageLoader) {
    setTimeout(() => { pageLoader.classList.add('hidden'); }, 800);
  }

  // Check Supabase initial Auth Session if connected
  if (window.supabaseClient) {
    window.supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session && session.user) {
        const user = session.user;
        currentUser = {
          email: user.email,
          fullName: user.user_metadata?.full_name || user.email.split('@')[0],
          id: user.id
        };
        updateUserUI();
      }
    });

    window.supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session && session.user) {
        const user = session.user;
        currentUser = {
          email: user.email,
          fullName: user.user_metadata?.full_name || user.email.split('@')[0],
          id: user.id
        };
        updateUserUI();
      } else {
        currentUser = null;
        updateUserUI();
      }
    });
  }

  // User Dropdown & Modal Listeners
  const userBtn = document.getElementById('userBtn');
  const userDropdown = document.getElementById('userDropdown');
  const dropdownAuthBtn = document.getElementById('dropdownAuthBtn');
  const dropdownLogoutBtn = document.getElementById('dropdownLogoutBtn');
  const authCloseBtn = document.getElementById('authCloseBtn');
  const authBackdrop = document.getElementById('authBackdrop');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');

  if (userBtn && userDropdown) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (!userDropdown.contains(e.target) && !userBtn.contains(e.target)) {
        userDropdown.classList.remove('active');
      }
    });
  }

  if (dropdownAuthBtn) {
    dropdownAuthBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (userDropdown) userDropdown.classList.remove('active');
      openAuthModal(null, 'signIn');
    });
  }

  if (dropdownLogoutBtn) {
    dropdownLogoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (userDropdown) userDropdown.classList.remove('active');
      processLogout();
    });
  }

  if (authCloseBtn) authCloseBtn.addEventListener('click', closeAuthModal);
  if (authBackdrop) authBackdrop.addEventListener('click', closeAuthModal);

  if (tabSignIn) tabSignIn.addEventListener('click', () => switchAuthTab('signIn'));
  if (tabSignUp) tabSignUp.addEventListener('click', () => switchAuthTab('signUp'));

  // Form Submissions
  const formSignIn = document.getElementById('formSignIn');
  if (formSignIn) {
    formSignIn.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('signInEmail').value.trim();
      const password = document.getElementById('signInPassword').value;
      if (email && password) {
        processSignIn(email, password);
      }
    });
  }

  const formSignUp = document.getElementById('formSignUp');
  if (formSignUp) {
    formSignUp.addEventListener('submit', (e) => {
      e.preventDefault();
      const fullName = document.getElementById('signUpName').value.trim();
      const email = document.getElementById('signUpEmail').value.trim();
      const password = document.getElementById('signUpPassword').value;
      const confirmPassword = document.getElementById('signUpConfirmPassword').value;
      const signUpError = document.getElementById('signUpError');

      if (password !== confirmPassword) {
        if (signUpError) {
          signUpError.textContent = 'Passwords do not match. Please re-enter.';
          signUpError.style.display = 'block';
        }
        return;
      }

      if (fullName && email && password) {
        processSignUp(fullName, email, password);
      }
    });
  }

  // Back to Top
  const backToTop = document.getElementById('backToTop');
  if (backToTop) {
    window.addEventListener('scroll', () => {
      if (window.pageYOffset > 500) backToTop.classList.add('visible');
      else backToTop.classList.remove('visible');
    });
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Mobile Menu
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileOverlay = document.getElementById('mobileOverlay');

  function closeMobileMenu() {
    if (hamburger) hamburger.classList.remove('active');
    if (mobileMenu) mobileMenu.classList.remove('active');
    if (mobileOverlay) mobileOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (hamburger && mobileMenu && mobileOverlay) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      mobileMenu.classList.toggle('active');
      mobileOverlay.classList.toggle('active');
      document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
    });

    mobileOverlay.addEventListener('click', closeMobileMenu);
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeMobileMenu);
    });
  }

  // Cart Controls
  const cartBtn = document.getElementById('cartBtn');
  const cartClose = document.getElementById('cartClose');
  const cartOverlay = document.getElementById('cartOverlay');

  if (cartBtn) cartBtn.addEventListener('click', window.openCart);
  if (cartClose) cartClose.addEventListener('click', window.closeCart);
  if (cartOverlay) cartOverlay.addEventListener('click', window.closeCart);

  // Add to Cart Buttons (Auth Gated!)
  document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const product = products[id];
      if (product) {
        requireAuth(() => {
          executeAddToCart(product);
          const span = btn.querySelector('span');
          if (span) {
            const originalText = span.textContent;
            span.textContent = '✓ Added!';
            setTimeout(() => { span.textContent = originalText; }, 1200);
          }
        }, "Please sign in or create an account to add items to your cart.");
      }
    });
  });

  // Wishlist (Auth Gated!)
  const wishlistCount = document.getElementById('wishlistCount');
  document.querySelectorAll('.wishlist-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      requireAuth(() => {
        if (wishlist.has(id)) {
          wishlist.delete(id);
          btn.classList.remove('wishlisted');
          const svg = btn.querySelector('svg');
          if (svg) svg.setAttribute('fill', 'none');
        } else {
          wishlist.add(id);
          btn.classList.add('wishlisted');
          const svg = btn.querySelector('svg');
          if (svg) svg.setAttribute('fill', 'currentColor');
        }

        if (wishlistCount) {
          if (wishlist.size > 0) {
            wishlistCount.style.display = 'flex';
            wishlistCount.textContent = wishlist.size;
          } else {
            wishlistCount.style.display = 'none';
          }
        }
      }, "Please sign in or create an account to save items to your wishlist.");
    });
  });

  // Search Overlay
  const searchBtn = document.getElementById('searchBtn');
  const searchOverlay = document.getElementById('searchOverlay');
  const searchClose = document.getElementById('searchClose');
  const searchInput = document.getElementById('searchInput');

  function closeSearch() {
    if (searchOverlay) searchOverlay.classList.remove('active');
    document.body.style.overflow = '';
    if (searchInput) searchInput.value = '';
  }

  if (searchBtn && searchOverlay) {
    searchBtn.addEventListener('click', () => {
      searchOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      if (searchInput) setTimeout(() => searchInput.focus(), 200);
    });
  }

  if (searchClose) searchClose.addEventListener('click', closeSearch);
  if (searchOverlay) {
    searchOverlay.addEventListener('click', (e) => {
      if (e.target === searchOverlay) closeSearch();
    });
  }

  // Quick View Modal
  const quickViewModal = document.getElementById('quickViewModal');
  const quickViewBackdrop = document.getElementById('quickViewBackdrop');
  const quickViewClose = document.getElementById('quickViewClose');

  function closeQuickView() {
    if (quickViewModal) quickViewModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (quickViewClose) quickViewClose.addEventListener('click', closeQuickView);
  if (quickViewBackdrop) quickViewBackdrop.addEventListener('click', closeQuickView);

  document.querySelectorAll('.quick-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const product = products[id];
      if (product && quickViewModal) {
        const img = document.getElementById('qvImage');
        const name = document.getElementById('qvName');
        const stars = document.getElementById('qvStars');
        const reviews = document.getElementById('qvReviews');
        const price = document.getElementById('qvPrice');
        const original = document.getElementById('qvOriginal');
        const discount = document.getElementById('qvDiscount');
        const desc = document.getElementById('qvDescription');
        const addBtn = document.getElementById('qvAddToCart');

        if (img) img.src = product.img;
        if (name) name.textContent = product.name;
        if (stars) stars.textContent = product.rating;
        if (reviews) reviews.textContent = product.reviews;
        if (price) price.textContent = `₹${product.price.toLocaleString()}`;
        if (original) original.textContent = `₹${product.original.toLocaleString()}`;
        if (discount) discount.textContent = product.discount;
        if (desc) desc.textContent = product.desc;

        if (addBtn) {
          addBtn.onclick = () => {
            requireAuth(() => {
              executeAddToCart(product);
              closeQuickView();
            }, "Please sign in or create an account to add items to your cart.");
          };
        }

        quickViewModal.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    });
  });

  // ESC key listener
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSearch();
      closeQuickView();
      closeAuthModal();
      closeOrdersModal();
      window.closeCart();
      closeMobileMenu();
    }
  });

  // Hero Carousel
  const heroSlides = document.querySelectorAll('.hero-slide');
  const heroDots = document.querySelectorAll('.hero-dot');
  const heroPrev = document.getElementById('heroPrev');
  const heroNext = document.getElementById('heroNext');
  let currentHeroSlide = 0;
  let heroTimer = null;

  function goToHeroSlide(index) {
    if (heroSlides.length === 0) return;
    heroSlides.forEach(s => s.classList.remove('active'));
    heroDots.forEach(d => d.classList.remove('active'));
    currentHeroSlide = index % heroSlides.length;
    heroSlides[currentHeroSlide].classList.add('active');
    if (heroDots[currentHeroSlide]) heroDots[currentHeroSlide].classList.add('active');
  }

  function startHeroAuto() {
    if (heroTimer) clearInterval(heroTimer);
    heroTimer = setInterval(() => { goToHeroSlide(currentHeroSlide + 1); }, 5000);
  }

  if (heroSlides.length > 0) {
    if (heroNext) {
      heroNext.addEventListener('click', () => {
        goToHeroSlide(currentHeroSlide + 1);
        startHeroAuto();
      });
    }
    if (heroPrev) {
      heroPrev.addEventListener('click', () => {
        goToHeroSlide(currentHeroSlide - 1 + heroSlides.length);
        startHeroAuto();
      });
    }
    heroDots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        goToHeroSlide(i);
        startHeroAuto();
      });
    });
    startHeroAuto();
  }

  // Carousel Navigation Arrows
  document.querySelectorAll('.carousel-arrow').forEach(arrow => {
    arrow.addEventListener('click', () => {
      const carouselId = arrow.dataset.carousel;
      const carousel = document.getElementById(carouselId);
      if (carousel) {
        const scrollAmount = 300;
        if (arrow.classList.contains('left')) {
          carousel.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
        } else {
          carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        }
      }
    });
  });

  // Scroll Reveal Animations
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

  // Testimonials Carousel
  const testimonialCarousel = document.getElementById('testimonialCarousel');
  const testimonialDots = document.querySelectorAll('.testimonial-dot');
  let currentTestimonial = 0;

  function goToTestimonial(index) {
    if (!testimonialCarousel) return;
    currentTestimonial = index % testimonialDots.length;
    testimonialCarousel.style.transform = `translateX(-${currentTestimonial * 100}%)`;
    testimonialDots.forEach(d => d.classList.remove('active'));
    if (testimonialDots[currentTestimonial]) testimonialDots[currentTestimonial].classList.add('active');
  }

  if (testimonialDots.length > 0) {
    testimonialDots.forEach((dot, i) => {
      dot.addEventListener('click', () => goToTestimonial(i));
    });
    setInterval(() => { goToTestimonial(currentTestimonial + 1); }, 6000);
  }

  // Counter Animations
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = parseInt(entry.target.dataset.target);
        if (!isNaN(target)) animateCounter(entry.target, target);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('.trust-stat').forEach(el => counterObserver.observe(el));

  function animateCounter(element, target) {
    let current = 0;
    const duration = 1800;
    const step = target / (duration / 16);
    function update() {
      current += step;
      if (current >= target) {
        if (target >= 1000) {
          element.textContent = (target / 1000).toFixed(0) + 'K+';
        } else {
          element.textContent = target + (target === 30 ? ' Days' : '+');
        }
        return;
      }
      if (target >= 1000) {
        element.textContent = (current / 1000).toFixed(1) + 'K+';
      } else {
        element.textContent = Math.floor(current) + '+';
      }
      requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  // Sparkle Trail Effect
  let throttle = false;
  document.addEventListener('mousemove', (e) => {
    if (throttle) return;
    throttle = true;
    setTimeout(() => { throttle = false; }, 90);

    const sparkle = document.createElement('div');
    sparkle.className = 'sparkle';
    sparkle.style.left = e.clientX + 'px';
    sparkle.style.top = e.clientY + 'px';
    sparkle.style.setProperty('--tx', ((Math.random() - 0.5) * 26) + 'px');
    sparkle.style.setProperty('--ty', ((Math.random() - 0.5) * 26) + 'px');
    document.body.appendChild(sparkle);
    setTimeout(() => sparkle.remove(), 500);
  });

  // Newsletter Form
  const newsletterForm = document.getElementById('newsletterForm');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('newsletterEmail');
      const btn = newsletterForm.querySelector('button');
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✓ Subscribed!';
        btn.style.background = '#2ECC71';
        if (input) input.value = '';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
        }, 2500);
      }
    });
  }

  // Checkout Button — Razorpay Payment Gateway (Auth Gated!)
  const checkoutBtn = document.getElementById('checkoutBtn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
      requireAuth(() => {
        launchRazorpayCheckout();
      }, "Please sign in or create an account to complete your checkout.");
    });
  }

  // Orders Modal
  const ordersCloseBtn = document.getElementById('ordersCloseBtn');
  const ordersBackdrop = document.getElementById('ordersBackdrop');
  if (ordersCloseBtn) ordersCloseBtn.addEventListener('click', closeOrdersModal);
  if (ordersBackdrop) ordersBackdrop.addEventListener('click', closeOrdersModal);

  // "My Orders" dropdown link
  const dropdownOrdersBtn = document.getElementById('dropdownOrdersBtn');
  if (dropdownOrdersBtn) {
    dropdownOrdersBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!currentUser) { openAuthModal('Please sign in to view your order history.', 'signIn'); return; }
      // close profile dropdown first
      const dropdown = document.getElementById('userDropdown');
      if (dropdown) dropdown.classList.remove('active');
      openOrdersModal();
    });
  }
});

