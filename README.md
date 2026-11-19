# Folio financial workpapers

Import a PDF or a batch of PDFs into a private document library, search their text, highlight source lines or draw a rectangle on the original page, and save figures with a period, unit, evidence and reviewer note. Each PDF has a register. Excel exports include reviewed figures and a second sheet with extracted numerical source rows. CSV exports contain the reviewed register.

## Run

Use Node 22.13 or later. Run `npm ci && npm run build`, then `python3 -m http.server 8000 --bind 127.0.0.1 --directory dist` and open http://localhost:8000. Deploy the contents of dist to an HTTPS static host for browser use. Set access controls on the host for a private deployment.

## Data and operating boundaries

The browser parses PDFs locally with PDF.js and stores originals, the extracted text index and reviewed figures in IndexedDB. Identical files reopen the existing register. Saving a figure updates the register transactionally. Documents can be removed individually. Data belongs to this browser profile and origin. Clearing site storage deletes the library. Retain original PDFs and export workbooks for records.

Text extraction groups positioned PDF text into visual lines. Source rows and numbers in an Excel export are unreviewed reading-order candidates. The reviewer selects the period, metric and unit, and verifies the value against the visible original. Image-only pages support manual region capture and transcription. Imports support unencrypted PDFs up to 50 MB and 1,000 pages. The private hosted release is a single-device workbench. Shared editing, centralized backups and automatic OCR are outside this deployment.

The Python service in folio/ retains the earlier narrowly scoped structured extraction API for existing integrations. The library and general-purpose workbook workflow run in the browser. Synthetic fixtures under tests/ are used only by regression tests.

**Backup** downloads a portable .folio archive containing the original PDF and the reviewed register. Import it on another device to restore the document. Restoring into an existing register merges figures by identifier and retains the more recently saved version.
