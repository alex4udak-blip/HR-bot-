# HR-bot - Enterprise HR Intelligence Platform

## Быстрые команды
```bash
cd backend && uvicorn main:app --reload    # API на :8000
cd frontend && npm run dev                  # UI на :5173
docker-compose up -d                        # Всё вместе
pytest                                      # Тесты (3.5MB тестов!)
alembic upgrade head                        # Миграции
```

## Архитектура
```
├── backend/
│   ├── api/
│   │   ├── services/      # 15,769 строк бизнес-логики
│   │   │   ├── vacancy_recommender.py   # AI матчинг кандидат↔вакансия
│   │   │   ├── similarity.py            # Детекция дубликатов
│   │   │   ├── external_links.py        # Парсер Google Docs/Drive/Fireflies
│   │   │   ├── smart_search.py          # Умный поиск
│   │   │   ├── red_flags.py             # Детекция красных флагов
│   │   │   ├── call_processor.py        # Обработка звонков
│   │   │   └── abac/                    # Attribute-Based Access Control
│   │   ├── routes/        # API endpoints
│   │   ├── models/        # SQLAlchemy + Pydantic
│   │   └── bot.py         # Telegram bot (aiogram 3.x)
│   └── tests/             # 3.5MB тестов — enterprise уровень
├── frontend/              # React + Tailwind + Framer Motion
│   ├── components/
│   │   ├── ui/            # Базовые компоненты
│   │   ├── layout/        # Layouts
│   │   └── features/      # Бизнес-компоненты
│   └── pages/             # Страницы админки
```

## Стек
- Backend: FastAPI, SQLAlchemy 2.0, asyncpg, aiogram 3.x
- Frontend: React 18, Tailwind, Framer Motion, Recharts, Zustand
- AI: Claude API (анализ), Whisper API (транскрибация)
- DB: PostgreSQL
- Deploy: Railway + Docker

## Git Workflow — AUTO PR
```bash
# 1. Новая ветка
git checkout -b feature/[название]

# 2. Изменения
git add .
git commit -m "feat: [описание]"

# 3. Push + PR
git push -u origin feature/[название]
gh pr create --title "feat: [описание]" --body "## Что сделано\n- ..."

# 4. После merge — проверить на проде через Chrome
```

## Railway
- **URL:** [TODO — добавить после деплоя]
- **Auto-deploy:** при push в main
- **Время деплоя:** ~3-5 мин

## Проверка на проде
После merge:
1. Подожди 3-5 мин (Railway деплоит)
2. Открой URL через Chrome extension
3. Проверь функционал
4. Обнови WORK_LOG.md

## Ключевые фичи
- Сквозной сбор данных о кандидате (текст, голос, видео)
- AI-анализ личности через Claude
- Мультитенантность (Superadmin/Admin роли)
- Vacancy Recommender — AI матчинг с cultural fit
- Детекция дубликатов с транслитерацией RU↔EN
- Парсинг внешних ссылок через Playwright

## Паттерны кода
- Async/await везде
- Pydantic для валидации
- SQLAlchemy 2.0 style (select, not query)
- Сервисный слой отделён от routes
- ABAC для авторизации

## Роли системы
- **Superadmin**: видит всё, управляет пользователями
- **Admin (HR)**: видит свои чаты, делает анализ

## Тесты
```bash
pytest                           # Все тесты
pytest tests/test_auth.py        # Конкретный файл
pytest -v --tb=short             # Verbose с коротким traceback
```
