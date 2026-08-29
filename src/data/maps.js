// The theatres. `water` drives terrain generation; `pal`/`mottle` drive the
// bake; `veg` decides how damp ground has to be before a tree will grow on it
// and how thickly they come in once it is. That pair is most of what separates
// a river valley from a mountain shoulder without either being drawn by hand.
//
// `split`, where a map has one, names the two countries the river divides. It
// is a LOOK and nothing more: the height field, the cover and the vegetation
// density stay rotationally symmetric, because a battlefield that gives one
// commander thicker woods than the other is decided by the map rather than by
// the fight. Snow on one bank and pasture on the other changes what you see,
// never what it costs you to cross it.
export const MAPS={
  ultimate:{name:'Ultimate X War',water:'river',
    blurb:'A frozen range against green country, one great bridge between them',
    pal:['#4A4E42','#53574A','#3F4339'],mottle:['rgba(122,124,104,.11)','rgba(48,52,42,.11)'],
    veg:{wet:.60,density:.38},
    // `tint` is how hard each bank pulls toward its own colour: the west into
    // snow and bare rock, the east into pasture. Both banks are tinted, not just
    // one - leaving the far side untouched gave two shades of the same country
    // rather than two countries.
    split:{west:{tint:1,ground:[1,1,1],fir:1},
           east:{tint:.9,ground:[0.20,0.36,0.12],fir:0}}},
  villages:{name:'River Villages',water:'river',
    blurb:'Farmland, woods and two hamlets astride a river',
    pal:['#43452F','#4A4B34','#3A3C2B'],mottle:['rgba(104,102,66,.11)','rgba(52,54,38,.10)'],
    veg:{wet:.58,density:.40}}
};
