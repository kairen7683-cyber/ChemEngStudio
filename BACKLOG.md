# ChemEng Studio — Project Backlog

> Last updated: 2026-11-24

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

---

## 6. [Planned · 2026-11-24] 고객소통창구: AI 고객지원 챗봇 + 1:1 문의함 + 텔레그램 에스컬레이션

- **목표**: 정식 유료 서비스 오픈 시 문의·사용법 질문의 70~80%를 백엔드 AI 챗봇이 자동 응대하고, 환불·결제·불만·버그 등 민감 건만 운영자(텔레그램)로 에스컬레이션하는 1인 SaaS 고객지원 파이프라인 구축.
- **구현 범위 (예정)**:
  1. **상단 `피드백` 버튼 → `고객지원` 2탭 모달 확장** (`FeedbackModal.tsx`):
     - **탭 1 — 💬 AI 고객지원 챗봇**:
       - 빠른 FAQ 칩 (단위계 MKS/SI 전환, 열교환기·증류탑 수렴 팁, 요금제/14일 환불, 104종 핸드북 이용법)
       - 백엔드 `POST /api/support/chat` (GCP Gemini 2.5 Flash, `thinkingBudget: 0`, 일일 호출 한도 적용)
       - ChemPlant Studio 공식 매뉴얼·요금제(\$19/\$79)·환불규정·면책 고지 기반 자동 답변
       - **가드레일**: 환불 약속·결제 오류·강한 불만·버그 키워드 감지 시 AI 임의 약속 금지 → **「대화 내용 그대로 1:1 담당자 접수하기」** 원클릭 에스컬레이션 버튼 노출
     - **탭 2 — 📩 1:1 문의 · 버그 제보 & 내 문의함**:
       - 기존 8 MB 파일 첨부(`.bkp`/`.xlsx`/스크린샷) 유지 + 본인 문의 상태(`접수됨`/`답변 완료`) 및 운영자 답변 열람 (`GET /api/feedback/my`)
       - 신규 문의·불만 접수 시 대표님 텔레그램으로 원문 + AI 추천 답변 초안 즉시 푸시
       - 관리자 콘솔에서 1클릭 답변 등록 (`POST /api/admin/feedback/<id>/reply`)
  2. **공식 이메일 (`support@chemplantstudio.com`)**: Cloudflare Email Routing(무료)으로 대표님 메일 포워딩 연동 (비회원·결제·환불 문의 대응)
- **상태**: 보류 (정식 서비스 오픈 시점에 착수)

---

## 7. [Planned · 2026-11-24] 정식 오픈 전 기업 기밀(PFD) 보안 강화 패키지

- **목표**: 화학·EPC 실무 사용자의 플로우시트·물질수지·조성비 등 영업비밀(Trade Secret)을 안전하게 보호하고, 대기업·EPC 보안 심사를 통과할 수 있는 수준의 기밀 보호 체계 구축.
- **구현 범위 (예정)**:
  1. **DB 저장 데이터 암호화 (Encryption at Rest, AES-256-GCM)**:
     - `user_workspaces.payload_json` 저장 시 서버 환경변수 마스터키 기반 AES-256-GCM 암호화 적용 → DB 파일 유출·관리자 열람 시에도 평문 공정 데이터 노출 원천 차단
  2. **「로컬 전용 모드 (Zero-Cloud Mode)」 토글**:
     - 보안 규정이 까다로운 기업 사용자를 위해 클라우드 동기화를 완전히 비활성화하고 내 PC `.json` 파일로만 저장·열기 가능하도록 지원 (*"공정 데이터가 외부 서버에 1바이트도 전송되지 않음"*)
  3. **운영 서버 물리 분리**:
     - 정식 유료화 시 개인용 서비스(`assistant-hub`, `stock-assistant`)와 `chemeng-studio`를 독립 VM으로 분리 + 암호화 일일 백업 및 탈퇴 시 즉시 영구 삭제(Hard Delete) 보장
  4. **AI 외부 전송 차단 스위치 (Air-gapped Solver Option)**:
     - 보안 모드 활성화 시 Gemini API 호출을 차단하고 100% 브라우저 내장 수치 솔버만 사용하도록 잠금
- **상태**: 보류 (정식 유료 서비스 오픈 직전 착수)

---

## 8. [Planned · 2026-11-25] 회원 탈퇴 · 원클릭 구독 해지 및 자동 환불 시스템

- **목표**: 정식 유료 구독 전환 시 한국 전자상거래법·공정거래위원회 다크패턴 규제 및 개인정보보호법을 100% 준수하여, 사용자가 고객센터를 거치지 않고 **즉시 구독 해지 · 자동 환불 · 회원 탈퇴**를 투명하게 처리할 수 있도록 구현.
- **구현 범위 (예정)**:
  1. **원클릭 구독 해지 (Zero Dark-Pattern)**:
     - `내 계정 → 구독 관리`에서 클릭 2회 이내로 즉시 해지 가능 (전화/이메일 문의 강제 금지)
     - 해지 전 **예상 환불 금액 · 환불 방식 · 만료일**을 화면에 명확히 사전 고지
  2. **PG/MoR API 연동 자동 환불 엔진**:
     - **결제 후 7일 이내 청약철회 (미사용 시)**: 전자상거래법 기준 **100% 전액 자동 환불** 즉시 실행
     - **사용 후 중도 해지**: ① 다음 결제일 자동갱신 중단(잔여 기간 유지) 또는 ② **잔여 일수 일할(Pro-rata) 자동 환불** 즉시 실행
     - **연동 대상**: 해외+국내 통합 **Paddle / Lemon Squeezy** (MoR, 세금·자동 환불 내장) 또는 국내 카드/간편결제 **토스페이먼츠(Toss Payments)** 취소/부분취소 API (`/v1/payments/{paymentKey}/cancel`)
     - 환불 완료 시 영수증·환불 내역 이메일 자동 발송 및 운영자 텔레그램 알림
  3. **회원 탈퇴 (계정 · 공정 데이터 즉시 영구 삭제)**:
     - 비밀번호 재확인 후 **즉시 탈퇴** (`DELETE /api/auth/account`)
     - 활성 유료 구독이 남아 있으면 **자동 구독 해지 + 자동 환불 처리 완료 후** `users`, `sessions`, `user_workspaces`, 개인 `pending` 커스텀 성분 즉시 파기 (단, 공용 DB로 승격된 익명 물성 데이터는 개인식별정보 제거 후 유지)
- **상태**: 보류 (정식 결제/구독제 도입 시점에 최우선 착수)
