import subprocess
import sys
import unittest
from contextlib import contextmanager
from urllib.parse import urlsplit
from urllib.request import urlopen


def launcher(port, base_path='/'):
    return [sys.executable, '-X', 'utf8', 'tools/play.py', '--port', str(port), '--base-path', base_path]


@contextmanager
def running_game(port=0, base_path='/'):
    with subprocess.Popen(launcher(port, base_path), stdout=subprocess.PIPE, text=True, encoding='utf-8') as process:
        try:
            yield process.stdout.readline().strip()
        finally:
            process.terminate()
            process.wait(timeout=5)


class LauncherTest(unittest.TestCase):
    def test_serves_repository_subpath_resources(self):
        with running_game(base_path='/preview/') as url:
            self.assertTrue(url.endswith('/preview/'))
            for path in ('', 'game/app.mjs', 'data/items.json', 'assets/backgrounds/hunter_awakening.webp'):
                with urlopen(url + path, timeout=5) as response:
                    self.assertEqual(response.status, 200)
                    if path.endswith('.webp'):
                        self.assertEqual(response.headers.get_content_type(), 'image/webp')
                        signature = response.read(12)
                        self.assertEqual(signature[:4], b'RIFF')
                        self.assertEqual(signature[8:12], b'WEBP')

    def test_rejects_second_instance_and_restarts_on_original_port(self):
        with running_game() as url:
            port = urlsplit(url).port
            with urlopen(url, timeout=5) as response:
                self.assertEqual(response.status, 200)
            duplicate = subprocess.run(launcher(port), capture_output=True, text=True, encoding='utf-8', timeout=5)
            self.assertEqual(duplicate.returncode, 1)
            self.assertIn(str(port), duplicate.stderr)
        with running_game(port) as restarted:
            self.assertEqual(restarted, url)
