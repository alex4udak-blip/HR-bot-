import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import clsx from 'clsx';
import { HuntflowEditorIcon } from './HuntflowControls';

/**
 * Рабочий rich-text редактор (contentEditable) для Huntflow-композеров.
 *
 * Раньше тулбар (B / I / списки / ссылка / @) был чисто декоративным — кнопки
 * висели над обычным <textarea> и ничего не делали. Здесь они реально форматируют
 * выделение через document.execCommand, а активный режим подсвечивается «чернее»
 * (класс hf-editor-icon-btn-active). Значение отдаётся наружу как HTML-строка —
 * её рендерят через sanitizeHtml в таймлайнах/заметках.
 *
 * Компонент возвращает Fragment [тулбар + поле], чтобы хост сам задавал рамку,
 * экшены и кнопки «Сохранить/Отмена» (одинаково и в композере, и в смене этапа).
 */
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

  const refreshActive = useCallback(() => {
    if (typeof document === 'undefined') return;
    const sel = document.getSelection();
    const el = ref.current;
    // Реагируем на состояние формата только когда курсор внутри нашего поля.
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
    if (!el.textContent?.trim() && !el.querySelector('ul,ol,a')) {
      if (el.innerHTML !== '') el.innerHTML = '';
    }
    onChange(el.innerHTML);
  }, [onChange]);

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

  const insertMention = () => {
    ref.current?.focus();
    try {
      document.execCommand('insertText', false, '@');
    } catch {
      /* noop */
    }
    emit();
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
        onInput={emit}
        onKeyUp={refreshActive}
        onMouseUp={refreshActive}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          emit();
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
          if (onEnterSubmit && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onEnterSubmit();
          }
        }}
        className={clsx('hf-rich-surface', editableClassName)}
      />
    </>
  );
}
