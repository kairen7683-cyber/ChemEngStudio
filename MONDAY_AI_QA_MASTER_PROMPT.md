# ChemPlant Studio v1.0 — AI 종합 QA · 전 장치 검증 · Aspen 비교 마스터 실행 지시서

> **사용법 (월요일 실행용)**: 이 파일(`MONDAY_AI_QA_MASTER_PROMPT.md`)을 AI 에이전트에 첨부하고 **"이 지시서대로 Mission 1부터 Mission 6까지 순서대로 전부 실행하고, 발견된 오류는 코드까지 직접 수정·검증한 뒤 최종 리포트를 작성해줘"**라고 지시하세요.

---

## 0. 프로젝트 환경 및 절대 준수 원칙

- **로컬 프로젝트 경로**: `C:\Users\kaire\.gemini\antigravity\scratch\electro`
- **프로덕션 서버**: `kairen7683@34.47.91.5:/home/kairen7683/chemeng-studio` (`systemd`: `chemeng-studio.service`, URL: `https://chemplantstudio.com`)
- **기술 스택**: Next.js 16 (Static Export `out/`), TypeScript, FastAPI + SQLite (`backend/server.py`), Node.js v24 + `esbuild` (별도 설치 없이 TS 모듈 즉시 실행 가능)
- **핵심 계산 엔진 파일**:
  - `lib/calculations/flowsheetSolver.ts` (전체 공정 솔버, Wegstein 리사이클, 단위장치 계산)
  - `lib/calculations/rigorousThermo.ts` (VLE 플래시, 기포점/노점, 7종 Property Method)
  - `lib/calculations/iapwsIf97.ts` (IAPWS-IF97 순수 물·스팀)
  - `lib/calculations/activityModels.ts` (NRTL, eNRTL, Hansen 1991 UNIFAC, LLE 디캔터)
  - `lib/calculations/rigorousDistillation.ts` (다단 MESH 증류탑, 공비/LLE, 자동단수설계)
  - `lib/calculations/aiEquipmentAdvisor.ts` (증류탑·장치별 AI 자동해결 & 최적화)
  - `lib/calculations/componentCatalog.ts` (성분 DB 및 물성 모델 추천)
  - `backend/server.py` (인증, Process Hub, `/api/ai/advise` Gemini 프록시)

### 절대 금지 및 준수 규칙
1. **비공개 사내 공정(`PLANT 01~06`) 절대 외부 노출 금지**: `OWNER_ONLY_PLANTS` / `simulator_only` ACL 유지, Process Hub 공유·공개 예제 노출 절대 금지.
2. **전문용어 영문 원어 유지**: 물질명·유체명·장치 기본 `Name`·공정 전문용어(`Syngas`, `Reflux`, `Pinch`, `LMTD`, `Distillate`, `Bottoms` 등)는 한국어 모드에서도 영문 원어 유지.
3. **상용 소프트웨어 상표명 공개 페이지 노출 금지**: Landing Page 및 공개 UI에 "Aspen", "HYSYS" 등 타사 상표명 직접 기재 금지 (내부 QA 리포트 비교표에서만 사용).
4. **AI 자문 응답 품질 원칙**: 역할극 자기소개("25년 경력의 수석 엔지니어로서...") 금지, 생 마크다운(`###`, `**`, `*`) 노출 금지, 추상적 일반론("CFD 시뮬레이션") 금지, 한/영 모드 자동 일치.
5. **수정 후 반드시 검증**: 코드를 수정했다면 `npm.cmd run build` (TypeScript 0 에러, 18/18 정적 페이지 빌드 성공) 및 자동 회귀 스크립트 재실행으로 통과를 증명할 것.

---

## Mission 1. 열역학 물성 모델 7종 정밀 검증 & NIST / Aspen Plus 기준 비교

Node + `esbuild`로 자동 검증 스크립트(`scripts/qa_thermo_benchmark.mjs`)를 작성·실행하여 아래 7종 Property Method를 NIST / Aspen Plus 문헌값과 정량 비교하라.

| 모델 | 필수 검증 케이스 | 기준값 (NIST / Aspen 참고) | 허용 오차 |
|---|---|---|---|
| **`STEAM_IF97`** | ① 100°C 포화압, ② 1.01325 barA 포화온도, ③ 40 barA 포화온도, ④ 40 barA·480°C 과열스팀(`ρ`, `h`, `Cp`), ⑤ 1 barA·25°C 액상수(`ρ`, `h`, `Cp`) | `P_sat(100°C)=1.01418 barA`, `T_sat(1atm)=99.974°C`, `T_sat(40barA)=250.354°C`, `ρ(40barA,480°C)=11.88 kg/m³`, `h=3400 kJ/kg` (참고: IF97 Region 2 편차 여부 집중 점검!) | `T ±0.1°C`, `P ±0.5%`, `ρ ±2%`, `h ±3%` |
| **`PR`** | ① Benzene/Toluene(50/50 mol%, 1 atm) `T_bub`, ② CH₄(50 barA, 40°C) 압축인자 `Z` 및 밀도, ③ Cl₂(10 barA, 25°C) 액화 상판별 | `T_bub(B/T)≈92.1°C`, `Z(CH4,50bar,40°C)≈0.925`, `Cl₂(10bar,25°C)=Liquid` | `T ±1.0°C`, `Z ±0.02`, 상판별 100% 일치 |
| **`SRK`** | ① H₂(100 barA, 40°C) `Z` (Graboski-Daubert 보정), ② Syngas(CO/H₂/CH₄, 50 barA, 250°C) 밀도, ③ C₂H₄/C₂H₆(-30°C, 20 barA) VLE | `Z(H2,100bar,40°C)≈1.06`, 상판별·기액분배 정상 | `Z ±0.03`, NaN/발산 0건 |
| **`NRTL`** | ① EtOH/H₂O(1 atm) 공비점(`x≈89.4 mol%`, `T≈78.2°C`), ② Acetone/H₂O(50/50, 1 atm) `T_bub`, ③ ECH/H₂O LLE 2상 분리 여부 | `T_azeo(EtOH/H2O)≈78.2°C`, `y_EtOH≈x_EtOH` 근접, ECH/H₂O 2액상 분리 | `T ±1.0°C`, 공비 역전 정상 |
| **`UNIFAC`** | ① EtOH/H₂O(50/50, 78°C) `γ`, ② IPA/Toluene(미파라미터 쌍) `T_bub` vs NRTL-폴백 일치 여부, ③ MeOH/Acetone/H₂O 3성분 | `γ_EtOH≈1.23`, `γ_H2O≈1.49`, NRTL-폴백과 충돌/이중폴백 없음 | `T ±1.5°C`, NaN 0건 |
| **`ENRTL`** | ① NaOH 32 wt% / 50 wt% 수용액 비점오름(BPR, 1 atm), ② NaCl 25 wt% 브라인 BPR, ③ HCl/H₂O 공비점(1 atm ≈ 20.2 wt%, 108.6°C) | `BPR(NaOH 32%)≈18°C`, `BPR(NaOH 50%)≈43°C`, `T_azeo(HCl 20.2%)≈108.6°C` | `BPR ±3°C`, 증기압 강하 단조성 |
| **`IDEAL`** | ① Benzene/Toluene(50/50, 1 atm) `T_bub`, ② `γ=1, φ=1, Z=1` 엄밀 적용 여부, ③ 96°C·1 atm 플래시 기상분율 `β` | `T_bub≈92.1°C`, `Z=1.000`, `β≈0.43` | `T ±0.5°C`, `Z=1.000` 정확 일치 |

- **오차 초과 항목 발견 시**: `iapwsIf97.ts`, `rigorousThermo.ts`, `activityModels.ts`의 원인을 분석하고 즉시 보정 후 재검증하라. (특히 `STEAM_IF97` 고압 과열스팀 엔탈피 `h`가 NIST 3400 kJ/kg 대비 편차가 있는지 정밀 점검할 것!)

---

## Mission 2. 전 단위 장치(Unit Operations) 15종 개별 스트레스 테스트 & Aspen 비교

자동 회귀 스크립트(`scripts/qa_units_regression.mjs`)로 아래 15종 장치를 **정상 조건 + 극한/경계 조건(0 유량, 초임계, 상변화, 비응축 가스, 리사이클)**으로 전수 실행하고, **물질수지 오차(`< 0.01%`) · 열수지 정합성 · 물리적 타당성(Aspen RadFrac/Flash2/RGibbs/Heater/Compr/Pump 기준)**을 검증하라.

1. **`feed`**: `mass_flow` / `wt_pct` / `mol_pct` 상호 변환 정확도, 0 유량·단일 성분·다성분 처리.
2. **`distillation`**:
   - ① B/T 20단 (`PR`, `IDEAL`, `UNIFAC`, `NRTL` 교차)
   - ② EtOH/H₂O 24단 공비 (`NRTL`, `UNIFAC`) — 탑정 순도가 공비 한계(~95.6 wt%)를 물리적으로 돌파하지 않는지 확인
   - ③ HCl 99% / O₂ 1% 초저온 경질가스 (`total` vs `partial` condenser) — `design_stages` 목표 미달 시 진단 및 부분응축기 거동
   - ④ Side-Cut(측류) 포함 3성분 탑(Benzene/Toluene/p-Xylene) — 물질수지 `F = D + S + B` 엄밀 일치
   - ⑤ Decanter(LLE 공비) 탑 — 수층/유기층 분리 및 환류 정합성
   - ⑥ Dual Quality Spec (`top_spec` + `bot_spec`) 수렴성
3. **`reactor`**:
   - ① 평형 반응기(SMR, WGS, Haber-Bosch NH₃, MeOH 합성) — 등온 vs 단열 온도 변화 방향(발열→상승, 흡열→하강) 및 전환율 타당성
   - ② 전환율 지정 반응기(Conversion), CSTR, PFR — 원자수지(C, H, O, Cl, N) 및 질량보존 `Σin = Σout` 0.01% 이내 확인
   - ③ `specified_duty` & `jacket_ua` 열수지 정합성
4. **`hex` (열교환기·냉각기·가열기)**:
   - ① 단순 현열 가열/냉각 (`Q = m·Cp·ΔT` 검증)
   - ② 상변화 응축기/증발기 (잠열 포함 `Q`가 현열만 계산하지 않는지 검증!)
   - ③ 공정-공정 2유체 열교환기 (온도 교차 Temperature Cross / Pinch 경고 정상 발동 여부)
5. **`separator` (기액분리기 / 3상 디캔터)**:
   - ① 2상 플래시 (`T, P` 지정 vs 단열 `Q=0` 플래시)
   - ② 전액상 / 전기상 입력 시 한쪽 출구 0 유량 안전 처리 (NaN 없음)
   - ③ 3상 LLE 분리 (물+유기용제)
6. **`pump`**: 수두(`ΔP / ρg`), 축동력(`Q·ΔP / η`), 액체 온도 상승, **기상 유입 시 캐비테이션 경고** 확인.
7. **`compressor`**: 단열/폴리트로픽 압축 출구온도 `T_out = T_in · (P2/P1)^((k-1)/(k·η))`, 소요동력 `kW`, `PR/SRK/IDEAL`별 `Z_avg` 반영 여부, 액상 유입 경고.
8. **`turbine`**: 팽창 출구온도 하강, 회수동력 `kW` 부호, `STEAM_IF97` 고압 스팀 팽창 시 건도(Steam Quality) 및 엔탈피 낙차 검증.
9. **`valve` (JT 감압밸브)**: 등엔탈피(`ΔH = 0`) 감압 플래시, 액체 감압 시 일부 기화(Flashing) 및 온도 강하, 역압(`P_out > P_in`) 방어.
10. **`absorber` & `extractor`**: 다단 기액 흡수(CO₂/MEA, HCl/H₂O) 및 액액 추출(LLE) 물질수지·수렴성.
11. **`evaporator`**: NaOH/NaCl 수용액 농축 시 BPR(비점오름) 반영, 증발 스팀량·농축액 농도 정합성.
12. **`electrolyzer`**: Chlor-Alkali(`2NaCl + 2H₂O → Cl₂ + H₂ + 2NaOH`) 및 AWE 그린수소(`2H₂O → 2H₂ + O₂`) 패러데이 법칙 화학양론·전력(`kW`)·발열량 정합성.
13. **`mixer` & `splitter`**: 혼합기 출구 압력(`min(P_in)`), 단열 혼합 온도(엔탈피 합산), 분기기 분배비 합계 1.0 정규화.
14. **`liquefier` & `desiccant_dryer` & `saturator`**: 각 특수 장치 물질·열수지 및 경계값 안전성.
15. **전체 플로우시트 12개 공개 예제 (`PUBLIC_MINI_EXAMPLES`) + 리사이클 루프 (HDA, Haber-Bosch, MEA CCUS)**:
    - **중요**: 12개 전체 실행 시간과 수렴 여부 전수 기록! 특히 이전 테스트에서 시간이 길었던 **`mea_co2_capture_ccus`** 및 미수렴이 떴던 **`hda_toluene_benzene_recycle`**의 원인을 집중 디버깅하고 수정하라!

---

## Mission 3. 전 장치 AI 자동해결 & AI 자문 프롬프트 전수 감사

`lib/calculations/aiEquipmentAdvisor.ts` 및 모든 워크벤치 모달(`DistillationWorkbenchModal`, `ReactorWorkbenchModal`, `HeatExchanger`, `Compressor`, `PSV/Flare`, `ColumnInternals`, `Flowsheet`)에서 AI 자동해결/자문 로직을 전수 점검하라.

- **체크리스트**:
  1. **스펙 임의 삭제 금지**: 사용자가 지정한 목표 순도·온도·압력·회수율을 AI가 몰래 삭제하고 가짜 `PASS`를 만드는 분기가 다른 장치(열교환기·압축기·반응기·내부물)에도 있는지 전수 확인.
  2. **반복 클릭 무한 축소/진동 금지**: 이미 수렴한 장치에서 AI 해결을 2~3회 연속 클릭해도 단수·직경·전열면적이 계속 줄어들거나 값이 튀지 않는지 테스트.
  3. **프롬프트 품질 통일**: 모든 `/api/ai/advise` 호출 지점이 `DistillationWorkbenchModal.tsx`처럼 **실제 성분·조성·온도·압력·목표 vs 계산값·실패 원인**을 정량적으로 넘기도록 보강 (단순 태그+숫자 1줄 전달 금지).
  4. **한/영 모드 100% 일치**: `lang === 'en'`일 때 프롬프트·결과 카드·AI 응답 모두 한글 0자 확인.

---

## Mission 4. 장치설계 · 경제성 · 물성 DB · 단위변환 교차 검증

1. **단위계 전환 정합성**: `SI (bar, °C, kg/h)` ↔ `Metric (kg/cm²g, kcal/h)` ↔ `US/Field (psi, °F, lb/h, MMBtu/h)` 전환 시 입력값 왕복 오차(`< 1e-4`) 및 UI 표시 단위 누락 확인.
2. **장치설계(`/equipment-design`) 핸드오프**: 시뮬레이터 결과 → 장치목록(Equipment List) · 데이터시트 · TEMA 열교환기 · 압축기 · PSV/Flare로 넘어갈 때 유량·온도·압력·물성(`ρ`, `μ`, `Cp`, `k`)이 정확히 연동되는지 검증.
3. **경제성(`/process-economics`)**: CAPEX/OPEX 계산식, 원단위(Utility consumption per ton product) 및 투자회수기간(Payback) 극단값(0 유량, 음수 마진) 방어 확인.

---

## Mission 5. UI/UX · 보안 · 권한 · 다크모드 · Process Hub 점검

1. **인증/권한**: 비로그인 상태에서 `/api/hub/*` 호출 시 반드시 `401` 반환 확인, 관리자 전용 `PLANT 01~06`이 일반 회원에게 노출되지 않는지 확인.
2. **개인정보 보호**: Process Hub 게시글·댓글 API 응답에 작성자 이메일(`@`)이 절대 포함되지 않고 닉네임만 반환되는지 확인.
3. **EN 모드 한글 누수 0건**: 주요 UI 컴포넌트(`flowsheet-simulator`, `WorkbenchRibbon`, `ComponentPropertySetupModal`, `FeedCompositionEditor`, `DistillationWorkbenchModal`, `ReactorWorkbenchModal`)에서 `isEn` 분기 누락 스캔.
4. **다크모드 가독성**: `app/globals.css`의 `html[data-wb-theme="dark"]` 규칙에서 글자/배경 대비 불량 또는 흰 배경 모달 오염 여부 점검.

---

## Mission 6. 자동 수정 · 회귀 테스트 영구화 · 최종 QA 리포트 출력

1. 발견한 **Critical / Major 버그는 직접 코드를 수정**하고, `npm.cmd run build` (0 TypeScript errors)로 검증하라.
2. 작성한 벤치마크·회귀 테스트를 `scripts/qa_full_regression.mjs`로 통합 저장하여 언제든 `node scripts/qa_full_regression.mjs` 한 줄로 전체 회귀 검증이 가능하게 하라.
3. **주의 (배포 여부)**: 사용자가 별도로 "배포해줘"라고 지시하기 전까지는 로컬 빌드·검증까지 완료하고, **최종 리포트에 배포 준비 완료 상태와 수정된 파일 목록**을 보고하라. (사용자가 배포까지 요청했다면 GCP 배포 및 GitHub 푸시까지 완료할 것.)

### 최종 보고서 필수 포함 항목
1. **열역학 7종 vs NIST/Aspen 편차 비교표** (Pass / Fail / 보정 내역)
2. **단위 장치 15종 + 12개 공개 예제 Pass/Fail 매트릭스** (소요시간 ms, 수렴 여부, 물질수지 오차)
3. **수정 완료한 버그 목록** (파일 경로, 원인, 수정 내용, 수정 전→후 결과 비교)
4. **정식 런칭 전 남은 리스크 / 의사결정 필요 항목** (Critical / Major / Minor 분류)
