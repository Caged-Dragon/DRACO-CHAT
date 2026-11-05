"""
End-to-end call test: three users (alice, bob, carol) in one headless Chromium page,
real WebRTC between them (fake mic/camera), in-memory stand-in for Supabase signalling.

  node tests/call/build.mjs && python tests/call/call_e2e.py
"""
import functools, http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 4175
BOB = {'id': 'id-bob', 'username': 'bob'}
ALICE = {'id': 'id-alice', 'username': 'alice'}

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
    pg.wait_for_function('window.calls.alice && window.calls.bob && window.calls.carol')

    def wf(expr, timeout=15000):
        try:
            pg.wait_for_function(expr, timeout=timeout); return True
        except Exception:
            return False
    def ev(expr): return pg.evaluate(expr)
    def state(n): return ev(f'window.calls.{n}.callState')
    def signals(event): return ev(f"window.__signals.filter(s => s.event === '{event}').length")

    print('1. Ringing, answering, connecting')
    ev(f"window.calls.alice.startCall({json.dumps(BOB)}, 'video')")
    check('bob receives the incoming call', wf("window.calls.bob.incomingCall && window.calls.bob.incomingCall.callerName === 'alice'"))
    check('alice is in the calling state', state('alice') == 'calling', state('alice'))

    print('2. Busy line')
    ev(f"window.calls.carol.startCall({json.dumps(BOB)}, 'audio')")
    check('carol hears "on another call" while bob is ringing', wf("window.calls.carol.error.includes('on another call')", 8000), ev('window.calls.carol.error'))
    check('bob is still ringing for alice', ev("window.calls.bob.incomingCall && window.calls.bob.incomingCall.callerName") == 'alice')

    ev('window.calls.bob.acceptCall()')
    ok = wf("window.calls.alice.callState === 'connected' && window.calls.bob.callState === 'connected'", 20000)
    check('both sides reach "connected"', ok, f"alice={state('alice')} bob={state('bob')}")

    print('3. Media is actually flowing')
    check('alice receives audio and video from bob', wf("window.calls.alice.remoteStream && window.calls.alice.remoteStream.getAudioTracks().length === 1 && window.calls.alice.remoteStream.getVideoTracks().length === 1"))
    check('bob receives audio and video from alice', wf("window.calls.bob.remoteStream && window.calls.bob.remoteStream.getAudioTracks().length === 1 && window.calls.bob.remoteStream.getVideoTracks().length === 1"))
    flowing = ev("""(async () => {
        const pc = window.__pcs.find(p => p.connectionState === 'connected');
        const a = [...(await pc.getStats()).values()].filter(s => s.type === 'inbound-rtp').reduce((n, s) => n + s.bytesReceived, 0);
        await new Promise(r => setTimeout(r, 1200));
        const b = [...(await pc.getStats()).values()].filter(s => s.type === 'inbound-rtp').reduce((n, s) => n + s.bytesReceived, 0);
        return b > a;
    })()""")
    check('bytes keep arriving over the connection', flowing)

    print('4. Tuning applied')
    sdp = ev("window.__pcs.map(p => (p.localDescription || {}).sdp || '').join('\\n')")
    check('Opus uses FEC + DTX + mono + capped bitrate', all(k in sdp for k in ['useinbandfec=1', 'usedtx=1', 'stereo=0', 'maxaveragebitrate=32000']))
    check('echo cancellation requested on the microphone', ev("window.calls.alice.localStream.getAudioTracks()[0].getSettings().echoCancellation !== false"))
    enc = ev("""window.__pcs.filter(p => p.connectionState === 'connected').map(p => p.getSenders().map(s => ({ k: s.track && s.track.kind, e: s.getParameters().encodings[0] })))""")
    flat = [x for pc in enc for x in pc]
    check('audio sender capped at 32 kbps', any(x['k'] == 'audio' and x['e'].get('maxBitrate') == 32000 for x in flat), flat)
    check('video sender has a bitrate cap', any(x['k'] == 'video' and x['e'].get('maxBitrate') for x in flat), flat)

    print('5. Quality indicator')
    check('quality samples appear', wf("window.calls.alice.quality && ['good','fair','poor'].includes(window.calls.alice.quality.level)", 8000))
    check('signal bars drawn on the call screen', ev("!!document.querySelector('[data-user=alice] .call-signal')"))

    print('6. Mute / camera state is shared with the other person')
    ev('window.calls.alice.toggleMute()')
    check('bob sees that alice is muted', wf('window.calls.bob.remoteMedia.muted === true', 5000))
    check('bob\'s screen shows the muted badge', ev("(document.querySelector('[data-user=bob] .call-badge') || {}).textContent || ''").find('muted') >= 0)
    ev('window.calls.alice.toggleMute()')
    check('and sees it clear again', wf('window.calls.bob.remoteMedia.muted === false', 5000))
    ev('window.calls.bob.toggleCamera()')
    check('alice sees that bob turned his camera off', wf('window.calls.alice.remoteMedia.cameraOff === true', 5000))
    ev('window.calls.bob.toggleCamera()')

    print('7. Recovering a dropped connection')
    before = signals('restart-offer')
    ev('window.calls.alice.reconnect()')
    check('caller sends an ICE-restart offer', wf(f"window.__signals.filter(s => s.event === 'restart-offer').length > {before}", 5000))
    check('callee answers it', wf("window.__signals.filter(s => s.event === 'restart-answer').length >= 1", 8000))
    check('call stays connected after the restart', state('alice') == 'connected' and state('bob') == 'connected')
    still = ev("""(async () => {
        const pc = window.__pcs.find(p => p.connectionState === 'connected');
        const sum = async () => [...(await pc.getStats()).values()].filter(s => s.type === 'inbound-rtp').reduce((n, s) => n + s.bytesReceived, 0);
        const a = await sum(); await new Promise(r => setTimeout(r, 1200)); return (await sum()) > a;
    })()""")
    check('media still flows after the restart', still)

    before_req = signals('restart-request'); before_off = signals('restart-offer')
    ev('window.calls.bob.reconnect()')
    check('callee can ask the caller to restart', wf(f"window.__signals.filter(s => s.event === 'restart-request').length > {before_req}", 5000))
    check('caller then offers the restart', wf(f"window.__signals.filter(s => s.event === 'restart-offer').length > {before_off}", 5000))

    # simulate the browser reporting a failed link on alice's side
    ev("""(() => {
        window.__alicePc = window.__pcs[0];
        Object.defineProperty(window.__alicePc, 'connectionState', { configurable: true, get: () => 'disconnected' });
        window.__alicePc.onconnectionstatechange();
    })()""")
    check('a dropped link shows "reconnecting"', wf("window.calls.alice.callState === 'reconnecting' || window.calls.bob.callState === 'reconnecting'", 3000))
    check('the call screen shows the reconnecting banner', wf("!!document.querySelector('.call-banner-warn')", 3000))
    before = signals('restart-offer')
    check('after a short grace period it restarts on its own', wf(f"window.__signals.filter(s => s.event === 'restart-offer').length > {before}", 8000))
    ev("""(() => { delete window.__alicePc.connectionState; window.__alicePc.onconnectionstatechange(); })()""")
    check('call returns to "connected" once the link is back', wf("window.calls.alice.callState === 'connected'", 5000), state('alice'))

    print('8. Giving up cleanly when the link never recovers')
    ev("""(() => {
        window.__alicePc = window.__pcs[0];
        Object.defineProperty(window.__alicePc, 'connectionState', { configurable: true, get: () => 'failed' });
        for (let i = 0; i < 6; i++) { if (window.__alicePc.onconnectionstatechange) window.__alicePc.onconnectionstatechange(); }
    })()""")
    check('after repeated failures the call ends with a clear message', wf("window.calls.alice.callState === 'idle' && window.calls.alice.error.includes('Connection lost')", 5000), f"{state('alice')} / {ev('window.calls.alice.error')}")
    check('the other person is released too (not stuck in a dead call)', wf("window.calls.bob.callState === 'idle'", 8000), state('bob'))

    print('9. Declining + call log')
    ev(f"window.calls.alice.startCall({json.dumps(BOB)}, 'audio')")
    wf("window.calls.bob.incomingCall", 8000)
    ev('window.calls.bob.declineCall()')
    check('alice is told the call was declined', wf("window.calls.alice.error.includes('declined')", 6000), ev('window.calls.alice.error'))
    check('the declined call is logged', ev("window.__calls.some(c => c.status === 'declined')"))

    print('10. Ending a normal call')
    ev(f"window.calls.carol.startCall({json.dumps(BOB)}, 'audio')")
    wf("window.calls.bob.incomingCall", 8000)
    ev('window.calls.bob.acceptCall()')
    wf("window.calls.carol.callState === 'connected' && window.calls.bob.callState === 'connected'", 20000)
    check('an audio-only call connects', state('carol') == 'connected', state('carol'))
    ev('window.calls.carol.endCall()')
    check('the other side hangs up too', wf("window.calls.bob.callState === 'idle'", 8000))
    check('the completed call is logged with a duration', ev("window.__calls.some(c => c.status === 'completed')"))

    print('11. Friendly errors before a call starts')
    ev("Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })")
    ev(f"window.calls.alice.startCall({json.dumps(BOB)}, 'video')")
    check('offline: clear message, no call started', wf("window.calls.alice.error.includes('offline')", 3000) and state('alice') == 'idle', ev('window.calls.alice.error'))
    ev("delete navigator.onLine")
    ev("""(() => { window.__gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); })()""")
    ev(f"window.calls.alice.startCall({json.dumps(BOB)}, 'video')")
    check('permission denied: explains how to fix it', wf("window.calls.alice.error.toLowerCase().includes('permission')", 3000), ev('window.calls.alice.error'))
    check('the message is visible on screen even though no call is active', wf("!!document.querySelector('[data-user=alice] .call-toast')", 3000))
    ev('(() => { navigator.mediaDevices.getUserMedia = window.__gum; })()')

    check('no uncaught errors in the page', not errors, errors[:3])
    b.close()
srv.shutdown()

passed = sum(1 for _, ok in results if ok)
print(f'\n{passed}/{len(results)} checks passed')
sys.exit(0 if passed == len(results) else 1)
