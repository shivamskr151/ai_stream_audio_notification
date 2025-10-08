const { Kafka, logLevel } = require('kafkajs');
const { getKafkaBrokers } = require('../../config');

let sharedKafka = null;

function getKafkaClient() {
  if (sharedKafka) return sharedKafka;
  sharedKafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID,
    brokers: getKafkaBrokers(),
    logLevel: logLevel.NOTHING,
    connectionTimeout: 10000,
    requestTimeout: 30000,
    retry: {
      initialRetryTime: 100,
      retries: 8
    }
  });
  return sharedKafka;
}

module.exports = { getKafkaClient };


