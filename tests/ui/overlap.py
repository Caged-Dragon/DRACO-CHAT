import os
import sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *
SIZES = [(320,568),(360,740),(375,667),(390,844),(412,915),(480,800),(600,900),(768,1024),(900,700),(1024,768),(1280,720),(1440,900),(1920,1080),(640,360)]
JS = """(sels) => {
  const out = [];
  const inter = (a,b) => !(a.right <= b.left+0.5 || b.right <= a.left+0.5 || a.bottom <= b.top+0.5 || b.bottom <= a.top+0.5);
  for (const sel of sels) {
    document.querySelectorAll(sel).forEach((row, ri) => {
      if (ri > 3) return;
      const kids = [...row.children].filter(k => { const r=k.getBoundingClientRect(); const cs=getComputedStyle(k); return r.width>0 && r.height>0 && cs.position!=='absolute' && cs.position!=='fixed' && cs.display!=='none'; });
      for (let i=0;i<kids.length;i++) for (let j=i+1;j<kids.length;j++) {
        if (inter(kids[i].getBoundingClientRect(), kids[j].getBoundingClientRect()))
          out.push(sel+': '+(kids[i].className||kids[i].tagName)+' x '+(kids[j].className||kids[j].tagName));
      }
      // children sticking out of their row
      const rr=row.getBoundingClientRect();
      kids.forEach(k => { const r=k.getBoundingClientRect(); if (r.right>rr.right+1||r.left<rr.left-1) out.push(sel+': '+(k.className||k.tagName)+' overflows row'); });
    });
  }
  return out;
}"""
LIST_SELS = ['.sidebar-header','.sidebar-header-actions','.friend-row','.group-row','.me-row','.friend-requests li','.groups-list-header']
CHAT_SELS = ['.chat-header','.chat-input','.pinned-banner','.group-member-row','.bubble-meta']
bad = 0
with sync_playwright() as p:
    s = serve(); b = p.chromium.launch()
    for (w,h) in SIZES:
        ctx, pg, errs = new_page(b, w, h, mobile=w<800)
        pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_selector('.sidebar'); pg.wait_for_timeout(600)
        res = pg.evaluate(JS, LIST_SELS)
        pg.locator('.friend-row').first.click(); pg.wait_for_selector('.chat-window'); pg.wait_for_timeout(700)
        res += pg.evaluate(JS, CHAT_SELS)
        if pg.locator('.back-btn').first.is_visible():
            pg.locator('.back-btn').first.click(); pg.wait_for_timeout(300)
        pg.locator('.group-row').first.click(); pg.wait_for_selector('.chat-window'); pg.wait_for_timeout(500)
        pg.locator('.chat-header-name').first.click(); pg.wait_for_timeout(300)
        res += pg.evaluate(JS, CHAT_SELS)
        doc = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        res = sorted(set(res))
        print(f'{w}x{h}: horiz-scroll={doc}px overlaps={len(res)}', res[:5] if res else '')
        bad += len(res) + (1 if doc else 0)
        ctx.close()
    b.close(); s.shutdown()
print('TOTAL PROBLEMS:', bad)
