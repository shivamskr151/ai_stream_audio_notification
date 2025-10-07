const { getKafkaClient } = require('./client');

class KafkaConsumerService {
  constructor() {
    this.kafka = null; // initialize lazily to avoid env errors when unused
    this.consumer = null;
    this.isConnected = false;
  }

  async connect(config) {
    if (this.isConnected && this.consumer) return;
    const groupId = (config && config.groupId) || 'default-consumer-group';
    if (!this.kafka) this.kafka = getKafkaClient();
    this.consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: config && config.sessionTimeout,
      heartbeatInterval: config && config.heartbeatInterval,
      rebalanceTimeout: config && config.rebalanceTimeout,
      allowAutoTopicCreation: config && config.allowAutoTopicCreation,
      maxInFlightRequests: config && config.maxInFlightRequests,
      maxWaitTimeInMs: config && config.maxWaitTimeInMs,
      retry: config && config.retry
    });
    await this.consumer.connect();
    this.isConnected = true;
  }

  async consume({ topics, config = {}, onMessage }) {
    const topicList = topics && (topics.topics || topics.topic || topics);
    if (!topicList || (Array.isArray(topicList) && topicList.length === 0)) {
      throw new Error('No topics provided to consume');
    }
    const fromBeginning = !!(topics && topics.fromBeginning);

    await this.connect(config);

    const subscribeTopics = Array.isArray(topicList) ? topicList : [topicList];
    for (const t of subscribeTopics) {
      await this.consumer.subscribe({ topic: t, fromBeginning });
    }

    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        try {
          if (typeof onMessage === 'function') {
            await onMessage(message, topic);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[KafkaConsumer] onMessage error:', err);
        }
      }
    });
  }

  async disconnect() {
    if (this.consumer) {
      try { await this.consumer.disconnect(); } catch (_) {}
      this.consumer = null;
      this.isConnected = false;
    }
  }
}

module.exports = { KafkaConsumerService };


