import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { HuntflowEditorIcon } from './HuntflowControls';
import { getOrgMembers } from '@/services/api/auth';

/**
 * Рабочий rich-text редактор (contentEditable) для Huntflow-композеров.
 *
 * Кнопки реально форматируют выделение через document.execCommand, активный
 * режим подсвечивается «чернее» (hf-editor-icon-btn-active). Значение отдаётся
 * наружу как HTML-строка — её рендерят через sanitizeHtml в таймлайнах/заметках.
 *
 * @-упоминания: при «@» появляется выпадашка рекрутёров/HR (org-members).
 * Выбранный вставляется чипом <span class="hf-mention" data-uid="N">@Имя</span>;
 * data-uid едет внутри текста комментария, бэкенд (add_entity_note) достаёт его
 * и шлёт упомянутым уведомление «как у анкет». Никакого проброса id через
 * обработчики не нужно — всё внутри HTML.
 */
type MentionMember = { user_id: number; user_name: string; user_email?: string };

// Тэгать можно только тех, кто работает с кандидатами: owner / admin (HR Admin) /
// hr (HR-рекрутёр). Роль «member» — это «Сотрудник» (профиль/проекты/документы),
// он не рекрутирует, поэтому в @-выпадашке его не показываем.
const MENTIONABLE_ROLES = new Set(['owner', 'admin', 'hr']);

// Кэш списка участников орг-ии на уровне модуля: один запрос на все редакторы.
let _membersPromise: Promise<MentionMember[]> | null = null;
function loadMembers(): Promise<MentionMember[]> {
  if (!_membersPromise) {
    _membersPromise = getOrgMembers()
      .then((ms) =>
        (ms || [])
          .filter((m) => MENTIONABLE_ROLES.has(m.role))
          .map((m) => ({
            user_id: m.user_id,
            user_name: m.user_name,
            user_email: m.user_email,
          })),
      )
      .catch(() => []);
  }
  return _membersPromise;
}

export interface HuntflowRichInputProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  showMention?: boolean;
  /** Enter (без Shift) → сабмит. Если не задан — Enter переносит строку. */
  onEnterSubmit?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  editableClassName?: string;
  toolbarClassName?: string;
}

export function HuntflowRichInput({
  value,
  onChange,
  placeholder = 'Записать комментарий',
  showMention = false,
  onEnterSubmit,
  autoFocus = false,
  disabled = false,
  editableClassName,
  toolbarClassName,
}: HuntflowRichInputProps) {
  const ref = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const [active, setActive] = useState({
    bold: false,
    italic: false,
    ul: false,
    ol: false,
  });

  // --- @-mention state (refs дублируют для актуального доступа в keydown) ---
  const membersRef = useRef<MentionMember[]>([]);
  const mOpenRef = useRef(false);
  const mItemsRef = useRef<MentionMember[]>([]);
  const mIndexRef = useRef(0);
  const mInfoRef = useRef<{ node: Node; start: number } | null>(null);
  const ddRef = useRef<HTMLDivElement>(null);
  const [mOpen, setMOpen] = useState(false);
  const [mItems, setMItems] = useState<MentionMember[]>([]);
  const [mIndex, setMIndex] = useState(0);
  const [mRect, setMRect] = useState<{ top: number; left: number } | null>(null);

  const applyMention = (
    open: boolean,
    items: MentionMember[],
    index: number,
    rect: { top: number; left: number } | null,
    info: { node: Node; start: number } | null,
  ) => {
    mOpenRef.current = open;
    mItemsRef.current = items;
    mIndexRef.current = index;
    mInfoRef.current = info;
    setMOpen(open);
    setMItems(items);
    setMIndex(index);
    setMRect(rect);
  };
  const closeMention = useCallback(() => {
    if (!mOpenRef.current) return;
    applyMention(false, [], 0, null, null);
  }, []);

  // Сидим начальное значение ОДИН раз (uncontrolled, чтобы каретка не прыгала).
  useEffect(() => {
    const el = ref.current;
    if (el && value) el.innerHTML = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Внешний сброс: после сабмита родитель ставит value='' → чистим поле.
  useEffect(() => {
    const el = ref.current;
    if (el && value === '' && el.innerHTML !== '') el.innerHTML = '';
  }, [value]);

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => ref.current?.focus());
  }, [autoFocus]);

  // Подгружаем участников орг-ии для @-выпадашки (один кэшированный запрос).
  useEffect(() => {
    if (!showMention) return;
    let alive = true;
    loadMembers().then((ms) => {
      if (alive) membersRef.current = ms;
    });
    return () => {
      alive = false;
    };
  }, [showMention]);

  // Закрываем выпадашку ТОЛЬКО при действиях снаружи неё: клик мимо, либо скролл
  // НЕ внутри списка. Раньше capture-scroll ловил и собственную прокрутку списка
  // (и onBlur — любой увод фокуса), из-за чего она схлопывалась «от прикосновения».
  useEffect(() => {
    if (!mOpen) return;
    const insideDropdown = (t: EventTarget | null) =>
      t instanceof Node && !!ddRef.current && ddRef.current.contains(t);
    const insideEditor = (t: EventTarget | null) =>
      t instanceof Node && !!ref.current && ref.current.contains(t);
    const onDocDown = (e: MouseEvent) => {
      if (!insideDropdown(e.target) && !insideEditor(e.target)) closeMention();
    };
    const onScroll = (e: Event) => {
      // скролл ВНУТРИ выпадашки её не закрывает
      if (insideDropdown(e.target)) return;
      closeMention();
    };
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeMention);
    return () => {
      document.removeEventListener('mousedown', onDocDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closeMention);
    };
  }, [mOpen, closeMention]);

  const refreshActive = useCallback(() => {
    if (typeof document === 'undefined') return;
    const sel = document.getSelection();
    const el = ref.current;
    if (el && sel && sel.anchorNode && !el.contains(sel.anchorNode)) return;
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
      });
    } catch {
      /* queryCommandState может бросить в отвязанном документе — игнор */
    }
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', refreshActive);
    return () => document.removeEventListener('selectionchange', refreshActive);
  }, [refreshActive]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    // Нормализуем «пустое» (остаточный <br>/<div>) в '' — чтобы показался
    // placeholder (:empty::before) и наружу не уходил мусорный HTML.
    if (!el.textContent?.trim() && !el.querySelector('ul,ol,a,.hf-mention')) {
      if (el.innerHTML !== '') el.innerHTML = '';
    }
    onChange(el.innerHTML);
  }, [onChange]);

  // --- @-mention detection / insert ---
  const caretRect = (): { top: number; left: number } | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(false);
    const rect = r.getClientRects()[0] || r.getBoundingClientRect();
    if (!rect || (rect.top === 0 && rect.left === 0)) {
      const er = ref.current?.getBoundingClientRect();
      return er ? { top: er.top + 22, left: er.left + 8 } : null;
    }
    return { top: rect.bottom + 4, left: rect.left };
  };

  const detectMention = useCallback(() => {
    if (!showMention) return;
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      closeMention();
      return;
    }
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) {
      closeMention();
      return;
    }
    const before = (node.textContent || '').slice(0, sel.anchorOffset);
    // «@» в начале или после пробела, затем до 40 буквенно-цифровых/._-.
    const m = before.match(/(?:^|\s)@([\p{L}\p{N}_.\-]{0,40})$/u);
    if (!m) {
      closeMention();
      return;
    }
    const query = m[1].toLowerCase();
    const start = sel.anchorOffset - m[1].length - 1;
    const items = membersRef.current
      .filter((mm) => (mm.user_name || '').toLowerCase().includes(query))
      .slice(0, 8);
    applyMention(true, items, 0, caretRect(), { node, start });
  }, [showMention, closeMention]);

  const pickMention = (mm: MentionMember) => {
    const el = ref.current;
    const info = mInfoRef.current;
    const sel = window.getSelection();
    if (el && info && sel && sel.rangeCount > 0) {
      try {
        const caretOffset = sel.anchorOffset;
        const range = document.createRange();
        range.setStart(info.node, Math.max(0, info.start));
        range.setEnd(info.node, caretOffset);
        range.deleteContents();
        const chip = document.createElement('span');
        chip.className = 'hf-mention';
        chip.setAttribute('data-uid', String(mm.user_id));
        chip.setAttribute('contenteditable', 'false');
        chip.textContent = '@' + mm.user_name;
        const space = document.createTextNode(' ');
        const frag = document.createDocumentFragment();
        frag.appendChild(chip);
        frag.appendChild(space);
        range.insertNode(frag);
        const after = document.createRange();
        after.setStartAfter(space);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
      } catch {
        /* протухший диапазон — просто закрываем */
      }
    }
    closeMention();
    emit();
    refreshActive();
  };

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    try {
      document.execCommand(command, false, arg);
    } catch {
      /* execCommand устарел, но поддержан везде; на отказе просто ничего */
    }
    emit();
    refreshActive();
  };

  // Список на пустом поле execCommand в Chrome не строит — создаём вручную.
  const toggleList = (type: 'ul' | 'ol') => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const cmd = type === 'ul' ? 'insertUnorderedList' : 'insertOrderedList';
    const noText = (el.textContent ?? '').trim() === '';
    const activeNow = document.queryCommandState(cmd);
    if (noText && !activeNow) {
      el.innerHTML = `<${type}><li><br></li></${type}>`;
      const li = el.querySelector('li');
      if (li) {
        const range = document.createRange();
        range.selectNodeContents(li);
        range.collapse(true);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(range);
      }
    } else if (noText && activeNow) {
      el.innerHTML = '';
    } else {
      try {
        document.execCommand(cmd);
      } catch {
        /* noop */
      }
    }
    emit();
    refreshActive();
  };

  const insertLink = () => {
    const url = window.prompt('Введите ссылку (URL):');
    if (!url) return;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    exec('createLink', href);
  };

  // «@» в тулбаре: вставляем символ и сразу открываем выпадашку упоминаний.
  const insertMention = () => {
    ref.current?.focus();
    try {
      document.execCommand('insertText', false, '@');
    } catch {
      /* noop */
    }
    emit();
    requestAnimationFrame(detectMention);
  };

  const btnCls = (isActive: boolean) =>
    clsx('hf-editor-icon-btn', isActive && 'hf-editor-icon-btn-active');

  // onMouseDown→preventDefault: не даём полю потерять выделение при клике по
  // кнопке — иначе bold/italic применялись бы «в никуда».
  const keepSelection = (e: ReactMouseEvent) => e.preventDefault();

  return (
    <>
      <div className={toolbarClassName}>
        <button
          type="button"
          className={btnCls(active.bold)}
          onMouseDown={keepSelection}
          onClick={() => exec('bold')}
          aria-label="Жирный"
          title="Жирный"
        >
          <HuntflowEditorIcon name="bold" />
        </button>
        <button
          type="button"
          className={btnCls(active.italic)}
          onMouseDown={keepSelection}
          onClick={() => exec('italic')}
          aria-label="Курсив"
          title="Курсив"
        >
          <HuntflowEditorIcon name="italic" />
        </button>
        <button
          type="button"
          className={btnCls(active.ul)}
          onMouseDown={keepSelection}
          onClick={() => toggleList('ul')}
          aria-label="Маркированный список"
          title="Маркированный список"
        >
          <HuntflowEditorIcon name="bullet-list" />
        </button>
        <button
          type="button"
          className={btnCls(active.ol)}
          onMouseDown={keepSelection}
          onClick={() => toggleList('ol')}
          aria-label="Нумерованный список"
          title="Нумерованный список"
        >
          <HuntflowEditorIcon name="numbered-list" />
        </button>
        <button
          type="button"
          className={btnCls(false)}
          onMouseDown={keepSelection}
          onClick={insertLink}
          aria-label="Ссылка"
          title="Ссылка"
        >
          <HuntflowEditorIcon name="link" />
        </button>
        {showMention && (
          <button
            type="button"
            className={btnCls(false)}
            onMouseDown={keepSelection}
            onClick={insertMention}
            aria-label="Упомянуть"
            title="Упомянуть"
          >
            <HuntflowEditorIcon name="at" />
          </button>
        )}
      </div>
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={() => {
          emit();
          detectMention();
        }}
        onKeyUp={refreshActive}
        onMouseUp={() => {
          refreshActive();
          detectMention();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          emit();
          detectMention();
        }}
        onPaste={(e) => {
          // Вставляем как простой текст — без чужого мусорного HTML из Word и т.п.
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          try {
            document.execCommand('insertText', false, text);
          } catch {
            /* noop */
          }
          emit();
        }}
        onKeyDown={(e) => {
          // Навигация по выпадашке упоминаний имеет приоритет над сабмитом.
          if (mOpenRef.current) {
            const items = mItemsRef.current;
            if (e.key === 'ArrowDown' && items.length) {
              e.preventDefault();
              const n = Math.min(mIndexRef.current + 1, items.length - 1);
              mIndexRef.current = n;
              setMIndex(n);
              return;
            }
            if (e.key === 'ArrowUp' && items.length) {
              e.preventDefault();
              const n = Math.max(mIndexRef.current - 1, 0);
              mIndexRef.current = n;
              setMIndex(n);
              return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && items.length) {
              e.preventDefault();
              pickMention(items[mIndexRef.current]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              closeMention();
              return;
            }
          }
          if (onEnterSubmit && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onEnterSubmit();
          }
        }}
        className={clsx('hf-rich-surface', editableClassName)}
      />
      {mOpen &&
        mRect &&
        createPortal(
          <div
            ref={ddRef}
            className="hf-mention-dropdown"
            style={{ top: mRect.top, left: mRect.left }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {mItems.length === 0 ? (
              <div className="hf-mention-empty">Нет совпадений</div>
            ) : (
              mItems.map((mm, i) => (
                <div
                  key={mm.user_id}
                  className={clsx(
                    'hf-mention-item',
                    i === mIndex && 'hf-mention-item-active',
                  )}
                  onMouseEnter={() => {
                    mIndexRef.current = i;
                    setMIndex(i);
                  }}
                  onClick={() => pickMention(mm)}
                >
                  <span className="hf-mention-item-name">{mm.user_name}</span>
                  {mm.user_email && (
                    <span className="hf-mention-item-sub">{mm.user_email}</span>
                  )}
                </div>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
