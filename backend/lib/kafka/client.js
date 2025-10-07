const { Kafka, logLevel } = require('kafkajs');
const { getKafkaBrokers } = require('../../config');

let sharedKafka = null;

function getKafkaClient() {
  if (sharedKafka) return sharedKafka;
  sharedKafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID,
    brokers: getKafkaBrokers(),
    logLevel: logLevel.NOTHING
  });
  return sharedKafka;
}

module.exports = { getKafkaClient };


