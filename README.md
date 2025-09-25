-----

# Empeiria Testnet Bot (Multi-Wallet)

Bot otomatisasi berbasis Node.js untuk **Empeiria Testnet (chain berbasis Cosmos SDK)**. Bot ini dirancang untuk menyederhanakan interaksi Anda dengan jaringan melalui antarmuka terminal (TUI) yang simpel dan dukungan untuk banyak wallet sekaligus.

# Tutorial Lengkap & Komunitas: Gabung Channel Telegram [Invictuslabs](https://t.me/invictuslabs)

<img width="1467" height="797" alt="Screenshot 2025-08-16 152526" src="https://github.com/user-attachments/assets/2ef494aa-53ef-41aa-a947-52dabad8fafe" />

-----

## ✨ Fitur Utama ✨

Bot ini menyediakan beberapa fitur inti yang berjalan secara otomatis untuk semua wallet Anda:

  - **✅ Dukungan Multi-Wallet**: Jalankan semua fitur secara otomatis untuk setiap *seed phrase* yang Anda daftarkan di file `mnemonics.txt`. Bot akan memproses wallet satu per satu secara berurutan.

  - **📤 Auto Transfer**: Mengirim token native **EMPE** ke alamat-alamat random yang dibuat secara otomatis.

  - **🏦 Auto Delegate**: Mendelegasikan token **EMPE** secara otomatis ke validator *bonded* yang dipilih secara acak untuk memaksimalkan potensi airdrop.

  - **💰 Auto Claim Rewards**: Mengklaim imbalan (rewards) staking dari semua validator tempat Anda mendelegasikan. Proses ini dilakukan secara *batch* untuk menghemat biaya gas.

-----

## ⚙️ Cara Penggunaan

### 1\. Persyaratan

  - [Node.js](https://nodejs.org/) versi 18 atau yang lebih baru.
  - NPM (terinstal bersama Node.js).
  - Satu atau lebih wallet di **Empeiria Testnet** yang sudah memiliki saldo.

### 2\. Instalasi

1.  *Clone* atau unduh repositori ini.
2.  Buka terminal di dalam folder proyek.
3.  Jalankan perintah ini untuk menginstal semua paket yang dibutuhkan:
    ```bash
    git clone https://github.com/Kyugito666/Empeiria-Testnet-Bot
    cd Empeiria-Testnet-Bot
    ```
    ```bash
    npm install
    ```

### 3\. Konfigurasi Wallet (Multi-Wallet)

Bot ini sekarang menggunakan file `mnemonics.txt` untuk mengelola semua wallet Anda.

1.  Buat file baru di folder yang sama dengan `kazmight.js` dan beri nama **`mnemonics.txt`**.

2.  Masukkan semua *seed phrase* (mnemonic) Anda ke dalam file tersebut.

3.  **Penting**: Setiap *seed phrase* harus berada di baris baru.

    **Contoh isi `mnemonics.txt`:**

    ```
    word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12
    another seed phrase for the second wallet goes on this new line
    seed phrase wallet ketiga dan seterusnya di baris baru
    ```

    **Catatan**: File `.env` tidak lagi digunakan untuk menyimpan `MNEMONIC`.

### 4\. Menjalankan Bot

Setelah semua persiapan selesai, jalankan bot dengan perintah:

```bash
npm start
```

Antarmuka bot akan muncul di terminal Anda, dan semua wallet dari `mnemonics.txt` akan dimuat secara otomatis. Pilih menu yang diinginkan, dan bot akan menjalankannya untuk semua wallet Anda.

-----

## ⚠️ Penafian (Disclaimer)

**Gunakan dengan risiko Anda sendiri.** Menyimpan *seed phrase* dalam bentuk teks biasa memiliki risiko keamanan. Penulis skrip tidak bertanggung jawab atas kehilangan dana atau masalah apa pun yang mungkin terjadi. Selalu gunakan wallet yang didedikasikan untuk aktivitas semacam ini (misalnya, wallet khusus airdrop).

-----

## ©️ Kredit dan Atribusi

Skrip ini adalah karya asli dari **Kazmight** dan komunitas **Invictuslabs**. Modifikasi untuk fungsionalitas multi-wallet dilakukan untuk meningkatkan efisiensi dan kemudahan penggunaan. Terima kasih kepada kreator asli atas kerja keras mereka.
