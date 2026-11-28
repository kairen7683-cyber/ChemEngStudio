# ChemPlant Studio v1.0 — 외부 AI 전수 QA · Aspen 비교 · 버그 리포트 작성 지시서 (Read-Only QA 전용)

> **역할 및 사용법 (월요일 실행용 — 블랙박스 QA 전용)**
> - 이 파일(`MONDAY_AI_QA_MASTER_PROMPT.md`)을 회사 AI에 첨부하고 **"이 지시서대로 라이브 사이트(`https://chemplantstudio.com`)에서 Mission 1~5를 순서대로 전부 테스트하고, 개발자(Antigravity)에게 바로 넘길 수 있는 최종 QA · Aspen 비교 · 버그 리포트만 작성해줘"**라고 지시하세요.
> - **중요 원칙 (Black-Box Live QA)**:
>   1. **소스 코드 접근 없이 순수 사용자 관점(블랙박스)**으로 라이브 웹앱(`https://chemplantstudio.com`)만 직접 조작·테스트할 것. (코드 수정은 리포트를 전달받은 메인 개발 에이전트 Antigravity가 일괄 처리함)
>   2. 테스트 방법: 웹 시뮬레이터에서 실제 공정을 구성·실행하고, 출력된 수치·그래프·데이터시트·AI 진단 결과를 **Aspen Plus / HYSYS / NIST 기준값과 정량 비교**할 것.
>   3. 모든 발견 이슈는 개발자가 즉시 재현·수정할 수 있도록 **정확한 입력 조건(성분·조성·온도·압력·물성 모델·장치 설정) + 화면 출력값 + Aspen/NIST 기대값 + 편차(%) + 심각도(`P0/P1/P2`)**를 빠짐없이 기록할 것.

---

## 0. 테스트 대상 시스템 개요

- **라이브 URL**: `https://chemplantstudio.com` (현재 버전: `v138c`, Open Beta)
- **지원 Property Method (7종 + AUTO)**: `ENRTL`, `NRTL`, `UNIFAC`, `PR`, `SRK`, `STEAM_IF97`, `IDEAL`
- **주요 모듈**:
  - 플로우시트 시뮬레이터 (`/flowsheet-simulator`) — 15종 단위장치 + 12개 공개 예제 + 리사이클(Wegstein) + 목표역산/민감도 + AI 자동해결
  - 장치설계 (`/equipment-design`) — 장치목록 · 데이터시트 · TEMA/판형 열교환기 · 압축기 · PSV/플레어
  - 경제성 분석 (`/process-economics`) — CAPEX · OPEX · 원단위
  - 물성 DB (`/property-db`)
  - Process Hub (`/hub`, 회원 전용)

---

## Mission 1. 열역학 물성 모델 7종 정밀 검증 & NIST / Aspen Plus 기준 비교

아래 7종 Property Method에 대해 **ChemPlant Studio 계산값 vs NIST / Aspen Plus 기준값**을 비교하고, 허용 오차를 벗어나는 항목은 모두 버그 티켓으로 기록하라.

| 모델 | 필수 검증 케이스 | 기준값 (NIST / Aspen 참고) | 허용 오차 |
|---|---|---|---|
| **`STEAM_IF97`** | ① 100°C 포화압, ② 1.01325 barA 포화온도, ③ 40 barA 포화온도, ④ 40 barA·480°C 과열스팀(`ρ`, `h`, `Cp`), ⑤ 1 barA·25°C 액상수(`ρ`, `h`, `Cp`) | `P_sat(100°C)=1.01418 barA`, `T_sat(1atm)=99.974°C`, `T_sat(40barA)=250.354°C`, `ρ(40barA,480°C)=11.88 kg/m³`, `h=3400 kJ/kg` (고압 과열스팀 `h` 편차 집중 점검) | `T ±0.1°C`, `P ±0.5%`, `ρ ±2%`, `h ±3%` |
| **`PR`** | ① Benzene/Toluene(50/50 mol%, 1 atm) `T_bub`, ② CH₄(50 barA, 40°C) 압축인자 `Z` 및 밀도, ③ Cl₂(10 barA, 25°C) 액화 상판별 | `T_bub(B/T)≈92.1°C`, `Z(CH4,50bar,40°C)≈0.925`, `Cl₂(10bar,25°C)=Liquid` | `T ±1.0°C`, `Z ±0.02`, 상판별 일치 |
| **`SRK`** | ① H₂(100 barA, 40°C) `Z`, ② Syngas(CO/H₂/CH₄, 50 barA, 250°C) 밀도, ③ C₂H₄/C₂H₆(-30°C, 20 barA) VLE | `Z(H2,100bar,40°C)≈1.06`, 상판별·기액분배 정상 | `Z ±0.03`, NaN/발산 0건 |
| **`NRTL`** | ① EtOH/H₂O(1 atm) 공비점(`x≈89.4 mol%`, `T≈78.2°C`), ② Acetone/H₂O(50/50, 1 atm) `T_bub`, ③ ECH/H₂O LLE 2상 분리 여부 | `T_azeo(EtOH/H2O)≈78.2°C`, ECH/H₂O 2액상 분리 | `T ±1.0°C`, 공비 역전 정상 |
| **`UNIFAC`** | ① EtOH/H₂O(50/50, 78°C) `γ` 및 기포점, ② IPA/Toluene(미파라미터 쌍) `T_bub` vs NRTL-폴백 일치 여부, ③ MeOH/Acetone/H₂O 3성분 | `γ_EtOH≈1.23`, `γ_H2O≈1.49`, NRTL-폴백과 충돌 없음 | `T ±1.5°C`, NaN 0건 |
| **`ENRTL`** | ① NaOH 32 wt% / 50 wt% 비점오름(BPR, 1 atm), ② NaCl 25 wt% 브라인 BPR, ③ HCl/H₂O 공비점(1 atm ≈ 20.2 wt%, 108.6°C) | `BPR(NaOH 32%)≈18°C`, `BPR(NaOH 50%)≈43°C`, `T_azeo(HCl 20.2%)≈108.6°C` | `BPR ±3°C`, 증기압 강하 단조성 |
| **`IDEAL`** | ① Benzene/Toluene(50/50, 1 atm) `T_bub`, ② `γ=1, φ=1, Z=1` 엄밀 적용 여부, ③ 96°C·1 atm 플래시 기상분율 `β` | `T_bub≈92.1°C`, `Z=1.000`, `β≈0.43` | `T ±0.5°C`, `Z=1.000` 정확 일치 |

---

## Mission 2. 전 단위 장치(Unit Operations) 15종 개별 스트레스 테스트 & Aspen 비교

아래 15종 장치를 **정상 조건 + 극한/경계 조건(0 유량, 초임계, 상변화, 비응축 가스, 리사이클)**으로 전수 테스트하고, **물질수지 오차(`< 0.01%`) · 열수지 정합성 · Aspen(RadFrac/Flash2/RGibbs/Heater/Compr/Pump/Valve) 대비 편차**를 기록하라.

1. **`feed`**: `개별 유량` / `총유량 + wt%` / `총유량 + mol%` 상호 전환, 잔여 % 자동 채우기(미입력 성분 채움 vs 비례 정규화), 0 유량·단일 성분·다성분 입력.
2. **`distillation` (증류탑)**:
   - ① B/T 20단 (`PR`, `IDEAL`, `UNIFAC`, `NRTL` 교차 비교)
   - ② EtOH/H₂O 24단 공비 (`NRTL`, `UNIFAC`) — 탑정 순도가 공비 한계(~95.6 wt%)를 물리적으로 돌파하지 않는지 확인
   - ③ HCl 99% / O₂ 1% 초저온 경질가스 (`total` vs `partial` condenser) — `design_stages` 목표 미달 시 단수 축소 없이 전문 진단 출력 여부
   - ④ Side-Cut(측류) 포함 3성분 탑(Benzene/Toluene/p-Xylene) — `F = D + S + B` 엄밀 일치
   - ⑤ Decanter(LLE 공비) 탑 — 수층/유기층 분리 및 환류 정합성
   - ⑥ Dual Quality Spec (`top_spec` + `bot_spec`) 수렴성 및 Aspen RadFrac 대비 `Q_cond`, `Q_reb`, 탑정/탑저 온도 비교
3. **`reactor` (반응기)**:
   - ① 평형 반응기(SMR, WGS, Haber-Bosch NH₃, MeOH 합성) — 등온 vs 단열 온도 변화 방향(발열→상승, 흡열→하강) 및 전환율 vs Aspen RGibbs 비교
   - ② 전환율 지정(Conversion), CSTR, PFR — 원자수지(C, H, O, Cl, N) 및 질량보존 `Σin = Σout` 0.01% 이내 확인
   - ③ `specified_duty` & `jacket_ua` 열수지 정합성
4. **`hex` (열교환기·냉각기·가열기)**:
   - ① 현열 가열/냉각 (`Q = m·Cp·ΔT` 검증)
   - ② 상변화 응축기/증발기 (잠열 포함 `Q`가 정상 계산되는지 Aspen Heater 대비 비교)
   - ③ 공정-공정 2유체 열교환기 (Temperature Cross / Pinch 경고 정상 발동 여부)
5. **`separator` (기액분리기 / 3상 디캔터)**: 2상 플래시(`T, P` 지정 vs 단열 `Q=0`), 전액상/전기상 입력 시 한쪽 출구 0 유량 안전 처리, 3상 LLE 분리.
6. **`pump`**: 수두(`ΔP / ρg`), 축동력(`Q·ΔP / η`), 액체 온도 상승, 기상 유입 시 캐비테이션 경고 확인.
7. **`compressor`**: 단열/폴리트로픽 출구온도, 소요동력 `kW`, `PR/SRK/IDEAL`별 `Z_avg` 반영 여부 vs Aspen Compr 비교, 액상 유입 경고.
8. **`turbine`**: 팽창 출구온도, 회수동력 `kW`, `STEAM_IF97` 고압 스팀 팽창 시 건도(Quality) 및 엔탈피 낙차.
9. **`valve` (JT 감압밸브)**: 등엔탈피(`ΔH = 0`) 감압 플래시, 액체 감압 기화(Flashing) 및 온도 강하, 역압(`P_out > P_in`) 방어.
10. **`absorber` & `extractor`**: 다단 기액 흡수(CO₂/MEA, HCl/H₂O) 및 액액 추출(LLE) 물질수지·수렴성.
11. **`evaporator`**: NaOH/NaCl 수용액 농축 시 BPR(비점오름) 반영 및 증발 스팀량·농축액 농도 정합성.
12. **`electrolyzer`**: Chlor-Alkali 및 AWE 그린수소 패러데이 법칙 화학양론·전력(`kW`)·발열량 정합성.
13. **`mixer` & `splitter`**: 혼합기 출구 압력(`min(P_in)`), 단열 혼합 온도, 분기기 분배비 합계 1.0 정규화.
14. **`liquefier` & `desiccant_dryer` & `saturator`**: 특수 장치 물질·열수지 및 경계값 안전성.
15. **공개 예제 12종 전수 주행**:
    - 12개 전체의 수렴 여부, 소요시간(ms), 미수렴/경고 장치 목록 기록.
    - **집중 진단 대상**: HDA 공정(Toluene → Benzene 리사이클)의 미수렴 여부 및 MEA CO₂ 포집 공정의 리사이클 수렴 속도.

---

## Mission 3. 전 장치 AI 자동해결 & AI 자문 프롬프트 품질 전수 감사

증류탑 외 **모든 장치 워크벤치의 AI 자동해결 / AI 자문 기능**(열교환기, 압축기, PSV/플레어, 반응기, 증류탑 내부물, 전체 플로우시트 수렴 진단)을 전수 점검하고 문제점을 목록화하라.

- **점검 항목**:
  1. **목표 스펙 임의 삭제 여부**: AI 자동해결 시 사용자가 지정한 순도·온도·압력·회수율 스펙을 지우고 가짜 `PASS`를 내는 경우.
  2. **반복 클릭 시 값 왜곡/무한 축소 여부**: 이미 수렴한 상태에서 AI 해결을 2~3회 눌렀을 때 단수·직경·전열면적이 계속 줄어들거나 값이 튀는 현상.
  3. **AI 진단 품질**: 미수렴/미달 시 추상적 일반론("CFD 시뮬레이션" 등)이나 오글거리는 역할극 자기소개, 생 마크다운(`###`, `**`, `*`)이 출력되는지 확인.
  4. **한/영 모드 일치**: 영문 모드(`EN`)에서 AI 자문 결과가 100% 영문으로 나오는지 확인.

---

## Mission 4. 장치설계 · 경제성 · 물성 DB · 단위변환 교차 점검

1. **단위계 전환**: `SI (bar, °C, kg/h)` ↔ `Metric (kg/cm²g, kcal/h)` ↔ `US/Field (psi, °F, lb/h, MMBtu/h)` 왕복 전환 시 수치 오차 또는 단위 라벨 누락.
2. **장치설계(`/equipment-design`) 핸드오프**: 시뮬레이터 → 장치목록 · 데이터시트 · TEMA 열교환기 · 압축기 · PSV/Flare 연동 시 유량·온도·압력·물성(`ρ`, `μ`, `Cp`, `k`) 일치 여부 및 엑셀 출력 무결성.
3. **경제성(`/process-economics`)**: CAPEX/OPEX 계산식, 원단위, 0 유량/음수 마진 극단값 방어.

---

## Mission 5. UI/UX · 다크모드 · 한/영 누수 · 보안/권한 점검

1. **한/영 전환 누수**: 영문 모드(`EN`)에서 버튼·라벨·툴팁·장치 `Name`·에러 메시지에 한글이 남아 있는 화면/위치 전수 기록.
2. **다크모드 가독성**: 리본 메뉴·좌측 팔레트·캔버스 노드 테두리(수렴/미수렴/경고)·우측 속성창·모달에서 글자 안 보임/대비 불량 여부.
3. **권한 & 개인정보**: 비로그인 시 Process Hub 열람/API 차단 여부, Process Hub 게시글/댓글에 작성자 이메일(`@`) 미노출(닉네임만 표시) 여부.

---

## 최종 산출물 형식 (Antigravity 개발자 전달용 QA 리포트)

> 아래 4개 섹션 형식으로 정리해 출력하라. (이 리포트를 그대로 메인 개발 AI Antigravity에 전달하여 일괄 수정할 예정)

### 1. 종합 요약 (Executive Summary)
- 총 테스트 항목 수 / PASS / FAIL / 경고 건수
- 정식 런칭 차단 이슈(`P0 Critical`) 건수 및 핵심 요약

### 2. 열역학 7종 vs NIST / Aspen 편차 비교표
| 모델 | 테스트 케이스 | ChemPlant 값 | NIST/Aspen 기준 | 편차 | 판정 (PASS/FAIL) | 비고 |
|---|---|---|---|---|---|---|

### 3. 단위장치 15종 & 공개예제 12종 Pass/Fail 매트릭스
| 장치/예제 | 테스트 조건 | 수렴 여부 | 소요시간 | 물질수지 오차 | Aspen 대비 주요 차이 | 판정 |
|---|---|---|---|---|---|---|

### 4. 개발자 수정용 버그 티켓 목록 (우선순위순: `P0 Critical` → `P1 Major` → `P2 Minor`)
각 버그마다 반드시 아래 양식으로 작성:
- **[BUG-001] [P0/P1/P2] [모듈/장치명] 한 줄 요약**
  - **재현 조건**: (성분·유량·온도·압력·Property Method·장치 설정값)
  - **현재 동작 (Actual)**: (실제 계산값 / 화면 증상 / 에러 문구)
  - **기대 동작 (Expected / Aspen 기준)**: (목표값 또는 정상 동작)
  - **발생 화면 / 경로**: (예: `/flowsheet-simulator` 증류탑 워크벤치 → AI 자동해결, `/property-db` 등)
