FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY loan-service/package*.json ./

# Copy source
COPY loan-service/src ./src

# Copy common directory
COPY common /app/common

# Install dependencies
RUN npm install

EXPOSE 3002

CMD ["npm", "start"]
