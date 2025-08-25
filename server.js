// server.js — usando PostgreSQL (Sequelize) e sem lowdb
const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

try { require('dotenv').config(); } catch (_) {}

const { sequelize } = require('./db');
const { Entry } = require('./models/entry');


const app = express();

// === Dirs ===
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

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
app.use(express.json());

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

// Score simples (heurística leve — ajuste se quiser)
function computeScore(entryLike, fileExtLower) {
  let score = 50;
  const goodExt = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].includes(fileExtLower);
  if (goodExt) score += 10;
  if (entryLike.athlete1_email && entryLike.athlete2_email) score += 10;
  if (entryLike.athlete1_kit && entryLike.athlete2_kit) score += 10;
  if (entryLike.duo_name) score += 10;
  if (entryLike.duo_category) score += 10;
  if (entryLike.duo_instagram) score += 5;
  if (!entryLike.consent) score -= 20;
  score = Math.max(0, Math.min(100, score));
  return score;
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
  const recipients = [entry.athlete1_email, entry.athlete2_email].filter(Boolean).join(', ');
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
      <p>Olá ${entry.athlete1_name || ''}${entry.athlete2_name ? ' e ' + entry.athlete2_name : ''},</p>
      <p>
        Sua inscrição da dupla <strong>${entry.duo_name || '(sem nome da dupla)'}</strong>
        na categoria <strong>${entry.duo_category || '-'}</strong> foi
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

    // checa duplicado por hash de arquivo
    const dup = await Entry.findOne({ where: { fileHash } });
    if (dup) {
      return res.status(409).send('Comprovante já enviado anteriormente (duplicado).');
    }

    // Monta campos a partir do body (mesmos nomes que você usa hoje)
    const b = req.body;
    const entryLike = {
      athlete1_name:  b['entry.857165334'],
      athlete1_phone: b['entry.222222222'],
      athlete1_email: b['entry.444444444'],
      athlete1_cep:   b['entry.cep1'],
      athlete1_city:  b['city1'],
      athlete1_kit:   b['entry.kit1'],

      athlete2_name:  b['entry.949098972'],
      athlete2_phone: b['entry.333333333'],
      athlete2_email: b['entry.555555555'],
      athlete2_cep:   b['entry.cep2'],
      athlete2_city:  b['city2'],
      athlete2_kit:   b['entry.kit2'],

      duo_name:      b['entry.111111111'],
      duo_category:  b['entry.666666666'],
      duo_instagram: b['entry.622151674'],

      consent: b['acceptTerms'] ? true : false
    };

    const score = computeScore(entryLike, originalExt.toLowerCase());

    // Cria no Postgres
    await Entry.create({
      submittedAt: new Date(),

      athlete1_name:  entryLike.athlete1_name,
      athlete1_phone: entryLike.athlete1_phone,
      athlete1_email: entryLike.athlete1_email,
      athlete1_city:  entryLike.athlete1_city,
      athlete1_kit:   entryLike.athlete1_kit,

      athlete2_name:  entryLike.athlete2_name,
      athlete2_phone: entryLike.athlete2_phone,
      athlete2_email: entryLike.athlete2_email,
      athlete2_city:  entryLike.athlete2_city,
      athlete2_kit:   entryLike.athlete2_kit,

      duo_name:      entryLike.duo_name,
      duo_category:  entryLike.duo_category,
      duo_instagram: entryLike.duo_instagram,

      consent: entryLike.consent,
      uniforms: `${b['entry.kit1'] || ''} / ${b['entry.kit2'] || ''}`,

      paymentProof:    finalName,
      paymentProofUrl: `/uploads/${finalName}`,
      fileHash,

      status: 'pending_review',

      // campos de validação
      validation_ok: null,
      validation_score: score,
      validation_mime: req.file.mimetype || null,
      validation_textSample: null,
    });

    return res.redirect('/obrigado.html');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Erro ao processar a inscrição.');
  }
});


// === Admin: lista + filtros + totais de uniformes ===
app.get('/admin', async (req, res) => {
  const category = (req.query.category || '').trim();
  const status   = (req.query.status   || '').trim();

  const where = {};
  if (category) where.duo_category = category;
  if (status)   where.status = status;

  const entries = await Entry.findAll({
    where,
    order: [['submittedAt', 'DESC']],
    raw: true,              // <-- ADICIONE
  });

  // listas para os <select>
  const categoriesRaw = await Entry.findAll({
    attributes: ['duo_category'],
    group: ['duo_category'],
    raw: true,              // <-- ADICIONE
  });
  const categories = categoriesRaw
    .map(r => r.duo_category)
    .filter(Boolean)
    .sort();

  const statuses = ['pending_review', 'accepted', 'rejected', 'duplicate'];

  // totais de uniformes
// totais de uniformes (tamanho + gênero)
const uniformTotals = {};
const addKit = (size, gender) => {
  const label = ['Kit', (size || '').trim(), (gender || '').trim()]
    .filter(Boolean)
    .join(' ');
  const key = normalizeKit(label);
  if (!key) return;
  uniformTotals[key] = (uniformTotals[key] || 0) + 1;
};

for (const e of entries) {
  // novos campos vindos do formulário
  addKit(e.athlete1_kit, e.athlete1_kit_gender);
  addKit(e.athlete2_kit, e.athlete2_kit_gender);

  // compatibilidade com envios antigos (string "M / G" sem gênero)
  if (typeof e.uniforms === 'string' && e.uniforms.includes('/')) {
    const [k1, k2] = e.uniforms.split('/').map(s => (s || '').trim()).filter(Boolean);
    if (k1) addKit(k1, null);
    if (k2) addKit(k2, null);
  }
}


  res.render('admin', {
    entries,
    categories,
    statuses,
    selected: { category, status },
    uniformTotals,
  });
});


// === Exportar Excel respeitando filtros (/admin/export.xlsx) ===
app.get('/admin/export.xlsx', async (req, res) => {
  const ExcelJS = require('exceljs');

  const category = (req.query.category || '').trim();
  const status   = (req.query.status   || '').trim();

  const where = {};
  if (category) where.duo_category = category;
  if (status)   where.status = status;

  const entries = await Entry.findAll({ where, order: [['submittedAt','DESC']] });

  const uniformTotals = {};
  const addKit = (raw) => {
    const key = normalizeKit(raw);
    if (!key) return;
    uniformTotals[key] = (uniformTotals[key] || 0) + 1;
  };
  for (const e of entries) {
    if (e.athlete1_kit) addKit(e.athlete1_kit);
    if (e.athlete2_kit) addKit(e.athlete2_kit);
    if (typeof e.uniforms === 'string' && e.uniforms.includes('/')) {
      const [k1, k2] = e.uniforms.split('/').map(s => s && s.trim()).filter(Boolean);
      if (k1) addKit(k1);
      if (k2) addKit(k2);
    }
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inscrições');

  ws.columns = [
    { header: 'Data', key: 'submittedAt', width: 20 },
    { header: 'Dupla', key: 'duoName', width: 25 },
    { header: 'Categoria', key: 'category', width: 18 },

    { header: 'A1 Nome', key: 'a1Name', width: 20 },
    { header: 'A1 Email', key: 'a1Email', width: 28 },
    { header: 'A1 Fone', key: 'a1Phone', width: 16 },
    { header: 'A1 Cidade', key: 'a1City', width: 18 },
    { header: 'A1 Kit', key: 'a1Kit', width: 18 },

    { header: 'A2 Nome', key: 'a2Name', width: 20 },
    { header: 'A2 Email', key: 'a2Email', width: 28 },
    { header: 'A2 Fone', key: 'a2Phone', width: 16 },
    { header: 'A2 Cidade', key: 'a2City', width: 18 },
    { header: 'A2 Kit', key: 'a2Kit', width: 18 },

    { header: 'Status', key: 'status', width: 16 },
    { header: 'Score', key: 'score', width: 8 },
    { header: 'Comprovante URL', key: 'proofUrl', width: 40 },
    { header: 'Instagram', key: 'instagram', width: 22 },
  ];

  for (const e of entries) {
    ws.addRow({
      submittedAt: e.submittedAt ? new Date(e.submittedAt).toLocaleString('pt-BR') : '',
      duoName: e.duo_name || '',
      category: e.duo_category || '',

      a1Name: e.athlete1_name || '',
      a1Email: e.athlete1_email || '',
      a1Phone: e.athlete1_phone || '',
      a1City: e.athlete1_city || '',
      a1Kit: e.athlete1_kit || '',

      a2Name: e.athlete2_name || '',
      a2Email: e.athlete2_email || '',
      a2Phone: e.athlete2_phone || '',
      a2City: e.athlete2_city || '',
      a2Kit: e.athlete2_kit || '',

      status: e.status || '',
      score: (e.validation_score != null) ? e.validation_score : '',
      proofUrl: e.paymentProofUrl || '',
      instagram: e.duo_instagram || '',
    });
  }

  const ws2 = wb.addWorksheet('Uniformes Totais');
  ws2.columns = [
    { header: 'Modelo / Tamanho / Gênero', key: 'key', width: 35 },
    { header: 'Quantidade', key: 'qty', width: 12 },
  ];
  Object.keys(uniformTotals).sort().forEach(k => {
    ws2.addRow({ key: k, qty: uniformTotals[k] });
  });

  const ts = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fname = `inscricoes_jamaro_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);

  await wb.xlsx.write(res);
  res.end();
});

// Aprovar (envia e-mail)
app.post('/admin/entries/:id/approve', async (req, res) => {
  const { id } = req.params;
  const entry = await Entry.findByPk(id);
  if (!entry) return res.status(404).send('Inscrição não encontrada.');

  await Entry.update({ status: 'accepted' }, { where: { id } });
  try { await sendStatusEmail(entry, 'accepted'); } catch {}
  res.redirect('/admin');
});

// Reprovar (envia e-mail)
app.post('/admin/entries/:id/reject', async (req, res) => {
  const { id } = req.params;
  const entry = await Entry.findByPk(id);
  if (!entry) return res.status(404).send('Inscrição não encontrada.');

  await Entry.update({ status: 'rejected' }, { where: { id } });
  try { await sendStatusEmail(entry, 'rejected'); } catch {}
  res.redirect('/admin');
});

// Health / Debug (opcional)
app.get('/debug/db', async (req, res) => {
  try {
    await sequelize.authenticate();
    const count = await Entry.count();
    res.json({ ok: true, count });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Inicialização do banco e servidor
(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    console.log('✅ Postgres conectado e schema sincronizado');

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Server rodando em http://localhost:${PORT}`));
  } catch (e) {
    console.error('❌ Falha ao conectar no Postgres:', e);
    process.exit(1);
  }
})();
