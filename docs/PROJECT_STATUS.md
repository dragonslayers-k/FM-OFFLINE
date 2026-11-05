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
- 효과 후보 `pattern_candidate`는 표시·검색용 참고 자료이며 실행 가능한 규칙으로 취급하지 않는다.
- Manual.zip에서 확인된 27개 기본 공격 기술은 카드의 `Skill1`이 `manual_verified`로 매핑되고 개별 엔진 핸들러 테스트가 통과한 경우에만 실행한다. 후대 커뮤니티 후보 41개와 `Skill2`는 기본적으로 실행하지 않는다.
- 카드 원문, 원본 Firestore 필드, 카드별 원본 URL 및 이미지 URL을 보존한다.
- 효과가 매핑되지 않은 카드는 실행 가능한 것처럼 표현하지 않는다.
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
