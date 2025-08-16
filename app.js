
import 'dotenv/config';
import CryptoBotUI from './ui/CryptoBotUI.js';
import {
  connectWithMnemonic, getBalance, genRandomAddress,
  autoTransfer, autoDelegate, claimRewardsBatch,
  fetchBondedValidators, RPC, LCD, CHAIN_ID, DENOM, GAS_PRICE, EXPONENT, fromMicro
} from './core/empeCore.js';


function askUIInput(ui, label, initial = '') {
  return new Promise(resolve => {
    const box = ui.screen.spawn ? ui.screen.spawn() : null;
    const modal = require('blessed').form({
      parent: ui.screen,
      keys: true, mouse: true, left: 'center', top: 'center', width: '60%', height: 7,
      border: 'line', label: ` ${label} `, style: { border: { fg: ui.opts.colors.info } }, padding: 1
    });
    const input = require('blessed').textbox({
      parent: modal, name: 'value', inputOnFocus: true, height: 3, top: 1, left: 1, right: 1, value: String(initial)
    });
    const hint = require('blessed').text({
      parent: modal, top: 4, left: 1, content: 'Enter=OK  Esc=Cancel'
    });

    const cleanup = (val) => { try { modal.destroy(); ui.render(); } catch {} resolve(val); };
    modal.key(['escape'], () => cleanup(null));
    modal.key(['enter'], () => input.submit());
    input.on('submit', v => cleanup(v?.trim()));
    input.focus(); ui.render();
  });
}

function askUINumber(ui, label, initial = 1) {
  return askUIInput(ui, label, String(initial)).then(v => (v == null ? null : Number(v)));
}

function askUIConfirm(ui, label, def = true) {
  return new Promise(resolve => {
    const modal = require('blessed').box({
      parent: ui.screen, keys: true, mouse: true, left: 'center', top: 'center', width: '50%', height: 7,
      border: 'line', label: ` ${label} `, style: { border: { fg: ui.opts.colors.warning } }, padding: 1,
      content: 'Y = Yes, N = No'
    });
    const cleanup = (val) => { try { modal.destroy(); ui.render(); } catch {} resolve(val); };
    modal.key(['y','Y','enter'], () => cleanup(true));
    modal.key(['n','N','escape'], () => cleanup(false));
    modal.focus(); ui.render();
  });
}


const ui = new CryptoBotUI({
  title: 'EMPE Testnet Bot',
  tickerText1: 'EMPE TESTNET',
  tickerText2: 'Join Telegram Channel : Invictuslabs - Airdrops',
  menuItems: [
    '1) Auto Transfer',
    '2) Auto Delegate',
    '3) Auto Claim Rewards',
    '4) Exit'
  ],
  nativeSymbol: 'EMPE'
});


const stats = { total: 0, ok: 0, fail: 0, pending: 0 };
function pushTxLog(ok) {
  stats.total += 1;
  if (ok) stats.ok += 1; else stats.fail += 1;
  const rate = stats.total ? (stats.ok / stats.total) * 100 : 100;
  ui.updateStats({ transactionCount: stats.total, successRate: rate.toFixed(1), failedTx: stats.fail, pendingTx: stats.pending });
}

let client, address;

(async function boot() {
  try {
    if (!process.env.MNEMONIC) {
      ui.log('error', 'MNEMONIC tidak ada di .env'); return;
    }
    const con = await connectWithMnemonic(process.env.MNEMONIC);
    client = con.client; address = con.address;

    const bal = await getBalance(client, address);
    ui.updateWallet({
      address,
      nativeBalance: `${fromMicro(bal)} EMPE`,
      network: `${CHAIN_ID} (RPC: ${RPC})`,
      gasPrice: GAS_PRICE,
      nonce: '-' 
    });

    ui.setMenu([
      '1) Auto Transfer',
      '2) Auto Delegate',
      '3) Auto Claim Rewards',
      '4) Exit'
    ]);

    ui.on('menu:select', async (label) => {
      const choice = String(label).trim().toLowerCase();
      if (choice.startsWith('1)')) return handleTransfer();
      if (choice.startsWith('2)')) return handleDelegate();
      if (choice.startsWith('3)')) return handleClaim();
      if (choice.startsWith('4)')) return ui.destroy(0);
    });

    ui.setActive(false);
    ui.render();
  } catch (e) {
    ui.log('error', `Init gagal: ${e.message || e}`); 
  }
})();

// ====== Handlers ======
async function handleTransfer() {
  const amount = await askUIInput(ui, 'Jumlah per tx (EMPE)', '0.001');
  if (amount == null || Number(amount) <= 0) return;

  const count = await askUINumber(ui, 'Jumlah transaksi', 3);
  if (!count || count <= 0) return;

  const confirm = await askUIConfirm(ui, `Kirim ${amount} EMPE x ${count} ke random address?`);
  if (!confirm) return;

  ui.setActive(true);
  ui.log('info', `Mulai AUTO TRANSFER ${count}x @ ${amount} EMPE`);
  stats.pending += count; ui.updateStats({ pendingTx: stats.pending });

  await autoTransfer({
    client, from: address, count, amount,
    pickTo: () => genRandomAddress(),
    onTx: ({ i, count, ok, to, hash, err }) => {
      if (ok) {
        ui.log('success', `(Transfer ${i}/${count}) txHash: ${hash} -> ${to}`);
      } else {
        ui.log('error', `(Transfer ${i}/${count}) gagal -> ${to} | ${err}`);
      }
      pushTxLog(ok);
      stats.pending -= 1; ui.updateStats({ pendingTx: stats.pending });
    }
  });

  const bal = await getBalance(client, address);
  ui.updateWallet({ nativeBalance: `${fromMicro(bal)} EMPE` });
  ui.setActive(false);
}

async function handleDelegate() {
  const amount = await askUIInput(ui, 'Jumlah per delegasi (EMPE)', '0.1');
  if (amount == null || Number(amount) <= 0) return;

  const count = await askUINumber(ui, 'Berapa kali delegasi?', 3);
  if (!count || count <= 0) return;

  ui.setActive(true);
  ui.log('stake', `Mengambil validator BONDED ...`);
  const vals = await fetchBondedValidators(200).catch(e => { ui.log('error', `Fetch validators gagal: ${e.message||e}`); return []; });
  if (!vals.length) { ui.setActive(false); return; }

  ui.log('stake', `Mulai AUTO DELEGATE ${count}x @ ${amount} EMPE`);
  stats.pending += count; ui.updateStats({ pendingTx: stats.pending });

  await autoDelegate({
    client, from: address, count, amount, validators: vals,
    onTx: ({ i, count, ok, val, hash, err }) => {
      if (ok) ui.log('success', `(Delegate ${i}/${count}) -> ${val} | txHash: ${hash}`);
      else ui.log('error', `(Delegate ${i}/${count}) -> ${val} | ${err}`);
      pushTxLog(ok);
      stats.pending -= 1; ui.updateStats({ pendingTx: stats.pending });
    }
  });

  const bal = await getBalance(client, address);
  ui.updateWallet({ nativeBalance: `${fromMicro(bal)} EMPE` });
  ui.setActive(false);
}

async function handleClaim() {
  ui.setActive(true);
  ui.log('info', 'Cek rewards ...');

  await claimRewardsBatch({
    client, from: address,
    onTx: (evt) => {
      if (evt.phase === 'pre') {
        ui.log('info', `Total rewards (approx): ~${evt.total} ${DENOM} | validators: ${evt.validators}`);
      } else if (evt.phase === 'batch') {
        if (evt.ok) {
          ui.log('success', `Claim ${evt.range[0]}-${evt.range[1]} OK | txHash: ${evt.hash}`);
          pushTxLog(true);
        } else {
          ui.log('error', `Claim ${evt.range[0]}-${evt.range[1]} Gagal: ${evt.err}`);
          pushTxLog(false);
        }
      } else if (evt.phase === 'done' && evt.empty) {
        ui.log('warning', 'Tidak ada rewards untuk diklaim.');
      } else if (evt.phase === 'done') {
        ui.log('completed', 'Claim selesai.');
      }
    }
  });

  const bal = await getBalance(client, address);
  ui.updateWallet({ nativeBalance: `${fromMicro(bal)} EMPE` });
  ui.setActive(false);
}
