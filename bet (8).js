// bet.js — betting, websocket, game logic, live rooms, auto-refund
const WS_URL = window.location.hostname === 'localhost'
  ? 'ws://localhost:3001'
  : 'wss://hexshot-backend.onrender.com';

const HOUSE_WALLET_BET = '4CfWJ7CtXuewUTAZnku1PtKDuwcVMe5Z374L1wfHXUj2';
const HELIUS_RPC_BET   = 'https://mainnet.helius-rpc.com/?api-key=ad3029b1-970c-4f66-a68d-58301f7c0a3a';

let ws            = null;
let wsReady       = false;
let pendingAction = null;
let myPlayerIdx   = null;
let myRoomId      = null;
let gameActive    = false;
let gameBet       = 0.10;
let myScore       = 0;
let oppScore      = 0;
let gameTimer     = 240;
let timerInterval = null;
let waitingTimer  = null;

// WebSocket
function connectWS(){
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket(WS_URL);
  ws.onopen    = () => {
    wsReady = true;
    console.log('WS connected');
    if (pendingAction){ pendingAction(); pendingAction = null; }
  };
  ws.onmessage = (e) => { try { onServerMsg(JSON.parse(e.data)); } catch {} };
  ws.onclose   = () => {
    wsReady = false;
    setTimeout(connectWS, 2000);
  };
  ws.onerror   = () => { wsReady = false; };
}
function wsSend(d){ if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(d)); }
setInterval(() => {
  if (!wsReady) connectWS();
  else wsSend({type:'ping'});
}, 20000);

// Server messages
function onServerMsg(msg){
  if (msg.type === 'pong') return;

  if (msg.type === 'rooms_list'){
    renderLiveRooms(msg.rooms || []);
    return;
  }

  if (msg.type === 'room_created'){
    myRoomId = msg.roomId;
    setStatus('p1', 'YOU', 'var(--green)');
    setStatus('p2', 'WAITING...', 'var(--yellow)');
    setBtnText('btn-place-bet', '⏳ Room #' + msg.roomId + ' — Waiting...');
    showToast('🎮 Room #' + msg.roomId + ' created!');
    startWaitingTimer(msg.roomId);
    return;
  }

  if (msg.type === 'error'){
    showToast('❌ ' + msg.message);
    resetBetBtn();
    return;
  }

  if (msg.type === 'game_start'){
    clearWaitingTimer();
    myPlayerIdx = (msg.players || []).findIndex(p => p.walletAddress === phantomPublicKey);
    if (myPlayerIdx < 0) myPlayerIdx = 0;
    myRoomId   = msg.roomId;
    gameBet    = msg.bet;
    gameActive = true;
    myScore = oppScore = 0;
    showScreen('game-screen');
    refreshScores();
    startTimer();
    showToast('🎯 Game started!');
    return;
  }

  if (msg.type === 'shot_result'){
    const s = msg.scores || [0, 0];
    myScore  = s[myPlayerIdx] || 0;
    oppScore = s[myPlayerIdx === 0 ? 1 : 0] || 0;
    refreshScores();
    return;
  }

  if (msg.type === 'timer'){
    gameTimer = msg.timeLeft;
    renderTimer();
    return;
  }

  if (msg.type === 'payout_sent'){
    showToast('💰 ' + parseFloat(msg.amount || 0).toFixed(3) + ' SOL sent!', 6000);
    setTimeout(async () => {
      if (phantomPublicKey){ walletBalance = await fetchBalance(phantomPublicKey); updateWalletDisplay(); }
    }, 3000);
    return;
  }

  if (msg.type === 'refunded'){
    clearWaitingTimer();
    showToast('↩️ ' + parseFloat(msg.amount || 0).toFixed(3) + ' SOL refunded — no opponent found', 6000);
    resetBetBtn();
    setStatus('p1', 'WAITING', '');
    setStatus('p2', '—', 'var(--muted)');
    setTimeout(async () => {
      if (phantomPublicKey){ walletBalance = await fetchBalance(phantomPublicKey); updateWalletDisplay(); }
    }, 3000);
    return;
  }

  if (msg.type === 'game_end'){
    gameActive = false;
    clearInterval(timerInterval);
    showResults(msg, msg.winner === myPlayerIdx, msg.winner === null);
    return;
  }
}

// Send SOL
async function sendSolToHouse(lamports){
  const phantom = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
  if (!phantom?.publicKey) throw new Error('Wallet not connected');
  const conn = new solanaWeb3.Connection(HELIUS_RPC_BET, 'confirmed');
  const toPubkey = new solanaWeb3.PublicKey(HOUSE_WALLET_BET);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const transaction = new solanaWeb3.Transaction();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = phantom.publicKey;
  transaction.add(solanaWeb3.SystemProgram.transfer({
    fromPubkey: phantom.publicKey,
    toPubkey,
    lamports
  }));
  const { signature } = await phantom.signAndSendTransaction(transaction);
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  walletBalance = await fetchBalance(phantom.publicKey.toString());
  updateWalletDisplay();
  return signature;
}

// Live rooms
function renderLiveRooms(rooms){
  const container = document.getElementById('live-rooms-list');
  if (!container) return;
  const countEl = document.getElementById('rooms-count');
  if (countEl) countEl.textContent = rooms.length;
  if (rooms.length === 0){
    container.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--muted)">
        <div style="font-size:2.5rem;margin-bottom:12px">🎮</div>
        <div style="font-size:0.85rem;font-weight:600;margin-bottom:6px;color:var(--text)">No open rooms yet</div>
        <div style="font-size:0.72rem">Create a room and wait for an opponent!</div>
      </div>`;
    return;
  }
  container.innerHTML = rooms.map(r => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;
         background:rgba(20,20,40,0.8);border:1px solid var(--border);border-radius:12px;
         margin-bottom:8px;transition:all 0.2s;cursor:pointer;"
         onmouseover="this.style.borderColor='rgba(168,85,247,0.5)';this.style.background='rgba(30,30,60,0.9)'"
         onmouseout="this.style.borderColor='var(--border)';this.style.background='rgba(20,20,40,0.8)'">
      <div style="width:40px;height:40px;border-radius:10px;background:rgba(168,85,247,0.15);
           border:1px solid rgba(168,85,247,0.3);
           display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">🎮</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.82rem;font-weight:700;color:#fff;margin-bottom:2px">Room #${r.roomId}</div>
        <div style="font-size:0.68rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${shortAddr(r.walletAddress || '???')}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:'Space Mono',monospace;font-size:0.88rem;font-weight:700;color:var(--yellow);margin-bottom:6px">
          ◎ ${parseFloat(r.bet || 0).toFixed(3)}
        </div>
        <button onclick="joinSpecificRoom('${r.roomId}', ${parseFloat(r.bet||0)})"
          style="padding:6px 16px;background:linear-gradient(135deg,#6d28d9,#a855f7);
          border:none;border-radius:8px;color:#fff;font-size:0.72rem;font-weight:700;
          cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(168,85,247,0.3);"
          onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 16px rgba(168,85,247,0.5)'"
          onmouseout="this.style.transform='none';this.style.boxShadow='0 2px 8px rgba(168,85,247,0.3)'">
          Join →
        </button>
      </div>
    </div>`).join('');
}

async function joinSpecificRoom(roomId, bet){
  if (!walletConnected){ openWalletModal(); return; }
  if (bet > walletBalance){ showToast('❌ Not enough SOL! Need ◎' + bet.toFixed(3)); return; }
  gameBet = bet;
  showToast('👻 Approve in Phantom...');
  try {
    const sig = await sendSolToHouse(Math.round(bet * 1e9));
    showToast('✅ Joining room #' + roomId + '...');
    connectWS();
    const go = () => wsSend({type:'join_room', roomId, walletAddress: phantomPublicKey, txSig: sig});
    if (wsReady) go(); else pendingAction = go;
  } catch(err){
    showToast(err.code === 4001 ? '❌ Rejected' : '❌ ' + (err.message || 'Failed'));
  }
}

function startRoomPolling(){
  const req = () => { if (wsReady) wsSend({type:'get_rooms'}); };
  req();
  setInterval(req, 4000);
}

// Auto-refund timer
function startWaitingTimer(roomId){
  clearWaitingTimer();
  let secondsLeft = 300;
  const el = document.getElementById('waiting-countdown');
  waitingTimer = setInterval(() => {
    secondsLeft--;
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    if (el) el.textContent = '⏱ Auto-cancel in ' + m + ':' + (s < 10 ? '0' : '') + s;
    if (secondsLeft <= 0){
      clearWaitingTimer();
      wsSend({type:'cancel_room', roomId, walletAddress: phantomPublicKey});
      showToast('⏰ No opponent — requesting refund...', 5000);
    }
  }, 1000);
}
function clearWaitingTimer(){
  if (waitingTimer){ clearInterval(waitingTimer); waitingTimer = null; }
  const el = document.getElementById('waiting-countdown');
  if (el) el.textContent = '';
}

// Screens
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

// Bet UI
function updateBetUSD(){
  const val = parseFloat(document.getElementById('bet-amount')?.value) || 0;
  gameBet = val;
  const usd = (val * (typeof SOL_USD !== 'undefined' ? SOL_USD : 150)).toFixed(2);
  const v = document.getElementById('bet-usd-val');
  const l = document.getElementById('bet-usd-label');
  if (v) v.textContent = '≈ $' + usd;
  if (l) l.textContent = '($' + usd + ')';
}
function setBet(val, mode){
  const inp = document.getElementById('bet-amount');
  if (!inp) return;
  if (mode === 'x2')  inp.value = Math.min(10, parseFloat(inp.value) * 2).toFixed(2);
  else if (mode === 'max') inp.value = Math.min(10, walletBalance).toFixed(2);
  else inp.value = Math.max(0.01, parseFloat(inp.value) * val).toFixed(2);
  updateBetUSD();
}
function resetBetBtn(){
  const btn = document.getElementById('btn-place-bet');
  if (btn){ btn.disabled = false; btn.textContent = '🎮 Create Room & Bet'; }
}
function setBtnText(id, text){ const b = document.getElementById(id); if (b) b.textContent = text; }
function setStatus(player, text, color){
  const el = document.getElementById(player + '-status');
  if (el){ el.textContent = text; el.style.color = color; }
}

// Place bet
async function placeBet(){
  const bet = parseFloat(document.getElementById('bet-amount')?.value) || 0;
  if (bet < 0.01){ showToast('❌ Minimum bet is 0.01 SOL'); return; }
  if (!walletConnected){ openWalletModal(); return; }
  if (bet > walletBalance){ showToast('❌ Not enough SOL! Balance: ' + walletBalance.toFixed(3)); return; }
  gameBet = bet;
  const lamports = Math.round(bet * 1e9);
  const roomId   = String(Math.floor(1000 + Math.random() * 9000));
  const btn      = document.getElementById('btn-place-bet');
  if (btn){ btn.disabled = true; btn.textContent = '⏳ Confirm in Phantom...'; }
  try {
    showToast('👻 Approve in Phantom...');
    const sig = await sendSolToHouse(lamports);
    showToast('✅ ' + bet.toFixed(3) + ' SOL sent! Waiting for opponent...');
    connectWS();
    const go = () => wsSend({type:'create_room', bet, walletAddress: phantomPublicKey, roomId, txSig: sig});
    if (wsReady) go(); else pendingAction = go;
  } catch(err){
    showToast(err.code === 4001 ? '❌ Rejected' : '❌ ' + (err.message || 'Transaction failed'));
    resetBetBtn();
  }
}

// Join room with code
async function showJoinModal(){
  const code = prompt('Enter Room Code:');
  if (!code) return;
  const bet = parseFloat(document.getElementById('bet-amount')?.value) || gameBet;
  await joinSpecificRoom(code.trim(), bet);
}

// Timer
function startTimer(){
  gameTimer = 240; clearInterval(timerInterval);
  timerInterval = setInterval(() => { gameTimer--; renderTimer(); if (gameTimer <= 0) clearInterval(timerInterval); }, 1000);
}
function renderTimer(){
  const el = document.getElementById('timer-display');
  if (!el) return;
  const m = Math.floor(gameTimer / 60), s = gameTimer % 60;
  el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  el.style.color = gameTimer < 30 ? 'var(--red)' : '';
}

// Scores
function refreshScores(){
  const p1 = document.getElementById('score-p1');
  const p2 = document.getElementById('score-p2');
  if (p1) p1.textContent = myScore;
  if (p2) p2.textContent = oppScore;
}

// Results
function showResults(msg, won, isDraw){
  showScreen('results-screen');
  const tag    = document.getElementById('rc-tag');
  const trophy = document.getElementById('rc-trophy');
  const winner = document.getElementById('rc-winner');
  const reason = document.getElementById('rc-reason');
  if (isDraw){
    if (tag)    { tag.textContent = 'DRAW'; tag.style.background = 'rgba(100,116,139,0.2)'; tag.style.color = '#94a3b8'; }
    if (trophy) trophy.textContent = '🤝';
    if (winner) winner.textContent = 'Draw!';
    if (reason) reason.textContent = 'Both bets refunded';
    showToast('🤝 Draw! Refunded.', 5000);
  } else if (won){
    if (tag)    { tag.textContent = 'WINNER'; tag.style.background = 'rgba(34,197,94,0.2)'; tag.style.color = '#22c55e'; }
    if (trophy) trophy.textContent = '🏆';
    if (winner) winner.textContent = 'You Won!';
    if (reason) reason.textContent = '+' + parseFloat(msg.payout || 0).toFixed(3) + ' SOL incoming!';
    showToast('🏆 You won ' + parseFloat(msg.payout || 0).toFixed(3) + ' SOL!', 7000);
  } else {
    if (tag)    { tag.textContent = 'DEFEAT'; tag.style.background = 'rgba(239,68,68,0.2)'; tag.style.color = '#ef4444'; }
    if (trophy) trophy.textContent = '💸';
    if (winner) winner.textContent = 'You Lost';
    if (reason) reason.textContent = '-' + gameBet.toFixed(3) + ' SOL';
    showToast('💸 Better luck next time!', 4000);
  }
  const fp1 = document.getElementById('final-p1'); if (fp1) fp1.textContent = myScore;
  const fp2 = document.getElementById('final-p2'); if (fp2) fp2.textContent = oppScore;
  setTimeout(() => { resetBetBtn(); setStatus('p1','Player 1',''); setStatus('p2','Player 2',''); }, 100);
}
function playAgain(){ showScreen('lobby'); }

// Chat
const FAKE_USERS  = ['kosher','NOVASOL','CYCLOPS','BCH','cryptobro','SolKing','BubbleGod','hexmaster'];
const FAKE_MSGS   = ['Give 500x','good luck!','lets gooo 🎮','gg','who wants to play?','nice shot!','my bubbles my rules','cant stop 🔥','bet it all','I\'m on a streak'];
const FAKE_COLORS = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#06b6d4','#f43f5e'];

function addChatMsg(user, text, color){
  const list = document.getElementById('global-messages');
  if (!list) return;
  const d = document.createElement('div');
  d.className = 'chat-msg';
  d.innerHTML = `<div class="chat-avatar" style="background:${color}">${user.slice(0,2).toUpperCase()}</div><div class="chat-msg-body"><div class="chat-msg-name" style="color:${color}">${user}</div><div class="chat-msg-text">${text}</div></div>`;
  list.appendChild(d);
  list.scrollTop = list.scrollHeight;
  while (list.children.length > 60) list.removeChild(list.firstChild);
}

function sendGlobalMsg(){
  const inp = document.getElementById('global-input');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  const user = phantomPublicKey ? shortAddr(phantomPublicKey) : 'Guest';
  addChatMsg(user, text, '#a855f7');
  inp.value = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'global-input') sendGlobalMsg();
});

function initChat(){
  const onlineEl = document.getElementById('online-count');
  if (onlineEl) onlineEl.textContent = (Math.floor(200 + Math.random() * 150)) + ' online';
  for (let i = 0; i < 6; i++) setTimeout(() => {
    addChatMsg(
      FAKE_USERS[Math.floor(Math.random() * FAKE_USERS.length)],
      FAKE_MSGS[Math.floor(Math.random() * FAKE_MSGS.length)],
      FAKE_COLORS[Math.floor(Math.random() * FAKE_COLORS.length)]
    );
  }, i * 500);
  setInterval(() => {
    addChatMsg(
      FAKE_USERS[Math.floor(Math.random() * FAKE_USERS.length)],
      FAKE_MSGS[Math.floor(Math.random() * FAKE_MSGS.length)],
      FAKE_COLORS[Math.floor(Math.random() * FAKE_COLORS.length)]
    );
  }, 3000 + Math.random() * 3000);
}

// Toast
function showToast(msg, dur = 3000){
  let c = document.getElementById('toast-container');
  if (!c){
    c = document.createElement('div');
    c.id = 'toast-container';
    c.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none';
    document.body.appendChild(c);
  }
  const t = document.createElement('div');
  t.style.cssText = 'background:#13131f;border:1px solid rgba(168,85,247,0.35);color:#e2e8f0;padding:12px 18px;border-radius:10px;font-size:0.85rem;max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.5);animation:toastIn 0.25s ease';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.cssText += ';opacity:0;transition:opacity 0.3s'; setTimeout(() => t.remove(), 300); }, dur);
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  connectWS(); // connect immediately on page load
  // Pre-warm: ha Render sleep módban van, várunk a connectre
  setTimeout(() => {
    if (!wsReady) {
      showToast('⏳ Connecting to server...');
      connectWS();
    }
  }, 3000);
  initChat();
  updateBetUSD();
  const betInput = document.getElementById('bet-amount');
  if (betInput) betInput.addEventListener('input', updateBetUSD);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('lobby')?.classList.add('active');
  const style = document.createElement('style');
  style.textContent = '@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(style);
  setTimeout(startRoomPolling, 1500);
});

// ═══════════════════════════════════════════════
// BUBBLE SHOOTER GAME ENGINE
// ═══════════════════════════════════════════════

const COLORS = ['#ef4444','#22d3ee','#4ade80','#fbbf24','#a855f7','#fb923c'];
const ROWS = 8, COLS = 10;
const R = 22; // bubble radius
let grid = [];
let currentBubble = null;
let nextColor = null;
let angle = 90;
let shooting = false;
let bulletX, bulletY, bulletDX, bulletDY;
let bulletColor = '';
let animFrame = null;
let gameStarted = false;

function initGame(){
  const canvas = document.getElementById('canvas');
  if (!canvas) return;
  canvas.width  = 440;
  canvas.height = 520;

  // Build grid
  grid = [];
  for (let r = 0; r < ROWS; r++){
    grid[r] = [];
    for (let c = 0; c < COLS; c++){
      if (r < 5){
        grid[r][c] = COLORS[Math.floor(Math.random() * COLORS.length)];
      } else {
        grid[r][c] = null;
      }
    }
  }

  nextColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  spawnBubble();
  gameStarted = true;

  canvas.onmousemove = (e) => {
    if (!gameStarted) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cx = canvas.width / 2;
    const cy = canvas.height - 40;
    const dx = mx - cx, dy = my - cy;
    angle = Math.atan2(-dy, dx) * 180 / Math.PI;
    angle = Math.max(10, Math.min(170, angle));
  };

  canvas.onclick = () => {
    if (!gameStarted || shooting) return;
    shoot();
  };

  if (animFrame) cancelAnimationFrame(animFrame);
  gameLoop();
}

function spawnBubble(){
  currentBubble = nextColor || COLORS[Math.floor(Math.random() * COLORS.length)];
  nextColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  updateNextDisplay();
}

function updateNextDisplay(){
  const c1 = document.getElementById('next-p1');
  const c2 = document.getElementById('next-p2');
  [c1, c2].forEach(c => {
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 34, 34);
    ctx.beginPath();
    ctx.arc(17, 17, 14, 0, Math.PI * 2);
    ctx.fillStyle = nextColor || '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function shoot(){
  if (shooting) return;
  shooting = true;
  const canvas = document.getElementById('canvas');
  const cx = canvas.width / 2;
  const cy = canvas.height - 40;
  bulletX = cx;
  bulletY = cy;
  const rad = angle * Math.PI / 180;
  const speed = 12;
  bulletDX = Math.cos(rad) * speed;
  bulletDY = -Math.sin(rad) * speed;
  bulletColor = currentBubble;
}

function cellToXY(r, c){
  const offsetX = (r % 2 === 1) ? R : 0;
  const x = R + c * R * 2 + offsetX;
  const y = R + r * R * 1.73;
  return { x, y };
}

function xyToCell(x, y){
  const r = Math.round((y - R) / (R * 1.73));
  const offsetX = (r % 2 === 1) ? R : 0;
  const c = Math.round((x - R - offsetX) / (R * 2));
  return { r: Math.max(0, Math.min(ROWS-1, r)), c: Math.max(0, Math.min(COLS-1, c)) };
}

function getNeighbors(r, c){
  const odd = r % 2 === 1;
  return [
    [r-1, odd ? c : c-1], [r-1, odd ? c+1 : c],
    [r, c-1], [r, c+1],
    [r+1, odd ? c : c-1], [r+1, odd ? c+1 : c],
  ].filter(([rr,cc]) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS);
}

function findGroup(r, c, color){
  const visited = new Set();
  const queue = [[r, c]];
  visited.add(r+','+c);
  while (queue.length){
    const [cr, cc] = queue.shift();
    for (const [nr, nc] of getNeighbors(cr, cc)){
      const key = nr+','+nc;
      if (!visited.has(key) && grid[nr][nc] === color){
        visited.add(key);
        queue.push([nr, nc]);
      }
    }
  }
  return [...visited].map(k => k.split(',').map(Number));
}

function findFloating(){
  const connected = new Set();
  // BFS from top row
  const queue = [];
  for (let c = 0; c < COLS; c++){
    if (grid[0][c]){
      queue.push([0, c]);
      connected.add('0,'+c);
    }
  }
  while (queue.length){
    const [r, c] = queue.shift();
    for (const [nr, nc] of getNeighbors(r, c)){
      const key = nr+','+nc;
      if (!connected.has(key) && grid[nr][nc]){
        connected.add(key);
        queue.push([nr, nc]);
      }
    }
  }
  const floating = [];
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < COLS; c++){
      if (grid[r][c] && !connected.has(r+','+c)){
        floating.push([r, c]);
      }
    }
  }
  return floating;
}

function placeBubbleAt(r, c){
  grid[r][c] = bulletColor;
  const group = findGroup(r, c, bulletColor);
  let points = 0;
  if (group.length >= 2){
    group.forEach(([gr, gc]) => { grid[gr][gc] = null; });
    points += group.length;
  }
  const floating = findFloating();
  if (floating.length > 0){
    floating.forEach(([fr, fc]) => { grid[fr][fc] = null; });
    points += floating.length;
  }
  if (points > 0){
    myScore += points;
    refreshScores();
    wsSend({ type: 'shot', points, roomId: myRoomId });
    const msg = document.getElementById('msg');
    if (msg){ msg.textContent = '+' + points + ' pts!'; setTimeout(() => { if(msg) msg.textContent = ''; }, 1200); }
  }
  shooting = false;
  spawnBubble();
  checkWin();
}

function checkWin(){
  let remaining = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c]) remaining++;
  if (remaining === 0){
    const msg = document.getElementById('msg');
    if (msg) msg.textContent = '🎉 Grid cleared!';
    wsSend({ type: 'game_over', roomId: myRoomId });
  }
}

function gameLoop(){
  const canvas = document.getElementById('canvas');
  if (!canvas){ gameStarted = false; return; }
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid pattern
  ctx.strokeStyle = 'rgba(168,85,247,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 40){
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40){
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // Draw grid bubbles
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < COLS; c++){
      if (!grid[r][c]) continue;
      const { x, y } = cellToXY(r, c);
      drawBubble(ctx, x, y, R - 1, grid[r][c]);
    }
  }

  // Draw shooter
  const cx = canvas.width / 2;
  const cy = canvas.height - 40;
  drawBubble(ctx, cx, cy, R, currentBubble || '#fff');

  // Aim line
  const rad = angle * Math.PI / 180;
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(rad) * 100, cy - Math.sin(rad) * 100);
  ctx.stroke();
  ctx.setLineDash([]);

  // Moving bullet
  if (shooting){
    bulletX += bulletDX;
    bulletY += bulletDY;

    // Wall bounce
    if (bulletX - R < 0){ bulletX = R; bulletDX = Math.abs(bulletDX); }
    if (bulletX + R > canvas.width){ bulletX = canvas.width - R; bulletDX = -Math.abs(bulletDX); }

    drawBubble(ctx, bulletX, bulletY, R, bulletColor);

    // Check collision with grid
    let hit = false;
    if (bulletY - R <= R){ hit = true; }
    else {
      for (let r = 0; r < ROWS; r++){
        for (let c = 0; c < COLS; c++){
          if (!grid[r][c]) continue;
          const { x, y } = cellToXY(r, c);
          const dx = bulletX - x, dy = bulletY - y;
          if (Math.sqrt(dx*dx + dy*dy) < R * 1.8){ hit = true; break; }
        }
        if (hit) break;
      }
    }

    if (hit){
      const cell = xyToCell(bulletX, bulletY);
      // Find nearest empty cell
      let placed = false;
      const candidates = [[cell.r, cell.c]];
      for (const [nr, nc] of getNeighbors(cell.r, cell.c)) candidates.push([nr, nc]);
      for (const [tr, tc] of candidates){
        if (tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS && !grid[tr][tc]){
          placeBubbleAt(tr, tc);
          placed = true;
          break;
        }
      }
      if (!placed){ shooting = false; spawnBubble(); }
    }
  }

  if (gameStarted) animFrame = requestAnimationFrame(gameLoop);
}

function drawBubble(ctx, x, y, r, color){
  // Shadow
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;
  // Shine
  const grad = ctx.createRadialGradient(x - r*0.3, y - r*0.3, r*0.1, x, y, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Hook into game_start
const _origOnServerMsg = onServerMsg;
function onServerMsg(msg){
  _origOnServerMsg(msg);
  if (msg.type === 'game_start'){
    setTimeout(() => { initGame(); }, 300);
  }
}

// Lobby/rematch buttons
function goLobby(){
  gameStarted = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  showScreen('lobby');
  resetBetBtn();
  setStatus('p1','WAITING','');
  setStatus('p2','—','var(--muted)');
}

function rematch(){
  gameStarted = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  showScreen('lobby');
  resetBetBtn();
}
