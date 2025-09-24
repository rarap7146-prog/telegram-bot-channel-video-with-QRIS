const ContentPurchase = require('./content-purchase');

class ConsumerHandlers {
    constructor(bot, db, userSessions, qrisHandler) {
        this.bot = bot;
        this.db = db;
        this.userSessions = userSessions;
        this.qrisHandler = qrisHandler;
        this.contentPurchase = new ContentPurchase(bot, db, userSessions, qrisHandler);
    }

    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;

        // Check if this is a deep link for content purchase
        const deepLinkMatch = text.match(/\/start content_(\d+)/);
        if (deepLinkMatch) {
            const contentId = deepLinkMatch[1];
            return await this.contentPurchase.handleContentDeepLink(chatId, userId, contentId);
        }

        // Regular start command
        const user = msg.from;
        await this.ensureUserExists(userId, user);

        const welcomeText = `
🎬 **Selamat datang di PapaBadak Creator Bot!**

Halo ${user.first_name}! 👋

Bot ini memungkinkan Anda untuk:
🛒 **Membeli konten premium** dari creator favorit
💳 **Top-up saldo** untuk pembelian
📱 **Mengelola akun** dan riwayat pembelian

💡 **Cara kerja:**
1. Creator akan mengirim link konten
2. Klik link untuk melihat detail & harga
3. Beli dengan saldo atau scan QRIS
4. Nikmati konten premium Anda!

Ketik /help untuk melihat semua perintah yang tersedia.
        `;

        await this.bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💳 Cek Saldo', callback_data: 'check_balance' },
                        { text: '📊 Top-up', callback_data: 'topup_balance' }
                    ],
                    [
                        { text: '📱 Akun Saya', callback_data: 'my_account' },
                        { text: '📋 Riwayat', callback_data: 'purchase_history' }
                    ]
                ]
            }
        });
    }

    async handleHelp(msg) {
        const chatId = msg.chat.id;
        
        const helpText = `
📖 **Bantuan PapaBadak Creator Bot**

**Perintah Utama:**
/start - Mulai menggunakan bot
/balance - Cek saldo Anda
/history - Lihat riwayat pembelian
/topup - Top-up saldo
/help - Tampilkan bantuan ini

**Cara Membeli Konten:**
1. 🔗 Klik link konten dari creator
2. 👀 Lihat detail dan harga konten
3. 💰 Pilih metode pembayaran (saldo/QRIS)
4. ✅ Konfirmasi pembayaran
5. 📥 Terima konten langsung di chat

**Pembayaran:**
💳 **Saldo** - Bayar langsung dari saldo Anda
📱 **QRIS** - Scan QR code untuk pembayaran
⏰ **Timeout** - Pembayaran QRIS berlaku 10 menit

**Butuh Bantuan?**
Hubungi admin: @techsupport_papa

💡 **Tips:** Pastikan saldo mencukupi untuk pembelian lebih cepat!
        `;

        await this.bot.sendMessage(chatId, helpText, {
            parse_mode: 'Markdown'
        });
    }

    async handleBalance(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        try {
            const user = await this.getUserFromConsumerDB(userId);
            const balance = user ? parseFloat(user.balance_idr) : 0;

            const formatCurrency = (amount) => new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
            }).format(amount);

            const balanceText = `
💳 **Saldo Anda**

💰 **Current Balance:** ${formatCurrency(balance)}

${balance > 0 ? 
    '✅ Saldo mencukupi untuk membeli konten!' : 
    '⚠️ Saldo kosong. Silakan top-up untuk membeli konten.'
}

📊 **Cara Top-up:**
• Klik tombol "Top-up Saldo" di bawah
• Pilih nominal yang diinginkan
• Scan QRIS untuk pembayaran
• Saldo akan masuk otomatis

💡 **Tips:** Top-up lebih banyak untuk diskon khusus!
            `;

            await this.bot.sendMessage(chatId, balanceText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📊 Top-up Saldo', callback_data: 'topup_balance' }],
                        [{ text: '📋 Riwayat Transaksi', callback_data: 'transaction_history' }]
                    ]
                }
            });

        } catch (error) {
            console.error('Error checking balance:', error);
            await this.bot.sendMessage(chatId, 
                '❌ **Terjadi kesalahan**\n\nGagal mengecek saldo. Silakan coba lagi.',
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handleTopup(msg) {
        const chatId = msg.chat.id;
        
        const topupText = `
📊 **Top-up Saldo**

Pilih nominal top-up yang Anda inginkan:

💰 **Paket Top-up:**
• Rp 25.000 - Untuk 1-2 konten
• Rp 50.000 - Untuk 3-5 konten  
• Rp 100.000 - Untuk 8-10 konten
• Rp 200.000 - Untuk 15-20 konten + bonus 5%
• Rp 500.000 - Untuk 40+ konten + bonus 10%

🎁 **Bonus:**
• Top-up ≥ Rp 200.000 dapat bonus 5%
• Top-up ≥ Rp 500.000 dapat bonus 10%

📱 **Metode Pembayaran:** QRIS (semua e-wallet & mobile banking)
        `;

        await this.bot.sendMessage(chatId, topupText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Rp 25.000', callback_data: 'topup_25000' },
                        { text: 'Rp 50.000', callback_data: 'topup_50000' }
                    ],
                    [
                        { text: 'Rp 100.000', callback_data: 'topup_100000' },
                        { text: 'Rp 200.000', callback_data: 'topup_200000' }
                    ],
                    [
                        { text: 'Rp 500.000', callback_data: 'topup_500000' }
                    ],
                    [
                        { text: '💳 Cek Saldo', callback_data: 'check_balance' }
                    ]
                ]
            }
        });
    }

    async handleHistory(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        try {
            // Mock purchase history - in real implementation, query from database
            const historyText = `
📋 **Riwayat Pembelian**

${this.generateMockHistory(userId)}

💡 **Konten yang sudah dibeli dapat diakses kembali kapan saja.**
            `;

            await this.bot.sendMessage(chatId, historyText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '💳 Cek Saldo', callback_data: 'check_balance' },
                            { text: '📊 Top-up', callback_data: 'topup_balance' }
                        ]
                    ]
                }
            });

        } catch (error) {
            console.error('Error getting history:', error);
            await this.bot.sendMessage(chatId, 
                '❌ **Terjadi kesalahan**\n\nGagal mengambil riwayat. Silakan coba lagi.',
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handleCallbackQuery(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const data = query.data;

        try {
            // Balance check
            if (data === 'check_balance') {
                return await this.handleBalanceCallback(query);
            }

            // Top-up related callbacks
            if (data === 'topup_balance' || data.startsWith('topup_balance_')) {
                // Extract content ID if present (topup_balance_123)
                const contentId = data.startsWith('topup_balance_') ? data.split('_')[2] : null;
                return await this.handleTopupCallback(query, contentId);
            }

            if (data.startsWith('topup_')) {
                const parts = data.split('_');
                const amount = parseInt(parts[1]);
                const contentId = parts.length > 2 ? parts[2] : null; // Extract content ID if present
                return await this.handleTopupAmountCallback(query, amount, contentId);
            }

            // Content purchase callbacks
            if (data.startsWith('purchase_content_')) {
                const contentId = data.split('_')[2];
                return await this.contentPurchase.handleContentPurchase(query, contentId);
            }

            // Balance payment callbacks
            if (data.startsWith('pay_balance_')) {
                const contentId = data.split('_')[2];
                return await this.contentPurchase.handleBalancePurchase(query, contentId);
            }

            // BELI VIDEO INI button handler - YOUR MAIN FLOW
            if (data.startsWith('buy_video_')) {
                const contentId = data.split('_')[2];
                return await this.handleBuyVideo(query, contentId);
            }

            // QRIS payment callbacks
            if (data.startsWith('pay_qris_')) {
                const contentId = data.split('_')[2];
                return await this.contentPurchase.handleCreateQRISContent(query, contentId);
            }

            // Cancel purchase callback
            if (data === 'cancel_purchase' || data === 'cancel_pending_purchase') {
                await this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Pembelian dibatalkan'
                });
                return await this.handleStartCommand({ from: query.from, chat: query.message.chat });
            }

            // Confirm pending purchase after top-up
            if (data.startsWith('confirm_pending_purchase_')) {
                const contentId = data.split('_')[3];
                return await this.handleConfirmPendingPurchase(query, contentId);
            }

            // BALANCE CONFIRMATION - A) Path
            if (data.startsWith('confirm_balance_')) {
                const contentId = data.split('_')[2];
                return await this.contentPurchase.handleBalancePurchase(query, contentId);
            }

            // QRIS CONFIRMATION - B) Path
            if (data.startsWith('confirm_qris_')) {
                const contentId = data.split('_')[2];
                return await this.contentPurchase.handleCreateQRISContent(query, contentId);
            }

            // Post top-up navigation callbacks
            if (data === 'continue_shopping') {
                await this.bot.answerCallbackQuery(query.id, {
                    text: '🛒 Mengarahkan ke halaman belanja...'
                });
                return await this.handleContinueShoppingCallback(query);
            }

            // Payment confirmation callbacks
            if (data.startsWith('confirm_payment_')) {
                const paymentId = data.replace('confirm_payment_', '');
                return await this.contentPurchase.handlePaymentConfirmation(query, paymentId);
            }

            // Cancel payment
            if (data.startsWith('cancel_payment_')) {
                const paymentId = data.replace('cancel_payment_', '');
                return await this.handlePaymentCancellation(query, paymentId);
            }

            // Account management
            if (data === 'my_account') {
                return await this.handleAccountCallback(query);
            }

            if (data === 'purchase_history') {
                return await this.handleHistoryCallback(query);
            }

            if (data === 'transaction_history') {
                return await this.handleTransactionHistoryCallback(query);
            }

        } catch (error) {
            console.error('Error handling callback query:', error);
            await this.bot.answerCallbackQuery(query.id, {
                text: '❌ Terjadi kesalahan. Silakan coba lagi.',
                show_alert: true
            });
        }
    }

    async handleBalanceCallback(query) {
        const userId = query.from.id;
        
        try {
            const user = await this.getUserFromConsumerDB(userId);
            const balance = user ? parseFloat(user.balance_idr) : 0;

            const formatCurrency = (amount) => new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
            }).format(amount);

            await this.bot.answerCallbackQuery(query.id, {
                text: `💳 Saldo Anda: ${formatCurrency(balance)}`,
                show_alert: true
            });

        } catch (error) {
            await this.bot.answerCallbackQuery(query.id, {
                text: '❌ Gagal mengecek saldo',
                show_alert: true
            });
        }
    }

    async handleTopupCallback(query, pendingContentId = null) {
        const chatId = query.message.chat.id;
        
        let topupText = `📊 **Top-up Saldo**\n\n`;
        
        if (pendingContentId) {
            topupText += `💡 **Setelah top-up selesai, Anda akan melanjutkan pembelian konten**\n\n`;
        }
        
        topupText += `Pilih nominal top-up:`;

        // Create callback data that includes content ID if present
        const createTopupCallback = (amount) => {
            return pendingContentId ? `topup_${amount}_${pendingContentId}` : `topup_${amount}`;
        };

        // Use smart message editing for photo/text compatibility
        try {
            const replyMarkup = {
                inline_keyboard: [
                    [
                        { text: 'Rp 25.000', callback_data: createTopupCallback('25000') },
                        { text: 'Rp 50.000', callback_data: createTopupCallback('50000') }
                    ],
                    [
                        { text: 'Rp 100.000', callback_data: createTopupCallback('100000') },
                        { text: 'Rp 200.000', callback_data: createTopupCallback('200000') }
                    ],
                    [
                        { text: 'Rp 500.000', callback_data: createTopupCallback('500000') }
                    ]
                ]
            };

            if (query.message.photo) {
                await this.bot.editMessageCaption(topupText, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: replyMarkup
                });
            } else {
                await this.bot.editMessageText(topupText, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: replyMarkup
                });
            }
        } catch (error) {
            console.error('Error in topup callback:', error);
        }

        await this.bot.answerCallbackQuery(query.id);
    }

    async handleTopupAmountCallback(query, amount, pendingContentId = null) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        try {
            await this.bot.answerCallbackQuery(query.id, {
                text: `💰 Memproses top-up ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount)}...`
            });

            // Pass pending content ID to QRIS handler
            return await this.contentPurchase.handleCreateQRISTopup(query, amount, pendingContentId);

        } catch (error) {
            console.error('Error in topup amount callback:', error);
            await this.bot.answerCallbackQuery(query.id, {
                text: '❌ Terjadi kesalahan. Silakan coba lagi.',
                show_alert: true
            });
        }
    }

    async handlePaymentCancellation(query, paymentId) {
        const chatId = query.message.chat.id;
        
        // Remove payment session
        this.userSessions.delete(`payment_${paymentId}`);

        await this.bot.editMessageText(
            '❌ **Pembayaran dibatalkan**\n\nAnda dapat mencoba lagi kapan saja.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            }
        );

        await this.bot.answerCallbackQuery(query.id, {
            text: 'Pembayaran dibatalkan'
        });
    }

    // YOUR MAIN FLOW: BELI VIDEO INI
    async handleBuyVideo(query, contentId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        try {
            await this.bot.answerCallbackQuery(query.id, {
                text: '🔄 Checking balance and processing...'
            });

            // Get content and balance
            const content = await this.contentPurchase.getContentFromCreatorDB(contentId);
            if (!content) {
                await this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Content not found',
                    show_alert: true
                });
                return;
            }

            const originalPrice = parseFloat(content.base_price_idr);
            const discountPrice = await this.contentPurchase.calculateDiscountPrice(content.channel_id, originalPrice);
            const finalPrice = discountPrice || originalPrice;
            const userBalance = await this.db.getUserChannelBalance(userId, content.channel_id) || 0;

            const formatCurrency = (amount) => new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
            }).format(amount);

            // A) IF BALANCE IS SUFFICIENT → CONFIRMATION BY USING BALANCE → DEDUCT & SEND VIDEO
            if (userBalance >= finalPrice) {
                const message = `🎬 **${content.caption || 'Video Premium'}**\n\n` +
                              `💰 **Harga:** ${formatCurrency(finalPrice)}\n` +
                              `💳 **Saldo Anda:** ${formatCurrency(userBalance)}\n\n` +
                              `✅ **Saldo mencukupi!**\n\n` +
                              `**Konfirmasi pembelian dengan saldo?**`;

                await this.contentPurchase.editMessage(message, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Ya, Bayar dengan Saldo', callback_data: `confirm_balance_${contentId}` }
                            ],
                            [
                                { text: '❌ Batal', callback_data: 'cancel_purchase' }
                            ]
                        ]
                    },
                    query: query
                });
            } 
            // B) IF BALANCE NOT SUFFICIENT → GENERATE QRIS WITH VIDEO PRICE → PAY → DEDUCT & SEND VIDEO
            else {
                const shortfall = finalPrice - userBalance;
                const message = `🎬 **${content.caption || 'Video Premium'}**\n\n` +
                              `💰 **Harga:** ${formatCurrency(finalPrice)}\n` +
                              `💳 **Saldo Anda:** ${formatCurrency(userBalance)}\n\n` +
                              `🔴 **Saldo kurang ${formatCurrency(shortfall)}**\n\n` +
                              `**Bayar dengan QRIS untuk harga penuh?**`;

                await this.contentPurchase.editMessage(message, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📱 Ya, Bayar dengan QRIS', callback_data: `confirm_qris_${contentId}` }
                            ],
                            [
                                { text: '❌ Batal', callback_data: 'cancel_purchase' }
                            ]
                        ]
                    },
                    query: query
                });
            }

        } catch (error) {
            console.error('Error in handleBuyVideo:', error);
            await this.bot.answerCallbackQuery(query.id, {
                text: '❌ Error processing purchase',
                show_alert: true
            });
        }
    }

    async handleConfirmPendingPurchase(query, contentId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        try {
            await this.bot.answerCallbackQuery(query.id, {
                text: '💳 Memproses pembelian dengan saldo...'
            });

            // Use the same method as direct balance purchase
            return await this.contentPurchase.handleBalancePurchase(query, contentId);

        } catch (error) {
            console.error('Error confirming pending purchase:', error);
            await this.bot.answerCallbackQuery(query.id, {
                text: '❌ Terjadi kesalahan. Silakan coba lagi.',
                show_alert: true
            });
        }
    }

    // Helper methods
    async ensureUserExists(userId, userInfo) {
        try {
            // Mock user creation - implement database logic here
            console.log(`Ensuring user exists: ${userId} - ${userInfo.first_name}`);
        } catch (error) {
            console.error('Error ensuring user exists:', error);
        }
    }

    async getUserFromConsumerDB(userId) {
        // Mock user data - implement database query here
        return {
            id: userId,
            balance_idr: 50000 // Mock balance
        };
    }

    generateMockHistory(userId) {
        return `
📅 **15 Jan 2024**
🎬 Video Tutorial Premium - Rp 15.000

📅 **12 Jan 2024**  
🎬 Konten Eksklusif Creator - Rp 25.000

📅 **08 Jan 2024**
📊 Top-up Saldo - Rp 100.000

---
💰 **Total Pembelian:** Rp 40.000
📊 **Total Top-up:** Rp 100.000
        `;
    }

    async handleAccountCallback(query) {
        const userId = query.from.id;
        const user = query.from;

        const accountText = `
👤 **Akun Saya**

**Informasi Pengguna:**
🆔 **User ID:** \`${userId}\`
👤 **Nama:** ${user.first_name} ${user.last_name || ''}
📱 **Username:** @${user.username || 'Tidak ada'}

**Status Akun:**
✅ **Aktif** - Dapat melakukan pembelian
🔒 **Terverifikasi** - Akun terpercaya

**Statistik:**
📊 **Bergabung:** Jan 2024
🛒 **Total Pembelian:** 3 konten
💰 **Total Pengeluaran:** Rp 40.000
        `;

        await this.bot.editMessageText(accountText, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💳 Cek Saldo', callback_data: 'check_balance' },
                        { text: '📋 Riwayat', callback_data: 'purchase_history' }
                    ]
                ]
            }
        });

        await this.bot.answerCallbackQuery(query.id);
    }

    async handleHistoryCallback(query) {
        const userId = query.from.id;

        const historyText = `
📋 **Riwayat Pembelian**

${this.generateMockHistory(userId)}

💡 **Konten yang sudah dibeli dapat diakses kembali kapan saja.**
        `;

        await this.bot.editMessageText(historyText, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💳 Cek Saldo', callback_data: 'check_balance' },
                        { text: '📊 Top-up', callback_data: 'topup_balance' }
                    ]
                ]
            }
        });

        await this.bot.answerCallbackQuery(query.id);
    }

    async handleTransactionHistoryCallback(query) {
        const transactionText = `
📊 **Riwayat Transaksi**

**Bulan Ini (Januari 2024):**

📅 **15 Jan** - Pembelian Konten
💰 Rp 15.000 | ✅ Berhasil

📅 **12 Jan** - Pembelian Konten  
💰 Rp 25.000 | ✅ Berhasil

📅 **08 Jan** - Top-up Saldo
💰 Rp 100.000 | ✅ Berhasil

📅 **05 Jan** - Registrasi
💰 Rp 0 | ✅ Gratis

---
📊 **Ringkasan Januari:**
💸 **Pengeluaran:** Rp 40.000
💰 **Top-up:** Rp 100.000
💳 **Saldo Tersisa:** Rp 60.000
        `;

        await this.bot.editMessageText(transactionText, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Kembali', callback_data: 'my_account' }]
                ]
            }
        });

        await this.bot.answerCallbackQuery(query.id);
    }

    async handleContinueShoppingCallback(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        try {
            // Get user's current balance
            const userChannels = await this.db.getUserChannels(userId);
            let totalBalance = 0;
            let balanceText = '';
            
            if (userChannels && userChannels.length > 0) {
                for (const channel of userChannels) {
                    const balance = await this.db.getUserChannelBalance(userId, channel.id);
                    totalBalance += balance;
                    if (balance > 0) {
                        balanceText += `📺 ${channel.channel_title || channel.channel_username}: ${this.formatCurrency(balance)}\n`;
                    }
                }
            }

            const shoppingText = `🛒 **Lanjut Berbelanja**\n\n` +
                               `💳 **Saldo Anda:**\n${balanceText || '💰 Belum ada saldo tersedia'}\n` +
                               `💰 **Total Saldo:** ${this.formatCurrency(totalBalance)}\n\n` +
                               `🎯 **Cara berbelanja:**\n` +
                               `• Klik link konten dari creator\n` +
                               `• Pilih konten yang ingin dibeli\n` +
                               `• Gunakan saldo atau QRIS untuk pembayaran\n\n` +
                               `💡 **Tips:** Saldo dapat digunakan di semua channel yang mendukung sistem pembayaran ini.`;

            await this.bot.editMessageText(shoppingText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '💳 Top-up Lagi', callback_data: 'topup_balance' }
                        ]
                    ]
                }
            });

        } catch (error) {
            console.error('Error in continue shopping callback:', error);
            await this.bot.editMessageText(
                '🛒 **Lanjut Berbelanja**\n\n' +
                'Anda sudah berhasil top-up! Sekarang Anda bisa:\n\n' +
                '• Menggunakan saldo untuk membeli konten premium\n' +
                '• Klik link konten dari creator untuk berbelanja\n' +
                '• Gunakan tombol di bawah untuk navigasi',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '💳 Top-up Lagi', callback_data: 'topup_balance' }
                            ]
                        ]
                    }
                }
            );
        }
    }

    // Helper method to format currency
    formatCurrency(amount) {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(amount);
    }
}

module.exports = ConsumerHandlers;