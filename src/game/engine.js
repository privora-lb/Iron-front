// =============================================================================
// Iron Front — game engine
//
// This is the simulation, the renderer and the input layer, still in one piece.
// It is being pulled apart module by module; see docs/EXTRACTION.md for the plan
// and the order of work. Data tables and leaf helpers already live in ../data and
// ../core and are imported below.
// =============================================================================
import { W, H, ZONE, BANK, FS, LANE_Y, LANE_NAME, DIV, GAPS, SIM } from '../data/world.js';
import { UNITS, PAL_ORDER, PERMODEL, SIZE_LVL } from '../data/units.js';
import { WALL, MINE, WIRE, TRENCH, ANGS, ANGNAME } from '../data/defences.js';
import { NATION, ROMAN } from '../data/nations.js';
import { MAPS } from '../data/maps.js';
import * as T from '../world/terrain.js';
import { hydrology } from '../world/hydrology.js';
import { layNetwork, allConnected } from '../world/roads.js';
import { scatterWoodland } from '../world/vegetation.js';
import { WOOD, MARSH, ROCK, WATER, FORD, STONE, BUILD, SCORCH, CLIFF,
         WIRED, TRENCHED, FIELD, ROAD, RUBBLE, mobilityOf } from '../world/terrain.js';
import { MAXLVL, RANKS, rankOf, nextRank, xpNeed } from '../data/ranks.js';
import { DIFF } from '../data/difficulty.js';
import { makeLanduse } from '../world/landuse.js';
import { paintLanduse } from '../world/paintLanduse.js';
import { DAY_LEN, START_HOURS, todAt, sunElev, sunDir, lightAt, isNight,
         ambientAt, phaseName } from '../data/daynight.js';
import { srand, R, rnd, vr, seed } from '../core/rng.js';
import { clamp, dist, other } from '../core/math.js';
import { el, toast } from '../core/dom.js';
import { holdScreenAwake, tap } from '../platform/native.js';
import { write, pick } from '../platform/storage.js';
import * as SAVES from '../platform/saves.js';
import { sfx, unlock as unlockAudio, listen, toggleMuted, isMuted,
         suspend as suspendAudio, resume as resumeAudio } from '../audio/sound.js';

export function startGame() {
/* ===================== world ===================== */
const cv=document.getElementById('cv'),ctx=cv.getContext('2d',{alpha:false});
// The battlefield is drawn by one of two renderers. A canvas can hold a 2D
// context or a WebGL one but never both, so the 3D view gets its own canvas
// and a transparent 2D one over it for the minimap.
const glCv=document.getElementById('gl'),ovCv=document.getElementById('ov');
const ovx=ovCv&&ovCv.getContext?ovCv.getContext('2d'):null;
let viewMode=pick('view',['top','3d'],'3d');   // the map is still there, one tap away
let gfx3=null,gfx3Busy=false;
let worldId=0,ruinsN=0;                     // bumped when the world, or what stands on it, changes
let dpr=1;

let placeAng=Math.PI/2;                       // defences are laid along this bearing

let mapType=pick('map',MAPS,'villages');
const hasWater=()=>MAPS[mapType].water!=='none';

/* ===================== state ===================== */
let squads=[],soldiers=[],shots=[],parts=[],pings=[],walls=[],fires=[],feats=[],buildings=[],castles=[];
let bGrid=new Int32Array(1),sun=.9;
// The hour. `sun` above is the bearing the light throws shadows along and is
// now written every tick from the clock rather than being a constant.
let hourKey=pick('hour',START_HOURS.map(h=>h.key),'day');
let todStart=.46,tod=.46,dayLight=1,night=false;
const TX=16,TY=10;                                  // territory blocks
let terrOwn=new Uint8Array(TX*TY),terrHold=new Float32Array(TX*TY);
let terrT=0,lastCall=false;
const terrIdx=(x,y)=>clamp((y/H*TY)|0,0,TY-1)*TX+clamp((x/W*TX)|0,0,TX-1);
function resetTerritory(){
  terrOwn=new Uint8Array(TX*TY); terrHold=new Float32Array(TX*TY);
  for(let gy=0;gy<TY;gy++) for(let gx=0;gx<TX;gx++){
    const i=gy*TX+gx, blue=(gx+.5)/TX<.5;
    terrOwn[i]=blue?1:2; terrHold[i]=blue?1:-1;
  }
  lastCall=false;
}
function landShare(team){
  let n=0,own=0;
  for(let i=0;i<terrOwn.length;i++){ n++; if(terrOwn[i]===(team==='blue'?1:2)) own++; }
  return own/n;
}
let baseT=0;
function stepBases(dt){
  baseT-=dt; if(baseT>0) return; baseT=.5;
  for(const b of bases){
    if(b.dead) continue;
    let blue=0,red=0;
    collect(b.x,b.y,b.r+20);
    for(let i=0;i<NEARn;i++){
      const o=NEAR[i];
      if(!o.alive) continue;
      if(dist(o.x,o.y,b.x,b.y)>b.r) continue;
      if(o.sq.team==='blue') blue++; else red++;
    }
    const own=b.team,foe=other(own);
    const holding=own==='blue'?blue:red, taking=own==='blue'?red:blue;
    if(taking>0&&taking>holding*1.15){
      b.cap=clamp(b.cap+Math.min(1,taking/14)*.5,0,1);
      if(b.cap>=1){
        b.team=foe; b.cap=0; b.hp=b.max*.6;
        toast((foe==='blue'?NATION.blue.name:NATION.red.name)+' takes the '+b.name+' base');
        earned[foe]+=120; addXP(foe,26);
      }
    } else if(b.cap>0) b.cap=Math.max(0,b.cap-dt*.35);
  }
}
function stepTerritory(dt){
  terrT-=dt; if(terrT>0) return; terrT=.5;
  const inf=new Float32Array(TX*TY);
  for(let i=0;i<squads.length;i++){
    const sq=squads[i];
    if(sq.gone||sq.routed) continue;
    inf[terrIdx(sq.fx,sq.fy)]+=(sq.team==='blue'?1:-1)*sq.alive;
  }
  for(const c of castles) if(!c.dead) inf[terrIdx(c.x,c.y)]+=(c.team==='blue'?1:-1)*40;
  for(const b of bases) if(!b.dead) inf[terrIdx(b.x,b.y)]+=(b.team==='blue'?1:-1)*18;
  for(let i=0;i<inf.length;i++){
    const d=inf[i];
    if(!d) continue;
    terrHold[i]=clamp(terrHold[i]+Math.sign(d)*Math.min(1,Math.abs(d)/22)*.45,-1,1);
    if(terrHold[i]>=.6) terrOwn[i]=1;
    else if(terrHold[i]<=-.6) terrOwn[i]=2;
  }
  // ninety percent gone: stand or fold
  if(!lastCall&&phase==='battle'){
    const you=viewTeam(),share=landShare(you);
    if(share<=.10){
      lastCall=true;
      if(mode==='ai'&&you==='blue'){ speed=0; syncSpeed(); el('surVeil').style.display='flex'; }
      else toast('The country is nearly gone — nothing left to give');
    }
    const foe=other(you);
    if(landShare(foe)<=.10&&mode==='ai'){ lastCall=true; toast('Rothal refuses to surrender'); }
  }
}
let bodies=[],bases=[],weather=[],rings=[],plumes=[];
let glowSprite=null,shakeAmp=0,shakeAge=0,wx=0,wyv=0,sky='clear';
function makeGlow(){
  glowSprite=document.createElement('canvas'); glowSprite.width=glowSprite.height=128;
  const g=glowSprite.getContext('2d');
  const rg=g.createRadialGradient(64,64,0,64,64,64);
  rg.addColorStop(0,'rgba(255,236,190,1)');
  rg.addColorStop(.28,'rgba(255,176,80,.55)');
  rg.addColorStop(1,'rgba(255,140,40,0)');
  g.fillStyle=rg; g.fillRect(0,0,128,128);
}
function glow(x,y,r,a,tint){
  if(!glowSprite) makeGlow();
  ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.globalAlpha=a;
  ctx.drawImage(glowSprite,x-r,y-r,r*2,r*2);
  ctx.restore();
}
// a shell landing shoves the camera
const shakeNow=()=>shakeAmp>0?shakeAmp*Math.exp(-shakeAge*8.5):0;
function kick(x,y,power){
  const sx=w2sx(x),sy=w2sy(y),w=cv.width/dpr,h=cv.height/dpr;
  const dx=(sx-w*.5)/(w*.5),dy=(sy-h*.5)/(h*.5),d=Math.hypot(dx,dy);
  if(d>1.7) return;                                // too far off centre to feel
  const fall=1-d/1.7;
  const amp=Math.min(6.5,power*.55)*fall*fall;     // near blasts shake, distant ones do not
  if(amp<=shakeNow()) return;                      // the bigger blast wins; they never stack
  shakeAmp=amp; shakeAge=0;
  hapticKick(amp);
}
// A short pulse in the hand on the same impulse as the camera, rate limited so
// it can never become a continuous buzz.
let hapT=-9;
function hapticKick(amp){
  if(!prof.haptics||amp<1.1||clock-hapT<.3) return;
  hapT=clock;
  try{ tap(amp>4?'HEAVY':amp>2.2?'MEDIUM':'LIGHT'); }catch(e){}
}
function tapLight(){ if(prof.haptics){ try{ tap('LIGHT'); }catch(e){} } }
let clouds=[],birds=[],mines=[],wind={a:0.7,v:1};   // real values set when the ground is generated
let phase='start',mode='ai',paused=false;
let budget=300,spent={blue:0,red:0},earned={blue:0,red:0},depTeam='blue',depTime=180,troopSize=1;   // three minutes to plan and build
let prof={name:'Commander',games:0,wins:0,losses:0,best:0,hiLvl:1,kills:0,shake:true,haptics:true};
function loadProf(){
  try{
    const raw=window.localStorage&&localStorage.getItem('ironfront.profile');
    if(raw) prof=Object.assign(prof,JSON.parse(raw));
  }catch(e){}                                    // no storage: the record lasts this session
}
function saveProf(){
  try{ window.localStorage&&localStorage.setItem('ironfront.profile',JSON.stringify(prof)); }catch(e){}
}
function matchScore(won){
  return Math.max(0,Math.round(stats.red*10+lvl.blue*60+landShare('blue')*400+(won?1500:0)));
}
function paintProf(){
  const el2=el('profStats');
  if(!el2) return;
  const r=rankOf(prof.hiLvl),nx=nextRank(prof.hiLvl);
  el2.innerHTML='<b>'+r.name+'</b> · level '+prof.hiLvl
    +(nx?(' · next: '+nx.name+' at '+nx.at):' · top of the ladder')
    +'<br><b>'+prof.games+'</b> matches · <b>'+prof.wins+'</b> won · <b>'+prof.losses+'</b> lost'
    +' · best score <b>'+prof.best.toLocaleString()+'</b> · <b>'+prof.kills.toLocaleString()+'</b> enemy dead';
}
let lvl={blue:1,red:1},xp={blue:0,red:0};
const reqLvl=k=>k==='wall'?WALL.lvl:k==='mine'?MINE.lvl:k==='wire'?WIRE.lvl:k==='trench'?TRENCH.lvl:UNITS[k].lvl;
const unlocked=(team,k)=>sandbox||lvl[team]>=reqLvl(k);
function addXP(team,amt){
  xp[team]+=amt;
  while(lvl[team]<MAXLVL&&xp[team]>=xpNeed(lvl[team])){
    xp[team]-=xpNeed(lvl[team]); lvl[team]++;
    earned[team]+=Math.round(Math.min(400,50+lvl[team]*6));   // a promotion comes with a war chest
    const opened=Object.keys(UNITS).filter(k=>UNITS[k].lvl===lvl[team]);
    const rNow=rankOf(lvl[team]),rBefore=rankOf(lvl[team]-1);
    if(team===viewTeam()){
      if(rNow.name!==rBefore.name) toast('Promoted to '+rNow.name+' — '+capOf(team)+' fighters under command');
      else toast('Level '+lvl[team]+' — '+capOf(team)+' fighters allowed'+(opened.length?', '+UNITS[opened[0]].name+' unlocked':''));
      buildPalette(); paintSizes();
    }
  }
}
let wave=0,lastWave=-1,lastScore=0,lastBest=false;
const waveOf=()=>Math.floor(battleTime/60);
const redEdge=()=>mode==='ai'?dset().e:1;       // difficulty is the only thing that tips the scales
let remMode=false,battleLimit=0,attacker='red',defender='blue';
// how many fighters a side may keep in the field — grows with rank
// command size: tight at first, ten thousand by level 1000
let diff=pick('diff',DIFF,'normal');
function dset(){
  const d=DIFF[diff];
  if(diff!=='adapt') return d;
  const k=clamp(battleTime/600,0,1);              // ten minutes to reach its peak
  return {b:1.7-1.05*k, r:1.9-1.2*k, p:.55+.95*k, e:.84+.42*k, x:.8+.65*k};
}
let matchSeed=1,netTick=0;
let sandbox=false;                            // Total War: build what you like
let capChoice=0;                              // 0 = grow with rank, otherwise a fixed field limit
const capOf=t=>sandbox?1000:(capChoice>0?capChoice:Math.min(1000,48+2*lvl[t]));        // fifty in the field at level one, two more each level
const coinsLeft=t=>sandbox?999999:budget-spent[t]+earned[t];
function liveCount(t){
  let n=0;
  for(let i=0;i<squads.length;i++){ const sq=squads[i];
    if(sq.team===t&&!sq.gone) n+=sq.alive; }
  return n;
}
let speed=1,battleTime=0,timeUp=false,placing=null,selected=[],nextId=1,bindMode=false;
let stats={blue:0,red:0};
let hot={stage:'orders',team:'blue',t:45,round:1};
let cam={s:1,x:0,y:0};
let ground=null,canopy=null,canopyCtx=null,decal=null,decalCtx=null;
let landuse=null;                       // the field patchwork, see src/world/landuse.js
let mini={x:0,y:0,w:0,h:0,s:1,cx:90,cy:90,r:80};
let quality=1,qualityLock=false,frameMs=16,clock=0;
{ // an explicit graphics choice sticks; one taken automatically after a
  // draw fault does not, or a single bad frame would follow you forever.
  const g=pick('gfx',['high','fast'],null);
  if(g){ quality=g==='high'?1:0; qualityLock=true; } }

const laneOf=y=>y<div[0]?0:y<div[1]?1:2;
const maxSquad=t=>{ if(sandbox) return 50; let m=10; for(const k in SIZE_LVL) if(lvl[t]>=SIZE_LVL[k]) m=Math.max(m,+k); return m; };
function paintSizes(){
  const team=phase==='deploy'?depTeam:(cmdTeam()||viewTeam());
  const mx=maxSquad(team);
  if(troopSize>mx) troopSize=mx;
  document.querySelectorAll('.sz').forEach(b=>{
    const v=+b.dataset.size, ok=v<=mx;
    b.classList.toggle('locked',!ok);
    b.classList.toggle('on',ok&&v===troopSize);
    b.textContent=ok?String(v):(v+' · Lv'+SIZE_LVL[v]);
  });
}
// every unit is ordered by the number you choose — one tank or fifty
function unitCount(k,n){
  const team=phase==='deploy'?depTeam:(cmdTeam()||viewTeam());
  const want=n===undefined?troopSize:n;
  return clamp(Math.round(want),1,maxSquad(team));
}
function unitCost(k,n){
  return Math.max(1,Math.round((PERMODEL[k]||8)*unitCount(k,n)));
}

/* ===================== terrain grids ===================== */
const BAKE=.5;
const TG=22,TW=Math.ceil(W/TG),TH=Math.ceil(H/TG);
// The battlefield itself lives in src/world/terrain.js: what each cell is, how
// high it stands, how chewed up it is, and every question anyone asks about a
// position. These are its own arrays under the names the engine has always
// used, so the ten thousand places that read a grid directly keep working.
let terrain=T.makeTerrain(W,H,TG);
let tGrid=terrain.flags;                   // what the cell IS
let eGrid=terrain.elev;                    // elevation 0..3
let cGrid=terrain.churn;                   // churn 0..1
let hGrid=terrain.height;                  // the continuous field the rest comes from
let tGrid0=null;                           // the same grid as generated: a save diffs against it
let pGrid=new Uint8Array(TW*TH);          // churn already painted
const gi=(x,y)=>T.idx(terrain,x,y);
const terrainAt=(x,y)=>T.flagsAt(terrain,x,y);
const elevAt=(x,y)=>T.elevAt(terrain,x,y);
const churnAt=(x,y)=>T.churnAt(terrain,x,y);
const heightAt=(x,y)=>T.heightAt(terrain,x,y);
const solid=(x,y)=>T.hardAt(terrain,x,y,false);
// troops on foot can push into a building; anything with an engine cannot
const solidFor=(x,y,foot)=>T.hardAt(terrain,x,y,foot);

// the river
const riverXAt=y=>{                        // the channel traced through the low ground
  if(!riverRow.length||riverRow.length<2) return W/2;
  const f=clamp(y/TG-.5,0,TH-1),i=f|0,t=f-i,j=Math.min(TH-1,i+1);
  return riverRow[i]+(riverRow[j]-riverRow[i])*t;
};
const crossFor=y=>{ let c=CROSS[0]; for(const k of CROSS) if(Math.abs(k.y-y)<Math.abs(c.y-y)) c=k; return c; };
let AIRMOVE=false;
const acrossRiver=(x0,y0,x1,y1)=>!AIRMOVE&&hasWater()&&(x0-riverXAt(y0))*(x1-riverXAt(y1))<0;

function groundName(x,y){
  const f=terrainAt(x,y);
  if(f&WATER) return 'in the river';
  if(f&FORD)  return 'at the ford';
  for(const c of castles) if(!c.dead&&Math.abs(x-c.x)<c.hw+24&&Math.abs(y-c.y)<c.hh+24) return 'at the keep';
  return T.describe(terrain,x,y);
}
// How fast a unit crosses this ground. Takes the unit TYPE, not its kind: a
// battle tank fires at range but crosses a wire belt like the vehicle it is.
const moveMul=(x,y,ut)=>T.moveMul(terrain,x,y,mobilityOf(ut));
const slopeMul=(x,y,ang)=>T.slopeMul(terrain,x,y,ang);

/* ===================== relief ===================== */
// The ground is a continuous height field, and everything else is a consequence
// of it: the river runs where the land is lowest, the sectors sit where it is
// easiest to cross, and the light picks out real slopes instead of painted
// contour rings.
//
// Fairness: the field is made rotationally symmetric about the map centre, so
// what lies in front of one keep lies in front of the other after a 180-degree
// turn. That is fair without a mirror line down the middle to give it away.
let riverRow = new Float32Array(1);        // river centre-x, one entry per terrain row
let laneY = LANE_Y.slice(), div = DIV.slice();
let CROSS = [{ y:laneY[0], type:'ford' }, { y:laneY[1], type:'bridge' }, { y:laneY[2], type:'ford' }];

// value noise: a coarse random lattice, smoothly interpolated
function lattice(w, h) {
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = R();
  return a;
}
function latAt(a, w, h, u, v) {
  const fx = u * (w - 1), fy = v * (h - 1);
  const x0 = clamp(fx | 0, 0, w - 1), y0 = clamp(fy | 0, 0, h - 1);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  let tx = fx - x0, ty = fy - y0;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a0 = a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx;
  const a1 = a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx;
  return a0 * (1 - ty) + a1 * ty;
}

const OCTAVES = [[3, 3, 1], [6, 5, .52], [11, 9, .27], [21, 15, .14], [41, 29, .07]];

function buildRelief() {
  hGrid = terrain.height;      // the model owns the field; relief fills it
  const fs = OCTAVES.map(o => lattice(o[0], o[1]));
  let lo = 1e9, hi = -1e9;
  for (let gy = 0; gy < TH; gy++)
    for (let gx = 0; gx < TW; gx++) {
      const u = gx / (TW - 1), v = gy / (TH - 1);
      let acc = 0, amp = 0;
      for (let k = 0; k < OCTAVES.length; k++) {
        acc += latAt(fs[k], OCTAVES[k][0], OCTAVES[k][1], u, v) * OCTAVES[k][2];
        amp += OCTAVES[k][2];
      }
      const h = acc / amp;
      hGrid[gy * TW + gx] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  const span = (hi - lo) || 1;
  for (let i = 0; i < hGrid.length; i++) hGrid[i] = (hGrid[i] - lo) / span;

  // 180 degrees about the centre - the same ground for both commanders
  for (let gy = 0; gy < TH; gy++)
    for (let gx = 0; gx < TW; gx++) {
      const i = gy * TW + gx, j = (TH - 1 - gy) * TW + (TW - 1 - gx);
      if (i < j) hGrid[j] = hGrid[i];
    }
  shapeLandform();
}

// Each battlefield is a different piece of country, so the noise is bent into
// the landform that map is meant to be. Every mask is symmetric about x = W/2,
// which keeps both keeps on equal ground.
function shapeLandform() {
  const M = mapType;
  // the outer two passes are a rotation of each other, the middle one is its own
  const s1 = M === 'mountains' ? rnd(.10, .26) : 0;
  const saddles = M === 'mountains' ? [s1, .5, 1 - s1] : null;
  for (let gy = 0; gy < TH; gy++)
    for (let gx = 0; gx < TW; gx++) {
      const i = gy * TW + gx, u = gx / (TW - 1), v = gy / (TH - 1);
      const c = Math.abs(u - .5) * 2;          // 0 on the centre line, 1 at the side edges
      let h = hGrid[i];
      if (M === 'villages') h = h * (.44 + .46 * c) + .13 * c;         // a broad valley
      else if (M === 'mountains') {
        let ridge = (1 - c) * (1 - c);
        for (const sy of saddles) {            // three passes cut through the spine
          const d = Math.abs(v - sy);
          if (d < .085) ridge *= .10 + .90 * (d / .085);
        }
        h = h * .48 + ridge * .78 + .08;
      } else if (M === 'beach') h = h * (.30 + .40 * (1 - v)) + .42 * (1 - v) * (1 - v);
      else if (M === 'city') h = h * .32 + .14;                        // a flat river terrace
      else h = h * .46 + .20 * c * c;                                  // desert flat, edges lift
      hGrid[i] = clamp(h, 0, 1);
    }
  // Renormalise, then set how much relief this piece of country actually has.
  // Without this a flat map never reaches the high-ground thresholds at all and
  // the sight and damage bonuses are dead weight on it.
  const RELIEF = { villages:[.06, .86], mountains:[.05, .95], beach:[.03, .82],
                   city:[.07, .52], desert:[.05, .64] }[M] || [.05, .8];
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < hGrid.length; i++) { const h = hGrid[i]; if (h < lo) lo = h; if (h > hi) hi = h; }
  const span = (hi - lo) || 1;
  for (let i = 0; i < hGrid.length; i++) hGrid[i] = RELIEF[0] + ((hGrid[i] - lo) / span) * RELIEF[1];
}

// Water finds its own way down. The channel is traced through the lowest ground
// with a gentle pull to the centre so it always parts the two sides, then it is
// smoothed, made symmetric, and cut into the height field.
function traceRiver() {
  const col = new Float32Array(TH);            // channel centre, in cells
  let x = (TW / 2) | 0;
  for (let gy = 0; gy < TH; gy++) {
    let best = x, bc = 1e9;
    for (let dx = -3; dx <= 3; dx++) {
      const nx = clamp(x + dx, (TW * .34) | 0, (TW * .66) | 0);
      const pull = Math.abs(nx - (TW - 1) / 2) * .0006;   // it still has to part the two sides
      const c = hGrid[gy * TW + nx] + pull;
      if (c < bc) { bc = c; best = nx; }
    }
    x = best;
    col[gy] = x;
  }
  const sm = new Float32Array(TH);             // no cell-to-cell zig-zag
  for (let i = 0; i < TH; i++) {
    let acc = 0, n = 0;
    for (let k = -4; k <= 4; k++) {
      const j = i + k;
      if (j < 0 || j >= TH) continue;
      acc += col[j]; n++;
    }
    sm[i] = acc / n;
  }
  riverRow = new Float32Array(TH);
  for (let i = 0; i < TH; i++) {
    const c = (sm[i] + ((TW - 1) - sm[TH - 1 - i])) / 2;   // exact about the grid centre
    riverRow[i] = (c + .5) * TG;
  }

  if (!hasWater()) return;
  for (let gy = 0; gy < TH; gy++) {             // the channel is the lowest ground around
    const cx = riverRow[gy] / TG - .5;
    const x0 = clamp((cx - 6) | 0, 0, TW - 1), x1 = clamp((cx + 6) | 0, 0, TW - 1);
    for (let gx = x0; gx <= x1; gx++) {
      const d = Math.abs(gx - cx), i = gy * TW + gx;
      if (d < 6) hGrid[i] = Math.min(hGrid[i], .05 + d * .022);
    }
  }
}

// The three sectors are found, not decreed: the rows where crossing the middle
// of the map costs least. The AI and the Left/Centre/Right buttons keep working,
// but the corridors now follow the ground.
function deriveLanes() {
  const cost = new Float32Array(TH);
  const x0 = (TW * .32) | 0, x1 = (TW * .68) | 0;
  for (let gy = 0; gy < TH; gy++) {
    let acc = 0;
    for (let gx = x0; gx <= x1; gx++) { const h = hGrid[gy * TW + gx]; acc += h * h; }
    cost[gy] = acc / (x1 - x0 + 1);
  }
  const bands = [[.12, .30], [.38, .62], [.70, .88]];   // corridors stay off the map edge
  laneY = bands.map(b => {
    let best = ((b[0] + b[1]) * .5 * TH) | 0, bc = 1e9;
    for (let gy = (b[0] * TH) | 0; gy <= (b[1] * TH) | 0; gy++)
      if (cost[gy] < bc) { bc = cost[gy]; best = gy; }
    return clamp((best + .5) * TG, 200, H - 200);
  });
  div = [(laneY[0] + laneY[1]) / 2, (laneY[1] + laneY[2]) / 2];
  CROSS = [{ y:laneY[0], type:'ford' }, { y:laneY[1], type:'bridge' }, { y:laneY[2], type:'ford' }];
}

// Gameplay still sees four elevation steps, so slopeMul, the sight bonus and the
// high-ground damage bonus all keep working untouched.
function deriveElevation() {
  for (let i = 0; i < hGrid.length; i++) {
    const h = hGrid[i];
    eGrid[i] = h > .74 ? 3 : h > .54 ? 2 : h > .33 ? 1 : 0;
  }
}

// Relief is rendered at grid resolution into a small bitmap and stretched over
// the map, so the bilinear upscale does the smoothing for us. Light comes from
// the north-west, which is what every reader expects a map to be lit from.
function reliefLayer() {
  const rc = document.createElement('canvas');
  rc.width = TW; rc.height = TH;
  const r = rc.getContext('2d');
  const img = r.createImageData(TW, TH);
  const d = img.data;
  for (let gy = 0; gy < TH; gy++)
    for (let gx = 0; gx < TW; gx++) {
      const i = gy * TW + gx;
      const hl = hGrid[gy * TW + Math.max(0, gx - 1)], hr = hGrid[gy * TW + Math.min(TW - 1, gx + 1)];
      const hu = hGrid[Math.max(0, gy - 1) * TW + gx], hd = hGrid[Math.min(TH - 1, gy + 1) * TW + gx];
      const lum = -((hr - hl) * .80 + (hd - hu) * .60) * 8.5;
      const lift = hGrid[i] * .30;             // higher ground catches more light
      const o = i * 4;
      if (lum >= 0) {
        d[o] = 255; d[o + 1] = 247; d[o + 2] = 214;
        d[o + 3] = clamp((lum * .55 + lift) * 255, 0, 150);
      } else {
        d[o] = 16; d[o + 1] = 18; d[o + 2] = 13;
        d[o + 3] = clamp((-lum * .60 - lift * .35) * 255, 0, 165);
      }
    }
  r.putImageData(img, 0, 0);
  return rc;
}

// How well a given thing suits a given piece of ground. Woods want gentle mid
// slopes away from the water, marsh wants the low flat ground beside it, rock
// wants the steep faces, crops want the flattest ground they can get, and people
// build where it is flat and the water is close but not underfoot.
const slopeAt = (x, y) => T.slopeAt(terrain, x, y);

function suitability(type, x, y) {
  const h = heightAt(x, y), sl = slopeAt(x, y);
  const wd = hasWater() ? Math.abs(x - riverXAt(y)) : 4000;
  const flat = Math.max(0, 1 - sl * 7);
  switch (type) {
    case 'forest':  return (h > .20 && h < .80 ? 1 : .25) * Math.max(.1, 1 - sl * 3) * (wd > 90 ? 1 : .35);
    case 'marsh':   return (h < .30 ? 1 : .15) * flat * (wd < 460 ? 1 : .3);
    case 'rocks':   return (h > .48 ? 1 : .35) * Math.min(1, .25 + sl * 7);
    case 'field':   return flat * (h < .62 ? 1 : .2) * (wd > 80 ? 1 : .3);
    case 'orchard': return flat * (h > .14 && h < .62 ? 1 : .3);
    case 'village': return flat * (h > .12 && h < .60 ? 1 : .2)
                         * (wd > 150 && wd < 1100 ? 1 : .45);
    default: return 1;
  }
}

// Walk uphill in suitability from where the generator dropped it. This is a
// deterministic hill-climb on purpose - no R() at all - so a feature and its
// 180-degree partner settle onto partnered ground and the map stays fair.
function settle(type, x, y, r) {
  let bx = x, by = y;
  for (let step = 0; step < 3; step++) {
    let bs = suitability(type, bx, by), nx = bx, ny = by;
    for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4;
      const px = clamp(bx + Math.cos(ang) * r, 90, W - 90);
      const py = clamp(by + Math.sin(ang) * r, 90, H - 90);
      const sc = suitability(type, px, py);
      if (sc > bs) { bs = sc; nx = px; ny = py; }
    }
    bx = nx; by = ny; r *= .55;
  }
  return { x:bx, y:by };
}

/* ===================== trees ===================== */
// Trees are entities, not paint. A tank crushes what it drives over, shellfire
// fells whole stands, and the WOOD cover bit is DERIVED from how many trunks are
// still standing in a cell - so a wood that has been shelled flat stops giving
// cover, which is most of what makes the ground feel alive.
//
// Determinism: planting happens once during genTerrain and draws from R() like
// the rest of terrain generation. Felling is pure geometry - it never touches
// R() - so two lockstep peers always fell the same trees at the same tick.
let trees = [], treeAt = new Int32Array(1), woodN = new Uint16Array(1);
let props = [];                                  // roads, yards and wells, baked into the ground
let wet = new Float32Array(1);                   // how damp each cell is, from the water that drains through it
let towns = [];                                  // the places worth connecting
let routes = [];                                 // and the ways between them
let roadMs = 0;                                  // how long they took to find
const moistureAt = (x, y) => wet[gi(x, y)];
let falling = [], treesDown = 0;
const TMP = [];

function plantTree(x, y, s, gr) {
  const t = { x, y, s, gr, dead:false, fall:0, fa:0, cells:[], next:-1 };
  const r = Math.max(TG * .55, s * .85);           // how far the crown shades the ground
  for (let gy = (((y - r) / TG) | 0); gy <= (((y + r) / TG) | 0); gy++)
    for (let gx = (((x - r) / TG) | 0); gx <= (((x + r) / TG) | 0); gx++) {
      if (gx < 0 || gy < 0 || gx >= TW || gy >= TH) continue;
      const i = gy * TW + gx;
      if (tGrid[i] & (WATER | FORD | BUILD)) continue;
      woodN[i]++; tGrid[i] |= WOOD; t.cells.push(i);
    }
  if (!t.cells.length) return null;                // nowhere to stand
  const c = gi(x, y);
  t.next = treeAt[c]; treeAt[c] = trees.length;
  trees.push(t);
  return t;
}

// Every forest blob becomes real trunks. Runs after the water, buildings and
// keeps are stamped, so nothing is planted in a river or through a wall.
function plantTrees() {
  trees = []; falling = []; treesDown = 0;
  treeAt = new Int32Array(TW * TH).fill(-1);
  woodN = new Uint16Array(TW * TH);
  for (const f of feats) {
    if (f.type === 'orchard') {                    // planted by hand, so it stands in rows
      const step = rnd(26, 34), ca = Math.cos(f.rot), sa = Math.sin(f.rot);
      for (let u = -f.rx; u <= f.rx; u += step)
        for (let v = -f.ry; v <= f.ry; v += step) {
          if ((u / f.rx) ** 2 + (v / f.ry) ** 2 > 1) continue;
          const x = f.x + ca * u - sa * v, y = f.y + sa * u + ca * v;
          const jx = rnd(-3, 3), jy = rnd(-3, 3), sz = rnd(8, 12), gr = (80 + rnd(-8, 16)) | 0;
          if (x < 4 || y < 4 || x > W - 4 || y > H - 4) continue;
          if (terrainAt(x, y) & (WATER | FORD | BUILD)) continue;
          plantTree(x + jx, y + jy, sz, gr);
        }
      continue;
    }
    if (f.type !== 'forest') continue;
    const count = clamp(f.rx * f.ry / 150, 20, 190);
    for (let i = 0; i < count; i++) {
      const a = rnd(0, 6.28), rr = Math.sqrt(R());
      const x = f.x + Math.cos(a) * f.rx * rr * .92, y = f.y + Math.sin(a) * f.ry * rr * .92;
      const s = rnd(9, 17), gr = (72 + rnd(-14, 22)) | 0;
      if (x < 4 || y < 4 || x > W - 4 || y > H - 4) continue;
      if (terrainAt(x, y) & (WATER | FORD | BUILD)) continue;
      plantTree(x, y, s, gr);
    }
  }
}

// Woodland that grew where the ground is damp enough to hold it. The blobs
// above are the woods somebody drew; this is the one the water put there, and
// it is what makes a valley read as a valley from above.
function growWoodland() {
  if (!wet || wet.length < 4) return;
  const veg = MAPS[mapType].veg || { wet: .58, density: .4 };
  const list = scatterWoodland(matchSeed, {
    TW, TH, TG, moisture: wet,
    slopeAt: i => {
      const gx = i % TW, gy = (i / TW) | 0;
      const l = hGrid[gy * TW + Math.max(0, gx - 1)], r = hGrid[gy * TW + Math.min(TW - 1, gx + 1)];
      const u = hGrid[Math.max(0, gy - 1) * TW + gx], d = hGrid[Math.min(TH - 1, gy + 1) * TW + gx];
      return Math.hypot(r - l, d - u);
    },
    open: i => (tGrid[i] & (WATER | FORD | BUILD | ROAD | STONE | CLIFF | ROCK)) === 0,
  }, veg);
  for (const t of list) {
    if (t.x < 4 || t.y < 4 || t.x > W - 4 || t.y > H - 4) continue;
    plantTree(t.x, t.y, t.s, t.gr);
  }
}

function treesNear(x, y, r) {
  TMP.length = 0;
  const x0 = clamp(((x - r - TG) / TG) | 0, 0, TW - 1), x1 = clamp(((x + r + TG) / TG) | 0, 0, TW - 1);
  const y0 = clamp(((y - r - TG) / TG) | 0, 0, TH - 1), y1 = clamp(((y + r + TG) / TG) | 0, 0, TH - 1);
  for (let gy = y0; gy <= y1; gy++)
    for (let gx = x0; gx <= x1; gx++)
      for (let n = treeAt[gy * TW + gx]; n >= 0; n = trees[n].next) {
        const t = trees[n];
        if (t.dead) continue;
        if (dist(t.x, t.y, x, y) <= r + t.s * .4) TMP.push(t);
      }
  return TMP;
}

// A tree comes down, and the cover it was giving goes with it.
function fellTree(t, ang) {
  if (!t || t.dead) return;
  t.dead = true; t.fall = 0; t.fa = ang;
  treesDown++;
  for (const i of t.cells) if (woodN[i] > 0 && --woodN[i] === 0) tGrid[i] &= ~WOOD;
  if (canopyCtx) {                                 // cut the crown out of the baked canopy
    canopyCtx.globalCompositeOperation = 'destination-out';
    canopyCtx.beginPath(); canopyCtx.arc(t.x, t.y, t.s * 1.3, 0, 6.28); canopyCtx.fill();
    canopyCtx.globalCompositeOperation = 'source-over';
  }
  if (falling.length < 90) falling.push(t);
  else layTrunk(t);
  for (let i = 0; i < 7; i++) parts.push({ x:t.x + vr(-t.s, t.s), y:t.y + vr(-t.s, t.s),
    vx:vr(-16, 16) + Math.cos(ang) * 20, vy:vr(-16, 16) + Math.sin(ang) * 20,
    t:vr(1.1, 2.4), r:vr(1.6, 3.2), type:'leaf' });
}

// Once it has finished toppling, the trunk is painted into the ground layer and
// stops costing anything to draw.
function layTrunk(t) {
  if (!decalCtx) return;
  const a = t.fa, L = t.s * 2.1;
  decalCtx.save();
  decalCtx.translate(t.x, t.y); decalCtx.rotate(a);
  decalCtx.fillStyle = 'rgba(38,30,20,.5)';
  decalCtx.fillRect(-2, -t.s * .34, L + 4, t.s * .68);
  decalCtx.fillStyle = 'rgba(74,58,38,.85)';
  decalCtx.fillRect(0, -t.s * .26, L, t.s * .52);
  decalCtx.fillStyle = `rgba(${(t.gr * .5) | 0},${(t.gr * .8) | 0},${(t.gr * .42) | 0},.6)`;
  decalCtx.beginPath(); decalCtx.ellipse(L, 0, t.s * .8, t.s * .62, 0, 0, 6.28); decalCtx.fill();
  decalCtx.restore();
  decalCtx.fillStyle = 'rgba(58,44,28,.9)';        // the stump left behind
  decalCtx.beginPath(); decalCtx.arc(t.x, t.y, t.s * .3, 0, 6.28); decalCtx.fill();
}

// One crown, drawn into whichever layer is asking for it.
function paintCrown(c, t) {
  const s = t.s, gr = t.gr;
  // A crown is not a disc. One flat circle with a highlight on it is what makes
  // a wood read as clip art, so this builds the canopy out of overlapping lobes
  // in three tones: shadowed underside, body, and the few leaves the light
  // actually reaches. The wobble is taken from where the tree stands rather than
  // from a random number, so the same wood bakes identically on every machine.
  // All of it is baked once into the canopy layer, so the extra geometry costs
  // nothing per frame.
  const w = (t.x * 0.7 + t.y * 1.3) % 6.28318;
  const dark = `rgba(${(gr * .3) | 0},${(gr * .66) | 0},${(gr * .28) | 0},.95)`;
  const mid = `rgba(${(gr * .58) | 0},${gr},${(gr * .5) | 0},.95)`;
  const lit = `rgba(${(gr * .8) | 0},${Math.min(255, (gr * 1.2) | 0)},${(gr * .64) | 0},.95)`;

  c.fillStyle = 'rgba(10,16,9,.38)';                 // shadow on the ground
  c.beginPath(); c.ellipse(t.x + s * .4, t.y + s * .48, s * 1.02, s * .62, 0, 0, 6.28); c.fill();

  c.fillStyle = dark;                                // the ragged outer mass
  for (let i = 0; i < 5; i++) {
    const a = w + i * 1.2566;
    c.beginPath();
    c.arc(t.x + Math.cos(a) * s * .4, t.y + Math.sin(a) * s * .4, s * .63, 0, 6.28);
    c.fill();
  }
  c.fillStyle = mid;                                 // the body of the canopy
  for (let i = 0; i < 4; i++) {
    const a = w * 1.7 + i * 1.5708;
    c.beginPath();
    c.arc(t.x + Math.cos(a) * s * .25, t.y + Math.sin(a) * s * .25, s * .53, 0, 6.28);
    c.fill();
  }
  c.fillStyle = lit;                                 // where the sun lands
  c.beginPath(); c.arc(t.x - s * .26, t.y - s * .3, s * .45, 0, 6.28); c.fill();
  c.fillStyle = 'rgba(198,220,158,.2)';
  c.beginPath(); c.arc(t.x - s * .36, t.y - s * .42, s * .24, 0, 6.28); c.fill();
}

// Toppling is animation only, so it rides the cosmetic clock.
function stepFalling(dt) {
  for (let i = falling.length - 1; i >= 0; i--) {
    const t = falling[i];
    t.fall += dt * 2.6;
    if (t.fall >= 1) { layTrunk(t); falling.splice(i, 1); }
  }
}

// Standing crops go down under tracks, leaving a visible path across the plot.
// Pure geometry, no R(), so both peers flatten the same cells.
function flattenCrop(x, y) {
  const i = gi(x, y);
  if (!(tGrid[i] & FIELD)) return;
  tGrid[i] &= ~FIELD;
  if (!decalCtx) return;
  decalCtx.fillStyle = 'rgba(92,80,48,.5)';
  decalCtx.beginPath();
  decalCtx.ellipse((i % TW) * TG + TG / 2, ((i / TW) | 0) * TG + TG / 2, TG * .8, TG * .62, 0, 0, 6.28);
  decalCtx.fill();
}

// Anything with an engine flattens the wood it drives through. The hull pushes
// each trunk down away from itself, so a tank leaves a visible path through a
// stand rather than a scatter of random stumps.
function crushTrees(s) {
  const list = treesNear(s.x, s.y, s.sq.t.vehicle ? 15 : 10);
  if (!list.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    fellTree(t, Math.atan2(t.y - s.y, t.x - s.x) || s.ang || 0);
  }
}

/* ===================== civilians ===================== */
// The people who live here. They are deliberately OUTSIDE the simulation: they
// never absorb a shot, never block movement, never change cover and never touch
// R(). That makes them free in lockstep - two peers can disagree about where a
// farmer is standing without the match diverging by a single tick - and it is
// why every random draw below is vr() or Math.random(), never rnd() or R().
let civs = [], gunfire = [], civT = 0;
const CIVCAP = 150;

function noteGunfire(x, y) {                     // a short memory of where the shooting is
  gunfire.push(x, y);
  if (gunfire.length > 64) gunfire.splice(0, 2);
}

function nearestPlot(x, y) {
  let best = null, bd = 1e9;
  for (const f of feats) {
    if (f.type !== 'field' && f.type !== 'orchard') continue;
    const d = dist(f.x, f.y, x, y);
    if (d < bd) { bd = d; best = f; }
  }
  return bd < 760 ? best : null;
}

function spawnCivs() {
  civs = []; gunfire = []; civT = 0;
  for (const h of buildings) {
    if (!h.home) continue;
    if (civs.length >= CIVCAP) break;
    const n = 1 + ((Math.random() * 2.3) | 0);
    for (let i = 0; i < n; i++) {
      const farmer = Math.random() < .55;
      const plot = farmer ? nearestPlot(h.x, h.y) : null;
      civs.push({
        x: h.x + vr(-24, 24), y: h.y + vr(-24, 24), hx: h.x, hy: h.y, home: h,
        px: plot ? plot.x + vr(-45, 45) : h.x + vr(-70, 70),
        py: plot ? plot.y + vr(-32, 32) : h.y + vr(-70, 70),
        job: farmer ? 'farmer' : 'villager', st: 'work', out: 1, t: vr(0, 4),
        spd: vr(14, 23), ang: vr(0, 6.28), ph: vr(0, 6.28), calm: 0, alive: true,
      });
    }
  }
}

function stepCivs(dt) {
  if (!civs.length) return;
  civT -= dt;
  const scan = civT <= 0;
  if (scan) civT = .4;
  for (let i = civs.length - 1; i >= 0; i--) {
    const c = civs[i];
    if (!c.alive) { civs.splice(i, 1); continue; }
    if (scan) {
      let near = false;
      for (let k = 0; k < gunfire.length; k += 2) {
        const dx = gunfire[k] - c.x, dy = gunfire[k + 1] - c.y;
        if (dx * dx + dy * dy < 250000) { near = true; break; }   // shooting within ~500
      }
      if (c.home.dead) c.st = 'flee';              // no house left to run back to
      else if (near) { if (c.st === 'work') c.st = 'alarm'; c.calm = 0; }
      else if (c.st === 'alarm' || c.st === 'cower') {
        c.calm += .4;
        if (c.calm > 8) { c.st = 'work'; c.calm = 0; }
      }
    }
    let tx, ty, sp = c.spd;
    if (c.st === 'cower') { c.ph += dt * 1.4; continue; }
    if (c.st === 'flee') { tx = c.x < W / 2 ? -90 : W + 90; ty = c.y; sp = c.spd * 2.4; }
    else if (c.st === 'alarm') {
      if (dist(c.x, c.y, c.hx, c.hy) < 15) { c.st = 'cower'; continue; }
      tx = c.hx; ty = c.hy; sp = c.spd * 2.1;
    } else {
      tx = c.out ? c.px : c.hx; ty = c.out ? c.py : c.hy;
      if (dist(c.x, c.y, tx, ty) < 13) {           // arrived: work the plot, then head back
        c.t -= dt; c.ph += dt * 2.6;
        if (c.t <= 0) { c.out = c.out ? 0 : 1; c.t = vr(4, 11); }
        continue;
      }
    }
    const a = Math.atan2(ty - c.y, tx - c.x);
    let d = a - c.ang;
    while (d > Math.PI) d -= 6.283185;
    while (d < -Math.PI) d += 6.283185;
    c.ang += d * Math.min(1, dt * 7);
    const nx = c.x + Math.cos(c.ang) * sp * dt, ny = c.y + Math.sin(c.ang) * sp * dt;
    if (!(terrainAt(nx, ny) & (WATER | CLIFF))) { c.x = nx; c.y = ny; }
    c.ph += dt * 7;
    if (c.st === 'flee' && (c.x < -70 || c.x > W + 70)) c.alive = false;
  }
}

// Caught in the fighting. Cosmetic only - nothing here feeds back into the sim.
function killCivsNear(x, y, r) {
  if (!civs.length || r <= 0) return;
  const r2 = r * r;
  for (const c of civs) {
    if (!c.alive) continue;
    const dx = c.x - x, dy = c.y - y;
    if (dx * dx + dy * dy > r2) continue;
    c.alive = false;
    burst(c.x, c.y, 3, 'spark');
    if (decalCtx) {
      decalCtx.fillStyle = 'rgba(92,26,20,.5)';
      decalCtx.beginPath();
      decalCtx.ellipse(c.x, c.y, vr(5, 8), vr(3, 6), vr(0, 3), 0, 6.28);
      decalCtx.fill();
    }
  }
}

function drawCivs() {
  if (!civs.length) return;
  const eyes = visionEyes, side = viewTeam() === 'blue' ? -1 : 1;
  for (const c of civs) {
    if (!c.alive) continue;
    if (c.x < vx0 || c.x > vx1 || c.y < vy0 || c.y > vy1) continue;
    if ((c.x - W / 2) * side > 0) {               // enemy ground: only if something sees it
      let on = false;
      for (let e = 0; e < eyes.length; e += 3) {
        const dx = c.x - eyes[e], dy = c.y - eyes[e + 1], r = eyes[e + 2];
        if (dx * dx + dy * dy < r * r) { on = true; break; }
      }
      if (!on) continue;
    }
    const down = c.st === 'cower';
    const bob = down ? 0 : Math.sin(c.ph) * 1.15;
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(c.x + 1, c.y + 3, 3.6, 2, 0, 0, 6.28); ctx.fill();
    if (down) {                                   // flat against the wall
      ctx.fillStyle = c.job === 'farmer' ? '#6E5A34' : '#4B4A46';
      ctx.beginPath(); ctx.ellipse(c.x, c.y, 4.4, 2.4, c.ang, 0, 6.28); ctx.fill();
      continue;
    }
    ctx.fillStyle = c.job === 'farmer' ? '#6E5A34' : '#4B4A46';
    ctx.fillRect(c.x - 1.7, c.y - 5 + bob, 3.4, 5.4);
    ctx.fillStyle = c.job === 'farmer' ? '#C9AF73' : '#B7A78B';
    ctx.beginPath(); ctx.arc(c.x, c.y - 6.5 + bob, 1.95, 0, 6.28); ctx.fill();
    if (c.job === 'farmer' && c.st === 'work') {  // a tool over the shoulder
      ctx.strokeStyle = 'rgba(84,64,38,.9)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c.x + 2, c.y - 6 + bob); ctx.lineTo(c.x + 4.4, c.y + 1 + bob);
      ctx.stroke();
    }
  }
}

/* ===================== terrain generation ===================== */
function stampFeat(f){
  f.rx*=FS; f.ry*=FS;                              // one scale for the whole terrain
  // forest and orchard lay down no WOOD here: plantTrees() derives it from trunks
  const bit={forest:0,orchard:0,field:FIELD,marsh:MARSH,rocks:ROCK,hill:0}[f.type];
  const x0=clamp(((f.x-f.rx)/TG)|0,0,TW-1),x1=clamp(((f.x+f.rx)/TG)|0,0,TW-1);
  const y0=clamp(((f.y-f.ry)/TG)|0,0,TH-1),y1=clamp(((f.y+f.ry)/TG)|0,0,TH-1);
  for(let gy=y0;gy<=y1;gy++) for(let gx=x0;gx<=x1;gx++){
    const x=gx*TG+TG/2,y=gy*TG+TG/2,dx=x-f.x,dy=y-f.y;
    const rx=Math.cos(f.rot)*dx+Math.sin(f.rot)*dy,ry=-Math.sin(f.rot)*dx+Math.cos(f.rot)*dy;
    const q=(rx/f.rx)**2+(ry/f.ry)**2;
    if(q>1) continue;
    const i=gy*TW+gx;
    tGrid[i]|=bit;                                 // hills are relief now, not stamps
  }
}
function genTerrain(){
  srand(matchSeed);
  feats=[]; buildings=[]; fires=[]; props=[];
  terrain=T.makeTerrain(W,H,TG);
  tGrid=terrain.flags; eGrid=terrain.elev; cGrid=terrain.churn; hGrid=terrain.height;
  pGrid=new Uint8Array(TW*TH);
  const M=MAPS[mapType];

  buildRelief();        // the land itself: noise bent into this map's landform
  traceRiver();         // water finds the low line and cuts its channel
  deriveLanes();        // the three sectors, where crossing actually costs least
  deriveElevation();    // four gameplay steps, quantised off the height field
  // Where the water goes. Everything damp on this map is a consequence of the
  // height field, not a decision: rain runs downhill, gathers, and the ground
  // it gathers in is the ground things grow on.
  wet = hydrology(hGrid, TW, TH).moisture;
  towns = []; routes = [];

  if(mapType==='villages') genFarmland();
  else if(mapType==='mountains') genMountains();
  else if(mapType==='beach') genBeach();
  else if(mapType==='city') genCity();
  else genDesert();

  feats=feats.filter(f=>f.type!=='hill');   // relief comes from the height field now
  for(const f of feats){                   // nothing sits where it could not have grown
    const at=settle(f.type,f.x,f.y,175);
    f.x=at.x; f.y=at.y;
  }
  for(const f of feats) stampFeat(f);
  if(M.water!=='none') carveWater();
  stampBuildings();

  // the two keeps — each host must hold its own
  castles=[];
  for(const team of ['blue','red']){
    const cx=team==='blue'?106:W-106, cy=H/2;
    const hp=team===defender?36000:14000;      // the ground being defended is dug in
    const c={team,x:cx,y:cy,hw:88,hh:114,hp,max:hp,dead:false,cd:rnd(0,2),burn:0};
    castles.push(c);
    for(let gy=(((cy-c.hh)/TG)|0);gy<=(((cy+c.hh)/TG)|0);gy++)
      for(let gx=(((cx-c.hw)/TG)|0);gx<=(((cx+c.hw)/TG)|0);gx++){
        if(gx<0||gy<0||gx>=TW||gy>=TH) continue;
        const i=gy*TW+gx;
        tGrid[i]&=~(WOOD|MARSH|ROCK|WATER|FORD); tGrid[i]|=BUILD; eGrid[i]=1;
      }
  }
  // ---- five military bases a side: places to hold, and to attack from ----
  bases=[];
  for(const team of ['blue','red']){
    const side=team==='blue'?1:-1;
    const spots=[
      [team==='blue'?W*.31:W*.69,laneY[0]],          // forward, one per sector
      [team==='blue'?W*.33:W*.67,laneY[1]],
      [team==='blue'?W*.31:W*.69,laneY[2]],
      [team==='blue'?W*.16:W*.84,H*.30],              // two in the rear
      [team==='blue'?W*.16:W*.84,H*.70]
    ];
    spots.forEach((sp,i)=>{
      let x=sp[0],y=clamp(sp[1]+rnd(-90,90),160,H-160);
      for(let k=0;k<20&&(solid(x,y)||(hasWater()&&Math.abs(x-riverXAt(y))<260));k++){
        x-=side*70; y=clamp(y+rnd(-60,60),160,H-160);
      }
      const b={team,x,y,r:150,hp:3200,max:3200,cap:0,dead:false,i,
               name:(i<3?['North','Centre','South'][i]:['Depot','Yard'][i-3])};
      bases.push(b);
      for(let gy=(((y-96)/TG)|0);gy<=(((y+96)/TG)|0);gy++)
        for(let gx=(((x-108)/TG)|0);gx<=(((x+108)/TG)|0);gx++){
          if(gx<0||gy<0||gx>=TW||gy>=TH) continue;
          const idx=gy*TW+gx;
          tGrid[idx]&=~(WOOD|MARSH|WATER|FORD); tGrid[idx]|=STONE;
        }
      // blast walls on the flanks, leaving the face open
      for(const oy of [-88,88]) walls.push({team:'none',fixed:true,x,y:y+oy,a:0,len:170,
        hp:9e9,max:9e9,dead:false,rubble:true});
      buildings.push({x:x-52,y:y-40,w:52,h:38,rot:0,bunker:true});
      buildings.push({x:x+54,y:y+36,w:46,h:34,rot:0,bunker:true});
    });
  }
  layRoads();                                  // the ways between the places that matter

  // ---- weather, wildlife, hearth smoke ----
  wind={a:rnd(0,6.28),v:rnd(.7,1.5)};
  sky = mapType==='desert' ? (R()<.55?'dust':'clear')
      : mapType==='beach'  ? (R()<.5?'spray':'clear')
      : mapType==='mountains' ? (R()<.6?'snow':'clear')
      : (R()<.45?'rain':'clear');
  weather=[]; rings=[]; plumes=[];
  clouds=[];
  for(let i=0;i<8;i++) clouds.push({x:rnd(-300,W),y:rnd(-100,H),
    rx:rnd(200,420),ry:rnd(120,240),v:rnd(6,16),a:rnd(.06,.13)});
  birds=[];
  for(let i=0;i<5;i++) birds.push({x:rnd(0,W),y:rnd(70,H-70),
    v:rnd(30,55)*(R()<.5?-1:1),ph:rnd(0,6.28),n:3+((R()*4)|0),sp:rnd(9,15)});
  for(const b of buildings) b.hearth=R()<.45;
  plantTrees();                                // trunks last: nothing planted in water or through a wall
  growWoodland();                              // and the wood the water grew
  spawnCivs();                                 // and the people who live here
  bakeTerrain();
  tGrid0=tGrid.slice();                        // the pristine ground, for save diffs
  worldId++; ruinsN=0;                         // a new world for the 3D renderer to build
}
// Lay the road network.
//
// Roads are not drawn on this map, they are FOUND: the cheapest way between
// two places that matter, over ground that charges for every metre of climb
// and a great deal for water. That is why they swing round the steep ground,
// take the narrow place to cross, and join each other instead of running side
// by side - none of which is written down anywhere here.
function layRoads(){
  const T0=Date.now();
  const nodes=[];
  for(const c of castles) nodes.push({x:c.x,y:c.y,rank:0});
  for(const t of towns)   nodes.push({x:t.x,y:t.y,rank:2});
  for(const b of bases)   nodes.push({x:b.x,y:b.y,rank:1});
  if(nodes.length<2){ routes=[]; return; }
  const slopeCell=i=>{
    const gx=i%TW, gy=(i/TW)|0;
    const l=hGrid[gy*TW+Math.max(0,gx-1)], r=hGrid[gy*TW+Math.min(TW-1,gx+1)];
    const u=hGrid[Math.max(0,gy-1)*TW+gx], d=hGrid[Math.min(TH-1,gy+1)*TW+gx];
    return Math.hypot(r-l,d-u);
  };
  const net=layNetwork(nodes,{TW,TH,TG,
    slopeAt:slopeCell,
    isWater:i=>(tGrid[i]&(WATER|FORD))!==0,
    // the fords and the bridge the battlefield was laid out around
    crossable:i=>{ const x=(i%TW)*TG+TG/2, y=((i/TW)|0)*TG+TG/2;
      for(const c of CROSS) if(Math.abs(y-c.y)<150) return true;
      return false; },
    blocked:i=>(tGrid[i]&CLIFF)!==0,
    roaded:i=>(tGrid[i]&ROAD)!==0});
  routes=net.routes; roadMs=Date.now()-T0;   // what it cost, for the probes
  for(const r of routes){
    for(let i=0;i<r.pts.length-1;i++){
      const a=r.pts[i], b=r.pts[i+1];
      const dx=b[0]-a[0], dy=b[1]-a[1], len=Math.hypot(dx,dy);
      if(len<0.01) continue;
      // Wide enough to be a road: the ground is stored in cells of 22, so a
      // narrower line than this is a road nobody can see and armour cannot find.
      stampLine((a[0]+b[0])/2,(a[1]+b[1])/2,Math.atan2(dy,dx),len+TG,15,ROAD);
    }
    props.push({kind:'route',pts:r.pts,crossings:r.crossings});
  }
}
function stampBuildings(){
  bGrid=new Int32Array(TW*TH).fill(-1);
  for(let n=0;n<buildings.length;n++){
    const b=buildings[n];
    b.hold=null; b.blue=0; b.red=0; b.tint=0; b.dead=false;
    b.max=b.bunker?2800:b.city?2000:1100; b.hp=b.max;
    for(let gy=((b.y-b.h/2)/TG|0);gy<=((b.y+b.h/2)/TG|0);gy++)
      for(let gx=((b.x-b.w/2)/TG|0);gx<=((b.x+b.w/2)/TG|0);gx++){
        if(gx<0||gy<0||gx>=TW||gy>=TH) continue;
        tGrid[gy*TW+gx]|=BUILD; bGrid[gy*TW+gx]=n;
      }
  }
}
// who is inside which building
let occT=0;
function stepOccupancy(dt){
  occT-=dt; if(occT>0) return; occT=.4;
  for(let i=0;i<buildings.length;i++){ buildings[i].blue=0; buildings[i].red=0; }
  for(let i=0;i<soldiers.length;i++){
    const s=soldiers[i];
    if(!s.alive||s.sq.t.vehicle||s.sq.t.kind==='siege') continue;
    const n=bGrid[gi(s.x,s.y)];
    if(n<0) continue;
    if(s.sq.team==='blue') buildings[n].blue++; else buildings[n].red++;
  }
  for(let i=0;i<buildings.length;i++){
    const b=buildings[i];
    if(b.dead){ b.hold=null; b.tint=0; continue; }
    const h=b.blue>b.red?'blue':b.red>b.blue?'red':(b.blue?b.hold:null);
    if(h!==b.hold&&(b.blue||b.red)) b.hold=h;
    const held=b.hold&&(b.blue||b.red);
    b.tint=clamp(b.tint+(held?dt*2.2+.4:-(dt*2.2+.25)),0,1);
    if(!b.blue&&!b.red&&b.tint<=0) b.hold=null;
  }
}
const blob=(x,y,rx,ry,flag)=>T.stampBlob(terrain,x,y,rx*FS,ry*FS,flag);
// A village is a place, not a scatter of boxes. One track runs through it, the
// houses stand square to that track with a yard behind each, there are barns and
// a well, and the land around it is worked: an orchard on one flank and crop
// fields on the other. Everything here is generation-time, so it all rides R().
function village(cx,cy,houses,rx,ry){
  const at=settle('village',cx,cy,200);      // flat ground, water close but not underfoot
  cx=at.x; cy=at.y;
  blob(cx,cy,rx,ry,STONE);
  const RX=rx*FS,RY=ry*FS;
  const road=rnd(0,3.14),ca=Math.cos(road),sa=Math.sin(road);
  towns.push({x:cx,y:cy,rank:2});                 // somewhere the roads will want to reach
  const rw=rnd(15,22);
  props.push({kind:'road',x:cx,y:cy,a:road,len:RX*2.25,w:rw});
  stampLine(cx,cy,road,RX*2.25,rw*.5,ROAD);      // metalled: armour rolls, and it never turns to mud

  const n=Math.max(3,Math.round(houses*1.5));
  for(let i=0;i<n;i++){
    const along=(n<2?0:(i/(n-1))*2-1)*.84+rnd(-.05,.05);
    const side=(i%2)?1:-1;                          // alternate down the two frontages
    const off=rnd(42,76);
    const hx=cx+ca*RX*along-sa*side*off, hy=cy+sa*RX*along+ca*side*off;
    if(hx<60||hy<60||hx>W-60||hy>H-60) continue;
    buildings.push({x:hx,y:hy,w:rnd(36,54),h:rnd(28,40),rot:road,home:true});
    // the yard sits behind the house, away from the road
    const yd=rnd(34,50);
    props.push({kind:'yard',x:hx-sa*side*yd,y:hy+ca*side*yd,
      rx:rnd(24,34),ry:rnd(18,26),a:road});
    if(R()<.5) buildings.push({x:hx+ca*rnd(-26,26)-sa*side*rnd(50,68),
      y:hy+sa*rnd(-26,26)+ca*side*rnd(50,68),w:rnd(28,42),h:rnd(20,30),rot:road,barn:true});
  }
  props.push({kind:'well',x:cx+rnd(-18,18),y:cy+rnd(-18,18),r:rnd(7,10)});

  // worked land on the outskirts: an orchard one side, crop plots the other.
  // Ruined city blocks are not farmed.
  const oside=R()<.5?1:-1;
  if(mapType==='city') return;
  feats.push({type:'orchard',x:cx-sa*oside*(RY+rnd(70,110)),y:cy+ca*oside*(RY+rnd(70,110)),
    rx:rnd(70,105),ry:rnd(46,70),rot:road});
  const plots=2+((R()*3)|0);
  for(let i=0;i<plots;i++){
    const fa=road+rnd(-.5,.5);
    const d=RY+rnd(80,190),sd=-oside;
    const fx=cx+ca*rnd(-RX*.9,RX*.9)-sa*sd*d, fy=cy+sa*rnd(-RX*.9,RX*.9)+ca*sd*d;
    if(fx<80||fy<80||fx>W-80||fy>H-80) continue;
    feats.push({type:'field',x:fx,y:fy,rx:rnd(72,124),ry:rnd(50,86),rot:fa,
      crop:(R()*3)|0,rows:rnd(9,15)});
  }
}
function carveWater(){
  const canal=MAPS[mapType].water==='canal';
  for(let gy=0;gy<TH;gy++){
    const y=gy*TG+TG/2,rx=riverXAt(y);
    const c=crossFor(y),near=Math.abs(y-c.y)<(c.type==='bridge'?128:78)*FS;
    for(let gx=0;gx<TW;gx++){
      const x=gx*TG+TG/2,d=Math.abs(x-rx),i=gy*TW+gx;
      if(d<(canal?30:38)*FS){
        eGrid[i]=0; tGrid[i]&=~(WOOD|ROCK|BUILD);
        if(near){ if(c.type==='ford') tGrid[i]|=FORD; }
        else tGrid[i]|=WATER;
      } else if(d<(canal?44:58)*FS&&!near){ tGrid[i]|=canal?STONE:MARSH; }
    }
  }
}
function laneBelts(kind,step,skipRiver){
  for(const dy of div){
    for(let x=70;x<W-70;x+=step*FS){
      if(GAPS.some(g=>Math.abs(g[0]-dy)<2&&Math.abs(g[1]-x)<220*FS)) continue;
      if(skipRiver&&Math.abs(x-riverXAt(dy))<180*FS) continue;
      feats.push({type:typeof kind==='function'?kind():kind,x,y:dy+rnd(-14,14),
        rx:rnd(78,112),ry:rnd(44,66),rot:rnd(0,3.14)});
    }
  }
}
function genFarmland(){
  laneBelts(()=>R()<.58?'forest':'rocks',132,true);
  for(const cy of laneY){
    const n=3+Math.floor(R()*2);
    for(let i=0;i<n;i++){
      const type=['hill','forest','hill','rocks','marsh'][Math.floor(R()*5)];
      const x=rnd(330,W/2-280),y=clamp(cy+rnd(-140,140),90,H-90);
      const rx=rnd(130,235),ry=rnd(78,138),rot=rnd(0,3.14);
      feats.push({type,x,y,rx,ry,rot}); feats.push({type,x:W-x,y:H-y,rx,ry,rot:-rot});
    }
    const hx=rnd(460,W/2-340);
    feats.push({type:'hill',x:hx,y:cy+rnd(-80,80),rx:rnd(175,240),ry:rnd(110,150),rot:rnd(0,3.14)});
    feats.push({type:'hill',x:W-hx,y:cy+rnd(-80,80),rx:rnd(175,240),ry:rnd(110,150),rot:rnd(0,3.14)});
  }
  for(const cy of [laneY[0],laneY[2]]){
    const vx=rnd(820,W/2-440),vy=clamp(cy+rnd(-90,90),140,H-140);
    village(vx,vy,6+((R()*4)|0),178,130);
    village(W-vx,H-vy,6+((R()*4)|0),178,130);
  }
}
function genMountains(){
  // ridge walls along the sector lines, leaving the passes open
  for(const dy of div){
    for(let x=40;x<W-40;x+=70){
      if(GAPS.some(g=>Math.abs(g[0]-dy)<2&&Math.abs(g[1]-x)<170)) continue;
      const rx=rnd(58,88),ry=rnd(46,72),y=dy+rnd(-20,20);
      feats.push({type:'hill',x,y,rx:rx*1.5,ry:ry*1.5,rot:rnd(0,3.14)});
      feats.push({type:'rocks',x,y,rx,ry,rot:rnd(0,3.14)});
      blob(x,y,rx*.62,ry*.62,CLIFF);                 // sheer rock, impassable
    }
  }
  for(const cy of laneY){
    for(let i=0;i<5;i++){
      const x=rnd(300,W/2-260),y=clamp(cy+rnd(-190,190),90,H-90);
      const rx=rnd(150,250),ry=rnd(90,150),rot=rnd(0,3.14);
      feats.push({type:'hill',x,y,rx,ry,rot}); feats.push({type:'hill',x:W-x,y:H-y,rx,ry,rot:-rot});
      feats.push({type:'rocks',x,y,rx:rx*.5,ry:ry*.5,rot});
      feats.push({type:'rocks',x:W-x,y:H-y,rx:rx*.5,ry:ry*.5,rot:-rot});
    }
    const px=rnd(700,W/2-380);
    feats.push({type:'forest',x:px,y:cy+rnd(-70,70),rx:rnd(90,150),ry:rnd(60,100),rot:rnd(0,3)});
    feats.push({type:'forest',x:W-px,y:H-cy+rnd(-70,70),rx:rnd(90,150),ry:rnd(60,100),rot:rnd(0,3)});
  }
  const vx=rnd(760,W/2-460);                          // a mountain hamlet each side
  village(vx,laneY[1]+rnd(-60,60),5,150,110);
  village(W-vx,H-laneY[1]+rnd(-60,60),5,150,110);
}
function genBeach(){
  for(let gy=0;gy<TH;gy++) for(let gx=0;gx<TW;gx++){
    const y=gy*TG+TG/2,i=gy*TW+gx;
    if(y>H-70) tGrid[i]|=WATER;                       // the sea along the southern edge
    else if(y>H-130) tGrid[i]|=FORD;                  // surf line
  }
  for(const cy of [laneY[0],laneY[1]]){             // dune ridges
    for(let i=0;i<5;i++){
      const x=rnd(250,W/2-240),y=clamp(cy+rnd(-130,130),90,H-220);
      const rx=rnd(160,260),ry=rnd(60,100),rot=rnd(-.4,.4);
      feats.push({type:'hill',x,y,rx,ry,rot}); feats.push({type:'hill',x:W-x,y:H-y,rx,ry,rot:-rot});
    }
  }
  laneBelts(()=>R()<.5?'rocks':'hill',150,true);
  for(let i=0;i<7;i++){                               // beach obstacles and bunkers
    const x=rnd(300,W/2-300),y=rnd(H*.62,H-190);
    buildings.push({x,y,w:rnd(34,50),h:rnd(26,36),rot:rnd(-.2,.2),bunker:true});
    buildings.push({x:W-x,y:H-y,w:rnd(34,50),h:rnd(26,36),rot:rnd(-.2,.2),bunker:true});
  }
  const vx=rnd(700,W/2-420);                          // a seaside village above the dunes
  village(vx,laneY[0],6,170,120); village(W-vx,H-laneY[0],6,170,120);
  for(let i=0;i<6;i++){                               // scrub above the tide line
    const x=rnd(300,W/2-280),y=rnd(120,H*.5);
    feats.push({type:'forest',x,y,rx:rnd(70,120),ry:rnd(50,90),rot:rnd(0,3)});
    feats.push({type:'forest',x:W-x,y:H-y,rx:rnd(70,120),ry:rnd(50,90),rot:rnd(0,3)});
  }
}
function genCity(){
  // ---- the main city: a compact core straddling the canal on the centre lane ----
  const coreX0=W*.34,coreX1=W*.66,coreY0=laneY[1]-620,coreY1=laneY[1]+620;
  const roadX=360,roadY=300;                       // wide avenues between the blocks
  for(let bx=coreX0;bx<coreX1;bx+=roadX){
    for(let by=coreY0;by<coreY1;by+=roadY){
      if(Math.abs(bx-W/2)<130*FS) continue;        // canal banks stay clear
      if(R()<.18) continue;              // an empty lot or a park
      const cx=bx+rnd(-18,18),cy=by+rnd(-16,16);
      blob(cx,cy,110,88,STONE);
      const n=2+((R()*2)|0);             // only a couple of blocks per lot
      for(let k=0;k<n;k++)
        buildings.push({x:cx+(k%2?58:-58)+rnd(-10,10),y:cy+(k>1?54:-54)+rnd(-10,10),
          w:rnd(62,86),h:rnd(38,54),rot:0,city:true});
      if(R()<.28) walls.push({team:'none',fixed:true,x:cx+rnd(-90,90),y:cy+rnd(-70,70),
        len:70,hp:9e9,max:9e9,dead:false,rubble:true});
      if(R()<.3) feats.push({type:'rocks',x:cx+rnd(-70,70),y:cy+rnd(-50,50),
        rx:rnd(34,58),ry:rnd(26,42),rot:rnd(0,3)});
    }
  }
  // ---- outskirts: small villages and lone houses along the wing lanes ----
  for(const li of [0,2]){
    const cy=laneY[li];
    for(let i=0;i<3;i++){
      const vx=rnd(600,W/2-500)+i*140;
      const vy=clamp(cy+rnd(-220,220),140,H-140);
      village(vx,vy,3,110,80);
      village(W-vx,H-vy,3,110,80);
    }
    for(let x=460;x<W/2-300;x+=rnd(420,760)){      // farmhouses strung along the road
      const y=clamp(cy+rnd(-150,150),120,H-120);
      buildings.push({x,y,w:rnd(42,60),h:rnd(32,44),rot:rnd(-.3,.3)});
      buildings.push({x:W-x,y:H-y,w:rnd(42,60),h:rnd(32,44),rot:rnd(-.3,.3)});
      if(R()<.5){
        buildings.push({x:x+rnd(-70,70),y:y+rnd(50,90),w:rnd(30,44),h:rnd(24,34),rot:rnd(-.3,.3)});
        buildings.push({x:W-x+rnd(-70,70),y:H-y-rnd(50,90),w:rnd(30,44),h:rnd(24,34),rot:rnd(-.3,.3)});
      }
    }
    for(let i=0;i<3;i++){                          // fields, hedges and copses between them
      const x=rnd(420,W/2-360),y=clamp(cy+rnd(-240,240),120,H-120);
      feats.push({type:'forest',x,y,rx:rnd(90,150),ry:rnd(60,105),rot:rnd(0,3)});
      feats.push({type:'forest',x:W-x,y:H-y,rx:rnd(90,150),ry:rnd(60,105),rot:rnd(0,3)});
    }
    const hx=rnd(520,W/2-420);
    feats.push({type:'hill',x:hx,y:cy+rnd(-120,120),rx:rnd(170,240),ry:rnd(110,150),rot:rnd(0,3)});
    feats.push({type:'hill',x:W-hx,y:cy+rnd(-120,120),rx:rnd(170,240),ry:rnd(110,150),rot:rnd(0,3)});
  }
  feats.push({type:'hill',x:W*.22,y:laneY[1],rx:230,ry:140,rot:0});
  feats.push({type:'hill',x:W*.78,y:laneY[1],rx:230,ry:140,rot:0});
}
function genDesert(){
  for(const cy of laneY){                            // long dunes
    for(let i=0;i<4;i++){
      const x=rnd(280,W/2-260),y=clamp(cy+rnd(-140,140),90,H-90);
      const rx=rnd(210,320),ry=rnd(70,110),rot=rnd(-.35,.35);
      feats.push({type:'hill',x,y,rx,ry,rot}); feats.push({type:'hill',x:W-x,y:H-y,rx,ry,rot:-rot});
    }
    const rx2=rnd(420,W/2-340);                       // rocky outcrops
    feats.push({type:'rocks',x:rx2,y:cy+rnd(-90,90),rx:rnd(90,150),ry:rnd(60,100),rot:rnd(0,3)});
    feats.push({type:'rocks',x:W-rx2,y:cy+rnd(-90,90),rx:rnd(90,150),ry:rnd(60,100),rot:rnd(0,3)});
  }
  laneBelts('rocks',190,false);
  // the dry wadi: a soft-sand channel down the middle, crossable but slow
  for(let gy=0;gy<TH;gy++){
    const y=gy*TG+TG/2,rx=riverXAt(y);
    for(let gx=0;gx<TW;gx++){
      const x=gx*TG+TG/2,d=Math.abs(x-rx),i=gy*TW+gx;
      if(d<52){ eGrid[i]=0; tGrid[i]&=~(WOOD|ROCK); tGrid[i]|=MARSH; }
    }
  }
  const ox=rnd(620,W/2-420);                          // oasis and a walled compound
  for(const cx of [ox,W-ox]){
    const oy=laneY[1]+rnd(-120,120);
    feats.push({type:'forest',x:cx,y:oy,rx:120,ry:90,rot:rnd(0,3)});
    village(cx,oy,4,140,100);
  }
  const vx=rnd(800,W/2-460);
  village(vx,laneY[2],5,160,115); village(W-vx,H-laneY[2],5,160,115);
}
function bakeTerrain(){
  const g0=document.createElement('canvas'); g0.width=Math.ceil(W*BAKE); g0.height=Math.ceil(H*BAKE);
  const g=g0.getContext('2d');
  g.setTransform(BAKE,0,0,BAKE,0,0);
  const M=MAPS[mapType];
  const grd=g.createLinearGradient(0,0,W*.3,H);
  grd.addColorStop(0,M.pal[0]); grd.addColorStop(.45,M.pal[1]); grd.addColorStop(1,M.pal[2]);
  g.fillStyle=grd; g.fillRect(0,0,W,H);
  g.imageSmoothingEnabled=true;                 // real light on real slopes
  g.drawImage(reliefLayer(),0,0,W,H);
  // The worked countryside: a patchwork of plots with hedges and ploughing,
  // laid down before anything is stamped on it so woods, villages and water
  // sit ON the land rather than beside it. Skipped where farming would be
  // absurd - nobody ploughs a city block or a dune field.
  if(mapType!=='city'&&mapType!=='desert'&&mapType!=='beach'){
    landuse=makeLanduse(matchSeed,W,H,{minSide:mapType==='mountains'?420:300});
    paintLanduse(g,landuse,MAPS[mapType].pal[0],{alpha:mapType==='mountains'?.34:.5});
  } else landuse=null;
  if(mapType==='city'){                                   // wide avenues through the core
    const x0=W*.34,x1=W*.66,y0=laneY[1]-620,y1=laneY[1]+620;
    g.strokeStyle='rgba(30,30,28,.38)'; g.lineWidth=46;
    for(let x=x0;x<=x1;x+=360){ g.beginPath(); g.moveTo(x-180,y0-160); g.lineTo(x-180,y1+160); g.stroke(); }
    for(let y=y0;y<=y1;y+=300){ g.beginPath(); g.moveTo(x0-200,y-150); g.lineTo(x1+200,y-150); g.stroke(); }
    g.strokeStyle='rgba(206,200,170,.18)'; g.lineWidth=2.6; g.setLineDash([26,26]);
    for(let x=x0;x<=x1;x+=360){ g.beginPath(); g.moveTo(x-180,y0-160); g.lineTo(x-180,y1+160); g.stroke(); }
    for(let y=y0;y<=y1;y+=300){ g.beginPath(); g.moveTo(x0-200,y-150); g.lineTo(x1+200,y-150); g.stroke(); }
    g.setLineDash([]);
    g.strokeStyle='rgba(120,106,74,.20)'; g.lineWidth=34;   // roads out to the villages
    for(const cy of [laneY[0],laneY[2]]){
      g.beginPath(); g.moveTo(0,cy+rnd(-20,20));
      g.bezierCurveTo(W*.3,cy+rnd(-50,50),W*.7,cy+rnd(-50,50),W,cy+rnd(-20,20)); g.stroke();
    }
    g.beginPath(); g.moveTo(0,laneY[1]); g.lineTo(W,laneY[1]); g.stroke();
  }
  if(mapType==='desert'||mapType==='beach'){              // wind ripples in the sand
    g.strokeStyle=mapType==='desert'?'rgba(226,206,152,.13)':'rgba(226,214,178,.14)';
    g.lineWidth=2;
    for(let i=0;i<420;i++){ const x=rnd(0,W),y=rnd(0,H);
      g.beginPath(); g.moveTo(x-26,y); g.quadraticCurveTo(x,y-rnd(3,8),x+26,y); g.stroke(); }
  }
  for(let i=0;i<620;i++){ const x=rnd(0,W),y=rnd(0,H),r=rnd(34,150);
    g.fillStyle=R()<.5?M.mottle[0]:M.mottle[1];
    g.beginPath(); g.ellipse(x,y,r,r*rnd(.35,.7),rnd(0,3.14),0,6.28); g.fill(); }
  // Fine grain. The mottling above varies the ground at the scale of a field,
  // and with nothing an order of magnitude smaller under it the result reads as
  // paint rather than as earth. Drawn with vr(), the cosmetic generator, not
  // R(): this is texture that never reaches the simulation, and keeping it off
  // the seeded stream means the determinism hashes do not move for it. Baked
  // once, so ten thousand specks cost nothing per frame.
  g.globalAlpha=.42;
  for(let i=0;i<9000;i++){
    const x=vr(0,W),y=vr(0,H),r=vr(1.4,5.2);
    g.fillStyle=vr(0,1)<.5?M.mottle[0]:M.mottle[1];
    g.beginPath(); g.ellipse(x,y,r,r*vr(.5,1),vr(0,3.14),0,6.28); g.fill();
  }
  g.globalAlpha=.16;                              // a little dark speckle for depth
  g.fillStyle='#1B1D16';
  for(let i=0;i<3200;i++){
    const x=vr(0,W),y=vr(0,H),r=vr(.9,2.6);
    g.beginPath(); g.ellipse(x,y,r,r*vr(.5,1),0,0,6.28); g.fill();
  }
  g.globalAlpha=1;
  if(mapType!=='city'){
    g.strokeStyle=mapType==='desert'?'rgba(150,128,84,.20)':'rgba(120,106,74,.18)';
    g.lineWidth=30; g.lineCap='round';
    for(const cy of laneY){ g.beginPath(); g.moveTo(0,cy+rnd(-20,20));
      g.bezierCurveTo(W*.3,cy+rnd(-40,40),W*.7,cy+rnd(-40,40),W,cy+rnd(-20,20)); g.stroke(); }
  }

  const cn=document.createElement('canvas'); cn.width=Math.ceil(W*BAKE); cn.height=Math.ceil(H*BAKE);
  const c=cn.getContext('2d'); c.setTransform(BAKE,0,0,BAKE,0,0);
  const shape=(cx,f,k)=>{cx.save();cx.translate(f.x,f.y);cx.rotate(f.rot);
    cx.beginPath();cx.ellipse(0,0,f.rx*k,f.ry*k,0,0,6.28);cx.restore();};

  for(const f of feats){
    if(f.type==='marsh'){
      g.fillStyle='rgba(66,100,102,.4)'; shape(g,f,1); g.fill();
      g.strokeStyle='rgba(158,204,204,.22)'; g.lineWidth=1;
      for(let i=0;i<16;i++){ const a=rnd(0,6.28),rr=Math.sqrt(R());
        const x=f.x+Math.cos(a)*f.rx*rr*.85,y=f.y+Math.sin(a)*f.ry*rr*.85;
        g.beginPath(); g.moveTo(x-10,y); g.quadraticCurveTo(x,y-3.5,x+10,y); g.stroke(); }
    } else if(f.type==='rocks'){
      g.fillStyle='rgba(94,90,82,.32)'; shape(g,f,1); g.fill();
      for(let i=0;i<24;i++){ const a=rnd(0,6.28),rr=Math.sqrt(R());
        const x=f.x+Math.cos(a)*f.rx*rr*.9,y=f.y+Math.sin(a)*f.ry*rr*.9,s=rnd(4,11);
        g.fillStyle='rgba(22,22,18,.32)'; g.beginPath(); g.ellipse(x+2,y+s*.5,s*.9,s*.35,0,0,6.28); g.fill();
        const v=(132+rnd(-20,20))|0; g.fillStyle=`rgba(${v},${v-4},${v-14},.85)`;
        g.beginPath(); g.moveTo(x-s,y+s*.5); g.lineTo(x-s*.2,y-s*.75); g.lineTo(x+s*.6,y-s*.2); g.lineTo(x+s,y+s*.5); g.fill();
        g.fillStyle='rgba(226,220,196,.16)';
        g.beginPath(); g.moveTo(x-s*.2,y-s*.75); g.lineTo(x+s*.6,y-s*.2); g.lineTo(x-s*.1,y+s*.1); g.fill(); }
    } else if(f.type==='field'){                        // a worked plot, sown in rows
      const CROP=[['rgba(154,134,58,.55)','rgba(184,162,76,.42)'],    // wheat
                  ['rgba(94,116,52,.5)', 'rgba(122,146,66,.4)'],      // green crop
                  ['rgba(120,94,50,.5)', 'rgba(146,118,64,.4)']];     // ploughed earth
      const col=CROP[(f.crop|0)%3];
      g.save(); g.translate(f.x,f.y); g.rotate(f.rot);
      g.beginPath(); g.ellipse(0,0,f.rx,f.ry,0,0,6.28); g.clip();
      g.fillStyle=col[0]; g.fillRect(-f.rx,-f.ry,f.rx*2,f.ry*2);
      g.strokeStyle=col[1]; g.lineWidth=2.4;
      const step=(f.ry*2)/Math.max(4,f.rows|0);
      for(let y=-f.ry;y<=f.ry;y+=step){ g.beginPath(); g.moveTo(-f.rx,y); g.lineTo(f.rx,y); g.stroke(); }
      g.restore();
      g.strokeStyle='rgba(58,50,30,.4)'; g.lineWidth=1.8;             // the field boundary
      shape(g,f,1); g.stroke();
    } else if(f.type==='orchard'){
      g.fillStyle='rgba(96,82,50,.42)'; shape(g,f,1); g.fill();       // tilled soil under the rows
    } else {
      g.fillStyle='rgba(34,48,30,.5)'; shape(g,f,1); g.fill();   // forest floor
    }
  }

  // roads, yards and wells: the things that make a village read as lived in
  for(const p of props){
    if(p.kind==='route'){                       // a routed road, following the ground
      const pts=p.pts;
      if(pts.length<2) continue;
      g.lineCap='round'; g.lineJoin='round';
      const run=()=>{ g.beginPath(); g.moveTo(pts[0][0],pts[0][1]);
        for(let i=1;i<pts.length;i++) g.lineTo(pts[i][0],pts[i][1]); g.stroke(); };
      g.strokeStyle='rgba(58,50,34,.30)'; g.lineWidth=22; run();   // the verge
      g.strokeStyle='rgba(126,110,78,.52)'; g.lineWidth=16; run(); // the metalling
      g.strokeStyle='rgba(92,78,52,.34)'; g.lineWidth=3; run();    // a cart rut down the middle
      for(const c of p.crossings||[]){         // a deck where it takes the water
        g.fillStyle='rgba(120,110,92,.85)';
        g.fillRect(c.x-16,c.y-16,32,32);
        g.strokeStyle='rgba(50,42,28,.6)'; g.lineWidth=2;
        g.strokeRect(c.x-16,c.y-16,32,32);
      }
      g.lineCap='butt'; g.lineJoin='miter';
    } else if(p.kind==='road'){
      g.save(); g.translate(p.x,p.y); g.rotate(p.a);
      g.fillStyle='rgba(124,108,76,.45)'; g.fillRect(-p.len/2,-p.w/2,p.len,p.w);
      g.strokeStyle='rgba(66,56,38,.38)'; g.lineWidth=1.5;
      g.beginPath(); g.moveTo(-p.len/2,-p.w/2); g.lineTo(p.len/2,-p.w/2);
      g.moveTo(-p.len/2,p.w/2);  g.lineTo(p.len/2,p.w/2);  g.stroke();
      g.strokeStyle='rgba(88,74,48,.34)'; g.lineWidth=2.6;            // cart ruts
      g.beginPath(); g.moveTo(-p.len/2,-p.w*.19); g.lineTo(p.len/2,-p.w*.19);
      g.moveTo(-p.len/2,p.w*.19); g.lineTo(p.len/2,p.w*.19); g.stroke();
      g.restore();
    } else if(p.kind==='yard'){
      g.save(); g.translate(p.x,p.y); g.rotate(p.a);
      g.fillStyle='rgba(122,112,78,.3)';
      g.beginPath(); g.ellipse(0,0,p.rx,p.ry,0,0,6.28); g.fill();
      g.strokeStyle='rgba(74,62,40,.55)'; g.lineWidth=1.9;            // post and rail
      g.setLineDash([5,7]);
      g.beginPath(); g.ellipse(0,0,p.rx,p.ry,0,0,6.28); g.stroke();
      g.setLineDash([]);
      g.restore();
    } else if(p.kind==='well'){
      g.fillStyle='rgba(38,34,26,.5)';  g.beginPath(); g.arc(p.x,p.y,p.r+2.5,0,6.28); g.fill();
      g.fillStyle='rgba(142,134,114,.9)'; g.beginPath(); g.arc(p.x,p.y,p.r,0,6.28); g.fill();
      g.fillStyle='rgba(20,18,14,.85)'; g.beginPath(); g.arc(p.x,p.y,p.r*.55,0,6.28); g.fill();
    }
  }

  // the canopy is painted from the real trunks, so felling one can erase it
  for(const t of trees) paintCrown(c,t);

  if(mapType==='beach'){                                  // sea and surf
    const sg=g.createLinearGradient(0,H-190,0,H);
    sg.addColorStop(0,'rgba(120,150,146,.25)'); sg.addColorStop(.34,'#4E7C82'); sg.addColorStop(1,'#2F5A63');
    g.fillStyle=sg; g.fillRect(0,H-190,W,190);
    g.fillStyle='rgba(232,240,236,.5)';
    for(let i=0;i<160;i++){ const x=rnd(0,W),y=H-130+rnd(-16,16);
      g.beginPath(); g.ellipse(x,y,rnd(14,40),rnd(2,4),0,0,6.28); g.fill(); }
    g.fillStyle='rgba(226,214,178,.35)'; g.fillRect(0,H-136,W,10);
  }
  if(mapType==='desert'){                                  // the dry wadi bed
    g.save(); g.beginPath();
    for(let y=0;y<=H;y+=20) g.lineTo(riverXAt(y)-52,y);
    for(let y=H;y>=0;y-=20) g.lineTo(riverXAt(y)+52,y);
    g.closePath(); g.clip();
    g.fillStyle='rgba(206,182,128,.45)'; g.fillRect(0,0,W,H);
    g.strokeStyle='rgba(150,126,80,.35)'; g.lineWidth=2;
    for(let i=0;i<120;i++){ const y=rnd(0,H),x=riverXAt(y)+rnd(-46,46);
      g.beginPath(); g.moveTo(x-20,y); g.quadraticCurveTo(x,y-4,x+20,y); g.stroke(); }
    g.restore();
    g.strokeStyle='rgba(120,98,58,.4)'; g.lineWidth=3;
    g.beginPath(); for(let y=0;y<=H;y+=16) g.lineTo(riverXAt(y)-52,y); g.stroke();
    g.beginPath(); for(let y=0;y<=H;y+=16) g.lineTo(riverXAt(y)+52,y); g.stroke();
  }
  if(MAPS[mapType].water==='none'){ ground=g0; canopy=cn; canopyCtx=c; makeDecal(); return; }
  // river water
  const path=new Path2D();
  path.moveTo(riverXAt(0)-38,0);
  for(let y=0;y<=H;y+=20) path.lineTo(riverXAt(y)-38,y);
  for(let y=H;y>=0;y-=20) path.lineTo(riverXAt(y)+38,y);
  path.closePath();
  g.save(); g.clip(path);
  const wg=g.createLinearGradient(W/2-130,0,W/2+130,0);
  wg.addColorStop(0,'#2C4A55'); wg.addColorStop(.5,'#38626E'); wg.addColorStop(1,'#274450');
  g.fillStyle=wg; g.fillRect(0,0,W,H);
  g.strokeStyle='rgba(190,225,232,.22)'; g.lineWidth=1.4;
  for(let i=0;i<260;i++){ const y=rnd(0,H),x=riverXAt(y)+rnd(-32,32);
    g.beginPath(); g.moveTo(x-8,y); g.quadraticCurveTo(x,y-2.6,x+8,y); g.stroke(); }
  g.restore();
  g.strokeStyle='rgba(58,52,34,.5)'; g.lineWidth=4;
  g.beginPath(); for(let y=0;y<=H;y+=16) g.lineTo(riverXAt(y)-38,y); g.stroke();
  g.beginPath(); for(let y=0;y<=H;y+=16) g.lineTo(riverXAt(y)+38,y); g.stroke();

  for(const cr of CROSS){
    const rx=riverXAt(cr.y);
    if(cr.type==='ford'){
      g.fillStyle='rgba(150,178,150,.35)'; g.fillRect(rx-52,cr.y-76,104,152);
      g.fillStyle='rgba(206,214,186,.5)';
      for(let i=0;i<48;i++) { const px=rx+rnd(-42,42),py=cr.y+rnd(-52,52);
        g.beginPath(); g.ellipse(px,py,rnd(2,4.5),rnd(1.5,3),rnd(0,3),0,6.28); g.fill(); }
      g.strokeStyle='rgba(232,222,180,.35)'; g.lineWidth=2; g.setLineDash([7,7]);
      g.strokeRect(rx-52,cr.y-76,104,152); g.setLineDash([]);
    } else {
      g.fillStyle='rgba(16,14,9,.5)'; g.fillRect(rx-84,cr.y-132,168,264);
      for(const py of [cr.y-96,cr.y-32,cr.y+32,cr.y+96]){  // piers standing in the water
        g.fillStyle='#7C7464'; g.fillRect(rx-84,py-14,168,28);
        g.fillStyle='rgba(0,0,0,.24)'; g.fillRect(rx-84,py+8,168,6);
      }
      g.fillStyle='#8A8272'; g.fillRect(rx-80,cr.y-128,160,256);
      g.fillStyle='#9C9483';
      for(let px=rx-80;px<rx+80;px+=13) g.fillRect(px+1,cr.y-128,11,256);
      g.fillStyle='#6E6857'; g.fillRect(rx-80,cr.y-132,160,7); g.fillRect(rx-80,cr.y+125,160,7);
      g.fillStyle='#A69C87';                               // parapet stones
      for(let px=rx-80;px<rx+80;px+=22){ g.fillRect(px,cr.y-140,15,9); g.fillRect(px,cr.y+131,15,9); }
      g.fillStyle='rgba(255,246,214,.13)'; g.fillRect(rx-80,cr.y-128,160,4);
      g.fillStyle='rgba(20,16,10,.28)'; g.fillRect(rx-80,cr.y+120,160,5);
    }
  }
  ground=g0; canopy=cn; canopyCtx=c; makeDecal();
}
function makeDecal(){
  decal=document.createElement('canvas');
  decal.width=Math.ceil(W*BAKE); decal.height=Math.ceil(H*BAKE);
  decalCtx=decal.getContext('2d');
  decalCtx.setTransform(BAKE,0,0,BAKE,0,0);
}
function drawStructures(g,c){
  for(const b of buildings){
    g.save(); g.translate(b.x,b.y); g.rotate(b.rot);
    g.fillStyle='rgba(16,14,10,.45)'; g.fillRect(-b.w/2+5,-b.h/2+6,b.w,b.h);
    if(b.bunker){                                   // concrete emplacement
      g.fillStyle='#6E6E60'; g.fillRect(-b.w/2,-b.h/2,b.w,b.h);
      g.fillStyle='#5A5A4F'; g.fillRect(-b.w/2+4,-b.h/2+4,b.w-8,b.h-8);
      g.fillStyle='rgba(16,14,10,.8)'; g.fillRect(-b.w/2+6,-3,b.w-12,6);   // firing slit
    } else if(b.city){                              // apartment block, some of it shelled out
      const ruined=R()<.3;
      g.fillStyle=ruined?'#5B564E':'#7C7468'; g.fillRect(-b.w/2,-b.h/2,b.w,b.h);
      g.fillStyle=ruined?'#4A463F':'#6A6357'; g.fillRect(-b.w/2,-b.h/2,b.w,b.h*.3);
      g.fillStyle='rgba(24,22,18,.6)';
      for(let wx=-b.w/2+6;wx<b.w/2-6;wx+=13)
        for(let wy=-b.h/2+8;wy<b.h/2-6;wy+=12)
          if(R()>(ruined?.5:.2)) g.fillRect(wx,wy,6,7);
      if(ruined){ g.fillStyle='rgba(40,36,30,.55)';
        for(let i=0;i<7;i++) g.fillRect(rnd(-b.w/2,b.w/2-8),rnd(-b.h/2,b.h/2-6),rnd(6,14),rnd(5,10)); }
      g.strokeStyle='rgba(26,24,20,.6)'; g.lineWidth=1.4; g.strokeRect(-b.w/2,-b.h/2,b.w,b.h);
    } else {                                        // village house
      const sand=mapType==='desert'||mapType==='beach';
      g.fillStyle=sand?'#C0A97A':'#8E8574'; g.fillRect(-b.w/2,-b.h/2,b.w,b.h);
      g.fillStyle=sand?'#A78F62':'#736A59'; g.fillRect(-b.w/2,-b.h/2,b.w,b.h*.42);
      g.fillStyle=sand?'#8A7047':'#5A4A38'; g.fillRect(-b.w/2,-b.h/2-3,b.w,5);
      g.fillStyle='rgba(24,20,14,.55)'; g.fillRect(-3,b.h/2-7,6,7);
      g.strokeStyle='rgba(30,26,18,.5)'; g.lineWidth=1; g.strokeRect(-b.w/2,-b.h/2,b.w,b.h);
    }
    g.restore();
  }
}

/* ===================== walls ===================== */
function wallLocal(w,x,y){
  const a=w.a===undefined?Math.PI/2:w.a, cs=Math.cos(a), sn=Math.sin(a);
  const dx=x-w.x, dy=y-w.y;
  return {along:dx*cs+dy*sn, across:-dx*sn+dy*cs};
}
function wallBlocks(x,y,team){
  for(let i=0;i<walls.length;i++){
    const w=walls[i];
    if(w.dead||(team&&w.team===team&&!w.rubble)) continue;   // troops pass their own works
    const t=w.rubble?9:6;
    const L=wallLocal(w,x,y);
    if(Math.abs(L.across)<t&&Math.abs(L.along)<w.len/2) return true;
  }
  return false;
}
const blocked=(x,y)=>solid(x,y)||wallBlocks(x,y);
const blockedFor=(x,y,foot,team)=>solidFor(x,y,foot)||wallBlocks(x,y,team);
// The nearest standable point to one that is not. Note that BUILD stops vehicles
// and guns but not men, who garrison houses, so what counts as standable depends
// on who is asking. Rings outward and takes the first opening; no randomness, so
// it is safe to call from the seeded path.
function freeSpot(x,y,foot,team){
  if(!blockedFor(x,y,foot,team)) return {x,y};
  for(let r=TG;r<=TG*6;r+=TG*.7)
    for(let a=0;a<12;a++){
      const ang=a*.5236, nx=x+Math.cos(ang)*r, ny=y+Math.sin(ang)*r;
      if(!blockedFor(nx,ny,foot,team)) return {x:nx,y:ny};
    }
  return {x,y};                                   // sealed in: the escape hatch will deal with it
}
function nearestWall(x,y,team,r){
  let best=null,bd=r;
  for(let i=0;i<walls.length;i++){
    const w=walls[i]; if(w.dead||w.team===team||w.rubble) continue;
    const a=w.a===undefined?Math.PI/2:w.a;
    const L=wallLocal(w,x,y);
    const t=clamp(L.along,-w.len/2,w.len/2);
    const px=w.x+Math.cos(a)*t, py=w.y+Math.sin(a)*t;
    const d=dist(x,y,px,py);
    if(d<bd){bd=d;best=w;}
  }
  return best;
}
function hurtWall(w,a){ w.hp-=a; if(w.hp<=0){ w.dead=true; burst(w.x,w.y,6,'dust'); } }

/* ===================== the keeps ===================== */
const enemyCastle=team=>{ for(const c of castles) if(c.team!==team&&!c.dead) return c; return null; };
const ownCastle=team=>{ for(const c of castles) if(c.team===team) return c; return null; };
let CPX=0,CPY=0;
function castleDist(c,x,y){
  CPX=clamp(x,c.x-c.hw,c.x+c.hw); CPY=clamp(y,c.y-c.hh,c.y+c.hh);
  return Math.hypot(x-CPX,y-CPY);
}
function nearestCastle(x,y,team,r){
  const c=enemyCastle(team);
  if(!c) return null;
  return castleDist(c,x,y)<=r?c:null;
}
function hurtCastle(c,a){
  if(c.dead) return;
  c.hp-=a;
  if(c.hp<=0){
    c.dead=true; c.hp=0;
    for(let gy=(((c.y-c.hh)/TG)|0);gy<=(((c.y+c.hh)/TG)|0);gy++)
      for(let gx=(((c.x-c.hw)/TG)|0);gx<=(((c.x+c.hw)/TG)|0);gx++){
        if(gx<0||gy<0||gx>=TW||gy>=TH) continue;
        const i=gy*TW+gx; tGrid[i]&=~BUILD; tGrid[i]|=SCORCH;
      }
    for(let i=0;i<26;i++) burst(c.x+rnd(-90,90),c.y+rnd(-110,110),3,'smoke');
    toast((c.team==='blue'?'Blue':'Red')+' HQ has fallen!');
  }
}
let castleT=0;
function stepCastles(dt){
  for(const c of castles){
    if(c.dead) continue;
    if(c.hp<c.max*.45&&quality&&Math.random()<dt*3)
      burst(c.x+vr(-70,70),c.y+vr(-90,90),1,'smoke');
    c.cd-=dt;
    if(c.cd>0) continue;
    c.cd=1.2;
    collect(c.x,c.y,430);                       // tower archers answer anything that comes close
    let shotsLeft=6;
    for(let i=0;i<NEARn&&shotsLeft>0;i++){
      const o=NEAR[i];
      if(!o.alive||o.sq.team===c.team) continue;
      if(castleDist(c,o.x,o.y)>320) continue;
      if(R()<.5) continue;
      shots.push({kind:'bullet',sx:c.x+rnd(-80,80),sy:c.y+rnd(-100,100),x:c.x,y:c.y,
        tx:o.x+rnd(-8,8),ty:o.y+rnd(-8,8),t:0,arc:0,av:1,
        dur:Math.max(.05,dist(c.x,c.y,o.x,o.y)/1400),team:c.team,dmg:48});
      shotsLeft--;
    }
  }
}

/* ===================== squads ===================== */
let SX=0,SY=0;
function ranksFor(n){ return n<=14?2:n<=30?3:4; }
function slotInto(sq,i){
  const n=sq.initial,f=sq.formation,base=sq.t.gap||13,gap=(f==='loose')?base*1.9:base;
  let lx=0,ly=0;
  if(sq.crossing){                                   // narrow up to thread the water
    const cols=sq.t.kind==='siege'?(sq.crossWide?4:2):(sq.crossWide?12:6);
    lx=-Math.floor(i/cols)*gap; ly=((i%cols)-(cols-1)/2)*gap;
  }
  else if(f==='wedge'){ let row=0,idx=i; while(idx>row){idx-=row+1;row++;}
    lx=-row*gap*.95; ly=(idx-row/2)*gap; }
  else if(f==='square'){ const w=Math.max(1,Math.round(Math.sqrt(n)));
    lx=-Math.floor(i/w)*gap; ly=((i%w)-(w-1)/2)*gap; }
  else { const rk=ranksFor(n),w=Math.ceil(n/rk),r=Math.floor(i/w),c=i%w;
    lx=-r*gap; ly=(c-(w-1)/2)*gap; }
  const cs=Math.cos(sq.facing),sn=Math.sin(sq.facing);
  SX=sq.fx+lx*cs-ly*sn; SY=sq.fy+lx*sn+ly*cs;
}
function makeSquad(team,type,x,y,count){
  const t=UNITS[type],n=count||unitCount(type);
  const sq={id:nextId++,team,type,t,fx:x,fy:y,facing:team==='blue'?0:Math.PI,
    formation:'line',order:{kind:'hold'},initial:n,alive:n,legion:0,cost:unitCost(type),
    routed:false,moraleT:rnd(0,1),disengage:0,queue:[],crossT:0,crossing:false,crossWide:false,seen:false,seenT:0,soldiers:[],gone:false,fw:0,fd:0,flag:rnd(0,6.28),slide:0};
  // A formation is anchored on open ground, but its slots fan out from there and
  // can land inside a house, a bunker or a cliff. For a vehicle or a gun that is
  // a permanent trap, so every slot is nudged clear as it is filled.
  const foot=!t.vehicle&&t.kind!=='siege';
  for(let i=0;i<n;i++){
    slotInto(sq,i);
    const pos=freeSpot(SX+rnd(-3,3),SY+rnd(-3,3),foot,team);
    sq.soldiers.push({sq,x:pos.x,y:pos.y,hp:t.hp,max:t.hp,alive:true,
      cd:rnd(0,t.cd),tgt:null,wall:null,seek:rnd(0,.5),charge:false,idx:i,ang:sq.facing,step:rnd(0,6.28),jam:0,
      hull:sq.facing,turret:sq.facing,rec:0,trk:0,kick:0,v:rnd(-1,1),moved:0,
      sp:0,ramp:0,crowd:0});
  }
  for(const s of sq.soldiers) soldiers.push(s);
  squads.push(sq); footprint(sq); return sq;
}
function footprint(sq){
  const n=sq.initial,f=sq.formation,base=sq.t.gap||13,gap=(f==='loose')?base*1.9:base;
  if(sq.crossing){ const cols=sq.t.kind==='siege'?(sq.crossWide?4:2):(sq.crossWide?12:6);
    sq.fw=cols*gap; sq.fd=Math.ceil(n/cols)*gap; return; }
  if(f==='wedge'){ let rows=0,c=0; while(c<n){rows++;c+=rows;} sq.fd=rows*gap; sq.fw=rows*gap; }
  else if(f==='square'){ const w=Math.max(1,Math.round(Math.sqrt(n))); sq.fw=w*gap; sq.fd=Math.ceil(n/w)*gap; }
  else { const rk=ranksFor(n); sq.fw=Math.ceil(n/rk)*gap; sq.fd=rk*gap; }
}

/* ===================== grid ===================== */
const CELL=54,grid=new Map();
const NEAR=[]; let NEARn=0;
function buildGrid(){
  grid.clear();
  for(let i=0;i<soldiers.length;i++){ const s=soldiers[i]; if(!s.alive) continue;
    const k=(((s.y/CELL)|0)+512)*8192+(((s.x/CELL)|0)+512);
    let a=grid.get(k); if(a===undefined){a=[];grid.set(k,a);} a.push(s); }
}
function collect(x,y,r){
  NEARn=0;
  const c0=((x-r)/CELL)|0,c1=((x+r)/CELL)|0,r0=((y-r)/CELL)|0,r1=((y+r)/CELL)|0;
  for(let ry=r0;ry<=r1;ry++){
    const base=(ry+512)*8192+512;
    for(let rx=c0;rx<=c1;rx++){
      const a=grid.get(base+rx); if(a===undefined) continue;
      for(let i=0;i<a.length;i++) NEAR[NEARn++]=a[i];
    }
  }
}
const canEngage=(t,o)=>!o.sq.t.air||t.air||t.aa;    // only flak, machine guns and other aircraft
// Close in, everyone can see everyone: a sight line is not something to argue
// about across a street corner, and checking one would cost more than it says.
const LOSFREE=130;
const seesFrom=(s,o)=>T.sightClear(terrain,s.x,s.y,o.x,o.y,elevAt(s.x,s.y));
function findEnemy(s,range,pref){
  collect(s.x,s.y,range);
  let best=null,bd=range*range,bp=null,bpd=range*range;
  const t=s.sq.t;
  for(let i=0;i<NEARn;i++){
    const o=NEAR[i];
    if(!o.alive||o.sq.team===s.sq.team||!canEngage(t,o)) continue;
    const dx=o.x-s.x,dy=o.y-s.y,d=dx*dx+dy*dy;
    if(pref!==null&&o.sq===pref&&d<bpd){bpd=d;bp=o;}
    if(d<bd){bd=d;best=o;}
  }
  const pick=bp||best;
  if(!pick||t.air||t.kind==='siege') return pick;   // guns lob theirs over the hill
  const pd=(pick.x-s.x)**2+(pick.y-s.y)**2;
  if(pd<=LOSFREE*LOSFREE||seesFrom(s,pick)) return pick;
  // The nearest man is behind something. Take the nearest one he can actually
  // see instead, at a bounded cost - and if he can see nobody, he has no shot
  // to take and closes with the formation until he has one.
  let alt=null,ad=range*range,looks=0;
  for(let i=0;i<NEARn;i++){
    const o=NEAR[i];
    if(!o.alive||o.sq.team===s.sq.team||!canEngage(t,o)) continue;
    const dx=o.x-s.x,dy=o.y-s.y,d=dx*dx+dy*dy;
    if(d>=ad) continue;
    if(d>LOSFREE*LOSFREE&&!seesFrom(s,o)){ if(++looks>8) break; continue; }
    ad=d; alt=o;
  }
  return alt;
}
function nearestEnemySquad(sq,sameLane){
  let best=null,bd=1e9;
  for(let i=0;i<squads.length;i++){ const o=squads[i];
    if(o.gone||o.team===sq.team||o.routed) continue;
    if(sameLane&&laneOf(o.fy)!==laneOf(sq.fy)) continue;
    const d=dist(sq.fx,sq.fy,o.fx,o.fy); if(d<bd){bd=d;best=o;} }
  return best;
}

/* ===================== particles, decals, fire ===================== */
function burst(x,y,n,type){
  for(let i=0;i<n;i++){
    if(parts.length>460) break;
    const a=vr(0,6.28),sp=type==='spark'?vr(10,52):type==='fireball'?vr(14,60):vr(6,34);
    parts.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-(type==='smoke'?vr(4,14):0),
      t:type==='spark'?vr(.18,.4):type==='smoke'?vr(1.2,2.4):type==='fireball'?vr(.25,.5):
        type==='flash'?vr(.06,.12):vr(.5,1.1),
      r:type==='spark'?vr(1.4,2.6):type==='smoke'?vr(5,11):type==='fireball'?vr(5,13):
        type==='flash'?vr(2.5,4.5):vr(3,7),type});
  }
}
function bloodMark(x,y,team){
  if(!decalCtx) return;
  decalCtx.fillStyle=team==='blue'?'rgba(28,42,72,.5)':'rgba(74,22,16,.5)';
  decalCtx.beginPath(); decalCtx.ellipse(x,y,vr(3,5),vr(2,3.4),vr(0,3.14),0,6.28); decalCtx.fill();
  decalCtx.fillStyle='rgba(58,16,12,.3)';
  for(let i=0;i<3;i++){ decalCtx.beginPath(); decalCtx.arc(x+vr(-9,9),y+vr(-7,7),vr(.8,2),0,6.28); decalCtx.fill(); }
}
function paintMud(gx,gy,lvl){
  if(!decalCtx) return;
  const x=gx*TG+TG/2,y=gy*TG+TG/2;
  decalCtx.fillStyle=lvl===1?'rgba(52,44,30,.30)':'rgba(38,31,20,.42)';
  decalCtx.beginPath(); decalCtx.ellipse(x+vr(-4,4),y+vr(-4,4),vr(11,16),vr(8,12),vr(0,3),0,6.28);
  decalCtx.fill();
}
let churnT=0;
function stepChurn(dt){
  churnT-=dt; if(churnT>0) return; churnT=.3;
  for(let i=0;i<soldiers.length;i++){
    const s=soldiers[i]; if(!s.alive) continue;
    const j=gi(s.x,s.y);
    if(tGrid[j]&(WATER|BUILD)) continue;
    if(s.sq.t.vehicle&&decalCtx&&!(tGrid[j]&WATER)){        // tracks and tyre ruts
      const a=s.hull,px=-Math.sin(a),py=Math.cos(a);
      decalCtx.fillStyle='rgba(30,26,18,.24)';
      for(const o of [-4.5,4.5]){
        decalCtx.beginPath();
        decalCtx.ellipse(s.x+px*o,s.y+py*o,3.2,2.2,a,0,6.28); decalCtx.fill();
      }
    }
    if(tGrid[j]&WIRED&&!s.sq.t.vehicle&&s.sq.t.kind!=='siege'&&R()<.5) hurt(s,3);
    const v=cGrid[j]=Math.min(1,cGrid[j]+.035);
    if(v>.35&&pGrid[j]===0){ pGrid[j]=1; paintMud(j%TW,(j/TW)|0,1); }
    else if(v>.75&&pGrid[j]===1){ pGrid[j]=2; paintMud(j%TW,(j/TW)|0,2); }
  }
}
const BNEAR=[];
function buildingsNear(x,y,r){
  BNEAR.length=0;
  const c0=clamp(((x-r)/TG)|0,0,TW-1),c1=clamp(((x+r)/TG)|0,0,TW-1);
  const r0=clamp(((y-r)/TG)|0,0,TH-1),r1=clamp(((y+r)/TG)|0,0,TH-1);
  for(let gy=r0;gy<=r1;gy++) for(let gx=c0;gx<=c1;gx++){
    const n=bGrid[gy*TW+gx];
    if(n>=0&&BNEAR.indexOf(n)<0) BNEAR.push(n);
  }
  return BNEAR;
}
function hurtBuilding(b,amt){
  if(!b||b.dead) return;
  b.hp-=amt;
  if(b.hp<b.max*.55&&quality&&Math.random()<.35) burst(b.x+vr(-b.w/3,b.w/3),b.y-b.h/3,1,'smoke');
  if(b.hp<=0) collapse(b);
}
// The house is gone: what it stood on becomes a rubble field. Kept apart from
// collapse() so a loaded battle can put the ruin back without the blast.
function razeBuilding(b){
  b.dead=true; b.hold=null; b.tint=0; b.hp=0; ruinsN++;
  for(let gy=((b.y-b.h/2)/TG|0);gy<=((b.y+b.h/2)/TG|0);gy++)
    for(let gx=((b.x-b.w/2)/TG|0);gx<=((b.x+b.w/2)/TG|0);gx++){
      if(gx<0||gy<0||gx>=TW||gy>=TH) continue;
      const i=gy*TW+gx;
      tGrid[i]&=~BUILD; tGrid[i]|=RUBBLE|SCORCH; bGrid[i]=-1;   // men shelter in it, armour goes round
    }
}
function collapse(b){
  razeBuilding(b);
  // everyone inside is caught in the collapse and thrown clear
  collect(b.x,b.y,Math.max(b.w,b.h));
  for(let i=0;i<NEARn;i++){
    const o=NEAR[i]; if(!o.alive) continue;
    if(Math.abs(o.x-b.x)>b.w*.6||Math.abs(o.y-b.y)>b.h*.6) continue;
    hurt(o,rnd(55,105));
    if(o.alive){
      const a=Math.atan2(o.y-b.y,o.x-b.x)||rnd(0,6.28);
      o.x+=Math.cos(a)*(b.w*.6+8); o.y+=Math.sin(a)*(b.h*.6+8);
      o.jam=0;
    }
  }
  paintRuin(b);
  for(let i=0;i<18;i++) burst(b.x+rnd(-b.w/2,b.w/2),b.y+rnd(-b.h/2,b.h/2),1,'dust');
  burst(b.x,b.y,10,'smoke');
  rings.push({x:b.x,y:b.y,t:.55,max:.55,r:20,to:Math.max(b.w,b.h)*2.2});
  if(plumes.length<26) plumes.push({x:b.x,y:b.y,t:vr(6,12)});
  kick(b.x,b.y,5);
}
// The ruin, painted into the ground layer.
function paintRuin(b){
  if(decalCtx){                                                   // paint the ruin into the ground
    decalCtx.fillStyle='rgba(40,37,31,.65)';
    decalCtx.fillRect(b.x-b.w/2,b.y-b.h/2,b.w,b.h);
    decalCtx.fillStyle='rgba(96,90,78,.55)';
    for(let i=0;i<26;i++){
      const px=b.x+rnd(-b.w*.62,b.w*.62),py=b.y+rnd(-b.h*.62,b.h*.62),r=rnd(3,9);
      decalCtx.beginPath();
      decalCtx.moveTo(px-r,py+r*.5); decalCtx.lineTo(px,py-r*.6); decalCtx.lineTo(px+r,py+r*.5);
      decalCtx.fill();
    }
    decalCtx.fillStyle='rgba(18,16,12,.4)';
    for(let i=0;i<14;i++) decalCtx.fillRect(b.x+rnd(-b.w*.7,b.w*.7),b.y+rnd(-b.h*.7,b.h*.7),rnd(4,12),rnd(2,4));
  }
}
const stampLine=(x,y,ang,len,halfW,flag)=>T.stampLine(terrain,x,y,ang,len,halfW,flag);
function paintWire(x,y,ang,len){
  if(!decalCtx) return;
  const cs=Math.cos(ang),sn=Math.sin(ang);
  decalCtx.strokeStyle='rgba(38,34,26,.85)'; decalCtx.lineWidth=2.2;
  for(const off of [-5,5]){
    decalCtx.beginPath();
    decalCtx.moveTo(x-cs*len/2-sn*off,y-sn*len/2+cs*off);
    decalCtx.lineTo(x+cs*len/2-sn*off,y+sn*len/2+cs*off);
    decalCtx.stroke();
  }
  decalCtx.lineWidth=1.4;
  for(let d=-len/2;d<len/2;d+=11){          // barbs and pickets
    const px=x+cs*d,py=y+sn*d;
    decalCtx.beginPath();
    decalCtx.moveTo(px-sn*7,py+cs*7); decalCtx.lineTo(px+sn*7,py-cs*7); decalCtx.stroke();
    decalCtx.beginPath();
    decalCtx.moveTo(px-cs*4-sn*4,py-sn*4+cs*4); decalCtx.lineTo(px+cs*4+sn*4,py+sn*4-cs*4); decalCtx.stroke();
  }
}
function paintTrench(x,y,ang,len){
  if(!decalCtx) return;
  const cs=Math.cos(ang),sn=Math.sin(ang);
  const draw=(off,w,col)=>{
    decalCtx.strokeStyle=col; decalCtx.lineWidth=w; decalCtx.lineCap='round';
    decalCtx.beginPath();
    decalCtx.moveTo(x-cs*len/2-sn*off,y-sn*len/2+cs*off);
    decalCtx.lineTo(x+cs*len/2-sn*off,y+sn*len/2+cs*off);
    decalCtx.stroke();
  };
  draw(13,13,'rgba(96,84,58,.75)');          // spoil heaped on the parapet
  draw(-13,13,'rgba(96,84,58,.6)');
  draw(0,20,'rgba(26,22,16,.85)');           // the cut itself
  draw(0,11,'rgba(52,44,32,.8)');
  decalCtx.strokeStyle='rgba(20,17,12,.5)'; decalCtx.lineWidth=2;
  for(let d=-len/2;d<len/2;d+=26){           // firing bays
    const px=x+cs*d,py=y+sn*d;
    decalCtx.beginPath(); decalCtx.moveTo(px-sn*10,py+cs*10); decalCtx.lineTo(px+sn*10,py-cs*10); decalCtx.stroke();
  }
}
function crater(x,y,r){
  if(!decalCtx) return;
  decalCtx.fillStyle='rgba(16,13,9,.55)';
  decalCtx.beginPath(); decalCtx.ellipse(x,y,r,r*.82,vr(0,3),0,6.28); decalCtx.fill();
  decalCtx.fillStyle='rgba(74,66,48,.4)';
  decalCtx.beginPath(); decalCtx.ellipse(x,y,r*.55,r*.45,vr(0,3),0,6.28); decalCtx.fill();
  decalCtx.fillStyle='rgba(28,24,16,.30)';
  for(let i=0;i<7;i++){ const a=vr(0,6.28),rr=r*vr(1,1.8);
    decalCtx.beginPath(); decalCtx.arc(x+Math.cos(a)*rr,y+Math.sin(a)*rr,vr(1.5,4),0,6.28); decalCtx.fill(); }
}
function detonate(x,y,dmg,splash,team,av){
  sfx('explode',x,y);
  collect(x,y,splash+6);
  for(let j=0;j<NEARn;j++){
    const o=NEAR[j]; if(!o.alive||o.sq.t.air) continue;
    const d=dist(o.x,o.y,x,y); if(d>splash) continue;
    let m=(1-d/splash)*rnd(.8,1.2)*o.sq.t.armor*(o.sq.team===team?.6:1);
    if(av&&o.sq.t.vehicle) m*=av;
    hurt(o,dmg*m,team);
  }
  const w=nearestWall(x,y,team,splash+8); if(w) hurtWall(w,dmg*2.4);
  const ec=nearestCastle(x,y,team,splash+16); if(ec) hurtCastle(ec,dmg*3.2);
  const bl=buildingsNear(x,y,splash+10);
  for(const n of bl){
    const b=buildings[n];
    const d=Math.max(0,dist(b.x,b.y,x,y)-Math.max(b.w,b.h)*.4);
    if(d<splash+10) hurtBuilding(b,dmg*(1-d/(splash+10))*2.6);
  }
  for(const t of treesNear(x,y,splash*.85)) fellTree(t,Math.atan2(t.y-y,t.x-x));
  noteGunfire(x,y); killCivsNear(x,y,splash*.9);
  crater(x,y,clamp(splash*.42,7,42));
  burst(x,y,10,'dust'); burst(x,y,9,'fireball'); burst(x,y,5,'smoke');
  rings.push({x,y,t:.5,max:.5,r:splash*.5,to:splash*2.4});     // shockwave
  for(let i=0;i<8;i++){                                        // debris thrown clear
    const a=rnd(0,6.28),sp=rnd(70,190);
    parts.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,t:rnd(.4,.9),r:rnd(1.2,2.6),type:'debris'});
  }
  if(splash>44&&plumes.length<26) plumes.push({x,y,t:vr(4,9)});
  kick(x,y,clamp(splash/12,1.5,9));
  if(R()<.3) igniteAt(x,y);
}
let mineT=0;
function stepMines(dt){
  mineT-=dt; if(mineT>0) return; mineT=.15;
  for(let i=mines.length-1;i>=0;i--){
    const m=mines[i];
    collect(m.x,m.y,MINE.r+4);
    let trip=null;
    for(let j=0;j<NEARn;j++){
      const o=NEAR[j];
      if(!o.alive||o.sq.team===m.team||o.sq.t.air) continue;
      if(dist(o.x,o.y,m.x,m.y)<=MINE.r+(o.sq.t.vehicle?7:0)){ trip=o; break; }
    }
    if(!trip) continue;
    mines.splice(i,1);
    detonate(m.x,m.y,MINE.dmg,MINE.splash,m.team,2.2);
    if(m.team!==viewTeam()) toast('Mine strike!');
  }
}
function igniteAt(x,y){
  const j=gi(x,y);
  if(!(tGrid[j]&WOOD)||fires.length>90) return;
  for(const f of fires) if(f.j===j) return;
  fires.push({j,x:(j%TW)*TG+TG/2,y:((j/TW)|0)*TG+TG/2,t:0,life:rnd(11,17),spread:rnd(2.5,5)});
}
let fireT=0;
function stepFire(dt){
  for(let i=fires.length-1;i>=0;i--){
    const f=fires[i]; f.t+=dt; f.spread-=dt;
    if(f.spread<=0&&fires.length<90){
      f.spread=rnd(3,6);
      const gx=f.j%TW,gy=(f.j/TW)|0;
      const nx=gx+(R()<.5?-1:1)*(R()<.6?1:2);
      const ny=gy+(R()<.5?-1:1)*(R()<.6?1:2);
      if(nx>0&&ny>0&&nx<TW&&ny<TH) igniteAt(nx*TG,ny*TG);
    }
    if(f.t>=f.life){
      tGrid[f.j]&=~WOOD; tGrid[f.j]|=SCORCH;
      if(canopyCtx){ canopyCtx.globalCompositeOperation='destination-out';
        canopyCtx.beginPath(); canopyCtx.arc(f.x,f.y,24,0,6.28); canopyCtx.fill();
        canopyCtx.globalCompositeOperation='source-over'; }
      if(decalCtx){ decalCtx.fillStyle='rgba(18,14,10,.5)';
        decalCtx.beginPath(); decalCtx.arc(f.x,f.y,rnd(14,20),0,6.28); decalCtx.fill(); }
      fires.splice(i,1); continue;
    }
  }
  fireT-=dt; if(fireT>0) return; fireT=.5;
  for(const f of fires){
    if(quality) burst(f.x+vr(-8,8),f.y+vr(-8,8),1,'smoke');
    collect(f.x,f.y,20);
    for(let i=0;i<NEARn;i++){
      const o=NEAR[i];
      if(o.alive&&dist(o.x,o.y,f.x,f.y)<17) hurt(o,7);
    }
  }
}

/* ===================== orders ===================== */
function order(sq,o,breakOff){
  if(sq.routed||sq.gone) return;
  sq.order=o; sq.disengage=breakOff?3.0:0;
}
// Where new units are sent as they roll out, per side. Null means 'to the spot
// you tapped', which is what it did before.
let rally={blue:null,red:null};
let queueing=false;                                // next order joins the queue
let rallySet=false;                                // next tap places the rally point

// Orders can be QUEUED rather than replacing what a unit is already doing, so a
// move can be planned as a route round a wood instead of a straight line
// through it. shift-click on a mouse, the Queue button on a finger.
function issue(list,kind,x,y,tsq,append){
  for(const sq of list){
    if(append&&(kind==='move'||kind==='attack'||kind==='charge')){
      if(sq.routed||sq.gone) continue;
      if(!sq.queue) sq.queue=[];
      if(sq.queue.length<8)
        sq.queue.push(kind==='move'?{kind:'move',x,y}:{kind,sq:tsq});
      continue;
    }
    if(sq.queue) sq.queue.length=0;
    if(kind==='move')        order(sq,{kind:'move',x,y},true);
    else if(kind==='attack') order(sq,{kind:'attack',sq:tsq},false);
    else if(kind==='charge') order(sq,{kind:'charge',sq:tsq||nearestEnemySquad(sq)},false);
    else if(kind==='hold')   order(sq,{kind:'hold'},true);
    else if(kind==='back')   order(sq,{kind:'back'},true);
    else if(kind==='castle') order(sq,{kind:'castle'},true);
  }
  if(kind==='move') pings.push({x,y,t:.9});
}
function sendToLane(list,lane){
  const cy=laneY[lane]; let i=0;
  for(const sq of list){
    const cur=laneOf(sq.fy);
    let tx=sq.fx,ty=cy+((i%3)-1)*105;
    if(cur!==lane){
      const dividers=cur<lane?div.slice(cur,lane):div.slice(lane,cur);
      const passes=GAPS.filter(g=>dividers.some(d=>Math.abs(d-g[0])<2));
      if(passes.length) tx=passes.reduce((a,b)=>Math.abs(a[1]-sq.fx)<Math.abs(b[1]-sq.fx)?a:b)[1];
    }
    order(sq,{kind:'move',x:tx,y:ty},true);
    pings.push({x:tx,y:ty,t:.9}); i++;
  }
}

/* ===================== simulation ===================== */
// How hard a formation is pushed off the ones around it. Works on squad centres
// and footprints, not on individual men, so it steers whole units around each
// other rather than jostling bodies. An enemy you have been ordered onto is not
// something to avoid - you are supposed to arrive on top of him.
function squadPush(sq){
  let px=0,py=0;
  const rs=(sq.fw+sq.fd)*.25+26;
  const closing=sq.order.kind==='attack'||sq.order.kind==='charge'||sq.order.kind==='castle';
  for(let i=0;i<squads.length;i++){
    const o=squads[i];
    if(o===sq||o.gone||o.routed) continue;
    if(!!o.t.air!==!!sq.t.air) continue;             // one of them is flying
    if(o.team!==sq.team&&closing) continue;
    const md=rs+(o.fw+o.fd)*.25+26;
    const dx=sq.fx-o.fx,dy=sq.fy-o.fy;
    const d2=dx*dx+dy*dy;
    if(d2>=md*md||d2<1e-6) continue;
    const d=Math.sqrt(d2),w=(md-d)/md;
    px+=dx/d*w; py+=dy/d*w;
  }
  return {x:px,y:py};
}
// The hour of the day, advanced by battle time alone so both sides of a match
// agree on it without a word. Everything it sets is read by the renderer and by
// how far anyone can see; nothing here draws on R().
function stepClock(dt){
  tod=todAt(todStart,battleTime);
  sun=sunDir(tod);
  dayLight=lightAt(tod);
  night=isNight(tod);
}
// Step to whatever was queued behind the order just finished.
function nextOrder(sq){
  if(sq.queue&&sq.queue.length){
    const n=sq.queue.shift();
    if(n.kind!=='move'&&(!n.sq||n.sq.gone)) return nextOrder(sq);   // his target died
    order(sq,n,n.kind==='move');
    return;
  }
  sq.order={kind:'hold'};
}
function stepSquad(sq,dt){
  if(sq.gone) return;
  let n=0; for(let i=0;i<sq.soldiers.length;i++) if(sq.soldiers[i].alive) n++;
  sq.alive=n;
  if(n===0){ sq.gone=true; return; }
  if(sq.disengage>0) sq.disengage-=dt;
  sq.flag+=dt*2.4;
  const t=sq.t,homeX=sq.team==='blue'?-60:W+60;
  AIRMOVE=!!t.air;                                   // aircraft need no crossings
  let tx=null,ty=null,sp=t.speed,stopAt=0;

  // A formation anchor inside a building is the squad-level twin of a body
  // inside one. stepSquad only ever tests where the anchor is GOING, so once it
  // is in there every direction is blocked, the whole unit freezes, and its men
  // go on dressing their formation around a point that will never move again.
  // That is what "stuck near the base" actually was: the men were free, the
  // anchor was not. Walk it out, whatever the orders say.
  if(!t.air){
    const afoot=!t.vehicle&&t.kind!=='siege';
    if(blockedFor(sq.fx,sq.fy,afoot,sq.team)){
      const p=freeSpot(sq.fx,sq.fy,afoot,sq.team);
      const ax=p.x-sq.fx,ay=p.y-sq.fy,ad=Math.hypot(ax,ay);
      if(ad>.01){
        const st=Math.min(ad,110*dt+1.2);        // shoulder out, do not teleport
        sq.fx+=ax/ad*st; sq.fy+=ay/ad*st;
        sq.stuck=0;
      }
    }
  }

  if(sq.routed){
    tx=homeX; ty=sq.fy; sp=t.speed*1.35;
    if(sq.team==='blue'?sq.fx<-40:sq.fx>W+40){ sq.gone=true;
      for(const s of sq.soldiers) s.alive=false; return; }
  } else {
    const o=sq.order;
    if(o.kind==='move'){ tx=o.x; ty=o.y;
      if((o.x-sq.fx)**2+(o.y-sq.fy)**2<64) nextOrder(sq); }
    else if(o.kind==='build'){
      tx=o.x; ty=o.y;
      if((o.x-sq.fx)**2+(o.y-sq.fy)**2<2600){       // on site: down tools and dig
        tx=null; ty=null;
        o.t-=dt*(0.35+0.65*(sq.alive/sq.initial));  // fewer hands, slower work
        if(quality&&Math.random()<dt*3) burst(o.x+vr(-40,40),o.y+vr(-30,30),1,'dust');
        if(o.t<=0){
          buildLine(sq.team,o.what,o.x1,o.y1,o.x2,o.y2);
          sq.order={kind:'hold'};
          if(sq.team===viewTeam()) toast(WORKNAME[o.what][0].toUpperCase()+WORKNAME[o.what].slice(1)+' finished');
        }
      }
    }
    else if(o.kind==='back'){ tx=homeX; ty=sq.fy; sp=t.speed*.85; }
    else if(o.kind==='castle'){
      const c=enemyCastle(sq.team);
      if(c){ tx=c.x+(sq.team==='blue'?-c.hw-30:c.hw+30); ty=c.y+((sq.id%5)-2)*46;
        stopAt=(t.kind==='ranged')?t.range*.7:(t.kind==='siege')?t.range*.75:0; }
      else sq.order={kind:'hold'};
    }
    else if(o.kind==='attack'||o.kind==='charge'){
      let e=o.sq;
      if(!e||e.gone||e.routed){ e=nearestEnemySquad(sq); o.sq=e; }
      if(e){ tx=e.fx; ty=e.fy;
        stopAt=(t.kind==='ranged')?t.range*.78:(t.kind==='siege')?t.range*.8:0;
        if(o.kind==='charge') sp=t.speed*1.3; }
      else sq.order={kind:'hold'};
    }
  }
  const wasCrossing=sq.crossing;
  if(sq.crossT>0) sq.crossT-=dt;
  if(tx!==null&&acrossRiver(sq.fx,sq.fy,tx,ty)){   // no swimming — head for a crossing
    const c=crossFor(sq.fy);
    sq.crossT=2.5; sq.crossWide=c.type==='bridge';
    if(Math.abs(sq.fy-c.y)>30||Math.abs(sq.fx-riverXAt(c.y))>150){ tx=riverXAt(c.y); ty=c.y; stopAt=0; }
    else { tx=riverXAt(c.y)+(sq.fx<riverXAt(c.y)?190:-190); ty=c.y; stopAt=0; }
  }
  // stay in column until the whole squad is off the water
  if(sq.crossT>0&&Math.abs(sq.fx-riverXAt(sq.fy))<110) sq.crossT=Math.max(sq.crossT,1.3);
  sq.crossing=sq.crossT>0;
  if(sq.crossing!==wasCrossing) footprint(sq);
  if(tx!==null){
    const foot=!t.vehicle&&t.kind!=='siege';         // troops on foot walk through buildings
    const bl=t.air?(()=>false):((bx,by)=>blockedFor(bx,by,foot,sq.team));
    let dx=tx-sq.fx,dy=ty-sq.fy;
    const d=Math.hypot(dx,dy);
    if(d>1){
      // Formations give way to one another. Separation alone works body by body,
      // so men simply slot into the gaps between other men and two squads walk
      // through each other into one indistinguishable mass. Steering the whole
      // formation off its neighbours is what keeps them readable as units.
      let ux=dx/d,uy=dy/d;
      const pu=squadPush(sq);
      if(pu.x||pu.y){
        ux+=pu.x*.9; uy+=pu.y*.9;
        const ul=Math.hypot(ux,uy)||1; ux/=ul; uy/=ul;
      }
      const ang=Math.atan2(uy,ux);
      const mul=moveMul(sq.fx,sq.fy,t)*slopeMul(sq.fx,sq.fy,ang);
      if(d>stopAt){
        const st=Math.min(sp*mul*dt,d-stopAt);
        const nx=sq.fx+ux*st,ny=sq.fy+uy*st;
        const px0=sq.fx,py0=sq.fy;
        if(!bl(nx,ny)){ sq.fx=nx; sq.fy=ny; sq.slide=0; }
        else {
          const p=steerStep(sq.fx,sq.fy,ang,st,foot,sq.team);   // swing round it
          if(p){ sq.fx=p.x; sq.fy=p.y; }
          else {
            const pxs=-dy/d,pys=dx/d;                           // last resort: hug the face
            if(!sq.slide) sq.slide=(sq.fy<H/2)?-1:1;
            const st2=st*1.3;
            let ax=sq.fx+pxs*sq.slide*st2,ay=sq.fy+pys*sq.slide*st2;
            if(!bl(ax,ay)){ sq.fx=ax; sq.fy=ay; }
            else { sq.slide=-sq.slide;
              ax=sq.fx+pxs*sq.slide*st2; ay=sq.fy+pys*sq.slide*st2;
              if(!bl(ax,ay)){ sq.fx=ax; sq.fy=ay; } }
          }
        }
        // if a unit has made no headway for a while, work it around the obstruction
        if(Math.hypot(sq.fx-px0,sq.fy-py0)<st*.25){
          sq.stuck=(sq.stuck||0)+dt;
          if(sq.stuck>1.4){
            const a2=ang+(sq.slide>0?1.35:-1.35);
            const bx=sq.fx+Math.cos(a2)*sp*mul*dt*1.6,by=sq.fy+Math.sin(a2)*sp*mul*dt*1.6;
            if(!bl(bx,by)){ sq.fx=bx; sq.fy=by; }
            else sq.slide=-sq.slide;
            if(sq.stuck>4){ sq.stuck=0; sq.slide=-sq.slide; }
          }
        } else sq.stuck=0;
      }
      let diff=((ang-sq.facing+Math.PI*3)%(Math.PI*2))-Math.PI;
      sq.facing+=clamp(diff,-3.4*dt,3.4*dt);
    }
  }
  sq.fx=clamp(sq.fx,-80,W+80); sq.fy=clamp(sq.fy,20,H-20);

  sq.moraleT-=dt;
  if(sq.moraleT<=0){
    sq.moraleT=1;
    const ratio=sq.alive/sq.initial;
    if(!sq.routed&&ratio<.36&&R()<(.36-ratio)*1.6){
      sq.routed=true;
      toast((sq.team==='blue'?'Blue ':'Red ')+sq.t.name+' rout!');
    }
  }
}
function stepSoldier(s,dt){
  if(!s.alive) return;
  s.ramp=0;                                       // cleared by accel(); see the tail
  // Inside something it should not be in: get clear first, orders can wait.
  if(escapeSolid(s,dt)){
    s.sp=0; separate(s,dt);
    s.x=clamp(s.x,-90,W+90); s.y=clamp(s.y,10,H-10);
    return;
  }
  const px0=s.x,py0=s.y;
  const sq=s.sq,t=sq.t,flags=t.air?0:terrainAt(s.x,s.y);
  AIRMOVE=!!t.air;
  if(flags&WOOD) s.charge=false;

  if(sq.routed){
    const hx=sq.team==='blue'?-60:W+60;
    const a=face(s,Math.atan2(sq.fy-s.y,hx-s.x),dt);
    const m=moveMul(s.x,s.y,t);
    const sp=accel(s,t.speed*1.35*m*crowdMul(s),dt);
    move(s,Math.cos(a)*sp*dt,Math.sin(a)*sp*dt);
    separate(s,dt);                                // even a rout does not run through itself
    s.tgt=null; return;
  }
  const marching=sq.disengage>0&&(sq.order.kind==='move'||sq.order.kind==='back'||sq.order.kind==='hold');
  if(marching){
    s.tgt=null; s.wall=null; face(s,sq.facing,dt);
    slotInto(sq,s.idx);
    guide(s,SX,SY);
    const dx=GX-s.x,dy=GY-s.y,d=Math.hypot(dx,dy);
    if(d>2){ const m=moveMul(s.x,s.y,t)*slopeMul(s.x,s.y,Math.atan2(dy,dx));
      const sp=accel(s,Math.min(t.speed*1.5*m,d*5)*crowdMul(s),dt);
      if(move(s,dx/d*sp*dt,dy/d*sp*dt)) s.jam=0; else unjam(s,sp,dt);
      s.step+=dt*(2+s.sp*.11); }
    else accel(s,0,dt);
    separate(s,dt);
    s.x=clamp(s.x,-90,W+90); s.y=clamp(s.y,10,H-10); return;
  }
  s.seek-=dt;
  const aggro=sq.order.kind==='charge'?130:t.kind==='cav'?95:(t.kind==='ranged'||t.kind==='siege')?t.range:70;
  if(s.seek<=0||!s.tgt||!s.tgt.alive){
    s.seek=.35+R()*.3;
    const pref=(sq.order.kind==='attack'||sq.order.kind==='charge')?(sq.order.sq||null):null;
    let range=aggro;
    if(t.kind==='ranged') range=t.range*(1+.12*elevAt(s.x,s.y))*((flags&WOOD)?.6:1);
    s.tgt=findEnemy(s,range,pref);
    if(s.tgt&&t.kind!=='ranged'&&t.kind!=='siege'&&acrossRiver(s.x,s.y,s.tgt.x,s.tgt.y)
       &&Math.abs(s.y-crossFor(s.y).y)>150) s.tgt=null;
    s.wall=s.tgt?null:nearestWall(s.x,s.y,sq.team,(t.kind==='cav'||t.kind==='ranged')?30:(t.kind==='siege'?t.range:0));
    s.cas=(s.tgt||s.wall)?null:nearestCastle(s.x,s.y,sq.team,
      t.kind==='siege'?t.range:t.kind==='ranged'?t.range*.9:26);
    if(sq.order.kind==='castle'&&!s.tgt) s.cas=enemyCastle(sq.team);
  }
  face(s,s.tgt&&s.tgt.alive?Math.atan2(s.tgt.y-s.y,s.tgt.x-s.x):sq.facing,dt);
  if(s.kick>0) s.kick-=dt*5;
  if(t.vehicle||t.kind==='siege'){
    let td=((s.ang-s.turret+Math.PI*3)%(Math.PI*2))-Math.PI;   // turret traverses
    s.turret+=clamp(td,-1.7*dt,1.7*dt);
    let hd=((sq.facing-s.hull+Math.PI*3)%(Math.PI*2))-Math.PI; // hull swings slower
    s.hull+=clamp(hd,-1.25*dt,1.25*dt);
    if(s.rec>0) s.rec-=dt*3.2;
  }

  let moved=false;
  if(t.kind==='siege'){
    if(s.tgt){ const d=dist(s.x,s.y,s.tgt.x,s.tgt.y);
      if(d<=t.meleeRange+2) melee(s,dt,t.meleeDmg,t.meleeRange);
      else if(d>=t.minRange&&d<=t.range) fire(s,dt); }
    else if(s.wall){
      const d=dist(s.x,s.y,s.wall.x,clamp(s.y,s.wall.y-s.wall.len/2,s.wall.y+s.wall.len/2));
      if(d>=t.minRange&&d<=t.range) fire(s,dt,s.wall); }
    else if(s.cas&&!s.cas.dead){
      const d=castleDist(s.cas,s.x,s.y);
      if(d>=t.minRange*.5&&d<=t.range) fire(s,dt,null,s.cas); }
  } else if(s.tgt&&s.tgt.alive){
    const d=dist(s.x,s.y,s.tgt.x,s.tgt.y);
    if(t.kind==='ranged'){
      if(d<=t.meleeRange+2) melee(s,dt,t.meleeDmg,t.meleeRange); else fire(s,dt);
    } else if(d<=t.range) melee(s,dt,t.dmg,t.range);
    else if(d<aggro+40&&!acrossRiver(s.x,s.y,s.tgt.x,s.tgt.y)){
      const a=s.ang;                                  // already turned toward him, at a rate
      const m=moveMul(s.x,s.y,t)*slopeMul(s.x,s.y,a);
      const sp=accel(s,t.speed*(sq.order.kind==='charge'?1.3:1)*m*crowdMul(s),dt);
      move(s,Math.cos(a)*sp*dt,Math.sin(a)*sp*dt); s.step+=dt*(2+s.sp*.12);
      if(t.kind==='cav'&&sp>68&&!(flags&WOOD)){ s.charge=true;
        if(quality&&Math.random()<dt*4) burst(s.x,s.y,1,'dust'); }
      moved=true;
    }
  } else if(s.wall&&!s.wall.dead&&(t.kind==='cav'||t.kind==='ranged')){
    const cy=clamp(s.y,s.wall.y-s.wall.len/2,s.wall.y+s.wall.len/2);
    const d=dist(s.x,s.y,s.wall.x,cy);
    if(d<=t.range+4){ s.cd-=dt;
      if(s.cd<=0){ s.cd=t.cd; hurtWall(s.wall,t.dmg*rnd(.8,1.2)*.8); burst(s.wall.x,cy,1,'spark'); }
      moved=true;
    } else if(d<40){ const a=face(s,Math.atan2(cy-s.y,s.wall.x-s.x),dt);
      const m=moveMul(s.x,s.y,t);
      const sp=accel(s,t.speed*m*crowdMul(s),dt);
      move(s,Math.cos(a)*sp*dt,Math.sin(a)*sp*dt); moved=true; }
  } else if(s.cas&&!s.cas.dead&&(t.kind==='cav'||t.kind==='ranged')){
    const d=castleDist(s.cas,s.x,s.y),px=CPX,py=CPY;
    face(s,Math.atan2(py-s.y,px-s.x),dt);
    if(t.kind==='ranged'){
      if(d<=t.range){ s.cd-=dt;
        if(s.cd<=0){ s.cd=t.cd*rnd(.85,1.15);
          if(t.shell) shots.push({kind:t.shell,sx:s.x,sy:s.y,x:s.x,y:s.y,tx:px+rnd(-10,10),ty:py+rnd(-12,12),
            t:0,arc:0,lob:false,dur:d/620,team:sq.team,dmg:t.shellDmg,splash:t.splash||0,
            pierce:0,av:t.av||1,stone:s.cas});
          else shots.push({kind:'bullet',sx:s.x,sy:s.y,x:s.x,y:s.y,tx:px,ty:py,t:0,arc:0,av:1,
            dur:Math.max(.05,d/1500),team:sq.team,dmg:t.dmg,stone:s.cas}); }
        moved=true; }
    } else if(d<=t.range+6){
      s.cd-=dt;
      if(s.cd<=0){ s.cd=t.cd;
        hurtCastle(s.cas,t.dmg*rnd(.8,1.2)*(t.kind==='cav'?.4:1.1));
        burst(px,py,2,'dust'); }
      moved=true;
    } else if(sq.order.kind==='castle'||d<70){
      const m=moveMul(s.x,s.y,t);
      const sp=accel(s,t.speed*m*crowdMul(s),dt);
      move(s,Math.cos(s.ang)*sp*dt,Math.sin(s.ang)*sp*dt); s.step+=dt*(2+s.sp*.11); moved=true;
    }
  }
  if(!moved){
    slotInto(sq,s.idx);
    guide(s,SX,SY);
    const dx=GX-s.x,dy=GY-s.y,d=Math.hypot(dx,dy);
    if(d>2){ const m=moveMul(s.x,s.y,t);
      const sp=accel(s,Math.min(t.speed*1.35*m,d*5)*crowdMul(s),dt);
      if(move(s,dx/d*sp*dt,dy/d*sp*dt)) s.jam=0; else unjam(s,sp,dt);
      s.step+=dt*(2+s.sp*.11);
      if(t.kind==='cav'&&sp>68&&!(flags&WOOD)) s.charge=true; }
  }
  if(!s.ramp) accel(s,0,dt);                     // standing still: wind the speed down
  s.moved=(Math.abs(s.x-px0)+Math.abs(s.y-py0))>dt*8?1:0;   // for exhaust and dust
  separate(s,dt);
  s.x=clamp(s.x,-90,W+90); s.y=clamp(s.y,10,H-10);
}
const radOf=s=>{ const k=s.sq.t.kind; return k==='air'?16:k==='cav'?5.6:k==='siege'?9.5:4.4; };
// What it takes to shove a body aside. A rifleman does not move a tank, and two
// riflemen give way to each other equally.
const massOf=s=>{ const k=s.sq.t.kind; return k==='cav'?7:k==='siege'?9:k==='air'?5:1; };
function separate(s,dt){
  // Hard bodies: nobody walks through anybody, friend or enemy. Overlap is
  // resolved by pushing along the line between the two centres, in proportion
  // to how much each one weighs.
  const rs=radOf(s);
  collect(s.x,s.y,rs+14);
  let px=0,py=0,hits=0,deep=0;
  for(let i=0;i<NEARn;i++){
    const o=NEAR[i]; if(o===s||!o.alive) continue;
    if(!!o.sq.t.air!==!!s.sq.t.air) continue;        // one is flying
    // Men of one squad pack into their formation; men of another are kept at
    // arm's length, so two units cannot comb through one another. An enemy gets
    // the smallest buffer of all - closing to melee has to stay possible.
    const md=(rs+radOf(o))*(o.sq===s.sq?1:o.sq.team!==s.sq.team?1.1:1.5);
    let dx=s.x-o.x,dy=s.y-o.y;
    const d2=dx*dx+dy*dy;
    if(d2>=md*md) continue;
    let d=Math.sqrt(d2);
    if(d<.0005){ const a=(s.idx*1.73+i*.61)%6.28318; dx=Math.cos(a); dy=Math.sin(a); d=1; }
    const overlap=md-d;
    if(overlap>deep) deep=overlap;
    // Over-relax a little past the exact share. Both bodies resolve in the same
    // frame and each is still walking, so the honest half-each split converges
    // slowly enough that a press never quite comes apart.
    const mine=massOf(s),theirs=massOf(o);
    const share=1.25*overlap*(theirs/(mine+theirs));
    px+=dx/d*share; py+=dy/d*share;
    hits++;
  }
  s.crowd=hits;                                      // read back as crowd braking
  if(!hits) return;
  const m=Math.hypot(px,py);
  if(m<.0005) return;
  // Barely touching resolves gently; badly overlapped resolves firmly. Without
  // the floor a press never untangles, and without the ceiling a body caught
  // inside another one would snap clear across the field.
  const cap=Math.min(m,Math.max(1.4,deep*.6)+90*dt);
  move(s,px/m*cap,py/m*cap);
}
// ---- inertia and turning: what makes movement read as smooth rather than
// mechanical. Nothing here changes how fast a unit crosses open ground, only
// how it gets up to that speed and how it comes round to a new heading. ----
const ACCEL={ranged:560,cav:210,siege:165,air:300};   // world units per second squared
const TURN ={ranged:9.5,cav:3.4,siege:2.6,air:2.2};   // radians per second
function accel(s,want,dt){
  const a=(ACCEL[s.sq.t.kind]||480)*dt;
  const d=want-s.sp;
  s.sp+= d>a ? a : d<-a*1.7 ? -a*1.7 : d;             // brakes harder than it pulls away
  s.ramp=1;
  return s.sp;
}
function face(s,a,dt){
  const r=(TURN[s.sq.t.kind]||8)*dt;
  const d=((a-s.ang+Math.PI*3)%(Math.PI*2))-Math.PI;
  s.ang+=clamp(d,-r,r);
  return s.ang;
}
// A body in a press slows down instead of climbing over the man in front.
const crowdMul=s=>1/(1+.2*Math.max(0,(s.crowd||0)-1));
// try the straight line, then progressively wider swings around whatever is in the way
const PROBE=[0,.3,-.3,.62,-.62,1.0,-1.0,1.45,-1.45,1.95,-1.95];
function steerStep(x,y,ang,len,foot,team){
  for(let i=0;i<PROBE.length;i++){
    const a=ang+PROBE[i];
    const nx=x+Math.cos(a)*len, ny=y+Math.sin(a)*len;
    if(!blockedFor(nx,ny,foot,team)){
      // look one step further so units do not tuck into dead ends
      if(i>0&&blockedFor(nx+Math.cos(a)*len*1.6,ny+Math.sin(a)*len*1.6,foot,team)) continue;
      return {x:nx,y:ny};
    }
  }
  for(let i=0;i<PROBE.length;i++){                 // dead end: take any opening at all
    const a=ang+PROBE[i];
    const nx=x+Math.cos(a)*len, ny=y+Math.sin(a)*len;
    if(!blockedFor(nx,ny,foot,team)) return {x:nx,y:ny};
  }
  return null;
}
function move(s,dx,dy){
  if(s.sq.t.air){ s.x+=dx; s.y+=dy; return true; }      // nothing on the ground stops it
  const foot=!s.sq.t.vehicle&&s.sq.t.kind!=='siege',tm=s.sq.team;
  const nx=s.x+dx,ny=s.y+dy;
  let moved=false;
  if(!blockedFor(nx,ny,foot,tm)){ s.x=nx; s.y=ny; moved=true; }
  else {
    const len=Math.hypot(dx,dy);
    if(len>.01){
      const p=steerStep(s.x,s.y,Math.atan2(dy,dx),len,foot,tm);
      if(p){ s.x=p.x; s.y=p.y; moved=true; }
    }
    if(!moved&&!blockedFor(s.x,ny,foot,tm)){ s.y=ny; moved=true; }
    else if(!moved&&!blockedFor(nx,s.y,foot,tm)){ s.x=nx; moved=true; }
  }
  if(moved&&s.sq.t.vehicle){
    const fl=tGrid[gi(s.x,s.y)];
    if(fl&WOOD) crushTrees(s);
    if(fl&FIELD) flattenCrop(s.x,s.y);
  }
  return moved;
}
// Escaping solid ground. move() only ever tests where a body is going, never
// where it is, so anything that ended up inside a building, a cliff or a wall
// found every neighbouring cell blocked as well and was stuck there for good.
// A vehicle spawned at a base whose footprint clips a bunker is the usual way
// it happened. This walks it out to the nearest open ground instead.
//
// Deliberately bypasses move(): the body is already somewhere it may not be, so
// the normal rules cannot get it out. Uses no randomness, so lockstep peers all
// extract the same unit along the same line on the same tick.
function escapeSolid(s,dt){
  if(s.sq.t.air) return false;
  const foot=!s.sq.t.vehicle&&s.sq.t.kind!=='siege',tm=s.sq.team;
  if(!blockedFor(s.x,s.y,foot,tm)) return false;
  for(let r=TG*.8;r<=TG*8;r+=TG*.6){
    for(let a=0;a<16;a++){
      const ang=a*.3927, nx=s.x+Math.cos(ang)*r, ny=s.y+Math.sin(ang)*r;
      if(blockedFor(nx,ny,foot,tm)) continue;
      const step=Math.min(r,Math.max(.8,90*dt));  // shoulder out, do not teleport
      s.x+=Math.cos(ang)*step; s.y+=Math.sin(ang)*step;
      s.jam=0;
      return true;
    }
  }
  return false;                                   // sealed in on every side: nothing to be done
}
function unjam(s,sp,dt){
  s.jam+=dt;
  if(s.jam<.25) return;
  if(!hasWater()){                             // no water: just work along the obstacle
    const a2=s.ang+(s.jam>1?1.7:-1.7);
    move(s,Math.cos(a2)*sp*dt,Math.sin(a2)*sp*dt);
    if(s.jam>2.4) s.jam=0;
    return;
  }
  const c=crossFor(s.y);                       // pressed against the bank: walk to the crossing
  const cx=riverXAt(c.y);
  let a;
  if(Math.abs(s.y-c.y)>20) a=Math.atan2(c.y-s.y,cx-s.x);
  else a=(s.x<cx)?0:Math.PI;
  if(!move(s,Math.cos(a)*sp*1.3*dt,Math.sin(a)*sp*1.3*dt)){
    const b=a+(s.jam>1?1.9:-1.9);
    move(s,Math.cos(b)*sp*dt,Math.sin(b)*sp*dt);
  }
  if(s.jam>2.4) s.jam=0;
}
// a man who cannot walk straight to a spot on the far bank walks to the crossing instead
let GX=0,GY=0;
function guide(s,tx,ty){
  if(acrossRiver(s.x,s.y,tx,ty)){
    const c=crossFor(s.y); GX=riverXAt(c.y); GY=c.y;
    if(Math.abs(s.y-c.y)<26&&Math.abs(s.x-GX)<150) GX=riverXAt(c.y)+(s.x<GX?200:-200);
  } else { GX=tx; GY=ty; }
}
const coverMul=(x,y,air)=>T.coverAt(terrain,x,y,air);
function melee(s,dt,dmg,range){
  s.cd-=dt; if(s.cd>0) return;
  const t=s.sq.t; s.cd=t.cd*rnd(.85,1.15);
  const v=s.tgt; if(!v||!v.alive) return;
  if(dist(s.x,s.y,v.x,v.y)>range+3) return;
  let mult=rnd(.75,1.3)*v.sq.t.armor;
  mult*=1+.09*clamp(elevAt(s.x,s.y)-elevAt(v.x,v.y),-2,2);     // high ground tells
  if(terrainAt(v.x,v.y)&(WOOD|STONE|BUILD)) mult*=.88;
  if(t.av&&v.sq.t.vehicle) mult*=t.av;
  if(s.charge){
    mult*=2.6*(elevAt(s.x,s.y)>elevAt(v.x,v.y)?1.3:1);          // downhill charge
    s.charge=false;
    const a=Math.atan2(v.y-s.y,v.x-s.x); v.x+=Math.cos(a)*9; v.y+=Math.sin(a)*9;
    burst(v.x,v.y,4,'dust');
  }
  hurt(v,dmg*mult,s.sq.team);
  s.kick=1;
  burst((s.x+v.x)/2,(s.y+v.y)/2,1,'spark');
}
function fire(s,dt,wallTarget,castleTarget){
  s.cd-=dt; if(s.cd>0) return;
  const t=s.sq.t; s.cd=t.cd*rnd(.85,1.15);
  let tx,ty;
  if(wallTarget){ tx=wallTarget.x; ty=clamp(s.y,wallTarget.y-wallTarget.len/2,wallTarget.y+wallTarget.len/2); }
  else if(castleTarget){ castleDist(castleTarget,s.x,s.y); tx=CPX+rnd(-14,14); ty=CPY+rnd(-18,18); }
  else { const v=s.tgt; if(!v) return; tx=v.x+rnd(-9,9); ty=v.y+rnd(-9,9); }
  const d=dist(s.x,s.y,tx,ty);
  if(t.shell){
    const lob=t.kind==='siege',n=t.salvo||1;
    for(let i=0;i<n;i++){
      const sc=lob?rnd(-22,22):rnd(-6,6),sc2=lob?rnd(-22,22):rnd(-6,6);
      shots.push({kind:t.shell,sx:s.x,sy:s.y,x:s.x,y:s.y,tx:tx+sc+(n>1?rnd(-70,70):0),
        ty:ty+sc2+(n>1?rnd(-70,70):0),t:-i*.16,arc:0,lob,
        dur:d/(t.shell==='rocket'?620:lob?300:900),team:s.sq.team,dmg:t.shellDmg,
        splash:t.splash||0,pierce:t.pierce||0,av:t.av||1,stone:castleTarget||null});
    }
    burst(s.x,s.y,4,'dust'); burst(s.x,s.y,2,'flash'); s.rec=1; s.kick=1; sfx('cannon',s.x,s.y);
    if(quality) parts.push({x:s.x,y:s.y,vx:0,vy:0,t:.14,r:9,type:'muzzle'});
  } else {
    const dmg=t.dmg*(1+.06*elevAt(s.x,s.y));
    shots.push({kind:'bullet',sx:s.x,sy:s.y,x:s.x,y:s.y,tx,ty,t:0,arc:0,
      dur:Math.max(.05,d/1500),team:s.sq.team,dmg,av:t.av||1});
    sfx(s.sq.type==='mg'?'mg':'rifle',s.x,s.y);
    burst(s.x,s.y,1,'flash'); s.kick=1;
  }
}
function hurt(v,a,by){
  if(by===attacker) a*=redEdge();
  v.hp-=a;
  if(v.hp<=0){
    v.alive=false; bloodMark(v.x,v.y,v.sq.team); stats[v.sq.team]++;
    if(bodies.length<240)                          // he goes down where he stood
      if(v.sq.t.vehicle&&plumes.length<26) plumes.push({x:v.x,y:v.y,t:vr(5,10)});
      bodies.push({x:v.x,y:v.y,a:v.ang,team:v.sq.team,veh:!!v.sq.t.vehicle,
        t:v.sq.t.vehicle?3.4:1.9,max:v.sq.t.vehicle?3.4:1.9,spin:vr(-1.6,1.6)});
    if(by&&by!==v.sq.team){                      // a kill pays out, and holding pays a little better
      const worth=v.sq.cost/v.sq.initial;
      const pay=clamp(Math.round(worth*6)+4,6,160)*(by===defender?1.4:1);
      earned[by]+=Math.round(pay);
      addXP(by,clamp(Math.round(worth*2)+2,3,60)*(by===attacker&&mode==='ai'?dset().x:1));
    }
  }
}
function stepShots(dt){
  for(let i=shots.length-1;i>=0;i--){
    const a=shots[i]; a.t+=dt;
    const k=a.t/a.dur>1?1:a.t/a.dur;
    a.x=a.sx+(a.tx-a.sx)*k; a.y=a.sy+(a.ty-a.sy)*k;
    if(a.lob) a.arc=Math.sin(k*Math.PI)*Math.min(80,dist(a.sx,a.sy,a.tx,a.ty)*.16);
    if(a.pierce>0&&a.splash<=0&&k<1){
      collect(a.x,a.y,10);
      for(let j=0;j<NEARn&&a.pierce>0;j++){
        const o=NEAR[j];
        if(!o.alive||o.sq.team===a.team) continue;
        if(dist(o.x,o.y,a.x,a.y)<9){ hurt(o,a.dmg*rnd(.8,1.2)*o.sq.t.armor*coverMul(o.x,o.y,o.sq.t.air),a.team);
          burst(o.x,o.y,2,'spark'); a.pierce--; }
      }
      if(a.pierce<=0){ shots.splice(i,1); continue; }
    }
    if(k>=1){
      noteGunfire(a.tx,a.ty);
      killCivsNear(a.tx,a.ty,a.splash>0?0:7);        // small arms catch whoever is standing there
      if(a.splash>0){
        if(a.stone&&!a.stone.dead) hurtCastle(a.stone,a.dmg*3.2);
        detonate(a.tx,a.ty,a.dmg,a.splash,a.team,a.av);
      } else {
        collect(a.tx,a.ty,14);
        let hit=null,bd=169;
        for(let j=0;j<NEARn;j++){
          const o=NEAR[j]; if(!o.alive||o.sq.team===a.team) continue;
          const dx=o.x-a.tx,dy=o.y-a.ty,d=dx*dx+dy*dy; if(d<bd){bd=d;hit=o;}
        }
        if(hit) { hurt(hit,a.dmg*rnd(.7,1.25)*hit.sq.t.armor*coverMul(hit.x,hit.y,hit.sq.t.air)*(hit.sq.t.vehicle?(a.av||1):1),a.team);
          burst(a.tx,a.ty,1,'spark'); }
        else if(a.stone&&!a.stone.dead) hurtCastle(a.stone,a.dmg*.22);
        else {
          const w=nearestWall(a.tx,a.ty,a.team,12); if(w) hurtWall(w,a.dmg*.4);
          const n=bGrid[gi(a.tx,a.ty)];
          if(n>=0) hurtBuilding(buildings[n],a.dmg*.3);        // small arms chew at the walls
        }
      }
      shots.splice(i,1);
    }
  }
}
let aiT=0,pressT=115,aiBuy=14;
function engagedNear(cx,cy,foes){
  for(const f of foes) if(dist(cx,cy,f.fx,f.fy)<700) return true;
  return false;
}
function stepAI(dt){
  aiT-=dt;
  aiBuy-=dt;
  if(aiBuy<=0){                                   // the attacker feeds fresh units in with its coins
    aiBuy=Math.max(2.2,9-wave*.85)*dset().b;
    const light=['rifle','assault','rifle','apc','mg','sniper','at'];
    const heavy=['tank','tank','apc','assault','howitzer','mlrs','mortar','at','heli','aa'];
    let pool=(R()<Math.min(.75,.18+wave*.11)?heavy:light).filter(k=>unlocked('red',k));
    if(!pool.length) pool=['rifle'];
    const pick=pool[(R()*pool.length)|0];
    const mx=maxSquad('red');
    let n=1;
    for(const opt of [50,40,30,20,10,1]) if(opt<=mx&&unitCost(pick,opt)<=coinsLeft('red')*.5){ n=opt; break; }
    const buys=1+Math.min(2,Math.floor(wave/3));
    for(let b2=0;b2<buys;b2++)
    if(coinsLeft('red')>=unitCost(pick,n)&&liveCount('red')+n<=capOf('red')){
      const p=safeSpot('red',W-rnd(220,520),clamp(laneY[(R()*3)|0]+rnd(-220,220),90,H-90));
      if(inZone('red',p.x,p.y)){
        const sq=makeSquad('red',pick,p.x,p.y,n);
        sq.legion=laneOf(p.y)+1; spent.red+=unitCost(pick,n);
        order(sq,{kind:'move',x:p.x-700,y:p.y},true);
      }
    }
  }
  pressT-=dt;
  if(pressT<=0){                                  // a wave peels off for the enemy keep
    pressT=Math.max(18,58-wave*5)*dset().r;
    const ec=enemyCastle('red');
    if(ec&&!ec.dead){
      const pool=squads.filter(s=>s.team==='red'&&!s.gone&&!s.routed&&s.order.kind!=='castle');
      const send=Math.max(1,Math.round(pool.length*Math.min(.6,(.18+wave*.045)*dset().p)));
      pool.sort((a,b)=>dist(a.fx,a.fy,ec.x,ec.y)-dist(b.fx,b.fy,ec.x,ec.y));
      for(let i=0;i<send&&i<pool.length;i++) order(pool[i],{kind:'castle'},true);
    }
  }
  if(aiT>0) return; aiT=1.4*dset().r;
  const mine=[],foes=[],soft=[];
  for(const s of squads){
    if(s.gone||s.routed) continue;
    if(s.team==='red') mine.push(s);
    else { foes.push(s); if(s.t.kind==='ranged'||s.t.kind==='siege') soft.push(s); }
  }
  if(!mine.length) return;
  const ec=enemyCastle('red');

  // ---- three task forces, one per sector, each advancing as a body ----
  const tf=[[],[],[]];
  for(const sq of mine){
    if(sq.t.kind==='siege'){ tf[3-3]; }             // guns handled separately below
    tf[clamp(sq.tf===undefined?laneOf(sq.fy):sq.tf,0,2)].push(sq);
  }
  for(let g=0;g<3;g++){
    const force=tf[g].filter(sq=>sq.t.kind!=='siege');
    if(!force.length) continue;
    // where the group is, and how much of it has caught up
    let cx=0,cy=0,men=0;
    for(const sq of force){ cx+=sq.fx*sq.alive; cy+=sq.fy*sq.alive; men+=sq.alive; }
    cx/=men||1; cy/=men||1;
    let closed=0;
    for(const sq of force) if(dist(sq.fx,sq.fy,cx,cy)<520) closed++;
    const together=closed/force.length>=.6;

    // a base of ours under threat, or one of theirs worth taking, pulls the group
    let baseObj=null,bbd=1e9;
    for(const b of bases){
      if(b.dead) continue;
      const d=dist(cx,cy,b.x,b.y);
      const worth=(b.team==='blue'?d*.6:(b.cap>0?d*.5:d*1.6));
      if(worth<bbd){bbd=worth;baseObj=b;}
    }
    // when it has the measure of you, all three groups swing at the weakest sector
    let focusY=null;
    const conf=(diff==='hard'?.8:diff==='adapt'?clamp(battleTime/600,0,1):diff==='easy'?0:.35);
    if(conf>.45&&foes.length){
      const str=[0,0,0];
      for(const f of foes) str[clamp(laneOf(f.fy),0,2)]+=f.alive;
      let weak=0; for(let z=1;z<3;z++) if(str[z]<str[weak]) weak=z;
      if(R()<conf) focusY=laneY[weak];
    }
    // the objective: the nearest enemy body in this sector, else the headquarters
    let obj=null,bd=1e9;
    for(const f of foes){
      const d=dist(cx,cy,f.fx,f.fy)+Math.abs(laneOf(f.fy)-g)*900;
      if(d<bd){bd=d;obj=f;}
    }
    const useBase=baseObj&&baseObj.team==='blue'&&(!obj||bd>1400);
    const useKeep=!useBase&&(!obj||(ec&&!ec.dead&&(foes.length<=2||bd>2600)));
    let tx=useBase?baseObj.x:(useKeep&&ec?ec.x+ec.hw+40:obj.fx);
    let ty=useBase?baseObj.y:(useKeep&&ec?ec.y:obj.fy);
    if(focusY!==null&&!engagedNear(cx,cy,foes)) ty=focusY;
    const engaged=obj&&bd<760;

    // line abreast, perpendicular to the axis of advance
    const ang=Math.atan2(ty-cy,tx-cx);
    const px=-Math.sin(ang),py=Math.cos(ang);
    const step=together?520:170;                     // hold up for stragglers
    const ax=cx+Math.cos(ang)*step, ay=cy+Math.sin(ang)*step;

    force.sort((s1,s2)=>(s1.fy-s2.fy)||(s1.id-s2.id));
    const n=force.length;
    for(let i=0;i<n;i++){
      const sq=force[i];
      sq.tf=g;
      const off=(i-(n-1)/2)*(sq.t.vehicle?190:150);
      // armour and carriers lead, foot follows a little behind
      const lead=(sq.t.vehicle?110:sq.t.range>500?-260:0);
      const wx=clamp(ax+px*off+Math.cos(ang)*lead,80,W-80);
      const wy=clamp(ay+py*off+Math.sin(ang)*lead,80,H-80);
      const o=sq.order;
      if(engaged){
        // in contact: fight, but keep the anti-tank and guns on the right targets
        let t=obj;
        if(sq.t.av>2){ for(const f of foes) if(f.t.vehicle&&dist(sq.fx,sq.fy,f.fx,f.fy)<900){ t=f; break; } }
        else if(sq.t.kind==='cav'&&soft.length){
          let best=soft[0];
          for(const f of soft) if(dist(sq.fx,sq.fy,f.fx,f.fy)<dist(sq.fx,sq.fy,best.fx,best.fy)) best=f;
          if(dist(sq.fx,sq.fy,best.fx,best.fy)<1500) t=best;
        }
        if(!(o.kind==='attack'&&o.sq===t)) order(sq,{kind:'attack',sq:t});
      } else if(useKeep&&ec&&dist(sq.fx,sq.fy,ec.x,ec.y)<900){
        if(o.kind!=='castle') order(sq,{kind:'castle'},true);
      } else if(o.kind!=='move'||dist(o.x,o.y,wx,wy)>240){
        order(sq,{kind:'move',x:wx,y:wy},true);      // dress the line and step off together
      }
    }
  }

  // ---- the guns stay back and shell the biggest thing they can reach ----
  for(const sq of mine){
    if(sq.t.kind!=='siege') continue;
    const o=sq.order;
    if((o.kind==='attack'||o.kind==='castle')&&o.sq&&!o.sq.gone&&!o.sq.routed) continue;
    let t=null,best=-1;
    for(const f of foes){
      const d=dist(sq.fx,sq.fy,f.fx,f.fy);
      if(d>sq.t.range*1.25) continue;
      const score=f.alive*(f.t.vehicle?1.6:1);
      if(score>best){best=score;t=f;}
    }
    if(t) order(sq,{kind:'attack',sq:t});
    else if(ec&&!ec.dead&&dist(sq.fx,sq.fy,ec.x,ec.y)<sq.t.range*1.2) order(sq,{kind:'castle'});
    else {
      const g=tf[clamp(laneOf(sq.fy),0,2)].filter(x=>x.t.kind!=='siege');
      if(g.length){
        let gx=0,gy=0; for(const x of g){gx+=x.fx;gy+=x.fy;}
        gx/=g.length; gy/=g.length;
        const a2=Math.atan2(gy-sq.fy,gx-sq.fx);
        order(sq,{kind:'move',x:sq.fx+Math.cos(a2)*300,y:sq.fy+Math.sin(a2)*300},true);
      }
    }
  }
}

/* ===================== deployment ===================== */
function inZone(team,x,y){
  if(y<40||y>H-40) return false;
  if(solid(x,y)) return false;
  if(solid(x,y)) return false;
  const rx=hasWater()?riverXAt(y):W/2;
  const bank=hasWater()?BANK:30;
  return team==='blue'?(x>40&&x<rx-bank):(x>rx+bank&&x<W-40);
}
function hqSpawn(team,tx,ty){
  let best=null,bd=1e9;
  for(const b of bases){                            // the nearest base you hold sends them
    if(b.dead||b.team!==team) continue;
    const d=(tx===undefined)?0:dist(b.x,b.y,tx,ty);
    if(d<bd){bd=d;best=b;}
  }
  const c=castles.find(k=>k.team===team&&!k.dead);
  if(c&&(!best||(tx!==undefined&&dist(c.x,c.y,tx,ty)<bd))){
    const gx=c.x+(team===defender?c.hw+70:-(c.hw+70));
    return safeSpot(team,gx,c.y+rnd(-150,150));
  }
  if(best) return safeSpot(team,best.x+rnd(-90,90),best.y+rnd(-90,90));
  return safeSpot(team,team==='blue'?160:W-160,clamp(rnd(200,H-200),90,H-90));
}
const WORKNAME={wall:'a sandbag wall',wire:'a wire belt',trench:'a trench',mine:'a minefield'};
const WORKRATE={trench:.17,wire:.10,wall:.24,mine:.30};   // coins per metre of line
const WORKLVL={trench:TRENCH.lvl,wire:WIRE.lvl,wall:WALL.lvl,mine:MINE.lvl};
let building=null,drawing=null;
const lineCost=(what,len)=>Math.max(6,Math.round(len*WORKRATE[what]));
function buildLine(team,what,x1,y1,x2,y2){
  const len=Math.hypot(x2-x1,y2-y1),a=Math.atan2(y2-y1,x2-x1);
  if(what==='wall'){
    const n=Math.max(1,Math.round(len/WALL.len));
    for(let i=0;i<n;i++){
      const f=(i+.5)/n;
      walls.push({team,x:x1+(x2-x1)*f,y:y1+(y2-y1)*f,a:a+Math.PI/2,
        len:len/n+6,hp:WALL.hp,max:WALL.hp,dead:false});
    }
  } else if(what==='wire'){
    stampLine((x1+x2)/2,(y1+y2)/2,a,len,7,WIRED); paintWire((x1+x2)/2,(y1+y2)/2,a,len);
    noteWork(what,(x1+x2)/2,(y1+y2)/2,a,len);
  } else if(what==='trench'){
    stampLine((x1+x2)/2,(y1+y2)/2,a,len,11,TRENCHED); paintTrench((x1+x2)/2,(y1+y2)/2,a,len);
    noteWork(what,(x1+x2)/2,(y1+y2)/2,a,len);
  } else {
    const n=Math.max(2,Math.round(len/38));
    for(let i=0;i<=n;i++){
      const f=i/n;
      mines.push({team,x:x1+(x2-x1)*f+rnd(-8,8),y:y1+(y2-y1)*f+rnd(-8,8),t:0});
    }
  }
  burst((x1+x2)/2,(y1+y2)/2,8,'dust');
}
function orderBuild(team,what,x1,y1,x2,y2){
  const crew=selected.filter(sq=>!sq.gone&&sq.team===team&&sq.t.builder);
  if(!crew.length){ toast('Select an engineer unit first'); return false; }
  if(lvl[team]<WORKLVL[what]){ toast(WORKNAME[what]+' needs level '+WORKLVL[what]); return false; }
  const len=Math.hypot(x2-x1,y2-y1);
  if(len<60){ toast('Draw a longer line'); return false; }
  const cost=lineCost(what,len);
  if(cost>coinsLeft(team)){ toast('That line costs '+cost+' coins — you have '+coinsLeft(team)); return false; }
  if(!inZone(team,(x1+x2)/2,(y1+y2)/2)&&phase==='deploy'){ toast('Your side only'); return false; }
  const sq=crew[0];
  const t=clamp(len/30,4,26);
  order(sq,{kind:'build',what,x1,y1,x2,y2,x:(x1+x2)/2,y:(y1+y2)/2,t,max:t},true);
  spent[team]+=cost; paintPoints();
  toast(sq.t.name+' building '+WORKNAME[what]+' — '+Math.round(len)+'m, '+cost+' coins');
  return true;
}
const BUILDT={wall:7,wire:6,trench:11,mine:5};
const isWork=k=>k==='wall'||k==='wire'||k==='trench'||k==='mine';
function buildWork(team,what,x,y,a){
  if(what==='wall') walls.push({team,x,y,a,len:WALL.len,hp:WALL.hp,max:WALL.hp,dead:false});
  else if(what==='wire'){ stampLine(x,y,a,WIRE.len,7,WIRED); paintWire(x,y,a,WIRE.len);
    noteWork(what,x,y,a,WIRE.len); }
  else if(what==='trench'){ stampLine(x,y,a,TRENCH.len,11,TRENCHED); paintTrench(x,y,a,TRENCH.len);
    noteWork(what,x,y,a,TRENCH.len); }
  else if(what==='mine'){
    const cs=Math.cos(a),sn=Math.sin(a);
    for(let i=-1;i<=1;i++) mines.push({team,x:x+cs*i*34+rnd(-9,9),y:y+sn*i*34+rnd(-9,9),t:0});
  }
  burst(x,y,6,'dust');
}
function place(team,x,y){
  if(!unlocked(team,placing)){ toast(('Unlocks at level '+reqLvl(placing))); return; }
  const cost=placing==='wall'?WALL.cost:placing==='mine'?MINE.cost:
    placing==='wire'?WIRE.cost:placing==='trench'?TRENCH.cost:unitCost(placing);
  if(cost>coinsLeft(team)){ toast('Not enough coins'); return; }
  const add=(placing==='wall'||placing==='mine'||placing==='wire'||placing==='trench')?0:unitCount(placing);
  if(liveCount(team)+add>capOf(team)){
    toast('Command full — '+liveCount(team)+'/'+capOf(team)+' fighters (level '+lvl[team]+')'); return; }
  if(!inZone(team,x,y)){ toast('Your side only — not across the water'); return; }
  if(isWork(placing)){
    const crew=selected.filter(sq=>!sq.gone&&sq.team===team&&sq.t.builder);
    if(!crew.length){ toast('Select an engineer unit — they dig the works'); return; }
    const sq=crew[0];
    order(sq,{kind:'build',x,y,what:placing,a:placeAng,t:BUILDT[placing],max:BUILDT[placing]},true);
    pings.push({x,y,t:.9});
    toast(sq.t.name+' moving up to build '+WORKNAME[placing]);
  }
  else {
    const p=hqSpawn(team,x,y);                       // rolls out of the nearest base you hold
    const sq=makeSquad(team,placing,p.x,p.y);
    const r=rally[team];                             // gather where you told them to
    order(sq,{kind:'move',x:r?r.x:x,y:r?r.y:y},true);
    pings.push({x,y,t:.9});
  }
  spent[team]+=cost; paintPoints(); tap(); sfx('deploy');
}
function clearField(team){
  for(const sq of squads) if(sq.team===team) for(const s of sq.soldiers) s.alive=false;
  squads=squads.filter(s=>s.team!==team);
  soldiers=soldiers.filter(s=>s.sq.team!==team);
  walls=walls.filter(w=>w.team!==team||w.fixed);
  mines=mines.filter(m=>m.team!==team);
  spent[team]=0; selected=[]; paintPoints();
}
function safeSpot(team,x,y){
  for(let i=0;i<34;i++){
    const nx=x+rnd(-55,55)*(i/6),ny=clamp(y+rnd(-55,55)*(i/6),70,H-70);
    if(inZone(team,nx,ny)) return {x:nx,y:ny};
  }
  for(let i=0;i<40;i++){
    const nx=team==='blue'?rnd(80,W*.42):rnd(W*.58,W-80),ny=clamp(y+rnd(-160,160),70,H-70);
    if(inZone(team,nx,ny)) return {x:nx,y:ny};
  }
  // Last resort. This used to hand back a fixed point without checking it, so
  // when both searches failed a squad could be mustered straight into a wall.
  return freeSpot(team==='blue'?160:W-160,clamp(y,70,H-70),false,team);
}
function autoDeploy(team,pts){
  // hold back a war chest: the rest is spent on reinforcements once the shooting starts
  const plan=[]; const budgetPlan=(sandbox?9000:Math.min(pts,coinsLeft(team)))*.78;
  let left=budgetPlan, planned=liveCount(team), heavySpend=0;
  const roomCap=Math.min(sandbox?260:1e9,Math.round(capOf(team)*.85));
  const mix=[['rifle',.26],['assault',.15],['mg',.10],['sniper',.06],['at',.09],
             ['apc',.09],['tank',.12],['mortar',.07],['howitzer',.04],['mlrs',.02]];
  let guard=0;
  while(guard++<900){
    let r=R(),acc=0,pick='rifle';
    for(const [k,w] of mix){ acc+=w; if(r<=acc){pick=k;break;} }
    if(!unlocked(team,pick)) pick='rifle';
    const heavy=pick==='tank'||pick==='howitzer'||pick==='mlrs'||pick==='apc';
    const mx=maxSquad(team);
    let n=1;                                              // the biggest batch it can afford
    for(const opt of [40,30,20,10,1]) if(opt<=mx&&unitCost(pick,opt)<=left*(heavy?.3:.5)){ n=opt; break; }
    const c=unitCost(pick,n);
    if(heavy&&heavySpend+c>budgetPlan*.42){ continue; }   // armour and guns are a slice, not the army
    if(c<=left&&planned+n<=roomCap){
      plan.push([pick,n]); left-=c; planned+=n;
      if(heavy) heavySpend+=c;
    }
    else if(left<unitCost('rifle',1)||planned>=roomCap-2) break;
  }
  // ---- order of battle: line companies forward, support behind, armour massed, guns to the rear ----
  const line   =plan.filter(e=>e[0]==='rifle'||e[0]==='assault');
  const support=plan.filter(e=>e[0]==='mg'||e[0]==='at'||e[0]==='sniper'||e[0]==='aa'||e[0]==='worker');
  const armour =plan.filter(e=>e[0]==='tank');
  const carrier=plan.filter(e=>e[0]==='apc');
  const guns   =plan.filter(e=>UNITS[e[0]].kind==='siege');
  const xF=team==='blue'?W*.355:W*.645;
  const xS=team==='blue'?W*.29:W*.71;
  const xB=team==='blue'?W*.225:W*.775;
  const xE=team==='blue'?W*.13:W*.87;
  const put=(e,x,y,leg)=>{ const p=safeSpot(team,x,y);
    const sq=makeSquad(team,e[0],p.x,p.y,e[1]); sq.legion=leg; spent[team]+=unitCost(e[0],e[1]); };
  // three line companies, one per sector
  const lanes=[[],[],[]];
  line.forEach((t,i)=>lanes[i%3].push(t));
  lanes.forEach((arr,li)=>{
    const n=arr.length; if(!n) return;
    const span=Math.min(430,n*92);
    arr.forEach((tp,i)=>put(tp,xF+rnd(-28,28),
      clamp(laneY[li]+(n===1?0:-span/2+span*i/(n-1)),90,H-90),li+1));
  });
  // weapons companies dug in behind the line they support
  support.forEach((tp,i)=>{ const li=i%3;
    put(tp,xS+rnd(-30,30),clamp(laneY[li]+rnd(-140,140),90,H-90),li+1); });
  // armour massed as one fist in a chosen sector, carriers screening its flanks
  const spear=Math.floor(R()*3);
  armour.forEach((tp,i)=>put(tp,xF-(team==='blue'?60:-60)+rnd(-30,30),
    clamp(laneY[spear]+((i%2)?1:-1)*rnd(30,150),90,H-90),spear+1));
  carrier.forEach((tp,i)=>{ const li=i%2===0?spear:(spear+1)%3;
    put(tp,xF+rnd(-50,50),clamp(laneY[li]+rnd(-130,130),90,H-90),li+1); });
  // divisional artillery, well to the rear
  guns.forEach((tp,i)=>put(tp,(UNITS[tp[0]].minRange>200?xE:xB)+rnd(-30,30),
    clamp(laneY[i%3]+rnd(-90,90),90,H-90),4));
  for(let i=0;i<6&&left>=MINE.cost;i++){
    const mx=team==='blue'?rnd(W*.30,W*.44):rnd(W*.56,W*.70);
    const my=clamp(laneY[i%3]+rnd(-160,160),90,H-90);
    if(solid(mx,my)) continue;
    for(let j=0;j<3;j++) mines.push({team,x:mx+rnd(-26,26),y:my+rnd(-26,26),t:0});
    spent[team]+=MINE.cost; left-=MINE.cost;
  }
  if(left>=WALL.cost&&R()<.6){
    const wx=team==='blue'?xF+92:xF-92;
    for(let i=0;i<Math.min(3,Math.floor(left/WALL.cost));i++){
      if(solid(wx,laneY[i%3])) continue;
      walls.push({team,x:wx,y:laneY[i%3],len:WALL.len,hp:WALL.hp,max:WALL.hp,dead:false});
      spent[team]+=WALL.cost; }
  }
  paintPoints();
}

/* ===================== phases ===================== */
function cmdTeam(){
  if(phase==='deploy') return depTeam;
  if(phase!=='battle') return null;
  if(mode==='ai') return 'blue';
  return hot.stage==='orders'?hot.team:null;
}
function viewTeam(){ return cmdTeam()||(mode==='hot'?hot.team:'blue'); }
function deployRows(){
  el('deployRow').style.display='flex'; el('startBattle').style.display='block';
  el('legionRow').style.display='none'; el('orders').style.display='none';
  el('infoRow').style.display='flex';
}
function battleRows(){
  el('deployRow').style.display='flex'; el('startBattle').style.display='none';
  el('legionRow').style.display='flex'; el('orders').style.display='flex';
  el('infoRow').style.display='flex';
}
function beginGame(b){
  unlockAudio();
  todStart=(START_HOURS.find(h=>h.key===hourKey)||START_HOURS[1]).at;
  tod=todStart; sun=sunDir(tod); dayLight=lightAt(tod); night=isNight(tod);                                 // must happen inside the click
  sandbox=b>=999999; budget=b;
  matchSeed=matchSeed||1; srand(matchSeed); spent={blue:0,red:0}; earned={blue:0,red:0}; lvl={blue:1,red:1}; xp={blue:0,red:0}; wave=0; lastWave=-1; placing=null; timeUp=false; depTime=180; battleTime=0; speed=1; paused=false; syncSpeed();
  squads=[];soldiers=[];shots=[];parts=[];pings=[];walls=[];fires=[];castles=[];mines=[];bodies=[];bases=[];selected=[];
  stats={blue:0,red:0}; hot={stage:'orders',team:'blue',t:45,round:1};
  works=[]; genTerrain(); resetTerritory(); depTeam='blue'; placing=null; bindMode=false;
  if(mode==='ai') autoDeploy('red',b);
  phase='deploy';
  el('startVeil').style.display='none'; el('endVeil').style.display='none'; el('menuVeil').style.display='none';
  deployRows();
  buildPalette(); paintSizes(); setBuy(true,true); paintPoints(); focusZone();
}
function focusZone(){
  const w=cv.width/dpr,h=cv.height/dpr;
  cam.s=clamp(Math.min(w/(W*.58),h/H)*1.02,Math.min(w/W,h/H),3);
  const cx=depTeam==='blue'?W*.27:W*.73;
  cam.x=w/2-cx*cam.s; cam.y=h/2-(H/2)*cam.s;
}
function readyDeploy(){
  if(!squads.some(s=>s.team===depTeam)){ toast('Deploy a force first'); depTime=Math.max(depTime,10); return; }
  if(mode==='hot'&&depTeam==='blue'){
    depTeam='red'; depTime=180; placing=null; selected=[]; buildPalette(); paintPoints(); focusZone();
    showPass('Red command','Blue positions are hidden. Take your ground on the right.'); return;
  }
  startBattle();
}
function startBattle(){
  holdScreenAwake(true);
  remMode=false; el('remBtn').classList.remove('on');
  phase='battle'; selected=[]; battleTime=0; pressT=115; fit();
  battleRows();
  setBuy(false,true);
  // units already marching to a position keep going — the horn does not cancel your plan
  for(const sq of squads) if(!sq.order||sq.order.kind==='hold') order(sq,{kind:'hold'});
  el('done').style.display=mode==='hot'?'block':'none';
  if(mode==='hot'){ hot={stage:'orders',team:'blue',t:45,round:1};
    showPass('Blue orders','Round 1. Give your commands, then end orders.'); }
  else toast('Contact — take the crossings');
}
function showPass(title,text){
  el('passTitle').textContent=title;
  el('passTitle').className=title.indexOf('Red')>=0?'redc':'bluec';
  el('passText').textContent=text;
  el('passVeil').style.display='flex';
}
function endOrders(){
  if(hot.team==='blue'){ hot.team='red'; hot.t=45; selected=[];
    showPass('Red orders','Round '+hot.round+'. Give your commands, then end orders.'); }
  else { hot.stage='resolve'; hot.t=12; selected=[]; toast('Round '+hot.round+' — the lines close'); }
}
function finish(winner,why){
  holdScreenAwake(false);
  sfx(winner==='blue'?'win':'lose');
  phase='over';
  {                                              // book the result in the commander's record
    const won=winner==='blue';
    const sc=matchScore(won);
    prof.games++; if(won) prof.wins++; else prof.losses++;
    prof.kills+=stats.red;
    if(sc>prof.best) prof.best=sc;
    if(lvl.blue>prof.hiLvl) prof.hiLvl=lvl.blue;
    saveProf(); paintProf();
    lastScore=sc; lastBest=sc>=prof.best;
  }
  if(why==='surrender'){
    el('endTitle').textContent='Valenmark capitulates';
    el('endTitle').className='lose';
    el('endText').textContent='With nine tenths of the country overrun, the order went out to lay down arms.';
    el('sKills').textContent=stats.red; el('sLost').textContent=stats.blue;
    el('sTime').textContent=fmt(battleTime);
    el('endVeil').style.display='flex';
    return;
  }
  if(why==='time'){
    el('endTitle').textContent='The line held';
    el('endTitle').className='win';
    el('endText').textContent='Time is up and Red never took the ground. Blue holds the sector.';
    el('sKills').textContent=stats.red; el('sLost').textContent=stats.blue;
    el('sTime').textContent=fmt(battleTime);
    el('endVeil').style.display='flex';
    return;
  }
  el('endTitle').textContent = why==='keep'
    ? (winner==='blue'?'Red HQ overrun':'Your HQ overrun')
    : (mode==='ai'?(winner==='blue'?'The field is yours':'The line is broken')
                  :(winner==='blue'?'Blue holds the field':'Red holds the field'));
  el('endTitle').className=winner==='blue'?'win':'lose';
  el('endText').textContent = why==='keep'
    ? (winner==='blue'
        ? 'The Rothal capital is overrun and burning. Their war is finished.'
        : 'The Valenmark capital has fallen. The country is lost.')
    : (winner==='blue'
        ? 'The Rothal army is broken and scattered. Valenmark holds its ground.'
        : 'The Valenmark army is shattered. The country belongs to Rothal.');
  el('sKills').textContent=stats.red; el('sLost').textContent=stats.blue;
  el('sTime').textContent=fmt(battleTime);
  el('endScore').innerHTML=rankOf(lvl.blue).name+' '+prof.name+' scored <b>'+lastScore.toLocaleString()+'</b>'
    +(lastBest?' — a personal best':' · best <b>'+prof.best.toLocaleString()+'</b>')
    +' · level <b>'+lvl.blue+'</b> · match <b>'+prof.games+'</b>';
  el('endVeil').style.display='flex';
}
function openMenu(){
  if(phase==='start'||phase==='over') return;
  paused=true; el('menuVeil').style.display='flex';
  el('menuStat').textContent=MAPS[mapType].name+' · '+squads.filter(s=>!s.gone).length+' units · '
    +(stats.blue+stats.red)+' casualties · HQ '
    +Math.round((ownCastle('blue')?ownCastle('blue').hp/ownCastle('blue').max:0)*100)+'% / '
    +Math.round((ownCastle('red')?ownCastle('red').hp/ownCastle('red').max:0)*100)+'% · '+Math.round(1000/Math.max(frameMs,1))+' fps';
  el('mQuality').textContent='Graphics: '+(quality?'high':'fast');
  paintViewBtn();
  el('mSound').textContent='Sound: '+(isMuted()?'off':'on');
  el('mShake').textContent='Screen shake: '+(prof.shake===false?'off':'on');
  el('mHaptics').textContent='Vibration: '+(prof.haptics?'on':'off');
  suspendAudio();
}
function closeMenu(){ paused=false; el('menuVeil').style.display='none'; resumeAudio(); }

/* ===================== saved battles ===================== */
// A save is the whole battle, not a replay. The ground is regenerated from the
// match seed - which is what keeps a save small - and everything the fighting
// has changed since then is written on top of it: the grid cells that differ,
// the felled trees, the collapsed houses, the armies, and every clock the next
// tick will read. Litter that no rule reads back - particles, bodies, rings,
// weather - is not saved; it costs bytes and nobody misses it.
//
// Numbers go out at full precision on purpose. Anything the simulation reads,
// however cosmetic it looks, decides how many times R() is called on the next
// tick, so a value rounded for tidiness would put a loaded battle on a slightly
// different course from the one that was saved. The RNG state is restored last,
// after everything else has stopped disturbing it.
const SAVE_V=1;
let works=[];                          // trench and wire lines, so a load can repaint them
// A work is stamped into the terrain grid, and the grid is what a save carries.
// The line itself is kept only so the trench or the wire can be painted back
// into the ground layer on load; the oldest are dropped once the list is long.
function noteWork(what,x,y,a,len){
  works.push({what,x,y,a,len});
  if(works.length>400) works.shift();
}
const TEAMN={blue:1,red:2}, TEAMS=[null,'blue','red'];

// Churn only ever grows by one fixed step per pass, so a cell is described
// completely by how many steps it has taken. Storing the count rather than the
// value is what keeps it exact: the same additions through the same Float32Array
// give back the same float, where a decimal written out and read back would not.
const CHURN_STEP=.035, CHURN_MAX=32;
const CHURN_VAL=(()=>{
  const a=new Float32Array(CHURN_MAX+1),t=new Float32Array(1);
  for(let k=1;k<=CHURN_MAX;k++){ t[0]=Math.min(1,t[0]+CHURN_STEP); a[k]=t[0]; }
  return a;
})();
function churnSteps(v){
  for(let k=0;k<=CHURN_MAX;k++) if(CHURN_VAL[k]===v) return k;
  let best=0,bd=1e9;                              // never expected; take the closest
  for(let k=0;k<=CHURN_MAX;k++){ const d=Math.abs(CHURN_VAL[k]-v); if(d<bd){bd=d;best=k;} }
  return best;
}

function snapshot(){
  const qi=new Map(); squads.forEach((sq,i)=>qi.set(sq,i));
  const wi=new Map(); walls.forEach((w,i)=>wi.set(w,i));
  const bi=new Map(); buildings.forEach((b,i)=>bi.set(b,i));
  const si=new Map();
  squads.forEach((sq,i)=>sq.soldiers.forEach((s,j)=>si.set(s,i*4096+j)));

  const packOrd=o=>{
    const p={k:o.kind};
    if(o.x!==undefined){ p.x=o.x; p.y=o.y; }
    if(o.sq) p.q=qi.has(o.sq)?qi.get(o.sq):-1;
    if(o.what){
      p.w=o.what; p.t=o.t; p.mx=o.max;
      if(o.x1!==undefined) p.ln=[o.x1,o.y1,o.x2,o.y2];
      if(o.a!==undefined) p.a=o.a;
    }
    return p;
  };
  // A body that is down keeps its place in the squad, because a formation is
  // laid out by slot - but nothing else about it is ever read again, so it goes
  // out as a single 0.
  const packSol=s=>s.alive?[
    s.x,s.y,s.hp,s.cd,s.seek,s.charge?1:0,s.ang,s.step,s.jam,s.hull,s.turret,s.rec,
    s.kick,s.sp,s.crowd||0,s.moved||0,s.v,s.trk||0,
    (s.tgt&&s.tgt.alive&&si.has(s.tgt))?si.get(s.tgt):-1,
    (s.wall&&wi.has(s.wall))?wi.get(s.wall):-1,
    s.cas?TEAMN[s.cas.team]:0]:0;

  const tg=[];
  for(let i=0;i<tGrid.length;i++) if(!tGrid0||tGrid[i]!==tGrid0[i]) tg.push(i,tGrid[i]);
  const ch=[];
  for(let i=0;i<cGrid.length;i++) if(cGrid[i]>0) ch.push(i,churnSteps(cGrid[i]));

  return {
    v:SAVE_V, seed:matchSeed, rng:seed(),
    map:mapType, mode, diff, budget, sandbox:sandbox?1:0, cap:capChoice, limit:battleLimit,
    phase, depTeam, depTime, size:troopSize, bt:battleTime,
    wave, lw:lastWave, up:timeUp?1:0, speed, lc:lastCall?1:0, nid:nextId,
    ang:placeAng, rem:remMode?1:0,
    spent:{blue:spent.blue,red:spent.red}, earned:{blue:earned.blue,red:earned.red},
    lvl:{blue:lvl.blue,red:lvl.red}, xp:{blue:xp.blue,red:xp.red},
    stats:{blue:stats.blue,red:stats.red},
    hot:{stage:hot.stage,team:hot.team,t:hot.t,round:hot.round},
    tm:{ai:aiT,buy:aiBuy,press:pressT,terr:terrT,base:baseT,occ:occT,churn:churnT,
        mine:mineT,fire:fireT,cas:castleT,amb:ambT,acc,clock,tod:todStart,hour:hourKey},
    wind:{a:wind.a,v:wind.v}, sky,
    cam:{x:cam.x,y:cam.y,s:cam.s},
    own:Array.from(terrOwn), hold:Array.from(terrHold),
    castles:castles.map(c=>({t:c.team,hp:c.hp,d:c.dead?1:0,cd:c.cd,b:c.burn})),
    bases:bases.map(b=>({t:b.team,hp:b.hp,c:b.cap,d:b.dead?1:0})),
    blds:buildings.map((b,i)=>(b.dead||b.hp<b.max||b.hold)
      ?{i,hp:b.hp,d:b.dead?1:0,h:b.hold?TEAMN[b.hold]:0,ti:b.tint||0}:null)
      .filter(Boolean),
    fell:trees.map((t,i)=>t.dead?i:-1).filter(i=>i>=0),
    // A wall laid without an angle lies north-south (see wallLocal), so the
    // difference between "no angle" and "angle zero" is real: keep it.
    walls:walls.map(w=>({t:w.team,x:w.x,y:w.y,a:w.a===undefined?null:w.a,l:w.len,
      hp:w.hp,mx:w.max,d:w.dead?1:0,f:w.fixed?1:0,r:w.rubble?1:0})),
    mines:mines.map(m=>[TEAMN[m.team],m.x,m.y]),
    fires:fires.map(f=>[f.j,f.t,f.life,f.spread]),
    shots:shots.map(a=>({k:a.kind,sx:a.sx,sy:a.sy,tx:a.tx,ty:a.ty,t:a.t,d:a.dur,
      lb:a.lob?1:0,tm:TEAMN[a.team],dm:a.dmg,sp:a.splash||0,pi:a.pierce||0,av:a.av||1,
      st:a.stone?TEAMN[a.stone.team]:0})),
    works:works.map(w=>[w.what==='wire'?0:1,w.x,w.y,w.a,w.len]),
    // Scenery, kept so a wreck goes on smoking and the sky does not jump.
    plumes:plumes.map(p=>[p.x,p.y,p.t]),
    clouds:clouds.map(c=>[c.x,c.y,c.rx,c.ry,c.v,c.a]),
    civs:civs.filter(c=>c.alive&&bi.has(c.home)).map(c=>[c.x,c.y,c.hx,c.hy,bi.get(c.home),
      c.px,c.py,c.job==='farmer'?1:0,c.st,c.out,c.t,c.spd,c.ang,c.ph,c.calm]),
    sel:selected.map(sq=>qi.has(sq)?qi.get(sq):-1).filter(i=>i>=0),
    squads:squads.map(q=>({id:q.id,tm:q.team,ty:q.type,x:q.fx,y:q.fy,fa:q.facing,
      fm:q.formation,o:packOrd(q.order),ini:q.initial,al:q.alive,lg:q.legion,co:q.cost,
      ro:q.routed?1:0,mo:q.moraleT,dg:q.disengage,ct:q.crossT,cr:q.crossing?1:0,
      cw:q.crossWide?1:0,se:q.seen?1:0,st:q.seenT,gn:q.gone?1:0,fl:q.flag,
      sl:q.slide||0,sk:q.stuck||0,tf:q.tf===undefined?-1:q.tf,men:q.soldiers.map(packSol)})),
    order:soldiers.map(s=>si.has(s)?si.get(s):-1).filter(k=>k>=0),
    tg, ch
  };
}

// What the load list shows about a save, so the list can be drawn without
// reading a whole battle back in.
function saveMeta(auto){
  return {
    auto:auto?1:0, map:MAPS[mapType].name, mode, diff, phase,
    t:phase==='battle'?fmt(battleTime):'deploying',
    lvl:lvl.blue, men:liveCount('blue'), foe:liveCount('red'),
    land:Math.round(landShare('blue')*100), name:prof.name
  };
}

// A tree that came down before the save was written: no toppling, no leaves,
// just the cover gone and the trunk already lying on the ground.
function fellQuiet(t){
  if(!t||t.dead) return;
  t.dead=true; t.fall=1; t.fa=0;
  for(const i of t.cells) if(woodN[i]>0&&--woodN[i]===0) tGrid[i]&=~WOOD;
  if(canopyCtx){
    canopyCtx.globalCompositeOperation='destination-out';
    canopyCtx.beginPath(); canopyCtx.arc(t.x,t.y,t.s*1.3,0,6.28); canopyCtx.fill();
    canopyCtx.globalCompositeOperation='source-over';
  }
  layTrunk(t);
}

function restoreBattle(d){
  // Everything that could make this impossible is checked before a single
  // global is touched: a half-restored battle is worse than a refused load.
  if(!d||d.v!==SAVE_V) throw new Error('saved by another build');
  if(!MAPS[d.map]) throw new Error('unknown battlefield '+d.map);
  if(!Array.isArray(d.squads)||!Array.isArray(d.tg)) throw new Error('save is malformed');
  for(const q of d.squads) if(!UNITS[q.ty]) throw new Error('unknown unit '+q.ty);

  mapType=d.map; mode=d.mode==='hot'?'hot':'ai'; diff=DIFF[d.diff]?d.diff:'normal';
  budget=d.budget; sandbox=!!d.sandbox; capChoice=d.cap|0; battleLimit=d.limit||0;
  matchSeed=d.seed>>>0||1;
  squads=[];soldiers=[];shots=[];parts=[];pings=[];walls=[];fires=[];castles=[];
  mines=[];bodies=[];bases=[];selected=[];rings=[];plumes=[];weather=[];falling=[];
  works=[]; placing=null; building=null; drawing=null; bindMode=false; selectMode=false;
  box.on=false; ptr.down=false; pinch=null; lastSq=null;

  genTerrain();                      // same seed, same ground
  resetTerritory();

  // ---- what the fighting did to the ground ----
  for(const i of d.fell||[]) fellQuiet(trees[i]);
  treesDown=(d.fell||[]).length;
  for(const b of d.blds||[]){
    const bd=buildings[b.i]; if(!bd) continue;
    bd.hp=b.hp; bd.tint=b.ti||0; bd.hold=TEAMS[b.h||0]||null;
    if(b.d){ razeBuilding(bd); paintRuin(bd); }
  }
  for(let k=0;k<d.tg.length;k+=2) tGrid[d.tg[k]]=d.tg[k+1];   // the grid has the last word
  cGrid=terrain.churn; cGrid.fill(0); pGrid=new Uint8Array(TW*TH);
  for(let k=0;k<(d.ch||[]).length;k+=2){
    const i=d.ch[k],v=CHURN_VAL[clamp(d.ch[k+1],0,CHURN_MAX)];
    if(i<0||i>=cGrid.length) continue;
    cGrid[i]=v;
    if(v>.75){ pGrid[i]=2; paintMud(i%TW,(i/TW)|0,2); }
    else if(v>.35){ pGrid[i]=1; paintMud(i%TW,(i/TW)|0,1); }
  }
  for(const w of d.works||[]){
    const what=w[0]===0?'wire':'trench';
    works.push({what,x:w[1],y:w[2],a:w[3],len:w[4]});
    if(what==='wire') paintWire(w[1],w[2],w[3],w[4]); else paintTrench(w[1],w[2],w[3],w[4]);
  }

  // ---- the works, the keeps and the bases ----
  walls=(d.walls||[]).map(w=>{
    const o={team:w.t,x:w.x,y:w.y,len:w.l,hp:w.hp,max:w.mx,
      dead:!!w.d,fixed:!!w.f,rubble:!!w.r};
    if(w.a!==null&&w.a!==undefined) o.a=w.a;
    return o;
  });
  mines=(d.mines||[]).map(m=>({team:TEAMS[m[0]],x:m[1],y:m[2],t:0}));
  fires=(d.fires||[]).map(f=>({j:f[0],x:(f[0]%TW)*TG+TG/2,y:((f[0]/TW)|0)*TG+TG/2,
    t:f[1],life:f[2],spread:f[3]}));
  (d.castles||[]).forEach((c,i)=>{ const k=castles[i]; if(!k) return;
    k.team=c.t; k.hp=c.hp; k.dead=!!c.d; k.cd=c.cd; k.burn=c.b; });
  (d.bases||[]).forEach((b,i)=>{ const k=bases[i]; if(!k) return;
    k.team=b.t; k.hp=b.hp; k.cap=b.c; k.dead=!!b.d; });
  plumes=(d.plumes||[]).map(p=>({x:p[0],y:p[1],t:p[2]}));
  if(d.clouds&&d.clouds.length===clouds.length)
    clouds=d.clouds.map(c=>({x:c[0],y:c[1],rx:c[2],ry:c[3],v:c[4],a:c[5]}));

  // ---- the armies ----
  squads=d.squads.map(q=>{
    const t=UNITS[q.ty];
    const sq={id:q.id,team:q.tm,type:q.ty,t,fx:q.x,fy:q.y,facing:q.fa,formation:q.fm,
      order:{kind:'hold'},initial:q.ini,alive:q.al,legion:q.lg,cost:q.co,routed:!!q.ro,
      moraleT:q.mo,disengage:q.dg,crossT:q.ct,crossing:!!q.cr,crossWide:!!q.cw,
      seen:!!q.se,seenT:q.st,soldiers:[],gone:!!q.gn,fw:0,fd:0,flag:q.fl,
      slide:q.sl||0,stuck:q.sk||0};
    if(q.tf>=0) sq.tf=q.tf;                        // the sector the machine gave it
    sq.soldiers=q.men.map((m,i)=>m
      ?{sq,x:m[0],y:m[1],hp:m[2],max:t.hp,alive:true,cd:m[3],tgt:null,wall:null,cas:null,
        seek:m[4],charge:!!m[5],idx:i,ang:m[6],step:m[7],jam:m[8],hull:m[9],turret:m[10],
        rec:m[11],kick:m[12],v:m[16],moved:m[15],sp:m[13],ramp:0,crowd:m[14],trk:m[17]}
      :{sq,x:q.x,y:q.y,hp:0,max:t.hp,alive:false,cd:0,tgt:null,wall:null,cas:null,seek:0,
        charge:false,idx:i,ang:q.fa,step:0,jam:0,hull:q.fa,turret:q.fa,rec:0,kick:0,v:0,
        moved:0,sp:0,ramp:0,crowd:0,trk:0});
    footprint(sq);
    return sq;
  });
  const findCastle=n=>n?castles.find(c=>c.team===TEAMS[n])||null:null;
  const findSol=k=>{
    if(k<0) return null;
    const sq=squads[(k/4096)|0], s=sq&&sq.soldiers[k%4096];
    return s&&s.alive?s:null;
  };
  d.squads.forEach((q,i)=>{
    const sq=squads[i],o=q.o||{k:'hold'};
    const ord={kind:o.k};
    if(o.x!==undefined){ ord.x=o.x; ord.y=o.y; }
    if(o.q!==undefined) ord.sq=squads[o.q]||null;
    if(o.w){
      ord.what=o.w; ord.t=o.t; ord.max=o.mx;
      if(o.ln){ ord.x1=o.ln[0]; ord.y1=o.ln[1]; ord.x2=o.ln[2]; ord.y2=o.ln[3]; }
      if(o.a!==undefined) ord.a=o.a;
    }
    sq.order=ord;
    q.men.forEach((m,j)=>{
      if(!m) return;
      const s=sq.soldiers[j];
      s.tgt=findSol(m[18]);
      s.wall=m[19]>=0?walls[m[19]]||null:null;
      s.cas=findCastle(m[20]);
    });
  });
  soldiers=(d.order||[]).map(k=>{ const sq=squads[(k/4096)|0];
    return sq?sq.soldiers[k%4096]:null; }).filter(Boolean);
  shots=(d.shots||[]).map(a=>{
    const k=a.d>0?clamp(a.t/a.d,0,1):1;
    return {kind:a.k,sx:a.sx,sy:a.sy,x:a.sx+(a.tx-a.sx)*k,y:a.sy+(a.ty-a.sy)*k,
      tx:a.tx,ty:a.ty,t:a.t,dur:a.d,lob:!!a.lb,team:TEAMS[a.tm],dmg:a.dm,splash:a.sp,
      pierce:a.pi,av:a.av,stone:findCastle(a.st),
      arc:a.lb?Math.sin(k*Math.PI)*Math.min(80,dist(a.sx,a.sy,a.tx,a.ty)*.16):0};
  });
  if(d.civs) civs=d.civs.map(c=>({x:c[0],y:c[1],hx:c[2],hy:c[3],home:buildings[c[4]],
    px:c[5],py:c[6],job:c[7]?'farmer':'villager',st:c[8],out:c[9],t:c[10],spd:c[11],
    ang:c[12],ph:c[13],calm:c[14],alive:true})).filter(c=>c.home);
  gunfire=[];

  // ---- the numbers, the clocks and the camera ----
  terrOwn=Uint8Array.from(d.own||[]); terrHold=Float32Array.from(d.hold||[]);
  if(terrOwn.length!==TX*TY) resetTerritory();
  spent={blue:d.spent.blue,red:d.spent.red}; earned={blue:d.earned.blue,red:d.earned.red};
  lvl={blue:d.lvl.blue,red:d.lvl.red}; xp={blue:d.xp.blue,red:d.xp.red};
  stats={blue:d.stats.blue,red:d.stats.red};
  hot={stage:d.hot.stage,team:d.hot.team,t:d.hot.t,round:d.hot.round};
  depTeam=d.depTeam==='red'?'red':'blue'; depTime=d.depTime; troopSize=d.size||1;
  battleTime=d.bt; wave=d.wave|0; lastWave=d.lw; timeUp=!!d.up; lastCall=!!d.lc;
  nextId=d.nid; placeAng=d.ang; remMode=!!d.rem; speed=d.speed;
  const T=d.tm||{};
  aiT=T.ai||0; aiBuy=T.buy||0; pressT=T.press||0; terrT=T.terr||0; baseT=T.base||0;
  occT=T.occ||0; churnT=T.churn||0; mineT=T.mine||0; fireT=T.fire||0; castleT=T.cas||0;
  ambT=T.amb||0; acc=T.acc||0; clock=T.clock||0;
  wind={a:d.wind.a,v:d.wind.v}; sky=d.sky;
  if(typeof T.tod==='number') todStart=T.tod;
  if(START_HOURS.some(h=>h.key===T.hour)) hourKey=T.hour;
  stepClock(0);                      // the hour, the light and the shadows follow
  cam={x:d.cam.x,y:d.cam.y,s:d.cam.s};
  selected=(d.sel||[]).map(i=>squads[i]).filter(Boolean);
  phase=d.phase==='deploy'?'deploy':'battle';
  paused=false;
  {                                  // the view box tick() reads, as the next draw will set it
    const w=cv.width/dpr,h=cv.height/dpr,a=s2w(0,0),b=s2w(w,h);
    vx0=a.x-40; vy0=a.y-40; vx1=b.x+40; vy1=b.y+40;
  }
  srand(d.rng);                      // last, so nothing above disturbs the stream

  // ---- the screen ----
  el('startVeil').style.display='none'; el('endVeil').style.display='none';
  el('menuVeil').style.display='none'; el('surVeil').style.display='none';
  el('passVeil').style.display='none';
  if(phase==='deploy') deployRows(); else battleRows();
  el('done').style.display=(phase==='battle'&&mode==='hot')?'block':'none';
  el('remBtn').classList.toggle('on',remMode);
  el('rotBtn').textContent='Lay '+ANGNAME[Math.max(0,ANGS.indexOf(placeAng))];
  el('bind').classList.remove('on'); el('selBtn').classList.remove('on');
  // the start screen carries the loaded match settings, not the ones the
  // player last picked, in case they go back to it
  buildMapPick(); buildDiffPick(); buildCapPick(); buildHourPick();
  buildPalette(); paintSizes(); setBuy(phase==='deploy',true); paintPoints();
  syncSpeed(); hudAcc=0; lastInfo=''; lastPhase=''; lastClock=''; paintHud(0);
  if(phase==='battle') holdScreenAwake(true);
  resumeAudio();
}

/* ---- the save and load screen ---- */
let saveMode='load';
function slotLine(meta){
  const m=meta||{};
  const head=(m.auto?'Autosave · ':'')+(m.map||'Battle')+' · '+(m.t||'');
  const foot='Level '+(m.lvl||1)+' · '+(m.men||0)+' v '+(m.foe||0)+' · '
    +(m.land===undefined?'':m.land+'% held · ')
    +(DIFF[m.diff]?DIFF[m.diff].name:'')+(m.mode==='hot'?' · two players':'');
  return [head,foot];
}
function buildSaveList(){
  const list=el('saveList'); if(!list) return;
  list.innerHTML='';
  const rows=SAVES.list();
  if(!rows.length){
    const p=document.createElement('div'); p.className='none';
    p.textContent=saveMode==='save'?'No saves yet — use the button below.'
                                   :'No saved battles on this device.';
    list.appendChild(p);
  }
  for(const r of rows){
    const line=slotLine(r.meta);
    const row=document.createElement('div'); row.className='slot';
    const b=document.createElement('button');
    const t1=document.createElement('b'); t1.textContent=line[0];
    const t2=document.createElement('span'); t2.textContent=line[1];
    b.appendChild(t1); b.appendChild(t2);
    b.onclick=()=>{ if(saveMode==='save') doSave(r.id); else doLoad(r.id); };
    const k=document.createElement('button');
    k.className='kill'; k.textContent='×'; k.title='Delete this save';
    k.onclick=()=>{ SAVES.drop(r.id); buildSaveList(); refreshLoadButton(); toast('Save deleted'); };
    row.appendChild(b); row.appendChild(k); list.appendChild(row);
  }
  const left=SAVES.MAX_SLOTS-SAVES.used();
  el('saveNew').style.display=saveMode==='save'?'block':'none';
  el('saveNote').textContent=saveMode==='save'
    ? 'Tap a battle to overwrite it — '+left+' of '+SAVES.MAX_SLOTS+' slots free.'
    : 'Tap a battle to take command of it again.';
}
function openSaves(m){
  saveMode=m==='save'?'save':'load';
  el('saveTitle').innerHTML=(saveMode==='save'?'Save this battle':'Saved battles')
    +'<small>kept on this device</small>';
  SAVES.prune();
  buildSaveList();
  el('saveVeil').style.display='flex';
}
function closeSaves(){
  el('saveVeil').style.display='none';
  if(phase==='start') el('startVeil').style.display='flex';
  else if(paused) el('menuVeil').style.display='flex';
}
function doSave(id){
  if(phase!=='deploy'&&phase!=='battle'){ toast('There is no battle to save'); return; }
  let state;
  try{ state=snapshot(); }
  catch(e){ console.warn('[iron-front] snapshot failed:',e); toast('This battle could not be saved'); return; }
  const res=SAVES.put(id||null,saveMeta(false),state);
  if(!res.ok){
    toast(res.why==='slots'
      ? 'All '+SAVES.MAX_SLOTS+' slots are full — delete one first'
      : 'No room left on this device — delete a save');
    return;
  }
  buildSaveList(); refreshLoadButton(); toast(id?'Save overwritten':'Battle saved');
}
function doLoad(id){
  const rec=SAVES.get(id);
  if(!rec){ toast('That save could not be read'); buildSaveList(); refreshLoadButton(); return; }
  unlockAudio();                                 // still inside the click
  try{ restoreBattle(rec.state); }
  catch(e){
    console.warn('[iron-front] load failed:',e);
    phase='start'; paused=false;
    el('startVeil').style.display='flex';
    el('saveVeil').style.display='none';
    toast('That save could not be loaded');
    return;
  }
  el('saveVeil').style.display='none';
  toast('Battle restored');
}
// One rolling autosave, written when the game goes into the background: the
// case where a phone kills the tab and the battle would otherwise be gone.
function autosave(){
  if(phase!=='deploy'&&phase!=='battle') return false;
  try{ return SAVES.put(SAVES.AUTO_ID,saveMeta(true),snapshot()).ok; }
  catch(e){ return false; }
}
function refreshLoadButton(){
  const b=el('sLoad'); if(!b) return;
  b.style.display=SAVES.list().length?'block':'none';
}
/* ===================== loop ===================== */
let last=performance.now(),acc=0;
let frameErr=0;
function showFault(msg){
  try{
    const d=document.getElementById('fault')||(function(){
      const e=document.createElement('div'); e.id='fault';
      e.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99;padding:8px 10px;'
        +'background:rgba(60,18,14,.94);color:#F3D9C6;font:12px/1.35 system-ui,sans-serif;'
        +'white-space:pre-wrap;max-height:40vh;overflow:auto';
      document.body.appendChild(e); return e; })();
    d.textContent='Something went wrong drawing the battle:\n'+msg
      +'\n\nTell the developer this message. Trying to keep running in fast mode.';
  }catch(e){}
}
window.addEventListener('error',e=>showFault(faultText(e.error,e.message,e.lineno,e.colno)));
window.addEventListener('unhandledrejection',e=>showFault(faultText(e.reason,'unhandled promise')));
// The message alone says nothing useful once the code is bundled onto one
// line. The top of the stack names the function that actually threw.
function faultText(err,msg,line,col){
  let out=(err&&err.message)||msg||'error';
  if(line!==undefined) out+=' @ '+line+':'+(col===undefined?'?':col);
  const st=err&&err.stack;
  if(st){
    const lines=String(st).split('\n').slice(0,4).map(l=>l.trim()).filter(l=>l&&l!==out);
    if(lines.length) out+='\n'+lines.join('\n');
  }
  return out;
}
function frame(now){
  let dt=(now-last)/1000; last=now;
  frameMs+=((dt*1000)-frameMs)*.08;
  if(dt>.25) dt=.25;
  clock+=dt;
  if(!paused&&speed>0){
    acc+=dt*speed;
    let steps=0;
    while(acc>=SIM&&steps<10){ tick(SIM); acc-=SIM; steps++; }
    if(acc>SIM*10) acc=0;
  } else acc=0;
  if(!qualityLock){
    if(frameMs>26&&quality===1) quality=0;
    else if(frameMs<17&&quality===0) quality=1;
  }
  try{
    updateVision(Math.min(dt,.05)); paintHud(dt);
    if(viewMode==='3d'&&gfx3) draw3(); else draw();
  }
  catch(err){
    frameErr++;
    if(viewMode==='3d'){
      // The map is always there and always works. Falling back to it beats
      // showing a red bar over a battle nobody can see.
      console.warn('[iron-front] the 3D battlefield failed, falling back to the map:',err);
      if(frameErr===1) showFault(faultText(err,'the 3D battlefield failed'));
      setView('top',true);
      toast('The 3D battlefield stopped - back to the map');
      // and NOT a return: the frame still has to ask for the next one, or the
      // game freezes on the way down instead of carrying on without it
    }
    else if(frameErr===1){ qualityLock=true; quality=0; showFault(faultText(err)); }
  }
  requestAnimationFrame(frame);
}
let ambT=0;
function stepWeather(dt){
  if(!quality||sky==='clear'){ weather.length=0; return; }
  const w=cv.width/dpr,h=cv.height/dpr;
  const want=sky==='rain'?260:sky==='snow'?200:sky==='dust'?150:120;
  while(weather.length<want) weather.push({x:vr(-60,w+60),y:vr(-60,h+60),
    v:sky==='rain'?vr(760,1150):sky==='snow'?vr(50,110):vr(120,300),
    r:sky==='snow'?vr(1.2,2.6):sky==='dust'?vr(14,40):vr(6,15),
    ph:vr(0,6.28),o:vr(.25,.8)});
  const gx=Math.cos(wind.a)*(sky==='rain'?.28:.7), gy=Math.sin(wind.a)*.3;
  for(const p of weather){
    p.ph+=dt*2;
    p.x+=(gx*p.v+(sky==='snow'?Math.sin(p.ph)*22:0))*dt;
    p.y+=(p.v*(sky==='rain'?1:sky==='snow'?.5:.18)+gy*p.v)*dt;
    if(p.y>h+60){ p.y=-40; p.x=vr(-60,w+60); }
    if(p.x>w+60) p.x=-50; else if(p.x<-60) p.x=w+50;
  }
}
function stepAmbient(dt){
  stepFalling(dt); stepCivs(dt);
  wind.a+=Math.sin(clock*.13)*dt*.05;
  sun+=dt*.012;
  const wx=Math.cos(wind.a)*wind.v,wy=Math.sin(wind.a)*wind.v;
  for(const c of clouds){
    c.x+=(c.v+wx*4)*dt; c.y+=wy*2*dt;
    if(c.x-c.rx>W+120){ c.x=-c.rx-vr(60,400); c.y=vr(-100,H); }
    if(c.y-c.ry>H+140) c.y=-c.ry;
    if(c.y+c.ry<-140) c.y=H+c.ry;
  }
  for(const b of birds){
    b.x+=b.v*dt; b.ph+=dt*b.sp;
    b.y+=Math.sin(clock*.6+b.ph*.1)*8*dt;
    if(b.x<-120) b.x=W+120; else if(b.x>W+120) b.x=-120;
  }
  ambT-=dt; if(ambT>0) return; ambT=.55;
  if(quality){
    for(const b of buildings){                       // hearth smoke from the villages
      if(!b.hearth||Math.random()>.35) continue;
      if(b.x<vx0||b.x>vx1||b.y<vy0||b.y>vy1) continue;
      parts.push({x:b.x+vr(-4,4),y:b.y-b.h*.5,vx:wx*7+vr(-3,3),vy:-vr(7,13),
        t:vr(1.6,3),r:vr(3,6),type:'smoke'});
    }
    for(let i=0;i<soldiers.length;i+=3){             // splashing through the fords
      const s=soldiers[i];
      if(!s.alive||!(terrainAt(s.x,s.y)&FORD)) continue;
      if(Math.random()<.5) parts.push({x:s.x+vr(-4,4),y:s.y+vr(-3,3),
        vx:vr(-16,16),vy:-vr(6,20),t:vr(.3,.6),r:vr(1.3,2.6),type:'splash'});
    }
    if(Math.random()<.6){                  // leaves and dust on the wind
      const x=vr(vx0,vx1),y=vr(vy0,vy1);
      if(terrainAt(x,y)&(WOOD|SCORCH)) parts.push({x,y,vx:wx*26+vr(-8,8),vy:wy*26+vr(-8,8),
        t:vr(1.4,2.6),r:vr(1.4,2.6),type:'leaf'});
    }
  }
}
function tick(dt){
  stepClock(dt);
  stepAmbient(dt); stepWeather(dt);
  if(shakeAmp>0){ shakeAge+=dt; if(shakeAge>1.1){ shakeAmp=0; shakeAge=0; } }
  for(let i=rings.length-1;i>=0;i--){ const r=rings[i]; r.t-=dt; if(r.t<=0) rings.splice(i,1); }
  for(let i=plumes.length-1;i>=0;i--){
    const q=plumes[i]; q.t-=dt;
    if(q.t<=0){ plumes.splice(i,1); continue; }
    if(quality&&Math.random()<dt*4)
      parts.push({x:q.x+vr(-7,7),y:q.y+vr(-5,5),vx:Math.cos(wind.a)*16+vr(-6,6),
        vy:-vr(16,34),t:vr(1.6,3.2),r:vr(4,9),type:'smoke'});
  }
  for(let i=pings.length-1;i>=0;i--){ pings[i].t-=dt; if(pings[i].t<=0) pings.splice(i,1); }
  for(let i=bodies.length-1;i>=0;i--){ bodies[i].t-=dt; if(bodies[i].t<=0) bodies.splice(i,1); }
  for(let i=parts.length-1;i>=0;i--){
    const p=parts[i]; p.t-=dt;
    if(p.t<=0){ parts.splice(i,1); continue; }
    p.x+=p.vx*dt; p.y+=p.vy*dt;
    if(p.type==='smoke'){ p.vy-=8*dt; p.r+=6*dt; p.vx*=.99; }
    else if(p.type==='leaf'){ p.vx+=Math.cos(wind.a)*9*dt; p.vy+=Math.sin(wind.a)*9*dt+Math.sin(clock*4+p.x)*6*dt; }
    else if(p.type==='splash'){ p.vy+=52*dt; p.vx*=.98; }
    else if(p.type==='fireball'){ p.r+=26*dt; p.vx*=.9; p.vy*=.9; }
    else if(p.type==='debris'){ p.vy+=90*dt; p.vx*=.99; }
    else if(p.type==='flash'){ p.vx*=.7; p.vy*=.7; }
    else { p.vx*=.94; p.vy*=.94; }
  }
  if(phase==='deploy'){
    depTime-=dt;
    // units roll out of the base and march to where you placed them while you plan
    buildGrid();
    for(let i=0;i<squads.length;i++) stepSquad(squads[i],dt);
    for(let i=0;i<soldiers.length;i++) stepSoldier(soldiers[i],dt);
    stepChurn(dt); stepOccupancy(dt);
    if(depTime<=0&&el('passVeil').style.display!=='flex') readyDeploy();
    return;
  }
  if(phase!=='battle') return;
  if(mode==='hot'){
    if(el('passVeil').style.display==='flex') return;
    if(hot.stage==='orders'){ hot.t-=dt; if(hot.t<=0) endOrders(); return; }
    hot.t-=dt;
    if(hot.t<=0){ hot.stage='orders'; hot.team='blue'; hot.t=45; hot.round++; selected=[];
      showPass('Blue orders','Round '+hot.round+'. Give your commands, then end orders.'); return; }
  }
  battleTime+=dt;
  wave=waveOf();
  if(wave!==lastWave){
    lastWave=wave;
    if(wave>0&&mode==='ai'){
      toast('Rothal presses harder — wave '+wave);      // pressure rises, but it pays for everything
    }
  }
  if(battleLimit>0&&battleTime>=battleLimit&&!timeUp){ timeUp=true; finish('blue','time'); return; }
  buildGrid();
  for(let i=0;i<squads.length;i++) stepSquad(squads[i],dt);
  for(let i=0;i<soldiers.length;i++) stepSoldier(soldiers[i],dt);
  stepShots(dt); stepFire(dt); stepChurn(dt); stepCastles(dt); stepMines(dt); stepOccupancy(dt); stepTerritory(dt); stepBases(dt);
  if(mode==='ai') stepAI(dt);
  if(soldiers.length>2600){
    let dead=0; for(let i=0;i<soldiers.length;i++) if(!soldiers[i].alive) dead++;
    if(dead>800) soldiers=soldiers.filter(s=>s.alive);
  }
  if(selected.length) selected=selected.filter(s=>!s.gone);
  const bc=ownCastle('blue'),rc=ownCastle('red');
  if(bc&&bc.dead){ finish('red','keep'); return; }
  if(rc&&rc.dead){ finish('blue','keep'); return; }
  let b=false,r=false;
  for(const s of squads){ if(s.gone||s.routed) continue; if(s.team==='blue') b=true; else r=true; }
  if(!b||!r) finish(b?'blue':'red','host');
}

// a cheap fingerprint of the whole battle state
function stateHash(){
  let h=2166136261>>>0;
  const mix=v=>{ h^=v|0; h=Math.imul(h,16777619)>>>0; };
  mix(squads.length);
  for(let i=0;i<squads.length;i++){
    const q=squads[i];
    mix(q.id); mix(q.alive); mix(q.fx*4); mix(q.fy*4); mix(q.routed?1:0);
  }
  for(let i=0;i<soldiers.length;i++){
    const s2=soldiers[i];
    if(!s2.alive) continue;
    mix(s2.x*2); mix(s2.y*2); mix(s2.hp);
  }
  mix(treesDown);                            // felled trees change cover: simulation state
  mix(seed());
  return h>>>0;
}
/* ===================== the 3D battlefield ===================== */
// Everything the second renderer may read, gathered once a frame. References,
// not copies - and read-only by convention: a renderer that wrote to any of
// this would put the two machines in a match on different courses.
function worldView(){
  return {
    terrain, cam, pal:MAPS[mapType].pal, landuse, worldId, treesDown, ruins:ruinsN,
    squads, soldiers, buildings, trees, walls, castles, bases, shots, parts,
    selected, phase, clock, tod, sun, dayLight, night,
    viewTeam:viewTeam(), showsTeam:visible
  };
}
function can3D(){                            // WebGL2, or there is nothing to talk to
  try{
    const c=document.createElement('canvas');
    const gl=c.getContext&&c.getContext('webgl2');
    return !!(gl&&typeof gl.createShader==='function');
  }catch(e){ return false; }
}
async function setView(mode,quiet){
  if(mode==='3d'&&!gfx3){
    if(gfx3Busy) return;
    if(!glCv||!can3D()){
      if(!quiet) toast('This device cannot show the 3D battlefield');
      viewMode='top'; paintViewBtn(); return;      // and the menu says what is true
    }
    gfx3Busy=true;
    try{
      const mod=await import('../render/three/scene.js');
      gfx3=mod.createScene({canvas:glCv,view:worldView()});
    }catch(e){
      console.warn('[iron-front] the 3D battlefield could not start:',e);
      if(!quiet) toast('The 3D battlefield could not start');
      viewMode='top'; paintViewBtn(); gfx3Busy=false; return;
    }
    gfx3Busy=false;
  }
  viewMode=mode; write('view',mode);
  const three=mode==='3d';
  cv.style.display=three?'none':'block';
  if(glCv) glCv.style.display=three?'block':'none';
  if(ovCv) ovCv.style.display=three?'block':'none';
  resize(); paintViewBtn();
  if(!quiet) toast(three?'Three dimensions - drag to look, pinch to close in':'Back to the map');
}
function paintViewBtn(){
  const b=el('mView'); if(b) b.textContent='View: '+(viewMode==='3d'?'3D':'top-down');
}

/* ===================== camera ===================== */
function resize(){
  const st=el('stage'),w=st.clientWidth,h=st.clientHeight;
  const had=cv.width>1;
  // remember what the middle of the screen was looking at
  const oldW=cv.width/dpr,oldH=cv.height/dpr;
  const cxw=had?(oldW/2-cam.x)/cam.s:W/2, cyw=had?(oldH/2-cam.y)/cam.s:H/2;
  const oldS=cam.s;
  dpr=Math.min(window.devicePixelRatio||1,1.5);
  cv.width=Math.max(1,Math.round(w*dpr)); cv.height=Math.max(1,Math.round(h*dpr));
  cv.style.width=w+'px'; cv.style.height=h+'px';
  if(ovCv){ ovCv.width=cv.width; ovCv.height=cv.height;
    ovCv.style.width=w+'px'; ovCv.style.height=h+'px'; }
  if(gfx3) gfx3.resize(w,h,dpr);
  mini.r=clamp(Math.min(w,h)*.13,66,124);
  // The minimap tucks under the status strip; the deck is at the foot of the
  // screen now, and the zoom buttons need to know how tall it is to clear it.
  const topH=(el('top')&&el('top').offsetHeight)||46;
  syncDeck();
  mini.cx=mini.r+12; mini.cy=topH+mini.r+12;
  mini.s=(mini.r*2*.94)/W;
  mini.w=W*mini.s; mini.h=H*mini.s;
  mini.x=mini.cx-mini.w/2; mini.y=mini.cy-mini.h/2;
  if(!had){ fit(); return; }
  // keep the same zoom and the same point centred — opening a panel must not move the camera
  cam.s=clamp(oldS,Math.min(w/W,h/H)*.9,4);
  cam.x=w/2-cxw*cam.s; cam.y=h/2-cyw*cam.s;
}
// How tall the command deck is, published to the stylesheet so the zoom
// buttons can sit clear of it. It changes whenever a row appears - deploy to
// battle, an engineer selected - so it is checked as the HUD is painted rather
// than only when the window resizes.
let deckH=0;
function syncDeck(){
  const d=el('deck'),st=el('stage');
  if(!d||!st||!st.style||!st.style.setProperty) return;
  const h=d.offsetHeight||0;
  if(h===deckH||h<=0) return;
  deckH=h;
  st.style.setProperty('--deck-h',h+'px');
}
function fit(){
  const w=cv.width/dpr,h=cv.height/dpr;
  cam.s=Math.min(w/W,h/H); cam.x=(w-W*cam.s)/2; cam.y=(h-H*cam.s)/2;
}
function zoomAt(f,px,py){
  const w=cv.width/dpr,h=cv.height/dpr;
  px=px===undefined?w/2:px; py=py===undefined?h/2:py;
  const min=Math.min(w/W,h/H)*.9,ns=clamp(cam.s*f,min,4),k=ns/cam.s;
  cam.x=px-(px-cam.x)*k; cam.y=py-(py-cam.y)*k; cam.s=ns;
}
function lookAt(x,y){
  const w=cv.width/dpr,h=cv.height/dpr;
  cam.x=w/2-x*cam.s; cam.y=h/2-y*cam.s;
}
const s2w=(px,py)=>(viewMode==='3d'&&gfx3)
  ? gfx3.screenToWorld(px,py,terrain)
  : {x:(px-cam.x)/cam.s,y:(py-cam.y)/cam.s};
const w2sx=x=>x*cam.s+cam.x, w2sy=y=>y*cam.s+cam.y;
const COL={
  blue:{body:'#5C8FD0',dark:'#27436E',lt:'#BBD7FA',deep:'#16294A',
        uni:'#4A5560',uni2:'#38414A',veh:'#44514C',veh2:'#33403C',skin:'#B9906B'},
  red :{body:'#C4483A',dark:'#712117',lt:'#F3A99C',deep:'#48120C',
        uni:'#5C5442',uni2:'#453F32',veh:'#55503B',veh2:'#403C2C',skin:'#B08663'}};
let fogC=null,fogX=null,fogDot=null;
function makeFogDot(){
  fogDot=document.createElement('canvas'); fogDot.width=fogDot.height=128;
  const g=fogDot.getContext('2d');
  const rg=g.createRadialGradient(64,64,6,64,64,64);
  rg.addColorStop(0,'rgba(255,255,255,1)');
  rg.addColorStop(.62,'rgba(255,255,255,.92)');
  rg.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=rg; g.fillRect(0,0,128,128);
}
// Darkness closes the fog in. Never below a third: a battlefield lights itself
// with burning wreckage, and a unit that cannot see at all cannot fight at all.
const sightOf=sq=>T.sightRange(terrain,sq.fx,sq.fy,sq.t.sight||430)*(.34+.66*dayLight);
function updateVision(dt){
  const vt=viewTeam();
  const eyes=[];
  for(let i=0;i<squads.length;i++){
    const sq=squads[i];
    if(sq.gone||sq.team!==vt) continue;
    eyes.push(sq.fx,sq.fy,sightOf(sq));
  }
  for(const c of castles) if(c.team===vt&&!c.dead) eyes.push(c.x,c.y,980);
  for(const b of bases) if(b.team===vt&&!b.dead) eyes.push(b.x,b.y,660);
  visionEyes=eyes;
  const home=vt==='blue'?-1:1;                 // your own half needs no scouting
  for(let i=0;i<squads.length;i++){
    const sq=squads[i];
    if(sq.team===vt){ sq.seen=true; continue; }
    if((sq.fx-W/2)*home>0){ sq.seen=true; sq.seenT=2.2; continue; }
    // Ground hides men. A squad in a wood or in standing crops has to be let
    // closer before anyone makes it out, and no eye sees through a hill, a
    // building or the trees in between. Four eyes may look; if none of them
    // has a line, the squad is genuinely hidden and nobody else need try.
    const hide=1-.55*T.hideAt(terrain,sq.fx,sq.fy);
    let on=false,looks=0;
    for(let e=0;e<eyes.length;e+=3){
      const dx=sq.fx-eyes[e],dy=sq.fy-eyes[e+1],r=(eyes[e+2]+70)*hide;
      if(dx*dx+dy*dy>=r*r) continue;
      if(looks++>=4) break;
      if(T.sightClear(terrain,eyes[e],eyes[e+1],sq.fx,sq.fy)){ on=true; break; }
    }
    if(on) sq.seenT=2.2; else if(sq.seenT>0) sq.seenT-=dt;
    sq.seen=on||sq.seenT>0;                       // last known position lingers a moment
  }
}
let visionEyes=[];
function visible(team){
  if(phase==='deploy'&&mode==='hot') return team===depTeam;
  return true;
}

/* ===================== rendering ===================== */
let vx0=0,vy0=0,vx1=0,vy1=0;
// Painter's order for the men on screen, reused every frame so a battle does
// not allocate an array a second. Lower on the map is nearer the eye and so is
// drawn later; anything flying is drawn after everything on the ground.
const DRAW=[];
const depthCmp=(a,b)=>(a.sq.t.air?1:0)-(b.sq.t.air?1:0)||a.y-b.y;

// The flat things that still belong over a battlefield with depth: what you
// have ordered, where you may put men, and where the shells are landing.
//
// Drawn on the overlay canvas rather than in the scene, on purpose. An order
// line is not part of the world - it is a thing the commander is told, and it
// should stay legible whatever the ground is doing underneath it.
function drawOverlay(g,w,h){
  const team=viewTeam(),c=COL[team];
  const P=(x,y)=>gfx3.worldToScreen(x,y,terrain);
  g.lineCap='round'; g.lineJoin='round';

  // ---- the ground you may deploy onto, while you are deploying ----
  if(phase==='deploy'){
    const edge=y=>{ const rx=hasWater()?riverXAt(y):W/2,bank=hasWater()?BANK:30;
      return depTeam==='blue'?rx-bank:rx+bank; };
    g.strokeStyle='rgba(201,162,39,.5)'; g.lineWidth=1.8; g.setLineDash([10,8]);
    g.beginPath();
    let on=false;
    for(let y=30;y<=H-30;y+=80){
      const pt=P(edge(y),y);
      if(pt.behind){ on=false; continue; }
      if(on) g.lineTo(pt.x,pt.y); else { g.moveTo(pt.x,pt.y); on=true; }
    }
    g.stroke(); g.setLineDash([]);
  }

  // ---- blast waves, so a shell landing reads as a shell landing ----
  for(let i=0;i<rings.length;i++){
    const r=rings[i],k=1-r.t/r.max,rad=r.r+(r.to-r.r)*k;
    const a=P(r.x,r.y); if(a.behind) continue;
    const b=P(r.x+rad,r.y);
    const sr=Math.hypot(b.x-a.x,b.y-a.y);
    if(sr<1||sr>w) continue;
    g.strokeStyle='rgba(255,214,150,'+(0.5*(1-k)).toFixed(3)+')';
    g.lineWidth=2.2;
    g.beginPath(); g.arc(a.x,a.y,sr,0,6.28); g.stroke();
  }

  // ---- where you just told someone to go ----
  for(const q of pings){
    const a=P(q.x,q.y); if(a.behind) continue;
    const k=1-q.t/.9;
    g.strokeStyle=c.lt; g.globalAlpha=Math.max(0,1-k)*0.8; g.lineWidth=2;
    g.beginPath(); g.arc(a.x,a.y,6+22*k,0,6.28); g.stroke();
    g.globalAlpha=1;
  }

  // ---- what the selected units have been told to do ----
  if(phase==='battle'&&selected.length){
    for(const sq of selected){
      if(sq.gone||sq.alive<=0) continue;
      const legs=[];
      const o=sq.order;
      if(o.kind==='move') legs.push({x:o.x,y:o.y,fight:false});
      else if((o.kind==='attack'||o.kind==='charge')&&o.sq&&!o.sq.gone)
        legs.push({x:o.sq.fx,y:o.sq.fy,fight:true});
      for(const qd of sq.queue||[]){
        if(qd.kind==='move') legs.push({x:qd.x,y:qd.y,fight:false});
        else if(qd.sq&&!qd.sq.gone) legs.push({x:qd.sq.fx,y:qd.sq.fy,fight:true});
      }
      if(!legs.length) continue;
      const from=P(sq.fx,sq.fy);
      if(from.behind) continue;
      g.strokeStyle=c.lt; g.globalAlpha=.5; g.lineWidth=2; g.setLineDash([9,8]);
      g.beginPath(); g.moveTo(from.x,from.y);
      const pts=[];
      for(const l of legs){ const pt=P(l.x,l.y); pts.push(pt); if(!pt.behind) g.lineTo(pt.x,pt.y); }
      g.stroke(); g.setLineDash([]); g.globalAlpha=1;
      pts.forEach((pt,i)=>{
        if(pt.behind) return;
        if(legs[i].fight){                            // a cross where you told them to fight
          g.strokeStyle='rgba(226,120,104,.9)'; g.lineWidth=2.6;
          g.beginPath();
          g.moveTo(pt.x-7,pt.y-7); g.lineTo(pt.x+7,pt.y+7);
          g.moveTo(pt.x+7,pt.y-7); g.lineTo(pt.x-7,pt.y+7);
          g.stroke();
        } else {                                      // a stop on the way
          g.fillStyle=c.lt;
          g.beginPath(); g.arc(pt.x,pt.y,7,0,6.28); g.fill();
          g.fillStyle='rgba(16,18,14,.85)';
          g.beginPath(); g.arc(pt.x,pt.y,3.8,0,6.28); g.fill();
        }
        if(i===pts.length-1&&pts.length>1){
          g.fillStyle=c.lt; g.textAlign='center';
          g.fillText(String(pts.length),pt.x,pt.y-16);
        }
      });
    }
    const rp=rally[team];
    if(rp){                                           // the rally flag
      const a=P(rp.x,rp.y);
      if(!a.behind){
        g.strokeStyle=c.lt; g.lineWidth=2.4;
        g.beginPath(); g.moveTo(a.x,a.y); g.lineTo(a.x,a.y-26); g.stroke();
        g.fillStyle=c.lt;
        g.beginPath();
        g.moveTo(a.x,a.y-26); g.lineTo(a.x+16,a.y-20); g.lineTo(a.x,a.y-14);
        g.closePath(); g.fill();
      }
    }
  }
  g.lineCap='butt'; g.lineJoin='miter';
}

function draw3(){
  const w=cv.width/dpr,h=cv.height/dpr;
  // What the camera is looking at, for the ambient scatter and the sound mix.
  const fx=(w/2-cam.x)/cam.s,fy=(h/2-cam.y)/cam.s,rad=h/Math.max(.0001,cam.s);
  vx0=fx-rad; vx1=fx+rad; vy0=fy-rad; vy1=fy+rad;
  listen(fx,fy,rad,rad);
  gfx3.frame(worldView());
  if(ovx){
    ovx.setTransform(dpr,0,0,dpr,0,0);
    ovx.clearRect(0,0,w,h);
    ovx.font='600 11px "Barlow Condensed",system-ui,sans-serif';
    drawOverlay(ovx,w,h);
    // Who is who. A three dimensional field is harder to read than a map, so
    // every formation still carries its strength above it.
    ovx.font='600 11px "Barlow Condensed",system-ui,sans-serif';
    ovx.textAlign='center'; ovx.textBaseline='middle';
    for(let i=0;i<squads.length;i++){
      const sq=squads[i];
      if(sq.gone||sq.routed||!visible(sq.team)||!sq.seen) continue;
      const p=gfx3.worldToScreen(sq.fx,sq.fy,terrain);
      if(p.behind||p.x<-60||p.y<-60||p.x>w+60||p.y>h+60) continue;
      const txt=sq.alive+(sq.alive===sq.initial?'':'/'+sq.initial);
      const tw=ovx.measureText(txt).width+16;
      const y=p.y-34;
      ovx.fillStyle='rgba(12,12,9,.72)';
      ovx.fillRect(p.x-tw/2,y-8,tw,16);
      ovx.fillStyle=sq.team==='blue'?COL.blue.lt:COL.red.lt;
      ovx.fillRect(p.x-tw/2,y-8,3,16);
      ovx.fillStyle='#E6D8B8';
      ovx.fillText(txt,p.x+1.5,y);
    }
    if(box.on){                              // dragging a selection
      const x0=Math.min(box.x0,box.x1),y0=Math.min(box.y0,box.y1);
      ovx.strokeStyle='rgba(201,162,39,.9)'; ovx.lineWidth=1.5;
      ovx.fillStyle='rgba(201,162,39,.12)';
      ovx.fillRect(x0,y0,Math.abs(box.x1-box.x0),Math.abs(box.y1-box.y0));
      ovx.strokeRect(x0,y0,Math.abs(box.x1-box.x0),Math.abs(box.y1-box.y0));
    }
    drawMini(ovx);
  }
}
function draw(){
  const w=cv.width/dpr,h=cv.height/dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle='#15140F'; ctx.fillRect(0,0,w,h);
  const a=s2w(0,0),b=s2w(w,h);
  vx0=a.x-40; vy0=a.y-40; vx1=b.x+40; vy1=b.y+40;
  listen((vx0+vx1)/2,(vy0+vy1)/2,(vx1-vx0)/2,(vy1-vy0)/2);   // sound is mixed around the view
  const sk=prof.shake===false?0:shakeNow();       // ~5Hz thump, not a 9Hz buzz
  const shx=sk?Math.sin(shakeAge*32)*sk:0, shy=sk?Math.cos(shakeAge*27)*sk*.72:0;
  ctx.setTransform(cam.s*dpr,0,0,cam.s*dpr,(cam.x+shx)*dpr,(cam.y+shy)*dpr);
  ctx.drawImage(ground,0,0,W,H);
  ctx.drawImage(decal,0,0,W,H);
  if(quality){
    for(const c of clouds){
      if(c.x+c.rx<vx0||c.x-c.rx>vx1||c.y+c.ry<vy0||c.y-c.ry>vy1) continue;
      ctx.fillStyle='rgba(14,16,12,'+c.a+')';
      ctx.beginPath(); ctx.ellipse(c.x,c.y,c.rx,c.ry,0,0,6.28); ctx.fill();
      ctx.fillStyle='rgba(14,16,12,'+(c.a*.6)+')';
      ctx.beginPath(); ctx.ellipse(c.x+c.rx*.5,c.y+c.ry*.3,c.rx*.6,c.ry*.55,0,0,6.28); ctx.fill();
    }
  }

  if(quality){                                     // river glints
    ctx.strokeStyle='rgba(214,238,244,.16)'; ctx.lineWidth=1.6;
    const y0=Math.max(0,vy0),y1=Math.min(H,vy1);
    for(let y=y0-(y0%30);y<y1;y+=30){
      const ph=Math.sin(clock*1.4+y*.05);
      const rx=riverXAt(y)+ph*12;
      ctx.beginPath(); ctx.moveTo(rx-9,y); ctx.quadraticCurveTo(rx,y-2.4,rx+9,y); ctx.stroke();
    }
  }
  {
    // Who holds which block. This used to outline all hundred and sixty of them
    // every frame, which laid a perfect lattice over the battlefield and made
    // the whole thing read as a board rather than as ground. Only the FRONTIER
    // is drawn now — the edges where the holding actually changes hands — so
    // what you see is a front line, and the interior is a wash with no border
    // to give the grid away.
    const bw=W/TX,bh=H/TY;
    for(let gy=0;gy<TY;gy++) for(let gx=0;gx<TX;gx++){
      const i=gy*TX+gx,o=terrOwn[i];
      if(!o) continue;                            // nobody's: leave the ground alone
      const x0=gx*bw,y0=gy*bh;
      if(x0+bw<vx0||x0>vx1||y0+bh<vy0||y0>vy1) continue;
      const grip=Math.abs(terrHold[i]);
      ctx.fillStyle=(o===1?'rgba(76,127,191,':'rgba(190,59,46,')+(.035+grip*.05)+')';
      ctx.fillRect(x0,y0,bw,bh);
    }
    ctx.lineWidth=2.2/cam.s; ctx.lineCap='round';
    for(let gy=0;gy<TY;gy++) for(let gx=0;gx<TX;gx++){
      const i=gy*TX+gx,o=terrOwn[i];
      if(!o) continue;
      const x0=gx*bw,y0=gy*bh;
      if(x0+bw<vx0||x0>vx1||y0+bh<vy0||y0>vy1) continue;
      ctx.strokeStyle=o===1?'rgba(120,168,232,.30)':'rgba(226,120,104,.30)';
      // only the sides facing someone else, or the open map edge
      if(gx===0||terrOwn[i-1]!==o){ ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x0,y0+bh); ctx.stroke(); }
      if(gx===TX-1||terrOwn[i+1]!==o){ ctx.beginPath(); ctx.moveTo(x0+bw,y0); ctx.lineTo(x0+bw,y0+bh); ctx.stroke(); }
      if(gy===0||terrOwn[i-TX]!==o){ ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x0+bw,y0); ctx.stroke(); }
      if(gy===TY-1||terrOwn[i+TX]!==o){ ctx.beginPath(); ctx.moveTo(x0,y0+bh); ctx.lineTo(x0+bw,y0+bh); ctx.stroke(); }
    }
    ctx.lineCap='butt';
  }
  ctx.setLineDash([16,14]); ctx.lineWidth=2.4/cam.s;
  ctx.strokeStyle='rgba(201,162,39,.14)';
  for(const dy of div){ ctx.beginPath(); ctx.moveTo(0,dy); ctx.lineTo(W,dy); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.strokeStyle='rgba(230,212,152,.3)'; ctx.lineWidth=4/cam.s;
  for(const g of GAPS){ ctx.beginPath(); ctx.moveTo(g[1]-140,g[0]); ctx.lineTo(g[1]+140,g[0]); ctx.stroke(); }
  if(phase==='deploy'){
    const mine=depTeam==='blue';
    const edge=y=>(hasWater()?riverXAt(y):W/2)+(mine?-(hasWater()?BANK:30):(hasWater()?BANK:30));
    ctx.beginPath();
    ctx.moveTo(mine?40:W-40,40);
    for(let y=40;y<=H-40;y+=25) ctx.lineTo(edge(y),y);
    ctx.lineTo(mine?40:W-40,H-40);
    ctx.closePath();
    ctx.fillStyle=mine?'rgba(76,127,191,.09)':'rgba(190,59,46,.09)'; ctx.fill();
    ctx.strokeStyle='rgba(201,162,39,.45)'; ctx.lineWidth=2.8/cam.s; ctx.setLineDash([13,13]);
    ctx.beginPath();
    for(let y=40;y<=H-40;y+=25) ctx.lineTo(edge(y),y);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='rgba(230,216,184,.16)'; ctx.font='600 34px Cinzel, serif'; ctx.textAlign='center';
    ctx.fillText('YOUR SIDE',mine?W*.2:W*.8,H-70); ctx.textAlign='left';
  }
  {                                              // national names across each country
    ctx.save();
    ctx.font='700 '+Math.round(120)+'px Cinzel, serif'; ctx.textAlign='center';
    ctx.fillStyle='rgba(155,196,240,.055)'; ctx.fillText(NATION.blue.name,W*.17,H*.52);
    ctx.fillStyle='rgba(243,169,156,.055)'; ctx.fillText(NATION.red.name,W*.83,H*.52);
    ctx.restore();
  }
  {                                              // the front line, block by block
    const bw=W/TX,bh=H/TY;
    ctx.strokeStyle='rgba(201,162,39,.55)'; ctx.lineWidth=5/cam.s; ctx.setLineDash([26,18]);
    ctx.beginPath();
    let started=false;
    for(let gy=0;gy<TY;gy++){
      let edge=null;
      for(let gx=0;gx<TX-1;gx++){
        const a=terrOwn[gy*TX+gx],b2=terrOwn[gy*TX+gx+1];
        if(a===1&&b2===2){ edge=(gx+1)*bw; break; }
      }
      if(edge===null) continue;
      const y=gy*bh+bh/2;
      if(!started){ ctx.moveTo(edge,y); started=true; } else ctx.lineTo(edge,y);
    }
    if(started) ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.font='600 26px Cinzel, serif'; ctx.textAlign='center'; ctx.fillStyle='rgba(230,216,184,.11)';
  for(let i=0;i<3;i++) ctx.fillText(LANE_NAME[i].toUpperCase(),W*.2,laneY[i]-8);
  ctx.font='600 15px Cinzel, serif'; ctx.fillStyle='rgba(236,224,180,.28)';
  if(hasWater()) for(const cr of CROSS) ctx.fillText(cr.type==='bridge'?'ROAD BRIDGE':'FORD',
    riverXAt(cr.y),cr.y-(cr.type==='bridge'?104:66));
  ctx.textAlign='left';

  for(const c of castles) drawCastle(c);
  for(let i=0;i<walls.length;i++){
    const wl=walls[i];
    if(wl.dead||!visible(wl.team)||wl.x<vx0||wl.x>vx1||wl.y<vy0-60||wl.y>vy1+60) continue;
    const frac=wl.hp/wl.max,c=COL[wl.team]||{body:'#6E6A5E',lt:'#8C8778'};
    ctx.save();
    ctx.translate(wl.x,wl.y); ctx.rotate((wl.a===undefined?Math.PI/2:wl.a)-Math.PI/2);
    ctx.translate(-wl.x,-wl.y);
    ctx.fillStyle='rgba(18,15,9,.55)'; ctx.fillRect(wl.x-7,wl.y-wl.len/2,15,wl.len);
    for(let y=wl.y-wl.len/2;y<wl.y+wl.len/2;y+=8){
      const alt=((y/8)|0)%2;
      if(wl.rubble){                                   // a heap of broken masonry
        ctx.fillStyle=alt?'#6E6A5E':'#5C584D';
        ctx.beginPath();
        ctx.moveTo(wl.x-6+(alt?1:0),y+7); ctx.lineTo(wl.x-1,y);
        ctx.lineTo(wl.x+6-(alt?1:0),y+7); ctx.fill();
      } else {                                         // sandbags
        ctx.fillStyle=frac>.5?'#8A7C58':frac>.25?'#6F6446':'#514933';
        ctx.beginPath(); ctx.roundRect(wl.x-6+(alt?1.2:0),y,12,7,2.4); ctx.fill();
        ctx.fillStyle='rgba(0,0,0,.22)'; ctx.fillRect(wl.x-6+(alt?1.2:0),y+5,12,2);
      }
    }
    if(!wl.rubble){ ctx.fillStyle=c.body; ctx.fillRect(wl.x-7,wl.y-wl.len/2-5,15,3); }
    ctx.restore();
  }
  for(let i=0;i<squads.length;i++){
    const sq=squads[i];
    if(sq.gone||!visible(sq.team)||!sq.seen) continue;
    if(sq.fx<vx0-140||sq.fx>vx1+140||sq.fy<vy0-140||sq.fy>vy1+140) continue;
    const sel=selected.indexOf(sq)>=0;
    ctx.save(); ctx.translate(sq.fx,sq.fy); ctx.rotate(sq.facing);
    const d=sq.fd+16,wd=sq.fw+16;
    ctx.fillStyle=sq.routed?'rgba(120,114,92,.12)':(sel?'rgba(201,162,39,.20)':
      sq.team==='blue'?'rgba(92,143,208,.14)':'rgba(196,72,58,.14)');
    ctx.fillRect(-d,-wd/2,d+10,wd);
    ctx.strokeStyle=sel?'rgba(201,162,39,.9)':(sq.team==='blue'?'rgba(155,196,240,.34)':'rgba(243,169,156,.34)');
    ctx.lineWidth=2/cam.s;
    ctx.beginPath(); ctx.moveTo(10,-wd/2); ctx.lineTo(10,wd/2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14,-7); ctx.lineTo(25,0); ctx.lineTo(14,7); ctx.stroke();
    ctx.restore();
  }
  ctx.lineWidth=2/cam.s; ctx.setLineDash([7,7]);
  for(const sq of selected){
    if(sq.gone) continue; const o=sq.order; let tx,ty;
    if(o.kind==='move'||o.kind==='build'){tx=o.x;ty=o.y;}
    else if(o.kind==='castle'){ const c=enemyCastle(sq.team); if(c){tx=c.x;ty=c.y;} }
    else if((o.kind==='attack'||o.kind==='charge')&&o.sq&&!o.sq.gone){tx=o.sq.fx;ty=o.sq.fy;}
    if(tx!==undefined){
      ctx.strokeStyle=o.kind==='move'?'rgba(159,196,240,.8)':'rgba(240,153,140,.9)';
      ctx.beginPath(); ctx.moveTo(sq.fx,sq.fy); ctx.lineTo(tx,ty); ctx.stroke();
      ctx.beginPath(); ctx.arc(tx,ty,7,0,6.28); ctx.stroke();
    }
  }
  if(drawing){                                     // the line you are drawing
    const len=Math.hypot(drawing.x1-drawing.x0,drawing.y1-drawing.y0);
    const ok=len>=60&&lineCost(building,len)<=coinsLeft(viewTeam());
    ctx.strokeStyle=ok?'rgba(201,162,39,.95)':'rgba(226,110,90,.9)';
    ctx.lineWidth=(building==='trench'?20:building==='wall'?14:9)/1;
    ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(drawing.x0,drawing.y0); ctx.lineTo(drawing.x1,drawing.y1); ctx.stroke();
    ctx.lineWidth=2/cam.s; ctx.strokeStyle='rgba(20,18,12,.8)';
    ctx.beginPath(); ctx.moveTo(drawing.x0,drawing.y0); ctx.lineTo(drawing.x1,drawing.y1); ctx.stroke();
  }
  for(let i=0;i<squads.length;i++){                 // work under construction
    const sq=squads[i];
    if(sq.gone||sq.order.kind!=='build'||!visible(sq.team)||!sq.seen) continue;
    const o=sq.order,done=1-clamp(o.t/o.max,0,1);
    ctx.strokeStyle=COL[sq.team].lt; ctx.lineWidth=3/cam.s; ctx.setLineDash([12,10]);
    ctx.beginPath(); ctx.moveTo(o.x1,o.y1); ctx.lineTo(o.x2,o.y2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle='rgba(201,162,39,.9)'; ctx.lineWidth=6/cam.s;
    ctx.beginPath(); ctx.moveTo(o.x1,o.y1);
    ctx.lineTo(o.x1+(o.x2-o.x1)*done,o.y1+(o.y2-o.y1)*done); ctx.stroke();
  }
  ctx.setLineDash([]);
  for(const p of pings){
    ctx.strokeStyle='rgba(201,162,39,'+(p.t>1?1:p.t)+')'; ctx.lineWidth=3/cam.s;
    ctx.beginPath(); ctx.arc(p.x,p.y,(1-p.t/.9)*30+5,0,6.28); ctx.stroke();
  }

  for(let i=0;i<bodies.length;i++){                 // men and wrecks going down
    const b=bodies[i];
    if(b.x<vx0||b.x>vx1||b.y<vy0||b.y>vy1) continue;
    const k=1-b.t/b.max, c=COL[b.team];
    ctx.save(); ctx.translate(b.x,b.y); ctx.rotate(b.a+b.spin*k);
    ctx.globalAlpha=clamp(b.t/b.max*1.6,0,1);
    if(b.veh){
      ctx.fillStyle='#26241E'; ctx.beginPath(); ctx.roundRect(-11,-6,22,12,2); ctx.fill();
      ctx.fillStyle='rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(0,0,9,5,0,0,6.28); ctx.fill();
      if(quality&&R()<.3) burst(b.x,b.y,1,'smoke');
    } else {
      ctx.scale(1,1-k*.35);                          // collapsing
      ctx.fillStyle=c.uni2; ctx.beginPath(); ctx.roundRect(-3.4,-2.2,7,4.4,1.8); ctx.fill();
      ctx.fillStyle=c.uni; ctx.beginPath(); ctx.arc(2,0,1.8,0,6.28); ctx.fill();
    }
    ctx.globalAlpha=1; ctx.restore();
  }
  const detail=quality===1&&cam.s>=.5;
  const close=quality===1&&cam.s>=.85;              // full detail only when you can see it
  // Gather what is on screen and paint it back to front. Drawing in array
  // order let a man standing in front be covered by one standing behind him,
  // which is what reads as bodies sliding through each other. Aircraft last:
  // they are overhead, so nothing on the ground may cover them.
  DRAW.length=0;
  for(let i=0;i<soldiers.length;i++){
    const s=soldiers[i];
    if(!s.alive||s.x<vx0||s.x>vx1||s.y<vy0||s.y>vy1) continue;
    const sq=s.sq; if(!visible(sq.team)||!sq.seen) continue;
    DRAW.push(s);
  }
  // Zoomed out, a man is a third of a pixel across and the whole army is
  // invisible. Below the detail threshold the men are not drawn at all: each
  // squad gets one marker instead, sized in SCREEN pixels so it stays legible
  // however far out the camera is, carrying the same icon as its card in the
  // deck. Zoom in and the marker gives way to the models.
  if(!detail){
    for(let i=0;i<squads.length;i++){
      const sq=squads[i];
      if(sq.gone||sq.alive<=0) continue;
      if(sq.fx<vx0||sq.fx>vx1||sq.fy<vy0||sq.fy>vy1) continue;
      if(!visible(sq.team)||!sq.seen) continue;
      drawSquadMarker(sq);
    }
  }
  DRAW.sort(depthCmp);
  for(let i=0;detail&&i<DRAW.length;i++){
    const s=DRAW[i];
    const sq=s.sq;
    const c=COL[sq.team],t=sq.t;
    if(t.kind==='siege'){ drawEngine(s,c); continue; }
    if(t.air) drawHeli(s,c,t);
    else if(t.vehicle) drawVehicle(s,c,t);
    else drawTrooper(s,c,t);
  }

  // Everything below is drawn looking straight down, with +x forward and +y the
  // unit's right. Two tiers: `detail` gives the real silhouette, `close` adds
  // the parts you can only make out zoomed in, so a wide view costs no more
  // than it did before.
  // One squad, one marker, drawn at a fixed size on screen. The icon is the same
  // one the deck card uses, rendered once into an offscreen canvas and blitted
  // after that - drawing thirteen unit silhouettes by path every frame for every
  // squad would cost more than the whole rest of the field.
  function drawSquadMarker(sq){
    const c=COL[sq.team], t=sq.t;
    const S=32/cam.s;                                  // ~32 screen px, whatever the zoom
    const hw=S*.58, hh=S*.47;
    const x=sq.fx, y=sq.fy;
    const frac=clamp(sq.alive/Math.max(1,sq.initial),0,1);
    const sel=selected.indexOf(sq)>=0;

    // the ground the formation actually covers, so a big squad reads as big
    ctx.fillStyle=sq.team==='blue'?'rgba(76,127,191,.13)':'rgba(190,59,46,.13)';
    ctx.beginPath();
    ctx.ellipse(x,y,Math.max(sq.fw,S)*.5,Math.max(sq.fd,S*.7)*.5,sq.facing,0,6.28);
    ctx.fill();

    ctx.save();
    ctx.translate(x,y);
    // Which way it faces: a small chevron clear of the plate, drawn first so it
    // can never sit on top of the silhouette.
    const pr=Math.max(hw,hh);
    ctx.fillStyle=c.body;
    ctx.beginPath();
    ctx.moveTo(Math.cos(sq.facing)*pr*1.5,Math.sin(sq.facing)*pr*1.5);
    ctx.lineTo(Math.cos(sq.facing+.42)*pr*1.12,Math.sin(sq.facing+.42)*pr*1.12);
    ctx.lineTo(Math.cos(sq.facing-.42)*pr*1.12,Math.sin(sq.facing-.42)*pr*1.12);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,.45)';                   // plate
    ctx.beginPath(); ctx.roundRect(-hw+S*.03,-hh+S*.05,hw*2,hh*2,S*.12); ctx.fill();
    ctx.fillStyle=sq.team==='blue'?'#22354D':'#4A211C';
    ctx.beginPath(); ctx.roundRect(-hw,-hh,hw*2,hh*2,S*.12); ctx.fill();
    ctx.strokeStyle=sel?'#C9A227':c.body;
    ctx.lineWidth=S*(sel?.075:.045);
    ctx.beginPath(); ctx.roundRect(-hw,-hh,hw*2,hh*2,S*.12); ctx.stroke();

    // The silhouette sits above the strength bar and inside the plate. Sized off
    // S rather than the plate, so it stays the same on screen at any zoom.
    const isz=S*.68;
    const spr=iconSprite(sq.type,'#F0E6CC');           // parchment reads on the dark plate
    if(spr) ctx.drawImage(spr,-isz*.5,-hh*.92+isz*.06,isz,isz);

    ctx.fillStyle='rgba(0,0,0,.6)';                    // strength, as a bar
    ctx.fillRect(-hw*.8,hh*.42,hw*1.6,S*.11);
    ctx.fillStyle=frac>.6?c.body:frac>.3?'#D9A63A':'#C4483A';
    ctx.fillRect(-hw*.8,hh*.42,hw*1.6*frac,S*.11);

    ctx.restore();
  }

  function drawTrooper(s,c,t){
    const firing=s.cd<.14&&s.tgt;
    const kick=Math.max(0,s.kick||0);
    const walk=Math.sin(s.step), walk2=Math.cos(s.step);
    const breathe=Math.sin(clock*2.1+s.v*3)*.16;             // never quite still
    const scale=1+s.v*.06;
    ctx.save();
    ctx.translate(s.x,s.y+walk*.4); ctx.rotate(s.ang+s.v*.05);
    ctx.scale(scale,scale);
    ctx.translate(-kick*1.2,0);                              // flinch back on firing
    const sx=Math.cos(sun)*3.2,sy=Math.sin(sun)*3.2;         // shadow follows the sun
    ctx.fillStyle='rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(sx*.5+.5,sy*.4+1.7,3.9,2.1,0,0,6.28); ctx.fill();
    ctx.lineCap='round';
    const prone=t.cd<.2||t.range>500;                        // gunners and snipers lie down
    if(prone){
      const sniper=t.range>500;
      ctx.strokeStyle=c.uni2; ctx.lineWidth=1.45;            // legs splayed back for a firm base
      ctx.beginPath();
      ctx.moveTo(-2.1,-.55); ctx.lineTo(-5.9,-2.5);
      ctx.moveTo(-2.1, .55); ctx.lineTo(-5.9, 2.5);
      ctx.stroke();
      ctx.fillStyle=c.uni;                                   // body, long and low
      ctx.beginPath(); ctx.roundRect(-3.4,-1.7,6.3,3.4,1.5); ctx.fill();
      ctx.fillStyle=c.uni2;                                  // pack across his back
      ctx.beginPath(); ctx.roundRect(-2.7,-1.25,2.5,2.5,.85); ctx.fill();
      ctx.fillStyle=c.body; ctx.fillRect(-1.4,-1.7,1.2,1.1);
      ctx.fillStyle=c.uni2;                                  // helmet, forward
      ctx.beginPath(); ctx.ellipse(3.05,0,1.5,1.35,0,0,6.28); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.14)';
      ctx.beginPath(); ctx.ellipse(3.3,-.34,.55,.4,0,0,6.28); ctx.fill();
      const reach=sniper?10.4:8.8;
      ctx.strokeStyle='#2B2E26'; ctx.lineWidth=.8;           // receiver and barrel
      ctx.beginPath(); ctx.moveTo(.2,.5); ctx.lineTo(reach,-.45); ctx.stroke();
      ctx.strokeStyle='#3A3E33'; ctx.lineWidth=.65;          // bipod
      const bx=reach-2;
      ctx.beginPath();
      ctx.moveTo(bx,-.25); ctx.lineTo(bx+.8,1.7);
      ctx.moveTo(bx,-.25); ctx.lineTo(bx+.8,-2.1);
      ctx.stroke();
      ctx.fillStyle='#2E3129';
      if(sniper){ ctx.beginPath(); ctx.roundRect(4,-1.35,2.1,.85,.4); ctx.fill(); }    // scope
      else { ctx.beginPath(); ctx.roundRect(1.1,.85,1.8,1.3,.4); ctx.fill(); }         // ammo box
      if(close){ ctx.fillStyle=c.skin;                       // hands on the grip and the fore-end
        ctx.beginPath(); ctx.arc(1.6,.95,.5,0,6.28); ctx.fill();
        ctx.beginPath(); ctx.arc(4.4,.35,.5,0,6.28); ctx.fill(); }
    } else {
      const swing=walk*1.35;
      ctx.fillStyle='#2A2C24';                               // boots showing behind as he walks
      ctx.beginPath(); ctx.roundRect(-4.6+swing,-1.85,2.1,1.25,.55); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-4.6-swing,  .6,2.1,1.25,.55); ctx.fill();
      ctx.fillStyle=c.uni2;                                  // pack
      ctx.beginPath(); ctx.roundRect(-3.9,-1.7,2.6,3.4,1); ctx.fill();
      const shX=1.9, shW=2.35+breathe, hpX=-2.4, hpW=1.6;    // shoulders forward, hips back
      ctx.fillStyle=c.uni;
      ctx.beginPath();
      ctx.moveTo(shX,-shW);
      ctx.quadraticCurveTo(shX+1.5,0,shX,shW);
      ctx.lineTo(hpX,hpW);
      ctx.quadraticCurveTo(hpX-1.1,0,hpX,-hpW);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle=c.uni2; ctx.fillRect(-.7,-shW*.92,1.5,shW*1.84);   // webbing
      ctx.fillStyle=c.body; ctx.fillRect(.9,-shW*.98,1.1,1.3);         // shoulder flash
      if(close){
        ctx.strokeStyle=c.uni; ctx.lineWidth=1.15;           // arms working the weapon
        ctx.beginPath();
        ctx.moveTo(1.3,-1.7); ctx.lineTo(3.3-kick*.5,.55);   // support arm across the body
        ctx.moveTo(1.2, 1.9); ctx.lineTo(1.0-kick*.5,1.5);   // firing arm into the shoulder
        ctx.stroke();
      }
      const bl=(t.shell?6.2:7.1)-kick*1.3;                   // rifle: stock in the right shoulder
      ctx.strokeStyle='#2B2E26'; ctx.lineWidth=.78;
      ctx.beginPath(); ctx.moveTo(-.5,1.65); ctx.lineTo(bl,.45); ctx.stroke();
      if(close){
        ctx.strokeStyle='#33362C'; ctx.lineWidth=.6;         // magazine
        ctx.beginPath(); ctx.moveTo(2.1,1.05); ctx.lineTo(2.5,2.2); ctx.stroke();
        ctx.strokeStyle='rgba(28,30,24,.5)'; ctx.lineWidth=.6;   // sling
        ctx.beginPath(); ctx.moveTo(.2,1.65); ctx.lineTo(-1.5,-.4); ctx.stroke();
      }
      if(t.shell){                                           // launcher tube over the shoulder
        ctx.strokeStyle=c.veh2; ctx.lineWidth=1.6;
        ctx.beginPath(); ctx.moveTo(-2,-2.1); ctx.lineTo(5.6,-3.2); ctx.stroke();
      }
      ctx.fillStyle=c.skin;                                  // hands
      ctx.beginPath(); ctx.arc(3.1-kick*.5,.65+walk2*.18,.56,0,6.28); ctx.fill();
      ctx.beginPath(); ctx.arc(.8-kick*.5,1.4,.52,0,6.28); ctx.fill();
      ctx.fillStyle=c.uni2;                                  // helmet: longer front to back
      ctx.beginPath(); ctx.ellipse(2.35,walk2*.14,1.6,1.45,0,0,6.28); ctx.fill();
      ctx.fillStyle='rgba(0,0,0,.2)';                        // the rim, in its own shadow
      ctx.beginPath(); ctx.ellipse(1.95,walk2*.14,1.1,1.32,0,0,6.28); ctx.fill();
      ctx.fillStyle=c.uni2;
      ctx.beginPath(); ctx.ellipse(2.5,walk2*.14,1.22,1.08,0,0,6.28); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.16)';                 // crown highlight
      ctx.beginPath(); ctx.ellipse(2.7,-.42,.6,.42,0,0,6.28); ctx.fill();
    }
    if(firing){
      ctx.fillStyle='rgba(255,238,158,.9)';
      const fx=prone?(t.range>500?13:11):9.4;
      ctx.beginPath(); ctx.arc(fx,prone?-.6:.4,1.9,0,6.28); ctx.fill();
      ctx.fillStyle='rgba(255,200,90,.5)';
      ctx.beginPath(); ctx.arc(fx+1.4,prone?-.7:.3,3,0,6.28); ctx.fill();
    }
    ctx.restore();
  }

  function drawHeli(s,c,t){
    const alt=26;                                     // it flies, so its shadow is thrown wide
    ctx.fillStyle='rgba(0,0,0,.3)';
    ctx.beginPath();
    ctx.ellipse(s.x+Math.cos(sun)*alt,s.y+Math.sin(sun)*alt,13,7,s.hull,0,6.28); ctx.fill();
    ctx.save(); ctx.translate(s.x,s.y-6); ctx.rotate(s.hull);
    ctx.lineCap='butt';
    ctx.strokeStyle='#2A2D25'; ctx.lineWidth=.9;      // skids, under everything else
    ctx.beginPath();
    ctx.moveTo(4.6,-4.8); ctx.lineTo(-4.6,-4.8);
    ctx.moveTo(4.6, 4.8); ctx.lineTo(-4.6, 4.8);
    ctx.stroke();
    ctx.fillStyle=c.veh2;                             // tail boom, tapering to the fin
    ctx.beginPath();
    ctx.moveTo(-3,-2.6); ctx.lineTo(-18.4,-1.05); ctx.lineTo(-18.4,1.05); ctx.lineTo(-3,2.6);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-16.6,-3.7,2.4,7.4,.8); ctx.fill();      // stabiliser
    ctx.beginPath();                                                        // fin
    ctx.moveTo(-18.1,-1.2); ctx.lineTo(-21.4,-3.6); ctx.lineTo(-20.4,1.2); ctx.lineTo(-18.1,1.2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle=c.veh;                              // fuselage: narrow, nose drawn to a point
    ctx.beginPath();
    ctx.moveTo(11.4,0);
    ctx.quadraticCurveTo(9.4,-3.1,4.4,-3.5);
    ctx.lineTo(-3.4,-3.1); ctx.quadraticCurveTo(-6,-2.2,-6,0);
    ctx.quadraticCurveTo(-6,2.2,-3.4,3.1);
    ctx.lineTo(4.4,3.5); ctx.quadraticCurveTo(9.4,3.1,11.4,0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle=c.veh2;                             // stub wings
    ctx.beginPath(); ctx.roundRect(-1.4,-8.8,4.4,17.6,1); ctx.fill();
    ctx.fillStyle='#3A3D33';                          // four pylons, two a side
    for(const wy of [-7.8,-5.5,5.5,7.8]){
      ctx.beginPath(); ctx.roundRect(-1.8,wy-.95,5.6,1.9,.75); ctx.fill(); }
    if(close){ ctx.fillStyle='rgba(0,0,0,.4)';        // the mouths of the rocket pods
      for(const wy of [-7.8,-5.5,5.5,7.8]){
        ctx.beginPath(); ctx.arc(3.4,wy,.72,0,6.28); ctx.fill(); } }
    ctx.fillStyle='rgba(170,215,255,.5)';             // tandem canopy: gunner ahead of pilot
    ctx.beginPath(); ctx.ellipse(7.3,0,2.5,2.05,0,0,6.28); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3.3,0,2.2,2.4,0,0,6.28); ctx.fill();
    ctx.fillStyle='#2E3129';                          // chin gun
    ctx.beginPath(); ctx.arc(9.5,0,1.45,0,6.28); ctx.fill();
    ctx.strokeStyle='#2E3129'; ctx.lineWidth=.9;
    ctx.beginPath(); ctx.moveTo(10.2,0); ctx.lineTo(13.4,0); ctx.stroke();
    ctx.fillStyle=c.body; ctx.fillRect(-3.2,-1.1,2.4,2.2);
    if(s.rec>.6){ ctx.fillStyle='rgba(255,220,140,.85)';
      ctx.beginPath(); ctx.arc(4,-7,2.6,0,6.28); ctx.fill(); }
    const spin=clock*38+s.v*3;                        // main rotor
    ctx.strokeStyle='rgba(210,215,205,.30)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(1,0,15,0,6.28); ctx.stroke();
    ctx.strokeStyle='rgba(226,230,220,.65)'; ctx.lineWidth=1.6;
    for(let b=0;b<4;b++){
      const a=spin+b*1.5708;
      ctx.beginPath(); ctx.moveTo(1,0); ctx.lineTo(1+Math.cos(a)*15,Math.sin(a)*15); ctx.stroke();
    }
    ctx.strokeStyle='rgba(226,230,220,.5)'; ctx.lineWidth=1.2;   // tail rotor, on the fin
    for(let b=0;b<2;b++){
      const a=-spin*1.4+b*3.14;
      ctx.beginPath(); ctx.moveTo(-20,-1); ctx.lineTo(-20+Math.cos(a)*5,-1+Math.sin(a)*5); ctx.stroke();
    }
    ctx.restore();
    if(quality&&R()<.25){                   // downwash
      parts.push({x:s.x+rnd(-14,14),y:s.y+rnd(-10,10),vx:rnd(-22,22),vy:rnd(-22,22),
        t:rnd(.25,.5),r:rnd(2,4),type:'dust'});
    }
  }
  function drawVehicle(s,c,t){
    const apc=t.kind==='cav',L=apc?9.5:11.5,Wd=apc?5:6.2;
    const hurt=s.hp<s.max*.45;
    ctx.save(); ctx.translate(s.x,s.y); ctx.rotate(s.hull);
    ctx.lineCap='butt';
    ctx.fillStyle='rgba(0,0,0,.36)';
    ctx.beginPath(); ctx.ellipse(1.8,2.6,L*1.06,Wd*1.05,0,0,6.28); ctx.fill();
    if(apc){                                              // eight wheels, four to a side
      const axles=[-6.8,-2.5,2.4,6.6];
      ctx.fillStyle='#1E201A';
      for(const wx of axles) for(const wy of [-Wd-1.1,Wd+1.1]){
        ctx.beginPath(); ctx.roundRect(wx-2.1,wy-1.35,4.2,2.7,1.2); ctx.fill(); }
      if(close){ ctx.fillStyle='rgba(255,255,255,.08)';    // hubs
        for(const wx of axles) for(const wy of [-Wd-1.1,Wd+1.1]){
          ctx.beginPath(); ctx.ellipse(wx,wy,.95,.78,0,0,6.28); ctx.fill(); } }
    } else {                                              // tracks and running gear
      ctx.fillStyle='#1F211B';
      ctx.beginPath(); ctx.roundRect(-L-.4,-Wd-2.1,L*2+.8,3.1,1.2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-L-.4, Wd-1.0,L*2+.8,3.1,1.2); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.075)';             // track links
      for(let px=-L;px<L-.8;px+=2.6){
        ctx.fillRect(px,-Wd-2.0,1.5,2.9); ctx.fillRect(px,Wd-.9,1.5,2.9); }
      if(close){ ctx.fillStyle='#34372E';                 // road wheels showing between the runs
        for(let px=-L+2.6;px<L-2;px+=3.4){
          ctx.beginPath(); ctx.arc(px,-Wd-.5,1,0,6.28); ctx.fill();
          ctx.beginPath(); ctx.arc(px, Wd+.5,1,0,6.28); ctx.fill(); } }
    }
    ctx.fillStyle=hurt?c.veh2:c.veh;                      // hull: sloped glacis, square at the back
    ctx.beginPath();
    ctx.moveTo(L,-Wd*.42); ctx.lineTo(L,Wd*.42);
    ctx.lineTo(L*.62,Wd); ctx.lineTo(-L,Wd);
    ctx.lineTo(-L,-Wd); ctx.lineTo(L*.62,-Wd);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.10)';                // light catching the glacis
    ctx.beginPath();
    ctx.moveTo(L*.62,-Wd*.9); ctx.lineTo(L*.96,-Wd*.36);
    ctx.lineTo(L*.96,Wd*.36); ctx.lineTo(L*.62,Wd*.9);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle=c.veh2; ctx.fillRect(-L+.4,-Wd*.72,3.2,Wd*1.44);      // engine deck
    if(close){
      ctx.fillStyle='rgba(0,0,0,.2)';                                   // deck louvres
      for(let i=0;i<3;i++) ctx.fillRect(-L+.9+i*.95,-Wd*.6,.45,Wd*1.2);
      ctx.fillStyle=c.veh2;                                             // stowage bins on the fenders
      ctx.beginPath(); ctx.roundRect(-L+4.2,-Wd-.3,4.4,1.3,.4); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-L+4.2, Wd-1,4.4,1.3,.4); ctx.fill();
    }
    ctx.fillStyle=c.body; ctx.fillRect(-L+1,-1.2,2.2,2.4);              // recognition marking
    ctx.restore();
    // turret traverses independently of the hull
    ctx.save(); ctx.translate(s.x,s.y); ctx.rotate(s.turret);
    ctx.lineCap='butt';
    const rec=Math.max(0,s.rec)*3;
    const tw=apc?3:4.3, tl=apc?3.4:5.4;
    ctx.fillStyle=hurt?c.veh2:c.veh;
    if(apc){                                              // a remote station, not a manned turret
      ctx.beginPath(); ctx.roundRect(-2.2,-tw*.75,4.6,tw*1.5,1.1); ctx.fill();
    } else {                                              // faceted turret with a bustle behind
      ctx.beginPath();
      ctx.moveTo(tl*.86,-tw*.52); ctx.lineTo(tl*.86,tw*.52);
      ctx.lineTo(tl*.16,tw); ctx.lineTo(-tl*.72,tw*.86);
      ctx.lineTo(-tl*1.06,tw*.44); ctx.lineTo(-tl*1.06,-tw*.44);
      ctx.lineTo(-tl*.72,-tw*.86); ctx.lineTo(tl*.16,-tw);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(0,0,0,.2)';                     // stowage rack on the bustle
      ctx.beginPath(); ctx.roundRect(-tl*1.02,-tw*.5,1.5,tw,.4); ctx.fill();
    }
    const gl=apc?11:17.5;
    ctx.strokeStyle='#2A2D25'; ctx.lineWidth=apc?1.5:2.4;
    ctx.beginPath(); ctx.moveTo(tl*.6-rec,0); ctx.lineTo(gl-rec,0); ctx.stroke();
    if(!apc){
      ctx.fillStyle='#2A2D25';                            // mantlet
      ctx.beginPath(); ctx.roundRect(tl*.6-rec,-1.95,2,3.9,.6); ctx.fill();
      ctx.strokeStyle='#34372E'; ctx.lineWidth=3;         // thermal sleeve over the breech end
      ctx.beginPath(); ctx.moveTo(tl*.6+2.2-rec,0); ctx.lineTo(gl*.6-rec,0); ctx.stroke();
      ctx.strokeStyle='#2A2D25'; ctx.lineWidth=3.4;       // muzzle brake
      ctx.beginPath(); ctx.moveTo(gl-2.2-rec,0); ctx.lineTo(gl-rec,0); ctx.stroke();
      if(close){
        ctx.strokeStyle='#2A2D25'; ctx.lineWidth=1;       // coaxial machine gun
        ctx.beginPath(); ctx.moveTo(tl*.6,-1.9); ctx.lineTo(gl*.55,-1.9); ctx.stroke();
        ctx.fillStyle='#2E3129';                          // smoke dischargers on the cheeks
        for(let i=0;i<3;i++){
          ctx.beginPath(); ctx.roundRect(tl*.1+i*1.1,-tw-1,.85,1.1,.3); ctx.fill();
          ctx.beginPath(); ctx.roundRect(tl*.1+i*1.1, tw-.1,.85,1.1,.3); ctx.fill(); }
      }
    }
    ctx.fillStyle=c.veh2;                                 // commander up in the cupola
    ctx.beginPath(); ctx.arc(-2.4,-1.7,1.7,0,6.28); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.arc(-2.4,-1.7,1.15,0,6.28); ctx.fill();
    ctx.fillStyle=c.skin;
    ctx.beginPath(); ctx.arc(-2.4,-1.7+Math.sin(clock*1.7+s.v*2)*.25,.8,0,6.28); ctx.fill();
    if(s.rec>.72){
      ctx.fillStyle='rgba(255,232,150,.9)';
      ctx.beginPath(); ctx.arc((apc?12:18.5),0,3.4,0,6.28); ctx.fill();
      ctx.fillStyle='rgba(255,180,80,.45)';
      ctx.beginPath(); ctx.arc((apc?14:21.5),0,5,0,6.28); ctx.fill();
    }
    ctx.restore();
    if(hurt&&quality&&R()<.05) burst(s.x,s.y,1,'smoke');
    if(quality&&s.moved>0&&R()<.09){                  // exhaust as it pulls away
      const ea=s.hull+Math.PI;
      parts.push({x:s.x+Math.cos(ea)*11,y:s.y+Math.sin(ea)*11,vx:Math.cos(ea)*10,vy:Math.sin(ea)*10-4,
        t:rnd(.5,1.1),r:rnd(2.5,4.5),type:'smoke'});
    }
  }
  function drawEngine(s,c){
    const t=s.sq.t;
    ctx.save(); ctx.translate(s.x,s.y); ctx.rotate(s.hull);
    ctx.fillStyle='rgba(0,0,0,.34)'; ctx.beginPath(); ctx.ellipse(0,4,13,5.4,0,0,6.28); ctx.fill();
    if(t.shell==='rocket'){                               // rocket truck
      ctx.fillStyle='#22241E';
      for(const wx of [-7,-2,6]) for(const wy of [-6,6]){
        ctx.beginPath(); ctx.ellipse(wx,wy,2.2,1.5,0,0,6.28); ctx.fill(); }
      ctx.fillStyle=c.veh; ctx.beginPath(); ctx.roundRect(-12,-5.6,10,11.2,1.6); ctx.fill();
      ctx.fillStyle=c.veh2; ctx.beginPath(); ctx.roundRect(-2,-6.4,14,12.8,1.6); ctx.fill();
      ctx.fillStyle='#2E3129';
      for(let i=-2;i<=2;i++) ctx.fillRect(0,i*2.5-1,13,1.9);
      ctx.fillStyle=c.body; ctx.fillRect(-11,-1,2.4,2);
    } else if(t.minRange>200){                            // towed howitzer with shield and trails
      ctx.strokeStyle=c.veh2; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(-2,0); ctx.lineTo(-13,-6); ctx.moveTo(-2,0); ctx.lineTo(-13,6); ctx.stroke();
      ctx.fillStyle='#22241E';
      for(const wy of [-6,6]){ ctx.beginPath(); ctx.ellipse(-1,wy,2.6,1.8,0,0,6.28); ctx.fill(); }
      ctx.fillStyle=c.veh; ctx.beginPath(); ctx.roundRect(-4,-6.5,7,13,1.6); ctx.fill();
      const rec=Math.max(0,s.rec)*4;
      ctx.strokeStyle='#2E3129'; ctx.lineWidth=3.2;
      ctx.beginPath(); ctx.moveTo(1-rec,0); ctx.lineTo(22-rec,0); ctx.stroke();
      ctx.fillStyle=c.body; ctx.fillRect(-3.4,-1.2,2,2.4);
      if(s.rec>.72){ ctx.fillStyle='rgba(255,236,150,.9)';
        ctx.beginPath(); ctx.arc(23,0,4,0,6.28); ctx.fill(); }
    } else {                                              // mortar and crew
      ctx.fillStyle=c.veh2; ctx.beginPath(); ctx.ellipse(0,0,4.6,4.2,0,0,6.28); ctx.fill();
      ctx.strokeStyle='#2E3129'; ctx.lineWidth=2.6;
      ctx.beginPath(); ctx.moveTo(-2.6,3); ctx.lineTo(5.5,-6.5); ctx.stroke();
      ctx.fillStyle=c.uni; ctx.beginPath(); ctx.arc(-5.5,3.4,2,0,6.28); ctx.fill();
      ctx.fillStyle=c.uni2; ctx.beginPath(); ctx.arc(-4.6,-3.8,2,0,6.28); ctx.fill();
      ctx.fillStyle=c.body; ctx.fillRect(-1,4.4,2.4,1.6);
      if(s.rec>.72){ ctx.fillStyle='rgba(255,236,150,.85)';
        ctx.beginPath(); ctx.arc(6.4,-7.6,3,0,6.28); ctx.fill(); }
    }
    ctx.restore();
  }

  for(let i=0;i<shots.length;i++){
    const a=shots[i];
    if(a.t<0||a.x<vx0||a.x>vx1||a.y<vy0||a.y>vy1) continue;
    const dx=a.tx-a.sx,dy=a.ty-a.sy,L=Math.hypot(dx,dy)||1;
    if(a.splash>0){
      if(a.lob){                                            // arcing shell or bomb
        ctx.fillStyle='rgba(0,0,0,.28)';
        ctx.beginPath(); ctx.ellipse(a.x,a.y,5,2.6,0,0,6.28); ctx.fill();
        ctx.fillStyle='#2E3128';
        ctx.beginPath(); ctx.ellipse(a.x,a.y-a.arc,4.4,2.8,Math.atan2(dy,dx),0,6.28); ctx.fill();
        if(quality&&R()<.35) burst(a.x,a.y-a.arc,1,'smoke');
      } else {                                              // flat-trajectory round
        ctx.strokeStyle=a.kind==='rocket'?'rgba(255,190,110,.95)':'rgba(255,236,180,.9)';
        ctx.lineWidth=a.kind==='rocket'?3:2.4;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(a.x-dx/L*16,a.y-dy/L*16); ctx.stroke();
        if(a.kind==='rocket'&&quality&&R()<.6) burst(a.x-dx/L*14,a.y-dy/L*14,1,'smoke');
      }
    } else {
      if(quality){ ctx.save(); ctx.globalCompositeOperation='lighter';
        ctx.strokeStyle=a.team==='blue'?'rgba(150,205,255,.5)':'rgba(255,180,120,.5)';
        ctx.lineWidth=3.4;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(a.x-dx/L*15,a.y-dy/L*15); ctx.stroke();
        ctx.restore(); }
      ctx.strokeStyle=a.team==='blue'?'rgba(214,240,255,.98)':'rgba(255,228,190,.98)';
      ctx.lineWidth=1.3;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(a.x-dx/L*13,a.y-dy/L*13); ctx.stroke();
    }
  }
  // laid mines — only the side that put them there can see them
  const mv=viewTeam();
  for(let i=0;i<mines.length;i++){
    const m=mines[i];
    if(m.team!==mv||m.x<vx0||m.x>vx1||m.y<vy0||m.y>vy1) continue;
    ctx.fillStyle='rgba(28,26,20,.75)';
    ctx.beginPath(); ctx.arc(m.x,m.y,3.6,0,6.28); ctx.fill();
    ctx.strokeStyle='rgba(226,186,90,.6)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(m.x,m.y,5.4,0,6.28); ctx.stroke();
  }
  // fires
  for(let i=0;i<fires.length;i++){
    const f=fires[i];
    if(f.x<vx0||f.x>vx1||f.y<vy0||f.y>vy1) continue;
    const fl=.75+Math.sin(clock*9+i)*.25;
    ctx.globalAlpha=.28;
    ctx.fillStyle='#FF9A3C'; ctx.beginPath(); ctx.arc(f.x,f.y,20*fl,0,6.28); ctx.fill();
    ctx.globalAlpha=1;
    ctx.fillStyle='#F2621F'; ctx.beginPath();
    ctx.moveTo(f.x-8,f.y+6); ctx.quadraticCurveTo(f.x-3,f.y-6*fl,f.x,f.y-13*fl);
    ctx.quadraticCurveTo(f.x+4,f.y-5*fl,f.x+8,f.y+6); ctx.fill();
    ctx.fillStyle='#FFD24A'; ctx.beginPath();
    ctx.moveTo(f.x-4,f.y+5); ctx.quadraticCurveTo(f.x,f.y-4*fl,f.x+1,f.y-8*fl);
    ctx.quadraticCurveTo(f.x+3,f.y-3*fl,f.x+4,f.y+5); ctx.fill();
  }
  for(let i=0;i<rings.length;i++){                 // blast waves
    const r=rings[i],k=1-r.t/r.max;
    if(r.x<vx0-400||r.x>vx1+400||r.y<vy0-400||r.y>vy1+400) continue;
    ctx.strokeStyle='rgba(255,232,190,'+(1-k)*.5+')';
    ctx.lineWidth=(3+6*(1-k))/cam.s;
    ctx.beginPath(); ctx.arc(r.x,r.y,r.r+(r.to-r.r)*k,0,6.28); ctx.stroke();
  }
  if(quality){                                     // fires and blasts throw light
    for(let i=0;i<fires.length;i++){
      const f=fires[i];
      if(f.x<vx0||f.x>vx1||f.y<vy0||f.y>vy1) continue;
      glow(f.x,f.y,42+Math.sin(clock*9+i)*7,.30);
    }
    for(let i=0;i<parts.length;i++){
      const p=parts[i];
      if(p.x<vx0||p.x>vx1||p.y<vy0||p.y>vy1) continue;
      if(p.type==='fireball') glow(p.x,p.y,p.r*4.5,clamp(p.t*1.6,0,.7));
      else if(p.type==='muzzle') glow(p.x,p.y,p.r*3,clamp(p.t*5,0,.55));
    }
  }
  for(let i=0;i<parts.length;i++){
    const p=parts[i];
    if(p.x<vx0||p.x>vx1||p.y<vy0||p.y>vy1) continue;
    const al=clamp(p.t*(p.type==='spark'?4:1.2),0,1);
    ctx.globalAlpha=al*(p.type==='spark'?1:p.type==='smoke'?.32:p.type==='splash'?.75:
      p.type==='leaf'?.6:p.type==='fireball'?.85:p.type==='flash'?.9:.5);
    ctx.fillStyle=p.type==='spark'?'#F7E7B0':p.type==='smoke'?'#6E6A62':
      p.type==='splash'?'#CFE8EC':p.type==='leaf'?'#7E8A4A':
      p.type==='fireball'?(p.t>.32?'#FFE07A':'#E2661F'):p.type==='flash'?'#FFF0B4':
      p.type==='debris'?'#2E2A22':p.type==='muzzle'?'#FFE7A8':'#9C9270';
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fill();
  }
  ctx.globalAlpha=1;
  for(let i=0;i<bases.length;i++){                  // outposts
    const b=bases[i];
    if(b.dead||b.x+b.r<vx0||b.x-b.r>vx1||b.y+b.r<vy0||b.y-b.r>vy1) continue;
    const c=COL[b.team];
    // The reach of the outpost. This used to be a dashed ring with a flat tint
    // inside it, which is a board-game token drawn on the ground. A soft falloff
    // says the same thing - influence thinning with distance - without stamping
    // a hard circle on the field.
    const rg=ctx.createRadialGradient(b.x,b.y,b.r*.35,b.x,b.y,b.r);
    const tint=b.team==='blue'?'76,127,191':'190,59,46';
    rg.addColorStop(0,'rgba('+tint+',.16)');
    rg.addColorStop(.72,'rgba('+tint+',.07)');
    rg.addColorStop(1,'rgba('+tint+',0)');
    ctx.fillStyle=rg;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,6.28); ctx.fill();
    ctx.fillStyle='rgba(70,68,58,.85)'; ctx.fillRect(b.x-104,b.y-92,208,184);   // hardstanding
    ctx.strokeStyle='rgba(24,22,18,.6)'; ctx.lineWidth=2/cam.s;
    ctx.strokeRect(b.x-104,b.y-92,208,184);
    ctx.fillStyle='rgba(120,116,100,.6)';
    for(let px=-104;px<104;px+=26) ctx.fillRect(b.x+px,b.y-92,20,6);
    // mast and colours
    ctx.strokeStyle='#2A281F'; ctx.lineWidth=3/cam.s;
    ctx.beginPath(); ctx.moveTo(b.x,b.y); ctx.lineTo(b.x,b.y-56); ctx.stroke();
    const wv=Math.sin(clock*2.2+i)*5;
    ctx.fillStyle=c.body;
    ctx.beginPath(); ctx.moveTo(b.x,b.y-56); ctx.lineTo(b.x+34,b.y-50+wv);
    ctx.lineTo(b.x,b.y-38); ctx.fill();
    if(b.cap>0){                                      // being taken
      ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(b.x-52,b.y+62,104,9);
      ctx.fillStyle=COL[other(b.team)].body; ctx.fillRect(b.x-52,b.y+62,104*b.cap,9);
    }
  }
  drawBuildings();
  drawCivs();                                         // under the canopy, over the ground
  ctx.drawImage(canopy,Math.sin(clock*.5+wind.a)*2.4*wind.v,Math.cos(clock*.37)*1.5*wind.v,W,H);
  for(const t of falling){                            // crowns still on their way down
    if(t.x<vx0-40||t.x>vx1+40||t.y<vy0-40||t.y>vy1+40) continue;
    const k=1-t.fall;
    ctx.save();
    ctx.translate(t.x,t.y); ctx.rotate(t.fa);
    ctx.translate(t.s*2.1*t.fall*.5,0); ctx.scale(1,Math.max(.12,k));
    ctx.globalAlpha=.55+.45*k;
    ctx.translate(-t.x,-t.y);
    paintCrown(ctx,t);
    ctx.restore();
  }
  ctx.globalAlpha=1;
  if(quality){
    ctx.strokeStyle='rgba(28,26,20,.5)'; ctx.lineWidth=1.4;
    for(const b of birds){
      for(let i=0;i<b.n;i++){
        const bx=b.x-i*17*Math.sign(b.v),by=b.y+((i%2)?9:-7)+i*4;
        if(bx<vx0||bx>vx1||by<vy0||by>vy1) continue;
        const f=Math.sin(b.ph+i*.7)*4;
        ctx.beginPath(); ctx.moveTo(bx-5,by+f); ctx.lineTo(bx,by-2+f*.3); ctx.lineTo(bx+5,by+f); ctx.stroke();
      }
    }
  }

  // What the selected units have been told to do, drawn on the ground: a line
  // from each unit through every waypoint it is holding, a flag at each, and the
  // rally point if one is planted. Orders you cannot see are orders you cannot
  // trust, and a queue you cannot see is not worth having.
  if(phase==='battle'&&selected.length){
    const team=viewTeam(),c=COL[team];
    ctx.lineCap='round'; ctx.lineJoin='round';
    for(const sq of selected){
      if(sq.gone||sq.alive<=0) continue;
      const legs=[];
      const o=sq.order;
      if(o.kind==='move') legs.push({x:o.x,y:o.y,fight:false});
      else if((o.kind==='attack'||o.kind==='charge')&&o.sq&&!o.sq.gone)
        legs.push({x:o.sq.fx,y:o.sq.fy,fight:true});
      for(const q of sq.queue||[]){
        if(q.kind==='move') legs.push({x:q.x,y:q.y,fight:false});
        else if(q.sq&&!q.sq.gone) legs.push({x:q.sq.fx,y:q.sq.fy,fight:true});
      }
      if(!legs.length) continue;
      ctx.strokeStyle=c.lt; ctx.globalAlpha=.5;
      ctx.lineWidth=2/cam.s; ctx.setLineDash([10/cam.s,9/cam.s]);
      ctx.beginPath(); ctx.moveTo(sq.fx,sq.fy);
      for(const l of legs) ctx.lineTo(l.x,l.y);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha=1;
      const R0=7/cam.s;
      legs.forEach((l,i)=>{
        ctx.fillStyle=l.fight?'rgba(226,120,104,.9)':c.lt;
        if(l.fight){                                 // a cross where you told them to fight
          ctx.lineWidth=2.6/cam.s; ctx.strokeStyle='rgba(226,120,104,.9)';
          ctx.beginPath();
          ctx.moveTo(l.x-R0,l.y-R0); ctx.lineTo(l.x+R0,l.y+R0);
          ctx.moveTo(l.x+R0,l.y-R0); ctx.lineTo(l.x-R0,l.y+R0);
          ctx.stroke();
        } else {                                     // a numbered stop for each leg
          ctx.beginPath(); ctx.arc(l.x,l.y,R0,0,6.28); ctx.fill();
          ctx.fillStyle='rgba(16,18,14,.85)';
          ctx.beginPath(); ctx.arc(l.x,l.y,R0*.55,0,6.28); ctx.fill();
        }
        if(i===legs.length-1&&legs.length>1){        // how many stops are planned
          ctx.fillStyle=c.lt;
          ctx.font='600 '+(13/cam.s)+'px "Barlow Condensed", sans-serif';
          ctx.textAlign='center';
          ctx.fillText(String(legs.length),l.x,l.y-R0*1.9);
          ctx.textAlign='left';
        }
      });
    }
    const rp=rally[team];
    if(rp){                                          // the rally flag
      ctx.strokeStyle=c.lt; ctx.lineWidth=2.4/cam.s;
      ctx.beginPath(); ctx.moveTo(rp.x,rp.y); ctx.lineTo(rp.x,rp.y-26/cam.s); ctx.stroke();
      ctx.fillStyle=c.lt;
      ctx.beginPath();
      ctx.moveTo(rp.x,rp.y-26/cam.s);
      ctx.lineTo(rp.x+17/cam.s,rp.y-20/cam.s);
      ctx.lineTo(rp.x,rp.y-14/cam.s);
      ctx.closePath(); ctx.fill();
    }
    ctx.lineCap='butt'; ctx.lineJoin='miter';
  }

  ctx.setTransform(dpr,0,0,dpr,0,0);

  // The light of the hour, laid over the finished ground and everything standing
  // on it. Applied here, at the point the world stops and the interface starts,
  // so the fog, the labels and the HUD stay at full contrast — a dark battle
  // should be hard to fight, not hard to read.
  const amb=ambientAt(tod);
  if(amb){
    ctx.fillStyle='rgba('+amb[0]+','+amb[1]+','+amb[2]+','+amb[3]+')';
    ctx.fillRect(0,0,w,h);
    // Muzzle flashes, fires and burning wrecks are most of what you navigate by
    // after dark, so let them punch back through the wash.
    if(night&&quality){
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      ctx.setTransform(cam.s*dpr,0,0,cam.s*dpr,cam.x*dpr,cam.y*dpr);
      for(const f of fires) glow(f.x,f.y,52,.34,'#FFB760');
      ctx.restore();
      ctx.setTransform(dpr,0,0,dpr,0,0);
    }
  }

  if(quality===1&&sky!=='clear'){                 // weather over the whole scene
    if(sky==='rain'){
      ctx.strokeStyle='rgba(190,214,232,.34)'; ctx.lineWidth=1.1;
      const dx=Math.cos(wind.a)*.3;
      ctx.beginPath();
      for(const p of weather){ ctx.moveTo(p.x,p.y); ctx.lineTo(p.x-dx*p.r*3,p.y-p.r); }
      ctx.stroke();
      ctx.fillStyle='rgba(120,150,170,.10)'; ctx.fillRect(0,0,w,h);
    } else if(sky==='snow'){
      ctx.fillStyle='rgba(238,244,250,.75)';
      for(const p of weather){ ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fill(); }
      ctx.fillStyle='rgba(200,216,230,.10)'; ctx.fillRect(0,0,w,h);
    } else if(sky==='dust'){
      for(const p of weather){
        ctx.fillStyle='rgba(206,178,116,'+(p.o*.10)+')';
        ctx.beginPath(); ctx.ellipse(p.x,p.y,p.r*2.2,p.r*.7,wind.a,0,6.28); ctx.fill();
      }
      ctx.fillStyle='rgba(196,166,108,.13)'; ctx.fillRect(0,0,w,h);
    } else {
      for(const p of weather){
        ctx.fillStyle='rgba(226,238,240,'+(p.o*.09)+')';
        ctx.beginPath(); ctx.ellipse(p.x,p.y,p.r*2.6,p.r*.8,0,0,6.28); ctx.fill();
      }
      ctx.fillStyle='rgba(190,212,214,.08)'; ctx.fillRect(0,0,w,h);
    }
  }
  if(quality===1){
    // A vignette should frame the picture, not smother it. At .42 on the rim it
    // was pulling the contrast out of half the field and leaving the ground a
    // flat haze, which is much of what made the map look painted rather than
    // photographed. Enough to draw the eye inward, no more.
    const v=ctx.createRadialGradient(w*.5,h*.45,Math.min(w,h)*.42,w*.5,h*.5,Math.max(w,h)*.82);
    v.addColorStop(0,'rgba(255,226,170,.03)'); v.addColorStop(1,'rgba(10,8,5,.24)');
    ctx.fillStyle=v; ctx.fillRect(0,0,w,h);
  }
  if(quality&&(phase==='battle'||phase==='deploy')){
    if(!fogDot) makeFogDot();
    if(!fogC||fogC.width!==cv.width||fogC.height!==cv.height){
      fogC=document.createElement('canvas'); fogC.width=cv.width; fogC.height=cv.height;
      fogX=fogC.getContext('2d');
    }
    fogX.setTransform(dpr,0,0,dpr,0,0);
    fogX.globalCompositeOperation='source-over';
    fogX.clearRect(0,0,w,h);
    fogX.fillStyle='rgba(7,9,11,.62)';
    const bx=w2sx(W/2);                          // the frontier, in screen terms
    if(viewTeam()==='blue') fogX.fillRect(bx,0,Math.max(0,w-bx),h);
    else fogX.fillRect(0,0,Math.max(0,bx),h);
    fogX.globalCompositeOperation='destination-out';
    for(let e=0;e<visionEyes.length;e+=3){
      const sx=w2sx(visionEyes[e]),sy=w2sy(visionEyes[e+1]),r=visionEyes[e+2]*cam.s;
      if(sx+r<0||sx-r>w||sy+r<0||sy-r>h) continue;
      fogX.drawImage(fogDot,sx-r,sy-r,r*2,r*2);
    }
    fogX.globalCompositeOperation='source-over';
    ctx.drawImage(fogC,0,0,w,h);
  }
  ctx.textBaseline='middle';
  for(let i=0;i<squads.length;i++){
    const sq=squads[i];
    if(sq.gone||!visible(sq.team)||!sq.seen) continue;
    const x=w2sx(sq.fx),y=w2sy(sq.fy);
    if(x<-70||y<-70||x>w+70||y>h+70) continue;
    const c=COL[sq.team],sel=selected.indexOf(sq)>=0;
    ctx.strokeStyle='rgba(12,10,8,.9)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(x,y+2); ctx.lineTo(x,y-27); ctx.stroke();
    const wave=Math.sin(sq.flag)*2.2;
    ctx.fillStyle=sq.routed?'#6b6555':c.body;
    ctx.beginPath(); ctx.moveTo(x,y-27);
    ctx.quadraticCurveTo(x+8,y-25+wave,x+15,y-22.5+wave*.6);
    ctx.quadraticCurveTo(x+7,y-18-wave*.4,x,y-15); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.moveTo(x,y-20); ctx.lineTo(x+13,y-21.5+wave*.6); ctx.lineTo(x,y-15); ctx.fill();
    const label=(sq.legion?ROMAN[sq.legion]:''),count=sq.alive+'/'+sq.initial;
    ctx.font='700 11px "Barlow Condensed", sans-serif';
    const tw=label?ctx.measureText(label).width+4:0;
    ctx.font='600 10px "Barlow Condensed", sans-serif';
    const cw=ctx.measureText(count).width,ic=17,pw=ic+tw+cw+13;
    ctx.fillStyle=sel?'rgba(72,60,18,.95)':'rgba(14,13,10,.85)';
    ctx.fillRect(x-pw/2,y-47,pw,17);
    ctx.strokeStyle=sel?'rgba(201,162,39,.95)':'rgba(0,0,0,.55)'; ctx.lineWidth=1;
    ctx.strokeRect(x-pw/2,y-47,pw,17);
    ctx.save();                                        // the unit's own silhouette
    ctx.translate(x-pw/2+4+ic/2,y-38.5);
    unitIcon(ctx,sq.type,15,sq.routed?'#9a927c':c.lt);
    ctx.restore();
    if(label){
      ctx.fillStyle=sq.routed?'#9a927c':c.lt;
      ctx.font='700 11px "Barlow Condensed", sans-serif'; ctx.textAlign='left';
      ctx.fillText(label,x-pw/2+ic+6,y-38);
    }
    ctx.textAlign='left';
    ctx.fillStyle='rgba(230,216,184,.75)'; ctx.font='600 10px "Barlow Condensed", sans-serif';
    ctx.fillText(count,x-pw/2+ic+tw+7,y-38);
    const ratio=sq.alive/sq.initial;
    ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(x-14,y-28,28,3);
    ctx.fillStyle=sq.routed?'#877f66':ratio>.6?c.lt:'#E0B44C'; ctx.fillRect(x-14,y-28,28*ratio,3);
    ctx.textAlign='center'; ctx.font='600 10px "Barlow Condensed", sans-serif';
    if(sq.routed){ ctx.fillStyle='rgba(240,153,140,.95)'; ctx.fillText('ROUTED',x,y+12); }
    else if(sq.disengage>0){ ctx.fillStyle='rgba(201,162,39,.9)'; ctx.fillText('MARCHING',x,y+12); }
  }
  ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  drawMini();
  if(box.on){
    ctx.strokeStyle='rgba(201,162,39,.9)'; ctx.lineWidth=1; ctx.setLineDash([4,4]);
    ctx.strokeRect(Math.min(box.x0,box.x1),Math.min(box.y0,box.y1),
      Math.abs(box.x1-box.x0),Math.abs(box.y1-box.y0));
    ctx.setLineDash([]);
  }
}
function drawCastle(c){
  if(c.x+c.hw<vx0||c.x-c.hw>vx1||c.y+c.hh<vy0||c.y-c.hh>vy1) return;
  const col=COL[c.team],f=c.dead?0:c.hp/c.max;
  const x=c.x,y=c.y,hw=c.hw,hh=c.hh;
  ctx.fillStyle='rgba(10,9,6,.42)';
  ctx.fillRect(x-hw+7,y-hh+9,hw*2,hh*2);
  if(c.dead){
    ctx.fillStyle='#514A40'; ctx.fillRect(x-hw,y-hh,hw*2,hh*2);
    ctx.fillStyle='rgba(24,20,14,.55)';
    for(let i=0;i<44;i++){
      const px=x+rnd(-hw,hw),py=y+rnd(-hh,hh),r=rnd(5,15);
      ctx.beginPath(); ctx.moveTo(px-r,py+r*.5); ctx.lineTo(px,py-r*.6); ctx.lineTo(px+r,py+r*.5); ctx.fill();
    }
    ctx.strokeStyle='rgba(60,54,44,.9)'; ctx.lineWidth=4;
    ctx.strokeRect(x-hw,y-hh,hw*2,hh*2);
    return;
  }
  // curtain wall
  ctx.fillStyle='#7E7669'; ctx.fillRect(x-hw,y-hh,hw*2,hh*2);
  ctx.fillStyle='#6B6357'; ctx.fillRect(x-hw+16,y-hh+16,hw*2-32,hh*2-32);
  ctx.fillStyle='#8C8477';
  for(let py=y-hh;py<y+hh;py+=17){                      // stone courses
    ctx.fillRect(x-hw,py,hw*2,1.4); ctx.fillRect(x-hw,py,1.4,17);
  }
  ctx.fillStyle='#948B7C';                              // crenellations
  for(let px=x-hw;px<x+hw;px+=17){ ctx.fillRect(px,y-hh-6,10,7); ctx.fillRect(px,y+hh-1,10,7); }
  for(let py=y-hh;py<y+hh;py+=17){ ctx.fillRect(x-hw-6,py,7,10); ctx.fillRect(x+hw-1,py,7,10); }
  // inner keep
  ctx.fillStyle='rgba(14,12,9,.35)'; ctx.fillRect(x-32+5,y-42+6,64,84);
  ctx.fillStyle='#8F8779'; ctx.fillRect(x-32,y-42,64,84);
  ctx.fillStyle='#6E6659'; ctx.fillRect(x-32,y-42,64,20);
  ctx.fillStyle='rgba(20,16,12,.6)'; ctx.fillRect(x-8,y+18,16,24);
  // gate, facing the field
  const gx=c.team==='blue'?x+hw:x-hw;
  ctx.fillStyle='#4A3A26'; ctx.fillRect(gx-8,y-26,16,52);
  ctx.fillStyle='#2C2216'; ctx.fillRect(gx-5,y-22,10,44);
  // corner towers
  for(const tx of [x-hw,x+hw]) for(const ty of [y-hh,y+hh]){
    ctx.fillStyle='rgba(12,10,7,.4)'; ctx.beginPath(); ctx.arc(tx+4,ty+5,19,0,6.28); ctx.fill();
    ctx.fillStyle='#8A8274'; ctx.beginPath(); ctx.arc(tx,ty,19,0,6.28); ctx.fill();
    ctx.fillStyle='#6C6457'; ctx.beginPath(); ctx.arc(tx,ty,13,0,6.28); ctx.fill();
    ctx.fillStyle='#9C9384';
    for(let a=0;a<6.28;a+=.55) ctx.fillRect(tx+Math.cos(a)*17-3,ty+Math.sin(a)*17-3,6,6);
  }
  // damage
  if(f<.75){
    ctx.strokeStyle='rgba(28,22,16,.7)'; ctx.lineWidth=3;
    const cracks=Math.round((1-f)*9);
    for(let i=0;i<cracks;i++){
      const px=x+Math.sin(i*7.3+c.max)*hw*.9,py=y+Math.cos(i*3.1+c.max)*hh*.9;
      ctx.beginPath(); ctx.moveTo(px,py);
      ctx.lineTo(px+Math.sin(i*2.7)*22,py+Math.cos(i*4.4)*24); ctx.stroke();
    }
  }
  // colours over the HQ
  ctx.strokeStyle='rgba(15,13,10,.9)'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(x,y-42); ctx.lineTo(x,y-78); ctx.stroke();
  const wv=Math.sin(clock*2.2)*4;
  ctx.fillStyle=col.body;
  ctx.beginPath(); ctx.moveTo(x,y-78);
  ctx.quadraticCurveTo(x+14,y-74+wv,x+27,y-70+wv*.6);
  ctx.quadraticCurveTo(x+13,y-62-wv*.4,x,y-58); ctx.fill();
  // strength bar over the gate
  ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(x-hw,y-hh-20,hw*2,7);
  ctx.fillStyle=f>.5?col.lt:f>.25?'#E0B44C':'#E06A4C';
  ctx.fillRect(x-hw,y-hh-20,hw*2*f,7);
}
function drawBuildings(){
  const sx=Math.cos(sun),sy=Math.sin(sun),lift=quality?1:.55;
  for(let i=0;i<buildings.length;i++){
    const b=buildings[i];
    if(b.dead) continue;
    if(b.x+b.w<vx0-40||b.x-b.w>vx1+40||b.y+b.h<vy0-40||b.y-b.h>vy1+40) continue;
    const storeys=b.city?3.2:b.bunker?1.1:1.8;
    const hgt=b.h*.42*storeys*lift;
    ctx.save(); ctx.translate(b.x,b.y); ctx.rotate(b.rot||0);
    const hw=b.w/2,hh=b.h/2;
    // shadow thrown across the ground
    ctx.fillStyle='rgba(12,11,8,.42)';
    ctx.beginPath();
    ctx.moveTo(-hw,-hh); ctx.lineTo(hw,-hh); ctx.lineTo(hw,hh); ctx.lineTo(-hw,hh);
    ctx.closePath();
    ctx.translate(sx*hgt*.75,sy*hgt*.75); ctx.fill();
    ctx.translate(-sx*hgt*.75,-sy*hgt*.75);
    // walls, extruded toward the viewer
    const wallD=b.bunker?'#4E4E44':b.city?'#59544B':'#6B6356';
    ctx.fillStyle=wallD;
    ctx.beginPath();
    ctx.moveTo(-hw,hh); ctx.lineTo(hw,hh); ctx.lineTo(hw,hh+hgt); ctx.lineTo(-hw,hh+hgt);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,.22)';
    ctx.beginPath();
    ctx.moveTo(hw,-hh); ctx.lineTo(hw,hh+hgt); ctx.lineTo(hw+2,hh+hgt); ctx.lineTo(hw+2,-hh);
    ctx.closePath(); ctx.fill();
    // windows down the near wall
    if(!b.bunker){
      ctx.fillStyle='rgba(20,18,14,.6)';
      for(let wx=-hw+5;wx<hw-6;wx+=11)
        for(let wy=hh+4;wy<hh+hgt-3;wy+=9) ctx.fillRect(wx,wy,5,5);
    } else {
      ctx.fillStyle='rgba(16,14,10,.85)'; ctx.fillRect(-hw+5,hh+hgt*.35,b.w-10,4.5);
    }
    // roof, taking the colour of whoever holds the place
    const base=b.bunker?'#6E6E60':b.city?'#7C7468':(mapType==='desert'||mapType==='beach'?'#C0A97A':'#8E8574');
    ctx.fillStyle=base;
    ctx.fillRect(-hw,-hh,b.w,b.h);
    if(b.hold&&b.tint>0){
      const c=COL[b.hold];
      ctx.globalAlpha=b.tint*.62; ctx.fillStyle=c.body; ctx.fillRect(-hw,-hh,b.w,b.h);
      ctx.globalAlpha=1;
      ctx.strokeStyle=c.lt; ctx.lineWidth=2.4; ctx.strokeRect(-hw,-hh,b.w,b.h);
      ctx.fillStyle=c.lt;                                  // flag on the roof
      ctx.fillRect(-2,-hh-9,2,10); ctx.fillRect(0,-hh-9,7,5);
    } else {
      ctx.strokeStyle='rgba(26,24,20,.6)'; ctx.lineWidth=1.2; ctx.strokeRect(-hw,-hh,b.w,b.h);
    }
    ctx.fillStyle='rgba(255,255,255,.07)'; ctx.fillRect(-hw,-hh,b.w,b.h*.28);
    const f=b.hp/b.max;
    if(f<.85){                                        // shell holes and blown-out corners
      ctx.fillStyle='rgba(28,25,20,.62)';
      const holes=Math.round((1-f)*9);
      for(let k=0;k<holes;k++){
        const hx2=Math.sin(k*7.7+b.x)*hw*.8,hy2=Math.cos(k*4.3+b.y)*hh*.8;
        ctx.beginPath(); ctx.arc(hx2,hy2,2.5+(1-f)*4,0,6.28); ctx.fill();
      }
      ctx.fillStyle='rgba(0,0,0,'+(1-f)*.3+')'; ctx.fillRect(-hw,-hh,b.w,b.h);
    }
    ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(-hw,-hh-6,b.w,3);
    ctx.fillStyle=f>.5?'#9FC9A0':f>.25?'#E0B44C':'#E06A4C';
    ctx.fillRect(-hw,-hh-6,b.w*f,3);
    ctx.restore();
  }
}
// The minimap. Takes the context to draw into, because in the 3D view it
// lands on the overlay canvas rather than on the battlefield itself.
function drawMini(g){
  g=g||ctx;
  const {x,y,w:mw,h:mh,s,cx,cy,r}=mini;
  g.save();
  g.beginPath(); g.arc(cx,cy,r,0,6.28); g.closePath();
  g.fillStyle='rgba(10,10,8,.9)'; g.fill();
  g.clip();
  g.fillStyle='rgba(69,70,50,.6)'; g.fillRect(x,y,mw,mh);
  {
    const bw=mw/TX,bh=mh/TY;
    for(let gy=0;gy<TY;gy++) for(let gx=0;gx<TX;gx++){
      const o=terrOwn[gy*TX+gx];
      g.fillStyle=o===1?'rgba(76,127,191,.34)':o===2?'rgba(190,59,46,.34)':'rgba(0,0,0,0)';
      g.fillRect(x+gx*bw,y+gy*bh,bw,bh);
    }
  }
  g.strokeStyle='rgba(201,162,39,.45)'; g.lineWidth=1; g.strokeRect(x-1,y-1,mw+2,mh+2);
  if(hasWater()){
    g.strokeStyle=MAPS[mapType].water==='canal'?'rgba(80,120,132,.85)':'rgba(90,140,150,.85)';
    g.lineWidth=Math.max(2,52*s);
    g.beginPath(); for(let yy=0;yy<=H;yy+=40) g.lineTo(x+riverXAt(yy)*s,y+yy*s); g.stroke();
    if(mapType==='beach'){ g.lineWidth=Math.max(2,150*s);
      g.beginPath(); g.moveTo(x,y+(H-95)*s); g.lineTo(x+mw,y+(H-95)*s); g.stroke(); }
  } else {
    g.strokeStyle='rgba(190,168,110,.5)'; g.lineWidth=Math.max(2,90*s);
    g.beginPath(); for(let yy=0;yy<=H;yy+=40) g.lineTo(x+riverXAt(yy)*s,y+yy*s); g.stroke();
  }
  g.strokeStyle='rgba(236,224,180,.9)'; g.lineWidth=2;
  if(hasWater()) for(const cr of CROSS){
    g.lineWidth=cr.type==='bridge'?4:2;
    g.beginPath();
    g.moveTo(x+(riverXAt(cr.y)-40)*s,y+cr.y*s); g.lineTo(x+(riverXAt(cr.y)+40)*s,y+cr.y*s); g.stroke(); }
  g.lineWidth=2;
  g.strokeStyle='rgba(201,162,39,.2)'; g.lineWidth=1;
  for(const dy of div){ g.beginPath(); g.moveTo(x,y+dy*s); g.lineTo(x+mw,y+dy*s); g.stroke(); }
  for(const c of castles){
    g.fillStyle=c.dead?'#4A443A':COL[c.team].lt;
    g.fillRect(x+(c.x-c.hw)*s,y+(c.y-c.hh)*s,c.hw*2*s,c.hh*2*s);
    g.strokeStyle='rgba(20,16,10,.8)'; g.lineWidth=1;
    g.strokeRect(x+(c.x-c.hw)*s,y+(c.y-c.hh)*s,c.hw*2*s,c.hh*2*s);
  }
  for(let i=0;i<fires.length;i++){
    g.fillStyle='rgba(255,150,60,.9)';
    g.beginPath(); g.arc(x+fires[i].x*s,y+fires[i].y*s,1.6,0,6.28); g.fill();
  }
  for(let i=0;i<buildings.length;i++){
    const b=buildings[i];
    if(b.dead||!b.hold||b.tint<.3) continue;
    g.fillStyle=COL[b.hold].body;
    g.fillRect(x+b.x*s-1,y+b.y*s-1,2.4,2.4);
  }
  for(let i=0;i<bases.length;i++){
    const b=bases[i];
    if(b.dead) continue;
    g.strokeStyle=COL[b.team].lt; g.lineWidth=1.4;
    g.strokeRect(x+b.x*s-3,y+b.y*s-3,6,6);
    if(b.cap>0){ g.fillStyle=COL[other(b.team)].body; g.fillRect(x+b.x*s-3,y+b.y*s-3,6*b.cap,6); }
  }
  for(let i=0;i<squads.length;i++){
    const sq=squads[i];
    if(sq.gone||!visible(sq.team)||!sq.seen) continue;
    const sel=selected.indexOf(sq)>=0;
    g.fillStyle=sel?'#F5DC96':COL[sq.team].body;
    g.beginPath(); g.arc(x+sq.fx*s,y+sq.fy*s,sel?2.8:2,0,6.28); g.fill();
  }
  const v0=s2w(0,0),v1=s2w(cv.width/dpr,cv.height/dpr);
  g.strokeStyle='rgba(255,255,255,.6)'; g.lineWidth=1.2;
  g.strokeRect(x+clamp(v0.x,0,W)*s,y+clamp(v0.y,0,H)*s,
    (clamp(v1.x,0,W)-clamp(v0.x,0,W))*s,(clamp(v1.y,0,H)-clamp(v0.y,0,H))*s);
  g.restore();
  // brass rim with bearing ticks
  g.strokeStyle='rgba(201,162,39,.75)'; g.lineWidth=2.4;
  g.beginPath(); g.arc(cx,cy,r,0,6.28); g.stroke();
  g.strokeStyle='rgba(14,13,10,.75)'; g.lineWidth=1;
  g.beginPath(); g.arc(cx,cy,r+1.6,0,6.28); g.stroke();
  g.strokeStyle='rgba(230,216,184,.45)'; g.lineWidth=1.4;
  for(let a=0;a<6.28;a+=Math.PI/6){
    const long=Math.abs(a%(Math.PI/2))<.01;
    g.beginPath();
    g.moveTo(cx+Math.cos(a)*(r-(long?9:5)),cy+Math.sin(a)*(r-(long?9:5)));
    g.lineTo(cx+Math.cos(a)*(r-1),cy+Math.sin(a)*(r-1)); g.stroke();
  }
  g.fillStyle='rgba(230,216,184,.6)'; g.font='700 9px "Barlow Condensed", sans-serif';
  g.textAlign='center'; g.textBaseline='middle';
  g.fillText('N',cx,cy-r+8); g.fillText('S',cx,cy+r-8);
  g.fillText('W',cx-r+8,cy); g.fillText('E',cx+r-8,cy);
  g.textAlign='left'; g.textBaseline='alphabetic';
}

/* ===================== HUD ===================== */
let hudAcc=0,lastInfo='',lastPhase='',lastClock='';
function paintHud(dt){
  hudAcc-=dt; if(hudAcc>0) return; hudAcc=.12;
  syncDeck();
  let bl=0,rd=0,b0=0,r0=0;
  for(let i=0;i<squads.length;i++){
    const sq=squads[i];
    if(sq.team==='blue'){ b0+=sq.initial; if(!sq.gone&&!sq.routed) bl+=sq.alive; }
    else { r0+=sq.initial; if(!sq.gone&&!sq.routed) rd+=sq.alive; }
  }
  const hide=phase==='deploy'&&mode==='hot';
  el('bNum').textContent=(hide&&depTeam!=='blue')?'—':bl;
  el('rNum').textContent=(hide&&depTeam!=='red')?'—':rd;
  el('bCoin').textContent=coinsLeft('blue').toLocaleString()+' coins';
  el('rCoin').textContent=coinsLeft('red').toLocaleString()+' coins';
  el('bLv').textContent=rankOf(lvl.blue).short+' '+prof.name+' · '+Math.round(landShare('blue')*100)+'%';
  el('rLv').textContent=rankOf(lvl.red).short+' · '+Math.round(landShare('red')*100)+'% of the map';
  el('bBar').firstElementChild.style.width=(b0?bl/b0*100:0)+'%';
  el('rBar').firstElementChild.style.width=(r0?rd/r0*100:0)+'%';
  const bc=ownCastle('blue'),rc=ownCastle('red');
  el('bKeep').firstElementChild.style.width=(bc?bc.hp/bc.max*100:0)+'%';
  el('rKeep').firstElementChild.style.width=(rc?rc.hp/rc.max*100:0)+'%';
  let ph='',ck='';
  if(phase==='deploy'){
    ph=mode==='hot'?(depTeam==='blue'?'Blue deploy':'Red deploy'):'Deploy';
    ck=Math.max(0,Math.ceil(depTime))+'s';
  } else if(phase==='battle'){
    if(mode==='hot'){
      ph=hot.stage==='orders'?(hot.team==='blue'?'Blue orders':'Red orders'):'Round '+hot.round;
      ck=Math.max(0,Math.ceil(hot.t))+'s';
    } else { ph=(mode==='ai'?DIFF[diff].name:'Battle')+(wave?' · wave '+wave:''); ck=fmt(battleTime); }
    const team=viewTeam();
    document.querySelectorAll('.leg').forEach(b=>{
      let n=0; for(const s of squads) if(s.team===team&&!s.gone&&s.legion===+b.dataset.leg) n++;
      const txt=ROMAN[+b.dataset.leg]+(n?' ('+n+')':'');
      if(b.textContent!==txt) b.textContent=txt;
      b.classList.toggle('on',n>0&&selected.length>0&&selected.every(s=>s.legion===+b.dataset.leg));
    });
  }
  // the hour rides along with the phase line, so you can see the light going
  const ph2=phase==='battle'?ph+' · '+phaseName(tod):ph;
  if(ph2!==lastPhase){ el('phase').textContent=ph2; lastPhase=ph2; }
  if(ck!==lastClock){ el('clock').textContent=ck; lastClock=ck; }
  paintInfo();
}
function paintBuildBar(){
  const has=selected.some(sq=>!sq.gone&&sq.t.builder)&&(phase==='deploy'||phase==='battle');
  const row=el('buildRow');
  const want=has?'flex':'none';
  if(row.style.display!==want){
    row.style.display=want;
    if(!has){ building=null; drawing=null; document.querySelectorAll('.bld').forEach(b=>b.classList.remove('on')); }
    requestAnimationFrame(resize);
  }
  if(has){
    const team=cmdTeam()||viewTeam();
    document.querySelectorAll('.bld').forEach(b=>{
      const k=b.dataset.b,ok=lvl[team]>=WORKLVL[k];
      b.classList.toggle('locked',!ok);
      b.textContent=(k==='wall'?'Sandbags':k==='wire'?'Wire':k==='mine'?'Mines':'Trench')
        +' '+Math.round(WORKRATE[k]*100)+'/100m'+(ok?'':' · Lv'+WORKLVL[k]);
    });
  }
}
function paintInfo(){
  paintBuildBar();
  const i=el('info'); let html;
  if(phase==='deploy'&&placing){
    if(placing==='wall') html='<b>'+WALL.name+'</b> · hard cover, blocks movement · needs engineers on site · <span class="st">cost</span> '+WALL.cost;
    else if(placing==='wire') html='<b>'+WIRE.name+'</b> · '+WIRE.len+'m belt · infantry crawl through at a quarter speed and take cuts · <span class="st">cost</span> '+WIRE.cost+' · laid '+ANGNAME[ANGS.indexOf(placeAng)];
    else if(placing==='trench') html='<b>'+TRENCH.name+'</b> · '+TRENCH.len+'m cut · troops inside take under half damage · slows armour crossing · <span class="st">cost</span> '+TRENCH.cost+' · dug '+ANGNAME[ANGS.indexOf(placeAng)];
    else if(placing==='mine') html='<b>'+MINE.name+'</b> · 3 mines per lay · hidden from the enemy · <span class="st">blast</span> '+MINE.dmg+' · double against vehicles · <span class="st">cost</span> '+MINE.cost;
    else if(!UNITS[placing]){
      html='Pick a unit above to send one out, or tap a marker to give orders';
    }
    else{
      const u=UNITS[placing];
      html='<b>'+u.name+'</b> · '+unitCount(placing)+(u.kind==='siege'?' engines':' effectives')
        +' · <span class="st">dmg</span> '+(u.shellDmg||u.dmg)
        +' · <span class="st">range</span> '+u.range+' · <span class="st">speed</span> '+u.speed
        +' · <span class="st">cost</span> '+unitCost(placing)+' — tap your ground to place · Ctrl+1…9 names a group';
    }
  } else if(!selected.length){
    html=cmdTeam()?'Tap a marker to select · tap ground to move · tap an enemy to engage · deep water stops everyone, use the fords and the bridge'
      :'Watching the round play out';
  } else if(selected.length>1){
    let men=0; for(const s of selected) men+=s.alive;
    html='<b>'+selected.length+' units</b> · '+men+' effectives under command';
  } else {
    const sq=selected[0],u=sq.t;
    const ord=sq.routed?'ROUTED':sq.order.kind==='attack'?'attacking':sq.order.kind==='charge'?'charging':
      sq.order.kind==='castle'?'hitting the HQ':
      sq.order.kind==='move'?'marching':sq.order.kind==='back'?'falling back':
      sq.order.kind==='build'?('building '+WORKNAME[sq.order.what]):'holding';
    html='<b>'+u.name+(sq.legion?' · Company '+ROMAN[sq.legion]:'')+'</b> '+sq.alive+'/'+sq.initial
      +' · <span class="st">dmg</span> '+(u.shellDmg||u.dmg)
      +' · <span class="st">rng</span> '+u.range+' · <span class="st">spd</span> '+u.speed
      +' · '+FORMLABEL[sq.formation]+' · '+ord+' · '+LANE_NAME[laneOf(sq.fy)].toLowerCase()
      +' · '+groundName(sq.fx,sq.fy);
  }
  if(html!==lastInfo){ i.innerHTML=html; lastInfo=html; }
  const key=phase==='deploy'?placing:(selected.length===1?selected[0].type:null);
  const box=el('infoIcon');
  if(box){
    if(key&&key!==box.dataset.k){ box.dataset.k=key; box.src=iconDataURL(key,36,'#C9A227'); box.style.display='block'; }
    else if(!key){ box.style.display='none'; box.dataset.k=''; }
  }
}
const fmt=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
function paintPoints(){
  const t=phase==='battle'?(cmdTeam()||viewTeam()):depTeam;
  el('points').textContent=(sandbox?'unlimited':coinsLeft(t).toLocaleString()+' coins')
    +' · '+liveCount(t)+'/'+capOf(t)+' fighters · '+rankOf(lvl[t]).short;
}
function buildPalette(){
  const p=el('pal'); p.innerHTML='';
  const add=(k,name,cost,l2,l3)=>{
    const b=document.createElement('button');
    b.className='card'+(k===placing?' on':'');
    const team=phase==='deploy'?depTeam:(cmdTeam()||viewTeam());
    const open=unlocked(team,k);
    b.className='card'+(k===placing&&open?' on':'')+(open?'':' locked');
    b.innerHTML='<div class="cardtop"><img class="ico" src="'+iconDataURL(k,44,open?'#E6D8B8':'#6C6552')+'" alt="">'
      +'<b>'+name+'</b></div>'
      +(open?('<span><em>'+cost+'</em> · '+l2+'</span>')
            :('<span class="lock">LEVEL '+reqLvl(k)+'</span><span>'+l3+'</span>'));
    b.onclick=()=>{
      if(!open){ toast(name+' unlocks at level '+reqLvl(k)); return; }
      placing=placing===k?null:k;                 // press again to go back to giving orders
      buildPalette(); paintInfo();
      if(placing) toast(name+' — tap your ground to send one there');
    };
    p.appendChild(b);
  };
  PAL_ORDER.forEach(k=>{ const u=UNITS[k];
    add(k,u.name,unitCost(k),unitCount(k)+(u.vehicle?' vehicles':u.kind==='siege'?' guns':' troops'),
      'dmg '+(u.shellDmg||u.dmg)+' · rng '+u.range+' · spd '+u.speed); });

}

/* ===================== unit icons ===================== */
// drawn centred on the origin inside a box of side S
function unitIcon(g,key,S,col){
  const u=S/16;
  g.save(); g.translate(0,0);
  g.fillStyle=col; g.strokeStyle=col;
  g.lineWidth=Math.max(1,1.5*u); g.lineCap='round'; g.lineJoin='round';
  const dot=(x,y,r)=>{ g.beginPath(); g.arc(x*u,y*u,r*u,0,6.28); g.fill(); };
  const bar=(x,y,w,h)=>g.fillRect(x*u,y*u,w*u,h*u);
  const ln=(x1,y1,x2,y2,w)=>{ g.lineWidth=Math.max(1,(w||1.4)*u);
    g.beginPath(); g.moveTo(x1*u,y1*u); g.lineTo(x2*u,y2*u); g.stroke(); };
  switch(key){
    case 'rifle':                       // rifleman standing
      dot(-1,-5,2); bar(-2.4,-3,4.4,5); ln(-1.6,2,-2.6,6,1.6); ln(0.4,2,1.6,6,1.6);
      ln(-4,-1.5,5,-3.4,1.5); break;
    case 'assault':                     // rifleman at the run
      dot(0,-5.2,2); bar(-1.6,-3.2,4.2,4.6); ln(-1,1.4,-3.6,5.6,1.6); ln(1.4,1.4,3.6,5.2,1.6);
      ln(-3,-2,5.4,-3.6,1.5); ln(-6.4,-3.8,-4.4,-4.2,1); ln(-6.6,-1.6,-4.6,-2,1); break;
    case 'mg':                          // gunner prone behind the gun
      g.beginPath(); g.ellipse(-2*u,1.6*u,3.6*u,1.8*u,0,0,6.28); g.fill();
      dot(0.6,0.6,1.6); ln(1,-0.4,7,-1.6,1.7); ln(4.6,-1.2,4,3,1.2); ln(4.6,-1.2,6.4,2.4,1.2); break;
    case 'sniper':                      // long rifle and scope
      dot(-2.6,-3.4,1.8); g.beginPath(); g.ellipse(-2*u,1*u,3.4*u,2*u,-.3,0,6.28); g.fill();
      ln(-1,-1.6,7.4,-3.6,1.5); dot(2.4,-3.4,1.1); break;
    case 'at':                          // launcher on the shoulder
      dot(-2,-4.4,1.9); bar(-3.2,-2.4,4,4.6); ln(-2.6,2,-3.4,6,1.5); ln(0.4,2,1.4,6,1.5);
      ln(-5.4,-3.4,5.4,-5.4,2.4); g.beginPath();
      g.moveTo(-5.6*u,-2.4*u); g.lineTo(-7.6*u,-3.2*u); g.lineTo(-5.6*u,-4.4*u); g.fill(); break;
    case 'apc':                         // wheeled carrier
      g.beginPath(); g.moveTo(-6.6*u,1.4*u); g.lineTo(-5.4*u,-2*u); g.lineTo(3.6*u,-2*u);
      g.lineTo(6.6*u,0.4*u); g.lineTo(6.6*u,1.4*u); g.closePath(); g.fill();
      bar(-1.6,-4.2,3.4,2.4); ln(0.6,-3.4,6.6,-3.4,1.2);
      dot(-4.2,2.6,1.7); dot(0,2.6,1.7); dot(4.2,2.6,1.7); break;
    case 'tank':                        // hull, turret, gun
      bar(-7,-0.6,14,3); dot(-5.4,2.6,1.5); dot(-2,2.6,1.5); dot(1.4,2.6,1.5); dot(4.8,2.6,1.5);
      g.beginPath(); g.moveTo(-5.4*u,-0.8*u); g.lineTo(-3.4*u,-3.6*u); g.lineTo(2.6*u,-3.6*u);
      g.lineTo(4.4*u,-0.8*u); g.closePath(); g.fill();
      ln(2.6,-2.4,8.4,-2.4,1.8); break;
    case 'mortar':                      // tube on a baseplate
      ln(-3.4,3.4,3.6,3.4,1.6); ln(-2.4,3,4.6,-4.6,2.4); dot(-3.6,0.6,1.8);
      g.beginPath(); g.moveTo(4.4*u,-6.4*u); g.lineTo(3.2*u,-4.6*u); g.lineTo(5.6*u,-4.6*u);
      g.closePath(); g.fill(); break;
    case 'howitzer':                    // towed gun
      ln(1.4,-1.4,8.4,-3.4,2.6); bar(-2.6,-3.6,3,6.4);
      dot(-1,3,2.2); ln(-2.4,1.4,-7.4,4.4,1.6); ln(-2.4,1.4,-7.4,-1.6,1.6); break;
    case 'mlrs':                        // rocket truck
      g.beginPath(); g.moveTo(-7*u,1.4*u); g.lineTo(-7*u,-2.4*u); g.lineTo(-3.4*u,-2.4*u);
      g.lineTo(-3.4*u,1.4*u); g.closePath(); g.fill();
      bar(-3,-3.4,9,4.6); ln(-1,-4.6,7,-6.6,1.2); ln(-1,-2.8,7,-4.8,1.2);
      dot(-5.4,2.8,1.7); dot(1,2.8,1.7); dot(4.6,2.8,1.7); break;
    case 'wall':                        // sandbags
      for(let r=0;r<3;r++) for(let cn=0;cn<3;cn++){
        g.beginPath();
        g.ellipse((-4+cn*4+(r%2?1.6:0))*u,(3-r*3)*u,2.2*u,1.5*u,0,0,6.28); g.fill(); }
      break;
    case 'worker':                      // engineer with a shovel
      dot(-1,-5,2); bar(-2.4,-3,4.4,5); ln(-1.6,2,-2.6,6,1.6); ln(0.4,2,1.6,6,1.6);
      ln(1,-2,6,-6,1.5);
      g.beginPath(); g.moveTo(5*u,-7.6*u); g.lineTo(8*u,-4.4*u); g.lineTo(6*u,-3*u); g.closePath(); g.fill();
      break;
    case 'heli':                        // gunship
      g.globalAlpha=.5; ln(-8,-4,8,-4,1.2); g.globalAlpha=1;
      g.beginPath(); g.ellipse(0,0,5.6*u,3*u,0,0,6.28); g.fill();
      bar(-9,-0.8,6,1.6); ln(0,-4,0,-1,1.4);
      ln(-4,3,4,3,1.4); dot(6,-.4,1.2); break;
    case 'wire':                        // wire on pickets
      ln(-7,-3,7,-3,1.3); ln(-7,3,7,3,1.3);
      for(let i=-5;i<=5;i+=5){ ln(i-1.6,-4.6,i+1.6,-1.4,1); ln(i-1.6,-1.4,i+1.6,-4.6,1);
        ln(i-1.6,1.4,i+1.6,4.6,1); ln(i-1.6,4.6,i+1.6,1.4,1); }
      ln(-7,-6,-7,6,1.4); ln(7,-6,7,6,1.4); break;
    case 'trench':                      // a cut with spoil on the parapet
      g.globalAlpha=.55; bar(-8,-5.4,16,2.4); bar(-8,3,16,2.4); g.globalAlpha=1;
      bar(-8,-2.6,16,5.2);
      g.fillStyle='rgba(0,0,0,.35)'; bar(-8,-1.4,16,2.6);
      g.fillStyle=col;
      for(let i=-6;i<=6;i+=4) bar(i,-2.6,1.4,5.2); break;
    case 'mine':                        // mine and its prongs
      g.beginPath(); g.ellipse(0,2*u,5.4*u,2.6*u,0,0,6.28); g.fill();
      ln(0,-0.4,0,-4.4,1.5); ln(-3,0,-4.4,-3.4,1.3); ln(3,0,4.4,-3.4,1.3); break;
    default: dot(0,0,4);
  }
  g.restore();
}
// Unit silhouettes as sprites, drawn once and kept. Keyed by unit and colour;
// there are only ever a couple of dozen, so the cache never needs evicting.
const SPRITES=new Map();
function iconSprite(key,col){
  const k=key+'|'+col;
  if(SPRITES.has(k)) return SPRITES.get(k);
  let cv2=null;
  try{
    cv2=document.createElement('canvas');
    cv2.width=64; cv2.height=64;
    const g=cv2.getContext('2d');
    g.translate(32,32);
    unitIcon(g,key,56,col);
  }catch(e){ cv2=null; }                 // no offscreen canvas: markers lose their icon, nothing else
  SPRITES.set(k,cv2);
  return cv2;
}
function iconDataURL(key,size,col){
  const cv2=document.createElement('canvas');
  cv2.width=size; cv2.height=size;
  const g=cv2.getContext('2d');
  g.translate(size/2,size/2);
  unitIcon(g,key,size*.92,col);
  return cv2.toDataURL?cv2.toDataURL():'';
}

/* ===================== input ===================== */
const box={on:false,x0:0,y0:0,x1:0,y1:0};
let selectMode=false;      // Select button: one finger draws a box instead of panning
let ptr={down:false,moved:false,touch:false,sx:0,sy:0,pan:false,lx:0,ly:0},pinch=null,lastTap=-9,lastSq=null;
// Measured against the stage, not the canvas: a hidden canvas has no box, and
// one of the two is always hidden.
const canvasPos=e=>{ const r=el('stage').getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; };
const inMini=(px,py)=>Math.hypot(px-mini.cx,py-mini.cy)<=mini.r;
// Picking men off the field ends buy mode: the card lights up while you are
// buying and goes out the moment you touch a unit that already exists.
function clearBuying(){ if(!placing) return false; placing=null; buildPalette(); paintInfo(); return true; }
function pickSquad(wx,wy,team){
  let best=null,bd=34/Math.max(cam.s,.3);
  for(let i=0;i<squads.length;i++){
    const sq=squads[i];
    if(sq.gone||sq.team!==team||!visible(team)||!sq.seen) continue;
    const d=dist(wx,wy,sq.fx,sq.fy-6); if(d<bd){bd=d;best=sq;}
  }
  return best;
}
function onDown(e){
  unlockAudio();
  ptr.shift=!!e.shiftKey;
  if(phase==='start'||phase==='over'||paused) return;
  if(e.touches&&e.touches.length===2){
    const a=e.touches[0],b=e.touches[1];
    pinch={d:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),
      x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2};
    ptr.down=false; return;
  }
  const touch=!!e.touches,p=canvasPos(touch?e.touches[0]:e);
  ptr={down:true,moved:false,touch,sx:p.x,sy:p.y,t0:clock,
    pan:touch||e.button===2||e.button===1,rb:!touch&&e.button===2,lx:p.x,ly:p.y};
  if(building&&!ptr.rb&&!inMini(p.x,p.y)){          // drag out the line of the work
    const w0=s2w(p.x,p.y);
    drawing={x0:w0.x,y0:w0.y,x1:w0.x,y1:w0.y};
    ptr.pan=false;
  }
  if(!touch&&e.button===0&&phase==='battle'&&!inMini(p.x,p.y)){ box.on=true; box.x0=box.x1=p.x; box.y0=box.y1=p.y; }
}
function onMove(e){
  if(pinch&&e.touches&&e.touches.length===2){
    const a=e.touches[0],b=e.touches[1];
    const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    const mx=(a.clientX+b.clientX)/2,my=(a.clientY+b.clientY)/2;
    const r=cv.getBoundingClientRect();
    zoomAt(d/pinch.d,mx-r.left,my-r.top);
    cam.x+=mx-pinch.x; cam.y+=my-pinch.y;
    pinch={d,x:mx,y:my}; e.preventDefault(); return;
  }
  if(!ptr.down) return;
  const p=canvasPos(e.touches?e.touches[0]:e);
  const slop=ptr.touch?16:8;
  if(!ptr.moved&&Math.hypot(p.x-ptr.sx,p.y-ptr.sy)>slop){
    ptr.moved=true;
    // held still, then dragged - that means "draw a box", not "pan the camera"
    if(ptr.touch&&phase==='battle'&&!drawing&&!inMini(ptr.sx,ptr.sy)
       &&(selectMode||clock-ptr.t0>.26)){
      ptr.pan=false; box.on=true;
      box.x0=box.x1=ptr.sx; box.y0=box.y1=ptr.sy;
      tapLight();
    }
  }
  if(drawing){ const w1=s2w(p.x,p.y); drawing.x1=w1.x; drawing.y1=w1.y; }
  else if(ptr.moved&&ptr.pan&&!inMini(ptr.sx,ptr.sy)){ cam.x+=p.x-ptr.lx; cam.y+=p.y-ptr.ly; }
  else if(box.on){ box.x1=p.x; box.y1=p.y; }
  ptr.lx=p.x; ptr.ly=p.y; e.preventDefault();
}
function onUp(){
  if(pinch){ pinch=null; return; }
  if(!ptr.down) return; ptr.down=false;
  const px=ptr.moved?ptr.lx:ptr.sx,py=ptr.moved?ptr.ly:ptr.sy;
  const team=cmdTeam();
  if(drawing){                                     // finish the line
    const d=drawing; drawing=null;
    if(team) orderBuild(team,building,d.x0,d.y0,d.x1,d.y1);
    box.on=false; return;
  }
  if(ptr.rb){                                   // right click cancels: drop the selection
    if(!ptr.moved){
      if(building){ building=null; drawing=null; document.querySelectorAll('.bld').forEach(b=>b.classList.remove('on')); toast('Building off'); }
      else if(placing){ placing=null; buildPalette(); toast('Order mode'); }
      else if(remMode){ remMode=false; el('remBtn').classList.remove('on'); toast('Remove off'); }
      else if(selected.length){ selected=[]; toast('Selection cleared'); }
    }
    box.on=false; return;
  }
  if(inMini(ptr.sx,ptr.sy)){
    lookAt(clamp((px-mini.x)/mini.s,0,W),clamp((py-mini.y)/mini.s,0,H));
    box.on=false; return;
  }
  if(box.on&&ptr.moved&&phase==='battle'&&team){
    const x0=Math.min(box.x0,box.x1),x1=Math.max(box.x0,box.x1);
    const y0=Math.min(box.y0,box.y1),y1=Math.max(box.y0,box.y1);
    selected=squads.filter(sq=>{
      if(sq.gone||sq.team!==team||sq.routed) return false;
      const sx=w2sx(sq.fx),sy=w2sy(sq.fy);
      return sx>=x0&&sx<=x1&&sy>=y0&&sy<=y1; });
    box.on=false;
    if(selected.length){ clearBuying(); tapLight(); toast(selected.length+' units selected'); }
    return;
  }
  box.on=false;
  if(ptr.moved) return;
  // no double-tap zoom: tapping the field places and orders, zooming is done
  // with the +/- buttons, pinch, or by tapping the minimap
  const w=s2w(px,py);
  if(phase==='battle'&&!team){
    const any=pickSquad(w.x,w.y,'blue')||pickSquad(w.x,w.y,'red');
    selected=any?[any]:[]; return;
  }
  if(!team) return;
  if(phase==='deploy'){
    if(remMode){                                     // pick things back up only when asked
      const grab=34/Math.max(cam.s,.18);
      let own=null,bd=grab;
      for(const sq of squads){
        if(sq.gone||sq.team!==team) continue;
        const d=dist(w.x,w.y,sq.fx,sq.fy); if(d<bd){bd=d;own=sq;}
      }
      if(own){
        for(const s of own.soldiers) s.alive=false;
        squads=squads.filter(s=>s!==own); soldiers=soldiers.filter(s=>s.sq!==own);
        spent[team]-=own.cost; paintPoints();
        toast(own.t.name+' withdrawn · '+coinsLeft(team).toLocaleString()+' coins'); return;
      }
      const mn=mines.filter(m=>m.team===team&&dist(w.x,w.y,m.x,m.y)<grab);
      if(mn.length){ mines=mines.filter(m=>mn.indexOf(m)<0); spent[team]-=MINE.cost; paintPoints();
        toast('Mines lifted'); return; }
      const wl=walls.find(x=>x.team===team&&!x.dead&&Math.abs(w.x-x.x)<grab*.4&&Math.abs(w.y-x.y)<x.len/2);
      if(wl){ walls=walls.filter(x=>x!==wl); spent[team]-=WALL.cost; paintPoints(); toast('Sandbags cleared'); return; }
      toast('Nothing of yours there'); return;
    }
    const n0=squads.length,w0=walls.length,m0=mines.length;
    place(team,w.x,w.y);
    if(squads.length>n0){
      const nu=squads[squads.length-1];
      pings.push({x:w.x,y:w.y,t:.9});
      toast(nu.t.name+' deployed · '+coinsLeft(team).toLocaleString()+' coins left');
    } else if(walls.length>w0) toast('Sandbags placed · '+coinsLeft(team).toLocaleString()+' coins left');
    else if(mines.length>m0) toast('Mines laid · '+coinsLeft(team).toLocaleString()+' coins left');
    return;
  }
  if(phase==='battle'){
    if(rallySet){                                  // planting the rally flag
      rally[team]={x:w.x,y:w.y};
      rallySet=false; el('rBtn').classList.remove('on');
      pings.push({x:w.x,y:w.y,t:1.2});
      toast('Rally point set - reinforcements will form up here'); return;
    }
    // Tapping one of your own units always means "select this one", even with a
    // card held: buying is what you do with empty ground, and it drops the card
    // rather than dropping a squad on top of the men already standing there.
    const own=pickSquad(w.x,w.y,team);
    if(own&&!own.routed){
      // tap again on the same unit to take every one of its kind on screen -
      // the fastest way to gather a force without a mouse
      if(clock-lastTap<.42&&lastSq===own){
        selected=squads.filter(q=>!q.gone&&!q.routed&&q.team===team&&q.type===own.type
          &&q.fx>vx0&&q.fx<vx1&&q.fy>vy0&&q.fy<vy1);
        tapLight();
        toast('All '+own.t.name+' on screen · '+selected.length+' units');
        lastTap=-9; lastSq=null; return;
      }
      lastTap=clock; lastSq=own;
      selected=[own]; tapLight();
      if(clearBuying()) toast(own.t.name+' selected · buying off');
      return;
    }
    if(placing){                                   // reinforcements march to where you point
      const sq0=squads.length;
      place(team,w.x,w.y);
      if(squads.length>sq0){
        const nu=squads[squads.length-1];
        toast(nu.t.name+' rolling out · '+coinsLeft(team).toLocaleString()+' coins left');
      }
      paintPoints(); return;
    }
    if(!selected.length){ toast('Select a unit first'); return; }
    const foe=pickSquad(w.x,w.y,other(team));
    const add=queueing||ptr.shift;                 // add to the plan, or replace it
    if(foe){ issue(selected,'attack',0,0,foe,add); toast((add?'Added: ':'Orders: ')+'engage the '+foe.t.name); }
    else {
      const ec=enemyCastle(team);
      if(ec&&!ec.dead&&castleDist(ec,w.x,w.y)<30){
        issue(selected,'castle'); toast('Orders: assault the HQ');
      } else { issue(selected,'move',w.x,w.y,null,add);
        toast(add?'Added to the plan':'Orders: advance'); }
    }
  }
}
for(const surf of [cv,ovCv]){ if(!surf) continue;
  surf.addEventListener('mousedown',onDown);
window.addEventListener('mousemove',onMove);
window.addEventListener('mouseup',onUp);
  surf.addEventListener('touchstart',onDown,{passive:false});
  surf.addEventListener('touchmove',onMove,{passive:false});
  surf.addEventListener('touchend',onUp);
  surf.addEventListener('touchcancel',()=>{ptr.down=false;pinch=null;box.on=false;});
  surf.addEventListener('contextmenu',e=>e.preventDefault());
  surf.addEventListener('wheel',e=>{ const p=canvasPos(e); zoomAt(e.deltaY<0?1.12:.89,p.x,p.y); e.preventDefault(); },{passive:false});
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(!paused&&(selected.length||placing)){ selected=[]; placing=null; buildPalette(); return; }
    paused?closeMenu():openMenu(); return;
  }
  if(phase!=='battle'||paused) return;
  const team=cmdTeam(); if(!team) return;
  const k=e.key.toLowerCase();
  if(k==='h') issue(selected,'hold');
  else if(k==='c') issue(selected,'charge');
  else if(k==='r') issue(selected,'back');
  else if(k==='f') cycleForm();
  else if(k==='a') selected=squads.filter(s=>s.team===team&&!s.gone&&!s.routed);
  else if(k>='1'&&k<='9'){
    if(e.ctrlKey||e.metaKey){ bindLegion(+k); e.preventDefault(); }   // ctrl always re-names
    else selectLegion(+k);                                            // a free number takes the selection
  }
  else if(k==='q') laneCmd(0);
  else if(k==='w') laneCmd(1);
  else if(k==='e') laneCmd(2);
  else if(k==='p') toggleFull();
  else if(k===' '){ speed=speed?0:1; syncSpeed(); e.preventDefault(); }
});

/* ---- legions & lanes ---- */
function bindLegion(n){
  if(!selected.length){ toast('Select units first, then Ctrl + '+n); return; }
  for(const sq of selected) sq.legion=n;
  bindMode=false; el('bind').classList.remove('on');
  toast(selected.length+' units are now group '+n+' — press '+n+' to call them');
}
function selectLegion(n){
  const team=viewTeam();
  const list=squads.filter(s=>s.team===team&&!s.gone&&!s.routed&&s.legion===n);
  // pressing a free number with units selected names that group
  if((bindMode||!list.length)&&selected.length&&cmdTeam()){ bindLegion(n); return; }
  if(!list.length){ toast('Group '+n+' is empty — select units, then press '+n); return; }
  selected=list; clearBuying();
  let men=0; for(const s of list) men+=s.alive;
  toast('Group '+n+' · '+list.length+' units · '+men+' effectives');
}
function laneCmd(lane){
  if(!selected.length||!cmdTeam()){ lookAt(W/2,laneY[lane]); toast(LANE_NAME[lane]); return; }
  sendToLane(selected,lane);
  toast('Orders: move to the '+LANE_NAME[lane].toLowerCase());
}
document.querySelectorAll('.leg').forEach(b=>b.onclick=()=>selectLegion(+b.dataset.leg));
document.querySelectorAll('.lane').forEach(b=>b.onclick=()=>laneCmd(+b.dataset.lane));
function setBuy(open,quiet){                        // the unit bar is permanent now
  const dep=phase==='deploy';
  el('pal').style.display='flex';
  el('buyRow').style.display='flex';
  el('autoDep').style.display=dep?'block':'none';
  el('remBtn').style.display=dep?'block':'none';
  el('clearDep').style.display=dep?'block':'none';
  if(!dep&&remMode){ remMode=false; el('remBtn').classList.remove('on'); }
  paintPoints();
}
document.querySelectorAll('.bld').forEach(b=>b.onclick=()=>{
  const team=cmdTeam()||viewTeam(),k=b.dataset.b;
  if(lvl[team]<WORKLVL[k]){ toast(WORKNAME[k]+' needs level '+WORKLVL[k]); return; }
  building=building===k?null:k;
  document.querySelectorAll('.bld').forEach(x=>x.classList.toggle('on',x===b&&building));
  toast(building?('Drag a line to lay '+WORKNAME[k]):'Building off');
});
el('bldOff').onclick=()=>{
  building=null; drawing=null;
  document.querySelectorAll('.bld').forEach(b=>b.classList.remove('on'));
  toast('Building off');
};
el('bind').onclick=()=>{
  if(!selected.length){ toast('Select units first, then Bind'); return; }
  bindMode=!bindMode; el('bind').classList.toggle('on',bindMode);
  if(bindMode) toast('Now tap a number 1–9 to name this group');
};

/* ---- controls ---- */
document.querySelectorAll('.sz').forEach(b=>b.onclick=()=>{
  const team=phase==='deploy'?depTeam:(cmdTeam()||viewTeam());
  const v=+b.dataset.size;
  if(v>maxSquad(team)){ toast('Squads of '+v+' need level '+SIZE_LVL[v]); return; }
  troopSize=v;
  paintSizes(); buildPalette(); paintInfo();
  toast('Ordering '+troopSize+' at a time');
});
document.querySelectorAll('#startVeil [data-mode]').forEach(b=>{
  b.onclick=()=>{ mode=b.dataset.mode;
    document.querySelectorAll('#startVeil [data-mode]').forEach(x=>x.classList.toggle('on',x===b)); };
});
function buildCapPick(){
  const box=el('capPick'); box.innerHTML='';
  const opts=[[0,'By rank'],[100,'100'],[300,'300'],[600,'600'],[1000,'1000']];
  for(const [v,label] of opts){
    const b=document.createElement('button');
    b.className=v===capChoice?'on':'';
    b.innerHTML='<b>'+label+'</b>';
    b.onclick=()=>{ capChoice=v; buildCapPick();
      toast(v?('Field limit '+v+' a side'):'Field limit grows with rank'); };
    box.appendChild(b);
  }
}
function buildMapPick(){
  const box=el('mapPick'); box.innerHTML='';
  for(const k of Object.keys(MAPS)){
    const b=document.createElement('button');
    b.className=k===mapType?'on':'';
    b.dataset.map=k;
    b.innerHTML='<b>'+MAPS[k].name.replace(' ','<br>')+'</b>';
    b.onclick=()=>{ mapType=k; write('map',k); buildMapPick(); };
    box.appendChild(b);
  }
  const d=el('mapNote'); if(d) d.textContent=MAPS[mapType].blurb;
}
function buildHourPick(){
  const box=el('hourPick'); if(!box) return;
  box.innerHTML='';
  for(const h of START_HOURS){
    const b=document.createElement('button');
    b.className=h.key===hourKey?'on':'';
    b.innerHTML='<b>'+h.name+'</b>';
    b.onclick=()=>{ hourKey=h.key; write('hour',h.key); buildHourPick(); };
    box.appendChild(b);
  }
  const n=el('hourNote');
  if(n) n.textContent=(START_HOURS.find(h=>h.key===hourKey)||START_HOURS[1]).blurb;
}
function buildDiffPick(){
  const box=el('diffPick'); box.innerHTML='';
  for(const k of Object.keys(DIFF)){
    const b=document.createElement('button');
    b.className=k===diff?'on':'';
    b.innerHTML='<b>'+DIFF[k].name+'</b>';
    b.onclick=()=>{ diff=k; write('diff',k); buildDiffPick(); };
    box.appendChild(b);
  }
  const n=el('diffNote'); if(n) n.textContent=DIFF[diff].note;
}
buildDiffPick(); buildHourPick();
buildMapPick(); buildCapPick();
document.querySelectorAll('#startVeil [data-budget]').forEach(b=>b.onclick=()=>beginGame(+b.dataset.budget));
el('shareEnd').onclick=shareGame;
el('again').onclick=()=>{ el('endVeil').style.display='none'; el('startVeil').style.display='flex'; phase='start'; };
loadProf();
SAVES.prune(); refreshLoadButton();
paintViewBtn();
if(viewMode==='3d') setView('3d',true);   // quietly: a device that cannot, just does not
el('pname').value=prof.name;
el('pname').oninput=()=>{ prof.name=(el('pname').value||'Commander').slice(0,18); saveProf(); };
paintProf();
el('passGo').onclick=()=>{ el('passVeil').style.display='none'; };
el('surYes').onclick=()=>{
  el('surVeil').style.display='none'; speed=1; syncSpeed();
  finish(other(viewTeam()),'surrender');
};
el('surNo').onclick=()=>{
  el('surVeil').style.display='none'; speed=1; syncSpeed();
  toast('No surrender — hold to the last round');
};
el('autoDep').onclick=()=>{ clearField(depTeam); autoDeploy(depTeam,budget); };
el('rotBtn').onclick=()=>{
  const i=(ANGS.indexOf(placeAng)+1)%ANGS.length;
  placeAng=ANGS[i];
  el('rotBtn').textContent='Lay '+ANGNAME[i];
  toast('Works laid '+ANGNAME[i]);
};
el('remBtn').onclick=()=>{
  remMode=!remMode;
  el('remBtn').classList.toggle('on',remMode);
  toast(remMode?'Remove mode — tap your own units to take them back'
               :'Deploy mode — tap the ground to place');
};
el('clearDep').onclick=()=>{ clearField(depTeam); toast('Everything cleared'); };
el('startBattle').onclick=readyDeploy;
el('done').onclick=()=>{ if(mode==='hot'&&hot.stage==='orders') endOrders(); };
el('zin').onclick=()=>zoomAt(1.25);
el('zout').onclick=()=>zoomAt(.8);
el('zfit').onclick=fit;
function toggleFull(){
  const d=document.documentElement;
  if(!document.fullscreenElement){ if(d.requestFullscreen) d.requestFullscreen().catch(()=>{}); }
  else if(document.exitFullscreen) document.exitFullscreen().catch(()=>{});
  setTimeout(resize,180);
}
function shareGame(){
  const url=location.href.split('#')[0];
  const data={title:'Iron Front',text:'Take command — Iron Front',url};
  if(navigator.share){ navigator.share(data).catch(()=>{}); return; }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(()=>toast('Link copied — send it to a friend'))
      .catch(()=>prompt('Copy this link',url));
    return;
  }
  prompt('Copy this link',url);
}
el('shareBtn').onclick=shareGame;
el('fsBtn').onclick=toggleFull;
el('menuBtn').onclick=()=>paused?closeMenu():openMenu();
el('mResume').onclick=closeMenu;
el('mRestart').onclick=()=>{ closeMenu(); beginGame(budget); };
el('mSave').onclick=()=>openSaves('save');
el('mLoad').onclick=()=>openSaves('load');
el('sLoad').onclick=()=>openSaves('load');
el('saveNew').onclick=()=>doSave(null);
el('saveClose').onclick=closeSaves;
el('mNew').onclick=()=>{ closeMenu(); phase='start';
  el('endVeil').style.display='none'; el('startVeil').style.display='flex'; };
el('selBtn').onclick=()=>{ selectMode=!selectMode;
  el('selBtn').classList.toggle('on',selectMode);
  toast(selectMode?'Drag to select · two fingers still pan':'Drag pans again'); };
el('mShake').onclick=()=>{ prof.shake=prof.shake===false; saveProf();
  el('mShake').textContent='Screen shake: '+(prof.shake===false?'off':'on'); };
el('mHaptics').onclick=()=>{ prof.haptics=!prof.haptics; saveProf();
  el('mHaptics').textContent='Vibration: '+(prof.haptics?'on':'off'); };
el('mView').onclick=()=>{ setView(viewMode==='3d'?'top':'3d'); };
el('mQuality').onclick=()=>{ qualityLock=true; quality=quality?0:1;
  write('gfx',quality?'high':'fast');
  el('mQuality').textContent='Graphics: '+(quality?'high':'fast'); };
el('qBtn').onclick=()=>{ queueing=!queueing;
  el('qBtn').classList.toggle('on',queueing);
  toast(queueing?'Queue: orders add to the plan':'Queue off'); };
el('rBtn').onclick=()=>{ rallySet=!rallySet;
  el('rBtn').classList.toggle('on',rallySet);
  toast(rallySet?'Tap the ground to set the rally point':'Rally off'); };
el('mSound').onclick=()=>{ unlockAudio(); toggleMuted();
  el('mSound').textContent='Sound: '+(isMuted()?'off':'on'); };
document.querySelectorAll('.spd button').forEach(b=>{
  if(!b.dataset.spd) return;
  b.onclick=()=>{ speed=+b.dataset.spd; syncSpeed(); };
});
function syncSpeed(){ document.querySelectorAll('.spd button').forEach(b=>{
  if(b.dataset.spd) b.classList.toggle('on',+b.dataset.spd===speed); }); }
const FORMS=['line','wedge','square','loose'];
const FORMLABEL={line:'Line',wedge:'Wedge',square:'Square',loose:'Loose'};
function cycleForm(){
  if(!selected.length){ toast('Select a unit first'); return; }
  const nx=FORMS[(FORMS.indexOf(selected[0].formation)+1)%FORMS.length];
  for(const sq of selected){ sq.formation=nx; footprint(sq); }
  document.querySelector('[data-o="form"]').textContent=FORMLABEL[nx];
  toast(FORMLABEL[nx]+' formation'+(nx==='loose'?' — spreads out against shellfire':''));
}
el('deck').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b||!b.dataset.o) return;
  const team=cmdTeam();
  if(!team){ toast('Wait for your orders phase'); return; }
  const o=b.dataset.o;
  if(o==='all'){ selected=squads.filter(s=>s.team===team&&!s.gone&&!s.routed);
    clearBuying(); toast(selected.length+' units selected'); return; }
  if(o==='form'){ cycleForm(); return; }
  if(!selected.length){ toast('Select a unit first'); return; }
  if(o==='keep'){
    const ec=enemyCastle(team);
    if(!ec||ec.dead){ toast('That HQ is already destroyed'); return; }
    issue(selected,'castle'); toast('Orders: assault the '+other(team)+' HQ'); return;
  }
  issue(selected,o);
  toast(o==='hold'?'Orders: hold':o==='charge'?'Orders: assault!':'Orders: fall back');
});
window.addEventListener('resize',resize);
if(window.visualViewport) window.visualViewport.addEventListener('resize',resize);
document.addEventListener('visibilitychange',()=>{
  // Backgrounded audio is a bug on a phone, not a feature: silence it even
  // outside a battle, when there is no pause menu to open.
  if(document.hidden){ suspendAudio(); autosave(); if(phase==='battle') openMenu(); }
  else if(!paused) resumeAudio();
});
// small debug hook (harmless in normal play)
try{ window.__lvl=(t,n)=>{ lvl[t]=n; buildPalette(); };
     window.__buy=(k,x,y)=>{ const t=cmdTeam()||viewTeam(); placing=k; place(t,x,y); };
     window.__works=()=>{ let tr=0,wi=0; for(let i=0;i<tGrid.length;i++){ if(tGrid[i]&TRENCHED) tr++; if(tGrid[i]&WIRED) wi++; }
       return {walls:walls.filter(w=>!w.dead&&!w.rubble).length,mines:mines.length,trenchCells:tr,wireCells:wi}; };
     window.__rank=(l)=>rankOf(l).name;
     window.__landuse=()=>{
       if(!landuse) return {parcels:0};
       const by={};
       for(const p of landuse.parcels) by[p.use]=(by[p.use]||0)+1;
       const e={};
       for(const p of landuse.parcels) e[p.edge]=(e[p.edge]||0)+1;
       return {parcels:landuse.parcels.length,uses:by,edges:e}; };
     window.__stuckSq=()=>{                      // formation ANCHORS sitting in solid ground
       let n=0; const by={};
       for(const q of squads){ if(q.gone||q.alive<=0||q.t.air) continue;
         const foot=!q.t.vehicle&&q.t.kind!=='siege';
         if(blockedFor(q.fx,q.fy,foot,q.team)){ n++; by[q.type]=(by[q.type]||0)+1; } }
       return {squads:squads.filter(q=>!q.gone).length,anchorsInSolid:n,byKind:by}; };
     window.__squadlap=()=>{                     // formations sitting inside one another
       const L=squads.filter(q=>!q.gone&&q.alive>0);
       let pairs=0,worst=0;
       for(let i=0;i<L.length;i++) for(let j=i+1;j<L.length;j++){
         const a=L[i],b=L[j];
         if(!!a.t.air!==!!b.t.air) continue;
         const md=(a.fw+a.fd)*.25+(b.fw+b.fd)*.25;
         const d=Math.hypot(a.fx-b.fx,a.fy-b.fy);
         if(d<md*.55){ pairs++; const f=(md*.55-d)/(md*.55); if(f>worst) worst=f; } }
       return {squads:L.length,pairs,worstFrac:+worst.toFixed(3)}; };
     window.__stuck=()=>{                        // bodies standing where they may not stand
       const out={live:0,inSolid:0,byKind:{}};
       for(const s of soldiers){ if(!s.alive||s.sq.t.air) continue; out.live++;
         const foot=!s.sq.t.vehicle&&s.sq.t.kind!=='siege';
         if(blockedFor(s.x,s.y,foot,s.sq.team)){ out.inSolid++;
           out.byKind[s.sq.type]=(out.byKind[s.sq.type]||0)+1; } }
       return out; };
     window.__overlap=()=>{                      // are bodies standing inside each other?
       let live=0,pairs=0,worst=0;
       const a=soldiers.filter(s=>s.alive); live=a.length;
       for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++){
         const p=a[i],q=a[j]; if(!!p.sq.t.air!==!!q.sq.t.air) continue;
         const md=radOf(p)+radOf(q), d=Math.hypot(p.x-q.x,p.y-q.y);
         if(d<md-.001){ pairs++; const f=(md-d)/md; if(f>worst) worst=f; } }
       return {live,pairs,worstFrac:+worst.toFixed(3)}; };
     window.__diff=(d)=>{ diff=d; return dset(); };
     window.__cap=(v)=>{ capChoice=v; buildCapPick&&buildCapPick(); return capOf('blue'); };
     window.__trees=()=>{ let wc=0; for(let i=0;i<woodN.length;i++) if(woodN[i]>0) wc++;
       return {total:trees.length,down:treesDown,falling:falling.length,woodCells:wc}; };
     window.__fell=(x,y,r)=>{ const l=treesNear(x,y,r).slice();
       for(const t of l) fellTree(t,0); return l.length; };
     window.__wood=(x,y)=>!!(terrainAt(x,y)&WOOD);
     window.__cell=(x,y)=>T.cellAt(terrain,x,y);
     window.__worldview=()=>worldView();
     // A renderer that answers like the real one and draws nothing, so the
     // harness can run the whole 3D frame path - the overlay, the chips, the
     // minimap on its own canvas - on a machine with no graphics card.
     window.__fake3d=(on)=>{
       if(!on){ viewMode='top'; gfx3=null;
         cv.style.display='block';
         if(glCv) glCv.style.display='none';
         if(ovCv) ovCv.style.display='none';
         resize(); return false; }
       gfx3={ resize(){}, dispose(){},
         frame(){ if(on==='break') throw new TypeError("Cannot read properties of undefined (reading 'lvl')"); },
         screenToWorld:(px,py)=>({x:(px-cam.x)/cam.s,y:(py-cam.y)/cam.s}),
         worldToScreen:(x,y)=>({x:x*cam.s+cam.x,y:y*cam.s+cam.y,behind:false}) };
       viewMode='3d';
       cv.style.display='none';
       if(glCv) glCv.style.display='block';
       if(ovCv) ovCv.style.display='block';
       resize(); return true;
     };
     window.__terrain=()=>terrain;
     window.__name=(x,y)=>groundName(x,y);
     window.__los=(x0,y0,x1,y1,e)=>T.sightClear(terrain,x0,y0,x1,y1,e);
     window.__mob=(k)=>mobilityOf(UNITS[k]);
     window.__ground=(key,pure)=>{ const bit=T.GROUND[key].bit; let n=0,fx=-1,fy=-1;
       for(let i=0;i<tGrid.length;i++){ if(!(tGrid[i]&bit)) continue; n++;
         if(fx<0&&(!pure||tGrid[i]===bit)){ fx=(i%TW)*TG+TG/2; fy=((i/TW)|0)*TG+TG/2; } }
       return {n,x:fx,y:fy}; };
     window.__churn=(x,y,v)=>{ terrain.churn[gi(x,y)]=v; return churnAt(x,y); };
     window.__raze=(x,y)=>{ const n=bGrid[gi(x,y)]; if(n<0) return null;
       const b=buildings[n]; collapse(b); return {x:b.x,y:b.y,w:b.w,h:b.h}; };
     window.__aBuilding=()=>{ for(const b of buildings) if(!b.dead&&!b.bunker) return {x:b.x,y:b.y}; return null; };
     window.__aTree=()=>{ for(const t of trees) if(!t.dead) return {x:t.x,y:t.y,s:t.s}; return null; };
     window.__roads=()=>({ms:roadMs,routes:routes.length,towns:towns.length,
       wetRoad:(()=>{ let n=0; for(let i=0;i<tGrid.length;i++) if((tGrid[i]&ROAD)&&(tGrid[i]&(WATER|FORD))) n++; return n; })(),
       cells:(()=>{ let n=0; for(let i=0;i<tGrid.length;i++) if(tGrid[i]&ROAD) n++; return n; })(),
       crossings:routes.reduce((n,r)=>n+r.crossings.length,0),
       connected:allConnected([].concat(castles.map(c=>({x:c.x,y:c.y})),
         towns.map(t=>({x:t.x,y:t.y})),bases.map(b=>({x:b.x,y:b.y}))),routes)});
     window.__wet=(x,y)=>moistureAt(x,y);
     window.__routes=()=>routes.map(r=>({from:r.from,to:r.to,
       x0:Math.round(r.pts[0][0]),x1:Math.round(r.pts[r.pts.length-1][0]),
       minx:Math.round(Math.min(...r.pts.map(q=>q[0]))),
       maxx:Math.round(Math.max(...r.pts.map(q=>q[0]))),n:r.pts.length}));
     window.__river=(y)=>riverXAt(y);
     window.__land=()=>{ let fc=0; for(let i=0;i<tGrid.length;i++) if(tGrid[i]&FIELD) fc++;
       const kinds={}; for(const p of props) kinds[p.kind]=(kinds[p.kind]||0)+1;
       const ft={}; for(const f of feats) ft[f.type]=(ft[f.type]||0)+1;
       const rots=new Set(buildings.filter(b=>b.home).map(b=>b.rot.toFixed(3)));
       return {props:kinds,feats:ft,fieldCells:fc,homes:buildings.filter(b=>b.home).length,
               barns:buildings.filter(b=>b.barn).length,distinctHouseAngles:rots.size}; };
     window.__civs=()=>{ const st={}; for(const c of civs) if(c.alive) st[c.st]=(st[c.st]||0)+1;
       return {alive:civs.filter(c=>c.alive).length,farmers:civs.filter(c=>c.alive&&c.job==='farmer').length,states:st}; };
     window.__shoot=(x,y,r)=>{ noteGunfire(x,y); killCivsNear(x,y,r||60); return civs.filter(c=>c.alive).length; };
     window.__killAllCivs=()=>{ for(const c of civs) c.alive=false; return 0; };
     window.__aHome=()=>{ const h=buildings.find(b=>b.home); return h?{x:h.x,y:h.y}:null; };
     window.__relief=()=>{ let lo=1,hi=0,sum=0;
       for(let i=0;i<hGrid.length;i++){ const h=hGrid[i]; if(h<lo)lo=h; if(h>hi)hi=h; sum+=h; }
       let asym=0;
       for(let gy=0;gy<TH;gy++) for(let gx=0;gx<TW;gx++){
         const a=hGrid[gy*TW+gx],b=hGrid[(TH-1-gy)*TW+(TW-1-gx)];
         asym=Math.max(asym,Math.abs(a-b)); }
       let mirror=0;
       for(let gy=0;gy<TH;gy++) for(let gx=0;gx<TW;gx++){
         const a=hGrid[gy*TW+gx],b=hGrid[gy*TW+(TW-1-gx)];
         mirror=Math.max(mirror,Math.abs(a-b)); }
       const lv=[0,0,0,0]; for(let i=0;i<eGrid.length;i++) lv[eGrid[i]]++;
       return {lo:+lo.toFixed(3),hi:+hi.toFixed(3),mean:+(sum/hGrid.length).toFixed(3),
         rotationalError:+asym.toFixed(6),mirrorError:+mirror.toFixed(3),
         elevSpread:lv,lanes:laneY.map(Math.round),
         riverSpan:[Math.round(Math.min(...riverRow)),Math.round(Math.max(...riverRow))]}; };
     window.__place=()=>{ const by={};
       for(const f of feats){ const k=f.type; (by[k]||(by[k]=[])).push({h:heightAt(f.x,f.y),s:slopeAt(f.x,f.y)}); }
       const out={};
       for(const k in by){ const a=by[k];
         out[k]={n:a.length,h:+(a.reduce((t,v)=>t+v.h,0)/a.length).toFixed(3),
                 slope:+(a.reduce((t,v)=>t+v.s,0)/a.length).toFixed(4)}; }
       let rh=0,rs=0; for(let i=0;i<hGrid.length;i++){ rh+=hGrid[i]; }
       for(let gy=1;gy<TH-1;gy+=2) for(let gx=1;gx<TW-1;gx+=2) rs+=slopeAt(gx*TG,gy*TG);
       out._map={h:+(rh/hGrid.length).toFixed(3),slope:+(rs/(((TH-2)/2|0)*((TW-2)/2|0))).toFixed(4)};
       return out; };
     window.__shake=()=>shakeNow();
     window.__nsel=()=>selected.length;
     window.__cam=()=>({x:cam.x,y:cam.y,s:cam.s});
     window.__selMode=(v)=>{ selectMode=!!v; return selectMode; };
     window.__hash=()=>stateHash();
     window.__rng=()=>seed();
     window.__save=(id)=>SAVES.put(id||null,saveMeta(false),snapshot());
     window.__load=(id)=>{ const r=SAVES.get(id); if(!r) return false; restoreBattle(r.state); return true; };
     window.__saves=()=>SAVES.list().map(r=>r.id);
     window.__dropSave=(id)=>{ SAVES.drop(id); return SAVES.list().length; };
     window.__saveBytes=()=>JSON.stringify(snapshot()).length;
     window.__tick=(n)=>{ for(let i=0;i<n;i++) tick(SIM); return stateHash(); };
     window.__seed=(v)=>{ matchSeed=v; return matchSeed; };
     window.__prof=()=>prof;
     window.__bases=()=>bases.map(b=>({t:b.team,n:b.name,x:Math.round(b.x),y:Math.round(b.y),cap:+b.cap.toFixed(2)}));
     window.__size=(n)=>{ troopSize=n; paintSizes&&paintSizes(); return troopSize; };
     window.__build=(what,x1,y1,x2,y2)=>{ building=what; return orderBuild(cmdTeam()||viewTeam(),what,x1,y1,x2,y2); };
     window.__group=(n)=>{ selectLegion(n); return {selected:selected.length,legions:squads.filter(q=>!q.gone&&q.legion===n).length}; };
     window.__sel=(ty)=>{ selected=squads.filter(q=>!q.gone&&q.team===viewTeam()&&(!ty||q.type===ty)); return selected.length; };
     window.__dbg=()=>({lvl,xp,coins:{b:coinsLeft('blue'),r:coinsLeft('red')},cap:{b:capOf('blue'),r:capOf('red')},
  squads:squads.filter(s=>!s.gone).map(s=>({t:s.team,ty:s.type,x:Math.round(s.fx),y:Math.round(s.fy),
    o:s.order.kind,n:s.alive,seen:s.seen}))}); }catch(e){}
// ---- hooks the native shell calls into (see src/platform/native.js) ----
window.__menu  = () => { if(el('menuVeil').style.display==='flex') closeMenu(); else openMenu(); };
window.__pause = () => { if(phase==='battle' && !paused) openMenu(); };

{ // Stamp the build into the start panel. Without it there is no way to tell
  // a change that did not work from a browser serving a cached bundle.
  const b=el('buildStamp');
  if(b) b.textContent='BUILD '+(typeof __BUILD__!=='undefined'?__BUILD__:'dev'); }
genTerrain(); resize(); buildPalette(); paintInfo(); requestAnimationFrame(frame);
}
