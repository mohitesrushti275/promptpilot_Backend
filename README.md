# PromptPilot Backend

## Requirements
- Node.js **20+**

## Environment
Create a `.env` file based on `.env.example`:
```bash
cd /var/www/html/promptpilot-sep/backend
cp .env.example .env
```

## Install
```bash
cd /var/www/html/promptpilot-sep/backend
npm install
```

Playwright is used for screenshots; install browser binaries once:
```bash
cd /var/www/html/promptpilot-sep/backend
npx playwright install chromium
```

## Run (development)
```bash
cd /var/www/html/promptpilot-sep/backend
npm start
```

Backend runs on `http://localhost:3000`.

