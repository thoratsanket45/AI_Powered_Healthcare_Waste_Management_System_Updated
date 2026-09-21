# ml_service/app.py
# FastAPI service that loads the custom TensorFlow/Keras model and provides
# health and prediction endpoints.

import os
from fastapi import FastAPI, File, UploadFile, HTTPException
from pydantic import BaseModel
import numpy as np
from PIL import Image
import tensorflow as tf
from io import BytesIO

app = FastAPI()

# Load model once at startup
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "best_waste_model.keras")
if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(f"Model file not found at {MODEL_PATH}")

model = tf.keras.models.load_model(MODEL_PATH)

# The model outputs 12 classes in a fixed order (as documented in the project).
CLASS_NAMES = [
    "(BT) Body Tissue or Organ",
    "(GE) Glass equipment-packaging 551",
    "(ME) Metal equipment -packaging",
    "(OW) Organic wastes",
    "(PE) Plastic equipment-packaging",
    "(PP) Paper equipment-packaging",
    "(SN) Syringe needles",
    "Gauze",
    "Gloves",
    "Mask",
    "Syringe",
    "Tweezers",
]

class PredictResponse(BaseModel):
    success: bool
    predictedClass: str
    classIndex: int
    confidence: float
    probabilities: dict

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/predict", response_model=PredictResponse)
async def predict(image: UploadFile = File(...)):
    # Validate MIME type
    if not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid file type")

    # Read image bytes
    content = await image.read()
    try:
        pil_img = Image.open(BytesIO(content)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not process image")

    # Preprocess: resize to 128x128, convert to NumPy array with float32 dtype, add batch dimension
    pil_img = pil_img.resize((128, 128))
    img_array = np.array(pil_img, dtype=np.float32)
    img_batch = np.expand_dims(img_array, axis=0)

    # Perform prediction
    preds = model.predict(img_batch)
    probs = preds[0].tolist()
    class_idx = int(np.argmax(probs))
    confidence = float(probs[class_idx])
    predicted_class = CLASS_NAMES[class_idx]

    prob_map = {name: float(p) for name, p in zip(CLASS_NAMES, probs)}

    return PredictResponse(
        success=True,
        predictedClass=predicted_class,
        classIndex=class_idx,
        confidence=confidence,
        probabilities=prob_map,
    )
