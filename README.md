# HR Candidate Analyzer Bot

Telegram бот с премиум веб-админкой для анализа кандидатов в групповых чатах. Бот молча собирает сообщения в группах и предоставляет HR-анализ участников через красивый веб-интерфейс.

## Возможности

### Telegram Bot
- Сбор текстовых сообщений из групповых чатов
- Транскрибация голосовых сообщений через Whisper API
- Транскрибация видео-кружков (извлечение аудио через ffmpeg)
- Сбор метаданных документов
- Автоматическая привязка чатов к администраторам

### Веб-админка
- Премиум дизайн уровня Linear/Notion (glassmorphism, градиенты)
- Тёмная тема с анимациями (Framer Motion)
- Мобильная адаптация
- Мультитенантность (Superadmin/Admin роли)
- Дашборд со статистикой и графиками
- Управление чатами и пользователями
- AI анализ через Claude API
- История анализов

## Система ролей

### Superadmin
- Видит все чаты всех админов
- Создаёт/удаляет пользователей
- Может переназначать чаты между админами
- Глобальные настройки и статистика

### Admin (HR)
- Видит только свои чаты
- При добавлении бота в группу — чат автоматически привязывается к нему
- Управляет критериями оценки
- Делает анализ, задаёт вопросы

## Стек технологий

### Backend
- FastAPI
- PostgreSQL + asyncpg
- JWT аутентификация
- aiogram 3.x (Telegram Bot)
- Anthropic SDK (Claude)
- OpenAI SDK (Whisper)

### Frontend
- React 18 + Vite
- Tailwind CSS
- Framer Motion
- Headless UI
- React Query
- Recharts
- Zustand

## Структура проекта

```
HR-bot-/
├── backend/
│   ├── api/
│   │   ├── models/          # SQLAlchemy + Pydantic
│   │   ├── routes/          # API endpoints
│   │   ├── services/        # Business logic
│   │   ├── config.py
│   │   ├── database.py
│   │   └── bot.py           # Telegram bot
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/          # UI компоненты
│   │   │   ├── layout/      # Layout
│   │   │   └── features/    # Бизнес-компоненты
│   │   ├── pages/           # Страницы
│   │   ├── hooks/
│   │   ├── lib/             # API, store, utils
│   │   └── styles/
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## Быстрый старт

### Docker Compose (рекомендуется)

1. Клонируйте репозиторий:
```bash
git clone <repository-url>
cd HR-bot-
```

2. Создайте `.env` файл:
```bash
cat > .env << EOF
SECRET_KEY=your-super-secret-jwt-key-min-32-chars
SUPERADMIN_EMAIL=admin@example.com
SUPERADMIN_PASSWORD=your_secure_password
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENAI_API_KEY=your_openai_api_key
EOF
```

3. Запустите:
```bash
docker-compose up -d
```

4. Откройте http://localhost:8000 в браузере

### Деплой на Railway (Monorepo - рекомендуется)

1. Создайте проект на [Railway](https://railway.app/) и подключите репозиторий

2. Railway автоматически использует корневой `Dockerfile`, который:
   - Собирает frontend (React + Vite)
   - Устанавливает backend (FastAPI)
   - Объединяет всё в один контейнер

3. Добавьте PostgreSQL в проект:
   - Нажмите "New" → "Database" → "PostgreSQL"
   - Railway автоматически добавит `DATABASE_URL`

4. **ОБЯЗАТЕЛЬНО** настройте переменные в разделе "Variables":

   | Переменная | Описание | Обязательно |
   |------------|----------|-------------|
   | `SECRET_KEY` | JWT секрет (минимум 32 символа) | ✅ |
   | `SUPERADMIN_EMAIL` | Email для входа в админку | ✅ |
   | `SUPERADMIN_PASSWORD` | Пароль для входа | ✅ |
   | `TELEGRAM_BOT_TOKEN` | Токен из @BotFather | ✅ |
   | `ANTHROPIC_API_KEY` | API ключ Claude | ✅ |
   | `OPENAI_API_KEY` | API ключ для Whisper | ⚠️ для голосовых |

   > **Важно**: `SUPERADMIN_EMAIL` и `SUPERADMIN_PASSWORD` создадут аккаунт суперадмина при первом запуске!

5. Railway автоматически задеплоит при каждом пуше в репозиторий

## API Endpoints

### Auth
- `POST /api/auth/login` — вход
- `GET /api/auth/me` — текущий пользователь
- `POST /api/auth/change-password` — смена пароля

### Users (superadmin only)
- `GET /api/users` — список пользователей
- `POST /api/users` — создать пользователя
- `PATCH /api/users/{id}` — обновить
- `DELETE /api/users/{id}` — удалить

### Chats
- `GET /api/chats` — список чатов
- `GET /api/chats/{id}` — детали чата
- `PATCH /api/chats/{id}` — обновить критерии
- `GET /api/chats/{id}/messages` — сообщения
- `GET /api/chats/{id}/participants` — участники
- `POST /api/chats/{id}/analyze` — анализ
- `GET /api/chats/{id}/history` — история анализов

### Stats
- `GET /api/stats` — статистика

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `SECRET_KEY` | Секрет для JWT токенов | `change-me-in-production` |
| `SUPERADMIN_EMAIL` | Email суперадмина | `admin@example.com` |
| `SUPERADMIN_PASSWORD` | Пароль суперадмина | `changeme` |
| `TELEGRAM_BOT_TOKEN` | Токен бота из @BotFather | - |
| `ANTHROPIC_API_KEY` | API ключ Claude | - |
| `OPENAI_API_KEY` | API ключ для Whisper | - |

## Как это работает

1. Добавьте бота в групповой чат
2. Бот автоматически определит, кто его добавил (по Telegram ID)
3. Если этот пользователь есть в системе — чат привяжется к нему
4. Бот молча собирает все сообщения
5. Войдите в веб-админку и анализируйте кандидатов

## Критерии оценки

По умолчанию бот оценивает:
- Коммуникативные навыки
- Профессиональные качества
- Soft skills
- Активность и вовлечённость
- Красные флаги

Настройте свои критерии в веб-интерфейсе для каждого чата.

## Лицензия

MIT
