#!/usr/bin/env python3
# Servidor local con los encabezados que WeedJS necesita (SharedArrayBuffer): python3 servir.py [puerto]
import functools, http.server, sys, os
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin"); self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin"); self.send_header("Cache-Control", "no-cache"); super().end_headers()
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f"http://localhost:{port}/"); http.server.ThreadingHTTPServer(("", port), functools.partial(H, directory=os.path.dirname(os.path.abspath(__file__)))).serve_forever()
