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

  async checkKafkaConnection(timeoutMs = 5000) {
    if (!this.kafkaEnabled) return false;
    const tempConsumer = new KafkaConsumerService();
    const withTimeout = (p, ms) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Kafka connection timeout')), ms);
      p.then(v => { clearTimeout(t); resolve(v); }).catch(err => { clearTimeout(t); reject(err); });
    });
    try {
      await withTimeout(tempConsumer.connect({
        groupId: this.groupId,
        sessionTimeout: 10000,
        retry: { retries: 1, initialRetryTime: 300 }
      }), timeoutMs);
      await tempConsumer.disconnect();
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[AppService] Kafka connectivity check failed:', err && err.message ? err.message : err);
      try { await tempConsumer.disconnect(); } catch (_) {}
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
      config: { groupId: this.groupId },
      onMessage: async (message, topic) => {
        try {
          // eslint-disable-next-line no-console
          const valueStr = message.value ? message.value.toString('utf8') : '';
          let payload = null;
          try {
            payload = valueStr ? JSON.parse(valueStr) : null;
          } catch (_) {
            payload = { type: 'raw', value: valueStr };
          }

          // Prepare event data for database storage
          const eventData = payload && typeof payload === 'object' ? payload : { data: payload };
          
          console.log('[AppService] Payload ========>', payload);

          // Save to database
          let savedEvent = null;
          try {
            savedEvent = await this.eventService.create(eventData);
            console.log('[AppService] Event saved to database with ID:', savedEvent.id);
          } catch (dbError) {
            console.error('[AppService] Failed to save event to database:', dbError);
            // Continue with original event data if database save fails
            savedEvent = eventData;
          }

          // Fetch the complete event by ID to ensure we have all database fields
          let completeEvent = savedEvent;
          if (savedEvent && savedEvent.id) {
            try {
              const fetchedEvent = await this.eventService.getById(savedEvent.id);
              if (fetchedEvent) {
                completeEvent = fetchedEvent;
              }
            } catch (fetchError) {
              console.error('[AppService] Failed to fetch event by ID:', fetchError);
              // Use saved event if fetch fails
            }
          }

          // Broadcast the complete event data via SSE
          broadcastEvent(completeEvent);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[AppService] Failed to process message:', err);
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


