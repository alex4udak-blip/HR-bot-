import io
import os
import re
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH

# Register DejaVu fonts for Cyrillic support
FONTS_DIR = os.path.join(os.path.dirname(__file__), 'fonts')
_fonts_registered = False

def _register_fonts():
    global _fonts_registered
    if _fonts_registered:
        return
    try:
        pdfmetrics.registerFont(TTFont('DejaVu', os.path.join(FONTS_DIR, 'DejaVuSans.ttf')))
        pdfmetrics.registerFont(TTFont('DejaVu-Bold', os.path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf')))
        _fonts_registered = True
    except Exception as e:
        print(f"Warning: Could not register DejaVu fonts: {e}")


def generate_pdf_report(title: str, content: str, chat_title: str) -> bytes:
    """Generate PDF report from markdown content."""
    _register_fonts()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=20*mm, bottomMargin=20*mm, leftMargin=20*mm, rightMargin=20*mm)

    styles = getSampleStyleSheet()

    # Use DejaVu font for Cyrillic support
    styles.add(ParagraphStyle(
        name='CustomTitle',
        fontName='DejaVu-Bold',
        fontSize=18,
        spaceAfter=12,
        textColor=colors.HexColor('#1a1a2e'),
    ))
    styles.add(ParagraphStyle(
        name='CustomHeading',
        fontName='DejaVu-Bold',
        fontSize=14,
        spaceAfter=8,
        spaceBefore=16,
        textColor=colors.HexColor('#2d2d44'),
    ))
    styles.add(ParagraphStyle(
        name='CustomBody',
        fontName='DejaVu',
        fontSize=10,
        spaceAfter=6,
        leading=14,
        textColor=colors.HexColor('#333344'),
    ))
    styles.add(ParagraphStyle(
        name='CustomBullet',
        fontName='DejaVu',
        fontSize=10,
        spaceAfter=4,
        leftIndent=20,
        bulletIndent=10,
        leading=14,
        textColor=colors.HexColor('#333344'),
    ))

    story = []

    # Title
    story.append(Paragraph(f"Аналитический отчёт: {chat_title}", styles['CustomTitle']))
    story.append(Paragraph(f"Дата создания: {datetime.now().strftime('%d.%m.%Y %H:%M')}", styles['CustomBody']))
    story.append(Spacer(1, 20))

    # Parse markdown and add content
    lines = content.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            story.append(Spacer(1, 8))
        elif line.startswith('### '):
            story.append(Paragraph(line[4:], styles['CustomHeading']))
        elif line.startswith('## '):
            story.append(Paragraph(line[3:], styles['CustomHeading']))
        elif line.startswith('# '):
            story.append(Paragraph(line[2:], styles['CustomTitle']))
        elif line.startswith('**') and line.endswith('**'):
            # Bold line
            clean = escape_html(line[2:-2])
            story.append(Paragraph(f"<b>{clean}</b>", styles['CustomBody']))
        elif line.startswith('- ') or line.startswith('• '):
            # Bullet point
            text = line[2:] if line.startswith('- ') else line[2:]
            clean = format_markdown(text)
            story.append(Paragraph(f"• {clean}", styles['CustomBullet']))
        elif line.startswith('* '):
            # Bullet point with asterisk
            clean = format_markdown(line[2:])
            story.append(Paragraph(f"• {clean}", styles['CustomBullet']))
        elif re.match(r'^\d+\.\s', line):
            # Numbered list
            clean = format_markdown(line)
            story.append(Paragraph(clean, styles['CustomBullet']))
        else:
            # Regular text with markdown formatting
            clean = format_markdown(line)
            story.append(Paragraph(clean, styles['CustomBody']))

    doc.build(story)
    buffer.seek(0)
    return buffer.read()


def escape_html(text: str) -> str:
    """Escape HTML special characters."""
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def format_markdown(text: str) -> str:
    """Convert markdown formatting to ReportLab XML tags."""
    # Escape HTML first
    text = escape_html(text)
    # Bold
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    # Italic
    text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
    # Remove any remaining problematic characters
    text = text.replace('```', '')
    return text


def generate_docx_report(title: str, content: str, chat_title: str) -> bytes:
    """Generate DOCX report from markdown content."""
    doc = Document()

    # Title
    title_para = doc.add_heading(f"HR Анализ: {chat_title}", 0)
    title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # Date
    date_para = doc.add_paragraph(f"Дата: {datetime.now().strftime('%d.%m.%Y %H:%M')}")
    date_para.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_paragraph()

    # Parse and add content
    lines = content.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue
        elif line.startswith('## '):
            doc.add_heading(line[3:], level=2)
        elif line.startswith('# '):
            doc.add_heading(line[2:], level=1)
        elif line.startswith('- '):
            para = doc.add_paragraph(line[2:], style='List Bullet')
        else:
            # Clean markdown
            clean = re.sub(r'\*\*(.*?)\*\*', r'\1', line)
            clean = re.sub(r'\*(.*?)\*', r'\1', clean)
            doc.add_paragraph(clean)

    buffer = io.BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer.read()
