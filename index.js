require('dotenv').config();
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const express = require('express');
const cors = require('cors'); // <-- Adicionado
const { createClient } = require('redis'); // <-- Adicionado

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Configurações do Express para receber chamadas do Frontend (CORS CORRIGIDO)
app.use(cors({ origin: '*' })); // Permite que o Render receba chamadas do localhost e de outros domínios
app.use(express.json()); 

// 2. Conexão Segura com o Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 3. Configuração do Gmail para envio (CORRIGIDO PARA EVITAR TIMEOUT NO RENDER)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // true para porta 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS 
  },
  tls: {
    rejectUnauthorized: false // Ajuda a prevenir bloqueios em servidores Cloud
  }
});

// --- NOVA SECÇÃO: CONFIGURAÇÃO DO REDIS ---
// Dica: Use uma variável de ambiente para a URL no Render. 
// Localmente, se não existir, ele liga ao localhost por defeito.
const redisClient = createClient({ 
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' 
});

redisClient.connect()
  .then(() => console.log('Ligado ao banco de dados em memória Redis com sucesso! 🗄️'))
  .catch(console.error);

// 30 minutos em segundos
const TEMPO_INATIVIDADE_TESTE = 1800; 

// Endpoint para renovar a sessão do utilizador
app.post('/api/heartbeat', async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).send('UID obrigatório');

  try {
    await redisClient.set(`session:${uid}`, 'ativo', {
      EX: TEMPO_INATIVIDADE_TESTE
    });
    
    // Sincroniza o robô de e-mails com a atividade real captada pelo Redis.
    await db.collection('users').doc(uid).set({
      ultimaAtividade: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no heartbeat:', error);
    res.status(500).send('Erro interno');
  }
});

// Endpoint para o frontend verificar se foi desconectado
app.post('/api/check-session', async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).send('UID obrigatório');

  try {
    const session = await redisClient.get(`session:${uid}`);
    if (!session) {
      return res.status(401).json({ expired: true });
    }
    res.status(200).json({ expired: false });
  } catch (error) {
    console.error('Erro ao verificar sessão:', error);
    res.status(500).send('Erro interno');
  }
});
// ------------------------------------------

app.get('/', (req, res) => {
  res.send('O Robô da Cyber Tech está online, a monitorizar inatividade e com Redis ativo! 🤖');
});

// 4. Tarefa Agendada (ALTERADO PARA CORRER A CADA 10 MINUTOS)
cron.schedule('*/10 * * * *', async () => {
  console.log('A verificar alunos inativos (Modo Teste: a cada 10 min)...');

  try {
    // Mantemos a regra de procurar quem não mexe há mais de 3 minutos
    const tresMinutosAtras = new Date();
    tresMinutosAtras.setMinutes(tresMinutosAtras.getMinutes() - 3);

    const snapshot = await db.collection('users')
      .where('ultimaAtividade', '<', tresMinutosAtras)
      .get();

    if (snapshot.empty) {
      console.log('Nenhum aluno inativo encontrado neste ciclo de teste.');
      return;
    }

    snapshot.forEach(async (doc) => {
      const user = doc.data();
      
      if (user.email) {
        const mailOptions = {
          from: `"Cyber Tech" <${process.env.EMAIL_USER}>`,
          to: user.email,
          subject: 'Teste de Inatividade! 🚀',
          html: `
            <h2>Olá ${user.name || 'Estudante'}, este é um e-mail de teste!</h2>
            <p>Se você está a receber isto, significa que o nosso robô detetou inatividade (mais de 3 minutos sem interação) e o cron job está a funcionar perfeitamente. <strong>Esta verificação ocorre a cada 10 minutos.</strong></p>
          `
        };

        try {
          await transporter.sendMail(mailOptions);
          console.log(`Lembrete enviado com sucesso para: ${user.email}`);
        } catch (error) {
          console.error(`Erro ao enviar para ${user.email}:`, error);
        }
      }
    });
  } catch (error) {
    console.error('Erro na verificação do cron job:', error);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor a correr na porta ${PORT}`);
});