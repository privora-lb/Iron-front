// Difficulty presets. b = buy interval, r = reinforce interval, p = pressure,
// e = combat edge, x = experience multiplier. `adapt` is resolved at run time.
export const DIFF={
  easy  :{name:'Easy',   b:1.8,r:2.0,p:.55,e:.82,x:.8, note:'Slow to react, cautious, hits softer'},
  normal:{name:'Normal', b:1,  r:1,  p:1,   e:1,  x:1,  note:'An even fight under the same rules'},
  hard  :{name:'Hard',   b:.68,r:.7, p:1.4, e:1.18,x:1.3,note:'Fast, aggressive, concentrates its force'},
  adapt :{name:'Adaptive',b:1, r:1,  p:1,   e:1,  x:1,  note:'Starts easy and learns — stronger every minute'}
};
