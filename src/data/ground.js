// What the ground does to the people fighting over it.
//
// One row per thing a cell of the battlefield can BE. Every column is read by
// the simulation AND by the renderer, so what a place looks like and what it
// does to you cannot drift apart: a cell that says `wood` here slows a tank,
// hides a rifleman, stops a line of sight and draws a canopy, all off this one
// row. That connection is the whole point — terrain is believable when its
// appearance predicts its behaviour.
//
// Kept as an aligned table on purpose: balance work means reading down a
// column, so this file is exempt from the formatter (see .prettierignore).
//
//   move   multiplier on speed, one per mobility class below
//   cover  what is left of a hit taken here (1 = none, .4 = sixty percent off)
//   hide   how well it conceals you from a distant eye, 0..1
//   blind  true if it stops a line of sight passing through
//   tall   true if it takes TWO steps of height to see over, not one
//   hard   who may not enter at all: 'all', 'mounted' (anything not on foot)
//   wear   what takes it away — shellfire, fire, tracks; null if it is permanent
//   name   how a soldier standing there would say where he is

// A unit crosses ground as one of four things. `kind` in units.js is a ROLE
// (what it shoots), which is not the same question: a battle tank is kind
// 'ranged' because it fires at range, but it crosses a wire belt like the
// vehicle it is.
export const MOB={foot:0,vehicle:1,gun:2,air:3};
export const MOBNAME=['foot','vehicle','gun','air'];

/** Which of the four a unit type crosses ground as. */
export const mobilityOf=t=>t.air?MOB.air:t.kind==='siege'?MOB.gun:t.vehicle?MOB.vehicle:MOB.foot;

export const GROUND={
//                 move: foot veh  gun  air    cover  hide  blind  hard        wear        name
  road   :{bit:4096, move:[1.06,1.22,1.18,1], cover:1,   hide:0,   blind:false, hard:null,     wear:'shell', name:'on the road'},
  wood   :{bit:1,    move:[ .74, .55, .58,1], cover:.45, hide:.62, blind:true,  hard:null,     wear:'fire',  name:'in the woods'},
  crop   :{bit:2048, move:[ .88,   1,   1,1], cover:.78, hide:.45, blind:false, hard:null,     wear:'tracks',name:'in standing crops'},
  marsh  :{bit:2,    move:[ .66, .66,  .5,1], cover:1,   hide:.2,  blind:false, hard:null,     wear:null,    name:'in marsh'},
  ford   :{bit:16,   move:[ .62, .62, .45,1], cover:1,   hide:0,   blind:false, hard:null,     wear:null,    name:'at the ford'},
  rock   :{bit:4,    move:[ .72,  .6, .72,1], cover:1,   hide:.15, blind:false, hard:null,     wear:null,    name:'on rocks'},
  stone  :{bit:32,   move:[  .9,  .9,  .9,1], cover:.55, hide:.25, blind:false, hard:null,     wear:null,    name:'in the village'},
  wire   :{bit:512,  move:[ .28,  .6,  .6,1], cover:1,   hide:0,   blind:false, hard:null,     wear:'shell', name:'caught in wire'},
  trench :{bit:1024, move:[  .9, .55, .55,1], cover:.42, hide:.5,  blind:false, hard:null,     wear:null,    name:'dug into a trench'},
  rubble :{bit:8192, move:[  .7,   0, .45,1], cover:.5,  hide:.35, blind:false, hard:'mounted',wear:null,    name:'in the rubble'},
  build  :{bit:64,   move:[   1,   0,   0,1], cover:.4,  hide:.7,  blind:true,  tall:true, hard:'mounted',wear:'shell', name:'inside a building'},
  cliff  :{bit:256,  move:[   0,   0,   0,1], cover:1,   hide:.1,  blind:true,  tall:true, hard:'all',    wear:null,    name:'against a cliff'},
  water  :{bit:8,    move:[   0,   0,   0,1], cover:1,   hide:0,   blind:false, hard:'all',    wear:null,    name:'in the river'},
  scorch :{bit:128,  move:[   1,   1,   1,1], cover:1,   hide:0,   blind:false, hard:null,     wear:null,    name:'on burnt ground'}
};

// Movement is multiplicative: a muddy wired trench is all three at once, and
// the order below is the order those multipliers are applied. It is fixed
// rather than derived from the table so that the arithmetic — and therefore
// every float in the simulation — is reproducible.
export const MOVE_ORDER=['wood','crop','marsh','ford','rock','stone','wire','trench','road','rubble'];
export const COVER_ORDER=['trench','wood','crop','stone','build','rubble'];

// What a soldier is standing IN, when only one answer will do: for the info
// line, for the tactical overlay, for a legend. First match wins.
export const SURFACE_ORDER=['water','ford','cliff','build','rubble','road','stone','scorch',
                            'trench','wire','wood','crop','marsh','rock'];

// Ground a shell can turn into other ground. Kept here so the destruction pass
// has one list to read instead of a search through the engine.
export const DESTRUCTIBLE={build:'rubble',wood:'scorch',crop:'scorch',wire:null,road:null};
