// backend/services/mlService.js
// Simple wrapper to call the local TensorFlow inference service.
// Expects the service to expose a POST /predict endpoint that accepts
// multipart/form-data with the image file.

const axios = require('axios');
const FormData = require('form-data');

// Environment variable for inference URL (default matches implementation plan).
const INFERENCE_URL = process.env.ML_INFERENCE_URL || 'http://localhost:8001/predict';

/**
 * Sends an image buffer to the inference service and returns the parsed JSON.
 * @param {Buffer} buffer - Image buffer from Multer.
 * @param {string} filename - Original filename.
 * @param {string} mimetype - MIME type of the image.
 * @returns {Promise<Object>} The JSON response from the inference service.
 */
async function classifyImage(buffer, filename, mimetype) {
  const form = new FormData();
  form.append('image', buffer, {
    filename: filename,
    contentType: mimetype,
  });

  const response = await axios.post(INFERENCE_URL, form, {
    headers: form.getHeaders(),
    timeout: 15000, // 15 seconds timeout for inference request
  });

  return response.data;
}

module.exports = {
  classifyImage,
};
