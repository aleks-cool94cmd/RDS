require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
app.use(cors());
app.use(express.json());

const subscriptions = [];
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'PASTE_YOUR_PUBLIC_KEY';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'PASTE_YOUR_PRIVATE_KEY';

webpush.setVapidDetails('mailto:cycleflow@example.com', publicVapidKey, privateVapidKey);

app.get('/vapidPublicKey', (_req, res) => {
  res.json({ publicVapidKey });
});

app.post('/subscribe', (req, res) => {
  subscriptions.push(req.body);
  res.status(201).json({ ok: true });
});

app.post('/notify', async (req, res) => {
  const payload = JSON.stringify({
    title: req.body.title || 'CycleFlow',
    body: req.body.body || 'Напоминание о фазе цикла'
  });

  await Promise.allSettled(subscriptions.map((sub) => webpush.sendNotification(sub, payload)));
  res.json({ sent: subscriptions.length });
});

const port = process.env.PORT || 3030;
app.listen(port, () => {
  console.log(`Push server listening on http://localhost:${port}`);
});
