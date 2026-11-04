# FM1 외부 참고자료 적용 가이드 (카드DB·Android 엔진 공통)

- 기준일: 2026-11-05
- 카드 원본 및 DB Release 책임: [dragonslayers-k/T](https://github.com/dragonslayers-k/T)
- Android 구현 책임: 이 저장소 `dragonslayers-k/FM-OFFLINE`
- 데이터 기준: 불변 `fm1-carddb-29`
- 연계 DB 운영 가이드: https://github.com/dragonslayers-k/T/blob/feat/carddb-effect-semantic-pass/docs/MASTER_OPERATING_GUIDE_2026-11-05.md

## 1. 출처 계층 및 사용 범위

| 우선순위 | 출처 | APK 적용 범위 |
|---:|---|---|
| 1 | 사용자 제공 FM1 `Manual.zip` | 공통 게임 규칙, 기본 특수 공격 기술, 소울·LP·전투·턴 처리 |
| 2 | T의 불변 DB29 원본 payload + 카드별 상세 URL | 카드 ID, 카드 원문, 속성·유형·비용·Skill·효과 후보의 카드별 근거 |
| 3 | FM LUNATIC 카드 아카이브 | 원본 카드 목록·카드 표기·카드별 상세 문구와 이미지 참조 |
| 4 | NamuWiki/Namu-moe의 판타지 마스터즈 문서 및 개별 카드 항목 | 카드 유형·분류 색인·종족/소속 표기·과거 카드/기술 사례의 보조 교차참조 |
| 5 | Neginote 개인 가이드 | 지형·유닛·마법 개념과 필드 명칭 보조 |
| 6 | Inven 2017 기술 모음 및 기타 커뮤니티 분석 | 기술 이름·목록·조건·효과 사례의 독립 교차참조 |
| 7 | Gamechosun 2002 등 과거 소개 기사 | 초기 속성·전투 시스템의 역사적 맥락만 참고 |

NamuWiki·개인 가이드·커뮤니티 글은 공식 매뉴얼보다 높은 권위를 갖지 않으며, 단독으로 엔진 실행 규칙을 생성하지 않는다. 판타지 마스터즈 2와 FAN-MADE MASTERS의 규칙을 FM1에 가져오지 않는다.

## 2. 외부 자료에서 확인한 카드 데이터 모델

### 카드 종류 5개
- 지형 `land`
- 유니트 `unit`
- 아이템 `item`
- 마법 `spell` (게임 표시명은 '마법')
- 인챈트 `enchant`

NamuWiki 메인 문서와 제공된 A.docx는 다섯 유형을 명시한다. 앱 스키마도 이미 다섯 유형을 지원하므로 외부 자료를 근거로 별도 타입을 추가하지 않는다. 인챈트는 분류상 카드 종류이며, `EnchantSlot`은 별도 원본 필드/슬롯 값이다.

### 속성·종족·소속·능력의 차이
- 속성(attribute): 암흑·불·물·숲·대지·금속·빛·무(중립) 8개. 3.4 속성 문서는 7개 속성 하위 항목을 두지만 메인 문서는 대격변 이후 무속성 분리를 설명한다.
- 종족(race): 유닛 종족 분류.
- 소속(affiliation): 집단·직업·세력·조직 분류.
- 유닛 능력(ability): 장비·마법·야수·만능. 장비 착용 제한 판정과 종족·소속 분류를 혼동하지 않는다.

현재 데이터팩의 `faction`은 카드 속성 키를 나타내는 기존 호환 필드다. `race`와 `affiliation`은 별도 필드로 보존하고, 문서·신규 정규화 모델에서는 `attribute`를 카드 속성의 의미명으로 사용한다. 소속을 카드 속성 `faction`과 합치지 않는다.

### 분류 목록은 독립 관리
NamuWiki 3.6 개별 카드 목록, 속성별 분류 페이지, T DB29 전체 카드 ID 목록은 목적·시점이 다르다. 세 목록을 한 목록으로 합쳐 덮어쓰지 않는다. 이름이 같거나 표기가 비슷해도 card ID·속성·종류·이미지·원본 설명·리콜 버전을 확인하기 전 자동 병합하지 않는다.

## 3. 외부 카드 설명의 적용 예시와 실행 제한

A.docx 및 NamuWiki 본문에는 슬픈재회, 인어의애정, 도깨비씨름, 뿌리침투, 숲의지도자, 짙은안개, 폐허의흔적, 마력결계진, 석병팔진, 소르다스의검 등 효과 설명이 포함된다. 이 설명들은 카드별 원본 상세 텍스트와 대조할 후보이며, 바로 엔진 규칙으로 취급하지 않는다.

검색 색인으로 확인한 별도 개별 페이지에는 스터두라엘(금속 유니트/휴먼/머시너리), 번창하는숲(핸드 지형 소각 후 트리언트 소환), 샤와타의그물(숲 스페셜 카드), '무'라는 이름의 숲 속성 시크릿 유닛 사례가 있다. 이는 다음 사항을 강조한다.
- 카드명 `무`를 무속성으로 오인하지 말 것.
- `attribute`, `race`, `affiliation`, `card_type`을 별도 필드로 취급.
- 텍스트에 나온 카드 목록을 ID·리콜·종족·능력·장착 가능 여부와 교차 확인.
- 카드 설명의 수량·순서·지속시간·실패 조건은 원본 TextBase/TextExtra와 일치하는지 확인.

NamuWiki의 일반 전투 공식과 카드 예시는 공식 Manual.zip의 게임 규칙을 대체하지 않는다. 엔진 규칙은 매뉴얼 또는 카드별 원문과 독립 재현 테스트에 근거해야 한다.

## 4. 효과 핸들러 구현 게이트

각 effect handler 또는 skill handler는 다음을 명시한다.
1. 원본 카드 ID / canonical Rule ID
2. 원문 TextBase / TextExtra 및 카드 상세 URL
3. trigger timing / actor / target selector
4. preconditions / cost / operation
5. formula / rounding / cap / order
6. duration / end timing / stacking
7. failure effect / unsupported branches
8. source authority / verification status / executable status
9. 성공·실패·경계조건·동일 턴 상호작용 테스트

다음 데이터는 테스트가 추가되기 전까지 실행하지 않는다.
- `pattern_candidate` 효과 후보
- 의미 검토 pending
- 커뮤니티 자료만으로 매핑된 기술
- 카드별 원문이 불충분한 OCR fuzzy / 이름 충돌 후보
- hybrid 또는 NCS/BONUS 비용의 실제 지불 의미가 미확정인 경우

`non_executable` 상태를 단순 UI 기본값으로 무시하지 말고 `validateCardForPlay`/engine gating에서 차단한다. 비용이 비어있거나 의미를 확인하지 못한 카드를 무료로 처리하지 않는다.

## 5. 개인·커뮤니티 참고자료의 현재 상태

- Neginote: https://neginote.wixsite.com/fantasymasters/main-guide (가이드), /guide-rand (지형), /guide-units (유닛), /guide-magic (마법). 5종 카드·11등급·LP/소울·유닛 구성요소·마법의 공격/방어 턴 및 유지턴의 보조 용어 자료.
- Inven 2017: https://www.inven.co.kr/board/hs/3509/1426815. 코스튬체인지 지정 아이템 7개와 랜덤 장착, 에카마엘 종족·지형 최대 5의 보조 교차참조. 게시글은 DB29 TextExtra의 '아이템 미장착' 조건을 생략하므로 DB29 조건을 유지.
- Gamechosun 2002: https://www.gamechosun.co.kr/webzine/article/view.php?from=articlelist&no=13712. 초기 7속성/공격·방어 턴 설명의 역사적 맥락. 현재 8속성 데이터 구조를 되돌리는 근거로 사용하지 않음.
- Naver jlplace: https://m.blog.naver.com/jlplace/220468684977. 본문 접근 차단, 첨부 캡처 65×1536px로 글자 판독 불가. 본문 내용은 미확인으로 남기며 규칙·수치를 인용하지 않음.

## 6. 현재 구현 문서·코드 경계

- `docs/CARD_SCHEMA.md`: 데이터팩 구조와 속성/종족/소속의 의미를 설명한다.
- `docs/RULES_SOURCES.md`: 규칙 근거의 우선순위 및 역사적/커뮤니티 자료 제한을 기록한다.
- `app/src/main/assets/game/card-schema.js`: 카드 텍스트·필드 파싱, 타입/속성/종족/소속 추출.
- `app/src/main/assets/game/rules.js`: 소울·전투·스킬 및 카드 플레이 가능 여부와 효과 처리.
- 이 작업은 외부 자료 provenance와 문서 기준을 추가한 것이다. 외부 자료만을 근거로 엔진 handler 또는 실제 카드 데이터를 변경하지 않았다.

## 7. 검증 원칙

- T의 새 데이터가 정식 DB Release로 발행되기 전까지 APK는 불변 DB29 기준을 사용한다.
- 문서 변경과 엔진 구현 변경을 분리한다. 문서 PR CI 성공은 게임 규칙의 완전성 증거가 아니다.
- Actions 결과, 카드 ZIP 생성·CRC·SHA·row count 검증, emulator 설치/실행 검증을 각각 분리해 기록한다.
- 실패한 단계에 필요한 최소 검증을 먼저 수행하고 무관한 전체 build/emulator 실행을 반복하지 않는다.
