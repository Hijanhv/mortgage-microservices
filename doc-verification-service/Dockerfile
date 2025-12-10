FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY doc-verification-service/package*.json ./

# Copy source
COPY doc-verification-service/src ./src

# Copy common directory
COPY common /app/common

# Install dependencies
RUN npm install

EXPOSE 3003

CMD ["npm", "start"]
