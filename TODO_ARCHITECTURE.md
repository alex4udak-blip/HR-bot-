# TODO: Архитектурный рефакторинг HR-bot

> Создано: 15 января 2026
> Статус: В работе

---

## ТЕКУЩАЯ ЗАДАЧА: Kanban вакансий

- [x] Исправить ошибку enum PostgreSQL (applied вместо new)
- [x] Обновить frontend типы
- [x] Деплой на Railway
- [ ] Проверить drag & drop между колонками
- [ ] Проверить добавление кандидата в вакансию
- [ ] Проверить удаление кандидата из вакансии

---

## КРИТИЧЕСКИЕ ПРОБЛЕМЫ

### Backend

#### 1. Bare except блоки (поглощают ошибки молча)
- [ ] `api/routes/realtime.py:321, 338` - заменить на конкретные исключения
- [ ] `api/services/documents.py:278, 294, 297, 672, 698, 716` - 6 мест
- [ ] `api/services/external_links.py:367, 1051, 1062, 1073, 1106, 1118` - 6+ мест

#### 2. Циклические зависимости (отложенные импорты)
- [ ] `api/routes/sharing.py:634` - импорт Department внутри функции
- [ ] `api/routes/entity_ai.py:426` - импорт моделей внутри функции
- [ ] `api/routes/organizations.py:453` - импорт внутри функции

#### 3. Дублирование Database URL логики
- [ ] Создать утилиту `utils/db_url.py`
- [ ] Использовать в `main.py:37-50`
- [ ] Использовать в `bot.py:37-42`
- [ ] Использовать в `database.py:8-15`

#### 4. Глобальное состояние без синхронизации
- [ ] `external_links.py` - `_playwright_installed` флаг
- [ ] `chats.py:20` - `import_progress` dict
- [ ] `auth.py:16-18` - `pwd_context` глобальный

#### 5. Hardcoded дефолтные значения
- [ ] `config.py:50` - `admin@example.com` убрать дефолт
- [ ] `calls.py:28` - `UPLOAD_DIR` вынести в конфиг
- [ ] `calls.py:51` - `bot_name = "HR Recorder"` вынести в конфиг

### Frontend

#### 1. Memory leaks в useEffect
- [ ] `ContactDetail.tsx:101-111` - добавить cleanup
- [ ] `EntityAI.tsx:155` - setTimeout без cleanup

#### 2. Токен в querystring (логируется)
- [ ] `ChatDetail.tsx:49-78` - использовать headers вместо `?token=`

#### 3. XSS уязвимость
- [ ] `EntityAI.tsx:408-409, 424-425` - добавить rehype-sanitize в ReactMarkdown

#### 4. Прямой доступ к localStorage
- [ ] `EntityAI.tsx:74, 90, 117, 134, 182` - использовать axios interceptor
- [ ] `ChatDetail.tsx:50, 55` - использовать axios interceptor

---

## ВАЖНЫЕ ПРОБЛЕМЫ

### Backend

#### Дублирование кода
- [ ] ShareRequest schemas в 3+ файлах - вынести в общий файл
- [ ] `get_current_user` vs `get_current_user_allow_inactive` - объединить с параметром
- [ ] Role маппинг в `users.py` - вынести в утилиту
- [ ] `Count(Chat.id)` запрос повторяется 4 раза

#### Архитектура
- [ ] `main.py` - God Module с 20+ импортами роутов
- [ ] `cache.py` - неправильный Singleton pattern
- [ ] `reports.py:45, 48, 50` - print() вместо logger

#### Dead code
- [ ] `database.py` - `init_db()` никогда не вызывается
- [ ] `chats.py` - `import_progress` объявлен не в том месте

### Frontend

#### Большие файлы
- [ ] `api.ts` - 2729 строк! Разбить на модули:
  - [ ] `api/auth.ts`
  - [ ] `api/entities.ts`
  - [ ] `api/chats.ts`
  - [ ] `api/calls.ts`
  - [ ] `api/vacancies.ts`

#### WebSocket типизация
- [ ] `stores/entityStore.ts:232, 280` - убрать `as unknown as Entity`
- [ ] `stores/chatStore.ts:25, 40` - создать типы для WS payload
- [ ] `hooks/useWebSocket.ts:150, 154, 158, 170, 182` - типизировать events

#### Много useState
- [ ] `ContactDetail.tsx` - 10+ состояний, использовать useReducer
- [ ] `CallRecorderModal.tsx` - 8+ состояний
- [ ] `KanbanBoard.tsx` - 5+ состояний для drag-end

#### Дублирование
- [ ] `useCommandPalette.ts` и `useSmartSearch.ts` - одинаковые localStorage функции

---

## МЕЛКИЕ ПРОБЛЕМЫ

### Backend
- [ ] TODO комментарии в production коде - удалить или создать issues
- [ ] Legacy enum значения в `database.py:98-103` - удалить deprecated
- [ ] Парсинг User-Agent в `auth.py:50-69` - использовать библиотеку
- [ ] Hardcoded TTL=3600 в `cache.py:31` - вынести в конфиг

### Frontend
- [ ] `formatSalary` в types/index.ts помечен deprecated но экспортируется
- [ ] `CANDIDATE_PIPELINE_STAGES` и `PIPELINE_STAGES` идентичны - объединить
- [ ] Неконсистентные naming: `loading` vs `isLoading` vs `loadingData`
- [ ] Legacy exports в `ui/index.ts` - удалить или обновить импорты

---

## ПЛАН РАБОТЫ

### Фаза 1: Критические (1-2 дня)
1. Bare except → конкретные исключения + логирование
2. Утилита для Database URL
3. Cleanup в useEffect
4. Токен в headers вместо querystring
5. rehype-sanitize для ReactMarkdown

### Фаза 2: Важные (3-5 дней)
1. Разбить api.ts на модули
2. Типизированные WebSocket events
3. Общий файл ShareRequest schemas
4. Объединить get_current_user функции
5. useReducer для больших компонентов

### Фаза 3: Улучшения (1 неделя)
1. Удалить deprecated код
2. Разбить models/database.py по доменам
3. Shared localStorage утилита
4. useCallback/useMemo где нужно
5. Унифицировать naming conventions

---

## ЗАМЕТКИ

### Enum маппинг (текущее решение)
Из-за невозможности добавить новые значения в PostgreSQL enum, используем существующие значения с HR-метками:

| PostgreSQL | UI Label |
|------------|----------|
| applied | Новый |
| screening | Скрининг |
| phone_screen | Практика |
| interview | Тех-практика |
| assessment | ИС |
| offer | Оффер |
| hired | Принят |
| rejected | Отказ |

### Файлы изменённые для enum fix
- `backend/api/models/database.py`
- `backend/api/routes/vacancies.py`
- `backend/api/routes/entities.py`
- `backend/api/services/vacancy_recommender.py`
- `frontend/src/types/index.ts`
- `frontend/src/components/vacancies/KanbanBoard.tsx`
- `frontend/src/components/vacancies/CandidatesDatabase.tsx`
