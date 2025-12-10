const express = require('express');
const bodyParser = require('body-parser');
const AWS = require('aws-sdk');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const jwt = require('jsonwebtoken');
const db = require('../common/db');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

app.use(bodyParser.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

app.use(limiter);

// SQS configuration
const sqs = new AWS.SQS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.SQS_ENDPOINT,
});

const DOC_VERIFICATION_QUEUE_URL = process.env.DOC_VERIFICATION_QUEUE_URL;

// Validation schemas
const createLoanSchema = Joi.object({
  userId: Joi.number().integer().required(),
  loanAmount: Joi.number().positive().required(),
  propertyAddress: Joi.string().required(),
});

const updateLoanSchema = Joi.object({
  loanAmount: Joi.number().positive().optional(),
  propertyAddress: Joi.string().optional(),
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Validation middleware
const validateRequest = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    logger.warn('Validation error:', error.details);
    return res.status(400).json({ error: error.details[0].message });
  }
  req.validatedBody = value;
  next();
};

// Helper to send SQS message
const sendSQSMessage = async (queueUrl, messageBody) => {
  try {
    const params = {
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(messageBody),
    };
    await sqs.sendMessage(params).promise();
    logger.info('SQS message sent:', messageBody);
  } catch (error) {
    logger.error('Error sending SQS message:', error);
    throw error;
  }
};

// Get all loans
app.get('/loans', async (req, res, next) => {
  try {
    logger.info('Fetching all loans');
    const loans = await db.query(
      'SELECT id, userId, loanAmount, propertyAddress, status, createdAt FROM loans'
    );
    res.json(loans);
  } catch (error) {
    logger.error('Error fetching loans:', error);
    next(error);
  }
});

// Get single loan
app.get('/loans/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid loan ID' });
    }

    logger.info(`Fetching loan: ${id}`);

    const loans = await db.query(
      'SELECT id, userId, loanAmount, propertyAddress, status, createdAt FROM loans WHERE id = ?',
      [id]
    );

    if (loans.length === 0) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    res.json(loans[0]);
  } catch (error) {
    logger.error('Error fetching loan:', error);
    next(error);
  }
});

// Create new loan
app.post('/loans', validateRequest(createLoanSchema), async (req, res, next) => {
  try {
    const { userId, loanAmount, propertyAddress } = req.validatedBody;

    logger.info(`Creating loan for user: ${userId}, amount: ${loanAmount}`);

    // Verify user exists
    const users = await db.query(
      'SELECT id FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      logger.warn(`User not found: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Insert loan
    const result = await db.query(
      'INSERT INTO loans (userId, loanAmount, propertyAddress, status, createdAt) VALUES (?, ?, ?, ?, NOW())',
      [userId, loanAmount, propertyAddress, 'PENDING_VERIFICATION']
    );

    const loanId = result.insertId;

    // Send message to SQS for document verification
    try {
      await sendSQSMessage(DOC_VERIFICATION_QUEUE_URL, {
        loanId,
        userId,
        action: 'VERIFY_DOCUMENTS',
        timestamp: new Date().toISOString(),
      });
    } catch (sqsError) {
      logger.error('Failed to send SQS message, but loan created:', sqsError);
      // Note: Consider whether to fail the loan creation if SQS fails
    }

    logger.info(`Loan created successfully: ${loanId}`);

    res.status(201).json({
      message: 'Loan created successfully',
      loanId,
      status: 'PENDING_VERIFICATION',
    });
  } catch (error) {
    logger.error('Error creating loan:', error);
    next(error);
  }
});

// Update loan
app.put('/loans/:id', validateRequest(updateLoanSchema), async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid loan ID' });
    }

    const updateFields = [];
    const updateValues = [];

    const { loanAmount, propertyAddress } = req.validatedBody;

    if (loanAmount !== undefined) {
      updateFields.push('loanAmount = ?');
      updateValues.push(loanAmount);
    }

    if (propertyAddress !== undefined) {
      updateFields.push('propertyAddress = ?');
      updateValues.push(propertyAddress);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateValues.push(id);

    logger.info(`Updating loan: ${id}`);

    await db.query(
      `UPDATE loans SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    logger.info(`Loan updated successfully: ${id}`);

    res.json({ message: 'Loan updated successfully' });
  } catch (error) {
    logger.error('Error updating loan:', error);
    next(error);
  }
});

// Delete loan
app.delete('/loans/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid loan ID' });
    }

    logger.info(`Deleting loan: ${id}`);

    // Check if loan exists
    const loans = await db.query('SELECT id FROM loans WHERE id = ?', [id]);
    if (loans.length === 0) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    await db.query('DELETE FROM loans WHERE id = ?', [id]);

    logger.info(`Loan deleted successfully: ${id}`);

    res.json({ message: 'Loan deleted successfully' });
  } catch (error) {
    logger.error('Error deleting loan:', error);
    next(error);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Loan service is running' });
});

// Apply error handler middleware
app.use(errorHandler);

// Initialize database and start server
const startServer = async () => {
  try {
    await db.initialize({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'mortgage',
      password: process.env.DB_PASSWORD || 'mortgage',
      database: process.env.DB_NAME || 'mortgage',
    });

    app.listen(PORT, () => {
      logger.info(`Loan service listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  await db.close();
  process.exit(0);
});
