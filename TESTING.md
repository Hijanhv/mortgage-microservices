# Testing Guide - Mortgage Microservices

This guide covers manual testing of all services and the end-to-end workflow.

## Prerequisites

- All services running (`npm run dev`)
- Services are healthy (check `/health` endpoints)
- MySQL database initialized with schema
- LocalStack SQS/SNS queues created

## 1. Testing Services Are Running

Check that all services are responsive:

```bash
# Auth Service
curl http://localhost:3001/health
# Expected: {"status":"Auth service is running"}

# Loan Service
curl http://localhost:3002/health
# Expected: {"status":"Loan service is running"}

# Document Verification Service
curl http://localhost:3003/health
# Expected: {"status":"Document verification service is running"}
```

## 2. Testing Auth Service

### 2.1 User Registration

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "securepass123",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

Expected response:
```json
{
  "message": "User registered successfully",
  "userId": 1,
  "email": "john@example.com"
}
```

### 2.2 User Login

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "securepass123"
  }'
```

Expected response:
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": 1,
  "email": "john@example.com"
}
```

Save the token for further tests:
```bash
TOKEN="your-token-here"
```

### 2.3 Token Verification

```bash
curl -X GET http://localhost:3001/auth/verify \
  -H "Authorization: Bearer $TOKEN"
```

Expected response:
```json
{
  "message": "Token is valid",
  "userId": 1,
  "email": "john@example.com"
}
```

### 2.4 Rate Limiting Test

Register with same email 6+ times rapidly - should be rate limited after 5 attempts:

```bash
for i in {1..6}; do
  curl -X POST http://localhost:3001/auth/register \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"test$i@example.com\", \"password\": \"pass123\"}"
done
```

The 6th request should return 429 (Too Many Requests).

### 2.5 Validation Testing

Test with invalid email:
```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "invalid-email",
    "password": "securepass123"
  }'
```

Expected: 400 Bad Request with validation error message

## 3. Testing Loan Service

### 3.1 Create Loan Application

```bash
curl -X POST http://localhost:3002/loans \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "loanAmount": 350000,
    "propertyAddress": "456 Oak St, Springfield, IL 62701"
  }'
```

Expected response:
```json
{
  "message": "Loan created successfully",
  "loanId": 1,
  "status": "PENDING_VERIFICATION"
}
```

Note: This triggers an SQS message to the doc-verification queue.

### 3.2 Get All Loans

```bash
curl http://localhost:3002/loans
```

Expected response: Array of loan objects

### 3.3 Get Specific Loan

```bash
curl http://localhost:3002/loans/1
```

Expected response: Single loan object with status

### 3.4 Update Loan

```bash
curl -X PUT http://localhost:3002/loans/1 \
  -H "Content-Type: application/json" \
  -d '{
    "loanAmount": 400000
  }'
```

Expected response:
```json
{
  "message": "Loan updated successfully"
}
```

### 3.5 Delete Loan

```bash
curl -X DELETE http://localhost:3002/loans/1
```

Expected response:
```json
{
  "message": "Loan deleted successfully"
}
```

### 3.6 Validation Testing

Test with negative loan amount:
```bash
curl -X POST http://localhost:3002/loans \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "loanAmount": -100000,
    "propertyAddress": "123 Main St"
  }'
```

Expected: 400 Bad Request with validation error

Test with non-existent user:
```bash
curl -X POST http://localhost:3002/loans \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 9999,
    "loanAmount": 100000,
    "propertyAddress": "123 Main St"
  }'
```

Expected: 404 Not Found

## 4. Testing Document Verification Service

The Document Verification Service runs as an SQS consumer in the background. Monitor its progress via logs:

```bash
docker-compose logs -f doc_verification_service
```

### 4.1 Verify Message Processing

1. Create a loan (see section 3.1)
2. Watch the doc_verification_service logs
3. You should see:
   - "Received X messages from queue"
   - "Document Verification result for loan 1: PASSED" or "FAILED"
   - "Loan 1 status updated to VERIFIED" or "VERIFICATION_FAILED"
   - "sent to eligibility queue"

### 4.2 Monitor Loan Status Changes

Create a loan, then repeatedly check its status to see state changes:

```bash
# Create loan
LOAN_ID=$(curl -s -X POST http://localhost:3002/loans \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "loanAmount": 250000,
    "propertyAddress": "789 Elm St"
  }' | jq -r '.loanId')

# Poll status
for i in {1..10}; do
  echo "Check $i:"
  curl -s http://localhost:3002/loans/$LOAN_ID | jq '.status'
  sleep 2
done
```

You should see status change from `PENDING_VERIFICATION` → `VERIFIED` or `VERIFICATION_FAILED`

## 5. End-to-End Workflow Testing

Complete workflow from registration through eligibility:

```bash
#!/bin/bash

echo "=== Step 1: Register User ==="
REGISTER_RESPONSE=$(curl -s -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "e2e@example.com",
    "password": "testpass123",
    "firstName": "E2E",
    "lastName": "Test"
  }')
echo $REGISTER_RESPONSE | jq .

USER_ID=$(echo $REGISTER_RESPONSE | jq -r '.userId')
echo "User ID: $USER_ID"

echo -e "\n=== Step 2: Login User ==="
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "e2e@example.com",
    "password": "testpass123"
  }')
echo $LOGIN_RESPONSE | jq .

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.token')
echo "Token: $TOKEN"

echo -e "\n=== Step 3: Verify Token ==="
curl -s -X GET http://localhost:3001/auth/verify \
  -H "Authorization: Bearer $TOKEN" | jq .

echo -e "\n=== Step 4: Create Loan ==="
LOAN_RESPONSE=$(curl -s -X POST http://localhost:3002/loans \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": $USER_ID,
    \"loanAmount\": 500000,
    \"propertyAddress\": \"999 Pine St, Seattle, WA 98101\"
  }")
echo $LOAN_RESPONSE | jq .

LOAN_ID=$(echo $LOAN_RESPONSE | jq -r '.loanId')
echo "Loan ID: $LOAN_ID"

echo -e "\n=== Step 5: Monitor Document Verification (20 seconds) ==="
for i in {1..10}; do
  STATUS=$(curl -s http://localhost:3002/loans/$LOAN_ID | jq -r '.status')
  echo "Time ${i}0s: Loan Status = $STATUS"
  sleep 2
done

echo -e "\n=== Step 6: Check Final Loan Status ==="
curl -s http://localhost:3002/loans/$LOAN_ID | jq .
```

## 6. Error Handling Tests

### 6.1 Database Connection Error

Stop MySQL and try to create a loan:
```bash
docker-compose stop mysql
curl -X POST http://localhost:3002/loans \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "loanAmount": 100000,
    "propertyAddress": "test"
  }'
```

Expected: 500 Internal Server Error

Restart MySQL:
```bash
docker-compose start mysql
```

### 6.2 SQS Connection Error

Stop LocalStack and create a loan:
```bash
docker-compose stop localstack
curl -X POST http://localhost:3002/loans \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "loanAmount": 100000,
    "propertyAddress": "test"
  }'
```

Expected: Loan still created (graceful handling of SQS failure)

### 6.3 Invalid Token

```bash
curl -X GET http://localhost:3001/auth/verify \
  -H "Authorization: Bearer invalid-token"
```

Expected: 403 Forbidden

## 7. Logging Verification

Check that all services are logging properly:

```bash
# Auth Service logs
docker-compose logs auth_service | grep -i "register\|login\|error" | tail -20

# Loan Service logs
docker-compose logs loan_service | grep -i "creating\|loan\|error" | tail -20

# Doc Verification logs
docker-compose logs doc_verification_service | grep -i "verify\|processing" | tail -20
```

## 8. Performance Testing

Test rate limiting with concurrent requests:

```bash
# Create 50 concurrent requests to auth endpoint
for i in {1..50}; do
  curl -X POST http://localhost:3001/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email": "test@example.com", "password": "pass"}' &
done
wait

# Check how many succeeded and how many were rate limited (429)
```

## Troubleshooting

### Services Not Starting

Check logs:
```bash
docker-compose logs auth_service
docker-compose logs loan_service
docker-compose logs doc_verification_service
```

### Database Not Initialized

Manually initialize:
```bash
docker exec mortgage_db mysql -u mortgage -pmortgage mortgage < sql-scripts/01-init.sql
```

### SQS Messages Not Processing

Check if LocalStack is running:
```bash
docker-compose logs localstack
```

Verify queues exist:
```bash
docker exec mortgage_localstack aws sqs list-queues --endpoint-url=http://localhost:4566 --region us-east-1
```

### Loan Status Not Updating

Check doc verification service logs:
```bash
docker-compose logs -f doc_verification_service
```

Verify messages in queue:
```bash
docker exec mortgage_localstack aws sqs receive-message \
  --queue-url http://localhost:4566/000000000000/doc-verification-queue \
  --endpoint-url=http://localhost:4566 \
  --region us-east-1
```
