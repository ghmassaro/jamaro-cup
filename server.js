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

function normalizeKit(str) {
  if (!str) return '';
  let s = String(str).trim().replace(/\s+/g, ' ');
  if (!/^kit\b/i.test(s)) s = 'Kit ' + s;
  s = s.replace(/\b(pp|p|m|g{1,3}|xg|xxg)\b/gi, m => m.toUpperCase());
  s = s.replace(/\b(masculino|feminino|unissex|adulto|infantil)\b/gi,
    w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  s = s.replace(/^kit\b/i, 'Kit');
  return s;
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

async function sendStatusEmail(entry, status) {
  const recipients = [entry.athlete1?.email, entry.athlete2?.email].filter(Boolean).join(', ');
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

    const originalExt = path.extname(req.file.originalname);
    const finalName = req.file.filename + originalExt.toLowerCase();
    const finalPath = path.join(uploadsDir, finalName);
    fs.renameSync(req.file.path, finalPath);

    const fileHash = sha256File(finalPath);

    const entry = {
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      athlete1: {
        name:  req.body['entry.857165334'],
        phone: req.body['entry.222222222'],
        email: req.body['entry.444444444'],
        cep:   req.body['entry.cep1'],
        city:  req.body['city1'],
        kit:   req.body['entry.kit1'],
      },
      athlete2: {
        name:  req.body['entry.949098972'],
        phone: req.body['entry.333333333'],
        email: req.body['entry.555555555'],
        cep:   req.body['entry.cep2'],
        city:  req.body['city2'],
        kit:   req.body['entry.kit2'],
      },
      duo: {
        name:      req.body['entry.111111111'],
        category:  req.body['entry.666666666'],
        instagram: req.body['entry.622151674'],
      },
      consent: req.body['acceptTerms'],
      uniforms: `${req.body['entry.kit1']} / ${req.body['entry.kit2']}`,
      paymentProof: finalName,
      paymentProofUrl: `/uploads/${finalName}`,
      fileHash,
      status: 'pending_review',
      validation: {}
    };

    await db.read();
    const dup = db.data.entries.find(e => e.fileHash === fileHash);
    if (dup) return res.status(409).send('Comprovante já enviado anteriormente (duplicado).');

    db.data.entries.push(entry);
    await db.write();

    return res.redirect('/obrigado.html');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Erro ao processar a inscrição.');
  }
});

// === Admin: lista + filtros + totais de uniformes ===
app.get('/admin', async (req, res) => {
  await db.read();
  const all = Array.isArray(db.data?.entries) ? db.data.entries : [];

  // filtros vindos da querystring
  const category = (req.query.category || '').trim();
  const status   = (req.query.status   || '').trim();

  // listas para os <select>
  const categories = [...new Set(all.map(e => e?.duo?.category).filter(Boolean))].sort();
  const statuses   = ['pending_review', 'accepted', 'rejected', 'duplicate'];

  // aplica filtros
  const entries = all.filter(e => {
    const okCategory = !category || e?.duo?.category === category;
    const okStatus   = !status   || e?.status === status;
    return okCategory && okStatus;
  });

  // totais de uniformes (usa athlete1.kit / athlete2.kit e também a string e.uniforms "X / Y" se existir)
  const uniformTotals = {};
  const addKit = (raw) => {
    const key = normalizeKit(raw);
    if (!key) return;
    uniformTotals[key] = (uniformTotals[key] || 0) + 1;
  };

  for (const e of entries) {
    if (e?.athlete1?.kit) addKit(e.athlete1.kit);
    if (e?.athlete2?.kit) addKit(e.athlete2.kit);

    if (typeof e?.uniforms === 'string' && e.uniforms.includes('/')) {
      const [k1, k2] = e.uniforms.split('/').map(s => s && s.trim()).filter(Boolean);
      if (k1) addKit(k1);
      if (k2) addKit(k2);
    }
  }

  res.render('admin', {
    entries,
    categories,
    statuses,
    selected: { category, status }, // usado pelo template
    uniformTotals
  });
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
