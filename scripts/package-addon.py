#!/usr/bin/env python3
"""Package only the installable addon source files."""
from pathlib import Path
import zipfile
import shutil

root = Path(__file__).resolve().parents[1]
source = root / 'addon' / 'HelpingHand'
target = root / 'public' / 'downloads' / 'HelpingHand.zip'
target.parent.mkdir(parents=True, exist_ok=True)
files = ['HelpingHand.toc', 'Core.lua', 'Collect.lua', 'UI.lua', 'LICENSE', 'THIRD_PARTY.md']
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(source / name, 'HelpingHand/' + name)
bridge = root / 'scripts' / 'sync-addon.py'
shutil.copyfile(bridge, target.parent / 'sync-addon.py')
print('Created public/downloads/HelpingHand.zip and public/downloads/sync-addon.py')
