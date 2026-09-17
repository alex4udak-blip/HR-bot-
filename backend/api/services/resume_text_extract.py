"""Текст резюме из приложенного файла — БЕЗ обращения к ИИ.

Зачем: резюме, загруженное в карточку существующего кандидата, для дедупа было
невидимо. На загрузке файла (routes/entities/files.py) вызывался только рендер
страниц в картинки и извлечение фото — ни текста, ни повторного детекта. В
локальной базе из 16 кандидатов с PDF-резюме 15 не участвовали в текстовом
сравнении вообще (владелец 17.09.2026).

Здесь именно ДЕШЁВЫЙ путь: pdfplumber/python-docx через общий document_parser,
без Claude. Извлечённый текст ложится в ``extra_data.resume_text`` и с этого
момента участвует и в детекторе копипаста (resume_text_twin), и во вкладке
«Текст» окна сравнения. Контакты отсюда НЕ разбираются — это отдельная, платная
задача (resume_parser + Claude).

Скан-PDF (картинка без текстового слоя) даёт пустой результат: OCR к PDF не
подключён. Такой файл помечаем ``resume_text_source.empty = true``, чтобы было
видно, почему кандидат «молчит», и чтобы не дёргать парсер повторно.
"""

import logging
import re
from typing import Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import Entity

logger = logging.getLogger("hr-analyzer.resume_text")

# Форматы, из которых текст достаётся локально. Картинки сюда НЕ входят: для них
# document_parser зовёт Claude Vision (OCR), а это уже платный путь.
TEXT_EXTRACTABLE_EXTENSIONS = {".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt", ".html", ".htm"}

# Короче этого — не текст резюме, а подпись под сканом или шапка. В extra_data не
# кладём: иначе «текст» из трёх слов начнёт участвовать в сравнении.
MIN_USEFUL_CHARS = 200


def is_text_extractable(file_name: str) -> bool:
    ext = ("." + file_name.rsplit(".", 1)[-1].lower()) if "." in file_name else ""
    return ext in TEXT_EXTRACTABLE_EXTENSIONS


# Служебные врезки парсера: «--- Page 2 ---», «[Table 3]». В карточке сравнения
# они выглядят мусором, а в сравнении текстов дают общие шинглы у ЛЮБЫХ двух
# многостраничных резюме — то есть немного завышают сходство.
_SERVICE_MARKERS = re.compile(r"^(?:-{2,}\s*Page\s*\d+\s*-{2,}|\[Table\s*\d+\])\s*$", re.M)


async def extract_resume_text(file_bytes: bytes, file_name: str) -> str:
    """Текст из файла резюме. Пустая строка, если текстового слоя нет."""
    from .documents import document_parser

    try:
        result = await document_parser.parse(file_bytes, file_name)
    except Exception as e:  # noqa: BLE001 — извлечение best-effort
        logger.warning(f"RESUME_TEXT: parse failed for {file_name!r}: {e}")
        return ""
    text = _SERVICE_MARKERS.sub("", result.content or "")
    return "\n".join(line.rstrip() for line in text.splitlines() if line.strip()).strip()


async def store_resume_text(
    db: AsyncSession,
    entity: Entity,
    file_bytes: bytes,
    file_name: str,
    file_id: Optional[int] = None,
) -> Tuple[int, bool]:
    """Достать текст из файла и положить в extra_data кандидата.

    Возвращает (сколько символов, положили ли в resume_text). Не коммитит —
    вызывающий решает, когда фиксировать. Самое свежее резюме перетирает прошлое:
    поле показывает текст последнего файла, как и вкладка «Резюме» в карточке.
    """
    if not is_text_extractable(file_name):
        return 0, False

    text = await extract_resume_text(file_bytes, file_name)
    extra = dict(entity.extra_data) if isinstance(entity.extra_data, dict) else {}
    source = {"file_id": file_id, "file_name": file_name, "chars": len(text)}

    if len(text) < MIN_USEFUL_CHARS:
        # Скан или пустой файл: текста нет. Сам resume_text не трогаем (там может
        # лежать текст прошлого, нормального резюме).
        source["empty"] = True
        extra["resume_text_source"] = source
        entity.extra_data = extra
        logger.info(
            f"RESUME_TEXT: no text layer in {file_name!r} for entity {entity.id} "
            f"({len(text)} chars) — скан или защищённый файл"
        )
        return len(text), False

    extra["resume_text"] = text
    extra["resume_text_source"] = source
    entity.extra_data = extra
    logger.info(f"RESUME_TEXT: extracted {len(text)} chars from {file_name!r} for entity {entity.id}")
    return len(text), True
