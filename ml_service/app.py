```python
# ml_service/app.py
# FastAPI service for healthcare waste classification.
# Loads the existing trained Keras model with serialization compatibility fixes.

import os
import json
import zipfile
import tempfile
from io import BytesIO

import numpy as np
import tensorflow as tf
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Healthcare Waste Classification API")


# --------------------------------------------------
# 1. Model path
# --------------------------------------------------

MODEL_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "models",
        "best_waste_model.keras"
    )
)

if not os.path.isfile(MODEL_PATH):
    raise FileNotFoundError(
        f"Model file not found at: {MODEL_PATH}"
    )


# --------------------------------------------------
# 2. Keras serialization compatibility
# --------------------------------------------------

def remove_incompatible_config_keys(obj):
    """
    Remove serialization metadata that may not be supported
    by the installed Keras version.

    This function modifies only the temporary model config.
    The original model file and its learned weights remain unchanged.
    """
    if isinstance(obj, dict):
        obj.pop("quantization_config", None)
        obj.pop("optional", None)

        for value in obj.values():
            remove_incompatible_config_keys(value)

    elif isinstance(obj, list):
        for item in obj:
            remove_incompatible_config_keys(item)


def load_compatible_model(model_path):
    """
    Load the original .keras model using a temporary copy
    with compatibility metadata removed from config.json.
    All other archive contents, including model weights,
    are preserved.
    """
    temp_model_path = None

    try:
        with tempfile.NamedTemporaryFile(
            suffix=".keras",
            delete=False
        ) as temp_file:
            temp_model_path = temp_file.name

        with zipfile.ZipFile(model_path, "r") as source:
            with zipfile.ZipFile(
                temp_model_path,
                "w",
                compression=zipfile.ZIP_DEFLATED
            ) as destination:

                for item in source.infolist():
                    data = source.read(item.filename)

                    if item.filename == "config.json":
                        config = json.loads(data.decode("utf-8"))

                        remove_incompatible_config_keys(config)

                        data = json.dumps(config).encode("utf-8")

                    destination.writestr(item, data)

        loaded_model = tf.keras.models.load_model(
            temp_model_path,
            compile=False
        )

        return loaded_model

    finally:
        if temp_model_path and os.path.exists(temp_model_path):
            os.remove(temp_model_path)


# Load the model once when the service starts.
model = load_compatible_model(MODEL_PATH)

print("Original trained model loaded successfully.")
print("Model input shape:", model.input_shape)
print("Model output shape:", model.output_shape)


# --------------------------------------------------
# 3. Class names
# --------------------------------------------------

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


# --------------------------------------------------
# 4. Response schema
# --------------------------------------------------

class PredictResponse(BaseModel):
    success: bool
    predictedClass: str
    classIndex: int
    confidence: float
    probabilities: dict


# --------------------------------------------------
# 5. Validate model output
# --------------------------------------------------

if model.output_shape[-1] != len(CLASS_NAMES):
    raise RuntimeError(
        f"Model outputs {model.output_shape[-1]} classes, "
        f"but {len(CLASS_NAMES)} class names are configured."
    )


# --------------------------------------------------
# 6. Health endpoint
# --------------------------------------------------

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "model_loaded": True,
        "classes": len(CLASS_NAMES)
    }


# --------------------------------------------------
# 7. Image prediction endpoint
# --------------------------------------------------

@app.post("/predict", response_model=PredictResponse)
async def predict(image: UploadFile = File(...)):

    # Validate the uploaded file's content type.
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Please upload an image."
        )

    # Read uploaded image bytes.
    content = await image.read()

    if not content:
        raise HTTPException(
            status_code=400,
            detail="The uploaded image is empty."
        )

    # Decode and preprocess the image.
    try:
        pil_img = Image.open(BytesIO(content)).convert("RGB")
        pil_img = pil_img.resize((128, 128))

        img_array = np.asarray(pil_img, dtype=np.float32)
        img_batch = np.expand_dims(img_array, axis=0)

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not process image: {str(exc)}"
        )

    # Run inference using the existing trained model.
    try:
        preds = model.predict(img_batch, verbose=0)

        if preds.ndim != 2 or preds.shape[1] != len(CLASS_NAMES):
            raise RuntimeError(
                f"Unexpected prediction output shape: {preds.shape}"
            )

        probs = preds[0].astype(float).tolist()

        class_idx = int(np.argmax(probs))
        confidence = float(probs[class_idx])
        predicted_class = CLASS_NAMES[class_idx]

        prob_map = {
            name: float(probability)
            for name, probability in zip(CLASS_NAMES, probs)
        }

    except Exception as exc:
        print(f"Prediction error: {exc}")

        raise HTTPException(
            status_code=500,
            detail="The model could not classify this image."
        )

    return PredictResponse(
        success=True,
        predictedClass=predicted_class,
        classIndex=class_idx,
        confidence=confidence,
        probabilities=prob_map
    )
```
