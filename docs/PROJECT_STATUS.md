# 프로젝트 상태 및 검증 원칙

기준 저장소는 이 저장소이며, Android 프로젝트는 main 단일 브랜치에서 관리한다. 카드 원본 수집·정규화 DB의 기준 저장소는 [dragonslayers-k/T](https://github.com/dragonslayers-k/T)이다.

## 이번 초기 구성의 범위

기존 v0.1.8 복원 브랜치에서 아래 필수 요소만 선별해 이 저장소 루트에 다시 배치했다.

- Android Gradle 루트와 app 모듈
- Java WebView 컨테이너와 안전한 데이터팩 가져오기/검증/교체 코드
- 로컬 게임 HTML/CSS/JavaScript 자산
- Node.js 카드 스키마 및 규칙 테스트
- 기존 카드DB Release를 Android ZIP으로 변환하는 Python 어댑터
- 단일 Android CI/APK Build workflow

기존 시도 ZIP, 이전 저장소 전용 브랜치 선택 옵션, 중복·실험용 workflow는 포함하지 않는다. 카드DB 크롤러와 카드DB Release 생성 workflow도 이 APK 저장소에 두지 않는다.

## 데이터팩 흐름

1. 카드 원본 수집과 DB Release 생성은 dragonslayers-k/T에서만 수행한다.
2. APK 저장소의 단일 Android CI에서 T의 정규화 SQLite DB Release fm1-carddb-29과 enum/image 자산을 가져온다.
3. 변환기가 SQLite의 cards/costs/images/effect candidate 데이터를 FM1-CARD-DATA 1.3.0 ZIP으로 변환한다. JSONL을 재파싱해 DB 결과를 덮어쓰지 않는다.
4. 앱 사용자가 데이터 관리 화면에서 ZIP을 직접 선택해 설치한다.
5. 앱은 SHA-256, 카드 수, 이미지 수, 경로, 중복 ID, 카드 분류 및 이미지 파일을 검증한 후 기존 설치본을 백업하고 교체한다.

일반 코드 push에서는 대형 이미지 아카이브를 다운로드하지 않는다.

## 정확성·안전 원칙

- 카드 유형은 Land / Unit / Magic / Item / Enchant 5종이다.
- Enchant는 정식 다섯 번째 분류이며, 효과 실행 여부와 분류 여부는 별도 문제다.
- 명시적 LP 0과 LP 필드 누락/파싱 실패를 구분한다.
- 빈 비용 객체, `mapping_review`, `semantic_review`, NCS, BONUS, 미상 비용을 무료로 해석하지 않는다.
- 효과 후보 `pattern_candidate`는 원작 의미 검증 상태로 보존한다. Android 데이터팩은 각 effect clause에 별도 runtime disposition을 부여하며, 미지원 clause는 `fallback_noop`으로 종료한다.
- Manual.zip에서 확인된 27개 기본 공격 기술은 `manual_verified` 매핑과 개별 엔진 테스트가 있을 때 실행한다. Skill2는 별도 allowlist에서 정확한 카드 원문과 전용 테스트가 확인된 rule만 실행하고, 나머지는 clause-level fallback으로 처리한다.
- 카드 원문, 원본 Firestore 필드, 카드별 원본 URL 및 이미지 URL을 보존한다.
- 원본 효과가 미매핑이어도 카드 전체를 사용 불가로 처리하지 않는다. 원본 후보/검토 상태를 보존하고, 구현 handler가 없는 clause는 runtime `fallback_noop`으로 action을 종료한다.
- FM1 Manual.zip이 규칙의 우선 근거다. 다른 판본·팬 프로젝트는 UI 참고 외에 규칙 근거로 대체하지 않는다.

## 구현 완성도 한계

현재 기반에는 카드 도감·데이터팩 가져오기·기본 게임/전투 엔진과 일부 카드 효과가 있다. 그러나 비용 검증, 전체 마법/인챈트 효과, 복합 아이템 조건, 모든 특수 기술 상호작용과 실제 대전 시나리오는 완성으로 볼 수 없다. 카드가 목록에 표시되는 것과 카드 효과가 완전히 실행되는 것은 별도다.

## CI 검증 단계

단일 .github/workflows/android-ci.yml에서 다음을 구분한다.

- 기본 push: JavaScript 문법 검사, Node 테스트, Python 변환기 자체 테스트, Debug APK 빌드, 패키지·ZIP 검사
- 수동 선택: 기존 DB Release로부터 Android 카드 ZIP 생성
- 수동 선택: 에뮬레이터 설치 및 앱 시작 검사
- 선택적: 서명 Secret 네 개가 있을 때 Release APK 생성

APK 빌드가 성공해도 데이터팩 설치, 앱 기동, 실제 Android 기기 대전까지 검증된 것은 아니다. 각 결과를 따로 기록한다.


## 현재 통합 데이터팩 1.3.0 상태

- source: T 정규화 SQLite Release `fm1-carddb-29`
- 비지형 비용: 14,244건 확정 / 817건 검토(혼합 38, NCS/BONUS 의미 779)
- 지형 설치 비용: 275건 확정 / 14건 검토
- 효과 후보: 17,407개, 절 구간 48,281개, 모두 `pattern_candidate`
- APK 변환은 T SQLite의 카드 상세 URL과 대형 이미지 SHA-256을 그대로 대조한다.

## 단계별 복원 기준

최종 목표는 카드가 목록에 표시되는 데 그치지 않고, FM1 매뉴얼 및 카드별 원문에 근거해 원작 동작을 재현하는 것이다. 다음 순서로 검증한다.

1. **원본 DB 완전성** — 15,350장, 다섯 분류별 수량, 카드 ID/URL, 원본 필드, 이미지, 비용 원문과 토큰을 독립 집계한다. 분류 수량과 비용 해석 상태를 혼동하지 않는다.
2. **Android 데이터팩 호환성** — 원본 DB Release와 앱 설치 ZIP을 분리한다. 설치 ZIP은 cards.json / manifest.json / images/{FirestoreDocumentId}.webp 구조, SHA-256, 분류별 수량, 이미지 참조, 실제 압축 해제 용량을 검사한다.
3. **원본 필드 해석** — RequireSoul / RequireLP / MuSoul / EarnSoulList / EnchantSlot / Duration / TurnType / Skill1 / Skill2 및 코인 필드를 분류별로 해석한다. 해석이 불확실한 값은 0이나 기본값으로 대체하지 않는다.
4. **공통 게임 규칙** — 50장 덱, LP, 지형 소울 생산, 유닛 설치 수, 무속성 유지비, 아이템 장착, 마법 슬롯, 전투 순서, 드로우/패배 조건을 매뉴얼 문구와 테스트로 대조한다.
5. **카드별 효과** — 마법·인챈트·아이템 효과와 27개 특수 공격 기술을 발동 시점, 대상, 수치 변화, 지속시간, 예외 조건별로 명시적으로 매핑한다. 자동 문자열 추정만으로 구현 완료 처리하지 않는다.
6. **실전 검증** — 고정 시드 시나리오, 슬롯별 전투, 효과 상호작용, 장시간 라운드 및 실제 Android 설치·실행 검증을 통과시킨다.

각 단계의 성공 여부를 구분해 기록한다. APK 빌드나 ZIP 생성 성공만으로 원작 게임 구현 완료라고 표기하지 않는다.

## SQLite 통합 데이터 기준

The Android adapter consumes the normalized `cards`, `card_costs`, `card_images`, `card_effect_candidate_summaries` and `card_effect_clauses` tables from T Release `fm1-carddb-29`. It does not reconstruct costs from the raw JSONL.

Expected verified/review cost counts are 14,244 / 817 for non-land cards and 275 / 14 for land installation. The 17,407 effect candidates and 48,281 clause segments are preserved as reference data only; no pattern candidate is treated as an executable game rule.

## DB29 특수기술 매핑 및 실행 경계

T Release `fm1-carddb-29` adds `game_rule_catalog`, `card_rule_mappings` and `skill_enum_inventory` to the normalized SQLite DB. The Android pack preserves every Skill1/Skill2 source enum and its mapping evidence. Only `Skill1` mappings with `manual_verified` and `source_authority=manual` populate `specialSkillRuleId`. Later community rules remain non-executable, and unmapped source values remain visible rather than being guessed into another rule.

The engine maps the real current enum names (e.g. `기술봉쇄`, `주문봉쇄`, `무기봉쇄`, `공격복제`, `조롱공격`, `방어변환`) through the canonical Manual rule IDs. The original source field and enum value remain preserved in the DB/card pack.

## Android 데이터팩 파일 분리

Data pack 1.3 keeps `cards.json` under the Android 128MiB limit. Full provenance is not dropped: `card-skill-mappings.json` carries all Skill1/Skill2 mappings and `card-effect-candidates.json` carries all effect pattern candidates and exact clause spans. The manifest records each file's SHA-256 and row counts. The runtime consumes the compact `specialSkillRuleId` / mapping status on unit cards; detailed records remain available as a separate reference library in the ZIP.


## 2026-11-05 최신 재개 상태 — PR #28 / Actions #169

### 저장소 및 검증
- 작업 브랜치: `feat/combat-event-foundation`
- PR #28 HEAD: `70d61831ace43f7e36c55f98d6f5dcdae7b57ced`, open/draft/unmerged.
- Actions #169: https://github.com/dragonslayers-k/FM-OFFLINE/actions/runs/41955677080 — success.
- Node tests 148/148, converter self-test, Python tests 11개, DB29 SQLite/release manifest, Debug APK build/package integrity, emulator 설치 및 앱 내부 데이터팩 import/WebView 전체 로딩 성공.
- 에뮬레이터 최종 확인: `Emulator card-data import + WebView load smoke test: PASS`, 15,350/15,350 cards.
- #167은 16개, #168은 2개 Node test failure가 있었으며 #169에서 item equip/spell queue 성공 테스트 fixture를 보완해 통과했다. 과거 실패는 이력으로 유지한다.
- Artifacts: build output 13383111704, DB29 import pack 13382942450. 서명 secrets 미설정 시 signed Release APK가 생성됐다고 보고하지 않는다.

### ADB 부팅 중 offline 로그 판정
- #160 및 #169에서 에뮬레이터 초기 부팅 중 `adb: device offline`가 일시 발생했지만, boot 완료 확인 후 APK install 및 카드팩 import가 성공했다.
- #160에서는 `sys.boot_completed=1` 확인 후 streamed install, 앱 실행, WebView 15,350/15,350 로딩 PASS가 이어졌다. #169도 약 31.7초 부팅 후 정상 통과했다.
- 해당 로그는 부팅 중 ADB transport 준비 전의 일시 상태이며 지속 장애가 아니다. 최종 boot timeout, 반복 offline, install/app crash, WebView count mismatch를 실제 실패 기준으로 삼는다.

### 전투 이벤트 기반의 정확한 범위
- production `newGame()`은 match-local queue/dispatcher를 생성한다.
- lifecycle events: `land_installed`, `unit_summoned`, `item_equipped`, `spell_queued`, `unit_destroyed`, `unit_attack_resolved`.
- Skill2 subscriber event types: `unit_destroyed`, `unit_damage_prevention_requested`, `unit_hp_damage_applied`.
- 여섯 lifecycle event가 존재한다는 사실은 여섯 효과 handler가 구현됐다는 뜻이 아니다. subscriber 없는 이벤트는 descriptive-only로 유지한다.
- Skill2 core handler는 8개 등록되지만 DB29 카드팩의 executable rule은 7개다. 홀리오오라는 현재 unit card-local source phrase가 충족되지 않아 비실행 유지.
- Skill1의 Manual 27개와 Skill2 8개는 별도 실행 트랙이다. Skill1은 manual_verified mapping gate를 유지하며, exact source card evidence와 rule별 regression tests 없이 bulk promotion하지 않는다.

### 다음 단계
1. Skill1 Manual 27개를 DB29 exact card ID/source text와 연결하고, unmatched는 pending 유지.
2. source-backed rule 한 건씩 positive/negative/boundary/interaction tests를 추가한다.
3. Skill2 8개 source excerpt 누락과 inferred mapping 377행은 별도 backlog로 유지한다.
4. 기존 lifecycle event는 source-verified handler를 붙일 근거가 확보된 경우에만 확장한다.
5. PR #28 병합, main 수정, DB30 발행은 승인 전 금지.


## 2026-11-05 — 저장소 이력 재확인: APK Actions #170

- PR #28: https://github.com/dragonslayers-k/FM-OFFLINE/pull/28 — open / draft / unmerged. Branch `feat/combat-event-foundation`; latest PR HEAD `313368bea61566a83e038a3a16ca41de7b190a52`.
- Actions #170: https://github.com/dragonslayers-k/FM-OFFLINE/actions/runs/41958670080 — success. Node rule tests, converter tests, immutable T DB29 download/data ZIP build, Debug APK build and package integrity, Android emulator install/launch, imported card-data/WebView smoke test all passed. Run #170 report indicates 15,350/15,350 card data loaded. This confirms build/import/app smoke coverage, not full combat-rule completeness.
- Recent sequence retained: #167/#168 failed on regression fixtures; #169 passed after correction; #170 is the latest successful full run. Do not erase failed attempts from history; use #170 as current validation point.
- PR #28 scope remains immutable combat event snapshots/ordered queue and validated zone transfer; existing Skill2 behavior is preserved, and no new inferred effect is enabled. Skill1 Manual 27 mapping track remains separate from Skill2.
- Next implementation should proceed from CardDB’s exact DB29 Skill1 source-row audit and implement one carefully scoped source-backed interaction with card-local source condition and deterministic tests. Add handlers only after event timing and test coverage justify them.
- PR #28 unmerged, main unchanged, DB29 immutable, DB30 not issued. No APK release claim beyond run #170 artifacts/validation.


## 2026-11-05 — APK Actions #171 failure analysis and retry fix

- Actions #171: https://github.com/dragonslayers-k/FM-OFFLINE/actions/runs/41961018914 — failed at the **Install Android emulator components** step, before Debug APK build, signature/package verification, and emulator install/launch.
- Root cause from job log: SDK Manager failed while installing the Android 34 Google APIs x86_64 system image; message: `Error reading Zip content from a SeekableByteChannel`. This is a truncated/corrupt SDK archive/download, not a JS rule test, converter, DB29 SQLite integrity, source data, Gradle compilation, or app runtime failure.
- Steps before the failure passed: Node syntax/rule tests, Python converter checks, DB29 immutable release download + SHA/SQLite checks, Android card ZIP generation and validation. Build report/data archive artifacts were uploaded; #171 does **not** establish that an APK was built or emulator smoke test passed.
- Workflow correction committed to this branch: `7fa4b34a02333bfdfa1b81035b10c0fa7196b0f9`. The emulator SDK package installation now retries up to 3 times; between attempts it clears the SDK Manager download cache and the partial Android 34 Google APIs x86_64 system-image directory, with a short increasing delay. Package versions remain pinned to the same SDK components.
- Next verification: let the single PR-triggered run from this workflow correction complete. If it fails again, inspect its first failing step and avoid unrelated code changes. #170 remains the last confirmed full emulator success (15,350/15,350 loaded).
- PR #28 stays open/draft/unmerged; main unchanged; DB29 immutable and DB30 not issued.

## 2026-11-06 — v4.9 runtime profile implementation update

- Source review status and runtime playability are independent. A pending/non_executable label alone never blocks deck building, card selection, cost payment, or turn progression.
- The DB29 SQLite converter now emits a valid runtime payment cost for each card while retaining source values/review flags. BONUS is one-time generic neutral payment; NCS is generic payment plus unit-only recurring upkeep. Missing/unresolved costs receive conservative payable neutral fallback, never free zero.
- The engine uses runtime cost before source verification flags, keeps unit upkeep finite, allows MagicLand installation with zero invented ordinary production, and provides deterministic item-target fallback. Exact simple spell text with supported attack/defend/battle-start timing can use tested inferred handlers; unsupported spells and all enchants (until event-duration slot handling exists) close as paid terminal no-ops.
- The pack carries a terminal runtime disposition for every source effect clause. Candidate/source text remains non-verified; fallback no-op is not a claim of original effect implementation.
- Current branch work remains unmerged. The full DB29 pack validator and emulator smoke must still pass on the same final combined SHA before claiming 15,350-card runtime readiness.

## 2026-11-06 — CI 실행량 절감 및 최종 런타임 행동 검증

- 일반 PR synchronize는 JS rule tests와 Python converter tests만 실행한다. JDK/Android SDK/Gradle 설치와 Debug APK 빌드는 일반 PR에서 생략한다.
- PR 제목 `[build-apk]`는 APK 빌드, `[build-card-pack]`는 DB29 pack과 APK 빌드, `[build-card-pack] [run-emulator]`는 DB29 pack + APK + emulator install/launch smoke를 요청한다.
- main push는 APK 빌드를 자동 수행한다. workflow_dispatch의 build_apk/build_card_pack/run_emulator 기본값은 false이며, emulator는 DB29 pack을 함께 요청해야 한다.
- 최종 pack validator는 단순 validateCardForPlay 검사 외에 15,350장 각각에 대해 synthetic resource/target 상태로 실제 FM.playCard()를 호출하고 hand removal, terminal zone/queue, playedAnyCardThisPhase를 확인한다. runtimeActionAudit 목표는 15,350 attempted / 15,350 completed / 0 blocked다.
- Item fallback은 미해석 clause만 무시하고 이미 해석된 owner/race/affiliation/allowed ability 조건은 계속 강제한다.
- 단순 마법 문구는 단일 정확한 clause와 지원되는 공격/방어/전투시작 발동 시점이 모두 확인될 때만 inferred handler를 사용한다. Enchant는 event/duration slot engine이 구현될 때까지 effect-only fallback을 유지한다.


## 2026-11-06 — 최신 재개 상태 OPS-014 (PR #28)

### 검증 이력 정정 및 범위

- APK PR #28 Actions #322 / run `42192589114`는 DB29 SQLite 다운로드, 변환 및 데이터 ZIP 생성까지 성공한 뒤 `validate-app-card-pack.cjs:551`의 `ReferenceError: manifest is not defined`로 실패했다. DB29 원본/SQLite 손상이 아니라 validator의 manifest 입력 연결 오류였다.
- 수정된 코드 SHA `60681acc02974f6f6e8721def63b24f0823a6d6e`의 Actions #325 / run `42192845020`는 DB29 SQLite 무결성/원본 확인, 15,350장 데이터팩 생성 및 manifest 검증, Debug APK build/package/signature/ZIP 검사, emulator install, DB import 및 WebView 15,350/15,350 로드를 모두 통과했다.
- #325 validator 수치: runtime cost profile 15,350 ready / 0 blocked; runtime action probe 15,350 attempted / 15,350 completed / 0 blocked. 카드별 terminal action은 Unit 8,633 소환, Magic 3,857 terminal action(3,839 paid fallback + 18 queued), Item 1,748 장착, Enchant 823 paid fallback, Land 289 설치였다.
- 효과 의미 검증은 별도 미완료다. 48,281 clauses 중 48,263 fallback_noop, 18 implemented_inferred이며, 716 normalized text patterns 및 1,249 low-confidence rows는 카드/절 단위 의미 검토 대상이다. 15,350 action probe는 원작 효과 구현 완성이나 seeded full-match 검증을 의미하지 않는다.
- CI 비용 gate commit `0be807b9dd3b67e5555ea9140e9083d698301bf5`의 Actions #327 / run `42197420334`는 JS/Python 성공, DB29 pack/JDK/SDK/Gradle/APK/emulator skip으로 gate 정책만 검증했다.
- UI 비용 label/MagicLand 설명 및 workflow header 수정이 포함된 SHA `77e1ee9723d6c10263498c68e8b65342fa28646f`의 Actions #328 / run `42199670675`도 JS/Python 성공, expensive stage skip이었다.
- 카드 상세 화면이 실제 동작과 다르게 미지원 spell/enchant 효과 때문에 전체 발동을 차단한다고 표시하고, runtimeCost 이용 가능 여부를 알리지 않는 문제를 발견했다. Commit `6dbdcf7ecabd645f20dd0073435999468409ff4a`에서 수정했다. Source cost review는 provenance 안내로 표시하며, `runtimeCost`가 있으면 실제 결제에 사용하는 값을 설명한다. 미지원 개별 clause는 no-op fallback으로 끝나지만 결제·카드 사용·턴 진행은 완료된다고 표시한다.
- PR 제목의 임시 `[build-apk]` 요청으로 Actions #329 / run `42202046670`가 실행되어 JS/Python 검사, JDK/SDK/Gradle setup, Debug APK build, package/application ID/signature/ZIP integrity 검사가 성공했다. DB29 pack 및 emulator 단계는 skip됐다. #329는 UI 수정 SHA의 APK-only 검증이며 full DB29/emulator 검증은 #325 범위다.

### CI 실행 조건 (실제 workflow 기준)

- PR synchronize는 JS/Python 경량 검사를 유지한다. PR title `[build-apk]`는 APK-only build를 요청할 수 있다.
- PR title `[build-card-pack]` / `[run-emulator]`는 대형 작업을 실행하지 않는다.
- DB29 pack은 workflow_dispatch의 `build_card_pack=true` 또는 승인된 main push commit marker로 실행한다. Emulator는 workflow_dispatch에서 `run_emulator=true`와 `build_card_pack=true`를 함께 선택하거나 승인된 main push에 두 marker가 함께 있을 때 실행한다.
- PR synchronize는 최신 실행만 유지하도록 cancel-in-progress를 적용한다. main push와 수동 실행은 취소하지 않는다.

### 현재 상태와 남은 게이트

- 현재 APK PR #28 HEAD는 문서 갱신 후 다시 확인한다. PR은 Open/Draft, 미병합으로 유지한다.
- Core runtime action/cost gate는 #325에서 통과했고, UI fix는 #329에서 APK build 및 integrity 검사를 통과했다. 최신 UI/doc-only 변경까지 포함한 APK build가 필요할 때는 별도 필요한 범위만 실행한다.
- 남은 핵심은 48,263 fallback clauses와 1,249 low-confidence source rows의 evidence-linked 의미 검토/handler promotion, Skill1/Skill2 crosswalk coverage, 고정 seed의 실제 전투·턴 전체 시나리오다.
- DB29 보존, DB30 미발행, T PR #9/#12/#13 및 APK PR #28/#26/#25/#9 미병합 승인 경계 유지.


## 2026-11-06 — Skill2 provenance와 unit playability 재검증

- APK PR #28 code audit #325의 실제 DB29 pack result는 Skill2 enum 189, active skill names 188, active cards 1,366, source mappings/references 10,381, executable rules 7이다. rules.js에 여덟 handler가 등록된 사실과 DB29에서 실행 허가된 일곱 규칙을 혼동하지 않는다.
- 홀리오오라 handler/test는 존재하지만 DB29 카드별 매핑은 미승인 상태로 유지한다. 카드별 원문 2행의 표현이 다르고, 한 행만 `(내림)`을 명시한다. 아이템 카드의 표현을 유닛 효과 근거로 전용하지 않는다.
- APK commit `9f24fe688845a0a0c67fd5d523adcb7ae0fcce7d` adds a focused `FM.playCard()` regression: an unmapped/unverified Skill2 does not prevent unit payment, hand removal, deployment, or preparation-phase terminal state. The special ability itself remains non-executable and cannot fall through to Skill1.
- Actions #333 / run `42203252263` passed on HEAD `300dd507850175e3aa19168633c6d33a1f1c6c55`; the test log explicitly names the new regression and reports 0 failures. JS/Python lightweight suite only; no pack/APK/emulator gate.
- Documentation follow-up commit `de467e60f9164f75274f261d2bc769028befea01` records the #333 result. No PR-triggered run has been returned for this doc-only commit by the available query; do not claim it has separate CI validation.


## 2026-11-06 — Skill1 Manual boundary tests #336/#337

- T PR #9 source audit document commit `3f1707149b531562cea75b0fbda12d81393a23c4` was followed by Actions #724 / run `42204057551` success (lightweight regression + compact DB29 runtime inventory; no full crawl/image/SQLite/Release audit).
- APK PR #28 Actions #336 / run `42203965191` passed the expanded `defense_convert` test for positive, zero and negative DP, tied to Manual.zip `specialability.htm` section 27 and DB29 source card 리듬포이 / `10010624563`.
- APK PR #28 Actions #337 / run `42204718679` passed tests for petrify AP/DP stat-marker boundaries and the positive-HP-damage weakening case; `fail 0`.
- Test-only additions: no runtime behavior/source mapping is changed or promoted. `FM.playCard()` unmapped Skill2 regression remains #333 success; DB29 Skill2 executable count remains seven, not eight.
- These checks are JS/Python lightweight only. The full DB29 pack/APK/emulator verification remains #325 at the earlier integrated code SHA.


## 2026-11-06 — 고정 seed 전투 및 승패 종료 게이트 (#341/#342)

- APK PR #28 code HEAD `be42ec585f6b124ceb310b875f7f08ae0d12b155`, Actions #341 / run `42206456060`: JS 233 tests / fail 0, Python converter 13 tests passed. The fixed-seed full preparation/battle cycle installed a paid land, summoned units on both sides (including AI easy mode), resolved paired slot attacks/counters, advanced to round 2, rotated attacker, and began the next preparation phase. The run was lightweight JS/Python only; DB29 pack/APK/emulator skipped.
- Test commit `3837301571449a17e28a09d08911cd5ce87f3336`, Actions #342 / run `42214419550`: JS 234 tests / fail 0, Python converter 13 tests passed. New test `fixed-seed slot battle ends the match on direct deck depletion without advancing the round` enters the real `resolveBattle()` slot path with a two-soul attacker and the defender's final two deck cards. It verifies immediate `status=finished`, `result=player`, no round increment, no attacker rotation, no additional preparation, and the final-deck/ victory log.
- #342 workflow steps: JS game rule tests success; Python Firestore converter success; DB29 download/pack, JDK/SDK/Gradle/APK/emulator skipped according to PR-lightweight CI policy.
- These are deterministic integration assertions over seeded fixture decks, not DB29-pack-import or seeded full game using the actual 15,350-card release. Original effects remain incomplete (48,263 fallback_noop of 48,281 clauses; only 18 implemented_inferred). Do not describe this as full game certification.


## 2026-11-06 — AI 준비 단계 서고 소진 종료 경로 (#345/#346)

- Test commit `de07a48573b8752a635e81667e5d905614c19550`, Actions #345 / run `42215759449`: first run failed one assertion (235 tests, 234 pass / 1 fail). The engine correctly ended the match during `beginPhase()` when the AI had five cards and an empty deck; the test incorrectly expected literal `AI` in the log, while the fixture's `ai.name` is lowercase `ai`.
- Corrective test commit `59384b9381cad328ed60801895635077ecdeefba` changed the assertion to compare against `ai.name`, not a hardcoded label. Actions #346 / run `42215917221`: success; 235 JS tests / fail 0; Python converter 13 tests / OK.
- The passing test calls actual `FM.endPhase()` for the human side, enters AI `beginPhase()`, and verifies the empty AI deck cannot refill hand to six, the match ends with player victory, no phantom draw occurs, the round does not advance, and AI auto-play does not start after `status=finished`.
- Both #345 and #346 were lightweight JS/Python checks. DB29 pack/APK/emulator were skipped. The first failure was a fixture assertion mismatch, not a runtime code defect; runtime `rules.js` was not changed.


## 2026-11-06 — NCS 유지비로 인한 AI 준비 단계 매치 종료 (#348)

- Test commit `c4bb96875778d3a038fba6e3a058191e943fa4a4`, Actions #348 / run `42216514570`: success; 236 JS tests / fail 0; 13 Python converter tests / OK.
- New test `AI preparation stops when neutral upkeep destroys its final deck card` traverses the real player `FM.endPhase()` → AI `beginPhase()` → `payNeutralUpkeep()` path. The AI has one neutral-cost unit, no lands/soul pool, and exactly one deck card. Unpaid upkeep destroys that final card; the player wins; AI hand refill, automated card review/play, and round advance do not occur.
- Manual.zip `soulcost.htm` states that a unit with a neutral bead pays the neutral upkeep every turn and, if unable to pay, destroys that many deck cards. This test covers the terminal boundary where the last card is destroyed.
- Prior adjacent path: #346 / run `42215917221` verified empty-deck draw-to-six loss, after fixing the test to compare the actual lowercase fixture name (`ai.name`). Initial #345 / `42215759449` failed only that hardcoded log-text assertion (234/235 passed); runtime code was not changed. #346 passed 235/235.
- #348 is lightweight JS/Python only. DB29 pack/APK/emulator skipped. No runtime rules code or DB29 data changed.


## 2026-11-06 — Skill1 secondary cluster DP boundaries (#350)

- Manual source: Dropbox `/판마/Manual.zip`, `specialability.htm` §9 (Charge uses AP + own DP; DP can still attack when AP is 0 or *0) and §13 (Frenzy sets own HP to 1 and adds sacrificed HP to attack damage).
- Test commit `9575dcd77738daacd0d57ede0baa6e6f9fc928c2`, Actions #350 / run `42217090860`: success; 236 JS tests / 0 failures; Python converter 13 / OK.
- Pathfinder / `10010624588` charge boundaries at AP0: own DP3 vs defender DP2 yields 1 damage; own DP1 vs defender DP3 is fully absorbed (0 damage).
- Dark Familiar / `10010624538` frenzy boundary at AP0: HP4 falls to 1 (3 sacrificed) and defender DP2 reduces the final damage to 1. Existing one-HP no-sacrifice boundary remains.
- This was test-only. No runtime handler, source mapping or DB29 data changed; DB29 pack/APK/emulator were skipped.


## 2026-11-06 — 관통공격 DP 상한/0 경계 (#352)

- Test commit `d95bbed32445de4b6577efe4600a0fa3cc0abb46`, Actions #352 / run `42218090054`: success; JS 236 tests / 0 failures; Python converter 13 tests / OK.
- Manual.zip `specialability.htm` §4 says piercing destroys target DP by attacker AP; when DP reaches zero, remaining AP damage is carried to HP.
- DB29 Manual card fixture 블랙유니콘 / `10091525214`: attacker AP2 vs target DP4 leaves DP2 and HP damage 0; attacker AP3 vs target DP0 leaves DP0 and deals 3 HP damage. Existing AP4 vs DP2 still leaves 2 HP damage.
- The same Manual text does not explicitly state how an already-negative DP modifies piercing leftover damage. No generic AP-minus-negative-DP inference was added; that case remains review-only until a reliable source rule clarifies it.
- Test-only; no rules.js, mapping, converter, DB29 data, pack, APK or emulator mutation/run.


## 2026-11-06 — 관통공격 DP marker/overflow 회귀 수정 (#355~#357)

- DB29 Manual Skill1 대표 fixture: 블랙유니콘 / `10091525214` / `관통공격`. Manual.zip `specialability.htm` §4: 공격자 AP로 상대 DP를 파괴하고 DP가 0이 된 뒤 남은 AP만 HP 피해로 전달한다.
- Manual의 공통 능력치 표식 설명: `△`는 하락 방지, `▽`는 상승 방지. 따라서 `△`가 양수 DP 감소를 막으면 DP가 깨지지 않았으므로 관통 잔여 AP가 HP로 전달되지 않아야 한다. `▽`는 하락을 막지 않으므로 DP 감소가 가능하다.
- Actions #355 / run `42221259328`, test HEAD `cce73a83702daa9ab5ee114350497b560f2acda6`: success; 236 JS tests / 0 failures; Python converter 13 / OK. Added AP=DP exact boundary and negative DP conservative case. Negative DP is treated as already exhausted; its magnitude is not added as extra damage. Manual §4 does not explicitly resolve negative DP, so this remains an explicit conservative runtime interpretation.
- Actions #356 / run `42221573459`, test HEAD `c665a105de796bb4eb10a60bdf1650990e52f2bd`: failed one new marker assertion (236 tests, 1 failure). The `△` case expected HP damage 0 but old engine returned 4, revealing that a blocked DP decrease was incorrectly treated as available HP overflow.
- Runtime fix commit `6d736aa9e56c677aa7f2dcbfe94571b9a54d818b`; Actions #357 / run `42221699683`: success; 236 JS tests / 0 failures; Python converter 13 / OK. HP overflow now occurs only if positive DP is actually reduced to zero, or the defender DP was already zero/negative. `△` blocks DP reduction and HP overflow; `▽` permits DP reduction and normal overflow.
- #355~#357 are lightweight PR tests only. DB29 pack, Gradle/APK, package/signature/ZIP and emulator were skipped. No DB29 SQLite/source mapping or release asset was changed. The Manual Skill1 T spec still records 172 exact label rows and representative card ID, but its card-local effect excerpt/runtime status remains pending; this APK fixture is not an SQLite→pack→Android lineage proof.


## 2026-11-06 — Manual Skill1 shield-break boundary and stat-marker tests (#361)

- APK PR #28 test commit `74ce501d4b97081ad4223b9868eb9bb26711ea68`, Actions #361 / run `42223636601`: success; JS 236 tests / 0 failures; Python converter tests success. Lightweight PR gate only; DB29 pack/APK/emulator skipped.
- Exact DB29 Manual Skill1 label fixture: 해적전투원 / `10010624551` / `방패파괴`. Manual.zip `specialability.htm` §21 says after the attack, target DP becomes 0; if target DP is negative, the rule has no effect. The spec row records 96 exact label rows but the card-local effect excerpt remains pending; do not overstate this as a recovered card-local quote.
- Added checks: AP0 does not trigger the effect; DP0 permits ordinary AP damage and stays 0; positive DP is set to 0 after the attack; negative DP remains unchanged; DP `△` blocks the reduction and prevents any HP overflow; DP `▽` permits the reduction. The effect is post-attack and does not itself add damage to HP.
- Runtime handler unchanged; test-only. This is fixture-level rule coverage, not DB29 SQLite→converter→APK pack lineage proof. DB29 remains preserved, DB30 unpublished.


## 2026-11-06 — Manual Skill1 shield-break and curse marker regression (#361/#363)

- APK PR #28 test commit `74ce501d4b97081ad4223b9868eb9bb26711ea68`, Actions #361 / run `42223636601`: success; JS 236 / 0 failures; Python converter passed. It adds Pirate Combatant / `10010624551` Shield Break: AP0 no-trigger, DP0 baseline, negative DP no-effect, positive DP set-to-zero, DP `△` decrease blocked and `▽` decrease allowed. The rule is post-attack; it creates no extra HP overflow.
- Follow-up test commit `51222519ffa6f22b015bf0cea9ef16829b92ea73`, Actions #363 / run `42224203597`: success; JS 236 / 0 failures; Python converter passed. It adds Dark Joker / `10030324708` Curse Attack: AP0 no-trigger; AP `△` protects AP while DP `▽` permits DP−2; AP `▽` permits AP−2 while DP `△` protects DP.
- Manual source: Dropbox `/판마/Manual.zip`, `specialability.htm` §21 Shield Break (DP becomes 0 after attack; no effect if DP is negative) and §22 Curse Attack (target AP/DP −2); common stat-marker directions from `cardability.htm`.
- T machine-readable Skill1 spec currently still says `implementation_status=pending_engine_test` for shield_break and keeps `exact_db29_source_text=null`; these focused fixture tests exist but card-local packet/runtime pack lineage is not completed. Do not invent an accepted status enum or treat label match as card-local source evidence.
- Both runs are lightweight JS/Python only. DB29 pack/APK/emulator skipped. No runtime source mapping or DB29 data was changed.


## 2026-11-06 — Manual Skill1 Vampiric Attack HP marker directions (#365)

- Test HEAD `15162b6d46043e9e297392feecf48bc40d3bacce`, Actions #365 / run `42228582000`: success; 236 JS tests / 0 failures; Python converter tests 13 passed.
- Exact DB29 Skill1 fixture: Dark Countess `10010624542` / `흡혈공격`. Manual `specialability.htm` §7: heal 50% of actual HP damage, odd damage rounds half-up (5 damage→3 heal). `cardability.htm` §6(b): `*` blocks all stat changes, `△` blocks decreases but allows increases, `▽` blocks increases.
- Added focused checks: HP `△` allows +2 heal from actual damage 3 (HP 2→4); HP `▽` blocks positive heal; HP `*` blocks all healing. Existing test already covered actual damage, half-up for 1/2/5 damage, fully DP-blocked no-heal and `▼` blocked increase.
- Test-only change. Runtime handler, source mapping, SQLite, DB29 pack, APK build and emulator were unchanged/skipped. Formal T spec and card-local source packet remain pending; no mapping/status promotion.


## 2026-11-06 — Manual Skill1 aging-attack trigger and AP boundaries (#367)

- Test commit `b88db5b55576854a2f8fe94ec5b72d2f078b66f6`, Actions #367 / run `42229779160`: success; 236 JS tests / 0 failures; Python converter 13 / OK.
- Exact DB29 Skill1 label fixture: 타락자 / `13020626691` / `노화공격`; Manual.zip `specialability.htm` §8 says an attack applies AP−2 to the target.
- Added assertions: AP0 no-trigger; AP1 against defender DP2 produces zero HP damage but still applies AP−2; target AP `△` blocks the decrease; `▽` permits it; target AP1 falls to −1 after the full −2 (no inferred zero clamp).
- Test-only. `rules.js`, converter, source mapping, DB29 SQLite/pack, tag and Release unchanged. T formal spec remains design-only and card-local TextBase/TextExtra packet is still pending. APK #367 ran JS/Python only; pack/APK/emulator skipped.


## 2026-11-06 — Manual Skill1 target-ability AP marker boundaries (#369)

- APK test commit `7c18d444f0b9d1e852abb7a8cef49dc0b0dec84c`, Actions #369 / run `42231717568`: success; 236 JS / 0 fail, Python converter 13 / OK.
- Exact DB29 Skill1 fixtures: 네추럴마스터 `11011925567` / 야수조련; 혼드비스트 `10010624550` / 주문봉쇄; 데크라프 `10010624543` / 무기봉쇄. Manual `specialability.htm` §§10, 18, 19 set target AP to zero only when the target has the respective Beast, Magic, or Equipment ability.
- Added for each rule: AP0 no-trigger; matching target with AP `△` protects AP from reduction; AP `▽` permits reduction to zero. Existing matched-ability and nonmatching-ability cases remain.
- Test-only. Runtime handler, source mapping, converter, DB29 and Release unchanged. Formal T spec remains design-only and card-local source/pack lineage pending. DB29 pack/APK/emulator skipped.

## 2026-11-07 — Deck quantity zero-state and Skill1 authorization tuple follow-up

- PR #28 adds DeckState.adjustDeckCounts() as the single quantity-edit rule: it validates ±1 changes, keeps 1 → 0 as an empty saved deck, rejects underflow, enforces per-card limits, and prevents exceeding the 50-card editor ceiling.
- app.js now delegates quantity changes to the helper; match startup remains separately gated at exactly 50 cards and reports the current deck size.
- Added regression coverage for the full zero transition, intentional empty-state persistence, underflow, per-card limit, deck ceiling, and app wiring. Added Skill1 normalization matrix coverage for mapping status + authority + known rule ID as a complete authorization tuple.
- Commits: bb4ade030346ac970ca84a18b0e21a995e417d5a (Skill1 authorization matrix), e01b9d922c94df019c0864d3c995080884579b30 (shared quantity helper), dbf0b1d09975f309dfcf14ce4937a672d504eb04 (app integration), 5fc4bdfda69eb2c29cc07595eeb214d249da6a2c (zero/limit regression tests).
- At documentation update time, no PR-triggered Actions run was returned for latest HEAD 5fc4bdf...; these new tests are therefore pending CI verification. Latest previously confirmed run remains #394 / 42303760472 on earlier commit 4d7d92d..., successful lightweight JS/Python checks. It did not run Gradle/APK/emulator.
- DB29, DB30, main/release and PR merge state unchanged. PR #28 remains Draft/Open.


## 2026-11-07 — Follow-up CI verification (#399)

- Actions #399 / run 42305021654 completed successfully on the exact source HEAD `accc3e389333dacd9d69418f897ad80e677f62a5`.
- JS rule tests: 253 passed / 0 failed. Python converter self-test passed; SQLite pack tests: 13 passed; enchant audit self-test passed.
- The new deck quantity 1 → 0/underflow/limit/50-card-ceiling cases and Skill1 mapping authorization tuple matrix are included in the passing JS run.
- This remains lightweight CI. DB29 pack build, JDK/SDK/Gradle, APK verification and emulator launch were skipped by the PR policy. DB29 is unchanged; no DB30; main/release unchanged; PR #28 remains Draft/Open/unmerged.

## 2026-11-07 — Effect-aware AI spell targeting (#402)

- AI target selection now scores healing spells by missing HP and excludes allies whose HP cannot be increased; it no longer defaults to the highest-AP ally for healing.
- Damage/drain spells prefer a legal lethal target, then lower remaining HP and higher AP. Buff spells rank units by eligible stat gains while respecting stat markers.
- Regression tests exercise the real AI preparation path for wounded-ally healing and lethal enemy selection.
- Actions #402 / run 42305382686 succeeded on test commit 846e2105346a4da4bd1c47b4104887bf7ab6916a: 255 JS tests passed / 0 failed; Python converter self-test, 13 SQLite tests, and enchant audit self-test passed.
- Lightweight PR CI only; card pack, APK build and emulator remain skipped. DB29/DB30/main/release unchanged; PR #28 remains Draft/Open/unmerged.

## 2026-11-07 — AI tactical spell ordering and regression diagnosis

- AI now scores spell utility and gives a legal high-value spell (especially a lethal target) priority over a unit when both compete for preparation souls; lower-value spells remain behind unit deployment.
- Added a real preparation-phase regression with a lethal damage spell and a summon sharing the same two-soul pool. The spell must be queued first, then the unit deployed using the remaining soul.
- CI attempts #405–#407 failed only in this new ordering assertion. Log inspection showed the runtime's log array is newest-first, so the test compared the array indices in the wrong direction; no gameplay assertion or existing test failed. The assertion was corrected to match that contract in commit 66b3a6cc6918f258a15c99db9067f1ceb2646398. Verification for this corrected HEAD is pending.
- DB29 immutable; DB30 unpublished; main/release untouched; PR #28 remains Draft/Open/unmerged.

## 2026-11-07 — Corrected AI ordering test passed (#409)

- Actions #409 / run 42305975759 succeeded on source HEAD 1f6ed3d91d6ebd1fb81f513ce4f9770ea5be68fd.
- JS tests: 256 passed / 0 failed. Python converter self-test passed; SQLite pack tests: 13 passed; enchant audit self-test passed.
- The earlier #405–#407 failures were caused by the new test treating the reverse-chronological log array as chronological. The runtime order was already correct: lethal spell first, unit second. The corrected assertion passed; no production-code rollback was needed.
- This is still lightweight CI: DB29 pack, APK build and emulator are skipped. DB29/DB30/main/release remain unchanged; PR #28 stays Draft/Open/unmerged.

## AI buff target marker regression — 2026-11-07

- Runtime change commit `d9e33064b53a45136b0034ad78d2d78bdcc211cf`: AI buff-spell target selection now excludes units where every requested stat change is blocked by Manual stat markers. This prevents spending a spell on a target that cannot receive the requested change.
- Test commit `6b601cc719f420db165eeee4867c44e4759a3889`: added AI preparation-path regressions for choosing a legal buff target and retaining the spell when all targets are marker-blocked.
- Actions #413 / run `42307205056` succeeded on exact HEAD `6b601cc719f420db165eeee4867c44e4759a3889`: 259 JS tests passed / 0 failed; Python converter self-test passed; SQLite pack tests 13 passed; enchant audit self-test passed.
- This is a focused AI target-selection correction. It does not verify all card effects or full APK/emulator gameplay. DB29 unchanged; DB30 not published; main/release untouched; PR #28 remains Draft/Open/unmerged.


## User test APK request — 2026-11-07

- User requested an installable APK for hands-on testing from the current PR baseline. The latest successful lightweight PR run (#414 / `42307280303`) uploaded only `build-status.txt`; the report confirms `Signed release APK: not-configured`, and inspection of the 565-byte artifact ZIP confirms no APK was included.
- PR #28 title now includes `[build-apk]` to request the APK-only Gradle build on the next PR synchronization. This will produce the debug APK without requiring release-signing secrets; signed Release APK remains optional.
- DB29 pack/emulator execution is not requested by this note. DB29 remains unchanged, DB30 is not published, and PR #28 remains Draft/Open/unmerged.


## Malformed upkeep overlay correction — 2026-11-07

- Runtime commit `9eef81ac4461f3c229fe5ba230c8d839b069c51e` changes malformed explicit `runtimeUpkeepCost` handling: invalid objects no longer silently mean zero upkeep; the engine falls through to the verified runtime/source cost profile and then the finite conservative fallback.
- A valid explicit `{ neutral: 0 }` remains a deliberate zero-upkeep value.
- Regression test exercises the actual preparation-phase path with both malformed and explicit-zero upkeep units, verifies only the conservative two-soul amount is consumed, and confirms the phase draw proceeds afterward.
- Actions #422 / run `42313314863` passed: JavaScript game-rule suite and Python converter checks passed. DB29 pack, Gradle/APK, and emulator were intentionally skipped; only a 562-byte build-report artifact was retained.
- DB29, DB30, main and release remain unchanged; PR #28 remains Draft/Open/unmerged.


## 2026-11-07 — opening resources, legality, deck editor and landscape UI

- Initial deal: both sides must receive at least one land if the deck contains a land. A free/installable land is preferred; after bounded shuffle attempts the fallback extracts a legal land even if every land has a payment cost.
- Voluntary mulligan: shuffle the remaining deck and hand, burn one card, then draw to six. It deliberately does not guarantee another land.
- Defensive preparation: after existing NCS upkeep is paid, the defender receives one neutral soul. The bonus cannot rescue an unpaid upkeep; it contributes to remaining resources and the deployment limit.
- Unimplemented spell/enchant effects marked `fallback_noop` are no longer consumed as if they were normal successful plays. They stay in hand, do not spend souls, and are visibly disabled with a reason. Supported effects still pass the normal payment, target and slot checks.
- Deck editor: card-name/ability search plus card-type and faction filters. Landscape layout places the two battle boards side by side and separates the deck list from the card catalogue.
- Verification: 264 game-rule tests passed on commit `b5487de`; commit `1e3cf69` passed JavaScript/Python checks and Debug APK build/package verification. DB29 pack build was skipped.
- Existing DB29 artifact reused for the emulator path: run `42192845020`, artifact `13491725083` (`FM1-CardData-v1.3.0-IMPORT-DB29`, approximately 406.5 MB). The workflow now downloads this original artifact archive directly and does not rebuild or re-upload the data pack.

### Soul-producing unit markers — source review, not yet executable

The community guide describes two separate unit markers: first-marked units create one soul when discarded from hand; second-marked units generate one neutral soul beginning one turn after being summoned. It also describes other third/fourth/fifth upgrade markers. This is community documentation, not a verified current Manual.zip rule mapping, and the card-level marker encoding still needs to be tied to exact source records before implementation.

Reference: https://neginote.wixsite.com/fantasymasters/guide-units

Do not equate those unit markers with the separate `NCS (82)` token in `RequireSoul`; the latter remains a semantic-review item until its exact payment/production meaning is verified. No generic NCS soul production has been invented.


## 2026-11-07 — N/C/S(82) stat notation correction

- User-confirmed card-stat notation: N = Normal attack, C = Critical attack, S = Defensive; the (82) suffix means attack dice range 0–8 and defense dice range 0–2. A unit with NCS has all three stat categories; NC(80) omits S.
- This notation is distinct from the RequireSoul field's source token code. Do not reinterpret a unit's NCS(82) stat notation as a soul-generation or soul-payment mechanic.
- The current combat engine rolls AP/DP coin modifiers from coinTech; this patch adds explicit lower/upper-bound regression coverage for 0–8 AP and 0–2 DP dice and makes AI blocker estimates use the same expected coin modifiers instead of ignoring coinTech.
- Critical (C) remains a separately identified stat category in the notation; its precise combat resolution must be connected to the correct source fields and manual rule before being treated as implemented. No critical multiplier or probability is invented here.
- Validation is pending for this commit. DB29 pack rebuild is not required; the existing audited DB29 artifact remains the input for emulator validation.


## 2026-11-07 — Firestore coin source-field mapping

- Manual coin.htm confirms a single shared coin toss set is used across AP/DP/HP; each stat applies its own operation to the same result. Examples include AP +2C1 with DP -C1, which uses one coin toss, not two independent tosses.
- Firestore sourceCoinTech fields are ATKCoin/DEFCoin/HPCoin (C-count and multiplier expression), corresponding CoinType operator codes (0 NONE, 1 PLUS, 2 MINUS, 3 X, 4 EQUAL), and CoinCount fields. Card-schema now maps these raw source fields into executable coinTech only when expression, operator and count agree; inconsistent/missing source metadata remains review-only.
- Critical (C) remains a separately named stat category in user-provided NCS notation. This source-field mapping does not invent a critical-damage multiplier or probability.


## 2026-11-07 semantic audit correction — RequireSoul upkeep and coin test

- Withdrawn: RequireSoul NCS(82) is not established by Manual as the colorless bead. The app no longer derives recurring upkeep from NCS(82) or from a generic one-time neutral runtime cost.
- The Manual's blank/colorless bead is crosswalked provisionally to MU(81); only MU(81) token amounts are used for recurring unit upkeep. This remains an inferred enum-to-icon crosswalk pending visual verification of the source icon against Manual images.
- NCS(82), BONUS(83), and hybrid pair tokens retain their source identity and are not used for upkeep. Their payment fallbacks are documented separately in CardDB.
- Removed the misleading test that labelled synthetic 8-AP/2-DP coin counts as an NCS(82) parser test. Added the actual Manual example +2C1 AP / -C1 DP and asserted that both stats use the same single toss.
- User-confirmed N/C/S stat notation remains separate from Firestore RequireSoul enum NCS(82), CoinType, and StatType marker enums. Critical attack stat resolution is not claimed implemented by this patch.


## 2026-11-07 — Manual opening-hand redraw correction

Manual `gamerule.htm` states that the initial six-card deal is repeated if it contains no land. The redraw returns the dealt cards to the deck and shuffles again; it does not require a free/zero-cost land. The app previously preferred a playable free land, which was an invented condition, and its deterministic fallback could leave fewer than six cards. The updated implementation accepts any land and ensures the fallback still fills six cards. Voluntary mulligan remains separate: it burns one card and carries no land guarantee.

The defender's +1 generic soul is a project balance rule requested during testing, not an official Manual rule. It remains a clearly identified house-rule bonus and must not be described as source-canonical.


## 2026-11-07 — Card-stat source-field audit

Firestore `ATKStatType`, `DEFStatType`, and `HPStatType` were previously not copied into the app card pack. The pack builder now preserves them as `sourceStatTech`; CardSchema maps only the Manual-described marker meanings: `CONST` (★), `UP` (▲), and `DOWN` (▼). The Manual states ★ blocks all changes, ▲ blocks decreases, and ▼ blocks increases. Other source enum values (`FRONT`, `BACK`, `HAND`, `TURN`, `PLUS`, `MINUS`, `EQUAL`) are retained with their source codes but are not given invented runtime behavior until a Manual rule is found.

Do not conflate these fields with the user-confirmed N/C/S shorthand (N=Normal attack, C=Critical attack, S=Defense; (82)=attack dice 0–8 and defense dice 0–2), Firestore `RequireSoul` code 82, `CoinType` C (coin), or the separate `RankType` enum. The N/C/S shorthand has not yet been tied to a specific Firestore source field; it is not synthesized from `RankType` or `RequireSoul`.

## 2026-11-07 — RequireSoul runtime correction

CardSchema now reparses each card's original `sourceFields.RequireSoul` when loading the existing DB29 pack. This overrides stale runtime profiles: MU(81) is the inferred Manual-neutral crosswalk and supplies unit-only upkeep; NCS(82), BONUS(83), and hybrid pair tokens are preserved as candidate identities and use tagged generic payable fallbacks without recurring upkeep. Hybrid pairs are no longer charged as both colors. DB29 itself remains immutable and was not rebuilt.


## 2026-11-07 — TextExtra effect audit: Klub variants

Firestore records 16120828657–16120828663 contain TextExtra-only effects named 전력봉인 and 중급열사. The text explicitly describes a 3-turn status that, on activation, removes one 유소울 or NCS소울, increases upkeep by one, and reduces DP by one. These effect names are not the Skill2 enum: the same card's Skill2=129 maps to 절해라, while Skill1=51 maps to 관통공격. One variant has RequireSoul=71048103 (4 light + 3 MU), not RequireSoul NCS(82).

This is a separate source-text resource/effect question, not the user-defined N/C/S(82) stat notation. The reviewed Manual pages and web searches did not define the NCS소울 resource pool or status timing. The app preserves TextExtra but does not execute 전력봉인/중급열사 yet; do not claim these effects are implemented until their lifecycle and resource source are verified.


Converter validation note: the app pack builder now reparses raw RequireSoul tokens, keeps NCS/BONUS/hybrid candidates separate, uses a tagged generic payable fallback for unresolved tokens, maps iron to the runtime metal key, and derives unit upkeep only from the inferred MU(81) neutral-bead crosswalk. The latest converter self-test is being re-run against this exact PR head; DB29 ZIP remains reused and immutable.


Firestore enum raw-code audit: `Enum+StatType` row values, not outer map indexes, are the card-field codes: 1=NONE, 11=CONST(★), 12=UP(▲), 13=DOWN(▼), 21=FRONT, 22=BACK, 23=HAND, 24=TURN, 31=PLUS, 32=MINUS, 33=EQUAL. `Enum+CoinType` raw codes are 1=NONE, 2=PLUS, 3=MINUS, 4=X, 5=EQUAL. The earlier synthetic 1/2/3 StatType fixtures and 0/1/2 CoinType assumptions were incorrect and are replaced.


Final enum regression fixture alignment: explicit zero-cost source rows use raw `RequireSoul=0100`; converter fixtures no longer pair an empty normalized soul object with a nonzero raw cost string. Current source-code mapping is StatType 1/11/12/13/... and CoinType 1/2/3/4/5 as documented above.


### EarnSoul / RequireSoul code-82 namespace split

The Firestore enumtable defines `EarnSoul` raw code 82 as `MU02` (two neutral souls produced per token), while `RequireSoul` raw code 82 is the separate `NCS` token. The user-confirmed `NCS(82)` notation is a third, unrelated unit-stat shorthand (N/C/S with attack dice 0–8 and defense dice 0–2). A fourth literal, `NCS소울`, appears in some `TextExtra` effects and remains a separate source-text resource question. These meanings must never be joined by the shared number/string alone. The app's `parse_earn_soul_list` already decodes `EarnSoul` 8201 as two neutral output; converter self-tests cover it separately from `RequireSoul` 8201 review handling.
