// EMPE Testnet Auto Toolkit (Minimal Version)
// Fitur: Auto Transfer ke random address, Auto Delegate ke random validator, Auto Claim Rewards (+compound)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const inquirer = require('inquirer');
const { bech32 } = require('bech32');
const { fetch } = require('undici');
const { SigningStargateClient, GasPrice, coins } = require('@cosmjs/stargate');
const { DirectSecp256k1HdWallet } = require('@cosmjs/proto-signing');
const { Decimal } = require('@cosmjs/math');
require('dotenv').config();

// ===================== CONFIG =====================
const RPC        = 'https://rpc-testnet.empe.io';
const LCD        = 'https://lcd-testnet.empe.io';
const CHAIN_ID   = 'empe-testnet-2';
const DENOM      = 'uempe';
const EXPONENT   = 6;                          // 1 EMPE = 10^6 uempe
const GAS_PRICE  = `0.025${DENOM}`;
const PREFIX     = 'empe';
const ADDR_POOL_FILE = path.join(process.cwd(), 'addresses.txt');

// Rate limit defaults
const DEFAULT_TPM = 20;
const DEFAULT_BASE_DELAY = 2;
const DEFAULT_JITTER = 2;

// Safety
const BROADCAST_TIMEOUT_MS = 45000;
const SAFETY_BAL_BUFFER = Decimal.fromUserInput('0.01', EXPONENT).atomics;

// Validator thresholds
const MAX_COMMISSION = 0.20; 
const MIN_TOKENS_EMPE = 0;   

// Claim batching
const CLAIM_CHUNK = 16;
// ==========================================================================

function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }
function toMicro(amountHuman) { return Decimal.fromUserInput(String(amountHuman), EXPONENT).atomics; }
function fromMicro(atomics) { return Decimal.fromAtomics(String(atomics), EXPONENT).toString(); }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sample(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sumAtomics(a, b){ return (BigInt(a||'0') + BigInt(b||'0')).toString(); }

function generateRandomBech32(prefix = PREFIX) {
  const data = crypto.randomBytes(20);
  const words = bech32.toWords(data);
  return bech32.encode(prefix, words);
}

function loadAddressPool() {
  try {
    if (fs.existsSync(ADDR_POOL_FILE)) {
      const list = fs.readFileSync(ADDR_POOL_FILE, 'utf8')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && l.startsWith(PREFIX));
      if (list.length) return list;
    }
  } catch {}
  return null;
}

async function lcdJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'accept': 'application/json', ...(opts.headers||{}) }});
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`LCD ${r.status}: ${text}`);
  }
  return r.json();
}

async function getWalletAndAddr() {
  let mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    const { m } = await inquirer.prompt([
      { type: 'password', name: 'm', mask: '*', message: 'Masukkan MNEMONIC (seed phrase):' }
    ]);
    mnemonic = m.trim();
  }
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: PREFIX });
  const [account] = await wallet.getAccounts();
  return { wallet, address: account.address };
}

async function connectClient(wallet) {
  console.log(`Menghubungkan RPC: ${RPC}`);
  const client = await SigningStargateClient.connectWithSigner(RPC, wallet, {
    gasPrice: GasPrice.fromString(GAS_PRICE),
    broadcastTimeoutMs: BROADCAST_TIMEOUT_MS,
  });
  const netChainId = await client.getChainId();
  console.log(`Terhubung. ChainId: ${netChainId}`);
  return client;
}

async function getSpendableBalance(client, address) {
  try {
    const b = await client.getBalance(address, DENOM);
    return b?.amount ? b.amount : '0';
  } catch {
    return '0';
  }
}

async function fetchBondedValidators(limit = 300) {
  const url = `${LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=${limit}`;
  const j = await lcdJson(url);
  return (j.validators || []);
}

function isValidatorHealthy(v) {
  if (!v) return false;
  if (v.jailed) return false;
  if ((v.status || '').toUpperCase() !== 'BOND_STATUS_BONDED') return false;
  const rate = Number(v.commission?.commission_rates?.rate || '0');
  if (rate > MAX_COMMISSION) return false;
  const tokens = Number(fromMicro(v.tokens || '0'));
  if (MIN_TOKENS_EMPE > 0 && tokens < MIN_TOKENS_EMPE) return false;
  return true;
}

async function fetchAllRewards(delegatorAddr) {
  const url = `${LCD}/cosmos/distribution/v1beta1/delegators/${delegatorAddr}/rewards`;
  const j = await lcdJson(url);
  const perVal = (j.rewards || []).map(r => ({
    validator: r.validator_address,
    amount: (r.reward || []).find(c => c.denom === DENOM)?.amount || '0'
  }));
  const total = (j.total || []).find(c => c.denom === DENOM)?.amount || '0';
  return { total, perVal };
}

async function smartDelayLoop(iter, total, baseDelaySec, jitterSec, maxTpm){
  const minSpacing = Math.ceil(60 / Math.max(1, maxTpm));
  const base = Math.max(baseDelaySec, minSpacing);
  const jitter = jitterSec > 0 ? rndInt(-jitterSec, jitterSec) : 0;
  const wait = Math.max(0, base + jitter);
  if (iter < total) await sleep(wait * 1000);
}

// ---------------------- Actions ----------------------

async function actionAutoTransfer(client, fromAddr) {
  const pool = loadAddressPool();
  let getRandomTo;
  if (pool && pool.length) getRandomTo = () => sample(pool);
  else getRandomTo = () => generateRandomBech32(PREFIX);

  const { amount, count } = await inquirer.prompt([
    { type:'input', name:'amount', message:'Jumlah per tx (EMPE):', validate: v=>isFinite(Number(v))&&Number(v)>0 },
    { type:'number', name:'count', message:'Jumlah transaksi:' }
  ]);

  for (let i=1;i<=count;i++) {
    const to = getRandomTo();
    const micro = toMicro(amount);
    try {
      const res = await client.sendTokens(fromAddr, to, coins(micro, DENOM), 'auto', '');
      console.log(`(${i}/${count}) OK | txHash: ${res.transactionHash}`);
    } catch(e) {
      console.log(`(${i}/${count}) Gagal: ${e.message || e}`);
    }
    await smartDelayLoop(i, count, DEFAULT_BASE_DELAY, DEFAULT_JITTER, DEFAULT_TPM);
  }
}

async function actionAutoDelegate(client, delegatorAddr) {
  const validators = (await fetchBondedValidators(200)).filter(isValidatorHealthy);
  if (!validators.length) {
    console.log('Tidak ada validator sehat.');
    return;
  }
  const { amount, count } = await inquirer.prompt([
    { type:'input', name:'amount', message:'Jumlah per delegasi (EMPE):', validate: v=>isFinite(Number(v))&&Number(v)>0 },
    { type:'number', name:'count', message:'Jumlah transaksi delegasi:' }
  ]);

  for (let i=1;i<=count;i++) {
    const val = sample(validators).operator_address;
    const micro = toMicro(amount);
    try {
      const res = await client.delegateTokens(delegatorAddr, val, { denom: DENOM, amount: micro }, 'auto', '');
      console.log(`(${i}/${count}) OK delegate -> ${val} | txHash: ${res.transactionHash}`);
    } catch(e) {
      console.log(`(${i}/${count}) Gagal: ${e.message || e}`);
    }
    await smartDelayLoop(i, count, DEFAULT_BASE_DELAY, DEFAULT_JITTER, DEFAULT_TPM);
  }
}

async function actionClaimRewards(client, delegatorAddr) {
  const { total, perVal } = await fetchAllRewards(delegatorAddr);
  console.log(`Total rewards: ${Decimal.fromUserInput(total || '0', EXPONENT).toString()} EMPE`);
  const validators = perVal.filter(x=>Number(x.amount)>0).map(x=>x.validator);
  if (!validators.length) {
    console.log('Tidak ada rewards.');
    return;
  }
  for (let i=0; i<validators.length; i+=CLAIM_CHUNK) {
    const chunk = validators.slice(i, i+CLAIM_CHUNK);
    const msgs = chunk.map(v => ({
      typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
      value: { delegatorAddress: delegatorAddr, validatorAddress: v }
    }));
    try {
      const res = await client.signAndBroadcast(delegatorAddr, msgs, 'auto');
      if (res.code === 0) console.log(`Claim OK | txHash: ${res.transactionHash}`);
      else console.log(`Claim gagal code ${res.code}: ${res.rawLog}`);
    } catch(e) {
      console.log(`Claim error: ${e.message || e}`);
    }
    await sleep(1500);
  }
}

// ---------------------- Main ----------------------

(async () => {
  try {
    const { wallet, address } = await getWalletAndAddr();
    const client = await connectClient(wallet);

    while (true) {
      const { action } = await inquirer.prompt([
        { type:'list', name:'action', message:'Pilih aksi:', choices:[
          { name:'1) Auto Transfer', value:'transfer' },
          { name:'2) Auto Delegate', value:'delegate' },
          { name:'3) Auto Claim Rewards', value:'claim' },
          { name:'Keluar', value:'exit' }
        ]}
      ]);
      if (action==='exit') break;
      if (action==='transfer') await actionAutoTransfer(client, address);
      if (action==='delegate') await actionAutoDelegate(client, address);
      if (action==='claim') await actionClaimRewards(client, address);
    }
    console.log('Bye');
    client.disconnect();
  } catch(e) {
    console.error('Error fatal:', e.message || e);
    process.exit(1);
  }
})();
