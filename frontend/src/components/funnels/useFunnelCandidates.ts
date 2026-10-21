import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { getApplications } from "@/services/api";
import type { User, Vacancy, VacancyApplication } from "@/types";
import { getAcceptorIds, isPersonallyActive } from "@/utils/vacancy";
import { funnelSearchMatch } from "@/utils/translit";

// Кандидаты открытой воронки: кого показываем («Только мои», рекрутёр из
// сайдбара, режим шаринг-ссылки), загрузка с защитой от опоздавших ответов и
// тихий опрос (вынесено из RecruiterFunnelsPage, 20.10.2026, без изменения
// поведения).

// F5 открытой воронки: документ перезагружен ровно на текущем URL. Проверка
// идемпотентна: StrictMode в dev дважды зовёт инициализатор useState, а страница
// после загрузки может смонтироваться повторно (гарды ролей/авторизации) — всё
// это та же перезагрузка. Отметка гаснет, как только адрес стал другим: значит,
// юзер уже ходил по приложению, и следующий заход с ?entity= — снова ссылка.
let documentReloadHref: string | null | undefined;
function isDocumentReloadOfCurrentUrl(): boolean {
  if (documentReloadHref === undefined) {
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      documentReloadHref = nav?.type === 'reload' ? nav.name : null;
    } catch {
      documentReloadHref = null;
    }
  }
  if (documentReloadHref !== window.location.href) documentReloadHref = null;
  return documentReloadHref != null;
}

// Состояние воронки, которое должно пережить F5 в этой вкладке, но не новую
// вкладку и не новую ссылку, — sessionStorage.
const SHARED_ENTRY_KEY = 'funnel_shared_entry';
const FOREIGN_ONLY_MINE_KEY = 'funnel_foreign_only_mine';
function readFunnelSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeFunnelSession(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим — просто не запомним */
  }
}
function removeFunnelSession(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

export interface FunnelCandidatesParams {
  selectedVacancyId: number | null;
  selectedVacancy: Vacancy | undefined;
  funnelBlocked: boolean;
  user: User | null;
  isHrAdmin: boolean;
  isSuperadmin: boolean;
  selectedRecruiterFilter: number | null;
  candidateSearch: string;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  fetchVacancies: (silent?: boolean) => unknown;
  /** Открыли другую воронку — страница сбрасывает выбор. */
  onVacancyOpened: () => void;
}

export function useFunnelCandidates(p: FunnelCandidatesParams) {
  const {
    selectedVacancyId, selectedVacancy, funnelBlocked, user, isHrAdmin, isSuperadmin,
    selectedRecruiterFilter, candidateSearch, searchParams, setSearchParams, fetchVacancies,
  } = p;
  const onVacancyOpenedRef = useRef(p.onVacancyOpened);
  onVacancyOpenedRef.current = p.onVacancyOpened;
  // Выключенная рекрутёром «Только мои» в СВОЕЙ воронке — временно, до ухода
  // из воронки / F5 / новой вкладки (null = умолчание, кнопка включена).
  const [ownOnlyMineOverride, setOwnOnlyMineOverride] = useState<boolean | null>(null);
  // Открыли по ШАРИНГ-ССЫЛКЕ на кандидата (в URL сразу есть и ?v=, и ?entity=).
  // В этом режиме грузим кандидатов БЕЗ скоупа по рекрутёру — иначе чужой кандидат
  // (added другим рекрутёром) не попадает в список и окно пустое (баг Марии по
  // ссылке) — а сам кандидат из ссылки остаётся в списке при любом фильтре.
  // Хранится id кандидата из URL на момент открытия: живой ?entity= не годится,
  // страница переписывает его при каждом выборе кандидата.
  //  • F5 — НЕ новая ссылка: ?entity= туда записала сама страница. F5 обязан
  //    вернуть ровно то, что было на экране (решение юзера 2026-09-10), поэтому
  //    кандидат из ссылки запоминается в sessionStorage вкладки и после F5
  //    восстанавливается оттуда, а не из ?entity=. Иначе после перезагрузки в
  //    «воронке Марии» застревал последний открытый чужой кандидат (прод,
  //    2026-09-10: Шатилов с меткой Влады в «Вакансии: Мария»).
  //  • Режим живёт до первого своего действия — смена воронки, рекрутёра или
  //    «Только мои» (см. эффект у onlyMine ниже).
  const [sharedEntryEntityId, setSharedEntryEntityId] = useState<number | null>(() => {
    const vacancyId = Number(searchParams.get('v')) || null;
    if (vacancyId == null) return null;
    if (isDocumentReloadOfCurrentUrl()) {
      const saved = readFunnelSession<{ v: number; entityId: number }>(SHARED_ENTRY_KEY);
      return saved?.v === vacancyId ? saved.entityId : null;
    }
    return Number(searchParams.get('entity')) || null;
  });
  useEffect(() => {
    if (sharedEntryEntityId == null || selectedVacancyId == null) removeFunnelSession(SHARED_ENTRY_KEY);
    else writeFunnelSession(SHARED_ENTRY_KEY, { v: selectedVacancyId, entityId: sharedEntryEntityId });
  }, [sharedEntryEntityId, selectedVacancyId]);
  const arrivedViaSharedCandidate = sharedEntryEntityId != null;
  const [candidates, setCandidates] = useState<VacancyApplication[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  // ШАРИНГ-ССЫЛКА без ?recruiter=: восстанавливаем «путь» воронки. Ссылка-дип-линк
  // рекрутёра обычно вида ?v=176&entity=8913&stage=applied (БЕЗ recruiter) → сайдбар
  // не знал владельца и показывал голое «Мои вакансии» вместо «Вакансии: Мария».
  // Выводим владельца из самой вакансии (accepted_by/created_by) и подставляем в URL —
  // дальше существующий механизм (?recruiter= → pickerOwnerId в Layout) поднимает
  // контекст сайдбара. Только для шаринг-сессии, только когда вакансия уже загружена.
  useEffect(() => {
    if (!arrivedViaSharedCandidate) return;
    if (searchParams.get('recruiter')) return;
    if (!selectedVacancy) return;
    const ownerId = getAcceptorIds(selectedVacancy)[0];
    if (!ownerId) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('recruiter', String(ownerId));
        return next;
      },
      { replace: true },
    );
  }, [arrivedViaSharedCandidate, selectedVacancy, searchParams, setSearchParams]);

  // Load candidates when vacancy selected
  useEffect(() => {
    if (!selectedVacancyId || funnelBlocked) {
      setCandidates([]);
      return;
    }
    loadCandidates(selectedVacancyId);
    onVacancyOpenedRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVacancyId]);

  // Счётчик-версия загрузок. Тихий focus-refresh (alt-tab) или гонка запросов
  // могли прилететь со СТАРЫМ списком и перезаписать свежее состояние — напр.
  // вернуть только что снятого кандидата («удаляй дважды»). Применяем результат
  // загрузки ТОЛЬКО если это последний запрос; любая мутация бампает счётчик.
  const loadSeqRef = useRef(0);
  // «Только мои» живёт в двух режимах (решение юзера 2026-09-10):
  //  • СВОЯ воронка (в сайдбаре рекрутёр не выбран или выбран я) — кнопка
  //    ВКЛЮЧЕНА всегда при входе. Выключил — видны все кандидаты, но только пока
  //    он в этой воронке: другая воронка, уход со страницы, F5, новая вкладка —
  //    снова включена. Раньше выключение навсегда писалось в localStorage, и
  //    рекрутёр, однажды щёлкнувший кнопку, дальше везде видел всех (2026-09-21).
  //  • ЧУЖАЯ воронка (в сайдбаре выбран другой рекрутёр) — кнопка ВЫКЛЮЧЕНА,
  //    видны кандидаты этого рекрутёра. Включил — видишь в его воронке своих.
  //    Это временно: ушёл из воронки — кнопка отжимается и не запоминается.
  //    F5 уходом не считается — состояние кнопки держится в sessionStorage вкладки.
  // Наблюдателю и суперадмину по умолчанию «выключено»: сами они кандидатов не
  // добавляют, и с включённой кнопкой видели бы пустые воронки (такой баг у
  // наблюдателя уже чинили).
  const isForeignContext =
    selectedRecruiterFilter != null && selectedRecruiterFilter !== user?.id;
  // Своя воронка из сайдбара («Я» → вакансия, ?recruiter=<я>) — только свои
  // кандидаты, кнопке тут переключать нечего.
  const isSelfContext = selectedRecruiterFilter != null && selectedRecruiterFilter === user?.id;
  // «Только мои» имеет смысл только в воронке, которая у человека В РАБОТЕ (лично
  // взял — как в сайдбаре «Мои вакансии»). В воронке не в работе своих кандидатов
  // нет — кнопка выключена и неактивна. Пока вакансия не загрузилась — считаем
  // «в работе», чтобы список не перегружался дважды.
  const worksOnFunnel = !selectedVacancy || (!!user && isPersonallyActive(selectedVacancy, user.id));
  const onlyMineAvailable = worksOnFunnel && !isSelfContext;
  const ownOnlyMine = ownOnlyMineOverride ?? !(isSuperadmin || user?.is_readonly);
  const [foreignOnlyMine, setForeignOnlyMine] = useState(() => {
    if (!isDocumentReloadOfCurrentUrl()) return false;
    const saved = readFunnelSession<{ v: number; r: number }>(FOREIGN_ONLY_MINE_KEY);
    return (
      saved != null &&
      saved.v === (Number(searchParams.get('v')) || null) &&
      saved.r === (Number(searchParams.get('recruiter')) || null)
    );
  });
  useEffect(() => {
    if (!foreignOnlyMine) removeFunnelSession(FOREIGN_ONLY_MINE_KEY);
    else if (selectedVacancyId != null && selectedRecruiterFilter != null) {
      writeFunnelSession(FOREIGN_ONLY_MINE_KEY, { v: selectedVacancyId, r: selectedRecruiterFilter });
    }
  }, [foreignOnlyMine, selectedVacancyId, selectedRecruiterFilter]);
  const onlyMine = !onlyMineAvailable ? false : isForeignContext ? foreignOnlyMine : ownOnlyMine;
  const setOnlyMine = (value: boolean) => {
    if (!onlyMineAvailable) return;
    setSharedEntryEntityId(null);
    if (isForeignContext) setForeignOnlyMine(value);
    else setOwnOnlyMineOverride(value);
  };
  // Уход в другую воронку или к другому рекрутёру заканчивает режим шаринг-ссылки
  // и отжимает временную «Только мои» чужой воронки. null → X по рекрутёру — не
  // уход: это URL-синк на маунте и восстановление владельца для ссылки без
  // ?recruiter= (эффект выше).
  const sharedEntryContextRef = useRef({ v: selectedVacancyId, r: selectedRecruiterFilter });
  useEffect(() => {
    const prev = sharedEntryContextRef.current;
    sharedEntryContextRef.current = { v: selectedVacancyId, r: selectedRecruiterFilter };
    const vacancyChanged = prev.v !== selectedVacancyId;
    const recruiterChanged = prev.r != null && prev.r !== selectedRecruiterFilter;
    if (vacancyChanged || recruiterChanged) {
      setSharedEntryEntityId(null);
      setForeignOnlyMine(false);
      setOwnOnlyMineOverride(null);
    }
  }, [selectedVacancyId, selectedRecruiterFilter]);

  // Скоуп кандидатов на СЕРВЕРЕ:
  //  • ШАРИНГ-ССЫЛКА (arrivedViaSharedCandidate): без скоупа — грузим всю воронку,
  //    чтобы кандидат из ссылки гарантированно был в списке; сужаем уже на фронте
  //    (recruiterScopedCandidates), оставляя кандидата из ссылки.
  //  • «Только мои» — на себя. Сервер разрешает это любой роли и учитывает
  //    со-рекрутёров.
  //  • Обычный рекрутёр — без скоупа: фильтр на КОЛЛЕГУ сервер ему не применяет
  //    (бэкенд по решению юзера не трогаем), сужаем на фронте.
  //  • Админ, суперадмин, наблюдатель — на выбранного в сайдбаре рекрутёра, а без
  //    выбора — ВСЕ. Раньше админ/овнер по умолчанию видел только своих; теперь
  //    «только своих» даёт кнопка, и /my-funnels для всех ролей значит «все».
  const candidateScopeRecruiterId = arrivedViaSharedCandidate
    ? undefined
    : onlyMine || isSelfContext
    ? (user?.id ?? undefined)
    : !isHrAdmin
      ? undefined
      : (selectedRecruiterFilter ?? undefined);
  const loadCandidates = useCallback(async (vacancyId: number, silent = false) => {
    const seq = ++loadSeqRef.current;
    if (!silent) setCandidatesLoading(true);
    try {
      const apps = await getApplications(vacancyId, undefined, candidateScopeRecruiterId);
      if (seq === loadSeqRef.current) setCandidates(apps);
    } catch {
      if (!silent && seq === loadSeqRef.current) setCandidates([]);
    } finally {
      if (!silent) setCandidatesLoading(false);
    }
  }, [candidateScopeRecruiterId]);

  // Админ сменил рекрутёра в сайдбаре при открытой воронке — перезагружаем
  // кандидатов под новый скоуп (тихо, без скелетона).
  useEffect(() => {
    if (selectedVacancyId && !funnelBlocked) loadCandidates(selectedVacancyId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateScopeRecruiterId]);

  // Авто-refresh когда юзер возвращается на вкладку браузера —
  // например, после добавления кандидата через волшебную кнопку из
  // другой вкладки. Иначе нужен F5 чтобы увидеть новых.
  // ВАЖНО: рефреш ТИХИЙ (silent) — без скелетонов-лоадеров. Раньше обычный
  // alt-tab перерисовывал список со скелетоном и выглядел как перезагрузка
  // страницы. Плюс троттл: не чаще раза в 3с.
  useEffect(() => {
    let lastRun = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastRun < 3000) return;
      lastRun = now;
      if (selectedVacancyId && !funnelBlocked) loadCandidates(selectedVacancyId, true);
      fetchVacancies(true);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [selectedVacancyId, loadCandidates, fetchVacancies, funnelBlocked]);

  // Поллинг воронки каждые 15с (только когда вкладка видима): на проде WS
  // ненадёжен, поэтому тихо подтягиваем кандидатов и вакансии — иначе рекрутёр,
  // сидя на странице воронки, не видел изменений без F5 (доска «Все кандидаты»
  // уже так поллится). Тихий refresh, без скелетонов.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (selectedVacancyId && !funnelBlocked) loadCandidates(selectedVacancyId, true);
      fetchVacancies(true);
    }, 15000);
    return () => clearInterval(id);
  }, [selectedVacancyId, loadCandidates, fetchVacancies, funnelBlocked]);

  // Filter candidates by search — умный матч по ИМЕНИ (транслит RU↔EN + любой
  // порядок слов + опечатки, как серверный pg_trgm в «Все кандидаты»); по
  // email/телефону — обычная подстрока; по telegram — ВСЕ ники кандидата +
  // текст комментариев карточки; запрос с «@» — строгий режим (только тг/комменты).
  // Фронтовое сужение списка — там, где сервер не отфильтровал сам.
  // Кого показываем: при «Только мои» — себя, иначе рекрутёра из сайдбара
  // («Вакансии: Мария» → кандидаты Марии), а без выбора — всех.
  //  • Если сервер уже отфильтровал на того же человека — верим ему: он учитывает
  //    со-рекрутёров, а в ответе нет поля, по которому их узнал бы фронт (только
  //    created_by), и фронтовый фильтр их бы срезал.
  //  • Кандидат из ССЫЛКИ (sharedEntryEntityId) остаётся в списке, пока юзер не
  //    сменил контекст — иначе ссылка на со-рекрутёрского кандидата открывала бы
  //    пустое окно.
  const recruiterScopedCandidates = useMemo(() => {
    const wantedOwner = onlyMine ? (user?.id ?? null) : selectedRecruiterFilter;
    if (wantedOwner == null) return candidates;
    if (candidateScopeRecruiterId === wantedOwner) return candidates;
    // Заявка без автора (created_by = null) — кандидат владельца вакансии, как
    // у метки «HR: …» и серверного скоупа (recruiter_owns_application).
    const ownsVacancy = selectedVacancy?.created_by === wantedOwner;
    return candidates.filter(
      (c) =>
        c.created_by === wantedOwner ||
        (c.created_by == null && ownsVacancy) ||
        c.entity_id === sharedEntryEntityId,
    );
  }, [candidates, onlyMine, user?.id, selectedRecruiterFilter, candidateScopeRecruiterId, sharedEntryEntityId, selectedVacancy?.created_by]);

  const filteredCandidates = useMemo(() => {
    if (!candidateSearch.trim()) return recruiterScopedCandidates;
    return recruiterScopedCandidates.filter((c) => funnelSearchMatch(candidateSearch, c));
  }, [recruiterScopedCandidates, candidateSearch]);

  return {
    candidates, setCandidates, candidatesLoading, loadCandidates, loadSeqRef,
    recruiterScopedCandidates, filteredCandidates,
    onlyMine, setOnlyMine, onlyMineAvailable, isSelfContext, isForeignContext, worksOnFunnel,
  };
}
