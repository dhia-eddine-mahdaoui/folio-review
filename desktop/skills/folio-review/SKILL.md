---
name: folio-review
description: Use Folio to extract financial figures from reports and receipt totals from PDFs, including English scans, when the user requests document extraction, source verification, or receipt reconciliation.
---

Run the installed local CLI on the user's PDF. It starts on demand and returns JSON on stdout. Quote the absolute path to the input, especially when the filename contains spaces.

```
{{FOLIO_COMMAND}} analyze "ABSOLUTE_PATH_TO_PDF"
```

Use each finding's source page and quote when reporting its amount, unit and period. A missing period or currency needs source review. Report differences from receipt_check when present. The extractor recognizes specific metrics and receipt fields. An empty findings array can mean that the layout or labels require manual review. For visual inspection, open Folio from the application menu and import the same file.

A configured Folio MCP connection also provides analyze_pdf and analyze_text. The installed CLI processes the original locally, including OCR, without transferring the file to a hosted endpoint.

When the user shares their Folio workspace over MCP, `run_workpaper_tieout` reconciles the open workpaper, including cross-page tie-outs of the same metric and period; request it as a task for long filings and poll the returned task. If `propose_finding_edit` returns `input_required`, ask the user to confirm the unit and reporting period instead of guessing, then repeat the call with their answer. Drafts stay pending until the reviewer approves them in Folio.
