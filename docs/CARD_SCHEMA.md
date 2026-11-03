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


## Firestore DB → Android import adapter (FM1-CARD-DATA 1.1.1)

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


## 지형 비용 및 생산 데이터 (FM1-CARD-DATA 1.1.1)

지형 설치에는 `RequireLP`와 `RequireSoul`이 별도 적용된다. LP만으로 설치할 수 있는 지형도 있지만, 예를 들어 구름도시는 LP 2와 빛 유소울 1, 무소울 1을 함께 요구한다. 앱 데이터팩에는 `requiredLP`, `landInstallCost`, 각 필드의 확인 상태를 따로 저장한다. 비용이 원문에서 해석되지 않은 지형은 무료로 간주하지 않는다.

지형의 실제 생산량은 `SoulType`이나 `MuSoul`에서 추정하지 않고 `EarnSoulList`와 `Enum+EarnSoul`로 해석한다. 일반 색상 심볼, 두 색 조합 심볼, `ALL`(7색 각 1개), `MU01/02/03`(무소울 1/2/3개)를 토큰 단위로 저장한다. `SPELL`은 일반 소울이 아니라 매직랜드 특수 효과 표시이므로, 일반 지형처럼 소울을 만들어내지 않는다. 매직랜드는 별도 발동 규칙이 구현되기 전까지 게임 엔진에서 일반 지형으로 설치하지 않는다.

현재 데이터팩은 원본 토큰·아이콘·원문 텍스트를 보존한다. 설치 비용 미해석 및 매직랜드 효과 미구현은 정상 완료가 아니라 검증 대기 상태로 표시한다.


## 1.1.1 converter validation source

The 1.1.1 Android pack conversion is pinned to the audited T Release `fm1-carddb-26`. Its source asset hashes are checked before conversion. Land installation now requires both verified LP and a parsed `RequireSoul` cost; land production uses `EarnSoulList` with the live `Enum+EarnSoul` symbols. MagicLand (`SPELL`) records remain preserved but cannot be played as ordinary producing terrain until their card-specific soul-cost effects are implemented.


## RequireSoul 복합 속성 토큰 보정 (FM1-CARD-DATA 1.1.2)

`RequireSoul`은 `Enum+RequireSoul`의 코드 심볼을 기준으로 해석한다. 단일 속성 심볼은 해당 속성 요구량으로, `DARK_EARTH` 등 복합 심볼은 명시된 각 속성 요구량으로 분해한다. 예를 들어 `12011101`은 `DARK_EARTH` 1개와 `DARK` 1개 토큰이므로 암흑 2, 대지 1이다. 해당 카드는 원문 추가 설명과도 대조했다.

`MU`는 무소울 요구량, `NONE`은 수량 0일 때 명시적 무비용으로 보존한다. `NCS`와 `BONUS`는 기존 enum 이름 및 카드 원문을 보존하되 결제 규칙이 충분히 검증되지 않아 계속 `manual_review`로 남긴다. 이를 일반 무소울이나 무료 비용으로 바꾸지 않는다.
