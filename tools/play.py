"""通过回环地址运行第一幕。使用 Python 标准库。"""

import argparse
import json
import re
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
ART = json.loads((ROOT / 'data/assets.json').read_text(encoding='utf-8'))['assets']
ROUTES = {'/', '/index.html', '/game/style.css'}
ROUTES.update(f'/game/{name}.mjs' for name in ('app', 'engine', 'narration', 'sound'))
ROUTES.update(f'/data/{name}.json' for name in ('scenes', 'items', 'achievements', 'pathways', 'assets'))
ROUTES.update('/' + asset['path'] for asset in ART)


class GameServer(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR allows a second process to bind the same address.
    allow_reuse_address = sys.platform != 'win32'


class GameHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.webp': 'image/webp'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        path = urlsplit(self.path).path
        prefix = self.server.base_path
        if not path.startswith(prefix):
            self.send_error(404)
            return None
        path = '/' + path[len(prefix):]
        if path == '/art.json':
            found = {
                asset['id']: prefix + asset['path']
                for asset in ART
                if (ROOT / asset['path']).is_file()
            }
            content = json.dumps(found).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return BytesIO(content)
        if path not in ROUTES:
            self.send_error(404)
            return None
        self.path = path
        return super().send_head()


def main():
    parser = argparse.ArgumentParser(description='运行《诡秘之主：血雾班西》第一幕')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--open', action='store_true', help='打开系统默认浏览器')
    parser.add_argument('--base-path', default='/', help='模拟仓库子路径，例如 /preview/')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('端口必须在 0 至 65535 之间')
    if not re.fullmatch(r'/(?:[A-Za-z0-9_-]+/)*', args.base_path):
        parser.error('base-path 必须以 / 开头和结尾，目录名使用字母、数字、下划线或连字符')
    try:
        server = GameServer(('127.0.0.1', args.port), GameHandler)
    except OSError:
        print(f'无法监听 127.0.0.1:{args.port}。请检查端口占用。若游戏已启动，请打开原地址继续。', file=sys.stderr)
        return 1
    with server:
        server.base_path = args.base_path
        address = f'http://127.0.0.1:{server.server_port}{server.base_path}'
        print(f'{address}', flush=True)
        print('保持此窗口开启。结束游玩后可按 Ctrl+C 停止服务。', flush=True)
        if args.open:
            if not webbrowser.open(address):
                print('浏览器未自动打开。请将上面的地址粘贴到 Edge 或 Chrome。', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    raise SystemExit(main())
