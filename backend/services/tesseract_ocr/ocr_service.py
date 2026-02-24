from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pytesseract
from typing import Optional
import base64
import io
from PIL import Image
import numpy as np


app = FastAPI(title="MUNEEM Tesseract OCR Service")


@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "Tesseract OCR"}


@app.get("/")
def root():
    return {
        "service": "MUNEEM Tesseract OCR Service",
        "engine": "Tesseract 5.x",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "recognize": "/recognize (POST)",
            "docs": "/docs"
        }
    }


class OCRRequest(BaseModel):
    image_base64: str
    target_field: Optional[str] = None


@app.post("/recognize")
def recognize(req: OCRRequest):
    try:
        # Decode base64 image
        img_bytes = base64.b64decode(req.image_base64)
        image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {exc}")

    try:
        # Perform OCR using Tesseract
        text = pytesseract.image_to_string(image, lang='eng+hin')
        
        # Get confidence data
        data = pytesseract.image_to_data(image, lang='eng+hin', output_type=pytesseract.Output.DICT)
        confidences = [float(conf) for conf in data['conf'] if conf != '-1']
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        
        return {
            "text": text.strip(),
            "confidence": avg_conf / 100.0  # Normalize to 0-1 range
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"OCR processing failed: {exc}")
