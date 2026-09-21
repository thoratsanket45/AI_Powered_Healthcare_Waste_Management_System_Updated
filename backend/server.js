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
const dns = require('dns');

// ================================================================
// FIX WINDOWS/NODE DNS SRV LOOKUP ISSUES WITH MONGODB ATLAS
// ================================================================
// Node's built-in resolver can fail to resolve mongodb+srv:// records
// on some Windows networks even though the OS resolver works fine.
// Forcing public DNS servers here fixes that.

dns.setServers(['8.8.8.8', '1.1.1.1']);

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

// ================================================================
// MONGODB CONNECTION
// ================================================================

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });

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

  "infectious waste":
    "Use autoclaving or incineration to neutralize pathogens.",

  "sharps waste":
    "Disinfect using appropriate sterilization procedures and place in puncture-resistant sharps containers before authorized disposal.",

  "pathological waste":
    "Incineration or another authorized treatment method is generally preferred due to organic content.",

  "pharmaceutical waste":
    "Use authorized pharmaceutical waste collection, return-to-supplier programs where applicable, encapsulation, or appropriate high-temperature treatment.",

  "chemical waste":
    "Use appropriate neutralization or specialized chemical waste treatment according to the chemical involved.",

  "radioactive waste":
    "Store in appropriate shielded containers and follow applicable radiation safety and regulatory protocols.",

  "non-hazardous general waste":
    "Use standard municipal disposal or an authorized sanitary landfill/recycling route where appropriate."
};

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
        '(GE) Glass equipment-packaging 551': 'Recyclable Waste',
        '(ME) Metal equipment -packaging': 'Recyclable Waste',
        '(OW) Organic wastes': 'Pathological Waste',
        '(PE) Plastic equipment-packaging': 'Recyclable Waste',
        '(PP) Paper equipment-packaging': 'Recyclable Waste',
        '(SN) Syringe needles': 'Sharps Waste',
        'Gauze': 'Infectious Waste',
        'Gloves': 'Infectious Waste',
        'Mask': 'Infectious Waste',
        'Syringe': 'Sharps Waste',
        'Tweezers': 'Recyclable Waste'
      };

      const wasteCategory = classToCategoryMap[predictedClass] || 'Unknown';

      // ------------------------------------------------------------
      // 5. GET TREATMENT METHOD FROM EXISTING MAP
      // ------------------------------------------------------------
      const treatmentKey = wasteCategory.toLowerCase();
      let treatment = [];
      if (treatmentMap[treatmentKey]) {
        treatment = [treatmentMap[treatmentKey]];
      }

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

app.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );
  }
);