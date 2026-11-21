"""Run the source checks with the system Lua 5.4 library."""

import ctypes
import ctypes.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ctypes.util.find_library("lua5.4") or ctypes.util.find_library("lua54")
if not LIBRARY:
    raise SystemExit("The addon source checks require the system Lua 5.4 library.")

lua = ctypes.CDLL(LIBRARY)
lua.luaL_newstate.restype = ctypes.c_void_p
lua.luaL_openlibs.argtypes = [ctypes.c_void_p]
lua.luaL_loadfilex.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
lua.luaL_loadfilex.restype = ctypes.c_int
lua.lua_pushlstring.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t]
lua.lua_pushlstring.restype = ctypes.c_void_p
lua.lua_pcallk.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ssize_t, ctypes.c_void_p]
lua.lua_pcallk.restype = ctypes.c_int
lua.lua_tolstring.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_size_t)]
lua.lua_tolstring.restype = ctypes.c_char_p
lua.lua_settop.argtypes = [ctypes.c_void_p, ctypes.c_int]
lua.lua_close.argtypes = [ctypes.c_void_p]


def check(state, status):
    if status:
        error = lua.lua_tolstring(state, -1, None)
        raise SystemExit(error.decode("utf-8", errors="replace") if error else "Lua check failed.")


state = lua.luaL_newstate()
if not state:
    raise SystemExit("Could not create the Lua test state.")
try:
    manifest = json.loads((ROOT / "vendor/addons/manifest.json").read_text())
    count = 0
    for source in manifest["sources"]:
        for entry in source["files"]:
            if entry["localPath"].endswith(".lua"):
                path = str(ROOT / entry["localPath"]).encode()
                check(state, lua.luaL_loadfilex(state, path, b"t"))
                lua.lua_settop(state, 0)
                count += 1
    print(f"Lua 5.4 syntax checks passed for {count} copied source files.", flush=True)
    lua.luaL_openlibs(state)
    check(state, lua.luaL_loadfilex(state, str(ROOT / "tests/addon-readers.test.lua").encode(), b"t"))
    root_arg = str(ROOT).encode()
    lua.lua_pushlstring(state, root_arg, len(root_arg))
    check(state, lua.lua_pcallk(state, 1, 0, 0, 0, None))
finally:
    lua.lua_close(state)
