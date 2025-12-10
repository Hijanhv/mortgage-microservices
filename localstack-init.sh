#!/bin/bash

# Wait for LocalStack to be ready
echo "Waiting for LocalStack to be ready..."
sleep 10

# Create SQS queues
echo "Creating SQS queues..."
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name doc-verification-queue --region us-east-1
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name eligibility-queue --region us-east-1

# Create SNS topic
echo "Creating SNS topic..."
aws --endpoint-url=http://localhost:4566 sns create-topic --name loan-approved-topic --region us-east-1

echo "LocalStack initialization complete!"
