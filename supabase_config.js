/* ===================================================
   NIHI STUDIO — Supabase Configuration & Auth Client
   =================================================== */

// Replace these placeholders with your actual Supabase project credentials
// You can get these from your Supabase Dashboard -> Settings -> API
window.NIHI_SUPABASE_CONFIG = {
  SUPABASE_URL: "https://qufdcshawzomoygyaddr.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1ZmRjc2hhd3pvbW95Z3lhZGRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNjAwMjYsImV4cCI6MjEwMDYzNjAyNn0.Xluy1imdpHclDAbEDA5bR_sflsLr24Ar6dT8flJNkfk"
};

// Razorpay Key Configuration (You can replace this placeholder with your live Razorpay Key ID)
window.NIHI_RAZORPAY_CONFIG = {
  KEY_ID: "rzp_test_TI5rRFNfaQmMSs"
};

// Initialize Supabase Client
(function initSupabase() {
  const config = window.NIHI_SUPABASE_CONFIG;

  if (window.supabase && config.SUPABASE_URL && config.SUPABASE_URL.startsWith('https://')) {
    try {
      window.supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
      console.log('⚡ Supabase Client initialized successfully.');
    } catch (e) {
      console.warn('⚠️ Supabase init warning:', e.message);
      window.supabaseClient = null;
    }
  } else {
    window.supabaseClient = null;
    console.log('ℹ️ Operating in local session mode (Add SUPABASE_URL & ANON_KEY in supabase_config.js for live database sync).');
  }
})();
