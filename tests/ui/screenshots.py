import os
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ui-shots'
os.makedirs(OUT, exist_ok=True)
SIZES = [(320, 640), (360, 740), (390, 844), (600, 900), (768, 1024), (1024, 768), (1440, 900)]

OVERFLOW_JS = """() => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && cs.display === 'none') return;
    if (r.right > vw + 1 || r.left < -1) {
      // ignore things inside horizontally-scrollable containers
      let p = el.parentElement, scroll = false;
      while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { scroll = true; break; } p = p.parentElement; }
      if (!scroll) bad.push((el.className && el.className.toString().slice(0,40)) || el.tagName);
    }
  });
  return { vw, docScroll: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth, bad: [...new Set(bad)].slice(0, 12) };
}"""

with sync_playwright() as p:
    s = serve()
    b = p.chromium.launch()
    for (w, h) in SIZES:
        mobile = w < 800
        ctx, pg, errs = new_page(b, w, h, mobile=mobile)
        pg.goto(f'http://127.0.0.1:{PORT}/')
        pg.wait_for_selector('.sidebar', timeout=8000)
        pg.wait_for_timeout(700)
        pg.screenshot(path=f'{OUT}/{w}_1_list.png')
        report = {'size': f'{w}x{h}', 'list': pg.evaluate(OVERFLOW_JS)}
        # open a direct chat
        pg.locator('.friend-row').first.click()
        pg.wait_for_selector('.chat-window', timeout=5000)
        pg.wait_for_timeout(700)
        pg.screenshot(path=f'{OUT}/{w}_2_chat.png')
        report['chat'] = pg.evaluate(OVERFLOW_JS)
        # open a group chat + members panel
        if pg.locator('.back-btn').first.is_visible():
            pg.locator('.back-btn').first.click(); pg.wait_for_timeout(300)
        pg.locator('.group-row').first.click()
        pg.wait_for_selector('.chat-window', timeout=5000)
        pg.wait_for_timeout(600)
        pg.locator('.chat-header-name').first.click()
        pg.wait_for_timeout(400)
        pg.screenshot(path=f'{OUT}/{w}_3_group.png')
        report['group'] = pg.evaluate(OVERFLOW_JS)
        print(json.dumps(report))
        if errs: print('  page errors:', errs[:3])
        ctx.close()
    b.close(); s.shutdown()
