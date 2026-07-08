#!/usr/bin/env python3
# Dev-only static server that disables caching so edits to JS modules are always
# picked up on reload. Not part of the deployed site.
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4177
    HTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
