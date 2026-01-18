# TODO: Архитектурный рефакторинг HR-bot

> Создано: 15 января 2026
> Обновлено: 18 января 2026
> Статус: Фаза 4 завершена ✅

---

## ТЕКУЩАЯ ЗАДАЧА: Kanban вакансий

- [x] Исправить ошибку enum PostgreSQL (applied вместо new)
- [x] Обновить frontend типы
- [x] Деплой на Railway
- [x] Проверить drag & drop между колонками - ✅ Работает на проде!
- [ ] Проверить добавление кандидата в вакансию
- [ ] Проверить удаление кандидата из вакансии

---

## КРИТИЧЕСКИЕ ПРОБЛЕМЫ

### Backend

#### 1. Bare except блоки (поглощают ошибки молча)
- [x] `api/routes/realtime.py:321, 338` - ✅ PR #400
- [x] `api/services/documents.py:278, 294, 297, 672, 698, 716` - ✅ PR #400
- [x] `api/services/external_links.py:367, 1051, 1062, 1073, 1106, 1118` - ✅ PR #402

#### 2. Циклические зависимости (отложенные импорты)
- [x] `api/routes/sharing.py:634` - ✅ PR #402 (импорт вынесен наверх)
- [x] `api/routes/entity_ai.py:426` - ✅ PR #402
- [x] `api/routes/organizations.py:453` - ✅ PR #402

#### 3. Дублирование Database URL логики
- [x] Создать утилиту `utils/db_url.py` - ✅ PR #402
- [x] Использовать в `main.py:37-50` - ✅ PR #402
- [x] Использовать в `bot.py:37-42` - ✅ PR #402
- [x] Использовать в `database.py:8-15` - ✅ PR #402

#### 4. Глобальное состояние без синхронизации
- [x] `external_links.py` - `_playwright_installed` флаг - ✅ PR #402 (threading.Lock)
- [x] `chats.py:20` - `import_progress` dict - ✅ PR #402 (threading.Lock)
- [ ] `auth.py:16-18` - `pwd_context` глобальный (низкий приоритет, thread-safe по дизайну)

#### 5. Hardcoded дефолтные значения
- [x] `config.py:50` - `admin@example.com` убрать дефолт - ✅ PR #402
- [x] `calls.py:28` - `UPLOAD_DIR` вынести в конфиг - ✅ PR #402
- [x] `calls.py:51` - `bot_name = "HR Recorder"` вынести в конфиг - ✅ PR #402

### Frontend

#### 1. Memory leaks в useEffect
- [x] `ContactDetail.tsx:101-111` - ✅ PR #402 (isMounted flag)
- [x] `EntityAI.tsx:155` - ✅ PR #402 (copyTimeoutRef + cleanup)

#### 2. Токен в querystring (логируется)
- [x] `ChatDetail.tsx:49-78` - ✅ PR #400 (перенесён в Authorization header)

#### 3. XSS уязвимость
- [x] `EntityAI.tsx:408-409, 424-425` - ✅ PR #400 (rehype-sanitize)

#### 4. Прямой доступ к localStorage
- [x] `EntityAI.tsx:74, 90, 117, 134, 182` - ✅ PR #402 (utils/localStorage.ts)
- [x] `ChatDetail.tsx:50, 55` - ✅ PR #400 (теперь используется Authorization header)

---

## ВАЖНЫЕ ПРОБЛЕМЫ

### Backend

#### Дублирование кода
- [x] ShareRequest schemas в 3+ файлах - ✅ Уже организовано в models/sharing.py
- [x] `get_current_user` vs `get_current_user_allow_inactive` - ✅ PR #402 (объединены с параметром)
- [ ] Role маппинг в `users.py` - вынести в утилиту
- [ ] `Count(Chat.id)` запрос повторяется 4 раза

#### Архитектура
- [ ] `main.py` - God Module с 20+ импортами роутов
- [ ] `cache.py` - неправильный Singleton pattern
- [x] `reports.py:45, 48, 50` - ✅ PR #402 (print() → logger)

#### Dead code
- [x] `database.py` - `init_db()` никогда не вызывается - ✅ PR #402 (удалён)
- [x] `chats.py` - `import_progress` объявлен не в том месте - ✅ PR #402

### Frontend

#### Большие файлы
- [x] `api.ts` - 2729 строк! Разбить на модули: - ✅ PR #402
  - [x] `api/client.ts`
  - [x] `api/auth.ts`
  - [x] `api/entities.ts`
  - [x] `api/chats.ts`
  - [x] `api/calls.ts`
  - [x] `api/vacancies.ts`
  - [x] `api/index.ts`

#### WebSocket типизация
- [x] `stores/entityStore.ts:232, 280` - ✅ PR #402 (types/websocket.ts)
- [x] `stores/chatStore.ts:25, 40` - ✅ PR #402
- [x] `hooks/useWebSocket.ts:150, 154, 158, 170, 182` - ✅ PR #402, улучшено в PR #408 (discriminated unions)

#### Много useState
- [x] `ContactDetail.tsx` - ✅ PR #402 (useReducer: modalReducer, asyncReducer)
- [x] `CallRecorderModal.tsx` - ✅ PR #402 (useReducer: entitySearchReducer)
- [ ] `KanbanBoard.tsx` - 5+ состояний для drag-end

#### Дублирование
- [x] `useCommandPalette.ts` и `useSmartSearch.ts` - ✅ PR #402 (utils/localStorage.ts)

---

## МЕЛКИЕ ПРОБЛЕМЫ

### Backend
- [x] TODO комментарии в production коде - ✅ Проанализировано: 3 важных TODO оставлены
- [ ] Legacy enum значения в `database.py:98-103` - удалить deprecated
- [ ] Парсинг User-Agent в `auth.py:50-69` - использовать библиотеку
- [ ] Hardcoded TTL=3600 в `cache.py:31` - вынести в конфиг

### Frontend
- [ ] `formatSalary` в types/index.ts помечен deprecated но экспортируется
- [x] `CANDIDATE_PIPELINE_STAGES` и `PIPELINE_STAGES` - не существует, только PIPELINE_STAGES
- [x] Неконсистентные naming: `loading` vs `isLoading` - ✅ PR #402 (стандартизировано)
- [x] Legacy exports в `ui/index.ts` - ✅ PR #402 (deprecated action prop удалён)

---

## ПЛАН РАБОТЫ

### Фаза 1: Критические (1-2 дня) ✅ ЗАВЕРШЕНО (PR #400)
1. ✅ Bare except → конкретные исключения + логирование
2. ✅ Токен в headers вместо querystring
3. ✅ rehype-sanitize для ReactMarkdown

### Фаза 2: Важные (3-5 дней) ✅ ЗАВЕРШЕНО (PR #402)
1. ✅ Разбить api.ts на модули
2. ✅ Типизированные WebSocket events
3. ✅ Объединить get_current_user функции
4. ✅ useReducer для больших компонентов
5. ✅ Утилита для Database URL

### Фаза 3: Улучшения (1 неделя) ✅ ЗАВЕРШЕНО (PR #402)
1. ✅ Shared localStorage утилита
2. ✅ Унифицировать naming conventions
3. ✅ Thread safety для глобального состояния
4. ✅ Удалить dead code

### Оставшиеся задачи (низкий приоритет)
- [ ] Role маппинг в users.py
- [ ] Count(Chat.id) запросы
- [ ] main.py God Module
- [ ] cache.py Singleton pattern
- [ ] KanbanBoard.tsx useReducer
- [ ] Legacy enum значения
- [ ] User-Agent парсинг

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

### Новые файлы созданные в PR #402
- `backend/api/utils/db_url.py` - централизованная обработка Database URL
- `backend/api/models/sharing.py` - ShareRequest schemas
- `frontend/src/services/api/` - модульная API структура
- `frontend/src/types/websocket.ts` - типы для WebSocket событий
- `frontend/src/utils/localStorage.ts` - утилиты для localStorage

### PR #408: WebSocket Type Safety
- Рефакторинг `WebSocketMessage` с generic interface на discriminated union
- TypeScript автоматически определяет тип payload по полю `type`
- Убраны `as PayloadType` assertions в useWebSocket hook
- Добавлена exhaustiveness check для обработки сообщений
