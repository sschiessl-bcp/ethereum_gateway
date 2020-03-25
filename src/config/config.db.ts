import { Transaction } from 'sequelize';

export const production = {
  dialect: 'postgres',
  host: 'db',
  username: 'payment-gateway',
  password: 'payment-gateway',
  database: 'payment-gateway',
  isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
};
const development = {
  dialect: 'postgres',
  host: 'db',
  username: 'payment-gateway',
  password: 'payment-gateway',
  database: 'payment-gateway',
  isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
  logQueryParameters: true,
};
const test = {
  dialect: 'sqlite',
  storage: ':memory:',
  isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
};
