// World geometry. One battlefield is W x H world units and ZONE is the muster
// depth behind each side’s edge.
export const W=5200,H=3300,ZONE=640,BANK=96;
export const FS=W/3000;   // terrain feature scale   // BANK: how close to the water a host may muster
export const LANE_Y=[H/6,H/2,H*5/6];
export const LANE_NAME=['Left sector','Centre sector','Right sector'];
export const DIV=[H/3,H*2/3];
export const GAPS=[[H/3,W*0.28],[H/3,W*0.70],[H*2/3,W*0.30],[H*2/3,W*0.72]];
export const SIM=1/60;
