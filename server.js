// server.js — sem validação de comprovante (manual via /admin)
const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// lowdb v4
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

// Carregar .env localmente (opcional em dev)
try { require('dotenv').config(); } catch (_) {}

const app = express();

// === Dirs ===
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// === LowDB ===
const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { entries: [] });

(async () => {
  await db.read();
  if (!db.data || !Array.isArray(db.data.entries)) {
    db.data = { entries: [] };
    await db.write();
  }
})();

// === Multer (upload de comprovantes) ===
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    // aceita pdf e imagens comuns; sem validação de conteúdo
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Tipo de arquivo não permitido'), ok);
  }
});

// === Express config ===
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use(express.urlencoded({ extended: true }));

// === Helpers ===
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// === E-mail (Nodemailer) ===
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false') === 'true',
  auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : undefined
});

// Enviar e-mail de status
async function sendStatusEmail(entry, status) {
  const recipients = [entry.athlete1?.email, entry.athlete2?.email]
    .filter(Boolean)
    .join(', ');
  if (!recipients) return;

  const isApproved = status === 'accepted';
  const subject = isApproved
    ? 'Jamaro Cup — Inscrição Confirmada'
    : (status === 'rejected'
        ? 'Jamaro Cup — Inscrição Reprovada'
        : 'Jamaro Cup — Atualização da sua Inscrição');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2>Jamaro Cup</h2>
      <p>Olá ${entry.athlete1?.name || ''}${entry.athlete2?.name ? ' e ' + entry.athlete2.name : ''},</p>
      <p>
        Sua inscrição da dupla <strong>${entry.duo?.name || '(sem nome da dupla)'}</strong>
        na categoria <strong>${entry.duo?.category || '-'}</strong> foi
        <strong style="color:${isApproved ? '#2e7d32' : (status === 'rejected' ? '#c62828' : '#f57c00')}">
          ${isApproved ? 'CONFIRMADA' : (status === 'rejected' ? 'REPROVADA' : 'ATUALIZADA')}
        </strong>.
      </p>
      ${isApproved
        ? '<p>Nos vemos no evento! Qualquer dúvida, responda este e-mail.</p>'
        : (status === 'rejected'
            ? '<p>Seu envio não foi aprovado. Caso necessário, entre em contato para novas orientações.</p>'
            : '<p>Seu comprovante está em revisão. Em breve retornaremos com a confirmação.</p>')}
      <hr/>
      <p style="font-size:12px;color:#777">Este e-mail foi enviado automaticamente.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: process.env.FROM_EMAIL || 'no-reply@jamaro.com.br',
      to: recipients,
      subject,
      html
    });
  } catch (err) {
    console.error('Falha ao enviar e-mail:', err.message);
  }
}

// === Endpoint do formulário ===
app.post('/submit', upload.single('paymentProof'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');

    // Renomeia preservando extensão original
    const originalExt = path.extname(req.file.originalname); // .jpg/.png/.pdf
    const finalName = req.file.filename + originalExt.toLowerCase();
    const finalPath = path.join(uploadsDir, finalName);
    fs.renameSync(req.file.path, finalPath);

    // Hash para deduplicação
    const fileHash = sha256File(finalPath);

    // Monta o registro (sem validação automática)
    const entry = {
      id: crypto.randomUUID(),
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
      uniforms: `${req.body['entry.kit1']} / ${req.body['entry.kit2']}`,
      paymentProof: finalName,
      paymentProofUrl: `/uploads/${finalName}`,
      fileHash,
      status: 'pending_review',   // sempre começa em revisão
      validation: {}              // sem score/ocr
    };

    // Persistência + regra de duplicado
    await db.read();
    const dup = db.data.entries.find(e => e.fileHash === fileHash);
    if (dup) {
      return res.status(409).send('Comprovante já enviado anteriormente (duplicado).');
    }
    db.data.entries.push(entry);
    await db.write();

    // Vai para a tela de obrigado (que já informa "em revisão")
    return res.redirect('/obrigado.html');

  } catch (err) {
    console.error(err);
    return res.status(500).send('Erro ao processar a inscrição.');
  }
});

// === Admin: lista + ações ===
app.get('/admin', async (req, res) => {
  await db.read();
  res.render('admin', { entries: db.data.entries });
});

// Aprovar (envia e-mail)
app.post('/admin/entries/:id/approve', async (req, res) => {
  const { id } = req.params;
  await db.read();
  const entry = db.data.entries.find(e => e.id === id);
  if (!entry) return res.status(404).send('Inscrição não encontrada.');
  entry.status = 'accepted';
  await db.write();

  sendStatusEmail(entry, 'accepted').catch(() => {});
  res.redirect('/admin');
});

// Reprovar (envia e-mail)
app.post('/admin/entries/:id/reject', async (req, res) => {
  const { id } = req.params;
  await db.read();
  const entry = db.data.entries.find(e => e.id === id);
  if (!entry) return res.status(404).send('Inscrição não encontrada.');
  entry.status = 'rejected';
  await db.write();

  sendStatusEmail(entry, 'rejected').catch(() => {});
  res.redirect('/admin');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server rodando em http://localhost:${PORT}`));
