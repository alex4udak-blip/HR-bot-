"""Endpoint to download the Chrome extension as a ZIP file."""

import io
import zipfile
from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()

EXTENSION_DIR = Path(__file__).resolve().parent.parent.parent.parent / "chrome-extension"


@router.get("/download")
async def download_extension():
    """Package chrome-extension/ folder into a ZIP and return it."""
    if not EXTENSION_DIR.exists():
        from fastapi import HTTPException
        raise HTTPException(404, "Extension files not found on server")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(EXTENSION_DIR.rglob("*")):
            if file_path.is_file() and not file_path.name.startswith("."):
                arcname = f"enceladus-magic-button/{file_path.relative_to(EXTENSION_DIR)}"
                zf.write(file_path, arcname)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": "attachment; filename=enceladus-magic-button.zip",
        },
    )
