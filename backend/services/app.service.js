const { KafkaConsumerService } = require('../lib/kafka');
const { getKafkaBrokers } = require('../config');
const { broadcastEvent } = require('../lib/sse');
const { EventService } = require('./event.service');

class AppService {
  constructor(options) {
    const opts = options || {};
    this.topic = opts.topic || process.env.KAFKA_CONSUMER_TOPIC;
    this.groupId = opts.groupId || process.env.KAFKA_GROUP_ID;
    this.consumer = new KafkaConsumerService();
    this.eventService = new EventService();
    this.started = false;
    this.kafkaEnabled = false;
    try {
      const brokers = getKafkaBrokers();
      this.kafkaEnabled = Array.isArray(brokers) && brokers.length > 0;
    } catch (_) {
      this.kafkaEnabled = false;
    }
  }

  async checkKafkaConnection(timeoutMs = 10000) {
    if (!this.kafkaEnabled) return false;
    
    const withTimeout = (p, ms) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Kafka connection timeout')), ms);
      p.then(v => { clearTimeout(t); resolve(v); }).catch(err => { clearTimeout(t); reject(err); });
    });
    
    try {
      // Use the main consumer for connection check to avoid creating temporary instances
      await withTimeout(this.consumer.connect({
        groupId: this.groupId,
        sessionTimeout: 30000, // Increased session timeout
        retry: { 
          retries: 3, 
          initialRetryTime: 300,
          multiplier: 2 
        }
      }), timeoutMs);
      // eslint-disable-next-line no-console
      console.log('[AppService] Kafka connection established successfully');
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[AppService] Kafka connectivity check failed:', err && err.message ? err.message : err);
      try { await this.consumer.disconnect(); } catch (_) {}
      return false;
    }
  }

  async start() {
    if (this.started) return;
    this.started = true;
    if (!this.kafkaEnabled) {
      // eslint-disable-next-line no-console
      console.warn('[AppService] KAFKA_BROKER not set; Kafka consumption disabled. SSE will still work.');
      return;
    }

    const canConnect = await this.checkKafkaConnection(5000);
    if (!canConnect) {
      // eslint-disable-next-line no-console
      console.warn('[AppService] Kafka not reachable; consumer not started. Will rely on SSE only.');
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[AppService] Consuming topic ========>', this.topic, this.groupId);

    await this.consumer.consume({
      topics: { topic: this.topic, fromBeginning: false },
      config: { 
        groupId: this.groupId,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
        rebalanceTimeout: 60000,
        partitionsConsumedConcurrently: 3, // Process multiple partitions concurrently
        autoCommit: true,
        autoCommitInterval: 5000,
        autoCommitThreshold: 100
      },
      onMessage: async (message, topic, partition, heartbeat) => {
        try {
          const valueStr = message.value ? message.value.toString('utf8') : '';
          let payload = null;
          try {
            payload = valueStr ? JSON.parse(valueStr) : null;
          } catch (_) {
            payload = { type: 'raw', value: valueStr };
          }

          // Prepare event data for database storage
          const eventData = payload && typeof payload === 'object' ? payload : { data: payload };
          
          // eslint-disable-next-line no-console
          console.log('[AppService] Processing message from partition', partition, ':', payload);

          // Save to database and broadcast - the create method already returns the complete event
          try {
            const savedEvent = await this.eventService.create(eventData);
            // eslint-disable-next-line no-console
            console.log('[AppService] Event saved to database with ID:', savedEvent.id);
            
            // Broadcast the saved event (already contains all database fields)
            broadcastEvent(savedEvent);
            
            // Send heartbeat to keep consumer alive during long processing
            if (heartbeat) await heartbeat();
          } catch (dbError) {
            // eslint-disable-next-line no-console
            console.error('[AppService] Failed to save event to database:', dbError);
            // Broadcast original event data if database save fails
            broadcastEvent(eventData);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[AppService] Failed to process message:', err);
          // Don't throw - let consumer continue processing
        }
      }
    });
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    try { await this.consumer.disconnect(); } catch (_) {}
  }
}

module.exports = { AppService };


