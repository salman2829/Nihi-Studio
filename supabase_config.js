/* ===================================================
   NIHI STUDIO — Supabase Configuration & Auth Client
   =================================================== */

// Replace these placeholders with your actual Supabase project credentials
// You can get these from your Supabase Dashboard -> Settings -> API
window.NIHI_SUPABASE_CONFIG = {
  SUPABASE_URL: "https://your-project-ref.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-key-here"
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
