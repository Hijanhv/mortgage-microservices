const express = require('express');
const AWS = require('aws-sdk');
const winston = require('winston');
const db = require('../common/db');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3003;

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

// SQS configuration
const sqs = new AWS.SQS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.SQS_ENDPOINT,
});

const DOC_VERIFICATION_QUEUE_URL = process.env.DOC_VERIFICATION_QUEUE_URL;
const ELIGIBILITY_QUEUE_URL = process.env.ELIGIBILITY_QUEUE_URL;

// Mock document verification logic
const verifyDocuments = async (loanId) => {
  logger.info(`Verifying documents for loan ${loanId}`);

  // Simulate document verification
  // Mock: 90% pass, 10% fail
  const isVerified = Math.random() < 0.9;

  logger.info(`Document verification result for loan ${loanId}: ${isVerified ? 'PASSED' : 'FAILED'}`);

  return isVerified;
};

// Process SQS message
const processMessage = async (message) => {
  try {
    const body = JSON.parse(message.Body);
    logger.info('Processing message:', body);

    const { loanId, userId, action } = body;

    if (action === 'VERIFY_DOCUMENTS') {
      // Verify documents
      const isVerified = await verifyDocuments(loanId);

      // Update loan status
      const newStatus = isVerified ? 'VERIFIED' : 'VERIFICATION_FAILED';
      await db.query(
        'UPDATE loans SET status = ? WHERE id = ?',
        [newStatus, loanId]
      );

      logger.info(`Loan ${loanId} status updated to ${newStatus}`);

      // If verified, send to eligibility queue
      if (isVerified) {
        try {
          await sqs.sendMessage({
            QueueUrl: ELIGIBILITY_QUEUE_URL,
            MessageBody: JSON.stringify({
              loanId,
              userId,
              action: 'CHECK_ELIGIBILITY',
              timestamp: new Date().toISOString(),
            }),
          }).promise();

          logger.info(`Document verified for loan ${loanId}, sent to eligibility queue`);
        } catch (sqsError) {
          logger.error(`Failed to send eligibility message for loan ${loanId}:`, sqsError);
          throw sqsError;
        }
      } else {
        logger.warn(`Document verification failed for loan ${loanId}`);
      }

      // Delete message from queue
      return { id: message.ReceiptHandle, success: true };
    }

    logger.warn(`Unknown action: ${action}`);
    return { id: message.ReceiptHandle, success: false };
  } catch (error) {
    logger.error('Error processing message:', error);
    return { id: message.ReceiptHandle, success: false };
  }
};

// SQS consumer loop
const startSQSConsumer = async () => {
  logger.info('Starting SQS consumer for doc-verification-queue');

  const pollMessages = async () => {
    try {
      const params = {
        QueueUrl: DOC_VERIFICATION_QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20, // Long polling
      };

      const data = await sqs.receiveMessage(params).promise();

      if (data.Messages && data.Messages.length > 0) {
        logger.info(`Received ${data.Messages.length} messages from queue`);

        for (const message of data.Messages) {
          const result = await processMessage(message);

          if (result.success) {
            // Delete message from queue
            try {
              await sqs.deleteMessage({
                QueueUrl: DOC_VERIFICATION_QUEUE_URL,
                ReceiptHandle: result.id,
              }).promise();

              logger.info('Message deleted from queue');
            } catch (deleteError) {
              logger.error('Error deleting message from queue:', deleteError);
            }
          }
        }
      } else {
        logger.debug('No messages received from queue');
      }

      // Continue polling
      setTimeout(pollMessages, 1000);
    } catch (error) {
      logger.error('SQS consumer error:', error);
      setTimeout(pollMessages, 5000); // Retry after 5 seconds
    }
  };

  pollMessages();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'Document verification service is running' });
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
};

app.use(errorHandler);

// Initialization and server startup
const startServer = async () => {
  try {
    await db.initialize({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'mortgage',
      password: process.env.DB_PASSWORD || 'mortgage',
      database: process.env.DB_NAME || 'mortgage',
    });

    app.listen(PORT, () => {
      logger.info(`Document verification service listening on port ${PORT}`);
    });

    // Start SQS consumer
    startSQSConsumer();
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
