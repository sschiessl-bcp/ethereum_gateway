import { Client as WebSocketClient } from 'rpc-websockets';
import type { Transaction } from 'sequelize';

import { app, appConfig } from './app';
import { DerivedWallets, Orders, Txs, Wallets, sequelize } from './models';
import queue from './queue';
import { getColdAddress, getHotAddress, toChecksumAddress } from './web3';

let bookerProvider = null;

export async function getBookerProvider(): Promise<WebSocketClient> {
  if (bookerProvider === null) {
    bookerProvider = new WebSocketClient(appConfig.bookerProvider);

    bookerProvider.connect();

    await new Promise((resolve, _reject) => {
      bookerProvider.once('open', () => {
        console.log('Connection to Booker has been established successfully.');

        resolve();
      });
    });
  }

  return bookerProvider;
}

export async function getDepositAddress(args: any): Promise<any> {
  const outTxTo = await sequelize.transaction(
    async (transaction: Transaction) => {
      const wallet = (
        await Wallets.findOrCreate({
          attributes: ['id', 'payment'],
          where: { payment: 'bitshares', invoice: args.user },
          include: [
            {
              model: DerivedWallets,
              as: 'derivedWallets',
              attributes: ['id', 'invoice'],
              where: { payment: 'ethereum' },
              required: false,
              separate: true,
              limit: 1,
            },
          ],
          transaction,
        })
      )[0];

      let derivedWallet;

      if (
        typeof wallet.derivedWallets === 'undefined' ||
        wallet.derivedWallets.length === 0
      ) {
        derivedWallet = await DerivedWallets.create(
          {
            walletId: wallet.id,
            payment: 'ethereum',
            invoice: getColdAddress(wallet),
          },
          { transaction }
        );
      } else {
        [derivedWallet] = wallet.derivedWallets;
      }

      return derivedWallet.invoice;
    }
  );

  return { user: args.user, deposit_address: outTxTo };
}

export async function getDepositAddressRPC(args: any): Promise<any> {
  try {
    return await getDepositAddress(args);
  } catch (error) {
    console.error(error);

    throw error;
  }
}

export async function getDepositAddressHTTP(
  rq: Request,
  rs: Response
): Promise<void> {
  await rs.status(200).json(await getDepositAddress(rq.body));
}

export async function newInOrder(args: any): Promise<any> {
  const fromAddress = toChecksumAddress(args.in_tx.from_address);
  const toAddress = toChecksumAddress(args.in_tx.to_address);

  const order = await sequelize.transaction(
    async (transaction: Transaction) => {
      const wallet = await DerivedWallets.findOne({
        attributes: ['id'],
        where: { payment: 'ethereum', invoice: toAddress },
        transaction,
      });

      return Orders.create(
        {
          id: args.order_id,
          type: args.order_type,
          flow: 'IN',
          inTx: {
            coin: args.in_tx.coin,
            txId: args.in_tx.tx_id,
            fromAddress,
            toAddress,
            amount: args.in_tx.amount,
            txCreatedAt: args.in_tx.created_at,
            error: args.in_tx.error,
            confirmations: args.in_tx.confirmations,
            maxConfirmations: args.in_tx.max_confirmations,
          },
          outTx: {
            coin: args.out_tx.coin,
            txId: args.out_tx.tx_id,
            fromAddress: args.out_tx.from_address,
            toAddress: args.out_tx.to_address,
            amount: args.out_tx.amount,
            txCreatedAt: args.out_tx.created_at,
            error: args.out_tx.error,
            confirmations: args.out_tx.confirmations,
            maxConfirmations: args.out_tx.max_confirmations,
          },
          walletId: wallet.id,
        },
        {
          include: [
            { model: Txs, as: 'inTx' },
            { model: Txs, as: 'outTx' },
          ],
          transaction,
        }
      );
    }
  );

  const job = (await queue.getJob(order.jobId)) ?? null;

  if (job === null) {
    await queue.add(
      'payment',
      {},
      { jobId: order.jobId, timeout: 1000 * 60 * 60 }
    );
  } else if ((await job.getState()) === 'failed') {
    await job.retry();
  }

  return {};
}

export async function newInOrderRPC(args: any): Promise<any> {
  try {
    return await newInOrder(args);
  } catch (error) {
    console.error(error);

    throw error;
  }
}

export async function newInOrderHTTP(rq: Request, rs: Response): Promise<void> {
  await rs.status(200).json(await newInOrder(rq.body));
}

export async function newOutOrder(args: any): Promise<any> {
  let fromAddress = null;

  if (
    typeof args.out_tx.from_address !== 'undefined' &&
    args.out_tx.from_address !== null
  ) {
    fromAddress = toChecksumAddress(args.out_tx.from_address);
  }

  const toAddress = toChecksumAddress(args.out_tx.to_address);

  const order = await sequelize.transaction(
    async (transaction: Transaction) => {
      return Orders.create(
        {
          id: args.order_id,
          type: args.order_type,
          flow: 'OUT',
          inTx: {
            coin: args.in_tx.coin,
            txId: args.in_tx.tx_id,
            fromAddress: args.in_tx.from_address,
            toAddress: args.in_tx.to_address,
            amount: args.in_tx.amount,
            txCreatedAt: args.in_tx.created_at,
            error: args.in_tx.error,
            confirmations: args.in_tx.confirmations,
            maxConfirmations: args.in_tx.max_confirmations,
          },
          outTx: {
            coin: args.out_tx.coin,
            txId: args.out_tx.tx_id,
            fromAddress,
            toAddress,
            amount: args.out_tx.amount,
            txCreatedAt: args.out_tx.created_at,
            error: args.out_tx.error,
            confirmations: args.out_tx.confirmations,
            maxConfirmations: args.out_tx.max_confirmations,
          }
        },
        {
          include: [
            { model: Txs, as: 'inTx' },
            { model: Txs, as: 'outTx' },
          ],
          transaction,
        }
      );
    }
  );

  const job = (await queue.getJob(order.jobId)) ?? null;

  if (job === null) {
    await queue.add(
      'payment',
      {},
      { jobId: order.jobId, timeout: 1000 * 60 * 60 }
    );
  } else if ((await job.getState()) === 'failed') {
    await job.retry();
  }

  return {
    coin: 'USDT',
    amount: '0',
    from_address: getHotAddress(),
    max_confirmations: appConfig.ethereumRequiredConfirmations,
  };
}

export async function newOutOrderRPC(args: any): Promise<any> {
  try {
    return await newOutOrder(args);
  } catch (error) {
    console.error(error);

    throw error;
  }
}

export async function newOutOrderHTTP(
  rq: Request,
  rs: Response
): Promise<void> {
  await rs.status(200).json(await newOutOrder(rq.body));
}

export async function validateAddress(args: any): Promise<any> {
  args.is_valid = true;

  return args;
}

export async function validateAddressRPC(args: any): Promise<any> {
  try {
    return await validateAddress(args);
  } catch (error) {
    console.error(error);

    throw error;
  }
}

app.post('/v1/get_deposit_address', getDepositAddressHTTP);
app.post('/v1/new_in_order', newInOrderHTTP);
app.post('/v1/new_out_order', newOutOrderHTTP);
