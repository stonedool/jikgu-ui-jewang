FROM node:20-bookworm

  WORKDIR /app

  RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

  COPY package*.json ./
  RUN npm install

  COPY . .

  RUN python3 -m pip install --break-system-packages -r scripts/requirements.txt
  RUN npm run build

  ENV PYTHON_PATH=python3
  CMD ["npm", "run", "start"]
