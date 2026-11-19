# Folio

Folio turns financial report highlights and receipt totals into a review queue. Each finding carries its source page and text. Select a finding to inspect the original, correct its fields, and save it to the register. Receipt checks compare a single subtotal plus recognized tax and tip against the total. Workbooks separate reviewed figures from proposed findings. CSV exports only reviewed figures.

## Run locally

Use Node 24 LTS. From this directory run:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:8031. The local server binds to loopback. The private Sites deployment uses the same frontend and extraction rules. The browser library stores original PDFs, indexes and reviews in IndexedDB on the current device. Export a .folio backup per document for portability. Previously imported PDFs open directly in the revised review queue.

## REST

POST binary PDF data to /api/v2/analyze. The local service runs bundled English OCR on pages with fewer than 24 extracted characters. The hosted REST endpoint reads the PDF text layer and returns sparse pages in needs_ocr. The browser performs English OCR locally on sparse pages and can run OCR on any selected page, including pages in previously imported files. A page OCR retry replaces that page’s search index. Saved citations retain their original text.

```sh
curl --fail-with-body -H 'Content-Type: application/pdf' \
  --data-binary @report.pdf http://127.0.0.1:8031/api/v2/analyze
```

Alternatively POST JSON with a pages array of strings. Separate visual rows with newlines and preserve page order. The response includes findings, source quotes, page numbers, proposed units and periods, receipt_check and needs_ocr. Inputs are limited to 8 MiB, 150 pages and 1.5 million extracted characters for automation requests. Browser imports support 50 MB and 1,000 pages. Inputs sent to REST or MCP are processed per request. Neither endpoint reads the browser’s private library.

## MCP

Use the streamable HTTP URL http://127.0.0.1:8031/mcp with a local MCP client. The private hosted Site exposes the same route with Sites authentication. The tools are analyze_pdf (pdf_base64, up to 6 MiB before encoding, with additional JSON overhead counted toward the request limit) and analyze_text (pages). Both return structured results as JSON text. GET /api/v2 describes the wire format.

## Extraction and review

The extractor recognizes explicit financial metrics and receipt summary lines, including growth narratives that report both a percentage and an ending amount. On English-language statements of operations, balance sheets and cash flows, Folio extracts labeled numeric cells, links date and duration headers, and applies the stated scale with share-count and EPS exceptions. Ambiguous column counts, missing context and failed arithmetic checks require review. Findings carry the reported value, normalized amount, row and header evidence. PDF inputs can include normalized cell coordinates. Text inputs must preserve row and column order. Extraction status describes the recognized observations. It does not certify document completeness. MCP supports optional metric, page, offset and limit filters. Use Search for arbitrary fields or select an area on the original. An empty unit or period means the extractor could not establish it. A $ symbol stays ambiguous unless the document supplies a currency code. English OCR accuracy depends on image quality. The extractor uses rules and local OCR. Connecting an AI client is optional.

The original Python service is available separately via `uvicorn folio.api:app` for existing /api/extract integrations.

## Desktop installation and agent skills

The Windows x64 installer in `output/installers` installs Folio for the current user, creates Start menu and desktop shortcuts, and offers to add the `folio-review` skill to detected Codex, Claude Code, Gemini CLI and Cursor profiles. Run setup again after adding another agent. The Windows application opens the local workbench in the default browser. Installed agents can extract and OCR PDFs directly using the included CLI even when the browser is closed. Uninstall from Windows Installed apps. Modified agent skill files are preserved.

For Linux x64 with glibc, extract the Linux archive and run `Folio/install-linux.sh`. Open Folio Review in the application menu, or use the executable at `~/.local/share/folio-review/folio`. Remove the installation using its `uninstall.sh`. Start a new agent session to refresh the skill list.

### Rebuild distribution packages on Linux x64

Run `npm ci && npm run build`. The staging script copies the pinned frontend and runtime dependencies into a new directory. Supply Node 24, its matching license, and the native Windows canvas package matching the installed canvas version.

```sh
mkdir -p output/installers output/desktop-build
cd output/desktop-build
npm pack node-win-x64@24.18.0 @napi-rs/canvas-win32-x64-msvc@1.1.1
cd ../..
python3 desktop/stage.py windows output/desktop-build/windows \
  --node output/desktop-build/node-win-x64-24.18.0.tgz \
  --canvas output/desktop-build/napi-rs-canvas-win32-x64-msvc-1.1.1.tgz \
  --node-license /path/to/node-24.18.0/LICENSE
makensis -DPAYLOAD="$PWD/output/desktop-build/windows" -DVERSION=1.0.0 \
  -DOUTFILE="$PWD/output/installers/Folio-Review-1.0.0-x64-Setup.exe" desktop/installer.nsi
python3 desktop/stage.py linux output/desktop-build/Folio/app \
  --node /path/to/node-24.18.0/bin/node --node-license /path/to/node-24.18.0/LICENSE
cp desktop/*linux.sh output/desktop-build/Folio/
tar czf output/installers/Folio-Review-1.0.0-linux-x64.tar.gz -C output/desktop-build Folio
```
