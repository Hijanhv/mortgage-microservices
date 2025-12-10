FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY auth-service/package*.json ./

# Copy source
COPY auth-service/src ./src

# Copy common directory
COPY common /app/common

# Install dependencies
RUN npm install

EXPOSE 3001

CMD ["npm", "start"]
