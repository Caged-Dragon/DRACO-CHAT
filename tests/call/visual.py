"""Screenshots of the call screens at several sizes. Usage: python tests/call/visual.py /tmp/call-shots"""
import functools, http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); PORT = 4177
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/call-shots'; os.makedirs(OUT, exist_ok=True)
BOB = {'id': 'id-bob', 'username': 'bob'}
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=HERE))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
    for (w, h) in [(320, 640), (390, 844), (1440, 900)]:
        ctx = b.new_context(viewport={'width': w, 'height': h}, permissions=['microphone', 'camera'], has_touch=w < 800, is_mobile=w < 800)
        pg = ctx.new_page()
        pg.goto(f'http://127.0.0.1:{PORT}/visual.html'); pg.wait_for_function('window.calls.alice && window.groups.gina')
        wf = lambda e, t=20000: pg.wait_for_function(e, timeout=t)
        # incoming call modal
        pg.evaluate(f"window.calls.alice.startCall({json.dumps(BOB)}, 'video')"); wf("window.calls.bob.incomingCall")
        pg.wait_for_timeout(300)
        # alice's own "ringing" screen is on top of bob's modal? capture bob's modal by hiding alice's overlay
        pg.add_style_tag(content='[data-user=alice] .call-overlay{display:none!important}')
        pg.screenshot(path=f'{OUT}/{w}_1_incoming.png')
        pg.evaluate('window.calls.bob.acceptCall()'); wf("window.calls.alice.callState==='connected' && window.calls.bob.callState==='connected'")
        pg.wait_for_timeout(2500)
        pg.screenshot(path=f'{OUT}/{w}_2_video_connected.png')
        # settings panel
        pg.locator('[data-user=bob] button[aria-label="Call settings"]').click(); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/{w}_3_devices.png')
        pg.locator('[data-user=bob] button[aria-label="Call settings"]').click()
        # remote muted + reconnecting banner
        pg.evaluate('window.calls.alice.toggleMute()'); pg.wait_for_timeout(500)
        pg.evaluate("""(() => { const pc = window.__pcs.find(p => p.connectionState === 'connected' && p.getSenders().length);
          window.__bobPc = window.__pcs[window.__pcs.length-1];
          Object.defineProperty(window.__bobPc, 'connectionState', { configurable: true, get: () => 'disconnected' });
          window.__bobPc.onconnectionstatechange(); })()""")
        pg.wait_for_timeout(400)
        pg.screenshot(path=f'{OUT}/{w}_4_reconnecting.png')
        pg.evaluate("window.calls.bob.endCall()"); pg.wait_for_timeout(600)
        # message toast after a decline
        pg.evaluate(f"window.calls.alice.startCall({json.dumps(BOB)}, 'audio')"); wf("window.calls.bob.incomingCall")
        pg.evaluate('window.calls.bob.declineCall()'); wf("window.calls.alice.error.includes('declined')")
        pg.screenshot(path=f'{OUT}/{w}_5_toast.png')
        ctx.close()
        # group video grid
        ctx = b.new_context(viewport={'width': w, 'height': h}, permissions=['microphone', 'camera'], has_touch=w < 800, is_mobile=w < 800)
        pg = ctx.new_page(); pg.goto(f'http://127.0.0.1:{PORT}/visual.html'); pg.wait_for_function('window.groups.alice && window.groups.gina')
        for n in ['alice', 'bob', 'carol', 'dave']:
            pg.evaluate(f"window.groups.{n}.joinCall({{id:'g1', name:'Caged Dragon Studios Core Team'}}, 'video')"); pg.wait_for_timeout(150)
        pg.wait_for_function("Object.values(window.groups.dave.participants).length===3", timeout=30000); pg.wait_for_timeout(2500)
        pg.add_style_tag(content='[data-user=alice] .call-overlay,[data-user=bob] .call-overlay,[data-user=carol] .call-overlay{display:none!important}')
        pg.evaluate('window.groups.dave.toggleMute()'); pg.wait_for_timeout(400)
        pg.screenshot(path=f'{OUT}/{w}_6_group.png')
        ctx.close()
    b.close()
srv.shutdown(); print('done')
