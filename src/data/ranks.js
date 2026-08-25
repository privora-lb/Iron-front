// The promotion ladder, from Recruit to Supreme Commander at level 1000.
export const MAXLVL=1000;
// the ladder, bottom to top
export const RANKS=[
  [1,'Recruit','Rct'],[4,'Private','Pte'],[9,'Private First Class','PFC'],[16,'Lance Corporal','LCpl'],
  [25,'Corporal','Cpl'],[38,'Sergeant','Sgt'],[55,'Staff Sergeant','SSgt'],[78,'Sergeant First Class','SFC'],
  [105,'Master Sergeant','MSgt'],[140,'Sergeant Major','SgtMaj'],[180,'Warrant Officer','WO'],
  [225,'Second Lieutenant','2Lt'],[275,'First Lieutenant','1Lt'],[330,'Captain','Capt'],
  [390,'Major','Maj'],[455,'Lieutenant Colonel','LtCol'],[525,'Colonel','Col'],
  [600,'Brigadier','Brig'],[680,'Major General','MajGen'],[765,'Lieutenant General','LtGen'],
  [855,'General','Gen'],[940,'Field Marshal','FM'],[1000,'Supreme Commander','SC']
];
export function rankOf(l){
  let r=RANKS[0];
  for(const e of RANKS){ if(l>=e[0]) r=e; else break; }
  return {name:r[1],short:r[2],from:r[0]};
}
export function nextRank(l){
  for(const e of RANKS) if(e[0]>l) return {name:e[1],at:e[0]};
  return null;
}
export const xpNeed=l=>Math.round(30+l*9+l*l*.06);
