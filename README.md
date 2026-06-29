# 직구의제왕

해외 웹페이지를 읽어 상품 페이지 질의에 답하고, 직구 제도/절차는 RAG 문서 기반으로 안내하며, 현재 페이지의 외국어 표현으로 퀴즈를 만드는 MVP입니다.

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
