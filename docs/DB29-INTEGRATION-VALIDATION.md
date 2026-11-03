# DB29 integration validation record

## Acceptance scope

The Android card-data integration must be checked against the immutable T release `fm1-carddb-29`, not a mutable or locally inferred dataset.

### Required CI gates

- Verify the T release manifest and SHA-256 values for the normalized SQLite archive, enum table, image archive part, and versioned Manual skill catalogue.
- Verify SQLite integrity, 15,350 cards, 30,700 archived image references, zero foreign-key errors, and the release's source mapping invariants.
- Build the Android import ZIP from the audited DB and preserve each card's source-detail URL independently of image URLs and archive paths.
- Run the converter and schema regression tests, then install the APK in the Android emulator and import the generated pack through the app's own import flow.
- Confirm WebView can load the imported 15,350 card dataset and retain the previous installed dataset if import fails.

## What a green emulator smoke test means

A green run confirms package build/install, data-pack import, and WebView load for the tested source revision. It does not prove that all card effects are executable, that a full match is rules-complete, or that a physical device import has been tested.

## Rules/data safety invariants

- Unknown non-land soul costs stay blocked; they are not interpreted as free.
- Cost readings derived from image pixels remain review candidates until manually verified.
- Community-only rule candidates remain non-executable by default.
- Original card text and source links remain visible when effect parsing is incomplete; candidate extraction is not execution authorization.
- The APK's release summary must identify the exact DB release tag and source commit.
