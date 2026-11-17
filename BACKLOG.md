# ChemEng Studio — Project Backlog

> Last updated: 2026-11-17

---

## 1. [Planned · High] Plant 05: 금호미쓰이 공정 기반 100,000 MT/yr MDI 통합 플랜트 추가

- **배경 / 목적**: 기존 전해·염소계 공정(Plant 01~04: 염소/가성소다, HCl, ECH, 염화메탄 등)과 연계하여 **금호미쓰이화학(Kumho Mitsui Chemicals) 계통 포스겐-MDA 액상/고온 공정 기반 연산 10만 톤(100,000 MT/yr) MDI 플랜트**를 Plant 05 PFD 및 플로우시트/PEP 시뮬레이터 프리셋에 신규 편입
- **기준 생산 규모**: **100,000 MT/yr** (`8,000 hr/yr` 기준 총 제품군 약 `12,500 kg/h` — Monomeric `4,4'-MDI` + Polymeric `PMDI` 제품군 배분, Aniline/HCHO/CO/Cl2 물질수지·에너지수지 일관성 확보)

### 1.1 핵심 공정 섹션 (4개 시트 구성안)

1. **Sheet 1 — MDA 합성 · 중화 · 정제 (`MDA Synthesis & Purification`)**
   - Aniline + Formaldehyde(HCHO) 수용액의 HCl 촉매 하 축합·아미날 전위 반응 → Crude MDA + 반응수
   - NaOH 가성소다 중화 및 수세/유수분리(디캔터, 염수 배출)
   - 미반응 Aniline 및 수분 감압 회수탑(Vacuum Stripper/Rectifier) → 순수 Crude MDA (Aniline 리사이클)
2. **Sheet 2 — 포스겐(`COCl2`) 제조 및 MDA 포스겐화 (`Phosgene Gen & Phosgenation`)**
   - CO + Cl2 활성탄 촉매 고정층 기상 합성(`COCl2` 발열 반응기 및 냉각기)
   - MCB(모노클로로벤젠) 용매 하 저온 혼합/포스겐화 → 고온 완결 포스겐화 반응기
   - 부생 HCl 가스 + 과잉 포스겐 벤트 분리, HCl 흡수/정제 및 건조
3. **Sheet 3 — 탈포스겐 및 MCB 용매 회수 (`Dephosgenation & MCB Recovery`)**
   - 반응조 액상 중 잔류 `COCl2` / `HCl` 탈기 스트리핑 및 저온 포스겐 응축 리사이클
   - MCB 다단 진공 증류/플래시 회수탑 (고순도 MCB 용매 순환 회수)
4. **Sheet 4 — Polymeric / Pure `4,4'-MDI` 진공 분별증류 (`MDI Fractionation & Finishing`)**
   - 박막증발기(TFE) + 고진공 분별증류탑(사이드컷 인출 적용 검토 가능)을 통한 Monomeric `4,4'-MDI`(탑정/측류 제품)와 Polymeric `PMDI`(탑저 제품) 분리·냉각 출하

### 1.2 필요한 물성 및 시뮬레이터 확장 범위

- **성분/물성 DB 확장 (`SimCompKey`, `thermoCore.ts`, `rigorousThermo.ts`, `chemicalProperties` 등)**:
  - `Aniline` (아닐린, C6H7N)
  - `HCHO` (포름알데히드, CH2O)
  - `MCB` (모노클로로벤젠, C6H5Cl)
  - `COCl2` (포스겐, COCl2)
  - `MDA` (4,4'-메틸렌디아닐린, C13H14N2)
  - `MDI` (Monomeric 4,4'-MDI, C15H10N2O2)
  - `PMDI` (Polymeric MDI 대표 유사성분)
- **기존 Plant 01~04 밸류체인 연계**:
  - 전해 공정 생산 `Cl2`, `NaOH` 및 합성 `CO` 원료 투입과 포스겐화 부생 `HCl` 회수(전해/EDC-HCl 또는 염산 회수 루프) 연계 가능
- **UI/검증 반영 대상**:
  - `lib/data/` 및 PFD/Classic/Flowsheet 프리셋에 **Plant 05** 등록 (`PEP Yearbook`, `Material Balance`, `Flowsheet Simulator`, `Classic Simulator`)
  - 설비 사이징(고압/진공 반응기, 염소/포스겐 취급 열교환기, 진공 증류탑 인터널/데이터시트/DXF CAD) 및 `scripts/regression/solveAllPlants.ts` 전 플랜트 회귀 검증 포함

---

## 2. [Deferred] 증류탑 사이드컷(Side-Cut) 엄밀 MESH 수렴 안정화

- **현재 상태**: 사이드컷 UI (`DistillationWorkbenchModal.tsx`), 플로우시트 `side_cut` 포트 라우팅 및 민감도/Design-Spec 변수, `N7` 노즐/침니 컬렉터 데이터시트·DXF CAD, ChemPro 사이드컷 기능은 반영 및 배포 완료 (`commit ac2dd0c`, `chemeng-shell-v10`).
- **보류된 과제 (추후 진행)**:
  - `lib/calculations/rigorousDistillation.ts` (`solveInnerMeshColumn`, `runMeshAt`)에서 측류 인출(`SL[j]`, `SV[j]`) 활성 시 일부 단의 `sum(xRaw)` 이탈로 인한 조기 수렴 판정·프로브 오차 보정 (`Multi-theta` 또는 `Kb`/온도 커플링 및 프로브 안정화)
  - `scripts/validation/sideCutDistillationValidation.ts`, `solveAllPlants.ts` 등 전체 회귀/수렴 테스트 실행 및 통과 확인
