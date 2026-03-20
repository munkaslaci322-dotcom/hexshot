// ═══════════════════════════════════════════════════════
// HEXSHOT GAME ENGINE v2 — Shared board, casino style
// ═══════════════════════════════════════════════════════

const BUBBLE_COLORS = ['#ff2d55','#00d4ff','#39ff14','#ffd700','#bf5fff','#ff6b00'];
const GRID_ROWS = 10, GRID_COLS = 11, BR = 20;
const BULLET_SPEED = 8;
const TURN_SECONDS = 6;

let grid = [];
let currentColor = null, nextBubbleColor = null;
let aimAngle = 90, isShooting = false;
let bx, by, bdx, bdy, bColor;
let rafId = null, gameRunning = false;
let isMyTurn = false;
let turnTimeLeft = TURN_SECONDS;
let turnTimerInterval = null;
let popAnimations = []; // {x, y, color, alpha, scale}
let fallingAnimations = [];

function initGame(){
  const canvas = document.getElementById('canvas');
  if (!canvas) return;
  canvas.width = 480;
  canvas.height = 580;

  // Shared grid — same for both players
  grid = [];
  for (let r = 0; r < GRID_ROWS; r++){
    grid[r] = [];
    for (let c = 0; c < GRID_COLS; c++)
      grid[r][c] = r < 6 ? BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)] : null;
  }

  nextBubbleColor = BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)];
  popAnimations = []; fallingAnimations = [];
  isShooting = false;
  gameRunning = true;
  spawnNext();

  canvas.onmousemove = (e) => {
    if (!gameRunning || !isMyTurn) return;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
    const cx = canvas.width / 2, cy = canvas.height - 55;
    aimAngle = Math.atan2(-(my - cy), mx - cx) * 180 / Math.PI;
    aimAngle = Math.max(10, Math.min(170, aimAngle));
  };

  canvas.onclick = () => {
    if (gameRunning && isMyTurn && !isShooting) fireBubble();
  };

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(gameLoop);
  updateNextPreview();

  const msgEl = document.getElementById('msg');
  if (msgEl) msgEl.textContent = '';
}

function setMyTurn(isTurn){
  isMyTurn = isTurn;
  clearInterval(turnTimerInterval);
  turnTimeLeft = TURN_SECONDS;
  const msgEl = document.getElementById('msg');
  const canvas = document.getElementById('canvas');
  if (isTurn){
    if (canvas) canvas.style.cursor = 'crosshair';
    if (msgEl) msgEl.textContent = '🎯 Your turn! ' + TURN_SECONDS + 's';
    turnTimerInterval = setInterval(() => {
      turnTimeLeft--;
      if (msgEl && isMyTurn) msgEl.textContent = '🎯 Your turn! ' + turnTimeLeft + 's';
      if (turnTimeLeft <= 0){
        clearInterval(turnTimerInterval);
        if (!isShooting) fireBubble(); // auto fire straight up
      }
    }, 1000);
  } else {
    if (canvas) canvas.style.cursor = 'default';
    if (msgEl) msgEl.textContent = "⏳ Opponent's turn...";
  }
}

function spawnNext(){
  currentColor = nextBubbleColor || BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)];
  nextBubbleColor = BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)];
  updateNextPreview();
}

function updateNextPreview(){
  ['next-p1','next-p2'].forEach(id => {
    const c = document.getElementById(id);
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 34, 34);
    drawGlowBubble(ctx, 17, 17, 13, nextBubbleColor || '#888');
  });
}

function fireBubble(){
  if (isShooting || !currentColor) return;
  clearInterval(turnTimerInterval);
  isShooting = true; isMyTurn = false;
  const canvas = document.getElementById('canvas');
  if (canvas) canvas.style.cursor = 'default';
  bx = canvas.width / 2; by = canvas.height - 55;
  const rad = aimAngle * Math.PI / 180;
  bdx = Math.cos(rad) * BULLET_SPEED;
  bdy = -Math.sin(rad) * BULLET_SPEED;
  bColor = currentColor;
  const msgEl = document.getElementById('msg');
  if (msgEl) msgEl.textContent = '';
}

function cellXY(r, c){
  const ox = (r % 2 === 1) ? BR : 0;
  return { x: BR + c * BR * 2 + ox + 4, y: BR + r * BR * 1.732 + 6 };
}

function xyCell(x, y){
  const r = Math.round((y - 6 - BR) / (BR * 1.732));
  const ox = (r % 2 === 1) ? BR : 0;
  const c = Math.round((x - 4 - BR - ox) / (BR * 2));
  return { r: Math.max(0, Math.min(GRID_ROWS-1, r)), c: Math.max(0, Math.min(GRID_COLS-1, c)) };
}

function nbrs(r, c){
  const odd = r % 2 === 1;
  return [
    [r-1,odd?c:c-1],[r-1,odd?c+1:c],
    [r,c-1],[r,c+1],
    [r+1,odd?c:c-1],[r+1,odd?c+1:c]
  ].filter(([rr,cc]) => rr>=0&&rr<GRID_ROWS&&cc>=0&&cc<GRID_COLS);
}

function floodGroup(r, c, color){
  const seen = new Set(), q = [[r,c]]; seen.add(r+','+c);
  while(q.length){
    const [cr,cc] = q.shift();
    for(const [nr,nc] of nbrs(cr,cc)){
      const k=nr+','+nc;
      if(!seen.has(k)&&grid[nr][nc]===color){seen.add(k);q.push([nr,nc]);}
    }
  }
  return [...seen].map(k=>k.split(',').map(Number));
}

function floaters(){
  const conn = new Set(), q = [];
  for(let c=0;c<GRID_COLS;c++) if(grid[0][c]){q.push([0,c]);conn.add('0,'+c);}
  while(q.length){
    const [r,c]=q.shift();
    for(const [nr,nc] of nbrs(r,c)){
      const k=nr+','+nc;
      if(!conn.has(k)&&grid[nr][nc]){conn.add(k);q.push([nr,nc]);}
    }
  }
  const fl=[];
  for(let r=0;r<GRID_ROWS;r++) for(let c=0;c<GRID_COLS;c++)
    if(grid[r][c]&&!conn.has(r+','+c)) fl.push([r,c]);
  return fl;
}

function placeBubble(r, c){
  grid[r][c] = bColor;
  const group = floodGroup(r, c, bColor);
  let pts = 0;

  if(group.length >= 2){
    group.forEach(([gr,gc]) => {
      const {x,y} = cellXY(gr,gc);
      popAnimations.push({x, y, color: grid[gr][gc], alpha: 1, scale: 1.2});
      grid[gr][gc] = null;
    });
    pts += group.length;
  }

  const fl = floaters();
  fl.forEach(([fr,fc]) => {
    const {x,y} = cellXY(fr,fc);
    fallingAnimations.push({x, y, vy: 2, color: grid[fr][fc], alpha: 1});
    grid[fr][fc] = null;
    pts++;
  });

  if(pts > 0){
    myScore += pts;
    refreshScores();
    if(typeof wsSend==='function') wsSend({type:'shot', points:pts, roomId:myRoomId, grid:serializeGrid()});
    const msgEl = document.getElementById('msg');
    if(msgEl){
      msgEl.textContent = '+' + pts + ' 🎯';
      msgEl.style.color = '#ffd700';
      setTimeout(()=>{if(msgEl){msgEl.textContent='';msgEl.style.color='';}},1000);
    }
  }

  isShooting = false;
  spawnNext();
  if(typeof wsSend==='function') wsSend({type:'turn_done', roomId:myRoomId, grid:serializeGrid()});

  let rem = 0;
  for(let r=0;r<GRID_ROWS;r++) for(let c=0;c<GRID_COLS;c++) if(grid[r][c]) rem++;
  if(rem === 0){
    if(typeof wsSend==='function') wsSend({type:'game_over', roomId:myRoomId});
  }
}

function serializeGrid(){
  return grid.map(row => row.map(c => c || ''));
}

function applyGrid(g){
  if(!g) return;
  for(let r=0;r<GRID_ROWS&&r<g.length;r++)
    for(let c=0;c<GRID_COLS&&c<g[r].length;c++)
      grid[r][c] = g[r][c] || null;
}

// Drawing
function drawGlowBubble(ctx, x, y, r, color){
  // Outer glow
  const glow = ctx.createRadialGradient(x,y,r*0.5,x,y,r*1.8);
  glow.addColorStop(0, color + '66');
  glow.addColorStop(1, color + '00');
  ctx.beginPath(); ctx.arc(x,y,r*1.8,0,Math.PI*2);
  ctx.fillStyle = glow; ctx.fill();

  // Main bubble
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
  const grad = ctx.createRadialGradient(x-r*0.3,y-r*0.4,r*0.05,x+r*0.1,y+r*0.1,r);
  grad.addColorStop(0,'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, color);
  grad.addColorStop(0.7, color);
  grad.addColorStop(1,'rgba(0,0,0,0.5)');
  ctx.fillStyle = grad; ctx.fill();

  // Rim
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
  ctx.strokeStyle='rgba(255,255,255,0.35)';
  ctx.lineWidth=1.2; ctx.stroke();

  // Shine spot
  ctx.beginPath();
  ctx.arc(x-r*0.28, y-r*0.32, r*0.22, 0, Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.fill();
}

function drawCannon(ctx, cx, cy, angle, myTurn){
  const rad = angle * Math.PI / 180;
  const len = 38, w = 12;

  // Base glow
  if(myTurn){
    ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 20;
  }

  // Base circle
  const baseGrad = ctx.createRadialGradient(cx,cy,2,cx,cy,22);
  baseGrad.addColorStop(0,'#4c1d95');
  baseGrad.addColorStop(0.6,'#2d1b69');
  baseGrad.addColorStop(1,'#1a0f3d');
  ctx.beginPath(); ctx.arc(cx,cy,20,0,Math.PI*2);
  ctx.fillStyle = baseGrad; ctx.fill();
  ctx.strokeStyle = myTurn ? '#a855f7' : '#3d2d6b';
  ctx.lineWidth = 2; ctx.stroke();

  // Barrel
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-rad);
  const barrelGrad = ctx.createLinearGradient(0,-w/2,0,w/2);
  barrelGrad.addColorStop(0,'#7c3aed');
  barrelGrad.addColorStop(0.4,'#a855f7');
  barrelGrad.addColorStop(1,'#4c1d95');
  ctx.fillStyle = barrelGrad;
  ctx.beginPath();
  ctx.roundRect(2, -w/2, len, w, 4);
  ctx.fill();
  // Barrel shine
  ctx.fillStyle='rgba(255,255,255,0.2)';
  ctx.fillRect(2,-w/2,len,w/3);
  ctx.restore();
  ctx.shadowBlur = 0;
}

function gameLoop(){
  const canvas = document.getElementById('canvas');
  if(!canvas||!gameRunning){rafId=null;return;}
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Dark casino background
  ctx.fillStyle = '#0a0612';
  ctx.fillRect(0,0,W,H);

  // Felt-like texture pattern
  for(let x=0;x<W;x+=24) for(let y=0;y<H;y+=24){
    ctx.fillStyle='rgba(168,85,247,0.012)';
    ctx.fillRect(x,y,12,12);
  }

  // Top border glow
  const topGrad = ctx.createLinearGradient(0,0,W,0);
  topGrad.addColorStop(0,'transparent');
  topGrad.addColorStop(0.3,'rgba(168,85,247,0.4)');
  topGrad.addColorStop(0.7,'rgba(168,85,247,0.4)');
  topGrad.addColorStop(1,'transparent');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0,0,W,2);

  // Side borders
  const leftGrad = ctx.createLinearGradient(0,0,0,H);
  leftGrad.addColorStop(0,'rgba(168,85,247,0.3)');
  leftGrad.addColorStop(0.5,'rgba(168,85,247,0.1)');
  leftGrad.addColorStop(1,'rgba(168,85,247,0.3)');
  ctx.fillStyle=leftGrad; ctx.fillRect(0,0,2,H);
  ctx.fillStyle=leftGrad; ctx.fillRect(W-2,0,2,H);

  // Grid bubbles
  for(let r=0;r<GRID_ROWS;r++) for(let c=0;c<GRID_COLS;c++){
    if(!grid[r][c]) continue;
    const {x,y}=cellXY(r,c);
    drawGlowBubble(ctx,x,y,BR-1,grid[r][c]);
  }

  // Pop animations
  popAnimations = popAnimations.filter(a => {
    if(a.alpha <= 0) return false;
    ctx.globalAlpha = a.alpha;
    ctx.beginPath(); ctx.arc(a.x,a.y,BR*a.scale,0,Math.PI*2);
    ctx.strokeStyle=a.color; ctx.lineWidth=3; ctx.stroke();
    // Stars burst
    for(let i=0;i<6;i++){
      const ang = (i/6)*Math.PI*2 + (1-a.alpha)*3;
      const dist = (1-a.alpha)*35;
      ctx.beginPath();
      ctx.arc(a.x+Math.cos(ang)*dist, a.y+Math.sin(ang)*dist, 3, 0, Math.PI*2);
      ctx.fillStyle=a.color; ctx.fill();
    }
    ctx.globalAlpha=1;
    a.alpha -= 0.08; a.scale += 0.15;
    return true;
  });

  // Falling animations
  fallingAnimations = fallingAnimations.filter(a => {
    if(a.alpha <= 0 || a.y > H+40) return false;
    ctx.globalAlpha = a.alpha;
    drawGlowBubble(ctx,a.x,a.y,BR-2,a.color);
    ctx.globalAlpha=1;
    a.y += a.vy; a.vy += 0.4; a.alpha -= 0.03;
    return true;
  });

  // Shooter area separator
  const sepGrad = ctx.createLinearGradient(0,H-90,W,H-90);
  sepGrad.addColorStop(0,'transparent');
  sepGrad.addColorStop(0.3,'rgba(168,85,247,0.3)');
  sepGrad.addColorStop(0.7,'rgba(168,85,247,0.3)');
  sepGrad.addColorStop(1,'transparent');
  ctx.fillStyle=sepGrad; ctx.fillRect(0,H-90,W,1);

  const cx=W/2, cy=H-55;

  // Aim line (my turn only)
  if(isMyTurn&&!isShooting){
    const rad=aimAngle*Math.PI/180;
    ctx.save();
    // Dashed line with bounce preview
    let px=cx,py=cy,pdx=Math.cos(rad),pdy=-Math.sin(rad);
    const pts=[[px,py]];
    for(let seg=0;seg<5;seg++){
      const steps=200;
      const nx=px+pdx*steps,ny=py+pdy*steps;
      if(nx<BR+4){const t=(px-BR-4)/(-pdx);px=BR+4;pdx=-pdx;py+=pdy*t;}
      else if(nx>W-BR-4){const t=(W-BR-4-px)/pdx;px=W-BR-4;pdx=-pdx;py+=pdy*t;}
      else{px=nx;py=ny;}
      pts.push([px,py]);
      if(py<0) break;
    }
    // Draw gradient dashed line
    for(let i=1;i<pts.length;i++){
      const prog=i/pts.length;
      ctx.globalAlpha=(1-prog)*0.6;
      ctx.strokeStyle='#a855f7';
      ctx.lineWidth=1.5;
      ctx.setLineDash([6,8]);
      ctx.beginPath(); ctx.moveTo(pts[i-1][0],pts[i-1][1]); ctx.lineTo(pts[i][0],pts[i][1]); ctx.stroke();
    }
    ctx.globalAlpha=1; ctx.setLineDash([]);
    // Target dot
    if(pts.length>1){
      const last=pts[pts.length-1];
      ctx.beginPath(); ctx.arc(last[0],last[1],4,0,Math.PI*2);
      ctx.fillStyle='rgba(168,85,247,0.8)'; ctx.fill();
    }
    ctx.restore();
  }

  // Cannon
  drawCannon(ctx,cx,cy,isMyTurn?aimAngle:90,isMyTurn);

  // Current bubble
  if(currentColor&&!isShooting){
    drawGlowBubble(ctx,cx,cy,BR-3,currentColor);
  }

  // Moving bullet
  if(isShooting){
    bx+=bdx; by+=bdy;
    if(bx-BR<4){bx=BR+4;bdx=Math.abs(bdx);}
    if(bx+BR>W-4){bx=W-BR-4;bdx=-Math.abs(bdx);}
    // Motion trail
    for(let t=1;t<=4;t++){
      ctx.globalAlpha=0.1*t;
      drawGlowBubble(ctx,bx-bdx*t*0.6,by-bdy*t*0.6,BR-1-t*2,bColor);
    }
    ctx.globalAlpha=1;
    drawGlowBubble(ctx,bx,by,BR,bColor);

    // Collision
    let hit=false;
    if(by-BR<=6) hit=true;
    else for(let r=0;r<GRID_ROWS&&!hit;r++) for(let c=0;c<GRID_COLS&&!hit;c++){
      if(!grid[r][c]) continue;
      const {x,y}=cellXY(r,c);
      if(Math.hypot(bx-x,by-y)<BR*1.9) hit=true;
    }
    if(hit){
      const cell=xyCell(bx,by);
      let placed=false;
      const cands=[[cell.r,cell.c],...nbrs(cell.r,cell.c)];
      for(const [tr,tc] of cands){
        if(tr>=0&&tr<GRID_ROWS&&tc>=0&&tc<GRID_COLS&&!grid[tr][tc]){
          placeBubble(tr,tc); placed=true; break;
        }
      }
      if(!placed){isShooting=false;spawnNext();if(typeof wsSend==='function')wsSend({type:'turn_done',roomId:myRoomId});}
    }
  }

  // Turn timer bar
  const barY=H-4;
  ctx.fillStyle='rgba(168,85,247,0.15)';
  ctx.fillRect(0,barY,W,4);
  if(isMyTurn){
    const pct=turnTimeLeft/TURN_SECONDS;
    const barColor=pct>0.5?'#22c55e':pct>0.25?'#eab308':'#ef4444';
    const barGrad=ctx.createLinearGradient(0,0,W*pct,0);
    barGrad.addColorStop(0,barColor+'aa');
    barGrad.addColorStop(1,barColor);
    ctx.fillStyle=barGrad; ctx.fillRect(0,barY,W*pct,4);
    // Glow
    ctx.shadowColor=barColor; ctx.shadowBlur=8;
    ctx.fillRect(0,barY,W*pct,4);
    ctx.shadowBlur=0;
  }

  if(gameRunning) rafId=requestAnimationFrame(gameLoop);
}

// Handle opponent's shot updating grid
function applyOpponentShot(data){
  if(data.grid) applyGrid(data.grid);
  if(data.points){
    oppScore = (oppScore||0) + data.points;
    refreshScores();
  }
}

// Exit confirm
function confirmExit(){
  const overlay=document.createElement('div');
  overlay.id='exit-confirm-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(12px);';
  overlay.innerHTML=`
    <div style="background:linear-gradient(135deg,#0f0a1e,#1a0f3d);border:1px solid rgba(168,85,247,0.4);
         border-radius:24px;padding:36px;width:380px;text-align:center;
         box-shadow:0 0 60px rgba(168,85,247,0.2),0 30px 80px rgba(0,0,0,0.8);">
      <div style="font-size:3rem;margin-bottom:16px">⚠️</div>
      <div style="font-family:'Orbitron',sans-serif;font-size:1.1rem;font-weight:800;color:#fff;margin-bottom:10px">Forfeit Game?</div>
      <div style="font-size:0.82rem;color:#94a3b8;margin-bottom:28px;line-height:1.7">
        Exiting now means your opponent wins automatically.<br>
        You will <span style="color:#ef4444;font-weight:700">lose your bet</span>.
      </div>
      <div style="display:flex;gap:12px;">
        <button onclick="document.getElementById('exit-confirm-overlay').remove()"
          style="flex:1;padding:14px;background:rgba(30,20,60,0.8);border:1px solid rgba(168,85,247,0.3);
          border-radius:12px;color:#a855f7;font-family:'Inter',sans-serif;font-size:0.88rem;
          font-weight:700;cursor:pointer;transition:all 0.2s;"
          onmouseover="this.style.background='rgba(168,85,247,0.15)'"
          onmouseout="this.style.background='rgba(30,20,60,0.8)'">
          ← Keep Playing
        </button>
        <button onclick="forfeitAndLeave()"
          style="flex:1;padding:14px;background:linear-gradient(135deg,#7f1d1d,#ef4444);
          border:none;border-radius:12px;color:#fff;font-family:'Inter',sans-serif;
          font-size:0.88rem;font-weight:700;cursor:pointer;
          box-shadow:0 4px 20px rgba(239,68,68,0.4);">
          Exit & Forfeit
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function forfeitAndLeave(){
  document.getElementById('exit-confirm-overlay')?.remove();
  if(typeof wsSend==='function') wsSend({type:'forfeit',roomId:myRoomId});
  goLobby();
}

function goLobby(){
  gameRunning=false;
  clearInterval(turnTimerInterval);
  if(rafId){cancelAnimationFrame(rafId);rafId=null;}
  if(typeof showScreen==='function') showScreen('lobby');
  if(typeof resetBetBtn==='function') resetBetBtn();
  if(typeof setStatus==='function'){setStatus('p1','WAITING','');setStatus('p2','—','var(--muted)');}
  if(typeof myRoomId!=='undefined') myRoomId=null;
  if(typeof gameActive!=='undefined') gameActive=false;
  isMyTurn=false;
}

function rematch(){ goLobby(); }
