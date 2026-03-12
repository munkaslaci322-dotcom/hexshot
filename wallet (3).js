// ═══════════════════════════════════════════════
// wallet.js — Phantom connect + real balance
// ═══════════════════════════════════════════════

const HOUSE_WALLET  = '4CfWJ7CtXuewUTAZnku1PtKDuwcVMe5Z374L1wfHXUj2';
const SOLANA_RPC    = 'https://api.mainnet-beta.solana.com';
const BACKUP_RPC    = 'https://rpc.ankr.com/solana';

let walletConnected   = false;
let phantomPublicKey  = null;
let walletBalance     = 0;
let SOL_USD           = 150;
let _balanceTimer     = null;

function $id(id){ return document.getElementById(id); }
function shortAddr(a){ return a ? a.slice(0,4)+'…'+a.slice(-4) : '—'; }

function getPhantom(){
  return window.phantom?.solana
      || (window.solana?.isPhantom ? window.solana : null);
}

// ── SOL price ────────────────────────────────
async function fetchSolPrice(){
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const d = await r.json();
    SOL_USD = d.solana?.usd || 150;
  } catch { SOL_USD = 150; }
  updateWalletDisplay();
}
fetchSolPrice();
setInterval(fetchSolPrice, 60000);

// ── Balance ───────────────────────────────────
async function fetchBalance(pubkeyStr){
  for (const rpc of [BACKUP_RPC, SOLANA_RPC]){
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          jsonrpc:'2.0', id:1,
          method:'getBalance',
          params:[pubkeyStr]
        })
      });
      const d = await r.json();
      if (d.result?.value !== undefined) return d.result.value / 1e9;
    } catch { continue; }
  }
  return 0;
}

// ── Display ───────────────────────────────────
function updateWalletDisplay(){
  const solEl  = $id('wallet-sol');
  const usdEl  = $id('wallet-usd');
  const balBox = $id('sol-balance-display');
  const priceBox = $id('sol-price-display');

  if (solEl)   solEl.textContent  = walletBalance.toFixed(3);
  if (usdEl)   usdEl.textContent  = '$'+(walletBalance*SOL_USD).toFixed(2);
  if (walletConnected){
    if (balBox)   balBox.style.display  = 'flex';
    if (priceBox) priceBox.style.display = 'none';
  }
  if (typeof updateBetUSD === 'function') updateBetUSD();
}

function applyConnectedUI(pubKey){
  const short = shortAddr(pubKey);
  if ($id('btn-connect'))          $id('btn-connect').style.display = 'none';
  if ($id('addr-chip'))            $id('addr-chip').style.display   = 'flex';
  if ($id('addr-text'))            $id('addr-text').textContent     = short;
  if ($id('sol-balance-display'))  $id('sol-balance-display').style.display = 'flex';
  if ($id('sol-price-display'))    $id('sol-price-display').style.display   = 'none';
  if ($id('demo-badge'))           $id('demo-badge').style.display  = 'none';
  if ($id('pp-big-avatar'))        $id('pp-big-avatar').textContent = '👻';
  if ($id('profile-avatar'))       $id('profile-avatar').textContent= '👻';
  if ($id('pp-username'))          $id('pp-username').textContent   = short;
  if ($id('profile-btn-info'))     $id('profile-btn-info').style.display = 'flex';
  updateWalletDisplay();
}

// ── Connect ───────────────────────────────────
async function connectPhantom(){
  const phantom = getPhantom();
  if (!phantom){
    window.open('https://phantom.app/','_blank');
    return;
  }

  const btn  = $id('wm-phantom-btn');
  const desc = $id('phantom-desc');
  if (btn)  btn.style.pointerEvents = 'none';
  if (desc) desc.textContent = '⏳ Waiting for Phantom...';

  try {
    // ALWAYS show popup — never silent auto-connect
    const resp   = await phantom.connect({ onlyIfTrusted: false });
    const pubKey = resp.publicKey.toString();

    if (pubKey === HOUSE_WALLET){
      showToast('❌ Switch to your personal wallet in Phantom!');
      if (desc) desc.textContent = '❌ Wrong account — switch wallet';
      if (btn)  btn.style.pointerEvents = '';
      phantom.disconnect();
      return;
    }

    phantomPublicKey = pubKey;
    walletConnected  = true;
    walletBalance    = await fetchBalance(pubKey);

    closeWalletModal();
    applyConnectedUI(pubKey);
    showToast('✅ Connected! '+walletBalance.toFixed(3)+' SOL');

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
      applyConnectedUI(np);
    });

  } catch(err){
    const msg = err.code === 4001 ? '❌ Rejected' : '❌ '+(err.message||'Connect failed');
    if (desc) desc.textContent = msg;
    if (btn)  btn.style.pointerEvents = '';
    showToast(msg);
  }
}

// ── Disconnect ────────────────────────────────
function disconnectWallet(){
  const phantom = getPhantom();
  phantom?.disconnect?.();
  walletConnected  = false;
  phantomPublicKey = null;
  walletBalance    = 0;
  clearInterval(_balanceTimer);
  if ($id('btn-connect'))         $id('btn-connect').style.display         = '';
  if ($id('addr-chip'))           $id('addr-chip').style.display            = 'none';
  if ($id('sol-balance-display')) $id('sol-balance-display').style.display  = 'none';
  closeWalletModal();
  showToast('Disconnected');
}

// ── Send SOL to house (called by bet.js) ──────
async function sendSolToHouse(lamports){
  const phantom = getPhantom();
  if (!phantom?.publicKey) throw new Error('Wallet not connected');
  if (typeof solanaWeb3 === 'undefined') throw new Error('Solana Web3 not loaded');

  const conn = new solanaWeb3.Connection(SOLANA_RPC, 'confirmed');
  const from = phantom.publicKey;
  const to   = new solanaWeb3.PublicKey(HOUSE_WALLET);

  const tx = new solanaWeb3.Transaction().add(
    solanaWeb3.SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports })
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;

  const { signature } = await phantom.signAndSendTransaction(tx);
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

  walletBalance = await fetchBalance(phantomPublicKey);
  updateWalletDisplay();
  return signature;
}

// ── Wallet modal ──────────────────────────────
function openWalletModal(){
  renderWalletModal();
  const overlay = $id('wallet-modal-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  setTimeout(()=> overlay.querySelector('.wallet-modal')?.classList.add('open'), 10);
}
function closeWalletModal(){
  const overlay = $id('wallet-modal-overlay');
  if (!overlay) return;
  overlay.querySelector('.wallet-modal')?.classList.remove('open');
  setTimeout(()=>{ overlay.style.display = 'none'; }, 200);
}
function renderWalletModal(){
  const body   = $id('wm-body');
  const footer = $id('wm-footer-msg');
  if (!body) return;
  if (walletConnected && phantomPublicKey){
    const short = shortAddr(phantomPublicKey);
    body.innerHTML = `
      <div style="text-align:center;padding:24px 0">
        <div style="font-size:3rem;margin-bottom:10px">👻</div>
        <div style="color:var(--muted);font-size:0.75rem;margin-bottom:6px">Connected via Phantom</div>
        <div style="font-family:'Space Mono',monospace;font-size:0.72rem;color:var(--purple);
             background:rgba(168,85,247,0.1);padding:6px 14px;border-radius:8px;
             display:inline-block;margin-bottom:18px">${short}</div>
        <div style="font-family:'Space Mono',monospace;font-size:1.6rem;font-weight:700;color:var(--green)">
          ◎ ${walletBalance.toFixed(4)}
        </div>
        <div style="font-size:0.7rem;color:var(--muted);margin-top:4px">
          $${(walletBalance*SOL_USD).toFixed(2)} USD
        </div>
      </div>`;
    if (footer) footer.innerHTML =
      `<span style="color:var(--red);cursor:pointer;font-weight:600;font-size:0.85rem"
             onclick="disconnectWallet()">⏏ Disconnect wallet</span>`;
  } else {
    body.innerHTML = `
      <div class="wm-wallet-btn" id="wm-phantom-btn" onclick="connectPhantom()"
           style="border-color:rgba(168,85,247,0.6);box-shadow:0 0 20px rgba(168,85,247,0.15)">
        <img src="https://phantom.app/favicon.ico" class="wm-wallet-icon"
             onerror="this.style.display='none'" style="width:32px;height:32px;border-radius:8px">
        <div class="wm-wallet-info">
          <div class="wm-wallet-name">Phantom</div>
          <div class="wm-wallet-desc" id="phantom-desc">Connect your Phantom wallet</div>
        </div>
        <div class="wm-wallet-arrow">→</div>
      </div>`;
    if (footer) footer.innerHTML =
      `<a href="https://phantom.app/" target="_blank"
          style="color:var(--muted);font-size:0.72rem;text-decoration:none">
         Don't have Phantom? Download here →
       </a>`;
  }
}
