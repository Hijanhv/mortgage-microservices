const mysql = require('mysql2/promise');

class Database {
  constructor() {
    this.pool = null;
  }

  async initialize(config) {
    this.pool = await mysql.createPool({
      host: config.host || process.env.DB_HOST || 'localhost',
      user: config.user || process.env.DB_USER || 'mortgage',
      password: config.password || process.env.DB_PASSWORD || 'mortgage',
      database: config.database || process.env.DB_NAME || 'mortgage',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }

  async query(sql, values) {
    if (!this.pool) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    const connection = await this.pool.getConnection();
    try {
      const [results] = await connection.execute(sql, values);
      return results;
    } finally {
      connection.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

module.exports = new Database();
