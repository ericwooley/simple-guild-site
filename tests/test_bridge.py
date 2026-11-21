"""Exercise the bridge data boundary without a game client."""
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import zipfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'scripts/sync-addon.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ParserTests(unittest.TestCase):
    def test_selected_global_and_nested_arrays(self):
        data = bridge.LuaData('-- comment\nOtherDB = { ["private"] = "discard" }\nHelpingHandDB = { token="a.b.c", outbox={schemaVersion=1,snapshotId="one",characters={{name="First Surname",realm="Realm"}},banks={}}}').parse()
        payload = bridge.json_data(data['outbox'])
        self.assertEqual(payload['characters'][0]['name'], 'First Surname')
        self.assertEqual(payload['banks'], [])
        self.assertNotIn('OtherDB', payload)

    def test_does_not_execute_lua(self):
        for source in ['HelpingHandDB = os.execute("evil")', 'HelpingHandDB = {} os.execute("evil")', 'HelpingHandDB = {x=function() end}', 'HelpingHandDB = {x=0/0}']:
            with self.subTest(source=source), self.assertRaises(bridge.BridgeError):
                bridge.LuaData(source).parse()

    def test_malformed_duplicate_and_limits(self):
        for source in ['HelpingHandDB={x=1,x=2}', 'HelpingHandDB={a="bad\\q"}', 'HelpingHandDB={', 'HelpingHandDB=' + '{' * 34 + '}' * 34, 'HelpingHandDB={} HelpingHandDB={}']:
            with self.subTest(source=source), self.assertRaises(bridge.BridgeError):
                bridge.LuaData(source).parse()

    def test_private_fields_and_sparse_lists(self):
        for value in [{'characters': {2: {'name': 'x'}}}, {'banks': {1: {'hidden': {}}}}, {'token': 'secret'}]:
            with self.assertRaises(bridge.BridgeError):
                bridge.json_data(value)

    def test_endpoint_restrictions(self):
        self.assertEqual(bridge.endpoint('http://127.0.0.1:4321'), 'http://127.0.0.1:4321/api/sync')
        self.assertEqual(bridge.endpoint('https://guild.example'), 'https://guild.example/api/sync')
        for url in ['http://guild.example', 'https://user:password@guild.example', 'https://guild.example/?token=x', 'https://guild.example/#secret', 'file:///tmp/test', 'https://guild.example/other']:
            with self.assertRaises(bridge.BridgeError):
                bridge.endpoint(url)

    def test_token_separate_from_json_and_unrelated_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'HelpingHand.lua'
            path.write_text('OtherDB={hidden="private"}\nHelpingHandDB={token="aaa.bbb.ccc",outbox={schemaVersion=1,snapshotId="one",characters={}}}')
            token, body, _ = bridge.read_outbox(path)
            self.assertEqual(token, 'aaa.bbb.ccc')
            self.assertNotIn(b'aaa.bbb.ccc', body)
            self.assertNotIn(b'private', body)
            self.assertEqual(json.loads(body)['characters'], [])

    def test_upload_uses_header_and_no_redirect_handler(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, count): return b'{}'
        class Opener:
            def open(self, request, timeout):
                self.request = request
                self.timeout = timeout
                return Response()
        opener = Opener()
        with patch.object(bridge.urllib.request, 'build_opener', return_value=opener):
            bridge.upload('https://guild.example', 'aaa.bbb.ccc', b'{"snapshotId":"one"}')
        self.assertEqual(opener.request.get_header('Authorization'), 'Bearer aaa.bbb.ccc')
        self.assertNotIn('ccc', opener.request.full_url)
        self.assertEqual(opener.timeout, 20)
        self.assertIsNone(bridge.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example'))

    def test_package_contains_only_source_and_exact_bridge(self):
        root = Path(__file__).resolve().parents[1]
        subprocess.run([sys.executable, str(root / 'scripts/package-addon.py')], check=True, capture_output=True)
        download = root / 'public/downloads'
        self.assertEqual((download / 'sync-addon.py').read_bytes(), (root / 'scripts/sync-addon.py').read_bytes())
        allowed = {'HelpingHand.toc', 'Core.lua', 'Collect.lua', 'UI.lua', 'LICENSE', 'THIRD_PARTY.md'}
        with zipfile.ZipFile(download / 'HelpingHand.zip') as archive:
            self.assertEqual(set(archive.namelist()), {'HelpingHand/' + name for name in allowed})
            for name in allowed:
                self.assertEqual(archive.read('HelpingHand/' + name), (root / 'addon/HelpingHand' / name).read_bytes())
        # An exact source allowlist excludes saved tokens and local configuration.
        self.assertFalse(any(name.endswith(('.env', 'HelpingHand.lua', '.bak')) for name in allowed))

    def test_file_size_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'large.lua'
            path.write_bytes(b' ' * (bridge.MAX_BYTES + 1))
            with self.assertRaises(bridge.BridgeError):
                bridge.read_outbox(path)


if __name__ == '__main__':
    unittest.main()
