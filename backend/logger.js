const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom sanitizer to strip sensitive fields from log messages
const sanitize = winston.format((info) => {
  const sensitiveKeys = ['password', 'masterPassword', 'token', 'secret', 'key', 'salt', 'data_enc', 'iv'];
  const sanitized = { ...info };
  for (const key of sensitiveKeys) {
    if (sanitized[key]) sanitized[key] = '[REDACTED]';
  }
  return sanitized;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  format: winston.format.combine(
    sanitize(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      sanitize(),
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

module.exports = logger;
