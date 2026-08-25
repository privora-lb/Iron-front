// Every unit the two nations can field, plus the order they appear in the deck.
// Kept as an aligned table on purpose: balance work means reading down a column,
// so this file is exempt from the formatter (see .prettierignore).
export const UNITS={
  rifle  :{name:'Infantry',     tag:'INFANTRY',lvl:1, sight:430,  count:30,hp:100,dmg:11,range:240,cd:.50,speed:72,armor:1.0,cost:39,kind:'ranged',
           meleeDmg:9,meleeRange:22,blurb:'The line that holds ground'},
  assault:{name:'Elite Squad',  tag:'ELITE',   lvl:2, sight:470, count:15,hp:150,dmg:23,range:210,cd:.30,speed:98,armor:.72,cost:52,kind:'ranged',
           meleeDmg:20,meleeRange:26,blurb:'Veterans — hard to kill, hit hard'},
  mg     :{name:'MG Team',     tag:'MG',      lvl:3, sight:520,aa:true,      count:4, hp:85, dmg:7, range:340,cd:.13,speed:46,armor:1.0,cost:26,kind:'ranged',
           meleeDmg:5,meleeRange:18,gap:16,blurb:'Sweeps open ground'},
  sniper :{name:'Sniper Team', tag:'SNIPERS', lvl:4,sight:820, count:2, hp:70, dmg:105,range:640,cd:4.2,speed:66,armor:1.0,cost:28,kind:'ranged',
           meleeDmg:6,meleeRange:16,gap:22,blurb:'One shot, long reach'},
  at     :{name:'AT Team',     tag:'ANTI-TANK',lvl:6,sight:470,count:4,hp:85, dmg:0, range:340,cd:3.0,speed:62,armor:1.0,cost:31,kind:'ranged',
           shell:'rocket',shellDmg:60,splash:18,av:6,meleeDmg:6,meleeRange:18,gap:20,blurb:'Kills armour, little else'},
  apc    :{name:'APC',         tag:'APC',     lvl:5,sight:560,     count:1, hp:430,dmg:24,range:52, cd:.40,speed:170,armor:.45,cost:22,kind:'cav',
           vehicle:true,av:1.6,gap:24,blurb:'Fast steel, autocannon'},
  tank   :{name:'Battle Tank', tag:'TANK',    lvl:12,sight:600,    count:1, hp:980,dmg:0, range:390,cd:3.0,speed:106,armor:.22,cost:56,kind:'ranged',
           shell:'shell',shellDmg:75,splash:36,vehicle:true,meleeDmg:45,meleeRange:28,gap:32,blurb:'Main gun, thick armour'},
  aa     :{name:'AA Team',     tag:'FLAK',    lvl:8,sight:620,aa:true,
           count:4, hp:95, dmg:30,range:560,cd:.45,speed:52,armor:1.0,cost:42,kind:'ranged',
           av:2.4,meleeDmg:6,meleeRange:18,gap:22,blurb:'Flak — rapid fire, shreds vehicles'},
  worker :{name:'Engineers',   tag:'ENGINEERS',lvl:2,sight:400,
           count:5, hp:90, dmg:6, range:120,cd:.8,speed:74,armor:1.0,cost:30,kind:'ranged',
           meleeDmg:7,meleeRange:20,gap:18,builder:true,blurb:'Five hands — they dig the works'},
  heli   :{name:'Gunship',     tag:'GUNSHIP', lvl:28,sight:780,
           count:1, hp:300,dmg:0, range:430,cd:1.5,speed:250,armor:.55,cost:110,kind:'air',
           air:true,vehicle:true,shell:'rocket',shellDmg:54,splash:26,av:2.2,gap:60,
           meleeDmg:0,meleeRange:0,blurb:'Flies over everything — only flak reaches it'},
  mortar :{name:'Mortar Team', tag:'MORTAR',  lvl:10,sight:380,  count:3, hp:95, dmg:0, range:540,cd:4.5,speed:50,armor:1.0,cost:36,kind:'siege',
           shell:'mortar',shellDmg:58,splash:48,minRange:110,gap:26,meleeDmg:5,meleeRange:17,blurb:'Drops HE behind cover'},
  howitzer:{name:'Howitzer',   tag:'HOWITZER',lvl:16,sight:360,count:2, hp:280,dmg:0, range:920,cd:8.5,speed:36,armor:.85,cost:96,kind:'siege',
           shell:'shell',shellDmg:125,splash:82,minRange:260,gap:46,vehicle:true,meleeDmg:4,meleeRange:17,blurb:'Long guns, wide blast'},
  mlrs   :{name:'Rocket Battery',tag:'ROCKETS',lvl:20,sight:360,count:1,hp:250,dmg:0, range:800,cd:13,speed:42,armor:.85,cost:78,kind:'siege',
           shell:'rocket',shellDmg:58,splash:62,salvo:7,minRange:220,gap:46,vehicle:true,meleeDmg:4,meleeRange:17,blurb:'Salvo — saturates a grid square'}
};
export const PAL_ORDER=['rifle','assault','worker','sniper','at','aa','heli','tank','mortar','mlrs','howitzer','mg','apc'];

// Men (or vehicles) per model on the field, and the rank gates on formation size.
export const PERMODEL={rifle:1.3,assault:3.5,worker:6,mg:6.5,sniper:14,at:8,aa:10.5,heli:110,
                mortar:12,apc:22,tank:56,howitzer:48,mlrs:78};
export const SIZE_LVL={1:1,10:1,20:5,30:12,40:22,50:35};   // bigger formations come with rank
