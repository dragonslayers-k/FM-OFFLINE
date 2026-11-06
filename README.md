# 판마 오프라인 APK (Fantasy Masters Offline)

Android 앱 저장소입니다. 카드 데이터 원본/크롤링/정규화 DB는 별도 저장소인 [dragonslayers-k/T](https://github.com/dragonslayers-k/T)에서 관리합니다. 이 저장소는 Android APK, WebView 게임 화면, 데이터팩 가져오기, 규칙 테스트와 APK 빌드만 담당합니다.

## 저장소 분리

| 저장소 | 책임 |
|---|---|
| [dragonslayers-k/T](https://github.com/dragonslayers-k/T) | FM LUNATIC 원본 수집, 카드 DB, 원본 URL/이미지/필드, DB Release |
| [dragonslayers-k/FM-OFFLINE](https://github.com/dragonslayers-k/FM-OFFLINE) | Android APK, 로컬 게임 UI/엔진, 데이터팩 ZIP 변환 및 가져오기 |

두 프로젝트는 같은 GitHub 계정 아래에서 독립적으로 관리합니다. APK 저장소에서는 별도 크롤러나 별도 카드DB Release를 만들지 않습니다.

## 앱 구조

- Android 네이티브 Java WebView 컨테이너
- 로컬 HTML / CSS / JavaScript 게임 화면
- 외부 FM1-CARD-DATA ZIP 가져오기와 무결성 확인
- 설치 데이터의 기존 백업 / 원자적 교체 / 실패 시 복구
- 카드 도감, 상세 보기, 덱 편집, 게임 규칙과 전투 UI
- Node.js 단위 테스트와 Python 데이터팩 변환기 검증

카드 데이터와 이미지는 APK에 포함하지 않습니다. 데이터 ZIP을 기기에 별도로 가져온 다음 오프라인으로 사용합니다.

## 빌드 기준

- JDK 17
- Android SDK Platform 35 / Build Tools 35.0.0
- Android Gradle Plugin 8.7.3
- Gradle 8.9
- Node.js 24
- Python 3.12

저장소 루트에 Gradle 프로젝트 설정과 Android 앱 모듈을 함께 두었습니다. CI는 지정된 Gradle 8.9를 설치해 루트에서 gradle :app:assembleDebug를 실행합니다.

## GitHub Actions

단일 워크플로우: [Android CI / APK Build](https://github.com/dragonslayers-k/FM-OFFLINE/actions/workflows/android-ci.yml)

- main push: JavaScript 검사, 규칙 테스트, 변환기 자체 테스트, Debug APK 빌드와 APK 무결성 확인
- 수동 실행: 필요할 때 T의 정규화 SQLite DB Release에서 Android용 FM1-CardData-v1.3.0.zip 생성 선택
- 현재 통합 기준 원본: [T Release fm1-carddb-29](https://github.com/dragonslayers-k/T/releases/tag/fm1-carddb-29) — 15,350장·30,700개 이미지·SQLite 참조 무결성 및 효과 후보 원문 위치 검증을 통과한 DB
- 자동 테스트 실행: 커밋 메시지에 `[build-card-pack]`을 포함한 main push는 카드팩 변환까지 실행
- 수동 실행: 필요할 때 Android 에뮬레이터 설치 / 실행 검사 선택
- Release 서명 Secret 4개가 모두 설정된 경우에만 서명된 Release APK도 생성
- 카드 데이터는 `FM1-CardData-v1.3.0-IMPORT-DB29` Artifact로 별도 제공한다. 다운로드 ZIP 최상위에 `cards.json`, `manifest.json`, `images/`가 있으므로 압축을 다시 풀거나 안쪽 ZIP을 찾지 않고 APK에서 바로 선택할 수 있다.
- APK와 빌드 보고서는 `FantasyMastersOffline-build-output` Artifact로 별도 제공한다.

### 수동 실행

GitHub 저장소 → Actions → Android CI / APK Build → Run workflow에서 실행합니다. 카드팩 생성은 build_card_pack, 에뮬레이터 확인은 run_emulator를 선택합니다. 일반 push는 459MB 이미지 아카이브를 다시 받지 않습니다. 단, 커밋 메시지에 `[build-card-pack]`이 포함되면 카드팩 생성 검증을 위해 원본 Release를 받아 변환합니다.

### Release 서명 설정

Settings → Secrets and variables → Actions에 다음 Repository secrets를 등록합니다.

- ANDROID_KEYSTORE_BASE64
- ANDROID_KEYSTORE_PASSWORD
- ANDROID_KEY_ALIAS
- ANDROID_KEY_PASSWORD

키 파일을 저장소에 올리지 마십시오. 같은 앱의 추후 업데이트에도 동일한 signing key를 사용해야 합니다.

## 카드 데이터 계약

DB 변환 결과는 다음을 포함합니다.

- cards.json: 카드 15,350건, Firestore Document ID 기준 (T normalized SQLite v2)
- manifest.json: 데이터팩 형식 / 버전, 카드·이미지 수, 카드 JSON SHA-256
- images/{documentId}.webp: 카드별 원본 대형 이미지
- 카드별 sourceCardUrl, sourceListUrl, sourceImageUrls, 원본 필드 sourceFields 보존
- RequireSoul 검증 플래그, 혼합 비용·NCS/BONUS 검토 상태, 원본 토큰, 카드 효과 후보와 절 위치 보존
- Manual.zip 기본 특수기술 27개와 2017년 커뮤니티 후보 41개, 카드별 Skill1/Skill2 매핑과 근거 계층 보존
- `skill-catalogue.json`: 원본 규칙의 출처·충돌·미구현 상태까지 별도 보존
- T SQLite에 기록된 대형 이미지 SHA-256을 데이터팩 이미지 추출 결과와 재대조

현재 5종 공식 분류는 Land 289, Unit 8,633, Magic 3,857, Item 1,748, Enchant 823입니다. Enchant는 다섯 번째 정식 분류입니다. T SQLite의 기준으로 비지형 비용 14,244건은 확정 토큰 매핑, 817건은 검토(혼합 매핑 38건 + NCS/BONUS 의미 779건)이며 지형 설치 비용 275건 확정, 14건 검토입니다. 검토 비용은 무료나 확정 비용으로 바꾸지 않습니다. 효과 후보 17,407개와 절 구간 48,281개는 원문 위치 및 `pattern_candidate` 검증 상태를 보존하며, 각 절에는 별도 runtime disposition을 부여합니다. 검증된 handler가 없는 절은 `fallback_noop`으로 종료하며 카드 전체 사용을 막지 않습니다. 매뉴얼에서 확인한 특수기술 27개는 카드의 Skill1 매핑이 정확할 때만 기준 규칙으로 연결합니다. 후대 커뮤니티 후보 41개와 매핑되지 않은 기술은 실행하지 않습니다.

## 구현 상태 표기

이 저장소는 FM1 오프라인 복원 프로젝트이며 원작 전체 플레이 완료판이 아닙니다. 카드 도감에 보이는 것, APK 빌드 성공, 데이터팩 구조 검사 성공, 실제 카드 효과 실행 및 대전 검증은 각각 별도 단계입니다. 미확인 비용은 무료로 취급하지 않고 지불 가능한 runtime 추정/fallback을 적용합니다. 미지원 효과는 해당 clause만 no-op으로 종료하며 실제 불법 행동만 차단합니다.

자세한 제한과 검증 경계는 docs/PROJECT_STATUS.md, docs/CARD_SCHEMA.md, docs/RULES_SOURCES.md를 참고하십시오.

## 저작권

본 프로젝트는 판타지 마스터즈 원작사의 공식 앱이나 제휴 프로젝트가 아닙니다. 원작 카드 이미지·데이터의 재배포 권리는 별도로 확인해야 하며, 실제 공개 배포 전에는 권리자의 허가 또는 명시적 라이선스를 확인해야 합니다.

## 데이터 기준 및 효과 실행 경계

- Android 데이터팩 1.2.0은 T SQLite Release `fm1-carddb-29`에서만 생성한다. APK 저장소에서 JSONL 비용을 다시 해석하지 않는다.
- 카드 ID와 상세 URL이 다르거나 이미지 SHA-256이 SQLite와 다르면 변환을 중단한다.
- 혼합 소울 비용과 NCS/BONUS는 T DB의 검토 상태를 그대로 전달하며, 무료 비용으로 바꾸지 않는다.
- T DB의 효과 후보와 절 단위 원문 위치는 보존하지만 `pattern_candidate`는 실행하지 않는다. 매뉴얼·카드별 검증 및 게임 엔진 테스트를 통과한 핸들러만 실행 가능하다.
- 특수기술 실행은 `Skill1`의 `manual_verified` + `manual` 매핑만 허용한다. `Skill2`, 커뮤니티 후보, 미매핑 값은 표시·분석 자료이며 자동 발동하지 않는다.

## v4.9 runtime playability policy

- `source cost` and source-review flags remain immutable provenance. The engine consumes `runtimeCost` first; pending source review does not block use.
- NCS uses any generated soul and contributes recurring upkeep only for units. BONUS uses any generated soul once and does not become recurring upkeep.
- Every card receives a payable runtime cost (explicit source zero remains zero; missing/unknown is a tagged neutral fallback). Every unit receives a finite `runtimeUpkeepCost`.
- Unmapped item target conditions receive a deterministic fallback target rule. MagicLand can be installed without invented normal production. Unmapped spell/enchant effects are paid and closed through a deterministic no-op terminal action.
- Full DB29 pack validation and emulator smoke are separate explicit gates; ordinary PR synchronization runs lightweight tests only.
