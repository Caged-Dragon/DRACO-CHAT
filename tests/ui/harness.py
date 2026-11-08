import os
import json, base64, time, sys, threading, http.server, socketserver, functools, os, re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

DIST = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'dist'))
PORT = 4173
ME = '11111111-1111-4111-8111-111111111111'
F1 = '22222222-2222-4222-8222-222222222222'
F2 = '33333333-3333-4333-8333-333333333333'
F3 = '44444444-4444-4444-8444-444444444444'
G1 = '55555555-5555-4555-8555-555555555555'
G2 = '66666666-6666-4666-8666-666666666666'
NOW = '2026-10-24T10:00:00+00:00'

def prof(i, name, status=None):
    return {'id': i, 'username': name, 'avatar_url': None, 'status_message': status,
            'presence_status': 'online', 'last_seen_at': NOW, 'user_number': 7, 'created_at': NOW}
ME_P = prof(ME, 'ashwin', 'Building Dragon Chat')
FR = {F1: prof(F1, 'chandru', 'At the gym 💪'),
      F2: prof(F2, 'maya_the_developer_extra_long_name', 'A really long status message that should be truncated nicely instead of overflowing the row'),
      F3: prof(F3, 'Zed')}

def msg(i, sender, receiver, content=None, **kw):
    m = {'id': f'aaaaaaaa-0000-4000-8000-{i:012d}', 'sender_id': sender, 'receiver_id': receiver,
         'content': content, 'attachment_url': None, 'attachment_type': None, 'attachment_name': None,
         'created_at': f'2026-10-24T09:{i:02d}:00+00:00', 'reply_to_id': None, 'edited_at': None,
         'deleted_at': None, 'read_at': None, 'expires_at': None, 'pinned_at': None}
    m.update(kw); return m
MSGS = [
 msg(1, F1, ME, 'Hey! How is the new version going?'),
 msg(2, ME, F1, 'Great, shipping the mobile layout fixes today.'),
 msg(3, F1, ME, 'https://example.com/a/very/long/link/that/should/wrap/instead/of/overflowing/the/bubble/on/small/screens?query=1234567890'),
 msg(4, ME, F1, 'A much longer message to check wrapping behaviour: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'),
 msg(5, F1, ME, None, attachment_url='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="%238b5cf6"/></svg>', attachment_type='image', attachment_name='photo.png'),
 msg(6, ME, F1, None, attachment_url='https://x.test/file.pdf', attachment_type='file', attachment_name='quarterly-report-final-FINAL-v2-really-long-file-name.pdf'),
 msg(7, F1, ME, 'Reply test', reply_to_id='aaaaaaaa-0000-4000-8000-000000000004'),
 msg(8, ME, F1, 'Pinned one', pinned_at=NOW),
]
def gmsg(i, sender, content, **kw):
    m = msg(i, sender, None, content, **kw); m['group_id'] = G1; m['mentions'] = []
    m['id'] = f'bbbbbbbb-0000-4000-8000-{i:012d}'; del m['receiver_id']
    m['sender'] = {'id': sender, 'username': FR.get(sender, ME_P)['username'], 'avatar_url': None}
    return m
GMSGS = [gmsg(1, F1, 'Welcome to the group everyone!'), gmsg(2, ME, 'Thanks! Glad to be here.'),
         gmsg(3, F2, 'Check the long name sender and a long message body here to ensure wrapping works fine on a narrow phone screen.')]
GROUPS = [{'id': G1, 'name': 'Caged Dragon Studios Core Team — Planning', 'avatar_url': None, 'created_by': ME},
          {'id': G2, 'name': 'Study', 'avatar_url': None, 'created_by': F1}]
MEMBERS = [{'user_id': ME, 'last_read_at': NOW, 'role': 'admin', 'profiles': ME_P},
           {'user_id': F1, 'last_read_at': NOW, 'role': 'member', 'profiles': FR[F1]},
           {'user_id': F2, 'last_read_at': NOW, 'role': 'admin', 'profiles': FR[F2]},
           {'user_id': F3, 'last_read_at': NOW, 'role': 'member', 'profiles': FR[F3]}]

def jwt(aal='aal1'):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()
    return f"{b({'alg':'HS256','typ':'JWT'})}.{b({'sub':ME,'role':'authenticated','aal':aal,'exp':4102444800})}.sig"
FACTOR = {'id': 'factor-1', 'factor_type': 'totp', 'status': 'verified', 'friendly_name': 'Dragon Chat',
          'created_at': NOW, 'updated_at': NOW}
def make_user(with_factor=False):
    return {'id': ME, 'aud': 'authenticated', 'role': 'authenticated', 'email': 'ashwin@example.com',
            'app_metadata': {}, 'user_metadata': {}, 'created_at': NOW, 'factors': [FACTOR] if with_factor else []}
def make_session(aal='aal1', with_factor=False):
    return {'access_token': jwt(aal), 'refresh_token': 'r', 'expires_in': 3600, 'expires_at': 4102444800,
            'token_type': 'bearer', 'user': make_user(with_factor)}
USER = make_user(False)
SESSION = make_session('aal1', False)

# Knobs the tests flip while the app is running
STATE = {'post_mode': 'ok', 'posts': [], 'uploads': [], 'admin': False, 'reviews': [], 'mfa_user': False,
         'enroll': False,
         'reports': [{'id': 'r1', 'created_at': NOW, 'reason': 'Sending spam links', 'status': 'open', 'admin_note': None,
                      'reviewed_at': None, 'reporter_id': 'x1', 'reporter_username': 'maya', 'reported_id': 'x2',
                      'reported_username': 'spammer99', 'reported_suspended': False, 'reports_against_total': 3,
                      'message_content': 'Buy cheap stuff http://spam.example', 'message_attachment': None,
                      'message_created_at': NOW}]}

def handle(route, request):
    url = urlparse(request.url); path = url.path; q = parse_qs(url.query)
    def ok(body, status=200): route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
    method = request.method

    # ---- auth + two-step verification ----
    if path.startswith('/auth/v1/user'): return ok(make_user(STATE['mfa_user']))
    if path.endswith('/challenge'): return ok({'id': 'challenge-1', 'type': 'totp', 'expires_at': 4102444800})
    if path.endswith('/verify'):
        body = json.loads(request.post_data or '{}')
        if body.get('code') == '123456':
            STATE['mfa_user'] = True
            return ok(make_session('aal2', True))
        return ok({'code': 'mfa_verification_failed', 'error_code': 'mfa_verification_failed', 'msg': 'Invalid TOTP code entered', 'message': 'Invalid TOTP code entered'}, 400)
    if path.rstrip('/') == '/auth/v1/factors' and method == 'POST':
        STATE['enroll'] = True
        return ok({'id': 'factor-new', 'type': 'totp', 'friendly_name': 'Dragon Chat',
                   'totp': {'qr_code': 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
                            'secret': 'JBSWY3DPEHPK3PXP', 'uri': 'otpauth://totp/x'}})
    if path.startswith('/auth/v1/factors/') and method == 'DELETE': return ok({'id': 'factor-new'})
    if path.startswith('/auth/v1/'): return ok(SESSION)
    if path.startswith('/functions/'): return ok({})

    # ---- storage uploads (photos) ----
    if path.startswith('/storage/v1/object/') and method in ('POST', 'PUT'):
        STATE['uploads'].append({'path': path, 'type': request.headers.get('content-type', ''), 'body': request.post_data_buffer})
        return ok({'Key': path.split('/object/')[-1], 'Id': 'obj-1'})

    # ---- rpc ----
    if path.startswith('/rest/v1/rpc/'):
        fn = path.split('/rpc/')[-1]
        body = json.loads(request.post_data or '{}') if method == 'POST' else {}
        if fn == 'chat_group_unread_counts': return ok([{'group_id': G1, 'unread': 3}, {'group_id': G2, 'unread': 120}])
        if fn == 'chat_is_admin': return ok(bool(STATE['admin']))
        if fn == 'chat_admin_list_reports':
            want = body.get('p_status', 'open')
            return ok([r for r in STATE['reports'] if want == 'all' or r['status'] == want])
        if fn == 'chat_admin_review_report':
            STATE['reviews'].append(body)
            for r in STATE['reports']:
                if r['id'] == body.get('p_report_id'): r['status'] = body.get('p_status')
            return route.fulfill(status=204, body='')
        if fn == 'chat_export_my_data':
            return ok({'exported_at': NOW, 'account': {'id': ME, 'email': 'ashwin@example.com'}, 'profile': {'username': 'ashwin'},
                       'friends': [], 'direct_messages': [{'with': 'chandru', 'direction': 'sent', 'content': 'hi'}]})
        return ok(None)

    # ---- writes ----
    if method not in ('GET', 'HEAD'):
        if path.endswith('/chat_messages') and method == 'POST':
            mode = STATE['post_mode']
            if mode == 'offline': return route.abort('internetdisconnected')
            if mode == 'dup': return ok({'code': '23505', 'message': 'duplicate key value violates unique constraint "messages_pkey"'}, 409)
            if mode == 'rls': return ok({'code': '42501', 'message': 'new row violates row-level security policy for table "messages"'}, 403)
            try: STATE['posts'].append(json.loads(request.post_data or '{}'))
            except Exception: pass
        return route.fulfill(status=204, body='')

    table = path.split('/rest/v1/')[-1]
    sel = (q.get('select') or [''])[0]
    obj = 'object' in (request.headers.get('accept') or '')
    data = []
    if table == 'chat_profiles':
        data = [ME_P] if obj else [ME_P] + list(FR.values())
    elif table == 'chat_friendships':
        if 'pending' in (q.get('status') or [''])[0] or 'eq.pending' in str(q.get('status')):
            data = [{'id': 'f1', 'requester': {'id': 'x', 'username': 'pending_person'}}]
        else:
            data = [{'requester_id': ME, 'addressee_id': k, 'requester': ME_P, 'addressee': v} for k, v in FR.items()]
    elif table == 'chat_messages':
        data = [{'sender_id': F1}, {'sender_id': F1}, {'sender_id': F2}] if sel == 'sender_id' else MSGS
    elif table == 'chat_group_members':
        data = MEMBERS if 'role' in sel else [{'groups': g} for g in GROUPS]
    elif table == 'chat_group_messages':
        data = GMSGS
    elif table == 'chat_statuses':
        data = []
    if isinstance(data, list) and 'desc' in (q.get('order') or [''])[0]:
        data = list(reversed(data))
    if obj:
        if isinstance(data, list):
            if not data: return ok({'code': 'PGRST116', 'message': 'no rows'}, 406)
            data = data[0]
    route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve():
    h = functools.partial(Quiet, directory=DIST)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(('127.0.0.1', PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

def new_page(browser, w, h, mobile=True, dark=False, logged_in=True, session=None):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1,
                              has_touch=mobile, is_mobile=mobile, service_workers='block',
                              color_scheme='dark' if dark else 'light')
    if logged_in:
        ctx.add_init_script(f"localStorage.setItem('sb-mock-auth-token', {json.dumps(json.dumps(session or SESSION))});")
    # DRAGON_MODE=light runs the suite in light mode; the app defaults to dark.
    mode = os.environ.get('DRAGON_MODE', 'dark')
    ctx.add_init_script(f"localStorage.setItem('dragonchat.mode', {json.dumps(mode)});")
    pg = ctx.new_page()
    pg.route('https://mock.supabase.co/**', handle)
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    return ctx, pg, errors
