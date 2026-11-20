"""Stage a private desktop runtime from the built client and installed dependencies."""
import argparse
import json
import shutil
import tarfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('target', choices=['windows', 'linux'])
parser.add_argument('destination', type=Path)
parser.add_argument('--node', required=True, type=Path, help='Windows npm node-win-x64 tarball or Linux Node 24 executable')
parser.add_argument('--node-license', required=True, type=Path)
parser.add_argument('--canvas', type=Path, help='Matching @napi-rs/canvas-win32-x64-msvc npm tarball')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
dest = args.destination.resolve()
dest.mkdir(parents=True, exist_ok=False)

def copy_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)

def npm_tar(archive, target, member=None):
    with tarfile.open(archive) as tar:
        for entry in tar.getmembers():
            if not entry.isfile() or (member and entry.name != member):
                continue
            path = Path(entry.name).relative_to('package')
            if '..' in path.parts:
                raise ValueError('Invalid archive path')
            out = target if member else target / path
            out.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(entry) as src, out.open('wb') as dst:
                shutil.copyfileobj(src, dst)

for path in ['dist/client', 'server', 'desktop/skills']:
    shutil.copytree(root / path, dest / path)
for path in ['package.json','src/findings.ts','src/statements.ts','src/taxonomy.ts','src/bridgeCatalog.ts','desktop/cli.mjs','desktop/agents.mjs','desktop/launch.mjs']:
    copy_file(root / path, dest / path)
copy_file(args.node_license, dest / 'licenses/node.txt')
# Inside server/ so the Linux CLI wrapper can occupy the top-level `folio` path.
copy_file(root / 'folio/docling_layout.py', dest / 'server/docling_layout.py')

seen = set()
def package(name):
    if name in seen:
        return
    seen.add(name)
    source = root / 'node_modules' / name
    target = dest / 'node_modules' / name
    info = json.loads((source / 'package.json').read_text())
    if name == 'pdfjs-dist':
        for path in ['package.json','LICENSE','legacy/build/pdf.mjs','legacy/build/pdf.worker.mjs']:
            copy_file(source / path, target / path)
        for directory in ['standard_fonts','wasm','cmaps']:
            shutil.copytree(source / directory, target / directory)
    else:
        shutil.copytree(source,target,ignore=shutil.ignore_patterns('*.map','test','tests','.github','node_modules'))
    for dep in info.get('dependencies',{}):
        package(dep)

for name in ['pdfjs-dist','tesseract.js','ws','@napi-rs/canvas']:
    package(name)
if args.target == 'windows':
    npm_tar(args.canvas,dest / 'node_modules/@napi-rs/canvas-win32-x64-msvc')
    npm_tar(args.node,dest / 'node.exe','package/bin/node.exe')
    for name in ['launch.vbs','folio.cmd','stop-service.ps1','folio.ico']:
        copy_file(root / 'desktop' / name,dest / name)
else:
    package('@napi-rs/canvas-linux-x64-gnu')
    copy_file(args.node,dest / 'node')
    copy_file(root / 'desktop/folio',dest / 'folio')
