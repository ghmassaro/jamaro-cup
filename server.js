// server.js
const express = require('express');
const path    = require('path');
const multer  = require('multer');

// lowdb v4+ imports
const { Low }      = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();

// LowDB setup with default data
const file    = path.join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const db      = new Low(adapter, { entries: [] });

(async () => {
  await db.read();
  await db.write();
})();

// Multer setup for file uploads (comprovantes)
const upload = multer({ dest: path.join(__dirname, 'uploads/') });

// Express configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static assets and uploads
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: true }));

// Endpoint para receber o formulário de inscrição
app.post('/submit', upload.single('paymentProof'), async (req, res) => {
  const entry = {
    submittedAt: new Date().toISOString(),
    athlete1: {
      name: req.body['entry.857165334'],
      phone: req.body['entry.222222222'],
      email: req.body['entry.444444444'],
      cep: req.body['entry.cep1'],
      city: req.body['city1'],
      kit: req.body['entry.kit1'],
    },
    athlete2: {
      name: req.body['entry.949098972'],
      phone: req.body['entry.333333333'],
      email: req.body['entry.555555555'],
      cep: req.body['entry.cep2'],
      city: req.body['city2'],
      kit: req.body['entry.kit2'],
    },
    duo: {
      name: req.body['entry.111111111'],
      category: req.body['entry.666666666'],
      instagram: req.body['entry.622151674'],
    },
    consent: req.body['acceptTerms'],
    paymentProof: req.file ? req.file.filename : null
  };

  await db.read();
  db.data.entries.push(entry);
  await db.write();

  // Redireciona para página de agradecimento
  res.redirect('/thankyou.html');
});

// Dashboard de administração
app.get('/admin', async (req, res) => {
  await db.read();
  res.render('admin', { entries: db.data.entries });
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server rodando em http://localhost:${PORT}`));