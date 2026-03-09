// ══════════════════════════════════════
// wallet.js — Phantom connect + balance
// ══════════════════════════════════════

const HOUSE_WALLET_ADDRESS = '4CfWJ7CtXuewUTAZnku1PtKDuwcVMe5Z374L1wfHXUj2';
const SOLANA_RPC_ENDPOINTS = [
  'https://rpc.ankr.com/solana',
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
];

let walletConnected = false;
let phantomPublicKey = null;
let walletBalance = 0;
let SOL_USD = 0;
let _balanceTimer = null;

// ── Get Phantom provider ──
function getPhantom() {
  return window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
}

// ── Fetch SOL/USD price ──
async function fetchSolPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await res.json();
    SOL_USD = data.solana.usd;
  } catch {
    SOL_USD = 150;
  }
}

// ── Fetch real on-chain balance ──
async function fetchBalance(pubkeyStr) {
  for (const rpc of SOLANA_RPC_ENDPOINTS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getBalance',
          params: [pubkeyStr]
        })
      });
      const data = await res.json();
      if (data.result?.value !== undefined) {
        return data.result.value / 1e9;
      }
    } catch { continue; }
  }
  return 0;
}

// ── Update navbar display ──
function updateWalletDisplay() {
  const solEl = document.getElementById('wallet-sol');
  const usdEl = document.getElementById('wallet-usd');
  const balDisplay = document.getElementById('sol-balance-display');
  if (solEl) solEl.textContent = walletBalance.toFixed(3);
  if (usdEl) usdEl.textContent = SOL_USD > 0 ? `$${(walletBalance * SOL_USD).toFixed(2)}` : '$—';
  if (balDisplay) balDisplay.style.display = 'flex';
  // Update bet USD
  updateBetUSD();
}

// ── Connect Phantom ──
async function connectPhantom() {
  const phantom = getPhantom();
  if (!phantom) {
    window.open('https://phantom.app/', '_blank');
    return;
  }

  const btn = document.getElementById('wm-phantom-btn');
  const desc = document.getElementById('phantom-desc');
  if (btn) btn.style.pointerEvents = 'none';
  if (desc) desc.textContent = '⏳ Waiting for Phantom...';

  try {
    const resp = await phantom.connect({ onlyIfTrusted: false });
    const pubKey = resp.publicKey.toString();

    phantomPublicKey = pubKey;
    walletConnected = true;

    // Fetch balance immediately
    walletBalance = await fetchBalance(pubKey);

    // Apply UI
    closeWalletModal();
    applyConnectedUI(pubKey, 'phantom');
    updateWalletDisplay();
    showToast('✅ Connected! Balance: ' + walletBalance.toFixed(3) + ' SOL');

    // Auto-refresh every 15s
    clearInterval(_balanceTimer);
    _balanceTimer = setInterval(async () => {
      walletBalance = await fetchBalance(pubKey);
      updateWalletDisplay();
    }, 15000);

    // Listen for account change
    phantom.on('accountChanged', async (newPubKey) => {
      if (newPubKey) {
        phantomPublicKey = newPubKey.toString();
        walletBalance = await fetchBalance(phantomPublicKey);
        applyConnectedUI(phantomPublicKey, 'phantom');
        updateWalletDisplay();
      }
    });

  } catch (err) {
    const msg = err.code === 4001 ? '❌ Rejected' : '❌ ' + (err.message || 'Connect failed');
    if (desc) desc.textContent = msg;
    if (btn) btn.style.pointerEvents = '';
    showToast(msg);
  }
}

// ── Disconnect ──
function disconnectWallet() {
  const phantom = getPhantom();
  if (phantom) phantom.disconnect();
  walletConnected = false;
  phantomPublicKey = null;
  walletBalance = 0;
  clearInterval(_balanceTimer);

  document.getElementById('btn-connect').style.display = '';
  document.getElementById('addr-chip').style.display = 'none';
  document.getElementById('sol-balance-display').style.display = 'none';
  closeWalletModal();
  showToast('Disconnected');
}

// ── Auto-connect if already approved ──
async function tryAutoConnect() {
  const phantom = getPhantom();
  if (!phantom) return;
  try {
    const resp = await phantom.connect({ onlyIfTrusted: true });
    const pubKey = resp.publicKey.toString();
    phantomPublicKey = pubKey;
    walletConnected = true;
    walletBalance = await fetchBalance(pubKey);
    applyConnectedUI(pubKey, 'phantom');
    updateWalletDisplay();
    clearInterval(_balanceTimer);
    _balanceTimer = setInterval(async () => {
      walletBalance = await fetchBalance(pubKey);
      updateWalletDisplay();
    }, 15000);
  } catch { /* not trusted yet, do nothing */ }
}

// ── Send SOL to house wallet (betting) ──
async function sendSolToHouse(lamports) {
  const phantom = getPhantom();
  if (!phantom?.publicKey) throw new Error('Wallet not connected');
  if (typeof solanaWeb3 === 'undefined') throw new Error('Solana Web3 not loaded');

  const conn = new solanaWeb3.Connection(SOLANA_RPC_ENDPOINTS[0], 'confirmed');
  const from = phantom.publicKey;
  const to = new solanaWeb3.PublicKey(HOUSE_WALLET_ADDRESS);

  const tx = new solanaWeb3.Transaction().add(
    solanaWeb3.SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports })
  );

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;

  const { signature } = await phantom.signAndSendTransaction(tx);
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

  // Refresh balance after send
  walletBalance = await fetchBalance(phantomPublicKey);
  updateWalletDisplay();

  return signature;
}

// Init
fetchSolPrice();
setTimeout(tryAutoConnect, 500);
