// ═══════════════════════════════════════════════════════
// HEXSHOT GAME ENGINE — Turn-based, cannon, 6s timer
// ═══════════════════════════════════════════════════════

const BUBBLE_COLORS = ['#ef4444','#22d3ee','#4ade80','#fbbf24','#a855f7','#fb923c'];
const GRID_ROWS = 8, GRID_COLS = 10, BR = 22;
const BULLET_SPEED = 7; // slower bullets
const TURN_SECONDS = 6;

let grid = [], currentColor = null, nextBubbleColor = null;
let aimAngle = 90, isShooting = false;
let bx, by, bdx, bdy, bColor;
let rafId = null, gameRunning = false;
let isMyTurn = false;
let turnTimeLeft = TURN_SECONDS;
let turnTimerInterval = null;
let cannonAngle = 90; // visual cannon angle

function initGame() {
  const canvas = document.getElementById('canvas');
  if (!canvas) return;
  canvas.width = 440;
  canvas.height = 540;

  // Build grid
  grid = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    grid[r] = [];
    for (let c = 0; c < GRID_COLS; c++)
      grid[r][c] = r < 5 ? BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)] : null;
  }

  nextBubbleColor = BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)];
  spawnNext();
  gameRunning = true;
  isShooting = false;

  canvas.onmousemove = (e) => {
    if (!gameRunning) return;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
    const cx = canvas.width / 2, cy = canvas.height - 60;
    const dx = mx - cx, dy = my - cy;
    aimAngle = Math.atan2(-dy, dx) * 180 / Math.PI;
    aimAngle = Math.max(10, Math.min(170, aimAngle));
    cannonAngle = aimAngle;
  };

  canvas.onclick = () => {
    if (!gameRunning || !isMyTurn || isShooting) return;
    fireBubble();
  };

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(gameLoop);
  updateNextPreview();

  const msgEl = document.getElementById('msg');
  if (msgEl) msgEl.textContent = '';
}

function setMyTurn(isTurn) {
  isMyTurn = isTurn;
  clearInterval(turnTimerInterval);
  turnTimeLeft = TURN_SECONDS;

  const canvas = document.getElementById('canvas');
  const msgEl = document.getElementById('msg');

  if (isTurn) {
    if (msgEl) msgEl.textContent = '🎯 Your turn! 6s';
    if (canvas) canvas.style.cursor = 'crosshair';
    // Start 6s countdown
    turnTimerInterval = setInterval(() => {
      turnTimeLeft--;
      if (msgEl) msgEl.textContent = '🎯 Your turn! ' + turnTimeLeft + 's';
      if (turnTimeLeft <= 0) {
        clearInterval(turnTimerInterval);
        // Auto-fire if time runs out
        if (!isShooting) {
          fireBubble();
        }
      }
    }, 1000);
  } else {
    if (msgEl) msgEl.textContent = "⏳ Opponent's turn...";
    if (canvas) canvas.style.cursor = 'default';
  }
}

function spawnNext() {
  currentColor = nextBubbleColor;
  nextBubbleColor = BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)];
  updateNextPreview();
}

function updateNextPreview() {
  ['next-p1', 'next-p2'].forEach(id => {
    const c = document.getElementById(id);
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 34, 34);
    drawBubbleOnCtx(ctx, 17, 17, 13, nextBubbleColor || '#888');
  });
}

function fireBubble() {
  if (isShooting || !currentColor) return;
  clearInterval(turnTimerInterval);
  isShooting = true;
  isMyTurn = false;
  const canvas = document.getElementById('canvas');
  bx = canvas.width / 2;
  by = canvas.height - 60;
  const rad = aimAngle * Math.PI / 180;
  bdx = Math.cos(rad) * BULLET_SPEED;
  bdy = -Math.sin(rad) * BULLET_SPEED;
  bColor = currentColor;
  const msgEl = document.getElementById('msg');
  if (msgEl) msgEl.textContent = '';
}

function cellXY(r, c) {
  const ox = (r % 2 === 1) ? BR : 0;
  return { x: BR + c * BR * 2 + ox, y: BR + r * BR * 1.732 };
}

function xyCell(x, y) {
  const r = Math.round((y - BR) / (BR * 1.732));
  const ox = (r % 2 === 1) ? BR : 0;
  const c = Math.round((x - BR - ox) / (BR * 2));
  return {
    r: Math.max(0, Math.min(GRID_ROWS - 1, r)),
    c: Math.max(0, Math.min(GRID_COLS - 1, c))
  };
}

function nbrs(r, c) {
  const odd = r % 2 === 1;
  return [
    [r-1, odd?c:c-1],[r-1, odd?c+1:c],
    [r, c-1],[r, c+1],
    [r+1, odd?c:c-1],[r+1, odd?c+1:c]
  ].filter(([rr,cc]) => rr>=0 && rr<GRID_ROWS && cc>=0 && cc<GRID_COLS);
}

function floodGroup(r, c, color) {
  const seen = new Set(), q = [[r, c]];
  seen.add(r + ',' + c);
  while (q.length) {
    const [cr, cc] = q.shift();
    for (const [nr, nc] of nbrs(cr, cc)) {
      const k = nr + ',' + nc;
      if (!seen.has(k) && grid[nr][nc] === color) { seen.add(k); q.push([nr, nc]); }
    }
  }
  return [...seen].map(k => k.split(',').map(Number));
}

function floaters() {
  const conn = new Set(), q = [];
  for (let c = 0; c < GRID_COLS; c++) if (grid[0][c]) { q.push([0,c]); conn.add('0,'+c); }
  while (q.length) {
    const [r, c] = q.shift();
    for (const [nr, nc] of nbrs(r, c)) {
      const k = nr+','+nc;
      if (!conn.has(k) && grid[nr][nc]) { conn.add(k); q.push([nr,nc]); }
    }
  }
  const fl = [];
  for (let r=0; r<GRID_ROWS; r++) for (let c=0; c<GRID_COLS; c++)
    if (grid[r][c] && !conn.has(r+','+c)) fl.push([r,c]);
  return fl;
}

function placeBubble(r, c) {
  grid[r][c] = bColor;
  const group = floodGroup(r, c, bColor);
  let pts = 0;
  if (group.length >= 2) { group.forEach(([gr,gc]) => { grid[gr][gc] = null; }); pts += group.length; }
  const fl = floaters();
  fl.forEach(([fr,fc]) => { grid[fr][fc] = null; }); pts += fl.length;

  if (pts > 0) {
    myScore += pts;
    refreshScores();
    if (typeof wsSend === 'function') wsSend({ type:'shot', points:pts, roomId:myRoomId });
    const msgEl = document.getElementById('msg');
    if (msgEl) { msgEl.textContent = '+' + pts + ' pts!'; setTimeout(() => { if(msgEl && isMyTurn) msgEl.textContent = ''; }, 800); }
  }

  isShooting = false;
  spawnNext();

  // Notify server turn is done
  if (typeof wsSend === 'function') wsSend({ type:'turn_done', roomId:myRoomId });

  // Check grid cleared
  let rem = 0;
  for (let r=0; r<GRID_ROWS; r++) for (let c=0; c<GRID_COLS; c++) if (grid[r][c]) rem++;
  if (rem === 0) {
    if (typeof wsSend === 'function') wsSend({ type:'game_over', roomId:myRoomId });
  }
}

function drawBubbleOnCtx(ctx, x, y, r, color) {
  ctx.shadowColor = color; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = color; ctx.fill(); ctx.shadowBlur = 0;
  const g = ctx.createRadialGradient(x-r*0.3, y-r*0.35, r*0.05, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
}

function drawCannon(ctx, cx, cy, angle) {
  const rad = angle * Math.PI / 180;
  const len = 36, w = 10;
  const ex = cx + Math.cos(rad) * len;
  const ey = cy - Math.sin(rad) * len;

  // Cannon barrel
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-rad);
  ctx.fillStyle = '#7c3aed';
  ctx.shadowColor = '#a855f7';
  ctx.shadowBlur = 12;
  ctx.fillRect(0, -w/2, len, w);
  ctx.shadowBlur = 0;
  // Barrel highlight
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(0, -w/2, len, w/3);
  ctx.restore();

  // Cannon base circle
  ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI*2);
  ctx.fillStyle = '#4c1d95';
  ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 15;
  ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(168,85,247,0.6)'; ctx.lineWidth = 2; ctx.stroke();
}

function gameLoop() {
  const canvas = document.getElementById('canvas');
  if (!canvas || !gameRunning) { rafId = null; return; }
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid dots
  ctx.fillStyle = 'rgba(168,85,247,0.04)';
  for (let x=0; x<canvas.width; x+=40) for (let y=0; y<canvas.height; y+=40) {
    ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI*2); ctx.fill();
  }

  // Grid bubbles
  for (let r=0; r<GRID_ROWS; r++) for (let c=0; c<GRID_COLS; c++) {
    if (!grid[r][c]) continue;
    const {x,y} = cellXY(r, c);
    drawBubbleOnCtx(ctx, x, y, BR-1, grid[r][c]);
  }

  const cx = canvas.width / 2, cy = canvas.height - 60;

  // Aim line (only on my turn)
  if (isMyTurn && !isShooting) {
    const rad = aimAngle * Math.PI / 180;
    ctx.save();
    ctx.setLineDash([5, 9]);
    ctx.strokeStyle = 'rgba(168,85,247,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    // Wall bounce preview
    let px=cx, py=cy, pdx=Math.cos(rad), pdy=-Math.sin(rad);
    for (let seg=0; seg<4; seg++) {
      const steps = 180;
      const nx = px + pdx*steps, ny = py + pdy*steps;
      if (nx < BR) { const t=(px-BR)/(-pdx); ctx.lineTo(px+pdx*t,py+pdy*t); px=BR; pdx=-pdx; py+=pdy*t; }
      else if (nx > canvas.width-BR) { const t=(canvas.width-BR-px)/pdx; ctx.lineTo(px+pdx*t,py+pdy*t); px=canvas.width-BR; pdx=-pdx; py+=pdy*t; }
      else { ctx.lineTo(nx,ny); break; }
    }
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
  }

  // Cannon
  drawCannon(ctx, cx, cy, isMyTurn ? cannonAngle : 90);

  // Current bubble in cannon
  if (currentColor && !isShooting) {
    drawBubbleOnCtx(ctx, cx, cy, BR-4, currentColor);
  }

  // Moving bullet
  if (isShooting) {
    bx += bdx; by += bdy;
    if (bx - BR < 0) { bx = BR; bdx = Math.abs(bdx); }
    if (bx + BR > canvas.width) { bx = canvas.width-BR; bdx = -Math.abs(bdx); }
    drawBubbleOnCtx(ctx, bx, by, BR, bColor);

    // Collision
    let hit = false;
    if (by - BR <= BR) hit = true;
    else for (let r=0; r<GRID_ROWS&&!hit; r++) for (let c=0; c<GRID_COLS&&!hit; c++) {
      if (!grid[r][c]) continue;
      const {x,y} = cellXY(r,c);
      if (Math.hypot(bx-x, by-y) < BR*1.85) hit = true;
    }

    if (hit) {
      const cell = xyCell(bx, by);
      let placed = false;
      const cands = [[cell.r, cell.c], ...nbrs(cell.r, cell.c)];
      for (const [tr,tc] of cands) {
        if (tr>=0&&tr<GRID_ROWS&&tc>=0&&tc<GRID_COLS&&!grid[tr][tc]) {
          placeBubble(tr, tc); placed=true; break;
        }
      }
      if (!placed) { isShooting=false; spawnNext(); if(typeof wsSend==='function') wsSend({type:'turn_done',roomId:myRoomId}); }
    }
  }

  // Turn indicator
  const turnIndicatorY = canvas.height - 8;
  ctx.fillStyle = isMyTurn ? 'rgba(168,85,247,0.6)' : 'rgba(100,116,139,0.3)';
  ctx.fillRect(0, turnIndicatorY, canvas.width, 4);
  if (isMyTurn) {
    // Turn timer bar
    const pct = turnTimeLeft / TURN_SECONDS;
    ctx.fillStyle = pct > 0.4 ? '#22c55e' : pct > 0.2 ? '#eab308' : '#ef4444';
    ctx.fillRect(0, turnIndicatorY, canvas.width * pct, 4);
  }

  if (gameRunning) rafId = requestAnimationFrame(gameLoop);
}

// Exit confirmation
function confirmExit() {
  const overlay = document.createElement('div');
  overlay.id = 'exit-confirm-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);';
  overlay.innerHTML = `
    <div style="background:#0f0f1e;border:1px solid rgba(239,68,68,0.4);border-radius:20px;
         padding:32px;width:360px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,0.7);">
      <div style="font-size:2.5rem;margin-bottom:12px">⚠️</div>
      <div style="font-family:'Orbitron',sans-serif;font-size:1rem;font-weight:800;color:#fff;margin-bottom:8px">
        Forfeit Game?
      </div>
      <div style="font-size:0.82rem;color:#64748b;margin-bottom:24px;line-height:1.6">
        If you exit now, your opponent wins automatically.<br>
        You will <span style="color:#ef4444;font-weight:700">lose your bet</span>.
      </div>
      <div style="display:flex;gap:12px;">
        <button onclick="document.getElementById('exit-confirm-overlay').remove()"
          style="flex:1;padding:13px;background:rgba(20,20,40,0.8);border:1px solid #2a2a50;
          border-radius:12px;color:#94a3b8;font-family:'Inter',sans-serif;font-size:0.85rem;
          font-weight:700;cursor:pointer;">
          ← Keep Playing
        </button>
        <button onclick="forfeitAndLeave()"
          style="flex:1;padding:13px;background:linear-gradient(135deg,#991b1b,#ef4444);
          border:none;border-radius:12px;color:#fff;font-family:'Inter',sans-serif;
          font-size:0.85rem;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(239,68,68,0.3);">
          Exit & Forfeit
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function forfeitAndLeave() {
  document.getElementById('exit-confirm-overlay')?.remove();
  if (typeof wsSend === 'function') wsSend({ type:'forfeit', roomId:myRoomId });
  goLobby();
}

function goLobby() {
  gameRunning = false;
  clearInterval(turnTimerInterval);
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (typeof showScreen === 'function') showScreen('lobby');
  if (typeof resetBetBtn === 'function') resetBetBtn();
  if (typeof setStatus === 'function') { setStatus('p1','WAITING',''); setStatus('p2','—','var(--muted)'); }
  if (typeof myRoomId !== 'undefined') myRoomId = null;
  if (typeof gameActive !== 'undefined') gameActive = false;
  isMyTurn = false;
}

function rematch() {
  goLobby();
}
