const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const db = require('../common/db');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // stricter for auth endpoints
  message: 'Too many auth attempts, please try again later.',
});

app.use(limiter);

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  firstName: Joi.string().optional(),
  lastName: Joi.string().optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
};

// Middleware for JWT validation
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.warn('No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      logger.warn('Invalid token:', err.message);
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

// Register endpoint
app.post('/auth/register', authLimiter, validateRequest(registerSchema), async (req, res, next) => {
  try {
    const { email, password, firstName, lastName } = req.validatedBody;

    logger.info(`Register attempt for email: ${email}`);

    // Check if user exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser.length > 0) {
      logger.warn(`User already exists: ${email}`);
      return res.status(409).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const result = await db.query(
      'INSERT INTO users (email, password, firstName, lastName, createdAt) VALUES (?, ?, ?, ?, NOW())',
      [email, hashedPassword, firstName || '', lastName || '']
    );

    const userId = result.insertId;

    logger.info(`User registered successfully: ${email}`);

    res.status(201).json({
      message: 'User registered successfully',
      userId,
      email,
    });
  } catch (error) {
    logger.error('Register error:', error);
    next(error);
  }
});

// Login endpoint
app.post('/auth/login', authLimiter, validateRequest(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;

    logger.info(`Login attempt for email: ${email}`);

    // Find user
    const users = await db.query(
      'SELECT id, email, password FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      logger.warn(`Login failed: user not found: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      logger.warn(`Login failed: invalid password for: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    logger.info(`User logged in successfully: ${email}`);

    res.json({
      message: 'Login successful',
      token,
      userId: user.id,
      email: user.email,
    });
  } catch (error) {
    logger.error('Login error:', error);
    next(error);
  }
});

// Protected endpoint example
app.get('/auth/verify', authenticateToken, (req, res) => {
  logger.info(`Token verified for user: ${req.user.email}`);
  res.json({
    message: 'Token is valid',
    userId: req.user.id,
    email: req.user.email,
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Auth service is running' });
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
      logger.info(`Auth service listening on port ${PORT}`);
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
