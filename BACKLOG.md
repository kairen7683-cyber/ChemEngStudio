# ChemEng Studio — Project Backlog

> Last updated: 2026-11-18

---

## 1. [Done · 2026-11-18] Plant 05: 100,000 MT/yr MDI 통합 플랜트 추가

- **구현 내용**:
  - 7종 신규 성분(`COCl2`, `HCHO`, `MCB`, `Aniline`, `MDA`, `MDI`, `PMDI`) 열역학·임계·증기압(DIPPR-101)·UNIFAC·생성깁스에너지·촉매반응 프리셋·LLE 분배·물성 DB 전수 확장 (총 `77`개 `SimCompKey`)
  - 5-Sheet 통합 계층 플랜트(`lib/calculations/mdiPlantHierarchy.ts`): `Master` + `100 MDA 합성·중화·수세 디캔터·탈수·아닐린 회수` + `200 포스겐 합성·2단 포스겐화` + `300 탈포스겐·MCB 용매 진공 회수` + `400 고진공 Pure 4,4'-MDI (4,500 kg/h) · PMDI (8,000 kg/h) 정밀분별` 5개 시트 전 수렴 달성
  - 사이드바, `/material-balance`, `/equipment-design?tab=mdi_hub`, `/unit-equipment`, `/pep-yearbook`, `/flowsheet-simulator`, `/classic-simulator`, 회귀 하네스(`solveAllPlants.ts`, `generateConvergedBaselines.ts`) 전수 연동 완료

---

## 2. [Done · 2026-11-18] 증류탑 변수선택 통합 단일 UI, 순차 자유도 가이드 & 미수렴 추천조합 원클릭

- **구현 내용**:
  - `DistillationWorkbenchModal.tsx` 모드 A/B 이원화 제거 → `⓪ 고정 단수 지정 (N·Nf)` 체크박스 + `①~⑤` 변수선택 단일 통합 UI 구현
  - 실시간 순차 자유도 가이드 배너 및 솔버 가능 여부에 따른 `▶ RUN` 버튼 스마트 활성화/비활성화
  - **사이드컷(`⑤`) 주제품 시 탑정 스펙(`③`) 생략 조합** (`①+④+⑤`, `②+④+⑤`, `designOmitTopPurity`) 고정단수 및 AI 단수 자동설계 모두 지원
  - 성분 `<select>`를 **`현재 유입 성분 (비점 순)`** 우선 `<optgroup>` (`MCL → CFM → CTC`)으로 정렬
  - 미수렴 또는 스펙 미달 시 **`💡 수렴·스펙 달성 추천 조합`** 원클릭 조건 변경 & 즉시 재실행 카드 구현

---

## 3. [Done · 2026-11-18] 물성 DB(`/property-db`) 전 성분·공용 유틸리티 등재, 통합 검색 & 계정별 공장 접근 제어(`allowed_plants`)

- **구현 내용**:
  - 77종 전 `SimCompKey` 및 공용 유틸리티(`LP/MP/HP Steam`, `Cooling/Chilled Water`, `CaCl2 Brine`, `Dowtherm A`, `N2/Air`) `FLUID_DB` 100% 등재 (`132` 고유 엔트리)
  - `[내 공장 물질 + 공용 유틸리티]` 기본 한눈 뷰 + `[전체 시뮬레이션 물성 DB (전 물질 개방)]` 토글, 화학식·국영문 물질명·공정 약어(`MCL`/`CFM`/`CTC`/`MDA`/`MDI`/`PMDI`/`MCB`)·CAS 실시간 통합 검색 구현
  - SQLite `users.allowed_plants` 멱등 마이그레이션·관리자 콘솔(`AdminConsoleModal.tsx`) 권한 편집·헤더 공장 선택기 필터링 및 자동 폴백 적용 (`/property-db`, `/equipment-design`, `/unit-equipment`, `/flowsheet-simulator`, `/classic-simulator` 개방 유지)

---

## 4. [Done · 2026-11-18] 염화메탄(CMS) 공장 MCL 컬럼 탑저 `CFM (CHCl3)` 인식·표기 동기화

- **구현 내용**:
  - `CH3Cl(MC)`, `CH2Cl2(MCL)`, `CHCl3(클로로포름/CFM)`, `CCl4(CTC)`, `C2Cl4(PCE)` 전 공정·브릿지·`chem_db.js`(`mcl_cfm` NRTL 프리셋)·`/property-db` 라벨 및 혼합 스트림(`303: CFM + CTC`) 인식 동기화 완료

---

## 5. [Done · 2026-11-18] 증류탑 사이드컷 엄밀 MESH 수렴 안정화 & 클래식 시뮬레이터 출구 포트 변경 UI

- **구현 내용**:
  - `rigorousDistillation.ts` Multi-$\theta$ 보정, 외부 역산 루프 Warm-Start, `D + S` 한계 사전 가드, 2,200 ms 타임 버짓 안전 반환 및 1-클릭 진단 `remedies` 탑재 (`sideCutDistillationValidation.ts` 전 4개 스위트 통과)
  - `ClassicBlockNode.tsx` `<Handle id="decanter">` 추가 및 `app/classic-simulator/page.tsx` 스트림 인스펙터 내 **`출구 포트 역할 변경 (Source Port)`** (`vapor` / `side_cut` / `liquid` / `decanter`, `side_cut` 전환 시 사이드컷 자동 활성화 + 즉시 재해석) 구현
