// Older mobile webviews: fill in what they are missing before a single frame runs.
export function installPolyfills() {
  const P = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (P && !P.roundRect) {
    P.roundRect = function (x, y, w, h, r) {
      if (typeof r === 'number') r = [r, r, r, r];
      else if (!r || !r.length) r = [0, 0, 0, 0];
      const [a, b, c, d] = r.length === 1 ? [r[0], r[0], r[0], r[0]] : r;
      this.moveTo(x + a, y);
      this.lineTo(x + w - b, y);
      this.quadraticCurveTo(x + w, y, x + w, y + b);
      this.lineTo(x + w, y + h - c);
      this.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
      this.lineTo(x + d, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - d);
      this.lineTo(x, y + a);
      this.quadraticCurveTo(x, y, x + a, y);
      return this;
    };
  }
  if (typeof window.Path2D === 'undefined') {
    // very old browsers
    window.Path2D = function () {
      this.moveTo = function () {};
      this.lineTo = function () {};
      this.closePath = function () {};
    };
  }
}
