# Myth Harvest Workflow (One-Time, Manual)

This folder is for one-time/manual myth candidate harvesting only.
There is no continuous crawling and no web fetching in project code.

## Files

- `src/harvest/harvest-sources.json`: manual list of source URLs.
- `src/harvest/raw/*.txt`: raw pasted page text.
- `src/harvest/harvest-output.json`: extracted candidate myths.

## Steps

1. Paste page text into `src/harvest/raw/*.txt`.
2. Run extraction:
   - `tsx scripts/harvest-from-text.ts --in src/harvest/raw/source1.txt --url "https://example.com" --topic pregnancy`
3. Review `src/harvest/harvest-output.json` manually.
4. Promote selected items into `src/data/myths.he.json` only after adding valid `evidenceSeedIds` that reference `src/sources/evidence-seeds.json`.
5. Run validator/build. The validator enforces that runtime myths require evidence.

## Safety Gate

- Harvest output is not used by runtime.
- Runtime myth content remains controlled by `src/data/myths.he.json` and validation rules.
