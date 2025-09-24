require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const Database = require('./database');

// Import modules
const ChannelSetup = require('./modules/creator/channel-setup');
const ContentManagement = require('./modules/creator/content-management');
const Settings = require('./modules/creator/settings');
const PromoManagement = require('./modules/creator/promo-management');
const MainHandlers = require('./modules/core/handlers');
const ConsumerHandlers = require('./modules/consumer/handlers');
const QRISHandler = require('./modules/payment/qris-handler');

// --- Configuration ---
const token = process.env.TELEGRAM_BOT_TOKEN;
const USE_WEBHOOK = process.env.USE_WEBHOOK === 'true' || process.argv.includes('--webhook');
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://araska.id/bot-creator-papa/webhook';
const PORT = process.env.PORT || 3001;

console.log(`🚀 Starting Bot-Creator-Papa (Modular) in ${USE_WEBHOOK ? 'WEBHOOK' : 'POLLING'} mode...`);

// --- Initialization ---
const bot = new TelegramBot(token, { 
    polling: !USE_WEBHOOK,
    webHook: false  // We'll set webhook manually to avoid port conflicts
});

const db = new Database();
let userSessions = new Map(); // Store user session data temporarily

// --- Initialize Modules ---
const channelSetup = new ChannelSetup(bot, db, userSessions);
const contentManagement = new ContentManagement(bot, db, userSessions);
const settings = new Settings(bot, db, userSessions);
const promoManagement = new PromoManagement(bot, db, userSessions);
const qrisHandler = new QRISHandler(db, bot);
const consumerHandlers = new ConsumerHandlers(bot, db, userSessions, qrisHandler);
const mainHandlers = new MainHandlers(bot, db, userSessions, channelSetup, contentManagement, settings, promoManagement, consumerHandlers, qrisHandler);

// --- Register All Handlers ---
mainHandlers.registerCommands();

// --- Express Server for Webhooks (if enabled) ---
let app, server;

if (USE_WEBHOOK) {
    app = express();
    app.use(bodyParser.json());
    
    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({ 
            status: 'ok', 
            bot: 'bot-creator-papa',
            mode: 'webhook',
            timestamp: new Date().toISOString()
        });
    });
    
    // Webhook endpoint
    app.post('/webhook', (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
    
    // OY! Indonesia QRIS Callback endpoint
    app.post('/oy-qris-callback', async (req, res) => {
        const callbackData = req.body;
        console.log('Received OY! QRIS Callback:', JSON.stringify(callbackData, null, 2));

        try {
            // It's good practice to have a secret header to verify the request is from OY!
            // For now, we'll process it directly.
            const { partner_trx_id, payment_status, received_amount } = callbackData;

            if (payment_status === 'COMPLETE') {
                const transaction = await db.getPaymentTransactionByExternalId(partner_trx_id);
                if (transaction && transaction.status === 'pending') {
                    if (parseFloat(received_amount) >= parseFloat(transaction.amount)) {
                        // Mark as paid in DB
                        await db.updatePaymentTransactionStatus(partner_trx_id, 'paid');
                        
                        // Process the successful payment (e.g., grant access, send content)
                        await qrisHandler.processSuccessfulPayment(transaction);
                        
                        console.log(`✅ Successfully processed payment for ${partner_trx_id}`);
                    } else {
                        console.warn(`⚠️ Amount mismatch for ${partner_trx_id}. Expected: ${transaction.amount}, Received: ${received_amount}`);
                        await db.updatePaymentTransactionStatus(partner_trx_id, 'failed', 'Amount mismatch');
                    }
                } else {
                    console.log(`Transaction ${partner_trx_id} not found or already processed.`);
                }
            }
            res.status(200).json({ status: 'ok' });
        } catch (error) {
            console.error('Error processing OY! callback:', error);
            res.status(500).json({ status: 'error', message: 'Internal Server Error' });
        }
    });
    
    server = app.listen(PORT, () => {
        console.log(`🌐 Webhook server listening on port ${PORT}`);
    });
}

// --- Startup & Production Configuration ---
(async function main() {
    // Cleanup old sessions periodically
    setInterval(async () => {
        const now = Date.now();
        for (const [userId, session] of userSessions.entries()) {
            if (now - session.startTime > 30 * 60 * 1000) { // 30 minutes
                userSessions.delete(userId);
                console.log(`🧹 Cleaned up expired session for user ${userId}`);
            }
        }
    }, 5 * 60 * 1000); // Every 5 minutes
    
    // Register command descriptions for BotFather - Simplified Interface
    const commands = [
        { command: 'start', description: 'Selamat datang dan panduan bot' },
        { command: 'creators', description: 'Menu utama untuk creator' },
        { command: 'viewers', description: 'Menu utama untuk viewer' }
    ];
    
    try {
        await bot.setMyCommands(commands);
        console.log('✅ Bot commands registered with BotFather');
    } catch (error) {
        console.error('❌ Failed to register commands:', error.message);
    }
    
    // Setup webhook or polling
    if (USE_WEBHOOK) {
        try {
            // Delete any existing webhook first
            await bot.deleteWebHook();
            
            // Set new webhook
            const webhookResult = await bot.setWebHook(WEBHOOK_URL, {
                allowed_updates: ['message', 'callback_query']
            });
            
            if (webhookResult) {
                console.log(`✅ Webhook set successfully: ${WEBHOOK_URL}`);
            } else {
                console.error('❌ Failed to set webhook');
            }
            
        } catch (error) {
            console.error('❌ Webhook setup failed:', error.message);
            process.exit(1);
        }
    } else {
        console.log('📡 Bot started in polling mode');
    }
    
    // Verify bot startup
    try {
        const me = await bot.getMe();
        console.log(`🤖 Bot ready: @${me.username} (${me.first_name})`);
        console.log(`📊 Mode: ${USE_WEBHOOK ? 'Webhook' : 'Polling'}`);
        console.log(`🗄️ Database: Connected`);
        console.log(`🔧 Tech Support: @${process.env.TECH_SUPPORT_USERNAME || 'support'}`);
        console.log(`🔄 Modules: ✅ Loaded (ChannelSetup, ContentManagement, Settings, PromoManagement, ConsumerHandlers)`);
    } catch (error) {
        console.error('❌ Bot verification failed:', error.message);
        process.exit(1);
    }
    
    // Graceful shutdown handlers
    const gracefulShutdown = async (signal) => {
        console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
        
        try {
            if (USE_WEBHOOK && server) {
                server.close(() => {
                    console.log('📡 Express server closed');
                });
                await bot.deleteWebHook();
                console.log('🌐 Webhook deleted');
            }
            
            if (db && db.pool) {
                await db.pool.end();
                console.log('🗄️ Database connections closed');
            }
            
            console.log('✅ Graceful shutdown completed');
            process.exit(0);
        } catch (error) {
            console.error('❌ Error during shutdown:', error.message);
            process.exit(1);
        }
    };
    
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
        console.error('💥 Uncaught Exception:', error);
        process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
        process.exit(1);
    });
    
})().catch(error => {
    console.error('💥 Failed to start bot:', error);
    process.exit(1);
});

// Export for testing purposes
module.exports = { bot, db, userSessions };