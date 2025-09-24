const ContentPurchase = require('../modules/consumer/content-purchase');

// Minimal mock implementations
const mockBot = {
  answerCallbackQuery: async (id, opts) => console.log('[bot] answerCallbackQuery', id, opts),
  editMessageText: async (text, opts) => { console.log('[bot] editMessageText', text); return { message_id: 999 }; },
  editMessageCaption: async (text, opts) => { console.log('[bot] editMessageCaption', text); return { message_id: 999 }; },
  sendVideo: async (chatId, fileId, opts) => console.log('[bot] sendVideo', chatId, fileId, opts && opts.caption),
  sendPhoto: async (chatId, fileId, opts) => console.log('[bot] sendPhoto', chatId, fileId, opts && opts.caption),
  sendDocument: async (chatId, fileId, opts) => console.log('[bot] sendDocument', chatId, fileId, opts && opts.caption),
  sendMessage: async (chatId, text, opts) => console.log('[bot] sendMessage', chatId, text),
  deleteMessage: async (chatId, messageId) => console.log('[bot] deleteMessage', chatId, messageId),
  getChat: async (chatId) => ({ id: chatId }),
};

const mockDb = {
  // used by our tested code
  getUserById: async (userId) => ({ id: userId, balance_idr: 50000 }),
  getUserChannelBalance: async (userId, channelId) => 50000,
  deductUserChannelBalance: async (userId, channelId, amount) => {
    console.log('[db] deductUserChannelBalance', userId, channelId, amount);
    return true;
  },
  grantContentAccess: async (userId, contentId, amount) => {
    console.log('[db] grantContentAccess', userId, contentId, amount);
    return true;
  },
  recordPurchaseTransaction: async (userId, contentId, amount, paymentMethod) => {
    console.log('[db] recordPurchaseTransaction', userId, contentId, amount, paymentMethod);
    return 12345;
  },
  pool: { execute: async () => [[], []] }
};

const mockQrisHandler = {
  sendContentToUser: async (userId, contentId) => {
    console.log('[qris] sendContentToUser called for', userId, contentId);
  }
};

(async function run() {
  const userSessions = new Map();
  const cp = new ContentPurchase(mockBot, mockDb, userSessions, mockQrisHandler);

  // Override checkExistingPurchase to use mockDB via simplified response
  cp.checkExistingPurchase = async (userId, contentId) => null;

  // Fake callback query
  const query = {
    id: 'cb_test_1',
    message: { chat: { id: 7777777 }, message_id: 1111 },
    from: { id: 7761064473 }
  };

  const content = {
    id: 9999,
    channel_id: 1,
    base_price_idr: '15000',
    caption: 'Test Video - Internal',
    video_file_id: 'VID_FILE_ABC123',
    video_duration: 125
  };

  console.log('--- Running processBalancePurchase (mock) ---');
  await cp.processBalancePurchase(query, content, 15000, 50000);
  console.log('--- Done ---');
})();
