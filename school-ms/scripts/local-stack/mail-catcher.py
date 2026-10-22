"""LOCAL ONLY: catch outgoing auth emails (SMTP :2500) and list them over HTTP (:8025).
Equivalent to Supabase CLI's Inbucket/Mailpit. Never used in production."""
import asyncio, email, html, json, re, threading, time
from email import policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from aiosmtpd.controller import Controller

MESSAGES = []

class Handler:
    async def handle_DATA(self, server, session, envelope):
        msg = email.message_from_bytes(envelope.content, policy=policy.default)
        body = msg.get_body(preferencelist=('html', 'plain'))
        content = body.get_content() if body else ''
        links = re.findall(r'href="([^"]+)"', content) or re.findall(r'https?://\S+', content)
        MESSAGES.insert(0, {"id": len(MESSAGES) + 1, "to": envelope.rcpt_tos, "subject": str(msg['subject']),
                            "received": time.strftime('%Y-%m-%d %H:%M:%S'), "links": [html.unescape(l) for l in links],
                            "html": content})
        del MESSAGES[100:]
        return '250 OK'

class Web(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith('/api/messages'):
            data = json.dumps(MESSAGES).encode(); ctype = 'application/json'
        else:
            rows = ''.join(
                f"<div style='border:1px solid #ddd;border-radius:8px;padding:12px;margin:10px 0'>"
                f"<b>{html.escape(m['subject'])}</b> &rarr; {html.escape(', '.join(m['to']))} <small>{m['received']}</small>"
                + ''.join(f"<div><a href='{html.escape(l)}'>{html.escape(l[:120])}</a></div>" for l in m['links'])
                + "</div>" for m in MESSAGES) or '<p>No emails yet.</p>'
            data = (f"<!doctype html><meta name=viewport content='width=device-width'><title>Dev mailbox</title>"
                    f"<body style='font-family:system-ui;max-width:800px;margin:20px auto;padding:0 12px'>"
                    f"<h2>Local dev mailbox</h2><p style='color:#666'>Local stack only. Invitation and password-reset "
                    f"emails sent by Supabase Auth show up here.</p>{rows}</body>").encode()
            ctype = 'text/html; charset=utf-8'
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(data)))
        self.end_headers(); self.wfile.write(data)

if __name__ == '__main__':
    c = Controller(Handler(), hostname='127.0.0.1', port=2500); c.start()
    print('mail catcher: smtp 127.0.0.1:2500, http 127.0.0.1:8025', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8025), Web).serve_forever()
