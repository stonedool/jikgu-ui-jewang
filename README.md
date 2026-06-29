# 직구의제왕

해외 쇼핑 페이지를 보다가 모르는 상품 설명, 옵션, 배송 문구, 리뷰 표현이 나오면 현재 브라우저 페이지를 읽어 한국어로 쉽게 풀어주고, 직구 시 문제가 될 수 있는 제한 품목·안전인증·전파법·식품/의약품 관련 요건은 관세청과 식품안전나라 문서 기반 RAG로 근거를 찾아 짧게 판정해주는 Agent입니다. 동시에 페이지에 실제로 등장한 외국어 단어와 표현을 사용자의 학습 수준에 맞는 퀴즈와 단어장으로 바꿔, 해외 쇼핑을 하면서 자연스럽게 외국어까지 학습할 수 있도록 돕는 브라우저 기반 외국어 학습 및 직구 지원 도구입니다.

## 미리보기

<p align="center">
  <img src="docs/images/screenshot-context-loading.png" alt="직구의제왕 페이지 컨텍스트 수집 화면" width="48%" />
  <img src="docs/images/screenshot-page-summary.png" alt="직구의제왕 페이지 요약 답변 화면" width="48%" />
</p>

## 사용 Tool / 기술 스택

| 영역 | 사용 Tool | 역할 |
| --- | --- | --- |
| 브라우저 확장 | Chrome Extension Manifest V3 | 사용자가 보고 있는 웹페이지를 읽고 사이드패널 UI를 제공 |
| 프론트엔드 | React, TypeScript, Vite | 채팅, 페이지 요약, 선택 번역, 직구 확인, 퀴즈/단어장 화면 구현 |
| UI 아이콘 | Lucide React | 버튼과 탭에 사용하는 아이콘 제공 |
| 로컬 서버 | Node.js, Express, TypeScript | 확장 프로그램 요청을 받아 Agent 라우팅, 페이지 이해, RAG, 퀴즈 API 제공 |
| LLM 연동 | OpenAI API | 자연어 답변, 페이지 요약, 번역, 퀴즈 생성 품질 개선 |
| RAG 검색 | Python, FAISS, sentence-transformers | 관세청/식약처 문서를 벡터 검색해 직구 통관·제한 품목 근거 제공 |
| 데이터 소스 | 관세청, 식약처 공개 문서 | 해외직구 통관, 개인통관고유부호, 합산과세, 인증요건, 반입제한 정보 |
| 실행 자동화 | PowerShell, Batch | Windows에서 설치·빌드·서버 실행을 한 번에 처리 |
| 저장소 관리 | Git, GitHub CLI | GitHub 레포 생성, 커밋, push 자동화 |

## 구조

- `apps/extension`: Chrome Manifest V3 확장 프로그램
- `apps/server`: 로컬 Agent API 서버

## 빠른 시작

### Windows 원클릭 실행

처음 받은 PC에서는 아래 파일을 한 번 실행합니다.

```powershell
.\setup-windows.bat
```

이후 실행할 때는 아래 파일만 실행합니다.

```powershell
.\start-windows.bat
```

`start-windows.bat`은 서버를 실행하고 Chrome 확장 프로그램 로드 위치인 `apps/extension/dist` 폴더를 열어줍니다. Chrome에서는 `chrome://extensions`에서 개발자 모드를 켠 뒤 `압축해제된 확장 프로그램 로드`로 해당 폴더를 선택합니다. 이미 로드해둔 경우에는 확장 프로그램 새로고침 버튼만 누르면 됩니다.

필요 프로그램:

- Node.js 20 이상
- Python 3.10 이상

OpenAI 키를 바로 넣어 설치하려면 아래처럼 실행할 수 있습니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1 -OpenAIKey "sk-..."
```

RAG 문서 다운로드/인덱싱을 건너뛰고 빠르게 설치하려면:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1 -SkipRag
```

### 수동 실행

```bash
npm install
npm run build
npm run start:server
```

Chrome에서 `apps/extension/dist` 폴더를 압축해제된 확장 프로그램으로 로드합니다.

## 개발 실행

터미널 1:

```bash
npm run dev:server
```

터미널 2:

```bash
npm run dev:extension
```

확장 프로그램 개발 서버 빌드는 일반 웹 미리보기용이고, 실제 Chrome 확장 프로그램 로드는 `npm run build:extension` 이후 `apps/extension/dist`를 사용합니다.

## OpenAI 설정

OpenAI API 키가 없으면 기본 규칙 기반 페이지 검색, RAG 검색, 퀴즈 생성으로 동작합니다. 키가 있으면 더 자연스러운 답변과 퀴즈를 생성합니다.

```bash
cp apps/server/.env.example apps/server/.env
```

`.env`에 값을 입력합니다.

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
PORT=8787
```

## FAISS RAG 문서

관세청 해외직구 문서 목록은 `apps/server/data/rag-sources.json`에 있습니다. 아래 명령으로 원문을 다운로드하고 텍스트를 추출한 뒤 FAISS 인덱스를 생성합니다.

```bash
npm run setup:rag -w apps/server
npm run build:rag -w apps/server
```

생성 위치:

- 원문: `apps/server/data/rag/raw`
- 추출 텍스트: `apps/server/data/rag/texts`
- FAISS 인덱스: `apps/server/data/rag/index/customs.faiss`
- 청크 메타데이터: `apps/server/data/rag/index/chunks.json`

서버는 FAISS 인덱스가 있으면 우선 사용하고, 없거나 검색 실패 시 `apps/server/data/rag-docs.sample.json` 기반 키워드 검색으로 fallback합니다.

## API

- `GET /api/health`
- `POST /api/query`
- `POST /api/quiz`
- `GET /api/rag/documents`
- `POST /api/rag/documents`
