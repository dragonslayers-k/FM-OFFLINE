# Card JSON schema (prototype)

The import screen accepts a JSON array. Supported values:

```json
[
  {
    "id": "sample_forest_scout",
    "name": "숲의 척후병",
    "type": "unit",
    "faction": "forest",
    "cost": { "forest": 1 },
    "ap": 2,
    "dp": 1,
    "hp": 3,
    "coin": {
      "apCount": 1,
      "apValue": 1,
      "dpCount": 0,
      "dpValue": 0
    },
    "rarity": "common",
    "text": "검증된 카드 설명을 입력"
  }
]
```

## Required common fields

- `id`: unique stable ID, 2–64 characters, ASCII letters/numbers/underscore/hyphen.
- `name`: card display name.
- `type`: `land`, `unit`, `item`, `spell`, or `enchant`.
- `faction`: `dark`, `fire`, `water`, `forest`, `metal`, `earth`, `light`, or `neutral`.

## Type-specific fields

- Land: `souls` array, each entry one of the eight factions. Current rules treat each land as one available soul per preparation phase and dual lands as able to satisfy one of their listed colors.
- Non-land: `cost` object, with non-negative integer values keyed by faction. `neutral` is currently treated as generic cost.
- Unit: integer `ap`, `dp`, `hp`; optional `coin` fields `apCount`, `apValue`, `dpCount`, `dpValue`.
- Item/Enchant: optional integer `apBonus`, `dpBonus`, `hpBonus`.
- Spell: `effect` object. Currently supported `damage`, `heal`, `buff`, `draw`, `mill` (drain not fully implemented). Targets: `ownUnit`, `enemyUnit`.


## Firestore DB → Android import adapter (FM1-CARD-DATA 1.1.0)

The current app import contract remains a ZIP with three required entries:

- `cards.json`: UTF-8 JSON array of 15,350 card objects.
- `manifest.json`: format `FM1-CARD-DATA`, version `1.1.0`, card/image counts, and SHA-256 of the exact `cards.json` bytes.
- `images/{FirestoreDocumentId}.webp`: one large WebP illustration per card.

The source database is the successful FM LUNATIC Firestore release, not a second crawl. The adapter reads its JSONL, enum table and existing images archive, then converts each original record into the app's normalized card input. Every card keeps:

- Stable Firestore document ID and the individual source card URL `https://fmlunatic.com/card/{documentId}`.
- The card-list URL and source image URLs.
- The entire original Firestore field map in `sourceFields`.
- The original RequireSoul token string and a cost review status.
- A local image filename based on the same Firestore document ID.

Current category mapping and counts are fixed:

| Firestore Category | App type | Card count |
|---:|---|---:|
| 1 | `land` | 289 |
| 2 | `unit` | 8,633 |
| 3 | `spell` | 3,857 |
| 4 | `item` | 1,748 |
| 5 | `enchant` | 823 |
| | **Total** | **15,350** |

Enchant is the current fifth official card type. It is not a missing or unsupported category. The per-card EnchantSlot field is a separate value that may still require parsing or rule verification.

Unknown, mixed, NCS, and BONUS soul tokens remain review-required. They are not converted into zero-cost cards. Land installation uses LP; land cards are excluded from ordinary summon-soul cost checks. Missing LP defaults follow the current rules adapter and remain distinguishable in the source fields.

The converter enforces the existing Android importer limits: cards.json ≤128 MiB, total unpacked payload ≤700 MiB, 15,350 records, 15,350 images, unique IDs and the exact five-category counts. The Android importer independently rechecks SHA-256, ZIP entry paths, image references and category counts before atomic installation.

## Important

This is an implementation schema, **not a confirmed export schema from the original game or FAN-MADE MASTERS**. Translate source data into it only after checking the original card behavior. Special effects require a new explicit effect handler and test before they should be considered implemented.
