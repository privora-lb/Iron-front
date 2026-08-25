# Iron Front

A two-nation modern warfare strategy game that runs entirely in the browser.
No build step, no dependencies — one HTML file.

## Play locally

Open `index.html` in any browser. That's it.

## Deploy on Render

1. Push this folder to a Git repository.
2. Render → **New → Static Site** → connect the repository.
3. Render reads `render.yaml` automatically. If you configure it by hand instead:
   - **Build command:** leave empty
   - **Publish directory:** `.`
4. Deploy. Every push to the branch redeploys.

## Other hosts

- **Netlify Drop** — drag this folder onto app.netlify.com/drop
- **GitHub Pages** — commit and enable Pages in repository settings
- **Vercel** — import the repository, framework preset "Other"

## The game

Valenmark (blue) defends; Rothal (red) invades. You start at Recruit with
300 coins and earn both coins and experience from kills. Ranks run to Supreme
Commander at level 1000, unlocking heavier units, larger formations and a
bigger command as you climb.

- **Five battlefields:** River Villages, Mountain Pass, Landing Beach, City Ruins, Desert Wadi
- **Units:** infantry, elite, engineers, snipers, AT, AA, gunships, tanks, mortars, rockets, howitzers, MG teams, APCs
- **Engineers** dig trenches, wire, sandbags and minefields along lines you draw
- **Five bases a side** to hold and take, plus territory blocks that change hands
- **Fog of war** over enemy ground; your own half is always clear
- **Difficulty:** Easy, Normal, Hard, and Adaptive — which grows stronger every minute
- **Total War** removes every limit

Controls: tap a unit card then the ground to deploy · tap markers to select ·
tap ground to move · tap an enemy to engage · number keys 1–9 for groups ·
right-click cancels · pinch, wheel or the +/− buttons to zoom · tap the round
minimap to jump.

## Saved data

Your commander name, rank, record and best score are kept in browser storage,
per domain. A local copy and a hosted copy keep separate records.
