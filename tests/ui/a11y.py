"""
Accessibility audit with axe-core on the real screens (mocked backend).
  npm run build (with mock env) && python tests/ui/a11y.py
Fails on any serious/critical violation (colour-contrast is reported but not failing:
the gradient backgrounds can't be measured automatically — check those by eye).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *

AXE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'node_modules', 'axe-core', 'axe.min.js')).read()
bad = {}
def audit(pg, label):
    pg.evaluate(AXE)
    res = pg.evaluate("axe.run(document, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes[0].target.join(' ') })))")
    for v in res:
        key = (v['id'], v['impact'])
        bad.setdefault(key, []).append((label, v['n'], v['help'], v['sample']))
    print(f"  {label}: {len(res)} rule(s) violated" + ('' if not res else ' -> ' + ', '.join(f"{v['id']}({v['impact']},{v['n']})" for v in res)))

with sync_playwright() as p:
    s = serve(); b = p.chromium.launch()
    ctx, pg, errs = new_page(b, 390, 844, mobile=True, logged_in=False)
    pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_timeout(800); audit(pg, 'landing')
    pg.get_by_role('button', name='Log in').first.click(); pg.wait_for_timeout(500); audit(pg, 'login')
    ctx.close()

    ctx, pg, errs = new_page(b, 1280, 800, mobile=False)
    pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_selector('.sidebar'); pg.wait_for_timeout(700); audit(pg, 'dashboard')
    pg.locator('.friend-row').first.click(); pg.wait_for_selector('.chat-window'); pg.wait_for_timeout(700); audit(pg, 'direct chat')
    pg.locator('.group-row').first.click(); pg.wait_for_selector('.chat-window'); pg.wait_for_timeout(500)
    pg.locator('.chat-header-name').first.click(); pg.wait_for_timeout(300); audit(pg, 'group chat + members')
    for sel, name in [('button[aria-label="App settings"]', 'settings modal'), ('button[aria-label="Search everything"]', 'search modal'),
                      ('.me-row-clickable', 'profile modal'), ('button[aria-label="New group"]', 'new group modal')]:
        pg.locator(sel).first.click(); pg.wait_for_timeout(500)
        audit(pg, name)
        # keyboard: dialog role + Escape closes it
        role = pg.evaluate("document.querySelector('.modal-card')?.getAttribute('role')")
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        closed = pg.locator('.modal-card').count() == 0
        print(f"    dialog role={role}, Escape closes={closed}")
        if role != 'dialog' or not closed: bad.setdefault(('modal-keyboard', 'serious'), []).append((name, 1, 'dialog role / Escape', ''))
    ctx.close(); b.close(); s.shutdown()

fail = {k: v for k, v in bad.items() if k[1] in ('serious', 'critical') and k[0] != 'color-contrast'}
print('\nDetails:')
for (rid, impact), items in sorted(bad.items()):
    print(f"  [{impact}] {rid}: {items[0][2]}")
    for label, n, _, sample in items[:3]: print(f"       - {label} ({n}): {sample[:90]}")
print('\nSERIOUS/CRITICAL (excluding colour-contrast):', len(fail))
sys.exit(1 if fail else 0)
