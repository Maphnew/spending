# 월간 가계부

과거 가계부와 계속 추가되는 결제 내역을 연결해 지출을 분석하고 예산을 계획합니다.

## 데이터 운영 기준

시트 원본과 정리 결과는 spending DB와 별개인 `data/monthly-spend.db`에 보관합니다.
수집 스크립트는 전체 탭을 XLSX와 셀 JSON으로 저장하고 기존에 확보한 문서는 다시 다운로드하지 않습니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\import-sheets.ps1
node .\build-baseline.js
```

`build-baseline.js`는 최초 실행 시 SQLite backup API로 원본 DB의 일관된 사본을 만들고, 이후 실행은 같은 사본과 시트 보관 데이터로 분석용 DB를 재생성합니다. 반복 실행 시 기존 분석 테이블을 교체하므로 향후 사용자 검토 결과는 별도 테이블로 관리해야 합니다. 이후 최신 DB 동기화 기능은 아직 구현하지 않았습니다.

기본 원본 경로는 상위 spending 폴더의 `spending.db`이며 `SPENDING_DB` 환경 변수로 변경할 수 있습니다. 해당 프로젝트에 설치된 `better-sqlite3`를 사용합니다. 개인 데이터는 `data/`에 저장하며 Git 추적에서 제외합니다. 수집 결과는 `data/baseline-report.md`에서 확인합니다.

- 과거 데이터: 아래 시트 8개. 최초 구축 시 한 번 수집하고 원본 사본과 정리 결과를 보관합니다. 이후 정기 갱신에서는 다시 수집하지 않습니다.
- 계속 갱신하는 데이터: `C:\workspaces\spending\spending.db`. 앞으로의 지출은 기존 spending 프로젝트에 입력합니다.
- 원본 시트와 spending DB는 수정하지 않고, monthly-spend에서 분석용 데이터를 별도로 관리합니다.

## 1. 최초 데이터 연결 및 정리

1. 시트별 탭, 대상 기간, 거래 상세와 월별 합계의 구조를 확인하고 원본 사본을 저장합니다.
2. 현재 DB를 읽기 전용으로 수집합니다. 실행 중인 SQLite의 최신 커밋 데이터를 읽으며, WAL 파일이 있을 수 있으므로 DB 파일만 단순 복사하지 않습니다.
3. 날짜, 금액, 분류 등을 공통 형식으로 정리하고 출처와 원본 식별자를 보존합니다. 시트 합계와 개별 거래를 구분해 중복 합산을 방지합니다.
4. 시트와 DB의 겹치는 기간, 중복 거래, 취소, 카드 대금 납부, 날짜 누락을 확인합니다. 겹치는 거래는 DB를 우선하되 불확실한 항목은 검토 대상으로 남깁니다.
5. 분류 대응표와 중복 판단 결과를 저장해 이후 갱신에서도 같은 기준을 적용합니다. 월별 합계와 원본을 대조해 최초 분석 기준 데이터를 확정합니다.

## 이후 DB 갱신

- 시트의 보관 데이터는 유지하고, DB의 거래를 다시 읽어 분석용 DB 데이터를 동기화합니다.
- 신규 거래뿐 아니라 기존 거래의 수정, 분류 변경, 취소, 삭제도 반영합니다. 현재 원본 DB에는 수정 시각 컬럼이 없으므로 초기 구현은 전체 거래를 읽고 원본 거래 ID를 기준으로 비교하는 방식으로 합니다.
- 갱신을 반복해도 거래가 중복되지 않아야 합니다. 원본에서 삭제된 DB 거래가 시트 거래로 다시 집계되지 않도록 출처 간 중복 처리 이력도 유지합니다.
- 데이터 수집과 검증이 모두 성공하면 분석 데이터를 교체하고 2·3·4단계를 다시 계산합니다. 실패하면 마지막 정상 결과를 유지하고 실패 상태를 표시합니다.
- 화면에는 마지막 성공 갱신 시각, 원본별 수집 건수, 검토가 필요한 항목 수를 표시합니다.

## 2. 지출 분석

최신 DB와 보관한 시트를 통합하려면 이 폴더에서 `node .\consolidate.js`를 실행합니다. 원본 DB는 읽기 전용으로 열어 일관된 사본을 남기며, 결과는 `data/consolidated.db`와 `data/consolidated-report.md` 및 `.json`에 저장합니다. 실행할 때마다 통합 결과를 다시 만듭니다.

DB 우선, 출처 간 일대일 대응, 카드명·표기 차이 정규화, 시트 내부 반복 행 제외를 적용합니다. 날짜가 다른 같은 달·금액·이름·분류 거래는 추정 중복으로 별도 기록하므로 결과를 잠정 합계로 사용합니다. 환불은 음수로 차감하고 날짜가 없는 금액은 월별 합계와 구분합니다. 원본 DB와 시트, 최초 수집 DB는 변경하지 않습니다.

통합 데이터를 기준으로 월별·분류별 지출, 반복 결제, 비정기 지출, 소비 추이를 계산합니다. 날짜가 없는 거래와 미해결 중복은 별도 표시하며, 월별 분석에 포함하는 기준을 명시합니다.

## 3. 다음 달 지출 계획

과거 지출과 사용자 입력인 월 수입, 저축 목표, 예정된 큰 지출을 반영해 분류별 예산을 제안합니다. 확정한 예산과 사용자 수정값은 별도로 저장하며, DB 갱신 시 자동으로 덮어쓰지 않습니다. 최신 데이터에 따른 새 제안은 구분해 표시합니다.

## 4. 이번 달 진행 상황

확정 예산과 최신 실제 지출을 비교해 남은 예산, 남은 정기 결제, 월말 예상 지출, 주당 사용 가능한 금액을 계산합니다. 아직 예산을 확정하지 않았다면 제안 예산 기준임을 표시합니다.

## 과거 가계부 시트

전달받은 순서대로 정리했습니다.

| 연월 | 스프레드시트 |
| --- | --- |
| 2026년 8월 | [2026년 8월](https://docs.google.com/spreadsheets/d/1kQ_rqI7jOR-mYbtrCeQXEi7y1XLlmTz0A5-4LPT-fVE/edit?gid=0#gid=0) |
| 2026년 7월 | [2026년 7월](https://docs.google.com/spreadsheets/d/1KcFMPcyQLM20XM4oiikzZ2OcekMput8SVL3CHk59vQM/edit?gid=0#gid=0) |
| 2026년 6월 | [2026년 6월](https://docs.google.com/spreadsheets/d/11cqFCNcdiJ48r1UmGmhYX03BbBAQDr7EvkM0CXZo-7U/edit?gid=0#gid=0) |
| 2026년 5월 | [2026년 5월](https://docs.google.com/spreadsheets/d/1Rg-ga0UXGXuJn-w_QM2g6WSk1V1pTQF4EV0eWFkC2Fo/edit?gid=0#gid=0) |
| 2026년 4월 | [2026년 4월](https://docs.google.com/spreadsheets/d/11TmjuDMJlLJauOfTyYcQ-b1ykCcEtSv85NngYUDK1kI/edit?gid=0#gid=0) |
| 2026년 3월 | [2026년 3월](https://docs.google.com/spreadsheets/d/1llhCaCUnHFXIs6v67P3iMkaTnW-6g8OGb94E2Ru_Rkc/edit?gid=0#gid=0) |
| 2026년 2월 | [2026년 2월](https://docs.google.com/spreadsheets/d/1G2O2Ld_VDs4VvHCwVfQmpBgL0elRTKUVlakBY5rl_Xg/edit?gid=0#gid=0) |
| 2026년 1월 | [2026년 1월](https://docs.google.com/spreadsheets/d/150IfcIOGHZTAVfg3NANneS-VsLZ-3SeHY8AmXVOL5mQ/edit?gid=0#gid=0) |
