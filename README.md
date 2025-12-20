# HR Candidate Analyzer Bot

Telegram бот для анализа кандидатов в групповых чатах. Бот молча собирает сообщения в группах и предоставляет HR-анализ участников по запросу.

## Возможности

- Сбор текстовых сообщений из групповых чатов
- Транскрибация голосовых сообщений через Whisper API
- Транскрибация видео-кружков (извлечение аудио через ffmpeg)
- Сбор метаданных документов
- HR-анализ участников через Claude API
- Настраиваемые критерии оценки для каждого чата
- Поддержка нескольких групп одновременно

## Команды (работают только в личке с ботом)

| Команда | Описание |
|---------|----------|
| `/start` | Приветствие и краткая справка |
| `/help` | Подробная справка |
| `/chats` | Список отслеживаемых чатов с ID и статистикой |
| `/analyze <chat_id>` | Полный HR-анализ всех участников чата |
| `/ask <chat_id> <вопрос>` | Задать произвольный вопрос по переписке |
| `/criteria <chat_id> <критерии>` | Установить критерии оценки для чата |

## Требования

- Python 3.11+
- PostgreSQL
- ffmpeg (для обработки видео)
- Telegram Bot Token
- Anthropic API Key (Claude)
- OpenAI API Key (Whisper)

## Установка

### Локальный запуск

1. Клонируйте репозиторий:
```bash
git clone <repository-url>
cd HR-bot-
```

2. Создайте виртуальное окружение:
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# или
venv\Scripts\activate  # Windows
```

3. Установите зависимости:
```bash
pip install -r requirements.txt
```

4. Установите ffmpeg:
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Windows - скачайте с https://ffmpeg.org/
```

5. Установите и настройте PostgreSQL:
```bash
# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib

# Создайте базу данных
sudo -u postgres createdb hr_bot
sudo -u postgres createuser hr_bot_user -P
```

6. Создайте файл `.env` на основе `.env.example`:
```bash
cp .env.example .env
```

7. Заполните переменные окружения в `.env`:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENAI_API_KEY=your_openai_api_key
DATABASE_URL=postgresql://hr_bot_user:password@localhost:5432/hr_bot
ADMIN_IDS=123456789,987654321  # опционально
```

8. Запустите бота:
```bash
python main.py
```

### Деплой на Railway

1. Создайте новый проект на [Railway](https://railway.app/)

2. Добавьте PostgreSQL сервис в проект

3. Подключите репозиторий GitHub

4. Добавьте переменные окружения в настройках проекта:
   - `TELEGRAM_BOT_TOKEN`
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `DATABASE_URL` (Railway автоматически предоставит URL из PostgreSQL сервиса)
   - `ADMIN_IDS` (опционально)

5. Railway автоматически задеплоит бота

## Структура проекта

```
HR-bot-/
├── main.py              # Точка входа
├── src/
│   ├── __init__.py
│   ├── config.py        # Конфигурация
│   ├── database.py      # Работа с PostgreSQL (asyncpg)
│   ├── transcription.py # Транскрибация через Whisper
│   ├── analyzer.py      # Анализ через Claude
│   └── handlers.py      # Обработчики Telegram
├── Dockerfile
├── railway.toml
├── requirements.txt
├── .env.example
└── README.md
```

## Как использовать

1. Добавьте бота в групповой чат
2. Дайте боту права на чтение сообщений
3. Бот будет молча собирать все сообщения
4. Напишите боту в личку `/chats` чтобы увидеть ID чата
5. Используйте `/analyze <chat_id>` для получения анализа

## Критерии оценки

По умолчанию бот оценивает кандидатов по:
- Коммуникативные навыки
- Профессиональные качества
- Soft skills
- Активность и вовлечённость
- Красные флаги

Вы можете установить свои критерии:
```
/criteria -1001234567890 Python, системное мышление, командная работа
```

## Безопасность

- Переменные окружения никогда не коммитятся в репозиторий
- Доступ к командам ограничен списком `ADMIN_IDS`
- Если `ADMIN_IDS` не указан, доступ разрешён всем пользователям

## Лицензия

MIT
