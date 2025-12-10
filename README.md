# Mortgage Microservices

A microservices-based mortgage application platform with distributed processing and async workflows.

## Architecture Overview

### Services

1. **Auth Service** - User authentication and JWT token issuance
2. **Loan Service** - Loan application CRUD and SQS message publishing
3. **Document Verification Service** - SQS consumer for document verification
4. **Eligibility Service** - AWS Lambda for eligibility calculation

### Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MySQL
- **Messaging**: AWS SQS
- **Notifications**: AWS SNS
- **Containerization**: Docker
- **Orchestration**: Docker Compose

## Project Structure

```
mortgage-microservices/
├── auth-service/           # Authentication service
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── loan-service/           # Loan application service
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── doc-verification-service/  # Document verification consumer
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── eligibility-lambda/     # AWS Lambda eligibility service
│   ├── index.js
│   └── package.json
├── common/                 # Shared utilities
│   └── db.js              # Database helper
├── docker-compose.yml      # Service orchestration
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- MySQL (or use Docker container)
- AWS credentials (for SQS/SNS in production)

### Local Development

```bash
# Install dependencies for all services
npm install

# Start all services
docker-compose up

# Database initialization
# Run migrations and seed data
npm run db:migrate
```

## Service Details

### Auth Service (Port 3001)

- POST `/auth/register` - User registration
- POST `/auth/login` - User login
- JWT token validation middleware

### Loan Service (Port 3002)

- GET `/loans` - List applications
- POST `/loans` - Create new application
- GET `/loans/:id` - Get application details
- PUT `/loans/:id` - Update application
- DELETE `/loans/:id` - Delete application

### Document Verification Service (Port 3003)

- SQS consumer listening to `doc-verification-queue`
- Processes document verification tasks
- Updates loan status in database
- Publishes to `eligibility-queue`

### Eligibility Service (AWS Lambda)

- Triggered by SQS event from `eligibility-queue`
- Calculates loan eligibility based on rules
- Updates loan status to approved/rejected
- Publishes approved loans to `loan-approved-topic` SNS

## Database Schema

Tables:
- `users` - User accounts
- `loans` - Loan applications
- `documents` - Application documents
- `audit_log` - Audit trail

## Message Queues

- `doc-verification-queue` - Document verification tasks
- `eligibility-queue` - Eligibility calculation tasks
- `loan-approved-topic` - SNS topic for approved loans

## Development

- TypeScript configuration in progress
- Unit tests to be implemented
- Integration tests to be implemented
- API documentation (Swagger/OpenAPI) to be added

## Deployment

### Local
Uses Docker Compose with local MySQL instance

### AWS
- Auth/Loan/Doc services: ECS or EC2
- Eligibility: Lambda
- Database: RDS
- Messaging: SQS/SNS
