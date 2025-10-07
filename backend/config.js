require('dotenv').config();

function getKafkaBrokers() {
  const brokerEnv = process.env.KAFKA_BROKER || process.env.KAFKA_BROKERS || '';
  const brokers = brokerEnv
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (brokers.length === 0) {
    throw new Error('KAFKA_BROKER env var is required (comma-separated for multiple).');
  }
  return brokers;
}

module.exports = {
  getKafkaBrokers
};


