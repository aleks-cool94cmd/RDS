# menstrual-cycle-tracker

Мобильное PWA-приложение для отслеживания цикла: фазы, прогноз, задержка, заметки, экспорт/импорт данных, локальные уведомления и пример web-push сервера.

## 1) Как запустить локально
```bash
npm install
npm run start
```
Откройте: http://localhost:4173

## 2) Как создать GitHub repo
1. Создайте пустой репозиторий на GitHub (например `menstrual-cycle-tracker`).
2. Скопируйте в него все файлы этого проекта.

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
После push в `main` сработает GitHub Actions workflow `.github/workflows/deploy.yml`.
Сайт будет опубликован в GitHub Pages:
`https://<username>.github.io/<repo>/`

## 5) Как включить уведомления
1. Откройте приложение.
2. Нажмите кнопку **«Включить уведомления»**.
3. Разрешите уведомления в браузере.

> В приложении реализованы локальные уведомления (Notification API) и регистрация service worker.

## 6) Как запустить push сервер
1. Создайте VAPID-ключи (например через пакет `web-push`).
2. Создайте `.env`:
```env
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
PORT=3030
```
3. Запуск:
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
  "cycles": [
    {
      "id": "c1",
      "startDate": "2026-01-01",
      "endDate": "2026-01-05",
      "length": 28,
      "confirmed": true
    }
  ],
  "days": {
    "2026-01-10": {
      "phase": "follicular",
      "intensity": "2",
      "symptoms": ["Усталость"],
      "mood": "Нормально",
      "note": "Лёгкая активность"
    }
  },
  "settings": {
    "theme": "auto",
    "notifications": true,
    "delayThreshold": 3
  }
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
