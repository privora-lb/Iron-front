// The five theatres. `water` drives terrain generation; `pal`/`mottle` drive the bake.
export const MAPS={
  villages:{name:'River Villages',water:'river',
    blurb:'Farmland, woods and two hamlets astride a river',
    pal:['#43452F','#4A4B34','#3A3C2B'],mottle:['rgba(104,102,66,.11)','rgba(52,54,38,.10)']},
  mountains:{name:'Mountain Pass',water:'none',
    blurb:'Sheer rock and three narrow passes — the high ground is everything',
    pal:['#494940','#525146','#3E3E37'],mottle:['rgba(120,118,108,.12)','rgba(46,46,42,.12)']},
  beach:{name:'Landing Beach',water:'inlet',
    blurb:'Open sand, dunes and a tidal inlet with the sea at your back',
    pal:['#8A7A55','#93835C','#7C6E4C'],mottle:['rgba(214,196,150,.13)','rgba(96,84,58,.10)']},
  city:{name:'City Ruins',water:'canal',
    blurb:'Streets, rubble and a canal — every block is a fight',
    pal:['#4E4D48','#57564F','#434240'],mottle:['rgba(120,118,112,.10)','rgba(40,40,38,.12)']},
  desert:{name:'Desert Wadi',water:'none',
    blurb:'Dunes, an oasis and a dry wadi — nothing to hide behind',
    pal:['#94804F','#9E8A57','#877347'],mottle:['rgba(226,206,152,.13)','rgba(112,94,56,.10)']}
};
