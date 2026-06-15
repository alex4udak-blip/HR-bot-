# Этапы воронки: убрать шаблоны, добавить «Резерв», починить синк, коммент-при-перемещении

- **Дата:** 2026-06-15
- **Статус:** дизайн утверждён пользователем

## Проблема

Четыре связанные задачи в системе этапов подбора:

1. **«Шаблоны статусов» — мёртвая и путающая система.** Модалка редактирует захардкоженный `CANONICAL_STAGES` и сохраняет в `Organization.settings['status_templates']`, который **никто не читает**. На реальную воронку не влияет. Источники: `StatusTemplatesModal.tsx`; потребитель в `VacancyForm.tsx`; бэкенд `/auth/status-templates`.
2. **Нет этапа «Резерв».** Нужен этап «отложен в резерв». Этапы — PostgreSQL-enum (`ApplicationStage`, `EntityStatus`).
3. **Рассинхрон при перемещении из «Все кандидаты».** Смена статуса в глобальном виде синкается в воронку через `STATUS_SYNC_MAP`, но `withdrawn` (Отозван) не имеет пары → рассинхрон.
4. **Коммент при перемещении показывается неоднозначно.** Move+comment через пикер создаёт отдельную заметку + отдельный переход (без коммента на нём). В ленте — серый коммент с непонятным тегом этапа, а не «коммент написан при переходе X → Y».

## Решения (утверждены)

1. «Резерв» — в **конце** порядка этапов (после Отказ/Отозван), серый цвет, присутствует **и в воронке, и в «Все кандидаты»**.
2. Заодно чиним рассинхрон **«Отозван»**: добавляем `EntityStatus.withdrawn` + пару в синк-мапу + колонку в канбан.
3. Коммент-при-перемещении — только для пикера воронки (`RecruiterFunnelsPage`); в «Все кандидаты» отдельного move+comment нет, вне скоупа.

## Дизайн

### Задача 1 — удалить шаблоны статусов
Удалить:
- `frontend/src/components/vacancies/StatusTemplatesModal.tsx`.
- `AllCandidatesPage.tsx`: import (63), стейт `showStatusTemplates` (513), кнопка-триггер (1045-1056), рендер (1491-1495).
- `VacancyForm.tsx`: import (16), фетч `getStatusTemplates` (298-300), стейт `statusTemplates` + UI выбора шаблона.
- `services/api/auth.ts`: `StatusTemplate`, `getStatusTemplates`, `updateStatusTemplates` (54-71).
- `backend/api/routes/auth.py`: модели статус-шаблонов + хелпер + GET/PUT (631-726).

Оставить: механику `stage_config` и `ALLOWED_STAGE_KEYS` (они отдельные). Осиротевшее `settings['status_templates']` в строках существующих орг остаётся (безвредно, без миграции).

### Задача 2 — добавить «Резерв»
Этапы — нативные PostgreSQL-enum → нужен `ALTER TYPE ... ADD VALUE 'reserve'` для `applicationstage` И `entitystatus`.
- **Миграция через `backend/start.sh`** (AUTOCOMMIT-блок, проверенный путь на Saturn; НЕ Alembic — он многоголовый/хрупкий), идемпотентно (`ADD VALUE IF NOT EXISTS`).
- Прописать `reserve` в: enum `ApplicationStage` + `EntityStatus` (database.py); `STATUS_SYNC_MAP` (1 строка → авто-инверсия в `STAGE_SYNC_MAP`); `DEFAULT_ORG_STAGES` (auth.py); `KANBAN_STATUSES` + `KANBAN_STATUS_LABELS` (candidate_search.py); `STAGE_ORDER` + `STAGE_LABELS` + `STAGE_COLORS` (RecruiterFunnelsPage.tsx); `types/index.ts` (юнионы `EntityStatus`/`ApplicationStage`, `STATUS_LABELS`, `STATUS_COLORS`, `APPLICATION_STAGE_LABELS`, `APPLICATION_STAGE_COLORS`, `STATUS_TO_STAGE_MAP`, `STAGE_TO_STATUS_MAP`).
- Лейбл «Резерв», порядок — последний, цвет — серый/нейтральный.
- Гарантировать появление «Резерв» даже у орг с уже кастомным `stage_config` (добавлять в набор пикера/канбана принудительно, не только в дефолты).

### Задача 3 — починить синк
- Добавить `EntityStatus.reserve: ApplicationStage.reserve` в `STATUS_SYNC_MAP` (чинит обе стороны для reserve).
- Добавить `EntityStatus.withdrawn` (+ ALTER TYPE) + `EntityStatus.withdrawn: ApplicationStage.withdrawn` в `STATUS_SYNC_MAP` + колонку «Отозван» в канбан (`KANBAN_STATUSES/LABELS`) → чинит существующий рассинхрон.
- Проверить: перемещение в «Все кандидаты» обновляет этап в воронке и наоборот для всех этапов, включая reserve + withdrawn.

### Задача 4 — коммент при перемещении
- **Бэкенд:** добавить `comment: Optional[str]` в `ApplicationUpdate` (`vacancies/common.py`); в `update_application` прокинуть `comment=data.comment` в `record_transition` (applications.py:369-376).
- **Фронт:** `handleStagePickerSave` (RecruiterFunnelsPage) — при перемещении с комментом слать коммент вместе со сменой этапа (расширить `handleStageChange`/`updateApplication` параметром `comment`), и **не создавать** отдельную заметку (`saveEntityNote`) в этом случае.
- **Показ:** таймлайн переходов уже рендерит `entry.comment` под «X → Y» (RecruiterFunnelsPage ~3070-3074) — UI не меняем.
- Коммент без перемещения — без изменений (уже показывает плашку этапа).

## Миграция и деплой
- Enum-изменения через `start.sh` AUTOCOMMIT (идемпотентный `ALTER TYPE ADD VALUE IF NOT EXISTS` для `reserve` и `withdrawn` на обоих типах). Бэкенд-деплой обязателен (Coolify Deploy; автодеплой ненадёжен; следить за OOM).
- Фронт: после деплоя — жёсткое обновление (Ctrl+Shift+R).

## Тестирование
- Бэкенд: pytest на синк `change_candidate_status` (reserve, withdrawn) и коммент-на-переходе в `update_application`.
- Вручную: добавить кандидата → провести по этапам, включая «Резерв»; переместить из «Все» → проверить синк воронки; переместить с комментом → лента показывает «X → Y: <текст>».
- Сборка фронта (tsc + vite) зелёная.

## Риски
- `ALTER TYPE ADD VALUE` нельзя в транзакции → выполняем в AUTOCOMMIT-блоке `start.sh`. Alembic многоголовый — для этого не используем.
- Удаление шаблонов из `VacancyForm` — убедиться, что больше нигде нет ссылок на `statusTemplates`.
- Мост двух enum (`EntityStatus` ↔ `ApplicationStage`) — добавляем reserve/withdrawn в ОБА + в мапу, иначе рассинхрон.
