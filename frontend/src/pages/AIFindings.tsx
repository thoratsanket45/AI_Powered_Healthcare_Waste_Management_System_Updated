
import React, { useState } from 'react';
import api, { wasteRequestService } from '../services/api';

// Maps the AI's detailed label to the broad waste types
// accepted by the backend WasteRequest schema.
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
      return 'general';

    default:
      return 'general';
  }
}

interface ClassificationResponse {
  label: string;
  modelPrediction: string;
  classIndex: number;
  confidence: number;
  probabilities: Record<string, number>;
  treatment: string | string[];
  imageUrl: string;
}

interface WasteRequestForm {
  wasteType: string;
  specialInstructions: string;
  quantity: string;
  unit: string;
  department: string;
  urgency: string;
}

export function AIFindings() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [predictedType, setPredictedType] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [treatment, setTreatment] = useState<string | string[]>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const [formData, setFormData] = useState<WasteRequestForm>({
    wasteType: '',
    specialInstructions: '',
    quantity: '',
    unit: 'kg',
    department: '',
    urgency: 'medium',
  });

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];

    if (!selectedFile) return;

    setFile(selectedFile);

    // Release the previous preview URL to avoid unnecessary memory use.
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewUrl(URL.createObjectURL(selectedFile));

    // Clear results belonging to the previous image.
    setPredictedType('');
    setConfidence(null);
    setTreatment('');
    setMessage(null);
    setIsError(false);
  }

  async function classifyImage() {
    if (!file) return;

    setLoading(true);
    setMessage(null);
    setIsError(false);

    // Do not display stale results if this classification fails.
    setPredictedType('');
    setConfidence(null);
    setTreatment('');

    try {
      const data = new FormData();
      data.append('image', file);

      console.log('Uploading file:', file.name, file.type);

      const resp = await api.post<ClassificationResponse>(
        '/classify',
        data
      );

      const {
        label,
        confidence: returnedConfidence,
        treatment: returnedTreatment,
      } = resp.data;

      // Store the predicted waste category.
      setPredictedType(label);

      // Store confidence only when the backend returns a valid number.
      setConfidence(
        typeof returnedConfidence === 'number' &&
          Number.isFinite(returnedConfidence)
          ? returnedConfidence
          : null
      );

      // Preserve treatment recommendations returned by the backend.
      setTreatment(returnedTreatment ?? '');

      const treatmentText = Array.isArray(returnedTreatment)
        ? returnedTreatment.join('\n- ')
        : returnedTreatment || 'No treatment recommendation available.';

      // Update the disposal request form with the AI result.
      setFormData((prev) => ({
        ...prev,
        wasteType: mapAiLabelToSchemaType(label),
        specialInstructions:
          `Recommended:\n- ${treatmentText}\n\n(AI detected: ${label})`,
      }));
    } catch (err) {
      console.error('Image classification error:', err);

      setIsError(true);
      setMessage('⚠️ Classification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function submitRequest() {
    if (
      !formData.wasteType ||
      !formData.quantity ||
      !formData.unit ||
      !formData.department
    ) {
      setIsError(true);
      setMessage(
        '⚠️ Please fill in Waste Type, Quantity, Unit, and Department before submitting.'
      );
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

        setMessage(
          `✅ Request submitted successfully. Request ID: ${
            response.requestId ?? ''
          }`
        );

        // Reset the form after successful submission.
        setFormData({
          wasteType: '',
          specialInstructions: '',
          quantity: '',
          unit: 'kg',
          department: '',
          urgency: 'medium',
        });

        setFile(null);

        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }

        setPreviewUrl('');
        setPredictedType('');
        setConfidence(null);
        setTreatment('');
      } else {
        throw new Error(response.message || 'Request failed');
      }
    } catch (err: any) {
      console.error('Submit request error:', err);

      setIsError(true);

      const backendMessage = err?.response?.data?.message;

      setMessage(
        `⚠️ ${
          backendMessage ||
          'Failed to submit request. Please try again.'
        }`
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-8">
        Create Waste Disposal Request
      </h1>

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
        {/* Left Column: Image Upload and Classification */}
        <div className="bg-white p-6 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">
            Waste Image Analysis
          </h2>

          <div className="space-y-6">
            {/* Image Upload */}
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
              <label className="block mb-2">
                <span className="text-gray-700 font-medium">
                  Upload Waste Image
                </span>

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
                ${
                  !file || loading
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
                }`}
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 10H0c0 3.042 1.135 5.824 3 7.938l-2.647z"
                    />
                  </svg>
                  Analyzing...
                </span>
              ) : (
                'Analyze Waste Image'
              )}
            </button>

            {/* Analysis Results */}
            {predictedType && (
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">
                  Analysis Results
                </h3>

                <div className="space-y-3">
                  {/* Predicted Waste Type */}
                  <div className="flex flex-wrap">
                    <span className="font-medium text-gray-700 w-32">
                      Waste Type:
                    </span>
                    <span className="text-gray-800">
                      {predictedType}
                    </span>
                  </div>

                  {/* Model Confidence */}
                  <div className="flex flex-wrap">
                    <span className="font-medium text-gray-700 w-32">
                      Confidence:
                    </span>

                    <span className="text-gray-800">
                      {confidence !== null
                        ? `${(confidence * 100).toFixed(1)}%`
                        : 'Not available'}
                    </span>
                  </div>

                  {/* Treatment Recommendation */}
                  <div className="flex items-start">
                    <span className="font-medium text-gray-700 w-32">
                      Treatment:
                    </span>

                    <div className="flex-1">
                      {Array.isArray(treatment) ? (
                        <ul className="list-disc list-inside space-y-1">
                          {treatment.map((item, index) => (
                            <li
                              key={index}
                              className="text-gray-800"
                            >
                              {item}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-gray-800">
                          {treatment || 'No treatment recommendation available.'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Disposal Request Details */}
        <div className="bg-white p-6 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">
            Disposal Request Details
          </h2>

          <div className="space-y-6">
            {/* Waste Type */}
            <div>
              <label className="block text-gray-700 font-medium mb-2">
                Waste Type
              </label>

              <select
                value={formData.wasteType}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    wasteType: e.target.value,
                  })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select waste type</option>
                <option value="biohazardous">
                  Biohazardous (infectious / sharps / pathological)
                </option>
                <option value="pharmaceutical">
                  Pharmaceutical
                </option>
                <option value="chemical">
                  Chemical (incl. radioactive)
                </option>
                <option value="general">
                  General (non-hazardous)
                </option>
              </select>
            </div>

            {/* Quantity and Unit */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 font-medium mb-2">
                  Quantity
                </label>

                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={formData.quantity}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      quantity: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. 5"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-2">
                  Unit
                </label>

                <select
                  value={formData.unit}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      unit: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="kg">kg</option>
                  <option value="liters">liters</option>
                  <option value="units">units</option>
                  <option value="bags">bags</option>
                </select>
              </div>
            </div>

            {/* Department and Urgency */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 font-medium mb-2">
                  Department
                </label>

                <input
                  type="text"
                  value={formData.department}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      department: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. ICU"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-2">
                  Urgency
                </label>

                <select
                  value={formData.urgency}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      urgency: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>

            {/* Special Instructions */}
            <div>
              <label className="block text-gray-700 font-medium mb-2">
                Special Instructions
              </label>

              <textarea
                rows={8}
                value={formData.specialInstructions}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    specialInstructions: e.target.value,
                  })
                }
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter special handling instructions, safety precautions, or additional details about the waste..."
              />

              <p className="mt-1 text-sm text-gray-500">
                Include relevant details about quantity, storage conditions,
                or specific hazards.
              </p>
            </div>

            {/* Submit Request */}
            <div className="pt-4">
              <button
                onClick={submitRequest}
                disabled={submitting}
                className={`w-full py-3 px-4 font-medium rounded-lg shadow-md transition-all
                  ${
                    submitting
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700 text-white hover:shadow-lg'
                  }`}
              >
                {submitting
                  ? 'Submitting...'
                  : 'Submit Disposal Request'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
