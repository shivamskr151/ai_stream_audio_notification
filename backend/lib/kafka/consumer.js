const { getKafkaClient } = require('./client');

class KafkaConsumerService {
  constructor() {
    this.kafka = null; // initialize lazily to avoid env errors when unused
    this.consumer = null;
    this.isConnected = false;
    this.isRunning = false;
  }

  async connect(config) {
    if (this.isConnected && this.consumer) return;
    const groupId = (config && config.groupId) || 'default-consumer-group';
    if (!this.kafka) this.kafka = getKafkaClient();
    // Build consumer config with optimized defaults
    const consumerConfig = { 
      groupId,
      sessionTimeout: config?.sessionTimeout || 30000, // Increased from 10s to 30s
      heartbeatInterval: config?.heartbeatInterval || 3000, // 3s heartbeat
      rebalanceTimeout: config?.rebalanceTimeout || 60000, // 60s rebalance timeout
      allowAutoTopicCreation: config?.allowAutoTopicCreation ?? true,
      maxInFlightRequests: config?.maxInFlightRequests || 5, // Allow concurrent requests
      maxWaitTimeInMs: config?.maxWaitTimeInMs || 5000, // Wait up to 5s for messages
      retry: config?.retry || {
        retries: 8,
        initialRetryTime: 100,
        multiplier: 2,
        maxRetryTime: 30000
      }
    };
    
    this.consumer = this.kafka.consumer(consumerConfig);

    // Add error handlers for better reliability
    this.consumer.on('consumer.disconnect', () => {
      // eslint-disable-next-line no-console
      console.warn('[KafkaConsumer] Consumer disconnected');
      this.isConnected = false;
      this.isRunning = false;
    });

    this.consumer.on('consumer.crash', (event) => {
      // eslint-disable-next-line no-console
      console.error('[KafkaConsumer] Consumer crashed:', event.payload.error);
      this.isConnected = false;
      this.isRunning = false;
    });
    await this.consumer.connect();
    this.isConnected = true;
  }

  async consume({ topics, config = {}, onMessage, onBatch }) {
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

    // Optimized consumer run configuration
    const runConfig = {
      partitionsConsumedConcurrently: config.partitionsConsumedConcurrently || 3, // Process multiple partitions concurrently
      autoCommit: config.autoCommit ?? true, // Auto-commit offsets
      autoCommitInterval: config.autoCommitInterval || 5000, // Commit every 5 seconds
      autoCommitThreshold: config.autoCommitThreshold || 100 // Or after 100 messages
    };

    // Support both batch and individual message processing
    if (onBatch && typeof onBatch === 'function') {
      runConfig.eachBatch = async ({ batch, resolveOffset, heartbeat, isRunning }) => {
        try {
          await onBatch(batch, resolveOffset, heartbeat, isRunning);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[KafkaConsumer] onBatch error:', err);
        }
      };
    } else {
      runConfig.eachMessage = async ({ topic, partition, message, heartbeat, pause }) => {
        try {
          if (typeof onMessage === 'function') {
            await onMessage(message, topic, partition, heartbeat, pause);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[KafkaConsumer] onMessage error:', err);
          // Don't throw - let consumer continue processing other messages
        }
      };
    }

    await this.consumer.run(runConfig);
    this.isRunning = true;
  }

  async disconnect() {
    if (this.consumer) {
      try { 
        await this.consumer.disconnect(); 
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[KafkaConsumer] Error during disconnect:', err);
      }
      this.consumer = null;
      this.isConnected = false;
      this.isRunning = false;
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      isRunning: this.isRunning
    };
  }
}

module.exports = { KafkaConsumerService };


