import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, GasPrice, coins } from '@cosmjs/stargate';
import { bech32 } from 'bech32';
import { Decimal } from '@cosmjs/math';
import { fetch } from 'undici';
import crypto from 'crypto';


export const RPC       = 'https://rpc-testnet.empe.io';
export const LCD       = 'https://lcd-testnet.empe.io';
export const CHAIN_ID  = 'empe-testnet-2';
export const DENOM     = 'uempe';
export const EXPONENT  = 6;                 
export const GAS_PRICE = `0.025${DENOM}`;
export const PREFIX    = 'empe';

const BROADCAST_TIMEOUT_MS = 45000;
const MAX_COMMISSION = 0.20;
const CLAIM_CHUNK = 16;

export const toMicro = (human) => Decimal.fromUserInput(String(human), EXPONENT).atomics;
export const fromMicro = (atom) => Decimal.fromAtomics(String(atom || '0'), EXPONENT).toString();

export async function connectWithMnemonic(mnemonic) {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic.trim(), { prefix: PREFIX });
  const [acc] = await wallet.getAccounts();
  const client = await SigningStargateClient.connectWithSigner(RPC, wallet, {
    gasPrice: GasPrice.fromString(GAS_PRICE),
    broadcastTimeoutMs: BROADCAST_TIMEOUT_MS
  });
  const chainId = await client.getChainId();
  return { client, address: acc.address, chainId };
}

export async function getBalance(client, address) {
  const b = await client.getBalance(address, DENOM).catch(() => ({ amount: '0' }));
  return b?.amount || '0';
}

export function genRandomAddress(prefix = PREFIX) {
  const data = crypto.randomBytes(20);
  const words = bech32.toWords(data);
  return bech32.encode(prefix, words);
}

async function lcdJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`LCD ${r.status}`);
  return r.json();
}

export async function fetchBondedValidators(limit = 300) {
  const j = await lcdJson(`${LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=${limit}`);
  return (j.validators || []).filter(v => !v.jailed)
    .filter(v => (v.status || '').toUpperCase() === 'BOND_STATUS_BONDED')
    .filter(v => Number(v.commission?.commission_rates?.rate || '0') <= MAX_COMMISSION);
}

export async function fetchRewards(address) {
  const j = await lcdJson(`${LCD}/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  const perVal = (j.rewards || []).map(r => ({
    validator: r.validator_address,
    amount: (r.reward || []).find(c => c.denom === DENOM)?.amount || '0'
  }));
  const total = (j.total || []).find(c => c.denom === DENOM)?.amount || '0';
  return { total, perVal };
}

export async function autoTransfer({ client, from, count, amount, pickTo, onTx }) {
  for (let i = 1; i <= count; i++) {
    const to = pickTo();
    const micro = toMicro(amount);
    try {
      const res = await client.sendTokens(from, to, coins(micro, DENOM), 'auto', '');
      onTx?.({ i, count, ok: true, to, hash: res.transactionHash });
    } catch (e) {
      onTx?.({ i, count, ok: false, to, err: e.message || String(e) });
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

export async function autoDelegate({ client, from, count, amount, validators, onTx }) {
  const list = validators.length ? validators : await fetchBondedValidators(200);
  for (let i = 1; i <= count; i++) {
    const val = list[Math.floor(Math.random() * list.length)].operator_address;
    try {
      const res = await client.delegateTokens(from, val, { denom: DENOM, amount: toMicro(amount) }, 'auto', '');
      onTx?.({ i, count, ok: true, val, hash: res.transactionHash });
    } catch (e) {
      onTx?.({ i, count, ok: false, val, err: e.message || String(e) });
    }
    await new Promise(r => setTimeout(r, 1200));
  }
}

export async function claimRewardsBatch({ client, from, onTx }) {
  const { total, perVal } = await fetchRewards(from);
  const positives = perVal.filter(x => Number(x.amount || '0') > 0);
  onTx?.({ phase: 'pre', total, validators: positives.length });

  if (!positives.length) {
    onTx?.({ phase: 'done', empty: true });
    return;
  }

  const validators = positives.map(x => x.validator);
  for (let i = 0; i < validators.length; i += CLAIM_CHUNK) {
    const chunk = validators.slice(i, i + CLAIM_CHUNK);
    const msgs = chunk.map(v => ({
      typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
      value: { delegatorAddress: from, validatorAddress: v }
    }));
    try {
      const res = await client.signAndBroadcast(from, msgs, 'auto');
      if (res.code === 0) onTx?.({ phase: 'batch', ok: true, range: [i + 1, Math.min(i + chunk.length, validators.length)], hash: res.transactionHash });
      else onTx?.({ phase: 'batch', ok: false, range: [i + 1, Math.min(i + chunk.length, validators.length)], err: res.rawLog });
    } catch (e) {
      onTx?.({ phase: 'batch', ok: false, range: [i + 1, Math.min(i + chunk.length, validators.length)], err: e.message || String(e) });
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  onTx?.({ phase: 'done' });
}
