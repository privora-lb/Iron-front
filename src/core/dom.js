// Thin DOM helpers. Everything else in the game talks to the page through these.
export const el = (id) => document.getElementById(id);
export function toast(m) {
  const t = el('toast');
  t.textContent = m;
  t.style.opacity = 1;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.style.opacity = 0), 1500);
}
