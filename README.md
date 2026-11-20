# Folio 2.0

Folio is a local workspace for reviewing figures from financial reports, statements and receipts. Its dark workpaper pairs the original PDF and review form with a sortable Figure register. Select a highlight to open its finding, hover over the active source or citation to see the connection, or draw around a region to capture text for the citation. The heatmap distinguishes clear source evidence and verified figures from findings that need attention.

Review figures in their source units and check the live normalized amount before saving. Select a reconciliation banner to see the equation and its operand locations on the PDF. The queue tracks Pending, On Hold, Escalated, Verified, and Excluded findings. Saving a figure also saves its assignee and priority. Set the active reviewer in the workspace header or **Agent MCP & Bridge**.

Activity history links every event to its predecessor and the source PDF using SHA-256. Folio verifies the event chain and manifest when restoring a version 2 `.folio` backup. Legacy backups are imported with a chain created at migration. Reviewer IDs are self-entered. The archive carries a local integrity chain.

The Figure register searches verified figures across imported documents and exports the filtered results to CSV with source quotes and notes. The workpaper's Excel export also includes findings, exception codes, assignments, and activity history. The sample report provides a practice workpaper, and figures saved there stay inside the sample.

The interface uses [Astryx](https://github.com/meta/astryx) for tables, cards and review controls.

## Run locally

Use Node 24 LTS. From this directory run:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:8031. The local server binds to loopback. The private Sites deployment uses the same frontend and extraction rules. Folio stores PDFs, workpapers and the figure register in SQLite-WASM inside a Web Worker using OPFS. The browser migrates existing IndexedDB workpapers on first launch and uses IndexedDB on profiles without OPFS support. Export a `.folio` backup per document for portability.

## REST

POST binary PDF data to /api/v2/analyze. The local service runs bundled English OCR on pages with fewer than 24 extracted characters. The hosted REST endpoint reads the PDF text layer and returns sparse pages in needs_ocr. The browser performs English OCR locally on sparse pages and can run OCR on any selected page, including pages in previously imported files. A page OCR retry replaces that page’s search index and archives its old predictions. Saved citations retain their original text. The Agent MCP & Bridge panel can configure a hosted HTTPS OCR provider for manual retries. The provider receives a PNG of the selected page or unreadable region and returns JSON with a `lines` array containing `text`, `box` coordinates in [left, top, right, bottom] order normalized to 0–1, and optional `confidence` from 0 to 100. The provider must allow the workbench origin via CORS.

```sh
curl --fail-with-body -H 'Content-Type: application/pdf' \
  --data-binary @report.pdf http://127.0.0.1:8031/api/v2/analyze
```

Alternatively POST JSON with a pages array of strings. Separate visual rows with newlines and preserve page order. The response includes findings, source quotes, page numbers, proposed units and periods, receipt_check and needs_ocr. Inputs are limited to 8 MiB, 150 pages and 1.5 million extracted characters for automation requests. Browser imports support 50 MB and 1,000 pages. REST and the two analysis tools process only the data supplied in their request.

## MCP

Use the streamable HTTP URL http://127.0.0.1:8031/mcp with a local MCP client. The private hosted Site exposes the same route with Sites authentication. The existing `analyze_pdf` and `analyze_text` tools remain available on both the modern stateless transport and the legacy handshake. `GET /api/v2` describes their wire format. The hosted deployment serves these analysis tools.

In Folio Desktop, open **Agent MCP & Bridge**, enable workspace sharing, and set consent for individual tools. The three `folio://` resources expose unresolved findings, reconciliation variances and verified figures through the live browser connection. Agents can call `query_figure_register` or `explain_reconciliation_variance` to read workspace data. `propose_finding_edit` stages a draft that requires explicit reviewer approval. The local bridge uses the MCP 2026-07-28 Streamable HTTP protocol. [Protocol release notes](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

## Extraction and review

The extractor recognizes explicit financial metrics and receipt summary lines, including growth narratives that report both a percentage and an ending amount. On English-language statements of operations, balance sheets and cash flows, Folio extracts labeled numeric cells, links date and duration headers, and applies the stated scale with share-count and EPS exceptions. Ambiguous column counts, missing context and failed arithmetic checks require review. Findings carry the reported value, normalized amount, row and header evidence. PDF inputs can include normalized cell coordinates. Text inputs must preserve row and column order. Extraction status describes the recognized observations. It does not certify document completeness. MCP supports optional metric, page, offset and limit filters. Use Search for arbitrary fields or select an area on the original. An empty unit or period means the extractor could not establish it. A $ symbol stays ambiguous unless the document supplies a currency code. English OCR accuracy depends on image quality. The default pipeline uses PDF text-layer geometry and local English OCR. It maps recognized financial rows to a curated set of offline taxonomy tags.

For local Docling table layout, install Docling into a Python environment and download its model artifacts. Set `FOLIO_DOCLING_PYTHON` to that Python executable and `FOLIO_DOCLING_MODELS` to the artifact directory before starting the local service. Enable **Use local Docling for table layout on import** in the workspace settings. [Docling offline setup](https://docling-project.github.io/docling/faq/)

To use Mistral OCR 4.1 for manual re-indexing, set `MISTRAL_API_KEY` in the local service environment and select **Mistral OCR 4.1** in settings. Folio sends the selected page or region as a PNG and uses the returned block geometry and available word-confidence scores. [Mistral OCR documentation](https://docs.mistral.ai/studio/document-processing/basic_ocr)

The original Python service is available separately via `uvicorn folio.api:app` for existing /api/extract integrations.

## Desktop installation and agent skills

The previous Windows installer, Linux archive and illustrated guide are available from the [Folio 1.2.0 release](https://github.com/dhia-eddine-mahdaoui/folio-review/releases/tag/v1.2.0). The Windows x64 installer installs Folio for the current user and creates Start menu and optional desktop shortcuts. For Linux x64 with glibc, extract the Linux archive and run `Folio/install-linux.sh`. Then open Folio Review in the application menu. The desktop launcher starts the local service and opens a standalone window when the default browser supports Chromium app mode. Other browsers open Folio in a tab using the same browser profile and library.

In Folio Desktop, open Agent MCP & Bridge to preview, install or customize the local `folio-review` skill for detected Codex, Claude Code, Gemini CLI and Cursor profiles. Use Test connection to check that Folio MCP responds and advertises its tools. Add the displayed MCP URL to your agent client and start a new agent session after installing or updating its skill. Installed agents can also use the included CLI to extract and OCR PDFs while the workbench is closed. Uninstall from Windows Installed apps or run the installed Linux `uninstall.sh`. Folio preserves unmanaged and externally edited skills.

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
makensis -DPAYLOAD="$PWD/output/desktop-build/windows" -DVERSION=2.0.0 \
  -DOUTFILE="$PWD/output/installers/Folio-Review-2.0.0-x64-Setup.exe" desktop/installer.nsi
python3 desktop/stage.py linux output/desktop-build/Folio/app \
  --node /path/to/node-24.18.0/bin/node --node-license /path/to/node-24.18.0/LICENSE
cp desktop/*linux.sh output/desktop-build/Folio/
tar czf output/installers/Folio-Review-2.0.0-linux-x64.tar.gz -C output/desktop-build Folio
```

## Tests

Build the app and run the JavaScript unit, API and Chromium regressions with `npm run build` and `npm test`. Install Chromium with `npx playwright install chromium`, or set `FOLIO_TEST_CHROMIUM` to an existing Chromium executable. The browser tests start their own loopback server. Set `FOLIO_TEST_FIREFOX` to a Playwright Firefox executable to verify cross-browser restoration.

Install `requirements.txt` in a Python environment and run `python -m unittest discover -s tests` for the legacy FastAPI tests.
