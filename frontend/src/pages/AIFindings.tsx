import React, { useState } from 'react';
import axios from 'axios';
import { wasteRequestService } from '../services/api';

// The AI classifier returns one of 7 detailed categories, but the
// backend's WasteRequest schema only accepts 4 broad enum values:
// 'biohazardous', 'pharmaceutical', 'chemical', 'general'.
// This maps the AI's label onto the schema's allowed values.
function mapAiLabelToSchemaType(label: string): string {
  const normalized = (label || '').toLowerCase().trim();
  switch (normalized) {
    case 'infectious waste':
    case 'sharps waste':
    case 'pathological waste':
      return 'biohazardous';
    case 'pharmaceutical waste':
      return 'pharmaceutical';
    case 'chemical waste':
    case 'radioactive waste':
      return 'chemical';
    case 'non-hazardous general waste':
    default:
      return 'general';
  }
}

export function AIFindings() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [predictedType, setPredictedType] = useState('');
  const [treatment, setTreatment] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [isError, setIsError] = useState(false);
  const [formData, setFormData] = useState({
    wasteType: '',
    specialInstructions: '',
    quantity: '',
    unit: 'kg',
    department: '',
    urgency: 'medium',
  });

  function onFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setMessage(null);
  }

  async function classifyImage() {
    if (!file) return;
    setLoading(true);
    setMessage(null);

    try {
      const data = new FormData();
      data.append('image', file);
      console.log('Uploading file:', file.name, file.type);

            // Expect extended response from the new ML inference flow
      const resp = await axios.post<{
        label: string;
        modelPrediction: string;
        classIndex: number;
        confidence: number;
        probabilities: Record<string, number>;
        treatment: string | string[];
        imageUrl: string;
      }>(
        'http://localhost:5000/api/classify',
        data,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      );

      const {
        label,
        modelPrediction,
        classIndex,
        confidence,
        probabilities,
        treatment,
        imageUrl,
      } = resp.data;

      // Store detailed prediction info (optional UI display)
      setPredictedType(label);
      setTreatment(Array.isArray(treatment) ? treatment.join(', ') : treatment);

      setFormData((prev) => ({
        ...prev,
        wasteType: mapAiLabelToSchemaType(label),
        specialInstructions: Array.isArray(treatment)
          ? `Recommended:\n- ${treatment.join('\n- ')}\n\n(AI detected: ${label})`
          : `Recommended: ${treatment}\n\n(AI detected: ${label})`,
      }));
    } catch (err) {
      console.error(err);
      setIsError(true);
      setMessage('⚠️ Classification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function submitRequest() {
    // Basic validation to match backend's required fields
    if (!formData.wasteType || !formData.quantity || !formData.unit || !formData.department) {
      setIsError(true);
      setMessage('⚠️ Please fill in Waste Type, Quantity, Unit, and Department before submitting.');
      return;
    }

    setSubmitting(true);
    setIsError(false);
    setMessage(null);

    try {
      const response = await wasteRequestService.createRequest({
        wasteType: formData.wasteType,
        quantity: Number(formData.quantity),
        unit: formData.unit,
        department: formData.department,
        urgency: formData.urgency,
        instructions: formData.specialInstructions,
      });

      if (response.success) {
        setIsError(false);
        setMessage(`✅ Request submitted successfully. Request ID: ${response.requestId ?? ''}`);
        // Reset form after a successful submission
        setFormData({
          wasteType: '',
          specialInstructions: '',
          quantity: '',
          unit: 'kg',
          department: '',
          urgency: 'medium',
        });
        setFile(null);
        setPreviewUrl('');
        setPredictedType('');
        setTreatment('');
      } else {
        throw new Error(response.message || 'Request failed');
      }
    } catch (err: any) {
      console.error('Submit request error:', err);
      setIsError(true);
      const backendMessage = err?.response?.data?.message;
      setMessage(`⚠️ ${backendMessage || 'Failed to submit request. Please try again.'}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-8">Create Waste Disposal Request</h1>

      {message && (
        <div
          className={`mb-6 p-4 rounded border-l-4 ${
            isError
              ? 'bg-red-100 border-red-500 text-red-700'
              : 'bg-yellow-100 border-yellow-500 text-yellow-700'
          }`}
        >
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Image Upload and Classification */}
        <div className="bg-white p-6 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">Waste Image Analysis</h2>

          <div className="space-y-6">
            {/* Image Upload */}
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
              <label className="block mb-2">
                <span className="text-gray-700 font-medium">Upload Waste Image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onFileChange}
                  className="block w-full mt-1 text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100"
                />
              </label>

              {previewUrl && (
                <div className="mt-4 flex justify-center">
                  <img
                    src={previewUrl}
                    alt="Waste preview"
                    className="max-h-64 rounded-lg object-contain border border-gray-200"
                  />
                </div>
              )}
            </div>

            {/* Classification Button */}
            <button
              onClick={classifyImage}
              disabled={!file || loading}
              className={`w-full py-3 px-4 rounded-lg font-medium transition-all
                ${!file || loading ? 'bg-gray-300 text-gray-500 cursor-not-allowed' :
                  'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'}`}
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Analyzing...
                </span>
              ) : 'Analyze Waste Image'}
            </button>

            {/* Results */}
            {predictedType && (
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">Analysis Results</h3>
                <div className="space-y-2">
                  <div className="flex">
                    <span className="font-medium text-gray-700 w-32">Waste Type:</span>
                    <span className="text-gray-800">{predictedType}</span>
                  </div>
                  <div className="flex items-start">
                    <span className="font-medium text-gray-700 w-32">Treatment:</span>
                    <div className="flex-1">
                      {Array.isArray(treatment) ? (
                        <ul className="list-disc list-inside space-y-1">
                          {treatment.map((item, i) => (
                            <li key={i} className="text-gray-800">{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-gray-800">{treatment}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Form Fields */}
        <div className="bg-white p-6 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">Disposal Request Details</h2>

          <div className="space-y-6">
            <div>
              <label className="block text-gray-700 font-medium mb-2">Waste Type</label>
              <select
                value={formData.wasteType}
                onChange={(e) => setFormData({ ...formData, wasteType: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select waste type</option>
                <option value="biohazardous">Biohazardous (infectious / sharps / pathological)</option>
                <option value="pharmaceutical">Pharmaceutical</option>
                <option value="chemical">Chemical (incl. radioactive)</option>
                <option value="general">General (non-hazardous)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 font-medium mb-2">Quantity</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. 5"
                />
              </div>
              <div>
                <label className="block text-gray-700 font-medium mb-2">Unit</label>
                <select
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="kg">kg</option>
                  <option value="liters">liters</option>
                  <option value="units">units</option>
                  <option value="bags">bags</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 font-medium mb-2">Department</label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. ICU"
                />
              </div>
              <div>
                <label className="block text-gray-700 font-medium mb-2">Urgency</label>
                <select
                  value={formData.urgency}
                  onChange={(e) => setFormData({ ...formData, urgency: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-gray-700 font-medium mb-2">Special Instructions</label>
              <textarea
                rows={8}
                value={formData.specialInstructions}
                onChange={(e) => setFormData({ ...formData, specialInstructions: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter any special handling instructions, safety precautions, or additional details about the waste..."
              />
              <p className="mt-1 text-sm text-gray-500">
                Include any relevant details about quantity, storage conditions, or specific hazards.
              </p>
            </div>

            <div className="pt-4">
              <button
                onClick={submitRequest}
                disabled={submitting}
                className={`w-full py-3 px-4 font-medium rounded-lg shadow-md transition-all
                  ${submitting
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700 text-white hover:shadow-lg'}`}
              >
                {submitting ? 'Submitting...' : 'Submit Disposal Request'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
