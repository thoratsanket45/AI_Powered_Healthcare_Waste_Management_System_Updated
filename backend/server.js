const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const {
  S3Client,
  PutObjectCommand
} = require('@aws-sdk/client-s3');

const mlService = require('./services/mlService');
const crypto = require('crypto');
const path = require('path');
// ================================================================
// LOAD ENVIRONMENT VARIABLES
// ================================================================

dotenv.config();

// ================================================================
// INITIALIZE EXPRESS APP
// ================================================================

const app = express();

// ================================================================
// MIDDLEWARE
// ================================================================

app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ================================================================
// MONGODB CONNECTION
// ================================================================

if (!process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI must be configured');
}

// ================================================================
// ROUTES
// ================================================================

app.use('/api/auth', require('./routes/authRoutes'));

app.use(
  '/api/requests',
  require('./routes/wasteRequestRoutes')
);

// ================================================================
// MULTER CONFIGURATION
// ================================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 20 * 1024 * 1024 // 20 MB
  },

  fileFilter: (req, file, cb) => {

    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file type. Only JPG, JPEG, PNG, GIF and WEBP images are allowed.'
        )
      );
    }
  }
});

// ================================================================
// AWS S3 CONFIGURATION
// ================================================================

const s3Client = new S3Client({
  region: process.env.AWS_REGION,

  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const bucketName = process.env.S3_BUCKET_NAME;

// ================================================================
// GROQ CONFIGURATION
// ================================================================



// ================================================================
// TREATMENT RECOMMENDATIONS
// ================================================================


const treatmentMap = {
  'Pathological Waste':
    'Segregate body tissues and organs in the designated biomedical waste container. Follow applicable biomedical waste disposal procedures.',

  'Glass Waste':
    'Handle carefully to prevent breakage or injury. Segregate uncontaminated glass for appropriate recycling; contaminated medical glass must follow applicable biomedical waste procedures.',

  'Metal Waste':
    'Segregate uncontaminated metal for appropriate recycling. Contaminated medical metal items must be handled according to applicable biomedical waste procedures.',

  'Organic Waste':
    'Segregate uncontaminated organic waste for appropriate composting or organic waste processing. Treat contaminated waste according to applicable biomedical waste procedures.',

  'Plastic Waste':
    'Identify whether the plastic is contaminated. Send only eligible, uncontaminated plastic for appropriate recycling; contaminated medical plastic must follow applicable biomedical waste disposal procedures.',

  'Paper Waste':
    'Segregate clean, uncontaminated paper for recycling. Dispose of contaminated paper and biomedical materials according to applicable biomedical waste procedures.',

  'Sharps Waste':
    'Immediately place needles and other sharps in an approved puncture-proof, leak-resistant sharps container. Never recap, bend, or handle used needles unnecessarily.',

  'Infectious Waste':
    'Segregate potentially infectious materials in the designated biomedical waste container. Use appropriate protective equipment and follow applicable biomedical waste disposal procedures.',

  'Metal Medical Instrument':
    'Handle carefully and assess contamination. Send reusable instruments for validated cleaning and sterilization where appropriate; dispose of damaged or contaminated instruments according to applicable biomedical waste procedures.'
};
```

// ================================================================
// HELPER FUNCTION
// UPLOAD IMAGE BUFFER TO AWS S3
// ================================================================

async function uploadBufferToS3(buffer, originalName, mimeType) {

  const ext = path.extname(originalName).toLowerCase();

  const randomBytes = crypto
    .randomBytes(16)
    .toString('hex');

  const key = `uploads/${randomBytes}${ext}`;

  const uploadParams = {
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: mimeType
  };

  await s3Client.send(
    new PutObjectCommand(uploadParams)
  );

  return `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// ================================================================
// API: CLASSIFY HEALTHCARE WASTE IMAGE
// ================================================================

app.post(
  '/api/classify',
  upload.single('image'),
  async (req, res) => {

    try {

      // ------------------------------------------------------------
      // 1. CHECK WHETHER IMAGE WAS UPLOADED
      // ------------------------------------------------------------

      if (!req.file) {

        return res.status(400).json({
          error: 'No image file sent.'
        });

      }

      console.log(
        'Received file:',
        req.file.originalname
      );

      console.log(
        'File size:',
        req.file.size,
        'bytes'
      );

      console.log(
        'MIME type:',
        req.file.mimetype
      );

      // ------------------------------------------------------------
      // 2. UPLOAD IMAGE TO AWS S3
      // ------------------------------------------------------------

      const imageUrl = await uploadBufferToS3(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      console.log(
        'Image uploaded to S3:',
        imageUrl
      );

      // ------------------------------------------------------------
      // 3. CALL LOCAL ML INFERENCE SERVICE
      // ------------------------------------------------------------

      const mlResponse = await mlService.classifyImage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      if (!mlResponse.success) {
        return res.status(500).json({ error: 'ML inference failed.' });
      }

      const { predictedClass, classIndex, confidence, probabilities } = mlResponse;

      // ------------------------------------------------------------
      // 4. MAP PREDICTION TO HIGH‑LEVEL WASTE CATEGORY
      // ------------------------------------------------------------
      const classToCategoryMap = {
  '(BT) Body Tissue or Organ': 'Pathological Waste',
  '(GE) Glass equipment-packaging 551': 'Glass Waste',
  '(ME) Metal equipment -packaging': 'Metal Waste',
  '(OW) Organic wastes': 'Organic Waste',
  '(PE) Plastic equipment-packaging': 'Plastic Waste',
  '(PP) Paper equipment-packaging': 'Paper Waste',
  '(SN) Syringe needles': 'Sharps Waste',
  'Gauze': 'Infectious Waste',
  'Gloves': 'Infectious Waste',
  'Mask': 'Infectious Waste',
  'Syringe': 'Sharps Waste',
  'Tweezers': 'Metal Medical Instrument'
};

const wasteCategory = classToCategoryMap[predictedClass] || 'Unknown';

      // ------------------------------------------------------------
      // 5. GET TREATMENT METHOD FROM EXISTING MAP
      // ------------------------------------------------------------
     const treatment = treatmentMap[wasteCategory]
  ? [treatmentMap[wasteCategory]]
  : ['No treatment recommendation available. Please consult your facility waste management protocol.'];

      // ------------------------------------------------------------
      // 6. SEND RESULT TO FRONTEND
      // ------------------------------------------------------------
      return res.json({
        label: wasteCategory,
        modelPrediction: predictedClass,
        classIndex: classIndex,
        confidence: confidence,
        probabilities: probabilities,
        treatment: treatment,
        imageUrl: imageUrl
      });

    } catch (err) {

      console.error(
        'Error in /api/classify:',
        err
      );

      // ------------------------------------------------------------
      // HANDLE MULTER FILE SIZE ERROR
      // ------------------------------------------------------------

      if (err.code === 'LIMIT_FILE_SIZE') {

        return res.status(400).json({
          error:
            'Image is too large. Maximum allowed size is 20 MB.'
        });

      }

      // ------------------------------------------------------------
      // HANDLE INVALID FILE TYPE
      // ------------------------------------------------------------

      if (
        err.message &&
        err.message.startsWith('Invalid file type')
      ) {

        return res.status(400).json({
          error: err.message
        });

      }

      // ------------------------------------------------------------
      // HANDLE GROQ BAD REQUEST
      // ------------------------------------------------------------

      if (err.status === 400) {

        return res.status(400).json({
          error:
            err.error?.error?.message ||
            err.message ||
            'Groq rejected the request.'
        });

      }

      // ------------------------------------------------------------
      // GENERAL ERROR
      // ------------------------------------------------------------

      return res.status(500).json({
        error: 'Classification failed.'
      });
    }
  }
);

// ================================================================
// ERROR HANDLING MIDDLEWARE
// ================================================================

app.use(
  (err, req, res, next) => {

    console.error(
      err.stack
    );

    res.status(500).json({

      message: 'Server error',

      error:
        process.env.NODE_ENV === 'production'
          ? 'An error occurred'
          : err.message
    });
  }
);

// ================================================================
// START SERVER
// ================================================================

const PORT =
  process.env.PORT || 5000;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
