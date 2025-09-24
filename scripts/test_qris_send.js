const QRISHandler = require('../modules/payment/qris-handler');

const mockBot = {
  sendVideo: async (uid, src, opts) => console.log('[bot] sendVideo', uid, src, opts.caption),
  sendPhoto: async (uid, src, opts) => console.log('[bot] sendPhoto', uid, src, opts.caption),
  sendDocument: async (uid, src, opts) => console.log('[bot] sendDocument', uid, src, opts.caption),
  sendMessage: async (uid, text) => console.log('[bot] sendMessage', uid, text)
};

const mockDb = {
  getContentById: async (cid) => ({
    id: cid,
    caption: 'Mock Content Caption',
    title: 'Mock Title',
    description: 'Mock description',
    base_price_idr: 15000,
    file_type: 'video',
    video_file_id: 'VID12345',
    file_path: 'https://example.com/video.mp4'
  })
};

(async () => {
  const q = new QRISHandler(mockDb, mockBot);
  await q.sendContentToUser(7761064473, 5555);
})();
