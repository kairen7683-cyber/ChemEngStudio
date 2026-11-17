# ChemEng Studio — Project Backlog

> Last updated: 2026-11-17

---

## 1. [Planned · High] Plant 05: 금호미쓰이 공정 기반 100,000 MT/yr MDI 통합 플랜트 추가

- **기준 생산 규모**: **100,000 MT/yr** (`8,000 hr/yr` 기준 약 `12,500 kg/h` — Monomeric `4,4'-MDI` + Polymeric `PMDI`)
- **핵심 공정 섹션 (4개 시트 구성안)**:
  1. **Sheet 1 — MDA 합성·중화·정제**: Aniline + HCHO (HCl 촉매 축합·전위) → NaOH 중화/수세 디캔터 → 미반응 Aniline 감압 회수탑 → Crude MDA
  2. **Sheet 2 — 포스겐(`COCl2`) 제조 및 MDA 포스겐화**: CO + Cl2 활성탄 촉매 합성 → MCB 용매 저온/고온 포스겐화 → 부생 HCl 분리·흡수
  3. **Sheet 3 — 탈포스겐 및 MCB 용매 회수**: 잔류 `COCl2`/`HCl` 스트리핑 → 포스겐 응축 리사이클 → MCB 다단 진공 회수탑
  4. **Sheet 4 — Polymeric / Pure `4,4'-MDI` 진공 분별증류**: 박막증발기(TFE) + 고진공 분별증류(사이드컷 적용 검토) → `PMDI`(탑저) 및 `4,4'-MDI`(탑정/측류) 분리
- **확장 필요 성분 (`SimCompKey` · 물성 DB)**: `Aniline`, `HCHO`, `MCB`, `COCl2`, `MDA`, `MDI`, `PMDI`
- **밸류체인 연계**: 기존 Plant 01~04의 전해 `Cl2`·`NaOH` 원료 공급 및 포스겐화 부생 `HCl` 회수 루프 연결

---

## 2. [Planned · High] 증류탑 변수선택 통합 단일 UI 및 순차 자유도 가이드

- **목적**: 기존의 `모드 A (단수 자동설계)` / `모드 B (단수 고정)` 이원화 탭·입력 구분을 제거하고 **하나의 통합 변수선택 UI**로 단순화
- **핵심 동작 설계**:
  - **형상 변수 통합**: `총 단수(N)` · `공급단(Nf)` · `사이드컷 인출단(Ns)`을 별도 모드가 아닌 선택 항목으로 통합 (체크 시 고정값 사용, 미체크 시 AI 최적 자동 탐색)
  - **순차 자유도 가이드 메시지**: 사용자가 변수(`① 환류비`, `② 유출분배 D/F`, `③ 탑정 스펙`, `④ 탑저 스펙`, `⑤ 사이드컷`)를 1개 고를 때마다 현재 자유도 상태와 다음에 추가로 선택할 수 있는 변수 안내를 실시간 표시
  - **사이드컷 주제품 자유도 지원**: 사이드컷(`⑤`) 제품 순도 지정 시 **탑정 스펙(`③`) 생략 가능** (`①+④+⑤`, `②+④+⑤`, 또는 단수 미지정 시 라이트 퍼지/불순물 기준으로 대체)
  - **Run 버튼 자동 활성화**: 고정단수·자동설계 여부에 따른 자유도가 충족되는 즉시 별도 모드 전환 없이 `Run` 버튼 활성화

---

## 3. [Planned · High] 물성 DB(`/property-db`) 공장별 전 물질 전수 등재 및 동기화

- **작업 내용**:
  - Plant 01~04(및 향후 Plant 05) PFD·물질수지·시뮬레이터(`SimCompKey`)에 등장하는 **모든 공정 물질 전수 추출**
  - 물성 DB(`app/property-db` 및 물성 데이터 모듈)에 기본 물성·증기압·열역학 상수 누락분 일괄 보완
  - 공장별 물질 필터 선택 시 해당 공장의 원료·중간체·제품·부생물이 100% 조회되도록 동기화

---

## 4. [Planned · High] 염화메탄(CMS) 공장 MCL 컬럼 탑저 스트림 `CFM (CHCl3)` 누락 수정

- **작업 내용**:
  - 염화메탄 정제 계통 **MCL 컬럼**의 탑저(Bottoms) 스트림 및 후단(MC / CFM 정제 컬럼) 연결 피드 조성에서 누락된 **`CFM (CHCl3)`** 성분 복원
  - CMS PFD·물질수지·시뮬레이터 프리셋 정합성 및 `scripts/regression/solveAllPlants.ts` 회귀 검증

---

## 5. [Deferred] 증류탑 사이드컷(Side-Cut) 엄밀 MESH 수렴 안정화

- **보류된 과제**:
  - `lib/calculations/rigorousDistillation.ts` (`solveInnerMeshColumn`, `runMeshAt`)에서 측류 인출(`SL[j]`, `SV[j]`) 활성 시 일부 단의 `sum(xRaw)` 이탈로 인한 조기 수렴 판정·프로브 오차 보정
  - **타임아웃·에러 방지 설계 반영**:
    - 물리적 가능 범위 사전 체크 (`D + S`가 피드·내부 L/V 트래픽 한계를 넘으면 솔버 진입 전 차단/경고)
    - 외부 순도/회수율 역산 루프에서 직전 해(`T`, `x`, `V`) **Warm-Start** 재사용으로 반복 수 및 계산 시간 단축
    - 시간 상한(Time Budget) 초과 시 에러 중단 대신 **최선 근접 수렴 해 + 안내 상태** 안전 반환
  - `scripts/validation/sideCutDistillationValidation.ts` 및 전체 회귀/수렴 테스트 통과 확인
