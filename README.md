# Folio

Folio is a local workspace for reviewing figures from financial reports, statements and receipts. Its dark workpaper pairs the original PDF and review form with a sortable Figure register. Select a highlight to open its finding, hover over the active source or citation to see the connection, or draw around a region to capture text for the citation. The heatmap distinguishes clear source evidence and verified figures from findings that need attention.

Reconciliation checks show variances for recognized financial and receipt totals while you edit. Save a figure and advance, or record an exclusion, hold or escalation with a reason code. Reviewers can assign findings, set priorities, and filter the queue by owner, priority or reason. Each workpaper keeps the original extraction, reviewer IDs, reasons, and before-and-after values in Activity history. Reviewer IDs are entered locally. You can share assignments and review history through a portable `.folio` backup.

The Figure register searches verified figures across imported documents and exports the filtered results to CSV with source quotes and notes. The workpaper's Excel export also includes findings, exception codes, assignments, and activity history. The sample report provides a practice workpaper, and figures saved there stay inside the sample.

The interface uses [Astryx](https://github.com/meta/astryx) for tables, cards and review controls.

## Run locally

Use Node 24 LTS. From this directory run:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:8031. The local server binds to loopback. The private Sites deployment uses the same frontend and extraction rules. The browser library stores original PDFs, indexes and reviews in IndexedDB on the current device. Export a .folio backup per document for portability. Previously imported PDFs open directly in the revised review queue.

## REST

POST binary PDF data to /api/v2/analyze. The local service runs bundled English OCR on pages with fewer than 24 extracted characters. The hosted REST endpoint reads the PDF text layer and returns sparse pages in needs_ocr. The browser performs English OCR locally on sparse pages and can run OCR on any selected page, including pages in previously imported files. A page OCR retry replaces that page’s search index and archives its old predictions. Saved citations retain their original text. The Agent MCP & Skill panel can configure a hosted HTTPS OCR provider for manual retries. The provider receives a PNG of the selected page or unreadable region and returns JSON with a `lines` array containing `text`, `box` coordinates in [left, top, right, bottom] order normalized to 0–1, and optional `confidence` from 0 to 100. The provider must allow the workbench origin via CORS.

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

Download the Windows installer, Linux archive, and illustrated product guide with the test run from the [Folio 1.2.0 release](https://github.com/dhia-eddine-mahdaoui/folio-review/releases/tag/v1.2.0). The Windows x64 installer installs Folio for the current user and creates Start menu and optional desktop shortcuts. For Linux x64 with glibc, extract the Linux archive and run `Folio/install-linux.sh`. Then open Folio Review in the application menu. The desktop launcher starts the local service and opens a standalone window when the default browser supports Chromium app mode. Other browsers open Folio in a tab using the same browser profile and library.

In Folio Desktop, open Agent MCP & Skill to preview, install or customize the local `folio-review` skill for detected Codex, Claude Code, Gemini CLI and Cursor profiles. Use Test connection to check that Folio MCP responds and advertises its tools. Add the displayed MCP URL to your agent client and start a new agent session after installing or updating its skill. Installed agents can also use the included CLI to extract and OCR PDFs while the workbench is closed. Uninstall from Windows Installed apps or run the installed Linux `uninstall.sh`. Folio preserves unmanaged and externally edited skills.

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
makensis -DPAYLOAD="$PWD/output/desktop-build/windows" -DVERSION=1.2.0 \
  -DOUTFILE="$PWD/output/installers/Folio-Review-1.2.0-x64-Setup.exe" desktop/installer.nsi
python3 desktop/stage.py linux output/desktop-build/Folio/app \
  --node /path/to/node-24.18.0/bin/node --node-license /path/to/node-24.18.0/LICENSE
cp desktop/*linux.sh output/desktop-build/Folio/
tar czf output/installers/Folio-Review-1.2.0-linux-x64.tar.gz -C output/desktop-build Folio
```
