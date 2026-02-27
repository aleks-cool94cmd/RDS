# menstrual-cycle-tracker

Эмоциональный mobile-first PWA трекер цикла: плавный онбординг (7 вопросов), почта для уведомлений, календарь фаз, прогнозы, задержка, ежедневное сопровождение и поддержка в сложные дни в стиле Apple.

## 1) Как запустить локально
```bash
npm install
npm run start
```
Откройте: http://localhost:4173

## 1.1) Локальная база пользователей (для тестов)
По умолчанию сервер хранит пользователей в:
`server/data/users-db.json`

Это постоянный локальный файл, он не очищается при перезапуске сервера.

Полезные команды:
```bash
npm run db:status
npm run db:backup
npm run db:export-sql
```

- `db:status` — текущее состояние локальной БД
- `db:backup` — резервная копия в `server/data/backups/`
- `db:export-sql` — SQL-экспорт в `server/data/exports/` для переноса в PostgreSQL

Шаблон окружения:
```bash
cp .env.example .env
```

## 2) Как создать GitHub repo
1. Создайте пустой репозиторий на GitHub (например `menstrual-cycle-tracker`).
2. Скопируйте все файлы проекта в репозиторий.

## 3) Как сделать push
```bash
git init
git branch -M main
git add .
git commit -m "feat: initial cycle tracker pwa"
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

## 4) Где появится сайт
После push в `main` workflow `.github/workflows/deploy.yml` опубликует `public/` в GitHub Pages:
`https://<username>.github.io/<repo>/`

## 5) Как включить уведомления
1. Нажмите **«Уведомления»**.
2. Разрешите уведомления в браузере.

## 6) Как запустить push сервер
1. Создайте `.env`:
```env
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
PORT=3030
```
2. Запуск:
```bash
npm run push-server
```

Эндпоинты:
- `GET /vapidPublicKey`
- `POST /subscribe`
- `POST /notify`

## 7) Пример JSON структуры данных
```json
{
  "cycles": [{ "id": "c1", "startDate": "2026-01-01", "endDate": "2026-01-05", "length": 28, "confirmed": true }],
  "days": {
    "2026-01-10": {
      "phase": "follicular",
      "intensity": "2",
      "symptoms": ["Усталость"],
      "mood": "Нормально",
      "note": "Лёгкая активность"
    }
  },
  "settings": { "theme": "auto", "notifications": true, "delayThreshold": 3 }
}
```

## Структура
```text
menstrual-cycle-tracker/
 ├─ .github/workflows/deploy.yml
 ├─ public/index.html
 ├─ public/manifest.json
 ├─ public/service-worker.js
 ├─ public/assets/icons/*
 ├─ src/js/app.js
 ├─ src/js/tests.js
 ├─ src/css/styles.css
 ├─ src/i18n/ru.js
 ├─ server/server.js
 ├─ package.json
 ├─ README.md
 └─ .gitignore
```
