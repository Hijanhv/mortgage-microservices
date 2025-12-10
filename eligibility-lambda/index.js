const AWS = require('aws-sdk');
const mysql = require('mysql2/promise');

const sqs = new AWS.SQS();
const sns = new AWS.SNS();

// Logger
const log = {
  info: (message, data) => console.log(JSON.stringify({ level: 'info', message, data, timestamp: new Date().toISOString() })),
  error: (message, error) => console.error(JSON.stringify({ level: 'error', message, error: error.message, timestamp: new Date().toISOString() })),
  warn: (message, data) => console.warn(JSON.stringify({ level: 'warn', message, data, timestamp: new Date().toISOString() })),
};

// Mock eligibility calculation rules
const calculateEligibility = async (loanData) => {
  // Simplified eligibility rules:
  // - Loan amount should be reasonable (e.g., < $1M)
  // - Mock debt-to-income check
  // - Mock credit score simulation

  const { loanAmount } = loanData;

  if (!loanAmount || loanAmount <= 0) {
    throw new Error('Invalid loan amount');
  }

  // Mock: 70% approve, 30% reject
  const isEligible = Math.random() < 0.7 && loanAmount < 1000000;

  const reason = isEligible
    ? 'Approved based on eligibility rules'
    : loanAmount >= 1000000
      ? 'Loan amount exceeds maximum threshold'
      : 'Does not meet eligibility criteria';

  return {
    eligible: isEligible,
    reason,
  };
};

// Get database connection
const getDbConnection = async () => {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'mortgage',
      password: process.env.DB_PASSWORD || 'mortgage',
      database: process.env.DB_NAME || 'mortgage',
    });
    log.info('Database connection established');
    return connection;
  } catch (error) {
    log.error('Failed to establish database connection', error);
    throw error;
  }
};

// Lambda handler
exports.handler = async (event) => {
  log.info('Eligibility Lambda triggered with event', { recordCount: event.Records?.length });

  let connection;
  const processedRecords = [];
  const failedRecords = [];

  try {
    connection = await getDbConnection();

    // Process each SQS record
    for (const record of event.Records) {
      try {
        const body = JSON.parse(record.body);
        log.info('Processing message', { loanId: body.loanId, action: body.action });

        const { loanId, userId, action } = body;

        if (!loanId || !action) {
          throw new Error('Missing required fields: loanId, action');
        }

        if (action === 'CHECK_ELIGIBILITY') {
          // Fetch loan details from database
          const [loans] = await connection.execute(
            'SELECT id, loanAmount, status FROM loans WHERE id = ?',
            [loanId]
          );

          if (loans.length === 0) {
            log.warn(`Loan ${loanId} not found in database`);
            failedRecords.push({ recordId: record.messageId, reason: 'Loan not found' });
            continue;
          }

          const loan = loans[0];

          // Check eligibility
          const eligibilityResult = await calculateEligibility({
            loanAmount: loan.loanAmount,
          });

          // Update loan status based on eligibility
          const newStatus = eligibilityResult.eligible ? 'APPROVED' : 'REJECTED';
          await connection.execute(
            'UPDATE loans SET status = ? WHERE id = ?',
            [newStatus, loanId]
          );

          log.info(`Loan ${loanId} status updated to ${newStatus}`, { reason: eligibilityResult.reason });

          // If approved, publish to SNS
          if (eligibilityResult.eligible && process.env.LOAN_APPROVED_TOPIC_ARN) {
            try {
              const snsParams = {
                TopicArn: process.env.LOAN_APPROVED_TOPIC_ARN,
                Subject: `Loan ${loanId} Approved`,
                Message: JSON.stringify({
                  loanId,
                  userId,
                  status: 'APPROVED',
                  reason: eligibilityResult.reason,
                  timestamp: new Date().toISOString(),
                }),
              };

              await sns.publish(snsParams).promise();
              log.info(`Published approval notification for loan ${loanId}`);
            } catch (snsError) {
              log.error(`Failed to publish SNS notification for loan ${loanId}`, snsError);
              // Note: Do not fail the entire Lambda if SNS fails
            }
          }

          processedRecords.push({ recordId: record.messageId, loanId, status: newStatus });
        } else {
          log.warn(`Unknown action: ${action}`);
          failedRecords.push({ recordId: record.messageId, reason: `Unknown action: ${action}` });
        }
      } catch (error) {
        log.error('Error processing record', error);
        failedRecords.push({ recordId: record.messageId, reason: error.message });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Eligibility check completed',
        processed: processedRecords.length,
        failed: failedRecords.length,
        details: {
          processed: processedRecords,
          failed: failedRecords,
        },
      }),
    };
  } catch (error) {
    log.error('Lambda execution error', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Lambda execution error',
        error: error.message,
      }),
    };
  } finally {
    if (connection) {
      try {
        await connection.end();
        log.info('Database connection closed');
      } catch (closeError) {
        log.error('Error closing database connection', closeError);
      }
    }
  }
};
