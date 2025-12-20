import io
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


def generate_pdf_report(title: str, content: str, chat_title: str) -> bytes:
    """Generate PDF report from markdown content."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=20*mm, bottomMargin=20*mm)

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name='CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        spaceAfter=12,
    ))
    styles.add(ParagraphStyle(
        name='CustomHeading',
        parent=styles['Heading2'],
        fontSize=14,
        spaceAfter=8,
        spaceBefore=12,
    ))
    styles.add(ParagraphStyle(
        name='CustomBody',
        parent=styles['Normal'],
        fontSize=10,
        spaceAfter=6,
    ))

    story = []

    # Title
    story.append(Paragraph(f"HR Анализ: {chat_title}", styles['CustomTitle']))
    story.append(Paragraph(f"Дата: {datetime.now().strftime('%d.%m.%Y %H:%M')}", styles['CustomBody']))
    story.append(Spacer(1, 12))

    # Parse markdown and add content
    lines = content.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            story.append(Spacer(1, 6))
        elif line.startswith('## '):
            story.append(Paragraph(line[3:], styles['CustomHeading']))
        elif line.startswith('# '):
            story.append(Paragraph(line[2:], styles['CustomTitle']))
        elif line.startswith('**') and line.endswith('**'):
            story.append(Paragraph(f"<b>{line[2:-2]}</b>", styles['CustomBody']))
        elif line.startswith('- '):
            story.append(Paragraph(f"• {line[2:]}", styles['CustomBody']))
        else:
            # Clean markdown formatting
            clean = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', line)
            clean = re.sub(r'\*(.*?)\*', r'<i>\1</i>', clean)
            story.append(Paragraph(clean, styles['CustomBody']))

    doc.build(story)
    buffer.seek(0)
    return buffer.read()


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
