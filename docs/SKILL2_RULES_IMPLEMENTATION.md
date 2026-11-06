# FM1 Skill2 규칙 구현 기록

## 적용 원칙

- Skill2는 Skill1의 공격 기술과 별도 필드·별도 규칙 네임스페이스로 처리한다.
- 카드 원문 설명에서 효과 문구를 확인하고, 해당 문구가 실제로 들어 있는 카드 URL을 데이터팩에 함께 보존한다.
- 아래 여덟 규칙만 원문 문구와 전용 회귀 테스트를 모두 갖춘 상태로 실행 가능하다.
- 그 밖의 Skill2 값은 원문/카드 URL/상태를 데이터팩에 보존하되, 검증 전에는 전투 엔진에서 실행하지 않는다.
- 원본 SQLite 매핑 상태와 카드 원문에 근거한 검증 상태는 별도 필드로 보존한다. `specialSkill2SourceMappingStatus`는 원본 분류이며, `specialSkill2MappingStatus=source_card_verified`는 이 프로젝트에서 원문으로 효과를 검증했다는 뜻이다.

## 실행 가능 규칙

| Skill2 | Rule ID | 발동 및 처리 |
|---|---|---|
| 기선제압 | `skill2_tactical_initiative` | 방어 시 공격 유닛 레벨이 방어 유닛 레벨 이하이면 계산된 피격 데미지를 1 감소한다. 최저 피해는 0이다. |
| 헌신방어 | `skill2_devoted_defense` | 자신이 파괴될 때 같은 아군 필드의 다음 위치에 남아 있는 유닛의 AP/DP/HP를 각각 1 올린다. 다음 유닛이 없으면 발동 대상이 없다. 전투 중 임시 스탯으로 적용한다. |
| 격노 | `skill2_frenzy_defense` | 방어 중 실제로 감소한 HP만큼 자신의 AP를 올린다. 방어 유닛이 생존하면 같은 슬롯의 반격에 이 AP가 반영된다. |
| 홀리오오라 | `skill2_holy_aura` | 방어 시 공격 유닛의 굴림 AP가 내림 처리한 `(방어 유닛 굴림 DP + 현재 HP) / 2` 이하이면 해당 공격 데미지를 0으로 만든다. |
| 얼라이디펜스 | `skill2_alliance_defense` | 방어 시 자신과 같은 소속인 다른 아군 필드 유닛 수만큼 받는 데미지를 감소한다. |
| 레이셜디펜스 | `skill2_racial_defense` | 방어 시 자신과 같은 종족인 다른 아군 필드 유닛 수만큼 받는 데미지를 감소한다. |
| 강한헌신방어 | `skill2_strong_devoted_defense` | 자신이 파괴되면 남아 있는 아군 필드 유닛 전체의 AP/DP/HP를 각각 1 증가시킨다. |
| 프레셔 | `skill2_pressure_defense` | 방어 시 아군 필드의 빈 슬롯 수 절반(내림)만큼 받는 데미지를 감소한다. |

## 카드 원문 근거

- [기선제압 — 타투파이터](https://fmlunatic.com/card/10010624546): 적군 레벨 조건에서 받는 데미지를 1 덜 받는다고 기재되어 있다.
- [헌신방어 — 소울키퍼](https://fmlunatic.com/card/10020324672): 자신 파괴 시 아군 필드 다음 유닛의 공·방·체를 각각 1 올린다고 기재되어 있다.
- [격노 — 히드라](https://fmlunatic.com/card/10021724689): 방어 중 HP가 깎인 수치만큼 AP가 상승한다고 기재되어 있다.
- [홀리오오라 — 두랄의기사](https://fmlunatic.com/card/11112425419): 적군 AP가 자신의 방어/체력 합의 1/2 이하일 때 피해를 받지 않는다고 기재되어 있다. DB의 동종 카드 설명에는 내림 조건도 명시되어 있다.
- [얼라이디펜스 — 팰러딘](https://fmlunatic.com/card/10010624583): 자신을 제외한 동일 소속 필드 유닛 수만큼 받는 데미지가 감소한다고 기재되어 있다.
- [레이셜디펜스 — 스타시커](https://fmlunatic.com/card/10050424869): 자신을 제외한 동일 종족 필드 유닛 수만큼 받는 데미지가 감소한다고 기재되어 있다.
- [강한헌신방어 — 다크레이디](https://fmlunatic.com/card/12091226410): 자신 파괴 시 아군 필드 유닛 전체의 공·방·체가 각각 1 증가한다고 기재되어 있다.
- [프레셔 — 루요](https://fmlunatic.com/card/13100227071): 방어 시 아군 필드 빈 공간 수 절반(내림)만큼 받은 데미지를 감소시킨다고 기재되어 있다.

각 카드의 정확한 개별 URL과 HTML 원문 설명은 `skill2-catalogue.json` 안의 `cardReferences`에도 포함한다. 검증기는 이 원문 설명이 존재하는 카드 ID 집합이 `evidenceCardIds`와 정확히 일치하는지 검사한다.

## 잔여 검토 범위

DB29에는 189개의 Skill2 enum 항목이 있다. 이 중 1개는 미보유/없음 값이고, 188개는 실제 Skill2 값이다. 현재 여덟 값만 원문 근거 및 별도 엔진 테스트까지 완료했다. 나머지 값은 카드별 원문 설명을 분류·대조하고, 조건/대상/지속시간/수치/발동 순서를 확인한 뒤 규칙별 테스트를 추가하기 전까지 실행하지 않는다.

## 검증

- Skill2 전용 정규화 허용목록: 8개 Rule ID
- Skill1 매뉴얼 규칙과 Skill2 규칙은 서로 대체하거나 상속하지 않는다.
- 카드 스키마 테스트는 다른 Skill2 이름에 허용되지 않은 Rule ID를 주입해도 거부되는지 확인한다.
- 전투 테스트는 기선제압, 헌신방어, 격노, 홀리오오라, 얼라이디펜스, 레이셜디펜스, 강한헌신방어, 프레셔를 각 발동 시점에서 독립적으로 확인한다.


## DB29 full import + emulator verification and current executable gate (2026-11-05 / Actions #160)

- PR #28 HEAD: `56f2cd5378de3bb528ed298d36c7487cf506e6b7`, open/draft/unmerged.
- Actions #160: https://github.com/dragonslayers-k/FM-OFFLINE/actions/runs/41949790050 succeeded. Node tests: 138 passed / 0 failed. Converter self-test: PASS; 11 Python tests passed; SQLite integrity and audited release manifest verification passed; Debug APK build and package validation passed.
- Emulator test is a real data-import test, not launch-only: it streamed the generated DB29 ZIP into the app-private files, invoked the guarded importer, then waited for the WebView loader to confirm all 15,350 cards. Log: `Emulator card-data import + WebView load smoke test: PASS`; loaded count 15,350/15,350. This does not claim physical-device, online login, or complete match-scenario coverage.
- Artifacts: `FM1-CardData-v1.3.0-IMPORT-DB29` (13379674035) and `FantasyMastersOffline-build-output` (13379164984). Release signing was not configured in this run.

### Distinguish handler registration from DB29 executable rules

- The production dispatcher registers all eight Skill2 handlers. This is code capability, not evidence that all eight are mapped to executable DB29 cards.
- Current DB29 pack audit: 189 Skill2 enum entries; 188 active skill names; 1,366 active cards; 10,381 source mappings/references; **7 executable rules**.
- Holy Aura remains pending for current DB29 unit mappings. The exact floor-rounding phrase used as the executable evidence needle occurs on an item reference, not the relevant unit card's own TextExtra. Item text cannot authorize a unit combat rule. The handler remains registered and synthetic arithmetic/boundary tests remain, but no DB29 unit mapping is promoted until card-local evidence supports it.
- Other seven rules remain subject to exact card-level source metadata and runtime gate. Inferred/community mappings remain fail-closed.

### Cost review gate

- DB29 source review totals (14,244 known / 817 review-required non-land costs; 38 mapping-review + 779 semantic-review) are provenance counts, not a playability gate. The Android runtime consumes separate `runtimeCost`; the #325 pack audit found 15,350/15,350 runtime costs ready (0 blocked), with 14,519 `implemented_verified` and 831 `implemented_inferred`. Original source values/review flags remain unchanged; inferred/fallback runtime amounts are not source verification. Unknown costs must never become free zero.


## 2026-11-06 integrated runtime reconciliation — Actions #325

- The production dispatcher has eight Skill2 handler implementations, but code registration must not be confused with DB29 card-mapping executability.
- The DB29 pack audit on APK PR #28 code SHA `60681acc02974f6f6e8721def63b24f0823a6d6e`, Actions #325 / run `42192845020`, measured 189 enum entries, 188 active Skill2 names, 1,366 active cards, 10,381 source mappings/references, and **7 executable rules**.
- Holy Aura remains the non-executable rule in the current DB29 pack. Its handler and isolated arithmetic tests exist, but card-local evidence does not yet justify promoting the DB29 mappings. The crosswalk found two source rows with different wording: only one explicitly says floor rounding; the source phrase used as a rounding needle must not be borrowed from an item card to authorize a unit defense rule. Keep the mapping review-only until exact unit-card evidence resolves the wording and damage-source boundaries.
- The eight handler tests are not a claim that eight rules are mapped to actual DB29 cards. Only the seven validated rules counted by the actual pack audit are executable in the current DB29 runtime pack; unknown/unverified Skill2 remains non-executable while the unit itself remains playable.
- Cost semantics are also split: the source 817 review-required records keep their provenance flags, while the 15,350-card runtime payment overlay guarantees a payable runtime cost. Runtime readiness does not change source evidence state.

## 2026-11-06 regression — unmapped Skill2 must not block card use

APK PR #28 adds a focused test that attempts a real `FM.playCard()` unit-summon action for a unit carrying an unverified/unmapped Skill2. The expected contract is: the unit pays its normal runtime cost, leaves the hand, enters the field, and sets `playedAnyCardThisPhase`; the unverified Skill2 remains non-executable and does not fall through to Skill1. The focused regression passed on APK PR #28 HEAD `300dd507850175e3aa19168633c6d33a1f1c6c55`, Actions #333 / run `42203252263`.


### Verified regression result — Actions #333 (2026-11-06)

- Test source commit: `9f24fe688845a0a0c67fd5d523adcb7ae0fcce7d`.
- Documentation/current PR HEAD: `300dd507850175e3aa19168633c6d33a1f1c6c55`.
- Actions #333 / run `42203252263`: success. JS rule tests and Python converter tests passed; DB29 pack, JDK/SDK/Gradle/APK/emulator were skipped by the lightweight-PR policy.
- Test log explicitly reports: `a unit with an unmapped Skill2 remains playable and completes its summon action` and `fail 0`.
- Assertions confirm payable soul cost, removal from hand, field deployment, incremented deployment count and `playedAnyCardThisPhase=true`; unverified Skill2 normalization remains empty. This protects the rule that an unknown Skill2 does not disable the entire unit.
