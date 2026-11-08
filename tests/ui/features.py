"""
Browser tests for the v5.11 features (mocked backend):
offline queue, photo compression, admin report review, data download, two-step login, update prompt.
  VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=mock npm run build && python tests/ui/features.py
"""
import io, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *
from PIL import Image
import random

results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('  PASS ' if ok else '  FAIL ') + name + (f'   [{detail}]' if detail and not ok else ''))

def open_chat(pg):
    pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_selector('.sidebar'); pg.wait_for_timeout(500)
    pg.locator('.friend-row').first.click(); pg.wait_for_selector('.chat-window'); pg.wait_for_timeout(600)

def send(pg, text):
    box = pg.locator('.chat-input input[type="text"], .chat-input input:not([type])').first
    box.fill(text); box.press('Enter'); pg.wait_for_timeout(400)

with sync_playwright() as p:
    s = serve(); b = p.chromium.launch()

    print('1. Offline message queue')
    ctx, pg, errs = new_page(b, 390, 844)
    STATE['post_mode'] = 'offline'; STATE['posts'].clear()
    open_chat(pg)
    send(pg, 'hello while offline')
    check('message shows as "waiting/sending" instead of vanishing', pg.locator('.bubble.pending').count() == 1 and 'hello while offline' in pg.locator('.bubble.pending').inner_text())
    stored = pg.evaluate("Object.keys(localStorage).filter(k => k.startsWith('dragonchat.outbox.')).map(k => JSON.parse(localStorage.getItem(k)))")
    check('it is saved on the device', len(stored) == 1 and len(stored[0]) == 1 and stored[0][0]['row']['content'] == 'hello while offline')
    msg_id = stored[0][0]['row']['id'] if stored else None
    check('it already has its own id (so a retry can never duplicate it)', bool(msg_id) and len(msg_id) == 36)
    pg.reload(); pg.wait_for_selector('.sidebar'); pg.locator('.friend-row').first.click(); pg.wait_for_selector('.chat-window'); pg.wait_for_timeout(600)
    check('it survives a page reload', pg.locator('.bubble.pending').count() == 1)
    STATE['post_mode'] = 'ok'
    pg.evaluate("window.dispatchEvent(new Event('online'))"); pg.wait_for_timeout(1200)
    check('when the connection returns it is delivered automatically', len(STATE['posts']) == 1 and STATE['posts'][0]['content'] == 'hello while offline', STATE['posts'])
    check('with the same id it was queued with', STATE['posts'] and STATE['posts'][0].get('id') == msg_id)
    check('and the pending bubble disappears', pg.locator('.bubble.pending').count() == 0)

    STATE['post_mode'] = 'dup'; send(pg, 'retry after flaky network'); pg.wait_for_timeout(500)
    check('a "duplicate id" reply (already delivered) counts as success', pg.locator('.bubble.pending').count() == 0)
    STATE['post_mode'] = 'rls'; send(pg, 'not allowed'); pg.wait_for_timeout(600)
    failed = pg.locator('.bubble.pending.failed')
    check('a message the server refuses is flagged "Not sent" with a clear reason', failed.count() == 1 and "can't send" in failed.inner_text(), failed.inner_text() if failed.count() else '')
    check('Retry and Delete buttons are offered', failed.get_by_role('button', name='Retry').count() == 1 and failed.get_by_role('button', name='Delete').count() == 1)
    failed.get_by_role('button', name='Delete').click(); pg.wait_for_timeout(300)
    check('Delete removes it', pg.locator('.bubble.pending').count() == 0)
    STATE['post_mode'] = 'ok'
    check('no uncaught errors', not errs, errs[:2]); ctx.close()

    print('2. Photos are compressed before upload')
    ctx, pg, errs = new_page(b, 390, 844); open_chat(pg)
    random.seed(1)
    big = Image.effect_noise((3200, 2400), 60).convert('RGB')
    buf = io.BytesIO(); big.save(buf, 'JPEG', quality=95); raw = buf.getvalue()
    STATE['uploads'].clear()
    path = '/tmp/big-photo.jpg'; open(path, 'wb').write(raw)
    pg.locator('input[type="file"]').first.set_input_files(path); pg.wait_for_timeout(2500)
    ups = STATE['uploads']
    check('a photo upload was sent', len(ups) >= 1)
    if ups:
        body = ups[0]['body'] or b''
        a, z = body.find(b'\xff\xd8'), body.rfind(b'\xff\xd9')
        img = Image.open(io.BytesIO(body[a:z + 2])) if a >= 0 else None
        check(f'much smaller than the original ({len(raw)//1024} KB -> {len(body)//1024} KB)', len(body) < len(raw) * 0.6, (len(raw), len(body)))
        check('longest side limited to 1600 px', img is not None and max(img.size) <= 1600, img.size if img else None)
        check('proportions kept', img is not None and abs(img.size[0] / img.size[1] - 3200 / 2400) < 0.01, img.size if img else None)
    ctx.close()

    print('3. Admin: review reports')
    STATE['admin'] = False
    ctx, pg, errs = new_page(b, 1280, 800); pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_selector('.sidebar')
    pg.locator('button[aria-label="App settings"]').click(); pg.wait_for_timeout(600)
    check('normal users do not see the admin button', pg.get_by_text('Admin: review reports').count() == 0)
    ctx.close()
    STATE['admin'] = True
    ctx, pg, errs = new_page(b, 390, 844); pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_selector('.sidebar')
    pg.locator('button[aria-label="App settings"]').click(); pg.wait_for_timeout(600)
    check('admins see "Admin: review reports"', pg.get_by_text('Admin: review reports').count() == 1)
    pg.get_by_role('button', name='Open').click(); pg.wait_for_timeout(600)
    card = pg.locator('.admin-report')
    check('the report lists who reported whom, the reason and the message', card.count() == 1 and all(t in card.inner_text() for t in ['maya', 'spammer99', 'Sending spam links', 'Buy cheap stuff']))
    check('shows how many reports the user has in total', '3 reports' in card.inner_text())
    pg.screenshot(path='/tmp/admin_reports.png')
    pg.locator('.admin-note').fill('first warning')
    pg.get_by_role('button', name='Resolve + suspend user').click(); pg.wait_for_timeout(700)
    rev = STATE['reviews'][-1] if STATE['reviews'] else {}
    check('"Resolve + suspend" sends the right request', rev.get('p_status') == 'resolved' and rev.get('p_suspend') is True and rev.get('p_note') == 'first warning', rev)
    check('the report leaves the Open list', pg.locator('.admin-report').count() == 0)
    check('no uncaught errors', not errs, errs[:2]); ctx.close(); STATE['admin'] = False

    print('4. Download my data')
    ctx, pg, errs = new_page(b, 390, 844, ); pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_selector('.sidebar')
    pg.locator('button[aria-label="App settings"]').click(); pg.wait_for_timeout(500)
    with pg.expect_download() as dl:
        pg.get_by_role('button', name='Download').click()
    d = dl.value; data = json.load(open(d.path()))
    check('a dated .json file is downloaded', d.suggested_filename.startswith('dragon-chat-data-') and d.suggested_filename.endswith('.json'), d.suggested_filename)
    check('it contains the account data', data.get('profile', {}).get('username') == 'ashwin' and len(data.get('direct_messages', [])) == 1)
    ctx.close()

    print('5. Two-step login')
    STATE['mfa_user'] = True
    ctx, pg, errs = new_page(b, 390, 844, session=make_session('aal1', True))
    pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_timeout(1200)
    check('a password-only session is stopped at the code screen', pg.get_by_role('heading', name='Two-step verification').count() == 1 and pg.locator('.sidebar').count() == 0)
    box = pg.get_by_label('6-digit code'); box.fill('000000'); pg.get_by_role('button', name='Verify').click(); pg.wait_for_timeout(700)
    check('a wrong code shows an error and stays locked', "didn't work" in pg.locator('body').inner_text() and pg.locator('.sidebar').count() == 0)
    box.fill('123456'); pg.get_by_role('button', name='Verify').click()
    ok = True
    try: pg.wait_for_selector('.sidebar', timeout=6000)
    except Exception: ok = False
    check('the right code opens the app', ok)
    ctx.close()

    STATE['mfa_user'] = False
    ctx, pg, errs = new_page(b, 390, 844); pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_selector('.sidebar')
    pg.locator('button[aria-label="App settings"]').click(); pg.wait_for_timeout(500)
    pg.get_by_role('button', name='Set up').click(); pg.wait_for_timeout(700)
    check('setup shows a QR code and the manual key', pg.locator('.mfa-qr').count() == 1 and 'JBSWY3DPEHPK3PXP' in pg.locator('.mfa-secret').inner_text())
    check('"Turn on" stays disabled until 6 digits are entered', pg.get_by_role('button', name='Turn on').is_disabled())
    pg.get_by_label('6-digit code').fill('a1b2c3')
    check('letters are filtered out of the code box', pg.get_by_label('6-digit code').input_value() == '123')
    ctx.close()

    print('6. "New version available" prompt')
    ctx, pg, errs = new_page(b, 390, 844)
    ctx.add_init_script("Object.defineProperty(navigator.serviceWorker, 'controller', { get: () => ({}) });")
    pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_selector('.sidebar')
    check('no banner normally', pg.locator('.update-prompt').count() == 0)
    pg.evaluate("navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))"); pg.wait_for_timeout(300)
    check('banner appears when a new version takes over', pg.locator('.update-prompt').count() == 1 and 'new version' in pg.locator('.update-prompt').inner_text())
    pg.get_by_role('button', name='Dismiss').click()
    check('it can be dismissed', pg.locator('.update-prompt').count() == 0)
    ctx.close()

    b.close(); s.shutdown()

print(f'\n{sum(results)}/{len(results)} checks passed')
sys.exit(0 if all(results) else 1)
