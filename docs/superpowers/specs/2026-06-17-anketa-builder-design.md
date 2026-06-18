# Дизайн: встроенный конструктор анкет для кандидатов

- **Дата:** 2026-06-17
- **Статус:** дизайн согласован; спека к реализации
- **Референс продукта:** Survio (логика конструктора)
- **Точка входа в UI:** кнопка «Анкета» на карточке кандидата ([AllCandidatesPage.tsx](../../../frontend/src/pages/AllCandidatesPage.tsx))

---

## 1. Цель

Дать HR возможность прямо из карточки кандидата собрать анкету (с нуля / из шаблона / через ИИ),
отправить её конкретному кандидату по персональной ссылке и получить ответы обратно в **ту же**
карточку, с мгновенной нотификацией в глобальный Inbox и счётчиком-бейджем на кнопке «Анкета».
Никаких редиректов и смены URL для HR — всё открывается шторкой поверх карточки.

## 2. Ключевое: ~70% инфраструктуры уже в коде

Это **не** greenfield-клон Survio. В проекте уже есть рабочий модуль форм. Задача —
интеграция в карточку + 4 новых способности.

| Требование | Статус | Где |
|---|---|---|
| Модель форм/ответов (JSONB) | есть | `FormTemplate.fields`, `FormSubmission.data`, `FormVacancy` — [database.py:1495](../../../backend/api/models/database.py) |
| CRUD форм + публичный сабмит без авторизации, загрузка файлов | есть | [forms.py](../../../backend/api/routes/forms.py) |
| Изолированный публичный роут кандидата | есть | `/form/:slug` вне `ProtectedRoute` — [App.tsx:176](../../../frontend/src/App.tsx) |
| Конструктор (drag-drop, 9 типов полей, превью) | есть, как **страница** | [FormBuilderPage.tsx](../../../frontend/src/pages/FormBuilderPage.tsx) |
| Real-time канал (WS, org/user-broadcast, access-control) | есть | [realtime.py](../../../backend/api/routes/realtime.py), [WebSocketProvider.tsx](../../../frontend/src/components/WebSocketProvider.tsx) |
| Глобальный Inbox (поллинг 30с) | есть | [Layout.tsx:1006](../../../frontend/src/components/Layout.tsx), [notifications.py](../../../backend/api/routes/notifications.py) |
| Кнопка «Анкета» | заглушка | [HUNTFLOW_MISSING_FEATURES.md:7](../../../HUNTFLOW_MISSING_FEATURES.md) |

Стек уже содержит всё нужное: `@radix-ui/react-dialog` (Drawer), `@dnd-kit`+`framer-motion`,
`@tanstack/react-query`, `react-hook-form`+`zod`. Claude API подключён.

**Новое (суть задачи):** (1) шторка из кнопки; (2) привязка к существующему кандидату через
персональную отправку; (3) AI-генерация; (4) шаблоны; (5) тип поля «Шкала»; (6) бейдж + мгновенный Inbox.

## 3. Принятые решения

| Решение | Выбор | Обоснование |
|---|---|---|
| Режимы анкеты | **Оба**: персональная ссылка (привязка к существующему) + открытый интейк (создаёт нового) | Один движок; текущий лидоген-сценарий не ломаем |
| Глубина AI | **Диалоговый чат** (многоходовая правка формы) | Решение пользователя; самая тяжёлая часть → вынесена в MVP-2 |
| Этапность | **Срез без AI сначала** | MVP-1 — сборка готовых кусков, быстрый релиз; AI изолирован |
| Контейнер UI | **Правый Drawer**, не Modal | Конструктор широкий; слайд-аут удобнее, не перекрывает карточку целиком |
| Хранение | **JSONB**, не EAV | Уже выбрано в коде; ответ читается целиком, поля произвольные, без множества джойнов |

## 4. Архитектура

### 4.1 UI/UX — шторка без тормозов карточки

- Контейнер — правый Drawer на `@radix-ui/react-dialog`. Radix рендерит **через портал в корень
  документа** → перерисовки/анимации билдера не вызывают reflow карточки.
- **Lazy-load**: `const FormBuilderPanel = lazy(() => import('@/features/forms/FormBuilderPanel'))` —
  тяжёлый код билдера не попадает в бандл карточки, грузится при первом открытии.
- **Mount-on-open / unmount-on-close** — в покое стоимость на карточке нулевая.
- Формы маленькие (<~50 полей) → виртуализация не нужна (`@tanstack/react-virtual` есть в резерве).
- **Антидубль кода**: вынести ядро билдера из `FormBuilderPage` в общий
  `<FormBuilder mode="page|drawer" entityId?>`, переиспользуемый и роутом `/form-builder`, и шторкой.
- Шаги внутри шторки: вход (3 пути) → конструктор / шаблон / AI → отправка (копировать ссылку).

### 4.2 Модель данных

Новое — **одна таблица** `form_dispatches` + одно поле в `FormSubmission`. Существующие модели не меняем.

```python
class FormDispatch(Base):
    """Анкета, отправленная конкретному существующему кандидату по личной ссылке."""
    __tablename__ = "form_dispatches"
    id            = Column(Integer, primary_key=True)
    form_id       = Column(Integer, ForeignKey("form_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_id     = Column(Integer, ForeignKey("entities.id",       ondelete="CASCADE"), nullable=False, index=True)
    token         = Column(String(64), unique=True, nullable=False, index=True)  # личный публичный URL
    status        = Column(String(20), default="sent")   # sent | opened | submitted
    submission_id = Column(Integer, ForeignKey("form_submissions.id", ondelete="SET NULL"), nullable=True)
    seen_by_recruiter = Column(Boolean, default=False)   # управляет бейджем на кнопке
    created_by    = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at    = Column(DateTime, default=func.now())
    opened_at     = Column(DateTime, nullable=True)
    submitted_at  = Column(DateTime, nullable=True)

    form   = relationship("FormTemplate")
    entity = relationship("Entity")

# FormSubmission += dispatch_id (nullable FK на form_dispatches) — связь ответа с отправкой
```

Связка:
```
Entity (кандидат) 1──* FormDispatch *──1 FormTemplate (переиспользуемый шаблон)
                          │
                          └─0..1─ FormSubmission (data: JSONB)
```
- **Личная ссылка** `/form/d/{token}` → сабмит пишет `FormSubmission` с `entity_id` из dispatch,
  нового кандидата НЕ создаёт; `dispatch.status=submitted`, `seen_by_recruiter=false`.
- **Открытый интейк** `/form/{slug}` → текущее поведение без изменений (`dispatch_id=NULL`,
  создаётся новый entity).

`status` — обычный `String`, **не** PG-enum → миграция простая, без `ALTER TYPE` в start.sh
(в отличие от `EntityStatus`/`ApplicationStage`).

### 4.3 API (MVP-1)

Аутентифицированные (HR):
- `POST /forms/{form_id}/dispatch` `{entity_id}` → создаёт `FormDispatch`, возвращает `{token, url}`.
- `GET  /entities/{entity_id}/forms` → список отправок+ответов для карточки.
- `GET  /entities/{entity_id}/forms/unread-count` → число для бейджа.
- `PATCH /forms/dispatch/{id}/seen` → гасит бейдж (выставляет `seen_by_recruiter=true`).

Публичные (без авторизации):
- `GET  /forms/public/d/{token}` → поля формы + контекст кандидата (зеркало `get_public_form`).
- `POST /forms/public/d/{token}/submit` и `/submit-with-files` → привязка к `dispatch.entity_id`.

### 4.4 Тип поля «Шкала» (`scale`)

Определение поля в JSON: `{ id, type: "scale", label, required, min: 1, max: 10, step?: 1, labels?: {min, max} }`.
Поддержка в билдере (палитра + настройки) и в публичном рендерере.

### 4.5 Real-time и двухуровневые нотификации

- Транспорт — **готовый WebSocket** (не SSE/новый поллинг): в `realtime.py` уже есть
  `broadcast_to_users` + `get_users_with_resource_access`.
- Новое событие `form.submission`, payload: `{entity_id, form_id, dispatch_id, form_title, candidate_name}`.
  Получатели = владелец карточки + лиды отдела + создатель отправки (через `get_users_with_resource_access`).
- **Уровень 1 — глобальный Inbox**: пишем строку `Notification` (паттерн `hr_notifications.py`) **и** шлём
  WS-событие → колокольчик инкрементится мгновенно (поллинг 30с в [Layout.tsx:1006](../../../frontend/src/components/Layout.tsx) остаётся fallback).
- **Уровень 2 — бейдж на кнопке**: счётчик = `count(form_dispatches WHERE entity_id=? AND status='submitted' AND seen_by_recruiter=false)`.
  Первая загрузка — REST `unread-count`; live — WS-событие. Гасится при открытии вкладки ответов (`PATCH .../seen`).
- Фронт: добавить `onFormSubmission` в [useWebSocket.ts](../../../frontend/src/hooks/useWebSocket.ts) и хендлер в [WebSocketProvider.tsx](../../../frontend/src/components/WebSocketProvider.tsx),
  поднимающий и глобальный счётчик, и per-entity бейдж (стор/`entityStore`).

## 5. Эпики

### MVP-1 «Рабочий срез» (без AI)
**Backend**
- Миграция: таблица `form_dispatches` + `form_submissions.dispatch_id`.
- Модель `FormDispatch` + поле в `FormSubmission`.
- Эндпоинты: `POST /forms/{id}/dispatch`; `GET/POST /forms/public/d/{token}` (+ `/submit-with-files`);
  `GET /entities/{id}/forms`, `GET /entities/{id}/forms/unread-count`, `PATCH /forms/dispatch/{id}/seen`.
- WS-хелпер `broadcast_form_submission(...)`; вызов из token-сабмита + запись `Notification`.
- Тип поля `scale` в публичной валидации/сабмите.

**Frontend**
- Вынести ядро в `frontend/src/features/forms/FormBuilder.tsx` (`mode`, `entityId?`).
- `frontend/src/features/forms/AnketaDrawer.tsx` — radix Dialog, lazy; провод в кнопку «Анкета».
- Экран «3 пути» (AI — заглушка «скоро»); сид-пресеты шаблонов.
- Рендер «Шкалы» в билдере и в [PublicFormPage.tsx](../../../frontend/src/pages/PublicFormPage.tsx); режим `/form/d/:token`.
- Бейдж на кнопке + WS-хендлер; вкладка ответов в шторке + `seen`.
- API-клиент: dispatch / entity-forms / unread-count в [forms.ts](../../../frontend/src/services/api/forms.ts).

### MVP-2 «AI и шаблоны»
- Диалоговый чат-генератор на Claude (tool-calling правит структуру формы; история диалога в стейте шторки).
- Сохранение своих шаблонов («сохранить как шаблон»).

### MVP-3 «Полировка»
- Аналитика ответов; переиспользование движка под кнопку «Обратная связь»; экспорт;
  автодоставка ссылки через каналы (SMS/email/telegram).

## 6. Обработка ошибок
- Невалидный / уже использованный токен → дружелюбный публичный экран (не 500).
- Неактивная форма (`is_active=false`) → «форма недоступна».
- Обязательные поля — валидация уже есть в публичном сабмите.
- Нотификации — fire-and-forget (как в `hr_notifications.py`): падение нотификации не ломает сабмит.

## 7. Тестирование
- **pytest**: dispatch-сабмит прикрепляется к существующему entity (нового не создаёт); открытый интейк
  по-прежнему создаёт нового; токен одноразовый; `unread-count` уважает доступ; WS-broadcast зовётся.
- **vitest**: lazy-mount шторки; рендер «Шкалы»; бейдж поднимается по WS-событию
  (есть готовый паттерн — [realtime.test.tsx](../../../frontend/src/__tests__/realtime.test.tsx)).

## 8. Принятые дефолты
- Шаблоны MVP-1 — наши сид-пресеты (Скрининг / Тех-анкета / Pre-offer); «сохранить свой» — MVP-2.
- «Отправить кандидату» MVP-1 = сгенерировать + скопировать ссылку (HR шлёт своим каналом);
  автоотправка по SMS/email — MVP-3 (каналы сейчас заглушки).
- Одна отправка = один ответ; нужна новая — создаётся новый dispatch.
- Срок жизни ссылки не ограничиваем (без `expires_at` в MVP-1).

## 9. Карта затрагиваемых файлов
**Backend:** `models/database.py` (+`FormDispatch`, `+dispatch_id`), новая миграция alembic,
`routes/forms.py` (dispatch + token + entity-forms эндпоинты), `routes/realtime.py` (broadcast-хелпер),
`services/hr_notifications.py` (нотификация о сабмите анкеты).
**Frontend:** `features/forms/FormBuilder.tsx` (вынос), `features/forms/AnketaDrawer.tsx` (новый),
`pages/AllCandidatesPage.tsx` (кнопка «Анкета» + бейдж), `pages/PublicFormPage.tsx` (token + scale),
`services/api/forms.ts`, `hooks/useWebSocket.ts`, `components/WebSocketProvider.tsx`, стор бейджа.

## 10. Вынесено в MVP-2 (детализировать позже)
- Протокол AI-чата: формат tool-calling, как ИИ возвращает/патчит структуру формы, хранение истории,
  лимиты токенов, модель (`claude-opus-4-8` vs дешевле для генерации полей).
