const { getKafkaClient } = require('./client');

class KafkaProducerService {
  constructor() {
    this.kafka = getKafkaClient();
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
      idempotent: false,
      maxInFlightRequests: 5
    });
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) return;
    await this.producer.connect();
    this.isConnected = true;
  }

  async send({ topic, messages, acks }) {
    if (!topic) throw new Error('topic is required');
    const payload = Array.isArray(messages) ? messages : [messages];
    await this.connect();
    return this.producer.send({ topic, messages: payload, acks });
  }

  async disconnect() {
    if (this.producer) {
      try { await this.producer.disconnect(); } catch (_) {}
      this.isConnected = false;
    }
  }
}

module.exports = { KafkaProducerService };


