# Setup Guide for Mortgage Microservices

## Prerequisites

- Node.js 18+ installed
- Docker and Docker Compose installed
- Git (already initialized)

## Quick Start

### 1. Environment Configuration

Copy the example environment file:
```bash
cp .env.example .env
```

The `.env` file contains all necessary configuration for local development with LocalStack.

### 2. Install Dependencies

From the root directory:
```bash
npm run install-all
```

Or manually for each service:
```bash
npm install
cd auth-service && npm install && cd ..
cd loan-service && npm install && cd ..
cd doc-verification-service && npm install && cd ..
cd eligibility-lambda && npm install && cd ..
```

### 3. Start All Services

```bash
npm run dev
```

This will:
- Start MySQL database
- Start LocalStack (SQS, SNS)
- Start Auth Service on port 3001
- Start Loan Service on port 3002
- Start Document Verification Service on port 3003

### 4. Initialize Database

After services are running, initialize the database schema:
```bash
npm run db:init
```

## Service Endpoints

### Auth Service (Port 3001)

**Register User:**
```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

**Verify Token:**
```bash
curl -X GET http://localhost:3001/auth/verify \
  -H "Authorization: Bearer <token>"
```

**Health Check:**
```bash
curl http://localhost:3001/health
```

### Loan Service (Port 3002)

**Create Loan Application:**
```bash
curl -X POST http://localhost:3002/loans \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "loanAmount": 250000,
    "propertyAddress": "123 Main St, City, State"
  }'
```

**Get All Loans:**
```bash
curl http://localhost:3002/loans
```

**Get Specific Loan:**
```bash
curl http://localhost:3002/loans/1
```

**Update Loan:**
```bash
curl -X PUT http://localhost:3002/loans/1 \
  -H "Content-Type: application/json" \
  -d '{
    "loanAmount": 300000
  }'
```

**Delete Loan:**
```bash
curl -X DELETE http://localhost:3002/loans/1
```

**Health Check:**
```bash
curl http://localhost:3002/health
```

### Document Verification Service (Port 3003)

**Health Check:**
```bash
curl http://localhost:3003/health
```

Note: This service runs as an SQS consumer and processes messages automatically.

## Architecture Flow

1. **User Registration/Login** → Auth Service → JWT Token
2. **Create Loan** → Loan Service → Message to `doc-verification-queue` (SQS)
3. **Document Verification** → Doc Verification Service (SQS Consumer) → Updates DB → Message to `eligibility-queue`
4. **Eligibility Check** → Lambda Function (triggered by SQS) → Updates DB → Publishes to SNS Topic

## Database Tables

### users
- `id` - User ID (PK)
- `email` - Email address (unique)
- `password` - Hashed password
- `firstName` - First name
- `lastName` - Last name
- `createdAt` - Creation timestamp
- `updatedAt` - Update timestamp

### loans
- `id` - Loan ID (PK)
- `userId` - User ID (FK)
- `loanAmount` - Loan amount
- `propertyAddress` - Property address
- `status` - Loan status (PENDING_VERIFICATION, VERIFIED, VERIFICATION_FAILED, PENDING_ELIGIBILITY, APPROVED, REJECTED)
- `createdAt` - Creation timestamp
- `updatedAt` - Update timestamp

### documents
- `id` - Document ID (PK)
- `loanId` - Loan ID (FK)
- `documentType` - Type of document
- `documentPath` - Path to document
- `verificationStatus` - Verification status
- `createdAt` - Creation timestamp
- `updatedAt` - Update timestamp

### audit_log
- `id` - Log ID (PK)
- `loanId` - Loan ID (FK, optional)
- `userId` - User ID (FK, optional)
- `action` - Action performed
- `details` - JSON details
- `timestamp` - Timestamp

## Viewing Logs

```bash
npm run logs
```

Or for specific service:
```bash
docker-compose logs -f auth-service
docker-compose logs -f loan-service
docker-compose logs -f doc-verification-service
```

## Stopping Services

```bash
npm run down
```

## Rebuilding Containers

```bash
npm run build
```

Then start again with:
```bash
npm run dev
```

## Development Workflow

### Adding a New Endpoint

1. Edit the service file (e.g., `loan-service/src/index.js`)
2. Since hot-reload is enabled via volumes, changes will reflect automatically
3. Test the new endpoint

### Debugging

Enable debug logs by setting `DEBUG=*` in your `.env` file:
```bash
DEBUG=* npm run dev
```

### Testing

Each service has Jest configuration ready. Run tests with:
```bash
cd auth-service && npm test
cd loan-service && npm test
cd doc-verification-service && npm test
cd eligibility-lambda && npm test
```

## Production Deployment

### Auth/Loan/Doc Services

For AWS deployment:
1. Push Docker images to ECR
2. Deploy to ECS/EC2
3. Update environment variables for RDS MySQL
4. Update SQS/SNS queue URLs

### Eligibility Lambda

For AWS Lambda deployment:
1. Package the lambda function: `zip -r function.zip .`
2. Upload to AWS Lambda
3. Set environment variables (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, LOAN_APPROVED_TOPIC_ARN)
4. Trigger from SQS (eligibility-queue)

## Troubleshooting

### Database Connection Issues

Ensure MySQL is running:
```bash
docker-compose ps
```

Check MySQL logs:
```bash
docker-compose logs mysql
```

### SQS/SNS Queue Issues

Check LocalStack status:
```bash
docker-compose logs localstack
```

Verify queues are created:
```bash
aws --endpoint-url=http://localhost:4566 sqs list-queues --region us-east-1
```

### Service Won't Start

Check if ports are already in use:
```bash
lsof -i :3001  # Auth Service
lsof -i :3002  # Loan Service
lsof -i :3003  # Doc Verification Service
```

### Database Not Initialized

Manually run initialization:
```bash
docker exec mortgage_db mysql -u mortgage -pmortgage mortgage < sql-scripts/01-init.sql
```

## Next Steps

1. Implement comprehensive error handling
2. Add input validation using libraries like Joi or Yup
3. Implement proper logging (Winston, Bunyan)
4. Add API authentication middleware
5. Implement database migrations
6. Add unit and integration tests
7. Set up CI/CD pipeline
8. Add API documentation (Swagger/OpenAPI)
9. Implement rate limiting
10. Add monitoring and alerting
