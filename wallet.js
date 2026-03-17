// wallet.js — Phantom connect + session memory
const HOUSE_WALLET = '4CfWJ7CtXuewUTAZnku1PtKDuwcVMe5Z374L1wfHXUj2';
const HELIUS_RPC   = 'https://mainnet.helius-rpc.com/?api-key=ad3029b1-970c-4f66-a68d-58301f7c0a3a';
const SESSION_KEY  = 'hexshot_wallet_connected';

let walletConnected  = false;
let phantomPublicKey = null;
let walletBalance    = 0;
let SOL_USD          = 150;
let _balanceTimer    = null;

function $id(id){ return document.getElementById(id); }
function shortAddr(a){ return a ? a.slice(0,4)+'…'+a.slice(-4) : '—'; }
function getPhantom(){ return window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null); }

// SOL price
async function fetchSolPrice(){
  try {
    const r = await fetch('https://price.jup.ag/v4/price?ids=SOL');
    const d = await r.json();
    if (d?.data?.SOL?.price){ SOL_USD = d.data.SOL.price; updateWalletDisplay(); return; }
  } catch {}
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const d = await r.json();
    if (d?.solana?.usd){ SOL_USD = d.solana.usd; updateWalletDisplay(); }
  } catch {}
}
fetchSolPrice();
setInterval(fetchSolPrice, 60000);

async function fetchBalance(pubkeyStr){
  try {
    const r = await fetch(HELIUS_RPC, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({jsonrpc:'2.0',id:1,method:'getBalance',params:[pubkeyStr]})
    });
    const d = await r.json();
    if (d.result?.value !== undefined) return d.result.value / 1e9;
  } catch {}
  return 0;
}

function updateWalletDisplay(){
  const solEl    = $id('wallet-sol');
  const usdEl    = $id('wallet-usd');
  const balBox   = $id('sol-balance-display');
  const priceBox = $id('sol-price-display');
  const chip     = $id('sol-price-chip');
  if (chip)  chip.textContent = 'SOL $' + SOL_USD.toFixed(2);
  if (solEl) solEl.textContent = walletBalance.toFixed(3);
  if (usdEl) usdEl.textContent = '$' + (walletBalance * SOL_USD).toFixed(2);
  if (walletConnected){
    if (balBox)   balBox.style.display   = 'flex';
    if (priceBox) priceBox.style.display = 'none';
  }
  if (typeof updateBetUSD === 'function') updateBetUSD();
}

function applyConnectedUI(pubKey){
  const short = shortAddr(pubKey);
  if ($id('btn-connect'))         $id('btn-connect').style.display        = 'none';
  if ($id('addr-chip'))           $id('addr-chip').style.display           = 'flex';
  if ($id('addr-text'))           $id('addr-text').textContent             = short;
  if ($id('sol-balance-display')) $id('sol-balance-display').style.display = 'flex';
  if ($id('sol-price-display'))   $id('sol-price-display').style.display   = 'none';
  if ($id('demo-badge'))          $id('demo-badge').style.display          = 'none';
  if ($id('pp-big-avatar'))       $id('pp-big-avatar').textContent         = '👻';
  if ($id('profile-avatar'))      $id('profile-avatar').textContent        = '👻';
  if ($id('pp-username'))         $id('pp-username').textContent           = short;
  if ($id('profile-btn-info'))    $id('profile-btn-info').style.display    = 'flex';
  updateWalletDisplay();
}

// Save session
function saveSession(pubKey){
  try { sessionStorage.setItem(SESSION_KEY, pubKey); } catch {}
}
function clearSession(){
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}
function getSavedSession(){
  try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}

async function connectPhantom(){
  const phantom = getPhantom();
  if (!phantom){ window.open('https://phantom.app/','_blank'); return; }
  const btn  = $id('wm-phantom-btn');
  const desc = $id('phantom-desc');
  if (btn)  btn.style.pointerEvents = 'none';
  if (desc) desc.textContent = '⏳ Waiting for Phantom...';
  try {
    const resp   = await phantom.connect({ onlyIfTrusted: false });
    const pubKey = resp.publicKey.toString();
    if (pubKey === HOUSE_WALLET){
      showToast('❌ Switch to your personal wallet!');
      if (desc) desc.textContent = '❌ Wrong account';
      if (btn)  btn.style.pointerEvents = '';
      phantom.disconnect();
      return;
    }
    await _finishConnect(phantom, pubKey);
  } catch(err){
    const msg = err.code === 4001 ? '❌ Rejected' : '❌ ' + (err.message || 'Connect failed');
    if (desc) desc.textContent = msg;
    if (btn)  btn.style.pointerEvents = '';
    showToast(msg);
  }
}

async function _finishConnect(phantom, pubKey){
  phantomPublicKey = pubKey;
  walletConnected  = true;
  walletBalance    = await fetchBalance(pubKey);
  saveSession(pubKey); // remember for refresh
  closeWalletModal();
  applyConnectedUI(pubKey);
  showToast('✅ Connected! ' + walletBalance.toFixed(3) + ' SOL');
  clearInterval(_balanceTimer);
  _balanceTimer = setInterval(async () => {
    walletBalance = await fetchBalance(pubKey);
    updateWalletDisplay();
  }, 15000);
  phantom.on?.('accountChanged', async (newPub) => {
    if (!newPub){ disconnectWallet(); return; }
    const np = newPub.toString();
    if (np === HOUSE_WALLET){ disconnectWallet(); return; }
    phantomPublicKey = np;
    walletBalance = await fetchBalance(np);
    saveSession(np);
    applyConnectedUI(np);
  });
}

function disconnectWallet(){
  const phantom = getPhantom();
  phantom?.disconnect?.();
  walletConnected  = false;
  phantomPublicKey = null;
  walletBalance    = 0;
  clearInterval(_balanceTimer);
  clearSession(); // forget on disconnect
  if ($id('btn-connect'))         $id('btn-connect').style.display         = '';
  if ($id('addr-chip'))           $id('addr-chip').style.display            = 'none';
  if ($id('sol-balance-display')) $id('sol-balance-display').style.display  = 'none';
  if ($id('sol-price-display'))   $id('sol-price-display').style.display    = 'flex';
  closeWalletModal();
  showToast('Disconnected');
}

// Auto-reconnect on refresh if session exists
async function trySessionReconnect(){
  const saved = getSavedSession();
  if (!saved) return;
  const phantom = getPhantom();
  if (!phantom) return;
  
  // Try trusted first (no popup)
  try {
    const resp = await phantom.connect({ onlyIfTrusted: true });
    const pubKey = resp.publicKey.toString();
    if (pubKey === HOUSE_WALLET){ clearSession(); return; }
    // Update session if account changed
    saveSession(pubKey);
    await _finishConnect(phantom, pubKey);
    return;
  } catch {}
  
  // Trusted failed — check if phantom already has a connected account
  try {
    if (phantom.publicKey) {
      const pubKey = phantom.publicKey.toString();
      if (pubKey === HOUSE_WALLET){ clearSession(); return; }
      saveSession(pubKey);
      await _finishConnect(phantom, pubKey);
      return;
    }
  } catch {}
  
  // Session exists but can't auto-reconnect — show reconnect button
  showReconnectBanner(saved);
}

function showReconnectBanner(savedAddr){
  // Show a small banner to reconnect with one click
  let banner = document.getElementById('reconnect-banner');
  if (banner) return;
  banner = document.createElement('div');
  banner.id = 'reconnect-banner';
  banner.style.cssText = 'position:fixed;bottom:80px;right:24px;z-index:9998;' +
    'background:#0f0f1e;border:1px solid rgba(168,85,247,0.5);border-radius:12px;' +
    'padding:12px 16px;display:flex;align-items:center;gap:10px;' +
    'box-shadow:0 8px 32px rgba(0,0,0,0.5);animation:toastIn 0.3s ease;';
  banner.innerHTML = `
    <span style="font-size:1.1rem">👻</span>
    <div style="font-size:0.78rem;color:#e2e8f0;flex:1">
      <div style="font-weight:700;margin-bottom:2px">Reconnect wallet</div>
      <div style="color:#64748b;font-size:0.68rem;">${shortAddr(savedAddr)}</div>
    </div>
    <button onclick="reconnectFromBanner()" style="padding:7px 14px;background:linear-gradient(135deg,#6d28d9,#a855f7);
      border:none;border-radius:8px;color:#fff;font-size:0.75rem;font-weight:700;cursor:pointer;">
      Reconnect
    </button>
    <button onclick="document.getElementById('reconnect-banner')?.remove();clearSession();" 
      style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.9rem;padding:4px;">✕</button>
  `;
  document.body.appendChild(banner);
}

async function reconnectFromBanner(){
  document.getElementById('reconnect-banner')?.remove();
  await connectPhantom();
}

// Run on page load
window.addEventListener('load', () => {
  setTimeout(trySessionReconnect, 500);
});

function openWalletModal(){
  renderWalletModal();
  const o = $id('wallet-modal-overlay');
  if (!o) return;
  o.style.display = 'flex';
  setTimeout(() => o.querySelector('.wallet-modal')?.classList.add('open'), 10);
}
function closeWalletModal(){
  const o = $id('wallet-modal-overlay');
  if (!o) return;
  o.querySelector('.wallet-modal')?.classList.remove('open');
  setTimeout(() => { o.style.display = 'none'; }, 200);
}
function renderWalletModal(){
  const body   = $id('wm-body');
  const footer = $id('wm-footer-msg');
  if (!body) return;
  if (walletConnected && phantomPublicKey){
    body.innerHTML = `
      <div style="text-align:center;padding:24px 0">
        <div style="font-size:3rem;margin-bottom:10px">👻</div>
        <div style="color:var(--muted);font-size:0.75rem;margin-bottom:6px">Connected via Phantom</div>
        <div style="font-family:'Space Mono',monospace;font-size:0.72rem;color:var(--purple);
             background:rgba(168,85,247,0.1);padding:6px 14px;border-radius:8px;
             display:inline-block;margin-bottom:18px">${shortAddr(phantomPublicKey)}</div>
        <div style="font-family:'Space Mono',monospace;font-size:1.6rem;font-weight:700;color:var(--green)">
          ◎ ${walletBalance.toFixed(4)}</div>
        <div style="font-size:0.7rem;color:var(--muted);margin-top:4px">
          $${(walletBalance*SOL_USD).toFixed(2)} USD</div>
      </div>`;
    if (footer) footer.innerHTML = `<span style="color:var(--red);cursor:pointer;font-weight:600;font-size:0.85rem" onclick="disconnectWallet()">⏏ Disconnect wallet</span>`;
  } else {
    body.innerHTML = `
      <div class="wm-wallet-btn" id="wm-phantom-btn" onclick="connectPhantom()"
           style="border-color:rgba(168,85,247,0.6);box-shadow:0 0 20px rgba(168,85,247,0.15)">
        <img src="https://phantom.app/favicon.ico" onerror="this.style.display='none'" style="width:32px;height:32px;border-radius:8px">
        <div class="wm-wallet-info">
          <div class="wm-wallet-name">Phantom</div>
          <div class="wm-wallet-desc" id="phantom-desc">Connect your Phantom wallet</div>
        </div>
        <div class="wm-wallet-arrow">→</div>
      </div>`;
    if (footer) footer.innerHTML = `<a href="https://phantom.app/" target="_blank" style="color:var(--muted);font-size:0.72rem;text-decoration:none">Don't have Phantom? Download here →</a>`;
  }
}
