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
    
    // Build consumer config, only including defined values
    const consumerConfig = { groupId };
    
    if (config) {
      if (config.sessionTimeout !== undefined) consumerConfig.sessionTimeout = config.sessionTimeout;
      if (config.heartbeatInterval !== undefined) consumerConfig.heartbeatInterval = config.heartbeatInterval;
      if (config.rebalanceTimeout !== undefined) consumerConfig.rebalanceTimeout = config.rebalanceTimeout;
      if (config.allowAutoTopicCreation !== undefined) consumerConfig.allowAutoTopicCreation = config.allowAutoTopicCreation;
      if (config.maxInFlightRequests !== undefined) consumerConfig.maxInFlightRequests = config.maxInFlightRequests;
      if (config.maxWaitTimeInMs !== undefined) consumerConfig.maxWaitTimeInMs = config.maxWaitTimeInMs;
      if (config.retry !== undefined) consumerConfig.retry = config.retry;
    }
    
    this.consumer = this.kafka.consumer(consumerConfig);
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


