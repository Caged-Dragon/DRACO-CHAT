"""
End-to-end GROUP call test (real WebRTC mesh, fake devices, in-memory signalling + presence).
  node tests/call/build.mjs && python tests/call/group_e2e.py
"""
import functools, http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 4176
GROUP = {'id': 'g-team', 'name': 'Team'}
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('  PASS ' if ok else '  FAIL ') + name + (f'   [{detail}]' if detail and not ok else ''))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=HERE))
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                                '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(permissions=['microphone', 'camera'])
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f'http://127.0.0.1:{PORT}/index.html')
    pg.wait_for_function('window.groups.alice && window.groups.gina')

    def wf(expr, timeout=20000):
        try:
            pg.wait_for_function(expr, timeout=timeout); return True
        except Exception:
            return False
    ev = pg.evaluate
    n_participants = lambda n: ev(f'Object.keys(window.groups.{n}.participants).length')

    print('1. Three people in a VOICE group call')
    for name in ['alice', 'bob', 'carol']:
        ev(f"window.groups.{name}.joinCall({json.dumps(GROUP)}, 'audio')")
        pg.wait_for_timeout(120)
    ok = wf("['alice','bob','carol'].every(n => Object.values(window.groups[n].participants).length === 2 && Object.values(window.groups[n].participants).every(p => p.state === 'connected'))", 30000)
    check('everyone sees two others, all connected', ok, [n_participants(n) for n in ['alice', 'bob', 'carol']])

    print('2. Voice calls actually play sound (the missing-audio bug)')
    audio_counts = [ev(f"document.querySelectorAll('[data-user={n}] .group-call-overlay audio').length") for n in ['alice', 'bob', 'carol']]
    check('each person has an <audio> element for each other person', audio_counts == [2, 2, 2], audio_counts)
    wired = ev("[...document.querySelectorAll('.group-call-overlay audio')].every(a => a.srcObject && a.srcObject.getAudioTracks().length === 1)")
    check('every audio element is wired to a remote audio track', wired)
    flowing = ev("""(async () => {
        const sum = async () => { let n = 0; for (const pc of window.__pcs) { if (pc.connectionState !== 'connected') continue;
            for (const s of (await pc.getStats()).values()) if (s.type === 'inbound-rtp') n += s.bytesReceived; } return n; };
        const a = await sum(); await new Promise(r => setTimeout(r, 1500)); return (await sum()) > a; })()""")
    check('audio bytes keep flowing', flowing)

    print('3. Mute indicators')
    ev('window.groups.alice.toggleMute()')
    check('bob and carol see that alice is muted', wf("window.groups.bob.peerMedia['id-alice']?.muted === true && window.groups.carol.peerMedia['id-alice']?.muted === true", 6000))
    check('the muted icon shows on the tile', ev("[...document.querySelectorAll('[data-user=bob] .group-call-tile-name')].some(e => e.textContent.includes('🔇'))"))
    ev('window.groups.alice.toggleMute()')

    print('4. Recovering one broken link in the mesh')
    count_before = ev('window.__pcs.length')
    ev("""(() => {
        const pc = window.__pcs.find(p => p.connectionState === 'connected');
        window.__broken = pc;
        Object.defineProperty(pc, 'connectionState', { configurable: true, get: () => 'failed' });
        pc.onconnectionstatechange();
    })()""")
    check('a replacement connection is created', wf(f'window.__pcs.length > {count_before}', 10000))
    ok = wf("['alice','bob','carol'].every(n => Object.values(window.groups[n].participants).length === 2 && Object.values(window.groups[n].participants).every(p => p.state === 'connected'))", 30000)
    check('everyone is back to all-connected', ok, [ev(f"Object.values(window.groups.{n}.participants).map(p => p.state)") for n in ['alice', 'bob', 'carol']])

    print('5. Someone leaves')
    ev('window.groups.carol.leaveCall()')
    check('the others see one person fewer', wf("window.groups.alice.participants && Object.keys(window.groups.alice.participants).length === 1 && Object.keys(window.groups.bob.participants).length === 1", 8000))
    check('leaving carol\'s screen is closed', ev("window.groups.carol.activeCall === null"))
    ev('window.groups.alice.leaveCall()'); ev('window.groups.bob.leaveCall()')
    wf("window.groups.alice.activeCall === null && window.groups.bob.activeCall === null", 5000)

    print('6. The room is capped at 6 people')
    names = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'gina']
    for name in names:
        ev(f"window.groups.{name}.joinCall({json.dumps({'id': 'g-big', 'name': 'Big'})}, 'audio')")
        pg.wait_for_timeout(150)
    check('the 7th person is turned away with a clear message', wf("window.groups.gina.activeCall === null && window.groups.gina.error.includes('full')", 10000), ev('window.groups.gina.error'))
    check('the first six stay in the call', all(ev(f'window.groups.{n}.activeCall !== null') for n in names[:6]))
    check('the "call is full" message is visible on screen', ev("!!document.querySelector('[data-user=gina] .call-toast')"))
    for n in names[:6]: ev(f'window.groups.{n}.leaveCall()')

    check('no uncaught errors in the page', not errors, errors[:3])
    b.close()
srv.shutdown()
passed = sum(1 for _, ok in results if ok)
print(f'\n{passed}/{len(results)} checks passed')
sys.exit(0 if passed == len(results) else 1)
