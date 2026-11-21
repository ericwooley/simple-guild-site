#!/usr/bin/env python3
"""Upload one selected addon outbox without executing SavedVariables."""
import argparse
import hashlib
import http.client
import ipaddress
import json
from pathlib import Path
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

MAX_BYTES = 8 * 1024 * 1024
MAX_NODES = 150000


class BridgeError(ValueError):
    pass


class LuaData:
    def __init__(self, source):
        self.source = source
        self.pos = 0
        self.nodes = 0

    def space(self):
        while self.pos < len(self.source):
            match = re.match(r'(?:\s+|--[^\n]*(?:\n|$))', self.source[self.pos:])
            if not match:
                return
            self.pos += len(match[0])

    def take(self, char):
        self.space()
        if self.source.startswith(char, self.pos):
            self.pos += len(char)
            return True
        return False

    def require(self, char):
        if not self.take(char):
            raise BridgeError('The saved file contains unsupported Lua syntax. Use the HelpingHand.lua saved file.')

    def name(self):
        self.space()
        match = re.match(r'[A-Za-z_][A-Za-z0-9_]*', self.source[self.pos:])
        if not match:
            raise BridgeError('The saved file contains an invalid data name.')
        self.pos += len(match[0])
        return match[0]

    def string(self):
        quote = self.source[self.pos]
        self.pos += 1
        chars = []
        escapes = {'a': '\a', 'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t', 'v': '\v', '\\': '\\', '"': '"', "'": "'"}
        while self.pos < len(self.source):
            char = self.source[self.pos]
            self.pos += 1
            if char == quote:
                return ''.join(chars)
            if char == '\\':
                if self.pos >= len(self.source):
                    break
                char = self.source[self.pos]
                self.pos += 1
                if char.isdigit() and char.isascii():
                    digits = char
                    for _ in range(2):
                        if self.pos < len(self.source) and self.source[self.pos].isdigit() and self.source[self.pos].isascii():
                            digits += self.source[self.pos]
                            self.pos += 1
                        else:
                            break
                    if int(digits) > 255:
                        raise BridgeError('The saved file contains an invalid string escape.')
                    chars.append(chr(int(digits)))
                elif char in escapes:
                    chars.append(escapes[char])
                else:
                    raise BridgeError('The saved file contains an unsupported string escape.')
            elif char in '\r\n' or ord(char) < 32:
                raise BridgeError('The saved file contains an invalid string.')
            else:
                chars.append(char)
        raise BridgeError('The saved file contains an incomplete string. Use /reload and try again.')

    def value(self, depth=0):
        self.space()
        self.nodes += 1
        if depth > 32 or self.nodes > MAX_NODES:
            raise BridgeError('The saved file exceeds the supported data limits.')
        if self.pos >= len(self.source):
            raise BridgeError('The saved file is incomplete. Use /reload and try again.')
        if self.source[self.pos] in '\"\'':
            return self.string()
        if self.take('{'):
            values = {}
            index = 1
            while not self.take('}'):
                if self.take('['):
                    key = self.value(depth + 1)
                    if type(key) not in (str, int):
                        raise BridgeError('The saved file contains an invalid table key.')
                    self.require(']')
                    self.require('=')
                else:
                    saved = self.pos
                    match = re.match(r'([A-Za-z_][A-Za-z0-9_]*)\s*=', self.source[self.pos:])
                    if match:
                        key = match[1]
                        self.pos += len(match[0])
                    else:
                        self.pos = saved
                        key = index
                        index += 1
                if key in values:
                    raise BridgeError('The saved file contains a duplicate table key.')
                values[key] = self.value(depth + 1)
                if not self.take(',') and not self.take(';'):
                    self.require('}')
                    break
            return values
        for literal, value in [('true', True), ('false', False), ('nil', None)]:
            if re.match(literal + r'\b', self.source[self.pos:]):
                self.pos += len(literal)
                return value
        match = re.match(r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', self.source[self.pos:])
        if match:
            self.pos += len(match[0])
            number = float(match[0])
            if not number.is_integer() or abs(number) > 2**53 - 1:
                raise BridgeError('The saved file contains an unsupported number.')
            return int(number)
        raise BridgeError('The saved file contains executable or unsupported Lua syntax.')

    def parse(self):
        selected = None
        seen = set()
        while True:
            self.space()
            if self.pos == len(self.source):
                break
            name = self.name()
            if name in seen:
                raise BridgeError('The saved file repeats a global variable.')
            seen.add(name)
            self.require('=')
            value = self.value()
            if name == 'HelpingHandDB':
                selected = value
        if type(selected) is not dict:
            raise BridgeError('HelpingHandDB is missing. Select the correct account SavedVariables file.')
        return selected


ARRAY_FIELDS = {'characters', 'professions', 'recipes', 'members', 'banks', 'items'}


def json_data(value, field=None):
    if isinstance(value, dict):
        if field in ARRAY_FIELDS:
            if set(value) != set(range(1, len(value) + 1)):
                raise BridgeError('The outbox contains an invalid list.')
            return [json_data(value[index]) for index in range(1, len(value) + 1)]
        if any(type(key) is not str for key in value):
            raise BridgeError('The outbox contains an invalid object.')
        if any(key.lower() in {'token', 'authorization', 'hidden', 'password', 'secret'} for key in value):
            raise BridgeError('The outbox contains private fields. Capture again with the current addon.')
        return {key: json_data(item, key) for key, item in value.items() if item is not None}
    return value


def read_outbox(path):
    try:
        with Path(path).open('rb') as handle:
            data = handle.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise BridgeError('The saved file exceeds 8 MiB.')
        db = LuaData(data.decode('utf-8-sig')).parse()
    except (OSError, UnicodeError):
        raise BridgeError('Cannot read the saved file. Check its path and use /reload.') from None
    token = db.get('token')
    if not isinstance(token, str) or len(token) > 4096 or not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', token):
        raise BridgeError('Save a valid website sync token in the addon, then use /reload.')
    payload = json_data(db.get('outbox'))
    if not isinstance(payload, dict) or payload.get('schemaVersion') != 1 or not payload.get('snapshotId'):
        raise BridgeError('The outbox is empty or unsupported. Capture data in the addon, then use /reload.')
    body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(body) > MAX_BYTES:
        raise BridgeError('The outbox exceeds the upload limit.')
    return token, body, payload


def endpoint(url):
    try:
        if any(ord(char) <= 32 or ord(char) == 127 for char in url):
            raise ValueError()
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname
        if not host or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError()
        if parsed.port is not None and not 0 < parsed.port < 65536:
            raise ValueError()
        loopback = host.lower() == 'localhost'
        try:
            loopback = loopback or ipaddress.ip_address(host).is_loopback
        except ValueError:
            pass
        if parsed.scheme != 'https' and not (parsed.scheme == 'http' and loopback):
            raise ValueError()
        if parsed.path not in ('', '/', '/api/sync'):
            raise ValueError()
        return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '/api/sync', '', ''))
    except ValueError:
        raise BridgeError('Use an HTTPS website URL, or a loopback HTTP development URL.') from None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def upload(url, token, body):
    request = urllib.request.Request(endpoint(url), body, {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=20) as response:
            response.read(16384)
    except urllib.error.HTTPError as error:
        messages = {401: 'The website rejected this token. Generate a replacement token.',
                    403: 'The website denied this sync. Check token scope and verified characters.',
                    409: 'The website rejected a conflicting snapshot. Capture again.',
                    413: 'The website rejected the upload size.',
                    422: 'The website rejected the snapshot. Check identities and addon version.'}
        raise BridgeError(messages.get(error.code, 'The website rejected the sync. Check website status and server logs.')) from None
    except (OSError, urllib.error.URLError, http.client.HTTPException):
        raise BridgeError('Cannot reach the website. Check its URL and connection, then retry.') from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', required=True, help='Account SavedVariables/HelpingHand.lua path')
    parser.add_argument('--url', required=True, help='Website URL')
    parser.add_argument('--once', action='store_true', help='Upload once (default)')
    parser.add_argument('--watch', action='store_true', help='Check for changed captures every five seconds')
    parser.add_argument('--dry-run', action='store_true', help='Validate locally and show counts without uploading')
    args = parser.parse_args(argv)
    if args.once and args.watch:
        parser.error('Choose --once or --watch.')
    previous = None
    try:
        endpoint(args.url)
        while True:
            token, body, payload = read_outbox(args.file)
            digest = hashlib.sha256(body).hexdigest()
            if digest != previous:
                if args.dry_run:
                    print('Valid capture: {} characters, {} roster members, {} banks.'.format(len(payload.get('characters', [])), len(payload.get('roster', {}).get('members', [])), len(payload.get('banks', []))))
                else:
                    upload(args.url, token, body)
                    print('Website accepted the capture.', flush=True)
                previous = digest
            if not args.watch or args.dry_run:
                return 0
            time.sleep(5)
    except BridgeError as error:
        print(str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
