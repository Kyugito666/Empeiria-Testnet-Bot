import fs from 'fs';
import blessed from 'blessed';
import CryptoBotUI from './CryptoBotUI.js';
import { bech32 } from 'bech32';
import { Decimal } from '@cosmjs/math';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, GasPrice, coins } from '@cosmjs/stargate';
import { fetch } from 'undici';
import crypto from 'crypto';

const RPC = 'https://rpc-testnet.empe.io';
const LCD = 'https://lcd-testnet.empe.io';
const CHAIN_ID = 'empe-testnet-2';
const DENOM = 'uempe';
const EXPONENT = 6;
const GAS_PRICE = `0.025${DENOM}`;
const PREFIX = 'empe';
const CLAIM_CHUNK = 16;
const BROADCAST_TIMEOUT_MS = 45000;
const DELAY_BETWEEN_WALLETS_MS = 5000; // 5 detik jeda antar wallet

const toMicro = (x) => Decimal.fromUserInput(String(x), EXPONENT).atomics;
const fromMicro = (a) => Decimal.fromAtomics(String(a || '0'), EXPONENT).toString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const genRandomAddress = (prefix = PREFIX) => {
    const data = crypto.randomBytes(20);
    const words = bech32.toWords(data);
    return bech32.encode(prefix, words);
};

async function lcdJson(url) {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`LCD ${r.status}`);
    return r.json();
}
async function fetchBondedValidators(limit = 300) {
    const j = await lcdJson(`${LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=${limit}`);
    return (j.validators || []).filter(v => !v.jailed)
        .filter(v => (v.status || '').toUpperCase() === 'BOND_STATUS_BONDED');
}
async function fetchRewards(delegator) {
    const j = await lcdJson(`${LCD}/cosmos/distribution/v1beta1/delegators/${delegator}/rewards`);
    const perVal = (j.rewards || []).map(r => ({
        validator: r.validator_address,
        amount: (r.reward || []).find(c => c.denom === DENOM)?.amount || '0'
    }));
    const total = (j.total || []).find(c => c.denom === DENOM)?.amount || '0';
    return { total, perVal };
}
async function getBalance(client, address) {
    const b = await client.getBalance(address, DENOM).catch(() => ({ amount: '0' }));
    return b?.amount || '0';
}
async function fetchAccountMeta(address) {
    const j = await lcdJson(`${LCD}/cosmos/auth/v1beta1/accounts/${address}`);
    const acc = j?.account || j?.base_account || j?.baseAccount || {};
    const base = acc?.base_account || acc;
    const accountNumber = String(base?.account_number ?? '0');
    const sequence = String(base?.sequence ?? '0');
    return { accountNumber, sequence };
}

function askText(ui, label, initial = '') {
    return new Promise((resolve) => {
        const modal = blessed.form({
            parent: ui.screen, keys: true, mouse: true,
            left: 'center', top: 'center', width: '60%', height: 7,
            border: 'line', label: ` ${label} `, padding: 1
        });
        const input = blessed.textbox({
            parent: modal, name: 'value', inputOnFocus: true,
            height: 3, top: 1, left: 1, right: 1, value: String(initial)
        });
        blessed.text({ parent: modal, top: 4, left: 1, content: 'Enter=OK  Esc=Cancel' });
        const done = (val) => { try { modal.destroy(); ui.render(); } catch {} resolve(val); };
        modal.key(['escape'], () => done(null));
        modal.key(['enter'], () => input.submit());
        input.on('submit', v => done(v?.trim()));
        input.focus(); ui.render();
    });
}
function askNumber(ui, label, initial = 1) {
    return askText(ui, label, String(initial)).then(v => (v == null ? null : Number(v)));
}
function askConfirm(ui, label) {
    return new Promise((resolve) => {
        const modal = blessed.box({
            parent: ui.screen, keys: true, mouse: true,
            left: 'center', top: 'center', width: '50%', height: 7,
            border: 'line', label: ` ${label} `, padding: 1,
            content: 'Y = Yes, N = No'
        });
        const done = (val) => { try { modal.destroy(); ui.render(); } catch {} resolve(val); };
        modal.key(['y', 'Y', 'enter'], () => done(true));
        modal.key(['n', 'N', 'escape'], () => done(false));
        modal.focus(); ui.render();
    });
}

const ui = new CryptoBotUI({
    title: 'EMPE Testnet Bot (Multi-Wallet)',
    tickerText1: 'EMPE TESTNET',
    tickerText2: 'Join Telegram Channel : Invictuslabs - Airdrops',
    menuItems: [
        '1) Auto Transfer (Semua Wallet)',
        '2) Auto Delegate (Semua Wallet)',
        '3) Auto Claim Rewards (Semua Wallet)',
        '4) Exit'
    ],
    nativeSymbol: 'EMPE'
});

const stats = { total: 0, ok: 0, fail: 0, pending: 0 };
function pushStat(ok) {
    stats.total += 1;
    if (ok) stats.ok += 1; else stats.fail += 1;
    const rate = stats.total ? (stats.ok / stats.total) * 100 : 100;
    ui.updateStats({
        transactionCount: stats.total,
        successRate: Number(rate.toFixed(1)),
        failedTx: stats.fail,
        pendingTx: stats.pending
    });
}

let wallets = []; // Array to store all wallet clients and addresses

async function refreshWalletUI(walletIndex = 0) {
    if (wallets.length === 0) return;
    const { client, address } = wallets[walletIndex];
    if (!client || !address) return;

    try {
        const [bal, meta] = await Promise.all([
            getBalance(client, address),
            fetchAccountMeta(address)
        ]);
        const shortAddress = `${address.substring(0, 10)}...${address.substring(address.length - 4)}`;
        ui.updateWallet({
            address: `Wallet ${walletIndex + 1}/${wallets.length} | ${shortAddress}`,
            nativeBalance: `${fromMicro(bal)} EMPE`,
            network: `${CHAIN_ID}`,
            gasPrice: GAS_PRICE,
            nonce: meta.sequence
        });
    } catch (e) {
        const bal = await getBalance(client, address).catch(() => '0');
        const shortAddress = `${address.substring(0, 10)}...${address.substring(address.length - 4)}`;
        ui.updateWallet({
            address: `Wallet ${walletIndex + 1}/${wallets.length} | ${shortAddress}`,
            nativeBalance: `${fromMicro(bal)} EMPE`,
            network: `${CHAIN_ID}`,
            gasPrice: GAS_PRICE,
            nonce: '-'
        });
    }
}

function loadMnemonics() {
    try {
        const data = fs.readFileSync('mnemonics.txt', 'utf8');
        return data.split('\n').map(line => line.trim()).filter(line => line);
    } catch (error) {
        ui.log('error', 'Gagal membaca mnemonics.txt. Pastikan file ada dan berisi seed phrase.');
        return [];
    }
}

async function connectAllWallets() {
    const mnemonics = loadMnemonics();
    if (mnemonics.length === 0) {
        ui.log('error', 'Tidak ada mnemonic yang ditemukan di mnemonics.txt.');
        return;
    }

    ui.log('info', `Menghubungkan ${mnemonics.length} wallet...`);

    for (const mnemonic of mnemonics) {
        try {
            const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic.trim(), { prefix: PREFIX });
            const [acc] = await wallet.getAccounts();
            const client = await SigningStargateClient.connectWithSigner(RPC, wallet, {
                gasPrice: GasPrice.fromString(GAS_PRICE),
                broadcastTimeoutMs: BROADCAST_TIMEOUT_MS
            });
            wallets.push({ client, address: acc.address, mnemonic });
        } catch (e) {
            ui.log('error', `Gagal menghubungkan salah satu wallet: ${e.message}`);
        }
    }

    if (wallets.length > 0) {
        const netChainId = await wallets[0].client.getChainId();
        ui.log('success', `Terhubung ke ${netChainId}. ${wallets.length} wallet berhasil dimuat.`);
        await refreshWalletUI(0);
    } else {
        ui.log('error', 'Tidak ada wallet yang berhasil terhubung.');
    }
}

await connectAllWallets();
setInterval(() => { refreshWalletUI(0); }, 15000);

ui.on('menu:select', async (label) => {
    const text = String(label).toLowerCase();
    if (text.startsWith('1)')) return handleTransfer();
    if (text.startsWith('2)')) return handleDelegate();
    if (text.startsWith('3)')) return handleClaim();
    if (text.startsWith('4)')) return ui.destroy(0);
});

async function handleTransfer() {
    if (wallets.length === 0) return ui.log('error', 'Tidak ada wallet yang terhubung.');
    const amount = await askText(ui, 'Jumlah per tx (EMPE)', '0.001');
    if (amount == null || Number(amount) <= 0) return;
    const count = await askNumber(ui, 'Jumlah transaksi per wallet', 3);
    if (!count || count <= 0) return;
    const ok = await askConfirm(ui, `Kirim ${amount} EMPE x ${count} kali untuk SEMUA wallet?`);
    if (!ok) return;

    ui.setActive(true);
    ui.log('info', `Mulai AUTO TRANSFER untuk ${wallets.length} wallet...`);

    for (let i = 0; i < wallets.length; i++) {
        const { client, address } = wallets[i];
        await refreshWalletUI(i);
        ui.log('info', `Memproses Wallet ${i + 1}/${wallets.length}: ${address}`);

        stats.pending += count;
        ui.updateStats({ pendingTx: stats.pending });

        for (let j = 1; j <= count; j++) {
            const to = genRandomAddress();
            const micro = toMicro(amount);
            try {
                const res = await client.sendTokens(address, to, coins(micro, DENOM), 'auto', '');
                ui.log('success', `(Wallet ${i+1} | Tx ${j}/${count}) -> ${to} | txHash: ${res.transactionHash}`);
                pushStat(true);
            } catch (e) {
                ui.log('error', `(Wallet ${i+1} | Tx ${j}/${count}) gagal -> ${to} | ${e.message || e}`);
                pushStat(false);
            }
            stats.pending -= 1;
            ui.updateStats({ pendingTx: stats.pending });
            await sleep(1000);
        }

        if (i < wallets.length - 1) {
            ui.log('info', `Jeda ${DELAY_BETWEEN_WALLETS_MS / 1000} detik sebelum wallet berikutnya...`);
            await sleep(DELAY_BETWEEN_WALLETS_MS);
        }
    }

    await refreshWalletUI(0);
    ui.setActive(false);
    ui.log('success', 'Semua proses transfer selesai.');
}

async function handleDelegate() {
    if (wallets.length === 0) return ui.log('error', 'Tidak ada wallet yang terhubung.');
    const amount = await askText(ui, 'Jumlah per delegasi (EMPE)', '0.1');
    if (amount == null || Number(amount) <= 0) return;
    const count = await askNumber(ui, 'Berapa kali delegasi per wallet?', 3);
    if (!count || count <= 0) return;

    ui.setActive(true);
    ui.log('stake', 'Mengambil validator BONDED ...');
    let validators = [];
    try {
        validators = await fetchBondedValidators(200);
        ui.log('info', `Validator bonded: ${validators.length}`);
    } catch (e) {
        ui.log('error', `Gagal ambil validator: ${e.message || e}`);
        ui.setActive(false);
        return;
    }
    if (!validators.length) { ui.setActive(false); return; }

    ui.log('stake', `Mulai AUTO DELEGATE untuk ${wallets.length} wallet...`);

    for (let i = 0; i < wallets.length; i++) {
        const { client, address } = wallets[i];
        await refreshWalletUI(i);
        ui.log('info', `Memproses Wallet ${i + 1}/${wallets.length}: ${address}`);

        stats.pending += count;
        ui.updateStats({ pendingTx: stats.pending });

        for (let j = 1; j <= count; j++) {
            const val = validators[Math.floor(Math.random() * validators.length)].operator_address;
            try {
                const res = await client.delegateTokens(address, val, { denom: DENOM, amount: toMicro(amount) }, 'auto', '');
                ui.log('success', `(Wallet ${i+1} | Delegate ${j}/${count}) -> ${val} | txHash: ${res.transactionHash}`);
                pushStat(true);
            } catch (e) {
                ui.log('error', `(Wallet ${i+1} | Delegate ${j}/${count}) -> ${val} | ${e.message || e}`);
                pushStat(false);
            }
            stats.pending -= 1;
            ui.updateStats({ pendingTx: stats.pending });
            await sleep(1200);
        }

        if (i < wallets.length - 1) {
            ui.log('info', `Jeda ${DELAY_BETWEEN_WALLETS_MS / 1000} detik sebelum wallet berikutnya...`);
            await sleep(DELAY_BETWEEN_WALLETS_MS);
        }
    }

    await refreshWalletUI(0);
    ui.setActive(false);
    ui.log('success', 'Semua proses delegasi selesai.');
}

async function handleClaim() {
    if (wallets.length === 0) return ui.log('error', 'Tidak ada wallet yang terhubung.');
    const ok = await askConfirm(ui, 'Mulai proses klaim rewards untuk SEMUA wallet?');
    if (!ok) return;

    ui.setActive(true);
    ui.log('info', `Mulai AUTO CLAIM untuk ${wallets.length} wallet...`);

    for (let i = 0; i < wallets.length; i++) {
        const { client, address } = wallets[i];
        await refreshWalletUI(i);
        ui.log('info', `Memproses Wallet ${i + 1}/${wallets.length}: ${address}`);

        let total = '0', perVal = [];
        try {
            const r = await fetchRewards(address);
            total = r.total; perVal = r.perVal;
        } catch (e) {
            ui.log('error', `(Wallet ${i+1}) Gagal baca rewards: ${e.message || e}`);
            continue; // Lanjut ke wallet berikutnya
        }

        const validatorsToClaim = perVal.filter(x => Number(x.amount || '0') > 0).map(x => x.validator);
        if (!validatorsToClaim.length) {
            ui.log('warning', `(Wallet ${i+1}) Tidak ada rewards untuk diklaim.`);
            continue; // Lanjut ke wallet berikutnya
        }

        ui.log('info', `(Wallet ${i+1}) Klaim dari ${validatorsToClaim.length} validator (batch ${CLAIM_CHUNK}) ...`);
        for (let j = 0; j < validatorsToClaim.length; j += CLAIM_CHUNK) {
            const chunk = validatorsToClaim.slice(j, j + CLAIM_CHUNK);
            const msgs = chunk.map(v => ({
                typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
                value: { delegatorAddress: address, validatorAddress: v }
            }));
            try {
                const res = await client.signAndBroadcast(address, msgs, 'auto');
                if (res.code === 0) {
                    ui.log('success', `(Wallet ${i+1}) Claim batch ${j+1}-${Math.min(j+chunk.length, validatorsToClaim.length)} OK | txHash: ${res.transactionHash}`);
                    pushStat(true);
                } else {
                    ui.log('error', `(Wallet ${i+1}) Claim batch Gagal: ${res.rawLog}`);
                    pushStat(false);
                }
            } catch (e) {
                ui.log('error', `(Wallet ${i+1}) Claim batch error: ${e.message || e}`);
                pushStat(false);
            }
            await sleep(1200);
        }

        if (i < wallets.length - 1) {
            ui.log('info', `Jeda ${DELAY_BETWEEN_WALLETS_MS / 1000} detik sebelum wallet berikutnya...`);
            await sleep(DELAY_BETWEEN_WALLETS_MS);
        }
    }

    await refreshWalletUI(0);
    ui.setActive(false);
    ui.log('success', 'Semua proses klaim selesai.');
}
