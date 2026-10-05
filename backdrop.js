// Start-screen backdrop: "notes into a tracked plan".
// Scraps of messy notes drift and tumble. A timeline draws itself across the
// screen, each scrap settles onto a milestone, and a tracker runs along the
// line lighting each milestone as it passes. Then everything loosens and
// scatters again. Colorless on purpose: white and ink only, so it sits on the
// blue start screen without clashing.
// Runs only on the start screen and only while the tab is visible. With
// reduced motion it draws one settled frame and stops.

(() => {
  const canvas = document.getElementById('backdrop');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');

  const SCRAPS = [
    'kickoff', 'eng says 6 wks?', 'who owns support??', 'scope: export?',
    'demo to leads', 'training wk 4', 'tell finance first', 'docs first',
    'Q3 close 9/30', 'weekly report', 'go-live', 'success = ?',
  ];

  // The four score colors. Each scrap glows in one as the tracker passes it.
  const GLOWS = ['245, 169, 100', '111, 176, 234', '242, 162, 192', '172, 148, 226'];

  const CYCLE = 14000;
  const SETTLE_AT = 3000, SETTLE_FOR = 2400;   // line draws, scraps land
  const TRACK_AT = 5600, TRACK_FOR = 5000;     // the tracker runs the line
  const SCATTER_AT = 11200, SCATTER_FOR = 2400;
  const STAGGER = 90;

  const FONT = '500 12.5px Inter, system-ui, sans-serif';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, lineY = 0, x0 = 0, x1 = 0, cards = [], raf = 0;
  let t0 = performance.now();

  // Paused means: back to the very start of the loop, frozen there.
  const PAUSE_KEY = 'scope-builder:backdrop-paused';
  let paused = false;
  try { paused = localStorage.getItem(PAUSE_KEY) === '1'; } catch { /* storage blocked */ }

  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = FONT;

    // The line runs edge to edge at mid-height, behind the input box. The
    // milestones sit in the open space either side of it.
    lineY = Math.round(H * 0.5);
    x0 = 28;
    x1 = W - 28;
    const clear = Math.min(W / 2 - 60, 380 + 40);
    const half = SCRAPS.length / 2;
    const span = Math.max(80, W / 2 - clear - 70);
    const nodeX = (i) => (i < half
      ? 70 + (span * i) / (half - 1)
      : W / 2 + clear + (span * (i - half)) / (half - 1));

    // Where the headline sits. Loose scraps keep out of it, so it is never
    // covered, moving or paused.
    const title = document.querySelector('.appbar-title');
    const tr = title && title.offsetParent ? title.getBoundingClientRect() : null;
    const clearOf = (w, h, ax, ay) => {
      for (let n = 0; n < 40; n++) {
        const x = rand(w, W - w), y = rand(h, H - h);
        if (!tr) return [x, y];
        const padX = w / 2 + ax + 16, padY = h / 2 + ay + 16;
        const inside = x > tr.left - padX && x < tr.right + padX && y > tr.top - padY && y < tr.bottom + padY;
        if (!inside) return [x, y];
      }
      return [rand(w, W - w), Math.min(H - h, (tr ? tr.bottom : 0) + h + ay + 30)];
    };

    cards = SCRAPS.map((text, i) => {
      const w = Math.ceil(ctx.measureText(text).width) + 22;
      const ax = rand(18, 44), ay = rand(14, 32);
      const [sx, sy] = clearOf(w, 30, ax, ay);
      // Alternate above and below, near and far, so neighbors never overlap.
      // The tiers scale with the screen so the scraps fill the open space.
      const above = i % 2 === 0;
      const far = i % 4 >= 2;
      const off = Math.min(lineY - 40, Math.max(56, H * (far ? 0.3 : 0.13)));
      const nx = nodeX(i);
      return {
        text, w, h: 30, nx, above,
        tx: nx, ty: lineY + (above ? -off : off),
        sx, sy, sr: rand(-0.45, 0.45),
        ax, ay, fx: rand(0.00012, 0.00026), fy: rand(0.0001, 0.00022),
        ph: rand(0, Math.PI * 2), spin: rand(-0.00018, 0.00018),
        order: i,
        glow: GLOWS[i % GLOWS.length],
      };
    });
  }

  // 0 = loose, 1 = on its milestone.
  function settled(card, ms) {
    const delay = card.order * STAGGER;
    if (ms < SETTLE_AT + delay) return 0;
    if (ms < SETTLE_AT + SETTLE_FOR + delay) return ease((ms - SETTLE_AT - delay) / SETTLE_FOR);
    if (ms < SCATTER_AT + delay) return 1;
    if (ms < SCATTER_AT + SCATTER_FOR + delay) return 1 - ease((ms - SCATTER_AT - delay) / SCATTER_FOR);
    return 0;
  }

  // How much of the line exists, and how far the tracker has run.
  function lineState(ms) {
    let drawn;
    if (ms < SETTLE_AT) drawn = 0;
    else if (ms < SETTLE_AT + SETTLE_FOR) drawn = ease((ms - SETTLE_AT) / SETTLE_FOR);
    else if (ms < SCATTER_AT) drawn = 1;
    else drawn = 1 - ease(clamp01((ms - SCATTER_AT) / SCATTER_FOR));
    const tracked = ms < TRACK_AT ? 0 : ms < SCATTER_AT ? ease(clamp01((ms - TRACK_AT) / TRACK_FOR)) : 1;
    return { drawn, tracked, fade: ms < SCATTER_AT ? 1 : drawn };
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(now, still) {
    const ms = still ? TRACK_AT + TRACK_FOR * 0.62 : (now - t0) % CYCLE;
    const { drawn, tracked, fade } = lineState(ms);
    const head = x0 + (x1 - x0) * tracked;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // the line itself, drawn left to right
    if (drawn > 0) {
      const end = x0 + (x1 - x0) * drawn;
      ctx.lineCap = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.beginPath(); ctx.moveTo(x0, lineY); ctx.lineTo(end, lineY); ctx.stroke();
      // the tracked part, brighter
      if (tracked > 0) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.85 * fade})`;
        ctx.beginPath(); ctx.moveTo(x0, lineY); ctx.lineTo(Math.min(head, end), lineY); ctx.stroke();
      }
    }

    // stalks and milestones, under the scraps
    for (const c of cards) {
      const k = still ? 1 : settled(c, ms);
      if (k <= 0.02) continue;
      const lit = tracked > 0 && head >= c.nx;
      ctx.globalAlpha = k;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.moveTo(c.nx, lineY + (c.above ? -6 : 6));
      ctx.lineTo(c.nx, c.ty + (c.above ? c.h / 2 : -c.h / 2));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.nx, lineY, lit ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = lit ? '#ffffff' : 'rgba(47, 110, 166, 1)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = lit ? '#ffffff' : 'rgba(255, 255, 255, 0.6)';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // the tracker head, with a soft glow
    if (tracked > 0 && tracked < 1 && fade > 0.5) {
      const g = ctx.createRadialGradient(head, lineY, 0, head, lineY, 18);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
      g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(head, lineY, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(head, lineY, 4, 0, Math.PI * 2); ctx.fill();
    }

    // the scraps
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    for (const c of cards) {
      const k = still ? 1 : settled(c, ms);
      const t = still ? 0 : now;
      const dx = Math.sin(t * c.fx + c.ph) * c.ax * (1 - k);
      const dy = Math.cos(t * c.fy + c.ph) * c.ay * (1 - k);
      const x = c.sx + (c.tx - c.sx) * k + dx;
      const y = c.sy + (c.ty - c.sy) * k + dy;
      const r = (c.sr + Math.sin(t * c.spin * 6 + c.ph) * 0.25) * (1 - k);
      const lit = k > 0.95 && tracked > 0 && head >= c.nx;
      // The glow switches on as the light reaches the scrap and stays on;
      // it only fades as the scrap loosens and drifts away again.
      const reached = tracked > 0 ? clamp01((head - c.nx + 40) / 80) : 0;
      const near = reached * clamp01((k - 0.3) / 0.7);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r);
      if (near > 0.02) {
        ctx.shadowColor = `rgba(${c.glow}, ${0.95 * near})`;
        ctx.shadowBlur = 26;
        ctx.shadowOffsetY = 0;
        roundRect(-c.w / 2, -c.h / 2, c.w, c.h, 8);
        ctx.fillStyle = `rgba(${c.glow}, ${0.9 * near})`;
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(${c.glow}, ${0.9 * near})`;
        ctx.stroke();
        ctx.fill();
      }
      ctx.shadowColor = 'rgba(10, 30, 60, 0.18)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 5;
      roundRect(-c.w / 2, -c.h / 2, c.w, c.h, 8);
      ctx.fillStyle = `rgba(255, 255, 255, ${lit ? 0.96 : 0.78})`;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = `rgba(17, 17, 17, ${lit ? 0.78 : 0.5})`;
      ctx.fillText(c.text, -c.w / 2 + 11, 0.5);
      ctx.restore();
    }
  }

  const onPrompt = () => document.body.classList.contains('state-prompt');

  function frame(now) {
    raf = 0;
    if (!onPrompt() || document.hidden || paused) return;
    draw(now, false);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!onPrompt()) return;
    if (reduced) { draw(performance.now(), true); return; }
    if (paused) { t0 = performance.now(); draw(t0, false); return; }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  const btn = document.getElementById('backdrop-toggle');
  function renderButton() {
    if (!btn) return;
    btn.hidden = reduced;
    btn.textContent = paused ? 'Play animation' : 'Pause animation';
    btn.classList.toggle('is-paused', paused);
    btn.setAttribute('aria-pressed', String(paused));
  }
  if (btn) {
    btn.addEventListener('click', () => {
      paused = !paused;
      try { localStorage.setItem(PAUSE_KEY, paused ? '1' : '0'); } catch { /* storage blocked */ }
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      t0 = performance.now();   // either way, the loop restarts from the top
      renderButton();
      start();
    });
  }
  renderButton();

  layout();
  start();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); start(); });
  window.addEventListener('resize', () => { layout(); start(); });
  document.addEventListener('visibilitychange', start);
  new MutationObserver(start).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
