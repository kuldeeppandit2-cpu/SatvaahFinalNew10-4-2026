// =============================================================================
// SatvAAh — MongoDB Init Script
// Runs once on first container start
// =============================================================================

// Switch to the app database
db = db.getSiblingDB('satvaaah_mongo');

// Create app user with readWrite on the app database
db.createUser({
  user: 'satvaaah_mongo_user',
  pwd: process.env.MONGODB_PASSWORD || process.env.MONGO_INITDB_ROOT_PASSWORD || 'S@tvAAh_Mongo_S3cur3_2026!',
  roles: [
    { role: 'readWrite', db: 'satvaaah_mongo' },
    { role: 'dbAdmin', db: 'satvaaah_mongo' }
  ]
});

// Create collections with schema validation

// Activity feeds — tracks all user/provider actions for trust scoring
db.createCollection('activity_feeds', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'eventType', 'createdAt'],
      properties: {
        userId: { bsonType: 'string' },
        eventType: { bsonType: 'string' },
        metadata: { bsonType: 'object' },
        createdAt: { bsonType: 'date' }
      }
    }
  }
});

// Chat logs — WhatsApp conversation history
db.createCollection('chat_logs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['sessionId', 'direction', 'createdAt'],
      properties: {
        sessionId: { bsonType: 'string' },
        phoneNumber: { bsonType: 'string' },
        direction: { enum: ['inbound', 'outbound'] },
        messageType: { bsonType: 'string' },
        content: { bsonType: 'object' },
        createdAt: { bsonType: 'date' }
      }
    }
  }
});

// Scraping results — raw data from web scraping jobs
db.createCollection('scraping_results');

// Audit logs — admin actions, sensitive operations
db.createCollection('audit_logs');

// Notification history — all sent notifications with delivery status
db.createCollection('notification_history');

// Create indexes
db.activity_feeds.createIndex({ userId: 1, createdAt: -1 });
db.activity_feeds.createIndex({ eventType: 1, createdAt: -1 });
db.activity_feeds.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

db.chat_logs.createIndex({ sessionId: 1, createdAt: -1 });
db.chat_logs.createIndex({ phoneNumber: 1, createdAt: -1 });
db.chat_logs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 15552000 }); // 180 days

db.scraping_results.createIndex({ jobId: 1 });
db.scraping_results.createIndex({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days

db.audit_logs.createIndex({ userId: 1, createdAt: -1 });
db.audit_logs.createIndex({ action: 1, createdAt: -1 });
db.audit_logs.createIndex({ createdAt: -1 });

db.notification_history.createIndex({ userId: 1, createdAt: -1 });
db.notification_history.createIndex({ channel: 1, status: 1, createdAt: -1 });
db.notification_history.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

print('SatvAAh MongoDB initialization complete.');
